/**
 * Express + Socket.io server.
 * Serves the client, handles drawing, undo/redo, clear, cursor,
 * previews, and user lifecycle with rate limiting.
 */

import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { Server, Socket } from 'socket.io';

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

/**
 * ✅ Socket.IO configuration for Render (HTTPS + proxy safe)
 */
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_ROOM = 'default';

/** Allowed stroke types */
const STROKE_TYPES = new Set([
  'pencil',
  'erase',
  'rect',
  'line',
  'circle',
  'ellipse',
  'text',
]);

/** Allowed preview types */
const PREVIEW_TYPES = new Set(['rect', 'line', 'circle', 'ellipse']);

/** Rate limiting */
const RATE_LIMIT_PER_SEC = 80;
const PREVIEW_RATE_LIMIT_PER_SEC = 60;

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const previewRateLimit = new Map<string, { count: number; resetAt: number }>();

function checkLimit(
  map: Map<string, { count: number; resetAt: number }>,
  socketId: string,
  max: number
): boolean {
  const now = Date.now();
  const win = map.get(socketId);

  if (!win) {
    map.set(socketId, { count: 1, resetAt: now + 1000 });
    return true;
  }

  if (now >= win.resetAt) {
    win.count = 1;
    win.resetAt = now + 1000;
    return true;
  }

  if (win.count >= max) return false;
  win.count++;
  return true;
}

function clearRateLimit(socketId: string): void {
  rateLimit.delete(socketId);
  previewRateLimit.delete(socketId);
}

/**
 * Validate stroke payload
 */
function validateStroke(
  payload: unknown,
  userId: string
): Stroke | Stroke[] | null {
  if (!payload || typeof payload !== 'object') return null;

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
  if (
    typeof s.strokeId !== 'string' ||
    typeof s.type !== 'string' ||
    typeof s.data !== 'object' ||
    !STROKE_TYPES.has(s.type)
  ) {
    return null;
  }

  return {
    strokeId: s.strokeId,
    type: s.type,
    data: s.data as Record<string, unknown>,
    userId,
  };
}

/* ───────────── Static Files ───────────── */

app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

/* ───────────── Socket Handlers ───────────── */

io.on('connection', (socket: Socket) => {
  const roomId = DEFAULT_ROOM;
  let user;

  try {
    user = addUser(roomId, socket.id);
    socket.join(roomId);
  } catch (err) {
    console.error('[connection] addUser failed', err);
    socket.disconnect(true);
    return;
  }

  socket.emit('user:join', {
    user: { id: socket.id, name: user.name, color: user.color },
    users: getUsers(roomId),
    history: getDrawingState(roomId).getHistory(),
  });

  socket.to(roomId).emit('user:list', { users: getUsers(roomId) });

  socket.on('draw', (payload: unknown) => {
    try {
      if (!checkLimit(rateLimit, socket.id, RATE_LIMIT_PER_SEC)) return;

      const validated = validateStroke(payload, socket.id);
      if (!validated) return;

      const strokes = Array.isArray(validated) ? validated : [validated];
      const ds = getDrawingState(roomId);
      const opId = `op-${Date.now()}-${socket.id}`;

      for (const s of strokes) {
        s.operationId = opId;
        s.timestamp ??= Date.now();

        const added = ds.addStroke(s);
        if (added) io.to(roomId).emit('draw', added);
      }
    } catch (err) {
      console.error('[draw]', err);
    }
  });

  socket.on('undo', (data: unknown) => {
    try {
      const strokeId =
        data &&
        typeof data === 'object' &&
        typeof (data as any).strokeId === 'string'
          ? (data as any).strokeId
          : null;

      if (!strokeId) return;

      const id = getDrawingState(roomId).undo(strokeId);
      if (id) io.to(roomId).emit('undo', { strokeId: id });
    } catch (err) {
      console.error('[undo]', err);
    }
  });

  socket.on('redo', () => {
    try {
      const result = getDrawingState(roomId).redo();
      if (result?.strokes) {
        result.strokes.forEach((s) => io.to(roomId).emit('draw', s));
      }
    } catch (err) {
      console.error('[redo]', err);
    }
  });

  socket.on('clear', () => {
    try {
      getDrawingState(roomId).clear();
      io.to(roomId).emit('clear');
    } catch (err) {
      console.error('[clear]', err);
    }
  });

  socket.on('cursor', (pos: unknown) => {
    try {
      const p = pos && typeof pos === 'object' ? (pos as any) : {};
      const x = typeof p.x === 'number' ? p.x : null;
      const y = typeof p.y === 'number' ? p.y : null;

      setCursor(roomId, socket.id, x, y);
      socket.to(roomId).emit('cursor', { userId: socket.id, x, y });
    } catch (err) {
      console.error('[cursor]', err);
    }
  });

  socket.on('preview', (data: unknown) => {
    try {
      if (!checkLimit(previewRateLimit, socket.id, PREVIEW_RATE_LIMIT_PER_SEC))
        return;

      const d = data && typeof data === 'object' ? (data as any) : {};
      if (!PREVIEW_TYPES.has(d.type) || typeof d.data !== 'object') return;

      socket.to(roomId).emit('preview', {
        userId: socket.id,
        type: d.type,
        data: d.data,
      });
    } catch (err) {
      console.error('[preview]', err);
    }
  });

  socket.on('disconnect', () => {
    try {
      clearRateLimit(socket.id);
      removeUser(roomId, socket.id);
      socket.to(roomId).emit('user:left', { userId: socket.id });
      socket.to(roomId).emit('user:list', { users: getUsers(roomId) });
    } catch (err) {
      console.error('[disconnect]', err);
    }
  });
});

/* ───────────── Server Start ───────────── */

server.listen(PORT, () => {
  console.log(`Collaborative Canvas server on http://localhost:${PORT}`);
});

server.on('error', (err: Error) => {
  console.error('Server error:', err);
});
