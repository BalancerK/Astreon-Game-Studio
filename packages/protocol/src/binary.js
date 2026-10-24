/** Thrown for any malformed, truncated or out-of-range wire data. Never trust the network. */
export class ProtocolError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Little-endian binary writer over a growable buffer. `finish()` returns a view, not a copy. */
export class BinaryWriter {
  /** @param {number} [capacity] */
  constructor(capacity = 1024) {
    this.bytes = new Uint8Array(capacity);
    this.view = new DataView(this.bytes.buffer);
    this.pos = 0;
  }

  reset() { this.pos = 0; }

  /** @returns {Uint8Array} View of the written bytes (valid until the next write/reset). */
  finish() { return this.bytes.subarray(0, this.pos); }

  #ensure(n) {
    if (this.pos + n <= this.bytes.length) return;
    let cap = this.bytes.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.bytes.subarray(0, this.pos));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  u8(v) { this.#ensure(1); this.bytes[this.pos++] = v; }
  i8(v) { this.#ensure(1); this.view.setInt8(this.pos++, v); }
  u16(v) { this.#ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
  i16(v) { this.#ensure(2); this.view.setInt16(this.pos, v, true); this.pos += 2; }
  u32(v) { this.#ensure(4); this.view.setUint32(this.pos, v, true); this.pos += 4; }
  i32(v) { this.#ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  f32(v) { this.#ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v) { this.#ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }

  /** Unsigned LEB128, up to 32 bits (1-5 bytes). */
  varuint(v) {
    this.#ensure(5);
    while (v >= 0x80) { this.bytes[this.pos++] = (v & 0x7f) | 0x80; v >>>= 7; }
    this.bytes[this.pos++] = v;
  }

  /** @param {Uint8Array} b */
  bytesRaw(b) { this.#ensure(b.length); this.bytes.set(b, this.pos); this.pos += b.length; }

  /** Length-prefixed UTF-8. @param {string} s */
  string(s) {
    const b = encoder.encode(s);
    this.varuint(b.length);
    this.bytesRaw(b);
  }
}

/** Bounds-checked little-endian reader. Every overrun throws ProtocolError. */
export class BinaryReader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  get remaining() { return this.bytes.length - this.pos; }

  #need(n) {
    if (this.pos + n > this.bytes.length) throw new ProtocolError('truncated packet');
  }

  u8() { this.#need(1); return this.bytes[this.pos++]; }
  i8() { this.#need(1); return this.view.getInt8(this.pos++); }
  u16() { this.#need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { this.#need(2); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { this.#need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { this.#need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { this.#need(4); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { this.#need(8); const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }

  varuint() {
    let result = 0;
    let scale = 1;
    for (let shift = 0; shift < 35; shift += 7, scale *= 128) {
      const b = this.u8();
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        if (result > 0xffffffff) throw new ProtocolError('varuint exceeds 32 bits');
        return result;
      }
    }
    throw new ProtocolError('varuint too long');
  }

  /** @param {number} n @returns {Uint8Array} View into the packet. */
  bytesRaw(n) {
    this.#need(n);
    const b = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  /** @param {number} [maxLength] Max bytes accepted. */
  string(maxLength = 1024) {
    const n = this.varuint();
    if (n > maxLength) throw new ProtocolError('string too long');
    try {
      return decoder.decode(this.bytesRaw(n));
    } catch (e) {
      if (e instanceof ProtocolError) throw e;
      throw new ProtocolError('invalid utf-8');
    }
  }
}
