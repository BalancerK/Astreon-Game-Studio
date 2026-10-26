// Messages on a WebTransport stream. A stream is a stream of bytes (like TCP), so each message is sent with its length in front: four bytes, big-endian, then the payload. A message of length zero is
// allowed and is not delivered: the client sends one as soon as its stream opens, so that the server sees the stream (QUIC announces a stream to the peer with its first data).

/** The most a stream message may hold unless told otherwise: one mebibyte. */
export const MAX_STREAM_MESSAGE = 1 << 20;

/**
 * A message ready to write to a stream.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function encodeMessage(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

/** Thrown by a parser when the other side sends something that is not a message (one that is too long). */
export class StreamError extends Error {}

/** Cuts the bytes that come out of a stream (in pieces of any size) into messages. */
export class MessageParser {
  /** @param {{maxMessageSize?: number, onMessage: (bytes: Uint8Array) => void}} o */
  constructor({ maxMessageSize = MAX_STREAM_MESSAGE, onMessage }) {
    this.max = maxMessageSize;
    this.onMessage = onMessage;
    /** @type {Uint8Array} */ this.buffer = new Uint8Array(0);
  }

  /** @param {Uint8Array} chunk */
  push(chunk) {
    this.buffer = this.buffer.length ? concat(this.buffer, chunk) : chunk;
    for (;;) {
      if (this.buffer.length < 4) return;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const length = view.getUint32(0);
      if (length > this.max) throw new StreamError(`message of ${length} bytes is over the limit of ${this.max}`);
      if (this.buffer.length < 4 + length) return;
      const payload = this.buffer.slice(4, 4 + length);                      // (a copy: the memory of a chunk is reused by the stream)
      this.buffer = this.buffer.subarray(4 + length);
      if (length > 0) this.onMessage(payload);
    }
  }
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
