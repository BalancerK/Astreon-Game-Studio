// Crazy Eights as a room: what the server's `RoomManager` loads (in a worker thread or a process of its own) for every table.
import { turnRoom } from '../../../packages/turns/src/node.js';
import { crazyEights } from './rules.js';

export const createRoom = turnRoom(crazyEights, { thinkMs: [800, 1600], graceMs: 8000, lingerMs: 45_000 });
