'use strict';

/**
 * WebSocket (Socket.io) client.
 * Handles connection, drawing events, cursor sync, and user list.
 * Production-safe for Render (HTTPS + proxy).
 */

(function (global) {
  var socket = null;

  var handlers = {
    draw: [],
    undo: [],
    clear: [],
    cursor: [],
    preview: [],
    userJoin: [],
    userList: [],
    userLeft: [],
    connectionStatus: []
  };

  function on(event, fn) {
    if (handlers[event]) handlers[event].push(fn);
  }

  function emitStatus(connected, message) {
    handlers.connectionStatus.forEach(function (f) {
      f(connected, message);
    });
  }

  /**
   * Initialize Socket.IO connection
   */
  function init() {
    if (typeof io === 'undefined') {
      throw new Error('Socket.io client not loaded');
    }

    // ✅ Render + HTTPS safe configuration
    socket = io({
      path: '/socket.io',
      transports: ['polling', 'websocket'], // allow upgrade
      secure: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000
    });

    socket.on('connect', function () {
      emitStatus(true, 'Connected');
    });

    socket.on('disconnect', function (reason) {
      if (reason === 'io server disconnect') {
        emitStatus(false, 'Disconnected');
      } else {
        emitStatus(false, 'Reconnecting…');
      }
    });

    socket.on('connect_error', function (err) {
      emitStatus(false, 'Connection error');
      console.error('Socket connection error:', err);
    });

    socket.on('reconnect', function () {
      emitStatus(true, 'Reconnected');
    });

    // ---- Server events ----

    socket.on('draw', function (stroke) {
      handlers.draw.forEach(function (f) { f(stroke); });
    });

    socket.on('preview', function (data) {
      handlers.preview.forEach(function (f) { f(data); });
    });

    socket.on('undo', function (data) {
      handlers.undo.forEach(function (f) { f(data); });
    });

    socket.on('clear', function () {
      handlers.clear.forEach(function (f) { f(); });
    });

    socket.on('cursor', function (data) {
      handlers.cursor.forEach(function (f) { f(data); });
    });

    socket.on('user:join', function (data) {
      handlers.userJoin.forEach(function (f) { f(data); });
    });

    socket.on('user:list', function (data) {
      handlers.userList.forEach(function (f) { f(data); });
    });

    socket.on('user:left', function (data) {
      handlers.userLeft.forEach(function (f) { f(data); });
    });

    return socket;
  }

  // ---- Emit helpers ----

  function emitDraw(stroke) {
    if (socket && socket.connected) {
      socket.emit('draw', stroke);
    }
  }

  function emitPreview(shape) {
    if (socket && socket.connected && shape && shape.type && shape.data) {
      socket.emit('preview', shape);
    }
  }

  function emitUndo(strokeId) {
    if (socket && socket.connected) {
      socket.emit('undo', { strokeId: strokeId });
    }
  }

  function emitRedo() {
    if (socket && socket.connected) {
      socket.emit('redo');
    }
  }

  function emitClear() {
    if (socket && socket.connected) {
      socket.emit('clear');
    }
  }

  function emitCursor(x, y) {
    if (socket && socket.connected) {
      socket.emit('cursor', {
        x: x != null ? x : null,
        y: y != null ? y : null
      });
    }
  }

  function isValidStroke(s) {
    return (
      s &&
      typeof s === 'object' &&
      typeof s.type === 'string' &&
      typeof s.strokeId === 'string' &&
      s.data &&
      typeof s.data === 'object'
    );
  }

  // ---- Public API ----

  global.WebSocketModule = {
    init: init,
    on: on,
    emitDraw: emitDraw,
    emitPreview: emitPreview,
    emitUndo: emitUndo,
    emitRedo: emitRedo,
    emitClear: emitClear,
    emitCursor: emitCursor,
    isValidStroke: isValidStroke,
    isConnected: function () {
      return socket && socket.connected;
    }
  };

})(typeof window !== 'undefined' ? window : this);
