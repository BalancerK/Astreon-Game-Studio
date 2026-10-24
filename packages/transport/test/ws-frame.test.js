import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameParser, WsError, OP, encodeFrame, encodeClose, acceptKey } from '../src/node.js';
import { createRng } from '../src/index.js';
import { rawFrame } from './helpers.js';

function collector(overrides = {}, max = 1 << 20) {
  const got = { messages: [], pings: [], pongs: [], closes: [] };
  const parser = new FrameParser({
    expectMasked: true,
    maxMessageSize: max,
    onMessage: (p) => got.messages.push(Buffer.from(p)),
    onPing: (p) => got.pings.push(Buffer.from(p)),
    onPong: (p) => got.pongs.push(Buffer.from(p)),
    onClose: (code, reason) => got.closes.push([code, reason]),
    ...overrides,
  });
  return { parser, got };
}

const expectError = (frames, code, max) => {
  const { parser } = collector({}, max);
  const input = Buffer.concat(frames);
  try {
    parser.push(input);
    assert.fail(`expected WsError ${code}`);
  } catch (e) {
    assert.ok(e instanceof WsError, `got ${e}`);
    assert.equal(e.code, code, e.message);
  }
};

test('accept key matches the RFC 6455 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('parses 7-bit, 16-bit and 64-bit length frames', () => {
  const { parser, got } = collector();
  for (const n of [0, 5, 125, 126, 300, 65535, 65536, 100000]) parser.push(rawFrame(OP.BINARY, Buffer.alloc(n, n & 255)));
  assert.deepEqual(got.messages.map((m) => m.length), [0, 5, 125, 126, 300, 65535, 65536, 100000]);
  assert.ok(got.messages[7].every((b) => b === (100000 & 255)));
  assert.equal(parser.buffered, 0);
});

test('encodeFrame round trips through the parser, with channel prefix and masking', () => {
  const { parser, got } = collector();
  parser.push(encodeFrame(OP.BINARY, Uint8Array.from([9, 8, 7]), 1, true));
  assert.deepEqual([...got.messages[0]], [1, 9, 8, 7]);
  // server-side frames are unmasked; a client-role parser accepts them
  const cl = collector({ expectMasked: false });
  cl.parser.push(encodeFrame(OP.BINARY, Uint8Array.from([5]), 0, false));
  assert.deepEqual([...cl.got.messages[0]], [0, 5]);
});

test('handles byte-by-byte delivery', () => {
  const { parser, got } = collector();
  const frame = Buffer.concat([rawFrame(OP.BINARY, Buffer.alloc(300, 7)), rawFrame(OP.PING, Buffer.from('hi'))]);
  for (let i = 0; i < frame.length; i++) parser.push(frame.subarray(i, i + 1));
  assert.equal(got.messages.length, 1);
  assert.equal(got.messages[0].length, 300);
  assert.equal(got.pings[0].toString(), 'hi');
});

test('assembles fragmented messages with control frames interleaved', () => {
  const { parser, got } = collector();
  parser.push(Buffer.concat([
    rawFrame(OP.BINARY, Buffer.from([1, 2]), { fin: false }),
    rawFrame(OP.PING, Buffer.from('p')),
    rawFrame(OP.CONT, Buffer.from([3]), { fin: false }),
    rawFrame(OP.PONG, Buffer.from('q')),
    rawFrame(OP.CONT, Buffer.from([4, 5]), { fin: true }),
    rawFrame(OP.BINARY, Buffer.from([6])),
  ]));
  assert.deepEqual(got.messages.map((m) => [...m]), [[1, 2, 3, 4, 5], [6]]);
  assert.equal(got.pings.length, 1);
  assert.equal(got.pongs.length, 1);
});

test('close frames: empty, with code and reason', () => {
  const { parser, got } = collector();
  parser.push(rawFrame(OP.CLOSE));
  parser.push(rawFrame(OP.CLOSE, encodeClose(1000, 'bye ✓')));
  parser.push(rawFrame(OP.CLOSE, encodeClose(4001, '')));
  assert.deepEqual(got.closes, [[1005, ''], [1000, 'bye ✓'], [4001, '']]);
});

