# Architecture: Real-Time Collaborative Drawing Canvas

## Data Flow Diagram

```
┌─────────────────┐     draw/undo/redo/clear/cursor      ┌─────────────────┐
│                 │ ──────────────────────────────────►  │                 │
│   Client A      │                                      │     Server      │
│  (canvas.js,    │  ◄──────────────────────────────────  │  (Express +     │
│   websocket.js, │     broadcast to other clients        │   Socket.io)    │
│   main.js)      │     (with operation IDs & timestamps) │                 │
└─────────────────┘                                      └────────┬────────┘
        │                                                         │
        │ 1. User draws → tool produces stroke                    │
        │ 2. Client-side prediction: history.push(stroke)         │
        │    immediately, redrawAll(history)                      │
        │ 3. Batch segments (pencil/eraser) every 50ms            │
        │ 4. main.js: emitDraw(stroke)                            │
        │ 5. Server: drawing-state.addStroke() (merges segments)  │
        │    adds operationId & timestamp, broadcasts 'draw'      │
        │ 6. Clients: reconcile with existing strokes by strokeId │
        │                                                         │
        │ 7. Cursor: mousemove → emitCursor(normalized x,y)       │
        │    Server: setCursor(), broadcast 'cursor'              │
        │    Others: draw cursor indicator on overlay canvas      │
        ▼                                                         │
┌─────────────────┐     rooms.js, drawing-state.js               │
│   Client B      │ ◄────────────────────────────────────────────┘
│   (same flow)  │     (conflict resolution by timestamps)
└─────────────────┘
```

### Drawing event flow (user → canvas)

1. **Input**: Mouse/touch on temp canvas → `evCanvas` normalizes `_x`, `_y` and calls `currentTool[ev.type](ev)`.
2. **Tool (canvas.js)**: On `mousedown`/`mousemove`/`mouseup`, draws to **temp** context (immediate visual feedback - client-side prediction). 
   - **Pencil/Eraser**: Accumulates segments in a batch buffer. Emits batched segments every 50ms or on `mouseup`.
   - **Shapes**: On `mouseup`, calls `onCommit(stroke)`.
3. **main.js `onCommit`**: 
   - **Client-side prediction**: Immediately `history.push(stroke)`, `redrawAll(history)` for instant feedback
   - Marks stroke as pending in `pendingStrokes` map
   - `CanvasModule.clearTemp()`, `WebSocketModule.emitDraw(stroke)`
4. **redrawAll**: Clears main, fills white, then for each `s` in `history` runs `drawOneStroke(mainCtx, s)` (no temp; this is the persistent layer).
5. **Server**: 
   - Validates and adds operation metadata (`operationId`, `timestamp`)
   - For pencil/eraser: merges segments if same `strokeId` exists (reconciliation)
   - `drawing-state.addStroke(stroke)`, broadcasts `'draw'` to all clients including sender
6. **Other clients**: 
   - `on('draw')` → checks if stroke exists by `strokeId`
   - If exists: updates existing stroke (may have merged segments)
   - If new: `history.push(stroke)`
   - `scheduleRedraw(history)`
7. **Sender client**: Receives confirmation, reconciles with pending stroke

All coordinates in strokes are **normalized** (0–1) so canvas size changes can be supported later.

---

## WebSocket Protocol

### Client → Server

| Event   | Payload                    | Description                                      |
|---------|----------------------------|--------------------------------------------------|
| `draw`  | `{ strokeId, type, data, userId? }` | Batched segments (pencil/eraser) or single stroke. `type`: pencil, erase, rect, line, circle, ellipse, text |
| `undo`  | `{ strokeId }`             | Remove all strokes with `strokeId` from history  |
| `redo`  | `{}`                       | Pop from redo stack and re-add to history        |
| `clear` | -                          | Clear history and redo stack                     |
| `cursor`| `{ x, y }` or `{ x: null, y: null }` | Cursor position (normalized 0–1) or "hide"   |
| `preview` | `{ type, data }`           | Live preview for shapes (rect, line, circle, ellipse) |

### Server → Client

| Event       | Payload                          | Description                                      |
|-------------|----------------------------------|--------------------------------------------------|
| `user:join` | `{ user, users, history }`       | On connect: self, full user list, full history   |
| `user:list` | `{ users }`                      | User list update (join/leave)                    |
| `user:left` | `{ userId }`                     | User disconnected                                |
| `draw`      | `{ strokeId, type, data, userId, timestamp, operationId }` | New stroke with metadata (from another user, redo, or confirmation) |
| `undo`      | `{ strokeId }`                   | Strokes with `strokeId` must be removed          |
| `clear`     | -                                | Clear local history and canvas                   |
| `cursor`    | `{ userId, x, y }`               | Other user's cursor (normalized)                 |
| `preview`   | `{ userId, type, data }`         | Live preview from another user                   |

