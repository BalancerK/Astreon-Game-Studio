// RFC 6455 framing for a binary-only game transport. Node only (uses Buffer).
import { randomBytes } from 'node:crypto';

/** WebSocket frame opcodes (RFC 6455): continuation, text, binary, close, ping, pong. */
export const OP = Object.freeze({ CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa });

/** A protocol violation; `code` is the close code to send to the peer. */
export class WsError extends Error {
  /** @param {number} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'WsError';
    this.code = code;
  }
}

/**
 * Build one unfragmented frame. If `prefix >= 0` it is written as the first
 * payload byte (used for the channel tag) so no extra copy of `payload` is needed.
 *
 * @param {number} opcode
 * @param {Uint8Array} payload
 * @param {number} [prefix]
 * @param {boolean} [mask] Client frames must be masked.
 * @returns {Buffer}
 */
export function encodeFrame(opcode, payload, prefix = -1, mask = false) {
  const len = payload.length + (prefix >= 0 ? 1 : 0);
  const headerLen = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const buf = Buffer.allocUnsafe(headerLen + (mask ? 4 : 0) + len);
  buf[0] = 0x80 | opcode;
  if (len < 126) buf[1] = len;
  else if (len < 65536) { buf[1] = 126; buf.writeUInt16BE(len, 2); }
  else { buf[1] = 127; buf.writeUInt32BE(0, 2); buf.writeUInt32BE(len, 6); }
  let o = headerLen;
  let key = null;
  if (mask) {
    buf[1] |= 0x80;
    key = randomBytes(4);
    key.copy(buf, o);
    o += 4;
  }
  const start = o;
  if (prefix >= 0) buf[o++] = prefix;
  buf.set(payload, o);
  if (key) for (let i = start; i < buf.length; i++) buf[i] ^= key[(i - start) & 3];
  return buf;
}

/** Close frame payload: 2-byte code + UTF-8 reason truncated to the 123 bytes allowed. */
export function encodeClose(code, reason = '') {
  let r = Buffer.from(reason, 'utf8');
  if (r.length > 123) {
    let end = 123;
    while (end > 0 && (r[end] & 0xc0) === 0x80) end--; // do not cut a UTF-8 sequence in half
    r = r.subarray(0, end);
  }
  const p = Buffer.allocUnsafe(2 + r.length);
  p.writeUInt16BE(code, 0);
  r.copy(p, 2);
  return p;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function validCloseCode(c) {
  return (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) || (c >= 3000 && c <= 4999);
}

/**
 * Incremental frame parser and message assembler. Feed it socket chunks with
 * `push`; it calls back with complete binary messages and control frames, and
 * throws `WsError` on any violation (the caller closes with `err.code`).
 *
 * Text frames are rejected (1003): this transport is binary only. Extensions
 * (RSV bits) are never negotiated, so any RSV bit is a violation.
 */
export class FrameParser {
  /**
   * @param {object} o
   * @param {boolean} o.expectMasked True on the server (clients must mask).
   * @param {number} o.maxMessageSize Largest accepted frame / assembled message.
   * @param {(payload: Buffer) => void} o.onMessage
   * @param {(payload: Buffer) => void} [o.onPing]
   * @param {(payload: Buffer) => void} [o.onPong]
   * @param {(code: number, reason: string) => void} [o.onClose]
   */
  constructor({ expectMasked, maxMessageSize, onMessage, onPing, onPong, onClose }) {
    this.expectMasked = expectMasked;
    this.max = maxMessageSize;
    this.onMessage = onMessage;
    this.onPing = onPing ?? (() => {});
    this.onPong = onPong ?? (() => {});
    this.onClose = onClose ?? (() => {});
    /** @type {Buffer | null} */
    this.pending = null;
    /** @type {Buffer[]} */
    this.fragments = [];
    this.fragLen = 0;
    this.inFragmented = false;
    this.dead = false;
  }

  /** Bytes buffered waiting for the rest of a frame. */
  get buffered() { return this.pending ? this.pending.length : 0; }

  /** @param {Buffer} chunk */
  push(chunk) {
    if (this.dead) return;
    try {
      this.pending = this.pending ? Buffer.concat([this.pending, chunk]) : chunk;
      let buf = this.pending;
      let off = 0;
      for (;;) {
        const used = this.#parseOne(buf, off);
        if (used === 0) break;
        off += used;
      }
      this.pending = off >= buf.length ? null : buf.subarray(off);
    } catch (e) {
      this.dead = true;
      this.pending = null;
      throw e;
    }
  }

  /** @returns {number} Bytes consumed, or 0 if the frame is incomplete. */
  #parseOne(buf, off) {
    const avail = buf.length - off;
    if (avail < 2) return 0;
    const b0 = buf[off], b1 = buf[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    if ((b0 & 0x70) !== 0) throw new WsError(1002, 'RSV bits set without a negotiated extension');
    const isControl = opcode >= 0x8;
    if (isControl ? opcode > 0xa : opcode > 0x2) throw new WsError(1002, `reserved opcode ${opcode}`);
    if (isControl && (!fin || len > 125)) throw new WsError(1002, 'invalid control frame');
    if (masked !== this.expectMasked) throw new WsError(1002, masked ? 'unexpected masked frame' : 'client frames must be masked');

    let o = off + 2;
    if (len === 126) {
      if (avail < 4) return 0;
      len = buf.readUInt16BE(o); o += 2;
    } else if (len === 127) {
      if (avail < 10) return 0;
      const hi = buf.readUInt32BE(o);
      if (hi !== 0) throw new WsError(1009, 'frame too large');
      len = buf.readUInt32BE(o + 4); o += 8;
    }
    if (len > this.max) throw new WsError(1009, 'frame too large');
    const keyAt = o;
    if (masked) o += 4;
    if (buf.length - o < len) return 0;

    // Complete frame: copy out the payload (unmasking on the way).
    const payload = Buffer.allocUnsafe(len);
    if (masked) {
      for (let i = 0; i < len; i++) payload[i] = buf[o + i] ^ buf[keyAt + (i & 3)];
    } else {
      buf.copy(payload, 0, o, o + len);
    }
    this.#frame(opcode, fin, payload);
    return o + len - off;
  }

  #frame(opcode, fin, payload) {
    switch (opcode) {
      case OP.TEXT:
        throw new WsError(1003, 'text frames are not supported');
      case OP.BINARY:
        if (this.inFragmented) throw new WsError(1002, 'new message while a fragmented message is in progress');
        if (fin) { this.onMessage(payload); return; }
        this.inFragmented = true;
        this.fragments = [payload];
        this.fragLen = payload.length;
        return;
      case OP.CONT: {
        if (!this.inFragmented) throw new WsError(1002, 'continuation frame without a message');
        this.fragLen += payload.length;
        if (this.fragLen > this.max) throw new WsError(1009, 'message too large');
        this.fragments.push(payload);
        if (fin) {
          const whole = Buffer.concat(this.fragments, this.fragLen);
          this.inFragmented = false;
          this.fragments = [];
          this.fragLen = 0;
          this.onMessage(whole);
        }
        return;
      }
      case OP.PING: this.onPing(payload); return;
      case OP.PONG: this.onPong(payload); return;
      case OP.CLOSE: {
        if (payload.length === 0) { this.onClose(1005, ''); return; }
        if (payload.length === 1) throw new WsError(1002, 'close frame with 1-byte payload');
        const code = payload.readUInt16BE(0);
        if (!validCloseCode(code)) throw new WsError(1002, `invalid close code ${code}`);
        let reason = '';
        try { reason = utf8.decode(payload.subarray(2)); } catch { throw new WsError(1007, 'close reason is not valid UTF-8'); }
        this.onClose(code, reason);
        return;
      }
      default:
        throw new WsError(1002, `reserved opcode ${opcode}`);
    }
  }
}
