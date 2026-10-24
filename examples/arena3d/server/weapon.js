// Server-side helper for lag compensation. The geometry of the shot itself is shared with the client (shared/shot.js).

/**
 * Where a view tick claimed by a client lands in server time. Clients send the tick they were looking at in quarter ticks
 * modulo 65536 (about 4.5 minutes); pick the matching value nearest to now, then clamp to the allowed rewind window so a
 * laggy or dishonest client can only go back so far.
 *
 * @param {number} view4 Claimed view tick x 4, modulo 65536. 0 means "no information".
 * @param {number} nowTick Current server tick
 * @param {number} maxRewindTicks
 * @returns {number} Tick to judge the shot at (fractional), never in the future.
 */
export function resolveViewTick(view4, nowTick, maxRewindTicks) {
  if (view4 === 0) return nowTick;
  const k = Math.round((nowTick * 4 - view4) / 65536);
  const v = (view4 + k * 65536) / 4;
  return Math.min(nowTick, Math.max(nowTick - maxRewindTicks, v));
}