### Stroke `data` shapes (normalized 0–1 where relevant)

- **pencil**: `{ segments: [[x0,y0,x1,y1],...], color, lineWidth }` (batched segments)
- **erase**: `{ segments: [[x0,y0,x1,y1],...], lineWidth }` (batched segments)
- **rect**: `{ min_x, min_y, abs_x, abs_y, color, lineWidth }`
- **line**: `{ x0, y0, x1, y1, color, lineWidth }`
- **circle**: `{ x1, y1, x2, y2, color, lineWidth }`
- **ellipse**: `{ x, y, w, h, color, lineWidth }`
- **text**: `{ fsize, ffamily, colorVal, textPosLeft, textPosTop, processed_linesArray }`

---

## Canvas Mastery: Path Optimization & Layer Management

### Path Optimization for Smooth Drawing

**Pencil/Eraser Batching Strategy:**
- Segments are accumulated in a buffer during drawing
- Batched segments are sent every **50ms** or immediately on `mouseup`
- Reduces network traffic from ~60 events/sec to ~20 events/sec
- Server merges segments with same `strokeId` if they arrive separately

**Benefits:**
- Lower network overhead
- Maintains real-time feel through client-side prediction
- Still responsive (50ms latency is imperceptible for drawing)

**Implementation:**
```javascript
// Client: Accumulate segments
_pendingSegments.push([x0, y0, x1, y1]);
// Flush every 50ms or on mouseup
setTimeout(() => emitBatchedSegments(), 50);

// Server: Merge segments
if (existing.strokeId === new.strokeId) {
  existing.data.segments = [...existing, ...new];
}
```

### Layer Management for Undo/Redo

**Three-layer architecture:**
1. **Main canvas** (persistent): Contains all committed strokes from `history`
2. **Temp canvas** (in-progress): Shows current drawing tool preview
3. **Preview overlay**: Shows other users' live shape previews
4. **Cursor overlay**: Shows other users' cursor positions

**Efficient Redrawing:**
- Always redraw from `history` (single source of truth)
- Use `requestAnimationFrame` coalescing for multiple updates in one frame
- Local strokes: immediate `redrawAll()` for instant feedback
- Remote strokes: `scheduleRedraw()` with rAF batching

### High-Frequency Mouse Event Handling

**Throttling:**
- `mousemove` events throttled to ~16ms (60fps)
- Cursor updates throttled separately to reduce network load

**Efficient Path Rendering:**
- Line segments drawn directly to canvas (no path accumulation)
- Uses canvas native line drawing (optimized by browser)
- Minimal memory allocation during drawing

---

## Real-time Architecture: Event Streaming & Latency Handling

### How Drawing Data is Serialized

**Normalized Coordinates:**
- All coordinates stored as 0–1 range (normalized to canvas size)
- Allows canvas resizing without data migration
- Reduces payload size (float precision sufficient)

**Segment Format:**
- `[x0, y0, x1, y1]` - line segment as 4 floats
- Compact representation (16 bytes per segment)
- Easy to merge and process

**Metadata:**
- `strokeId`: Unique identifier for logical stroke
- `timestamp`: Server-assigned timestamp for ordering
- `operationId`: Unique operation identifier for conflict resolution
- `userId`: User who created the stroke

### Batching vs. Individual Stroke Events

**Batching Strategy:**
- **Pencil/Eraser**: Batched segments (50ms window or max 10 segments)
- **Shapes**: Single event on `mouseup`
- **Preview**: Individual events (rate-limited to 60/sec)

**Why Batching:**
- Reduces network overhead by ~70% for continuous drawing
- Lower server load
- Still feels real-time due to client-side prediction

**Trade-offs:**
- Slight delay (50ms) for network transmission
- Mitigated by immediate local rendering

### Handling Network Latency

**Client-Side Prediction:**
- Strokes rendered immediately on local client
- Added to `history` before server confirmation
- Server confirmation updates existing stroke (may merge segments)
- If server rejects, stroke can be rolled back (currently not implemented, but infrastructure exists)

**Optimistic Updates:**
```javascript
// Immediate feedback
history.push(stroke);
redrawAll(history);

// Send to server
emitDraw(stroke);

// Reconcile on confirmation
on('draw', (confirmed) => {
  if (confirmed.strokeId === pending.strokeId) {
    updateExisting(confirmed);
  }
});
```

