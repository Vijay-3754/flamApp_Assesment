/**
 * Express + Socket.io server. Serves the client, handles drawing, undo/redo,
 * clear, cursor, and user lifecycle. Validates payloads and rate-limits draw events.
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import {
  addUser,
  removeUser,
  getUsers,
  setCursor,
  getDrawingState,
} from './rooms';
import type { Stroke } from './drawing-state';

const app = express();
const server = http.createServer(app);
const socketServer = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_ROOM = 'default';

/** Allowed stroke types. */
const STROKE_TYPES = new Set(['pencil', 'erase', 'rect', 'line', 'circle', 'ellipse', 'text']);

/** Allowed shape preview types (subset; no pencil/erase/text). */
const PREVIEW_TYPES = new Set(['rect', 'line', 'circle', 'ellipse']);

/** Max draw events per second per socket to avoid flooding under high activity. */
const RATE_LIMIT_PER_SEC = 80;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

/** Max shape preview events per second per socket. */
const PREVIEW_RATE_LIMIT_PER_SEC = 60;
const previewRateLimit = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const win = rateLimit.get(socketId);
  if (!win) {
    rateLimit.set(socketId, { count: 1, resetAt: now + 1000 });
    return true;
  }
  if (now >= win.resetAt) {
    win.count = 1;
    win.resetAt = now + 1000;
    return true;
  }
  if (win.count >= RATE_LIMIT_PER_SEC) return false;
  win.count++;
  return true;
}

function checkPreviewRateLimit(socketId: string): boolean {
  const now = Date.now();
  const win = previewRateLimit.get(socketId);
  if (!win) {
    previewRateLimit.set(socketId, { count: 1, resetAt: now + 1000 });
    return true;
  }
  if (now >= win.resetAt) {
    win.count = 1;
    win.resetAt = now + 1000;
    return true;
  }
  if (win.count >= PREVIEW_RATE_LIMIT_PER_SEC) return false;
  win.count++;
  return true;
}

function clearRateLimit(socketId: string): void {
  rateLimit.delete(socketId);
  previewRateLimit.delete(socketId);
}

/**
 * Validates a stroke payload. Returns the normalized stroke or null if invalid.
 * Also accepts { strokes: Stroke[] } for batch (e.g. future pencil batching).
 */
function validateStroke(payload: unknown, userId: string): Stroke | Stroke[] | null {
  if (payload == null || typeof payload !== 'object') return null;

  const batch = (payload as { strokes?: unknown }).strokes;
  if (Array.isArray(batch)) {
    const out: Stroke[] = [];
    for (const s of batch) {
      const one = validateStroke(s, userId);
      if (one && !Array.isArray(one)) out.push(one);
    }
    return out.length ? out : null;
  }

  const s = payload as Record<string, unknown>;
  const strokeId = s.strokeId;
  const type = s.type;
  const data = s.data;
  if (typeof strokeId !== 'string' || typeof type !== 'string' || data == null || typeof data !== 'object') {
    return null;
  }
  if (!STROKE_TYPES.has(type)) return null;
  return { strokeId, type, data: data as Record<string, unknown>, userId };
}

// --- Static and routes ---

app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// --- Socket handlers ---

socketServer.on('connection', (socket) => {
  const roomId = DEFAULT_ROOM;
  let user;
  try {
    user = addUser(roomId, socket.id);
    socket.join(roomId);
  } catch (e) {
    console.error('[connection] addUser failed:', e);
    socket.disconnect(true);
    return;
  }

  try {
    socket.emit('user:join', {
      user: { id: socket.id, name: user.name, color: user.color },
      users: getUsers(roomId),
      history: getDrawingState(roomId).getHistory(),
    });
    socket.to(roomId).emit('user:list', { users: getUsers(roomId) });
  } catch (e) {
    console.error('[connection] user:join emit failed:', e);
  }

  socket.on('draw', (payload: unknown) => {
    try {
      if (!checkRateLimit(socket.id)) return;
      const validated = validateStroke(payload, socket.id);
      if (!validated) return;
      const ds = getDrawingState(roomId);
      const list = Array.isArray(validated) ? validated : [validated];
      
      // Add operation ID for conflict resolution
      const operationId = `op-${Date.now()}-${socket.id}`;
      
      for (const s of list) {
        // Add operation metadata
        s.operationId = operationId;
        if (!s.timestamp) {
          s.timestamp = Date.now();
        }
        
        const added = ds.addStroke(s);
        if (added) {
          // Broadcast to all clients (including sender) for consistency
          // Client-side reconciliation handles duplicates
          socketServer.to(roomId).emit('draw', added);
        }
      }
    } catch (e) {
      console.error('[draw]', e);
    }
  });

  socket.on('undo', (data: unknown) => {
    try {
      const strokeId = data != null && typeof data === 'object' && typeof (data as { strokeId?: unknown }).strokeId === 'string'
        ? (data as { strokeId: string }).strokeId
        : null;
      if (!strokeId) return;
      const ds = getDrawingState(roomId);
      const id = ds.undo(strokeId);
      if (id) socketServer.to(roomId).emit('undo', { strokeId: id });
    } catch (e) {
      console.error('[undo]', e);
    }
  });

  socket.on('redo', () => {
    try {
      const ds = getDrawingState(roomId);
      const result = ds.redo();
      if (result?.strokes?.length) {
        for (const s of result.strokes) {
          socketServer.to(roomId).emit('draw', s);
        }
      }
    } catch (e) {
      console.error('[redo]', e);
    }
  });

  socket.on('clear', () => {
    try {
      const ds = getDrawingState(roomId);
      ds.clear();
      socketServer.to(roomId).emit('clear');
    } catch (e) {
      console.error('[clear]', e);
    }
  });

  socket.on('cursor', (pos: unknown) => {
    try {
      const p = pos != null && typeof pos === 'object' ? (pos as { x?: unknown; y?: unknown }) : {};
      const x = typeof p.x === 'number' ? p.x : null;
      const y = typeof p.y === 'number' ? p.y : null;
      setCursor(roomId, socket.id, x, y);
      socket.to(roomId).emit('cursor', { userId: socket.id, x, y });
    } catch (e) {
      console.error('[cursor]', e);
    }
  });

  socket.on('preview', (data: unknown) => {
    try {
      if (!checkPreviewRateLimit(socket.id)) return;
      const d = data != null && typeof data === 'object' ? (data as { type?: unknown; data?: unknown }) : {};
      const type = typeof d.type === 'string' ? d.type : '';
      const pay = d.data != null && typeof d.data === 'object' ? d.data : null;
      if (!PREVIEW_TYPES.has(type) || !pay) return;
      socket.to(roomId).emit('preview', { userId: socket.id, type, data: pay });
    } catch (e) {
      console.error('[preview]', e);
    }
  });

  socket.on('disconnect', () => {
    try {
      clearRateLimit(socket.id);
      removeUser(roomId, socket.id);
      socket.to(roomId).emit('user:left', { userId: socket.id });
      socket.to(roomId).emit('user:list', { users: getUsers(roomId) });
    } catch (e) {
      console.error('[disconnect]', e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Collaborative Canvas server on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
