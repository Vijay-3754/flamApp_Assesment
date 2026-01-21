'use strict';

/**
 * App initialization: wires canvas, websocket, UI (tools, undo/redo, user list, cursors).
 */

(function () {
  var history = [];
  var toolInstances = {};
  var currentTool = null;
  var users = {};
  var cursors = {};
  var previews = {};
  var mainCanvas, tempCanvas, cursorCanvas, previewCanvas;

  function getColor() { var e = document.getElementById('colour-picker'); return e ? (e.value || '#000000') : '#000000'; }
  function getLineWidth() { var e = document.getElementById('line-width'); return e ? parseInt(e.value, 10) || 4 : 4; }
  function getFontSize() { var e = document.getElementById('font-size'); return e ? (e.value || '16') : '16'; }
  function getFontFamily() { var e = document.getElementById('font-family'); return e ? (e.value || 'sans-serif') : 'sans-serif'; }

  // Track pending strokes for client-side prediction reconciliation
  var pendingStrokes = new Map(); // strokeId -> true

  function onCommit(stroke) {
    if (!stroke || !stroke.type || !stroke.strokeId || !stroke.data) return;
    
    // Mark as pending (client-side prediction)
    pendingStrokes.set(stroke.strokeId, true);
    
    // Add to history immediately for instant feedback
    history.push(stroke);
    CanvasModule.redrawAll(history);
    CanvasModule.clearTemp();
    
    // Send to server (will receive confirmation back)
    if (WebSocketModule.isConnected()) WebSocketModule.emitDraw(stroke);
  }

  function initCanvases() {
    mainCanvas = document.getElementById('imageView');
    if (!mainCanvas || !mainCanvas.getContext('2d')) return false;
    var container = mainCanvas.parentNode;
    container.style.position = 'relative';

    previewCanvas = document.createElement('canvas');
    previewCanvas.id = 'previewOverlay';
    previewCanvas.width = mainCanvas.width;
    previewCanvas.height = mainCanvas.height;
    previewCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    container.appendChild(previewCanvas);

    cursorCanvas = document.createElement('canvas');
    cursorCanvas.id = 'cursorOverlay';
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    container.appendChild(cursorCanvas);

    tempCanvas = document.createElement('canvas');
    tempCanvas.id = 'imageTemp';
    tempCanvas.width = mainCanvas.width;
    tempCanvas.height = mainCanvas.height;
    tempCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:auto;';
    container.appendChild(tempCanvas);

    CanvasModule.init(mainCanvas, tempCanvas);
    CanvasModule.setConfig({
      onCommit: onCommit,
      onPreview: function (shape) { if (WebSocketModule.isConnected()) WebSocketModule.emitPreview(shape); },
      getColor: getColor,
      getLineWidth: getLineWidth,
      getFontSize: getFontSize,
      getFontFamily: getFontFamily
    });

    var tools = CanvasModule.getTools();
    toolInstances = { pencil: new tools.pencil(), eraser: new tools.eraser(), rect: new tools.rect(), line: new tools.line(), circle: new tools.circle(), ellipse: new tools.ellipse(), text: new tools.text() };
    currentTool = toolInstances.pencil;
    return true;
  }

  function evCanvas(ev) {
    var r = tempCanvas.getBoundingClientRect();
    ev._x = (ev.clientX != null ? ev.clientX : ev.touches && ev.touches[0] && ev.touches[0].clientX) - r.left;
    ev._y = (ev.clientY != null ? ev.clientY : ev.touches && ev.touches[0] && ev.touches[0].clientY) - r.top;
    var t = ev.type === 'touchstart' ? 'mousedown' : ev.type === 'touchmove' ? 'mousemove' : ev.type === 'touchend' ? 'mouseup' : ev.type;
    if (currentTool && currentTool[t]) currentTool[t](ev);

    // Cursor broadcast (normalized for different canvas sizes)
    if (t === 'mousemove' || t === 'mousedown') {
      var nx = ev._x / mainCanvas.width, ny = ev._y / mainCanvas.height;
      WebSocketModule.emitCursor(nx, ny);
    }
  }

  function throttle(fn, ms) {
    var last = 0;
    return function () { var now = Date.now(); if (now - last >= ms) { last = now; fn.apply(this, arguments); } };
  }

  function drawPreviewLayer() {
    if (!previewCanvas) return;
    var ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    for (var uid in previews) {
      var p = previews[uid];
      if (p && p.type && p.data) CanvasModule.drawStroke(ctx, { type: p.type, data: p.data });
    }
  }

  function drawCursors() {
    var ctx = cursorCanvas.getContext('2d');
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    var w = mainCanvas.width, h = mainCanvas.height;
    Object.keys(cursors).forEach(function (uid) {
      var c = cursors[uid];
      if (c.x == null || c.y == null) return;
      var x = c.x * w, y = c.y * h;
      var u = users[uid];
      var color = (u && u.color) || '#666';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (u && u.name) {
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#333';
        ctx.fillText(u.name, x + 10, y + 4);
      }
    });
  }

  function setTool(name) {
    if (toolInstances[name]) currentTool = toolInstances[name];
    document.querySelectorAll('.tool-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tool') === name); });
    var ta = document.getElementById('text_tool');
    if (ta) { ta.style.display = 'none'; ta.value = ''; }
  }

  function updateUserList() {
    var el = document.getElementById('user-list');
    if (!el) return;
    var list = Object.keys(users).map(function (id) { var u = users[id]; return '<span class="user-chip" style="background:' + (u.color || '#999') + '">' + (u.name || id) + '</span>'; });
    el.innerHTML = list.length ? list.join('') : '<span class="muted">No other users</span>';
  }

  function init() {
    if (!initCanvases()) return;

    var statusEl = document.getElementById('connection-status');

    // Register WebSocket handlers before init so we don't miss connect
    WebSocketModule.on('connectionStatus', function (connected, message) {
      var el = document.getElementById('connection-status');
      if (el) {
        el.textContent = message || (connected ? 'Connected' : 'Disconnected');
        el.className = 'connection-status ' + (connected ? 'connected' : 'disconnected');
      }
    });

    WebSocketModule.on('draw', function (stroke) {
      try {
        if (!WebSocketModule.isValidStroke(stroke)) return;
        if (stroke.userId) { delete previews[stroke.userId]; drawPreviewLayer(); }
        
        // Client-side prediction reconciliation: avoid duplicate strokes
        var existingIndex = -1;
        if (stroke.strokeId) {
          for (var i = history.length - 1; i >= 0; i--) {
            if (history[i].strokeId === stroke.strokeId) {
              existingIndex = i;
              break;
            }
          }
        }
        
        if (existingIndex !== -1) {
          // Update existing stroke (may have merged segments from server)
          history[existingIndex] = stroke;
          pendingStrokes.delete(stroke.strokeId);
        } else {
          // New stroke from another user
          history.push(stroke);
        }
        
        CanvasModule.scheduleRedraw(history);
      } catch (e) { console.error('[draw]', e); }
    });

    WebSocketModule.on('preview', function (data) {
      try {
        if (!data || !data.userId || !data.type || !data.data) return;
        previews[data.userId] = { type: data.type, data: data.data };
        drawPreviewLayer();
      } catch (e) { console.error('[preview]', e); }
    });

    WebSocketModule.on('undo', function (data) {
      try {
        var id = data && data.strokeId;
        if (id == null) return;
        history = history.filter(function (s) { return s.strokeId !== id; });
        CanvasModule.scheduleRedraw(history);
        CanvasModule.clearTemp();
      } catch (e) { console.error('[undo]', e); }
    });

    WebSocketModule.on('clear', function () {
      try {
        history = [];
        previews = {};
        CanvasModule.clearAll();
        drawPreviewLayer();
      } catch (e) { console.error('[clear]', e); }
    });

    WebSocketModule.on('user:join', function (data) {
      try {
        history = Array.isArray(data.history) ? data.history : [];
        CanvasModule.scheduleRedraw(history);
        users = {};
        (data.users || []).forEach(function (u) { if (u && u.id) users[u.id] = { name: u.name, color: u.color }; });
        if (data.user && data.user.id) users[data.user.id] = { name: data.user.name, color: data.user.color };
        updateUserList();
      } catch (e) { console.error('[user:join]', e); }
    });

    WebSocketModule.on('user:list', function (data) {
      try {
        users = {};
        (data.users || []).forEach(function (u) { if (u && u.id) users[u.id] = { name: u.name, color: u.color }; });
        updateUserList();
      } catch (e) { console.error('[user:list]', e); }
    });

    WebSocketModule.on('user:left', function (data) {
      try {
        if (data && data.userId) {
          delete cursors[data.userId];
          delete users[data.userId];
          delete previews[data.userId];
        }
        drawCursors();
        drawPreviewLayer();
        updateUserList();
      } catch (e) { console.error('[user:left]', e); }
    });

    WebSocketModule.on('cursor', function (data) {
      try {
        if (!data || !data.userId) return;
        if (data.x == null && data.y == null) delete cursors[data.userId];
        else cursors[data.userId] = { x: data.x, y: data.y };
        drawCursors();
      } catch (e) { console.error('[cursor]', e); }
    });

    try {
      WebSocketModule.init();
    } catch (e) {
      console.error('WebSocket init failed:', e);
      if (statusEl) { statusEl.textContent = 'Connection unavailable'; statusEl.className = 'connection-status disconnected'; }
    }

    tempCanvas.addEventListener('mousedown', evCanvas, false);
    tempCanvas.addEventListener('mousemove', throttle(evCanvas, 16), false);
    tempCanvas.addEventListener('mouseup', evCanvas, false);
    tempCanvas.addEventListener('mouseleave', function () { WebSocketModule.emitCursor(null, null); }, false);
    tempCanvas.addEventListener('touchstart', function (e) { e.preventDefault(); evCanvas(e); }, { passive: false });
    tempCanvas.addEventListener('touchmove', function (e) { e.preventDefault(); evCanvas(e); }, { passive: false });
    tempCanvas.addEventListener('touchend', function (e) { e.preventDefault(); evCanvas(e); }, { passive: false });

    document.querySelectorAll('.tool-btn').forEach(function (b) {
      b.addEventListener('click', function () { setTool(b.getAttribute('data-tool')); });
    });
    setTool('pencil');

    document.getElementById('undo-btn').addEventListener('click', function () {
      if (history.length === 0) return;
      var last = history[history.length - 1];
      WebSocketModule.emitUndo(last.strokeId);
    });
    document.getElementById('redo-btn').addEventListener('click', function () { WebSocketModule.emitRedo(); });
    document.getElementById('clear-btn').addEventListener('click', function () { WebSocketModule.emitClear(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
