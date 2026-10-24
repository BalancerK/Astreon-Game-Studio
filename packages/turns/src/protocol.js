// The messages between a turn-based room and its players: small JSON objects, one per frame. Moves go up; views and events come down.
//
//   client -> room:  { t: 'hello', token, name? }   { t: 'move', id, move, arg? }   { t: 'rematch' }   { t: 'ping', n }   { t: 'leave' }
//   room -> client:  { t: 'welcome', ... }  { t: 'players', players }  { t: 'start', ... }  { t: 'update', ... }  { t: 'reject', id, error }  { t: 'pong', n }  { t: 'bye', reason }
//     welcome / start: { you, room, phase, seq, players, view, current, legal, over, turnLeftMs }
//     update:          { seq, by, move, ack?, events, view, current, legal, over, turnLeftMs, auto? }   (`ack`: the id of your own move)

const enc = new TextEncoder(), dec = new TextDecoder();

/** A message as bytes for the wire. */
export function encode(msg) { return enc.encode(JSON.stringify(msg)); }

/** The largest message a room accepts from a player. */
export const MAX_CLIENT_MESSAGE = 4096;

/**
 * Read a message from a player, with checks: a bad one is `null`, never an exception.
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {{t: 'hello', token: string, name?: string} | {t: 'move', id: number, move: string, arg?: any} | {t: 'rematch'} | {t: 'ping', n: number} | {t: 'leave'} | null}
 */
export function parseClientMessage(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length === 0 || u8.length > MAX_CLIENT_MESSAGE) return null;
  let m;
  try { m = JSON.parse(dec.decode(u8)); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'hello': return typeof m.token === 'string' && m.token.length <= 1500 && (m.name === undefined || (typeof m.name === 'string' && m.name.length <= 40)) ? { t: 'hello', token: m.token, ...(m.name !== undefined ? { name: m.name } : {}) } : null;
    case 'move': return Number.isSafeInteger(m.id) && typeof m.move === 'string' && m.move.length <= 40 ? { t: 'move', id: m.id, move: m.move, ...(m.arg !== undefined ? { arg: m.arg } : {}) } : null;
    case 'ping': return Number.isFinite(m.n) ? { t: 'ping', n: m.n } : null;
    case 'rematch': case 'leave': return { t: m.t };
    default: return null;
  }
}

/** Read a message from the room. @param {Uint8Array | ArrayBuffer | string} data @returns {any | null} */
export function parseServerMessage(data) {
  try { const m = JSON.parse(typeof data === 'string' ? data : dec.decode(data instanceof Uint8Array ? data : new Uint8Array(data))); return m && typeof m === 'object' && typeof m.t === 'string' ? m : null; } catch { return null; }
}