**Network Issues:**
- Offline drawing: strokes stored locally, synced on reconnect
- Reconnection: full `history` received from server, overwrites local
- Lost packets: handled by Socket.io's reliable transport

---

## State Synchronization: Global Undo/Redo & Conflict Resolution

### How Operation History is Maintained Across Users

**Server-Side State:**
- Single source of truth: `drawing-state.ts` per room
- `history[]`: Array of all strokes in order
- `redoStack[]`: Stack of undone stroke batches

**Operation Flow:**
1. User performs action → client sends to server
2. Server validates and assigns `operationId` + `timestamp`
3. Server updates state and broadcasts to all clients
4. All clients update local state from server event

### Conflict Resolution Strategy

**Last-Write-Wins with Timestamps:**
- Server assigns timestamp to each operation
- Concurrent operations ordered by server processing time
- Client-side prediction reconciled with server timestamp

**Undo Conflicts:**
- If User A undoes while User B is drawing:
  - Server processes operations in order (timestamp-based)
  - If stroke already removed by A, B's undo is ignored (no-op)
  - All clients receive same events in same order → consistent state

**Segment Merging (Pencil/Eraser):**
- Multiple batches from same `strokeId` merged on server
- Prevents duplicate strokes when client sends multiple batches
- Last batch's timestamp used for ordering

**Implementation:**
```typescript
// Server: Merge segments
if (stroke.type === 'pencil' || stroke.type === 'erase') {
  const existing = history.find(s => s.strokeId === stroke.strokeId);
  if (existing) {
    existing.data.segments = [...existing.data.segments, ...stroke.data.segments];
    existing.timestamp = stroke.timestamp;
    return existing; // Updated, not new
  }
}
```

### Maintaining Canvas State Consistency

**Consistency Guarantees:**
1. **Eventual Consistency**: All clients converge to same state after all events processed
2. **Causal Ordering**: Operations from same user processed in order
3. **Server Authority**: Server is final arbiter of state

**State Synchronization Points:**
- **On Join**: New client receives full `history` from server
- **On Reconnect**: Full `history` resync, overwrites local
- **During Operation**: Each operation broadcast to all clients

**Conflict Scenarios:**
1. **Simultaneous Undo**: Last undo wins (by server timestamp)
2. **Undo of Active Drawing**: Stroke removed immediately; user sees feedback
3. **Join During Draw**: New joiner sees all committed strokes, not in-progress previews

**Reconciliation Algorithm:**
```javascript
on('draw', (stroke) => {
  const existing = history.find(s => s.strokeId === stroke.strokeId);
  if (existing) {
    // Update existing (may have merged segments)
    history[index] = stroke;
  } else {
    // New stroke
    history.push(stroke);
  }
  redrawAll(history);
});
```

---

## Undo/Redo Strategy

- **Storage**: `drawing-state.js` keeps `history[]` and `redoStack[]` per room.
- **Undo**:
  - Client: "Undo" sends `undo(strokeId)` where `strokeId` is `history[history.length-1].strokeId` (the last logical stroke; pencils use one `strokeId` for many segments).
  - Server: `undo(strokeId)` removes **all** strokes with that `strokeId`, appends that batch to `redoStack`, broadcasts `{ strokeId }`.
  - All clients (including sender): `history = history.filter(s => s.strokeId !== strokeId)`, then `redrawAll(history)`, `clearTemp()`.
- **Redo**:
  - Client: "Redo" sends `redo`.
  - Server: `redo()` pops the last batch from `redoStack`, pushes each stroke back into `history`, emits `draw` for each.
  - Clients: each `draw` is applied with reconciliation (update existing or add new).
