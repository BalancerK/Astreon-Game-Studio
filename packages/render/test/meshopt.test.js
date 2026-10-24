// The meshopt decoder is checked against the real thing: every case in the fixture file was written by the meshoptimizer encoder and decoded by its own decoder, and ours must give the same bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeVertexBuffer, decodeIndexBuffer, decodeIndexSequence, decodeMeshoptBufferView } from '../src/meshopt.js';

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/meshopt.json', import.meta.url), 'utf8'));
const bytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));

for (const c of cases) {
  test(`meshopt matches the reference: ${c.name}`, () => {
    const got = decodeMeshoptBufferView({ count: c.count, byteStride: c.stride, mode: c.mode, filter: c.filter }, bytes(c.encoded));
    const want = bytes(c.expected);
    assert.equal(got.length, want.length);
    let first = -1;
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) { first = i; break; }
    assert.equal(first, -1, `first difference at byte ${first}: ${got[first]} instead of ${want[first]}`);
  });
}

test('damaged or wrong data is refused with a message, not decoded into garbage', () => {
  const v = cases.find((c) => c.mode === 'ATTRIBUTES' && c.filter === 'NONE');
  const data = bytes(v.encoded);
  assert.throws(() => decodeVertexBuffer(v.count, v.stride, data.subarray(0, 10)), /compressed mesh data/);
  const wrong = data.slice(); wrong[0] = 0;
  assert.throws(() => decodeVertexBuffer(v.count, v.stride, wrong), /not vertex data/);
  assert.throws(() => decodeVertexBuffer(v.count, 6, data), /multiple of 4/);
  const t = cases.find((c) => c.mode === 'TRIANGLES');
  assert.throws(() => decodeIndexBuffer(t.count + 1, t.stride, bytes(t.encoded)), /whole number of triangles/);
  assert.throws(() => decodeIndexBuffer(t.count, 3, bytes(t.encoded)), /2 or 4/);
  assert.throws(() => decodeIndexBuffer(t.count, t.stride, bytes(t.encoded).subarray(0, 8)), /too short/);
  const s = cases.find((c) => c.mode === 'INDICES');
  assert.throws(() => decodeIndexSequence(s.count, s.stride, bytes(s.encoded).subarray(0, 20)), /compressed mesh data/);
  assert.throws(() => decodeMeshoptBufferView({ count: 1, byteStride: 4, mode: 'NOPE' }, data), /mode that is not known/);
  assert.throws(() => decodeMeshoptBufferView({ count: 1, byteStride: 4, mode: 'ATTRIBUTES', filter: 'WAT' }, bytes(cases.find((c) => c.stride === 4 && c.count === 1).encoded)), /filter that is not known/);
});
