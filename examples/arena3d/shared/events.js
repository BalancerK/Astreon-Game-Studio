// Game events sent by the server inside the generic MSG.EVENT packet: [MSG.EVENT][u8 kind][payload].
import { BinaryReader, MSG, ProtocolError } from '../../../packages/protocol/src/index.js';

export const EVENT = Object.freeze({ SHOT: 1, MESSAGE: 2 });

/**
 * A shot fired: where the ray started and ended, and who (if anyone) it hit.
 * @param {import('../../../packages/protocol/src/index.js').BinaryWriter} w
 * @param {{shooter: number, hit: number, seq?: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number}} s
 *   `hit` = -1 for a miss; `seq` is the shooter's input that fired (lets that client match the event to the shot it predicted).
 */
export function encodeShot(w, s) {
  w.u8(MSG.EVENT);
  w.u8(EVENT.SHOT);
  w.varuint(s.shooter);
  w.varuint(s.hit + 1);
  w.varuint(s.seq ?? 0);
  w.f32(s.x0); w.f32(s.y0); w.f32(s.z0); w.f32(s.x1); w.f32(s.y1); w.f32(s.z1);
}

/** A text message from the server shown to players. @param {{text: string}} m */
export function encodeMessage(w, m) {
  w.u8(MSG.EVENT);
  w.u8(EVENT.MESSAGE);
  w.string(m.text);
}

/**
 * @param {Uint8Array} bytes A full MSG.EVENT packet.
 * @returns {{kind: 1, shooter: number, hit: number, seq: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number} | {kind: 2, text: string}}
 */
export function decodeEvent(bytes) {
  const r = new BinaryReader(bytes);
  if (r.u8() !== MSG.EVENT) throw new ProtocolError('not an event packet');
  const kind = r.u8();
  if (kind === EVENT.MESSAGE) return { kind, text: r.string(120) };
  if (kind !== EVENT.SHOT) throw new ProtocolError(`unknown event kind ${kind}`);
  return { kind, shooter: r.varuint(), hit: r.varuint() - 1, seq: r.varuint(), x0: r.f32(), y0: r.f32(), z0: r.f32(), x1: r.f32(), y1: r.f32(), z1: r.f32() };
}
