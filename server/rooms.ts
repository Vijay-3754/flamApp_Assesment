/**
 * Room management: users and drawing state per room.
 * Assigns unique colors to users for cursor and list display.
 */

import { createDrawingState, type DrawingStateApi } from './drawing-state';

const USER_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
  '#dcbeff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
];

export interface RoomUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}

export interface UserInfo {
  id: string;
  name: string;
  color: string;
}

interface Room {
  users: Map<string, RoomUser>;
  drawingState: DrawingStateApi;
}

const rooms = new Map<string, Room>();

export function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      users: new Map(),
      drawingState: createDrawingState(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

export function addUser(roomId: string, socketId: string, userName?: string): RoomUser {
  const room = getOrCreateRoom(roomId);
  const existingColors = [...room.users.values()].map((u) => u.color);
  const color = USER_COLORS.find((c) => !existingColors.includes(c)) ?? USER_COLORS[0];
  const user: RoomUser = {
    id: socketId,
    name: userName ?? `User ${room.users.size + 1}`,
    color,
    cursor: null,
  };
  room.users.set(socketId, user);
  return user;
}

export function removeUser(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.users.delete(socketId);
  if (room.users.size === 0) {
    rooms.delete(roomId);
  }
}

export function getUser(roomId: string, socketId: string): RoomUser | undefined {
  return rooms.get(roomId)?.users.get(socketId);
}

export function getUsers(roomId: string): UserInfo[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.users.entries()].map(([id, u]) => ({
    id,
    name: u.name,
    color: u.color,
  }));
}

export function setCursor(roomId: string, socketId: string, x: number | null, y: number | null): void {
  const user = getUser(roomId, socketId);
  if (user) {
    user.cursor = x != null && y != null ? { x, y } : null;
  }
}

export function getDrawingState(roomId: string): DrawingStateApi {
  return getOrCreateRoom(roomId).drawingState;
}
