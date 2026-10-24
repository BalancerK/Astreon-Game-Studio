// The arena as a room module: what `RoomManager` loads into a worker thread (or runs inline).
// Exports the contract `createRoom(options) -> { attach(transport), close(), stats(), control(data) }`.
import { startArenaServer } from './arena-server.js';

/** @param {object} [options] Same options as startArenaServer (sockets are handled by the gateway, never by the room). */
export async function createRoom(options = {}) {
  const server = await startArenaServer({ ...options, listen: false, serveStatic: false, manualTicks: false });
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
        snapshotBytes: s.snapshotBytes,
      };
    },
    /** Test hooks, sent by the gateway with `handle.control(...)`. */
    control: (m) => {
      if (m.stall) server.stallNextTick(m.stall);
      if (m.crash) setImmediate(() => { throw new Error('room crash requested by test'); });
    },
  };
}
