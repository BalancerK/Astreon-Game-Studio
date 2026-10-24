// The 3D arena as a room module: what `RoomManager` loads into a worker thread, a process, or runs inline.
// Exports the contract `createRoom(options) -> { attach(transport), close(), stats(), control(data) }`.
import { startArena3dServer } from './arena3d-server.js';

/** @param {object} [options] Same options as startArena3dServer (sockets are handled by the gateway, never by the room). */
export async function createRoom(options = {}) {
  const server = await startArena3dServer({ ...options, listen: false, serveStatic: false, manualTicks: false });
  return {
    attach: server.attach,
    close: () => server.close(),
    stats: () => {
      const s = server.stats;
      return {
        players: [...server.clients].filter((c) => c.ready).length,
        tick: server.tick,
        tickMsAvg: s.ticks ? s.tickMsTotal / s.ticks : 0,
        tickMsMax: s.tickMsMax,
        shots: s.shots,
        hits: s.hits,
        kills: s.kills,
        resumed: s.resumed,
        snapshotBytes: s.snapshotBytes,
      };
    },
    /** Test hook, sent by the gateway with `handle.control(...)`. */
    control: (m) => {
      if (m.crash) setImmediate(() => { throw new Error('room crash requested by test'); });
    },
  };
}
