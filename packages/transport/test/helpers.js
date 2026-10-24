// Test helper: build raw WebSocket frames, including invalid ones.
/** Hand-built frame, so tests can violate the protocol. */
export function rawFrame(opcode, payload = Buffer.alloc(0), { fin = true, mask = true, rsv = 0 } = {}) {
  const p = Buffer.from(payload);
  const len = p.length;
  const head = [(fin ? 0x80 : 0) | (rsv << 4) | opcode];
  if (len < 126) head.push((mask ? 0x80 : 0) | len);
  else if (len < 65536) head.push((mask ? 0x80 : 0) | 126, len >> 8, len & 255);
  else head.push((mask ? 0x80 : 0) | 127, 0, 0, 0, 0, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255);
  const key = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const body = Buffer.from(p);
  if (mask) for (let i = 0; i < len; i++) body[i] ^= key[i & 3];
  return Buffer.concat([Buffer.from(head), mask ? key : Buffer.alloc(0), body]);
}
