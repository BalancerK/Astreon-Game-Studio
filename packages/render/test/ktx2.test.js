// KTX2 files are built here by a small writer (the format is plain: a header, a level index and the levels), so each case is exactly known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseKtx2, TextureSet, levelBytes, textureFormatInfo } from '../src/index.js';

const IDENT = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** A KTX2 file: `levels[0]` is the full size picture. `scheme` 3 stores each level zlib compressed. */
function makeKtx2({ vkFormat, width, height, levels, scheme = 0, faces = 1, layers = 0, depth = 0 }) {
  const stored = levels.map((l) => (scheme === 3 ? new Uint8Array(deflateSync(l)) : l));
  const headEnd = 80 + levels.length * 24;
  const offsets = []; let at = headEnd;
  for (let i = levels.length - 1; i >= 0; i--) { offsets[i] = at; at += stored[i].length; while (at % 8) at++; }   // the smallest level comes first in the file
  const out = new Uint8Array(at), v = new DataView(out.buffer);
  out.set(IDENT);
  [vkFormat, 1, width, height, depth, layers, faces, levels.length, scheme].forEach((n, i) => v.setUint32(12 + i * 4, n, true));
  levels.forEach((l, i) => { v.setBigUint64(80 + i * 24, BigInt(offsets[i]), true); v.setBigUint64(88 + i * 24, BigInt(stored[i].length), true); v.setBigUint64(96 + i * 24, BigInt(l.length), true); out.set(stored[i], offsets[i]); });
  return out;
}
const rgbaLevels = (size, fill) => { const l = []; for (let s = size; s >= 1; s >>= 1) l.push(new Uint8Array(s * s * 4).fill(fill)); return l; };
const blockLevels = (size, bytes, fill) => { const l = []; for (let s = size; s >= 1; s >>= 1) l.push(new Uint8Array(Math.ceil(s / 4) ** 2 * bytes).fill(fill)); return l; };

test('plain RGBA8 pictures are read, with and without zlib', async () => {
  for (const scheme of [0, 3]) {
    const k = await parseKtx2(makeKtx2({ vkFormat: 37, width: 16, height: 16, levels: rgbaLevels(16, 9), scheme }));
    assert.equal(k.format, 'rgba8'); assert.equal(k.width, 16); assert.equal(k.levels.length, 5);
    assert.equal(k.levels[0].length, 16 * 16 * 4); assert.equal(k.levels[4][0], 9);
  }
});

test('compressed formats are read with the right level sizes', async () => {
  for (const [vk, name, bytes] of [[133, 'bc1', 8], [137, 'bc3', 16], [145, 'bc7', 16], [152, 'etc2', 16], [157, 'astc4x4', 16]]) {
    const k = await parseKtx2(makeKtx2({ vkFormat: vk, width: 32, height: 32, levels: blockLevels(32, bytes, 7), scheme: 3 }));
    assert.equal(k.format, name);
    assert.equal(k.levels.length, 6);
    assert.equal(k.levels[0].length, levelBytes(name, 32, 32));
    assert.equal(k.levels[5].length, bytes, 'the 1 x 1 level is one block');
    assert.equal(k.gpuFormat, textureFormatInfo(name).gpu);
  }
});

test('what cannot be read is refused with a message that says why and what to do', async () => {
  const good = makeKtx2({ vkFormat: 37, width: 16, height: 16, levels: rgbaLevels(16, 1) });
  const set = (i, n) => { const b = good.slice(); new DataView(b.buffer).setUint32(i, n, true); return b; };
  await assert.rejects(() => parseKtx2(new Uint8Array(100)), /not a KTX2 file/);
  await assert.rejects(() => parseKtx2(set(44, 1)), /Basis Universal.*WebAssembly/s);
  await assert.rejects(() => parseKtx2(set(44, 2)), /Zstandard/);
  await assert.rejects(() => parseKtx2(set(12, 0)), /Basis Universal/);
  await assert.rejects(() => parseKtx2(set(12, 99)), /pixel format 99/);
  await assert.rejects(() => parseKtx2(set(36, 6)), /cube maps/);
  await assert.rejects(() => parseKtx2(set(32, 4)), /arrays/);
  await assert.rejects(() => parseKtx2(good.subarray(0, 210)), /runs past the end/);
});

test('a compressed set holds compressed pictures and says what is wrong when one does not fit', async () => {
  const bc7 = await parseKtx2(makeKtx2({ vkFormat: 145, width: 64, height: 64, levels: blockLevels(64, 16, 3) }));
  const set = new TextureSet({ size: 64, format: 'bc7' });
  assert.equal(set.addKtx2(bc7, 'wall'), 0);
  assert.equal(set.find('wall'), 0);
  assert.equal(set.layers[0].mips.length, 7);
  assert.throws(() => set.add({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) }), /addKtx2/);
  assert.throws(() => new TextureSet({ size: 32, format: 'bc7' }).addKtx2(bc7), /exactly 32 x 32/);
  assert.throws(() => new TextureSet({ size: 64, format: 'bc3' }).addKtx2(bc7), /holds bc3.*is bc7/);
  assert.throws(() => new TextureSet({ size: 64 }).addKtx2(bc7), /plain pixels.*format: 'bc7'/);
  const short = await parseKtx2(makeKtx2({ vkFormat: 145, width: 64, height: 64, levels: blockLevels(64, 16, 3).slice(0, 3) }));
  assert.throws(() => set.addKtx2(short), /all 7 mip levels/);
  assert.throws(() => new TextureSet({ format: 'jpeg' }), /texture format must be one of/);
});

test('an RGBA8 picture goes into an ordinary set like any image', async () => {
  const k = await parseKtx2(makeKtx2({ vkFormat: 43, width: 16, height: 16, levels: rgbaLevels(16, 200) }));
  const set = new TextureSet({ size: 16 });
  assert.equal(set.addKtx2(k), 0);
  assert.equal(set.layers[0].mips[0][0], 200);
});
