/**
 * Manages canvas state for a room: stroke history and undo/redo stacks.
 * Used for global undo/redo across all users.
 * Conflict resolution: operation timestamps and last-write-wins per stroke order;
 * undo applies to the most recent logical stroke (by strokeId) in history.
 */

export interface Stroke {
  strokeId: string;
  type: string;
  data: Record<string, unknown>;
  userId?: string;
  timestamp?: number;
  operationId?: string;
}

export interface DrawingStateApi {
  addStroke(stroke: Stroke): Stroke | null;
  undo(strokeId: string): string | null;
  redo(): { strokes: Stroke[] } | null;
  clear(): void;
  getHistory(): Stroke[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function createDrawingState(): DrawingStateApi {
  const history: Stroke[] = [];
  const redoStack: Stroke[][] = [];

  return {
    addStroke(stroke: Stroke): Stroke | null {
      if (!stroke || typeof stroke.strokeId !== 'string' || !stroke.type || !stroke.data) {
        return null;
      }
      
      // Add timestamp if not present
      if (!stroke.timestamp) {
        stroke.timestamp = Date.now();
      }
      
      // For pencil/eraser, merge segments if same strokeId exists
      if ((stroke.type === 'pencil' || stroke.type === 'erase') && stroke.data.segments) {
        const existingIndex = history.findIndex(s => s.strokeId === stroke.strokeId);
        if (existingIndex !== -1) {
          // Merge segments with existing stroke (client-side prediction reconciliation)
          const existing = history[existingIndex];
          const existingSegs = (existing.data.segments as number[][]) || [];
          const newSegs = (stroke.data.segments as number[][]) || [];
          existing.data.segments = [...existingSegs, ...newSegs];
          existing.timestamp = stroke.timestamp; // Update timestamp
          return existing;
        }
      }
      
      history.push(stroke);
      redoStack.length = 0;
      return stroke;
    },

    undo(strokeId: string): string | null {
      if (typeof strokeId !== 'string') return null;
      const toRemove = history.filter((s) => s.strokeId === strokeId);
      if (toRemove.length === 0) return null;
      for (const s of toRemove) {
        const i = history.indexOf(s);
        if (i !== -1) history.splice(i, 1);
      }
      redoStack.push(toRemove);
      return strokeId;
    },

    redo(): { strokes: Stroke[] } | null {
      const batch = redoStack.pop();
      if (!batch || batch.length === 0) return null;
      const list = Array.isArray(batch) ? batch : [batch];
      for (const s of list) history.push(s);
      return { strokes: list };
    },

    clear(): void {
      history.length = 0;
      redoStack.length = 0;
    },

    getHistory(): Stroke[] {
      return history.slice();
    },

    get canUndo(): boolean {
      return history.length > 0;
    },

    get canRedo(): boolean {
      return redoStack.length > 0;
    },
  };
}