test('protocol violations produce the right close codes', () => {
  expectError([rawFrame(OP.BINARY, Buffer.from([1]), { mask: false })], 1002); // client must mask
  expectError([rawFrame(OP.BINARY, Buffer.from([1]), { rsv: 4 })], 1002); // RSV without extension
  expectError([rawFrame(3, Buffer.from([1]))], 1002); // reserved data opcode
  expectError([rawFrame(0xb, Buffer.from([1]))], 1002); // reserved control opcode
  expectError([rawFrame(OP.PING, Buffer.from('x'), { fin: false })], 1002); // fragmented control
  expectError([rawFrame(OP.PING, Buffer.alloc(126))], 1002); // oversized control
  expectError([rawFrame(OP.CONT, Buffer.from([1]))], 1002); // continuation with nothing to continue
  expectError([rawFrame(OP.BINARY, Buffer.from([1]), { fin: false }), rawFrame(OP.BINARY, Buffer.from([2]))], 1002); // new message mid-fragment
  expectError([rawFrame(OP.TEXT, Buffer.from('hello'))], 1003); // binary only
  expectError([rawFrame(OP.CLOSE, Buffer.from([1]))], 1002); // 1-byte close payload
  expectError([rawFrame(OP.CLOSE, encodeClose(1005))], 1002); // reserved close code
  expectError([rawFrame(OP.CLOSE, encodeClose(999))], 1002);
  expectError([rawFrame(OP.CLOSE, Buffer.concat([encodeClose(1000), Buffer.from([0xff, 0xfe])]))], 1007); // bad UTF-8 reason
});

test('size limits apply to frames and to assembled fragments, before buffering', () => {
  expectError([rawFrame(OP.BINARY, Buffer.alloc(200))], 1009, 100);
  expectError([
    rawFrame(OP.BINARY, Buffer.alloc(60), { fin: false }),
    rawFrame(OP.CONT, Buffer.alloc(60), { fin: true }),
  ], 1009, 100);
  // a header claiming a huge frame is rejected without waiting for the body
  const { parser } = collector({}, 1000);
  const header = Buffer.from([0x82, 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 3, 4]); // 4 GiB declared
  assert.throws(() => parser.push(header), (e) => e instanceof WsError && e.code === 1009);
  const header2 = Buffer.from([0x82, 0xff, 0, 0, 0, 0, 0x10, 0, 0, 0, 1, 2, 3, 4]); // 256 MiB declared
  assert.throws(() => collector({}, 1000).parser.push(header2), (e) => e instanceof WsError && e.code === 1009);
});

test('after an error the parser stays dead', () => {
  const { parser, got } = collector();
  assert.throws(() => parser.push(rawFrame(OP.BINARY, Buffer.from([1]), { mask: false })));
  parser.push(rawFrame(OP.BINARY, Buffer.from([2])));
  assert.equal(got.messages.length, 0);
});

test('property: random messages, random fragmentation, random chunking, interleaved pings', () => {
  const rng = createRng(2024);
  for (let round = 0; round < 200; round++) {
    const expected = [];
    const wire = [];
    for (let m = 0; m < 1 + ((rng() * 6) | 0); m++) {
      const len = rng() < 0.1 ? (rng() * 70000) | 0 : (rng() * 400) | 0;
      const msg = Buffer.alloc(len);
      for (let i = 0; i < len; i++) msg[i] = (rng() * 256) | 0;
      expected.push(msg);
      let off = 0;
      let first = true;
      do {
        const piece = Math.min(len - off, 1 + ((rng() * (len + 1)) | 0));
        const last = off + piece >= len;
        wire.push(rawFrame(first ? OP.BINARY : OP.CONT, msg.subarray(off, off + piece), { fin: last }));
        off += piece;
        first = false;
        if (rng() < 0.3) wire.push(rawFrame(OP.PING, Buffer.from([m])));
      } while (off < len);
    }
    const all = Buffer.concat(wire);
    const { parser, got } = collector();
    for (let i = 0; i < all.length;) {
      const n = 1 + ((rng() * 3000) | 0);
      parser.push(all.subarray(i, i + n));
      i += n;
    }
    assert.equal(got.messages.length, expected.length, `round ${round}`);
    got.messages.forEach((m, i) => assert.ok(m.equals(expected[i]), `round ${round} message ${i}`));
    assert.equal(parser.buffered, 0);
  }
});

test('fuzz: random garbage only ever raises WsError and never buffers beyond the limit', () => {
  const rng = createRng(77);
  const max = 2000;
  for (let trial = 0; trial < 3000; trial++) {
    const { parser } = collector({}, max);
    const n = (rng() * 200) | 0;
    const junk = Buffer.alloc(n);
    for (let i = 0; i < n; i++) junk[i] = (rng() * 256) | 0;
    // sometimes start with a plausible masked binary header so parsing goes deeper
    if (rng() < 0.5 && n > 6) { junk[0] = 0x82; junk[1] = 0x80 | ((rng() * 130) | 0); }
    try {
      for (let i = 0; i < n; i += 1 + ((rng() * 20) | 0)) parser.push(junk.subarray(i, i + 20));
    } catch (e) {
      assert.ok(e instanceof WsError, `unexpected ${e}`);
    }
    assert.ok(parser.buffered <= max + 14, `buffered ${parser.buffered}`);
  }
});
