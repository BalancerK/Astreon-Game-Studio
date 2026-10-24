import { ProtocolError } from './binary.js';

/** Bump when the wire format changes incompatibly. Checked in the handshake. */
export const PROTOCOL_VERSION = 1;

/** First byte of every packet. */
export const MSG = Object.freeze({ HELLO: 1, WELCOME: 2, REJECT: 3, INPUT: 4, SNAPSHOT: 5, EVENT: 6 });

/** Reasons a server refuses a connection: `VERSION_MISMATCH`, `SCHEMA_MISMATCH`, `SERVER_FULL`, `BAD_REQUEST`, … */
export const REJECT = Object.freeze({ VERSION_MISMATCH: 1, SCHEMA_MISMATCH: 2, SERVER_FULL: 3, BAD_REQUEST: 4, PLUGIN_MISMATCH: 5 });

const MAX_PLUGINS = 64;
/** The most inputs one packet may carry (older unacknowledged ones are resent with newer ones). */
export const MAX_INPUTS_PER_PACKET = 16;

/**
 * @param {import('./binary.js').BinaryReader} r
 * @param {number} expected
 */
function expectType(r, expected) {
  const t = r.u8();
  if (t !== expected) throw new ProtocolError(`expected message ${expected}, got ${t}`);
}

/**
 * Client -> server. `schemaHash` and `inputHash` pin the replicated-state and input layouts.
 * @param {import('./binary.js').BinaryWriter} w
 * @param {{schemaHash: number, inputHash: number, token?: string}} m
 */
export function encodeHello(w, m) {
  w.u8(MSG.HELLO);
  w.u16(PROTOCOL_VERSION);
  w.u32(m.schemaHash);
  w.u32(m.inputHash);
  w.string(m.token ?? '');
}

/**
 * Read the first message a client sends: protocol version, the hashes of the schemas it was built with, and an optional token.
 *
 * @param {import('./binary.js').BinaryReader} r
 */
export function decodeHello(r) {
  expectType(r, MSG.HELLO);
  return { version: r.u16(), schemaHash: r.u32(), inputHash: r.u32(), token: r.string(512) };
}

/**
 * Server -> client. Lists the plugins (id, version, content hash) the client must load.
 * @param {import('./binary.js').BinaryWriter} w
 * `session` is an unguessable token the client presents in HELLO (`token`) to resume this player after a disconnect;
 * `resumed` says the server honoured such a token (same player, same state) rather than starting a new one.
 * @param {{clientId: number, tickRate: number, serverTick: number, plugins?: {id: string, version: string, hash: string}[], session?: string, resumed?: boolean}} m
 */
export function encodeWelcome(w, m) {
  w.u8(MSG.WELCOME);
  w.u16(PROTOCOL_VERSION);
  w.u32(m.clientId);
  w.u16(m.tickRate);
  w.varuint(m.serverTick);
  const plugins = m.plugins ?? [];
  w.varuint(plugins.length);
  for (const p of plugins) { w.string(p.id); w.string(p.version); w.string(p.hash); }
  w.u8(m.resumed ? 1 : 0);
  w.string(m.session ?? '');
}

/**
 * Read the server's answer to a hello: the client id, tick rate, current tick and what to expect.
 *
 * @param {import('./binary.js').BinaryReader} r
 */
export function decodeWelcome(r) {
  expectType(r, MSG.WELCOME);
  const version = r.u16(), clientId = r.u32(), tickRate = r.u16(), serverTick = r.varuint();
  const n = r.varuint();
  if (n > MAX_PLUGINS) throw new ProtocolError('too many plugins');
  const plugins = [];
  for (let i = 0; i < n; i++) plugins.push({ id: r.string(64), version: r.string(32), hash: r.string(64) });
  const resumed = r.u8() === 1;
  const session = r.string(128);
  return { version, clientId, tickRate, serverTick, plugins, resumed, session };
}

/**
 * Write a rejection (a reason code and a short message) into `w`.
 *
 * @param {import('./binary.js').BinaryWriter} w
 * @param {number} reason One of REJECT.
 * @param {string} [message]
 */
export function encodeReject(w, reason, message = '') {
  w.u8(MSG.REJECT);
  w.u8(reason);
  w.string(message);
}

/**
 * Read a rejection: the reason code and a message.
 *
 * @param {import('./binary.js').BinaryReader} r
 */
export function decodeReject(r) {
  expectType(r, MSG.REJECT);
  return { reason: r.u8(), message: r.string(256) };
}