- **New draw**: Any new `draw` clears `redoStack` on the server.
- **Conflict (e.g. A undoes B's action)**: Undo is global; any user can undo any stroke. Server processes undo in order; if stroke already removed, operation is no-op. All clients receive same events → consistent state.

---

## Performance Decisions

1. **Path optimization (pencil/eraser)**  
   - Segments batched every 50ms or on `mouseup` to reduce network traffic by ~70%
   - Server merges segments with same `strokeId` for consistency
   - Immediate local rendering (client-side prediction) maintains responsiveness

2. **Shape preview (rect, line, circle, ellipse)**  
   - During `mousemove` the tool calls `onPreview({ type, data })`, which emits `preview` to the server. Others receive `preview` and draw it on a **preview overlay** (between main and cursor). When the final `draw` arrives, we remove that user's preview and the stroke appears in `history`/main. On `user:left` or `clear`, we drop previews. Server rate-limits `preview` at 60/sec per socket.

3. **Redraw strategy**  
   - Persistent layer: **main** canvas only. We do not draw directly to main; we always `redrawAll(history)`.  
   - In-progress: **temp** canvas; cleared on commit or tool change.  
   - Client-side prediction: strokes added to `history` immediately, then reconciled with server
   - This keeps a single source of truth (`history`) and makes undo/redo and join-state simple.

4. **Batching / throttling**  
   - `mousemove` is throttled (~16 ms) to limit events.  
   - Pencil/eraser segments batched every 50ms
   - Cursor updates throttled separately
   - **Server rate limit**: max 80 `draw` events per second per socket to handle high activity and abuse.

5. **Redraw coalescing (smoothness under load)**  
   - Remote `draw`/`undo`/`user:join` use `scheduleRedraw(history)` which coalesces with `requestAnimationFrame`. Multiple updates in one frame cause a single redraw.  
   - Local `onCommit` uses immediate `redrawAll` so the user sees their stroke without one-frame delay.

6. **Cursor**  
   - Sent as normalized (0–1) so all clients can map to their main canvas size.  
   - Dedicated overlay canvas, `pointer-events: none`, redrawn on each `cursor` event.

7. **Libraries**  
   - No drawing libraries; only raw Canvas 2D API.  
   - Socket.io for transport; could be swapped for native WebSockets with an adapter.

---

## Conflict Resolution

- **Overlapping draws**: No pixel-level locking. Strokes are appended in server order (by timestamp). Last draw in a region simply draws on top (canvas composite and order in `history`). This is "last write wins" by stroke order.
- **Simultaneous undo**: Two users undoing at once both send `undo(strokeId)`. The server processes one at a time (by timestamp). The second may find no matching `strokeId` (already removed) and does nothing; no broadcast. Clients stay consistent with server.
- **Join during draw**: New joiner receives full `history` in `user:join` and replaces local `history`, then `scheduleRedraw`. They see a consistent snapshot. In-progress previews are not included in history.
- **Segment merging conflicts**: If client sends multiple batches with same `strokeId`, server merges them. Last batch's timestamp used for ordering.
- **Undo of active drawing**: If user undoes a stroke while another user is drawing it (pencil segments still arriving), all segments with that `strokeId` are removed immediately, including future ones.

---

## Error Handling and Network Issues

- **Server**: All socket handlers (`draw`, `undo`, `redo`, `clear`, `cursor`, `disconnect`) are wrapped in try-catch; errors are logged and do not crash the process. `validateStroke` rejects malformed payloads; invalid `undo` payloads are ignored. Rate limiting drops excess `draw` events.
- **Client**: `draw`/`undo`/`clear`/`user:join`/`user:list`/`user:left`/`cursor` handlers are wrapped in try-catch. Incoming `draw` is checked with `isValidStroke` before processing. Client-side prediction allows offline drawing (strokes stored locally, overwritten on reconnect with server state).
- **Reconnection**: Socket.io `reconnection: true` with limited attempts. UI shows `connectionStatus` (Connected / Reconnecting… / Disconnected / Connection error). On reconnect, the client gets a new socket and `user:join` with full `history` resyncs state (overwrites local).

---

## File Roles

- **client/canvas.js**: Drawing only. `init`, `redrawAll`, `scheduleRedraw` (rAF coalescing), `clearTemp`, `clearAll`, `setConfig`, `getTools`. Tools implement batching for pencil/eraser. Tools call `onCommit(stroke)`. No IO.
- **client/websocket.js**: Socket.io connect, `emitDraw`/`emitUndo`/`emitRedo`/`emitClear`/`emitCursor`, `isValidStroke`, `on('draw'|'undo'|'clear'|'user:join'|'user:list'|'user:left'|'cursor'|'connectionStatus')`. No canvas.
- **client/main.js**: Wires canvas and websocket, keeps `history`, implements `onCommit` with client-side prediction, tracks `pendingStrokes`, reconciles strokes on server confirmation, handles all socket events with validation and try-catch, connection-status UI, tool buttons and config.
- **server/server.ts**: Express static (client/), Socket.io, `validateStroke`, rate limiting, operation ID assignment, try-catch in all handlers. Serves `dist`-agnostic; static path `../client`.
- **server/rooms.ts**: Room map, `addUser`/`removeUser`/`getUsers`/`setCursor`, `getDrawingState(roomId)`. TypeScript.
- **server/drawing-state.ts**: `history`, `redoStack`, `addStroke` (with segment merging), `undo(strokeId)`, `redo()`, `clear()`, `getHistory()`. TypeScript; validates in `addStroke`.
