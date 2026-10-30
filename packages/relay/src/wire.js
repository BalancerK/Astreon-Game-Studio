// Messages on the wire: plain objects written as JSON text in a byte message (the engine's transports carry bytes). Anything that does not read back as an object with a text `t` is dropped.
const text = new TextEncoder(), read = new TextDecoder();

/** A message as bytes. @param {any} msg @returns {Uint8Array} */
export const pack = (msg) => text.encode(JSON.stringify(msg));

/** A message from bytes. @param {Uint8Array | ArrayBuffer} bytes @returns {any} the message, or null if it is not one */
export function unpack(bytes) {
  try {
    const msg = JSON.parse(read.decode(bytes));
    return msg && typeof msg === 'object' && typeof msg.t === 'string' ? msg : null;
  } catch { return null; }
}
