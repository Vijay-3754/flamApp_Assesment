'use strict';

/**
 * WebSocket (Socket.io) client. Handles connection, drawing events,
 * cursor sync, and user list. No canvas logic.
 * Exposes connection status (connect/disconnect/reconnect) for UI and
 * network-issue handling.
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

  function on(ev, fn) {
    if (handlers[ev]) handlers[ev].push(fn);
  }

  function emitStatus(connected, message) {
    handlers.connectionStatus.forEach(function (f) { f(connected, message); });
  }

  /**
   * Create Socket.io connection and register internal event handlers.
   * Call after registering `on('connectionStatus', ...)` and other `on` handlers.
   * @returns {Socket|null}
   * @throws {Error} if `io` is not loaded
   */
  function init() {
    if (typeof io === 'undefined') throw new Error('Socket.io not loaded');
    socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });

    socket.on('connect', function () {
      emitStatus(true, 'Connected');
    });

    socket.on('disconnect', function (reason) {
      emitStatus(false, reason === 'io server disconnect' ? 'Disconnected' : 'Reconnecting...');
    });

    socket.on('connect_error', function () {
      emitStatus(false, 'Connection error');
    });

    socket.on('reconnect', function () {
      emitStatus(true, 'Reconnected');
    });

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

  /** Simple validation: stroke must have type, strokeId, and data. */
  function isValidStroke(s) {
    return s != null && typeof s === 'object' && typeof s.type === 'string' && typeof s.strokeId === 'string' && s.data != null && typeof s.data === 'object';
  }

  function emitDraw(stroke) {
    if (socket && socket.connected) socket.emit('draw', stroke);
  }

  function emitPreview(shape) {
    if (socket && socket.connected && shape && shape.type && shape.data) socket.emit('preview', shape);
  }

  function emitUndo(strokeId) {
    if (socket && socket.connected) socket.emit('undo', { strokeId: strokeId });
  }

  function emitRedo() {
    if (socket && socket.connected) socket.emit('redo', {});
  }

  function emitClear() {
    if (socket && socket.connected) socket.emit('clear');
  }

  function emitCursor(x, y) {
    if (socket && socket.connected) {
      if (x == null || y == null) socket.emit('cursor', { x: null, y: null });
      else socket.emit('cursor', { x: x, y: y });
    }
  }

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
    isConnected: function () { return socket && socket.connected; }
  };
})(typeof window !== 'undefined' ? window : this);