/**
 * Layout of one input sample. Fields are codecs, same idea as replicated state.
 * Example: `{ buttons: u16, moveX: q(-1, 1, 8), aim: q(0, 6.2832, 16) }`.
 */
export class InputSchema {
  /** @param {Record<string, import('./codecs.js').Codec>} fields */
  constructor(fields) {
    this.names = Object.keys(fields);
    this.codecs = this.names.map((n) => fields[n]);
    this.hash = 0;
    let h = 0x811c9dc5;
    const desc = this.names.map((n, i) => `${n}:${this.codecs[i].name}`).join(',');
    for (let i = 0; i < desc.length; i++) h = Math.imul(h ^ desc.charCodeAt(i), 0x01000193);
    this.hash = h >>> 0;
  }
}

/**
 * Reusable input packet: the newest `count` inputs (resent redundantly to
 * survive loss) plus the newest snapshot tick the client has received, which
 * the server uses as the delta baseline. Values are natural (dequantized).
 */
export class InputBatch {
  /** @param {InputSchema} schema */
  constructor(schema) {
    this.schema = schema;
    this.ackTick = 0;
    this.firstSeq = 0;
    this.count = 0;
    this.subTicks = new Uint8Array(MAX_INPUTS_PER_PACKET);
    this.values = new Float64Array(MAX_INPUTS_PER_PACKET * schema.names.length);
  }

  clear() { this.count = 0; }

  /**
   * Append the next input (sequence = firstSeq + count).
   * @param {number} subTick 0-255: where within its tick the input was sampled.
   * @param {ArrayLike<number>} values One per schema field, in schema order.
   */
  push(subTick, values) {
    if (this.count >= MAX_INPUTS_PER_PACKET) throw new RangeError('too many inputs in one packet');
    const n = this.schema.names.length;
    this.subTicks[this.count] = subTick;
    for (let i = 0; i < n; i++) this.values[this.count * n + i] = values[i];
    this.count++;
  }
}

/**
 * Write a batch of inputs (the newest few, so a lost packet costs nothing) into `w`.
 *
 * @param {import('./binary.js').BinaryWriter} w
 * @param {InputBatch} b
 */
export function encodeInput(w, b) {
  const { codecs } = b.schema;
  const n = codecs.length;
  w.u8(MSG.INPUT);
  w.varuint(b.ackTick);
  w.varuint(b.firstSeq);
  w.u8(b.count);
  for (let k = 0; k < b.count; k++) {
    w.u8(b.subTicks[k]);
    for (let i = 0; i < n; i++) codecs[i].write(w, codecs[i].quantize(b.values[k * n + i]));
  }
}

/**
 * Read a batch of inputs into `out` (whose schema says what a record holds). Returns `out`.
 *
 * @param {import('./binary.js').BinaryReader} r
 * @param {InputBatch} out
 * @returns {InputBatch} `out`
 */
export function decodeInput(r, out) {
  expectType(r, MSG.INPUT);
  const { codecs } = out.schema;
  const n = codecs.length;
  out.ackTick = r.varuint();
  out.firstSeq = r.varuint();
  const count = r.u8();
  if (count > MAX_INPUTS_PER_PACKET) throw new ProtocolError('too many inputs');
  for (let k = 0; k < count; k++) {
    out.subTicks[k] = r.u8();
    for (let i = 0; i < n; i++) out.values[k * n + i] = codecs[i].dequantize(codecs[i].read(r));
  }
  out.count = count;
  return out;
}

/** Peek at a packet's type without consuming it. @param {Uint8Array} bytes */
export function packetType(bytes) {
  if (bytes.length === 0) throw new ProtocolError('empty packet');
  return bytes[0];
}

/**
 * SNAPSHOT packet layout: `[MSG.SNAPSHOT][varuint inputAck][SnapshotCodec payload]`.
 * `inputAck` is the newest input sequence number the server has applied for this
 * client, which lets the client drop acknowledged inputs and reconcile its prediction.
 * @param {import('./binary.js').BinaryWriter} w
 * @param {number} inputAck
 */
export function writeSnapshotHeader(w, inputAck) {
  w.u8(MSG.SNAPSHOT);
  w.varuint(inputAck);
}

/**
 * Read the start of a snapshot message and return `inputAck`: the last input sequence number the server applied for this client.
 *
 * @param {import('./binary.js').BinaryReader} r
 * @returns {number} inputAck
 */
export function readSnapshotHeader(r) {
  expectType(r, MSG.SNAPSHOT);
  return r.varuint();
}
