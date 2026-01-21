'use strict';

/**
 * Canvas drawing logic only. No network. Implements path optimization,
 * layer management (main + temp), and efficient redraw for undo/redo.
 */

(function (global) {
  let main, temp, mainCtx, tempCtx;
  let cfg = {};

  function getW() { return main ? main.width : 1; }
  function getH() { return main ? main.height : 1; }

  function denorm(x, y) {
    return { x: x * getW(), y: y * getH() };
  }

  function drawOneStroke(ctx, s, isTemp) {
    const w = main.width;
    const h = main.height;
    const d = s.data || {};
    switch (s.type) {
      case 'pencil': {
        ctx.strokeStyle = d.color || '#000';
        ctx.lineWidth = d.lineWidth || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const segs = d.segments || [];
        for (let i = 0; i < segs.length; i++) {
          const [x0, y0, x1, y1] = segs[i];
          const a = denorm(x0, y0), b = denorm(x1, y1);
          if (i === 0) ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        break;
      }
      case 'erase': {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = d.lineWidth || 20;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const segs = d.segments || [];
        for (let i = 0; i < segs.length; i++) {
          const [x0, y0, x1, y1] = segs[i];
          const a = denorm(x0, y0), b = denorm(x1, y1);
          if (i === 0) ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'rect': {
        ctx.strokeStyle = d.color || '#000';
        ctx.lineWidth = d.lineWidth || 2;
        ctx.strokeRect(d.min_x * w, d.min_y * h, d.abs_x * w, d.abs_y * h);
        break;
      }
      case 'line': {
        ctx.strokeStyle = d.color || '#000';
        ctx.lineWidth = d.lineWidth || 2;
        ctx.beginPath();
        ctx.moveTo(d.x0 * w, d.y0 * h);
        ctx.lineTo(d.x1 * w, d.y1 * h);
        ctx.stroke();
        break;
      }
      case 'circle': {
        const x = (d.x1 + d.x2) / 2 * w, y = (d.y1 + d.y2) / 2 * h;
        const r = Math.max(Math.abs((d.x2 - d.x1) * w), Math.abs((d.y2 - d.y1) * h)) / 2;
        ctx.strokeStyle = d.color || '#000';
        ctx.lineWidth = d.lineWidth || 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'ellipse': {
        const x = d.x * w, y = d.y * h, ww = d.w * w, hh = d.h * h;
        const k = 0.5522848, ox = (ww / 2) * k, oy = (hh / 2) * k;
        const xe = x + ww, ye = y + hh, xm = x + ww / 2, ym = y + hh / 2;
        ctx.strokeStyle = d.color || '#000';
        ctx.lineWidth = d.lineWidth || 2;
        ctx.beginPath();
        ctx.moveTo(x, ym);
        ctx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
        ctx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
        ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
        ctx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
        ctx.stroke();
        break;
      }
      case 'text': {
        ctx.font = (d.fsize || 16) + 'px ' + (d.ffamily || 'sans-serif');
        ctx.textBaseline = 'top';
        ctx.fillStyle = d.colorVal || '#000';
        const lines = d.processed_linesArray || [];
        const left = parseFloat(d.textPosLeft) || 0, top = parseFloat(d.textPosTop) || 0;
        const fs = parseInt(d.fsize, 10) || 16;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], left, top + i * fs);
        }
        break;
      }
      default:
        break;
    }
  }

  function throttle(fn, ms) {
    let last = 0;
    return function () {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(this, arguments); }
    };
  }

  // --- Public API ---

  /**
   * Initialize main and temp canvases and their 2D contexts.
   * @param {HTMLCanvasElement} mainCanvas - persistent layer
   * @param {HTMLCanvasElement} tempCanvas - in-progress preview layer
   */
  function init(mainCanvas, tempCanvas) {
    main = mainCanvas;
    temp = tempCanvas;
    mainCtx = main.getContext('2d');
    tempCtx = temp.getContext('2d');
  }

  /**
   * Redraw the full canvas from history. Used after undo/redo/clear and on remote draws.
   * Coalesce rapid calls with requestAnimationFrame to keep UI smooth under high activity.
   */
  function redrawAll(history) {
    if (!mainCtx || !Array.isArray(history)) return;
    mainCtx.clearRect(0, 0, main.width, main.height);
    mainCtx.fillStyle = '#fff';
    mainCtx.fillRect(0, 0, main.width, main.height);
    history.forEach(function (s) { drawOneStroke(mainCtx, s); });
  }

  var _redrawScheduled = false;
  var _pendingHistory = null;

  /**
   * Schedule a redraw on the next animation frame. Multiple calls in the same frame
   * result in a single redraw with the latest history (efficiency under high activity).
   * @param {Array} history
   */
  function scheduleRedraw(history) {
    _pendingHistory = history;
    if (_redrawScheduled) return;
    _redrawScheduled = true;
    requestAnimationFrame(function () {
      _redrawScheduled = false;
      if (_pendingHistory != null) {
        redrawAll(_pendingHistory);
        _pendingHistory = null;
      }
    });
  }

  function clearTemp() {
    if (tempCtx) tempCtx.clearRect(0, 0, temp.width, temp.height);
  }

  function clearAll() {
    if (mainCtx) mainCtx.clearRect(0, 0, main.width, main.height);
    if (mainCtx) { mainCtx.fillStyle = '#fff'; mainCtx.fillRect(0, 0, main.width, main.height); }
    clearTemp();
  }

  function setConfig(c) { cfg = c || {}; }

  function getTools() {
    const onCommit = cfg.onCommit || function () {};
    const onPreview = cfg.onPreview || function () {};
    const getColor = cfg.getColor || function () { return '#000000'; };
    const getLineWidth = cfg.getLineWidth || function () { return 4; };
    const getFontSize = cfg.getFontSize || function () { return 16; };
    const getFontFamily = cfg.getFontFamily || function () { return 'sans-serif'; };
    const w = getW; const h = getH;

    const tools = {};

    // ---- Pencil (path optimization: segments per stroke, batched emit for efficiency) ----
    tools.pencil = function () {
      var t = this; t.started = false; t.strokeId = null; t.segments = [];
      t._batchTimer = null; t._pendingSegments = [];
      t.mousedown = function (ev) {
        t.started = true;
        t.strokeId = 'p' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        t.segments = [];
        t._pendingSegments = [];
        t._lx = ev._x; t._ly = ev._y;
      };
      t.mousemove = function (ev) {
        if (!t.started) return;
        var x0 = t._lx / w(), y0 = t._ly / h(), x1 = ev._x / w(), y1 = ev._y / h();
        var seg = [x0, y0, x1, y1];
        t.segments.push(seg);
        t._pendingSegments.push(seg);
        
        // Immediate visual feedback (client-side prediction)
        tempCtx.strokeStyle = getColor();
        tempCtx.lineWidth = getLineWidth();
        tempCtx.lineCap = 'round'; tempCtx.lineJoin = 'round';
        tempCtx.beginPath();
        tempCtx.moveTo(t._lx, t._ly);
        tempCtx.lineTo(ev._x, ev._y);
        tempCtx.stroke();
        t._lx = ev._x; t._ly = ev._y;
        
        // Batch emit: send accumulated segments every 50ms or when batch size >= 10
        if (t._batchTimer) clearTimeout(t._batchTimer);
        t._batchTimer = setTimeout(function () {
          if (t._pendingSegments.length > 0) {
            onCommit({ 
              strokeId: t.strokeId, 
              type: 'pencil', 
              data: { 
                segments: t._pendingSegments.slice(), 
                color: getColor(), 
                lineWidth: getLineWidth() 
              } 
            });
            t._pendingSegments = [];
          }
        }, 50);
      };
      t.mouseup = function (ev) {
        if (t.started) {
          t.mousemove(ev);
          // Flush any pending segments immediately
          if (t._batchTimer) clearTimeout(t._batchTimer);
          if (t._pendingSegments.length > 0) {
            onCommit({ 
              strokeId: t.strokeId, 
              type: 'pencil', 
              data: { 
                segments: t._pendingSegments.slice(), 
                color: getColor(), 
                lineWidth: getLineWidth() 
              } 
            });
            t._pendingSegments = [];
          }
          t.started = false;
        }
      };
      return t;
    };

    // ---- Eraser (path optimization: batched segments for efficiency) ----
    tools.eraser = function () {
      var t = this; t.started = false; t.strokeId = null; t.segments = [];
      t._batchTimer = null; t._pendingSegments = [];
      t.mousedown = function (ev) {
        t.started = true;
        t.strokeId = 'e' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        t.segments = [];
        t._pendingSegments = [];
        t._lx = ev._x; t._ly = ev._y;
      };
      t.mousemove = function (ev) {
        if (!t.started) return;
        var x0 = t._lx / w(), y0 = t._ly / h(), x1 = ev._x / w(), y1 = ev._y / h();
        var seg = [x0, y0, x1, y1];
        t.segments.push(seg);
        t._pendingSegments.push(seg);
        
        // Immediate visual feedback (client-side prediction)
        tempCtx.save();
        tempCtx.globalCompositeOperation = 'destination-out';
        tempCtx.strokeStyle = 'rgba(0,0,0,1)';
        tempCtx.lineWidth = getLineWidth();
        tempCtx.lineCap = 'round'; tempCtx.lineJoin = 'round';
        tempCtx.beginPath();
        tempCtx.moveTo(t._lx, t._ly);
        tempCtx.lineTo(ev._x, ev._y);
        tempCtx.stroke();
        tempCtx.restore();
        t._lx = ev._x; t._ly = ev._y;
        
        // Batch emit: send accumulated segments every 50ms
        if (t._batchTimer) clearTimeout(t._batchTimer);
        t._batchTimer = setTimeout(function () {
          if (t._pendingSegments.length > 0) {
            onCommit({ 
              strokeId: t.strokeId, 
              type: 'erase', 
              data: { 
                segments: t._pendingSegments.slice(), 
                lineWidth: getLineWidth() 
              } 
            });
            t._pendingSegments = [];
          }
        }, 50);
      };
      t.mouseup = function (ev) {
        if (t.started) {
          t.mousemove(ev);
          // Flush any pending segments immediately
          if (t._batchTimer) clearTimeout(t._batchTimer);
          if (t._pendingSegments.length > 0) {
            onCommit({ 
              strokeId: t.strokeId, 
              type: 'erase', 
              data: { 
                segments: t._pendingSegments.slice(), 
                lineWidth: getLineWidth() 
              } 
            });
            t._pendingSegments = [];
          }
          t.started = false;
        }
      };
      return t;
    };

    // ---- Rect ----
    tools.rect = function () {
      var t = this; t.started = false;
      t.mousedown = function (ev) { t.started = true; t.x0 = ev._x; t.y0 = ev._y; };
      t.mousemove = function (ev) {
        if (!t.started) return;
        clearTemp();
        var x = Math.min(ev._x, t.x0), y = Math.min(ev._y, t.y0), ww = Math.abs(ev._x - t.x0), hh = Math.abs(ev._y - t.y0);
        if (ww && hh) {
          tempCtx.strokeStyle = getColor();
          tempCtx.lineWidth = getLineWidth();
          tempCtx.strokeRect(x, y, ww, hh);
          onPreview({ type: 'rect', data: { min_x: x / w(), min_y: y / h(), abs_x: ww / w(), abs_y: hh / h(), color: getColor(), lineWidth: getLineWidth() } });
        }
      };
      t.mouseup = function (ev) {
        if (!t.started) return;
        t.mousemove(ev);
        var x = Math.min(ev._x, t.x0), y = Math.min(ev._y, t.y0), ww = Math.abs(ev._x - t.x0), hh = Math.abs(ev._y - t.y0);
        t.started = false;
        if (ww && hh) onCommit({ strokeId: 'r' + Date.now(), type: 'rect', data: { min_x: x / w(), min_y: y / h(), abs_x: ww / w(), abs_y: hh / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      return t;
    };

    // ---- Line ----
    tools.line = function () {
      var t = this; t.started = false;
      t.mousedown = function (ev) { t.started = true; t.x0 = ev._x; t.y0 = ev._y; };
      t.mousemove = function (ev) {
        if (!t.started) return;
        clearTemp();
        tempCtx.strokeStyle = getColor();
        tempCtx.lineWidth = getLineWidth();
        tempCtx.beginPath();
        tempCtx.moveTo(t.x0, t.y0);
        tempCtx.lineTo(ev._x, ev._y);
        tempCtx.stroke();
        onPreview({ type: 'line', data: { x0: t.x0 / w(), y0: t.y0 / h(), x1: ev._x / w(), y1: ev._y / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      t.mouseup = function (ev) {
        if (!t.started) return;
        t.mousemove(ev);
        t.started = false;
        onCommit({ strokeId: 'l' + Date.now(), type: 'line', data: { x0: t.x0 / w(), y0: t.y0 / h(), x1: ev._x / w(), y1: ev._y / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      return t;
    };

    // ---- Circle ----
    tools.circle = function () {
      var t = this; t.started = false;
      t.mousedown = function (ev) { t.started = true; t.x1 = ev._x; t.y1 = ev._y; };
      t.mousemove = function (ev) {
        if (!t.started) return;
        clearTemp();
        var cx = (t.x1 + ev._x) / 2, cy = (t.y1 + ev._y) / 2;
        var r = Math.max(Math.abs(ev._x - t.x1), Math.abs(ev._y - t.y1)) / 2;
        tempCtx.strokeStyle = getColor();
        tempCtx.lineWidth = getLineWidth();
        tempCtx.beginPath();
        tempCtx.arc(cx, cy, r, 0, Math.PI * 2);
        tempCtx.stroke();
        onPreview({ type: 'circle', data: { x1: t.x1 / w(), y1: t.y1 / h(), x2: ev._x / w(), y2: ev._y / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      t.mouseup = function (ev) {
        if (!t.started) return;
        t.mousemove(ev);
        t.started = false;
        onCommit({ strokeId: 'c' + Date.now(), type: 'circle', data: { x1: t.x1 / w(), y1: t.y1 / h(), x2: ev._x / w(), y2: ev._y / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      return t;
    };

    // ---- Ellipse ----
    tools.ellipse = function () {
      var t = this; t.started = false;
      t.mousedown = function (ev) { t.started = true; t.x0 = ev._x; t.y0 = ev._y; };
      t.mousemove = function (ev) {
        if (!t.started) return;
        clearTemp();
        var x = Math.min(ev._x, t.x0), y = Math.min(ev._y, t.y0), ww = Math.abs(ev._x - t.x0), hh = Math.abs(ev._y - t.y0);
        var k = 0.5522848, ox = (ww / 2) * k, oy = (hh / 2) * k;
        var xe = x + ww, ye = y + hh, xm = x + ww / 2, ym = y + hh / 2;
        tempCtx.strokeStyle = getColor();
        tempCtx.lineWidth = getLineWidth();
        tempCtx.beginPath();
        tempCtx.moveTo(x, ym);
        tempCtx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
        tempCtx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
        tempCtx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
        tempCtx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
        tempCtx.stroke();
        if (ww && hh) onPreview({ type: 'ellipse', data: { x: x / w(), y: y / h(), w: ww / w(), h: hh / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      t.mouseup = function (ev) {
        if (!t.started) return;
        t.mousemove(ev);
        var x = Math.min(ev._x, t.x0), y = Math.min(ev._y, t.y0), ww = Math.abs(ev._x - t.x0), hh = Math.abs(ev._y - t.y0);
        t.started = false;
        if (ww && hh) onCommit({ strokeId: 'el' + Date.now(), type: 'ellipse', data: { x: x / w(), y: y / h(), w: ww / w(), h: hh / h(), color: getColor(), lineWidth: getLineWidth() } });
      };
      return t;
    };

    // ---- Text ----
    tools.text = function () {
      var t = this; t.started = false; t.ta = null; t.tmp = null;
      t.mousedown = function (ev) { t.started = true; t.x0 = ev._x; t.y0 = ev._y; };
      t.mousemove = function (ev) {
        if (!t.started) return;
        if (!t.ta) {
          t.ta = document.createElement('textarea');
          t.ta.id = 'text_tool'; t.ta.className = 'text-tool-input';
          t.ta.style.cssText = 'position:absolute;border:1px dashed #333;outline:0;z-index:1000;display:none;resize:none;';
          main.parentNode.appendChild(t.ta);
          t.tmp = document.createElement('div');
          t.tmp.style.cssText = 'position:absolute;visibility:hidden;display:none;';
          main.parentNode.appendChild(t.tmp);
        }
        var x = Math.min(ev._x, t.x0), y = Math.min(ev._y, t.y0), ww = Math.max(Math.abs(ev._x - t.x0), 40), hh = Math.max(Math.abs(ev._y - t.y0), 24);
        t.ta.style.left = x + 'px'; t.ta.style.top = y + 'px'; t.ta.style.width = ww + 'px'; t.ta.style.height = hh + 'px';
        t.ta.style.font = getFontSize() + 'px ' + getFontFamily();
        t.ta.style.display = 'block';
        t.ta.style.color = getColor();
      };
      t.mouseup = function (ev) {
        if (!t.started || !t.ta) return;
        var left = t.ta.style.left, top = t.ta.style.top, lines = t.ta.value.split('\n');
        var processed = [];
        for (var i = 0; i < lines.length; i++) {
          var str = '';
          t.tmp.innerHTML = ''; t.tmp.style.cssText = 'position:absolute;visibility:hidden;display:block;font:' + getFontSize() + 'px ' + getFontFamily();
          for (var j = 0; j < lines[i].length; j++) {
            t.tmp.appendChild(document.createTextNode(lines[i][j]));
            if (t.tmp.offsetWidth > parseInt(t.ta.style.width, 10)) break;
            str += lines[i][j];
          }
          processed.push(str);
        }
        t.ta.style.display = 'none';
        t.ta.value = '';
        t.started = false;
        if (processed.length) onCommit({ strokeId: 'tx' + Date.now(), type: 'text', data: { fsize: getFontSize(), ffamily: getFontFamily(), colorVal: getColor(), textPosLeft: left, textPosTop: top, processed_linesArray: processed } });
      };
      return t;
    };

    return tools;
  }

  /** Draw a single stroke to an arbitrary context. Used for the preview layer. */
  function drawStroke(ctx, stroke) {
    if (ctx && stroke && stroke.type) drawOneStroke(ctx, stroke);
  }

  global.CanvasModule = {
    init: init,
    redrawAll: redrawAll,
    scheduleRedraw: scheduleRedraw,
    clearTemp: clearTemp,
    clearAll: clearAll,
    setConfig: setConfig,
    getTools: getTools,
    drawStroke: drawStroke,
    getCanvas: function () { return main; },
    getTemp: function () { return temp; }
  };
})(typeof window !== 'undefined' ? window : this);
