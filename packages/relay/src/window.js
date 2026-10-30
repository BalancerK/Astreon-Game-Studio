// How far behind real time a server plays a match, so that commands that are a little late still arrive in time: the "window", in frames. It starts at WINDOW, grows quickly to what the worst connection in
// the room needs (never beyond MAX_WINDOW) and comes down slowly. A client delays its own commands by the same reasoning (see `OnlineRollback`).

/** The usual window, in frames. */
export const WINDOW = 6;
/** The most frames the window grows to. */
export const MAX_WINDOW = 20;
/** The length of a frame in milliseconds (60 a second). */
export const TICK_MS = 1000 / 60;

/**
 * The window the connections in a room need: half the round trip and twice its jitter, in frames, and 3 more.
 * @param {Array<{rtt?: number, jitter?: number} | null | undefined>} connections the players' links (a link with no `rtt` yet, or none, counts for nothing)
 * @param {{base?: number, max?: number, tickMs?: number}} [o]
 */
export function neededWindow(connections, { base = WINDOW, max = MAX_WINDOW, tickMs = TICK_MS } = {}) {
  let need = base;
  for (const c of connections) if (c?.rtt) need = Math.max(need, Math.ceil((c.rtt / 2 + 2 * (c.jitter ?? 0)) / tickMs + 3));
  return Math.min(max, need);
}

/**
 * One look at the window: up at once (by 3 frames a time) when more is needed, down by 1 frame at most every 2 seconds when less is.
 * @param {{window?: number, downAt?: number}} room the room's state, `window` (default WINDOW) and `downAt` (when it last came down): both are updated @param {number} need from `neededWindow` @param {number} now milliseconds
 * @returns {number} the window now
 */
export function stepWindow(room, need, now) {
  const w = room.window ?? WINDOW;
  if (need > w) room.window = Math.min(need, w + 3);
  else if (need < w && now - (room.downAt ?? 0) > 2000) { room.window = w - 1; room.downAt = now; }
  else room.window = w;
  return room.window;
}
