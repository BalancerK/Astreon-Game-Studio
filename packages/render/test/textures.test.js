import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TextureSet, proceduralTexture, createBox, createPlane, createSphere, createCylinder, createCapsule, createMesh, createSkinnedMesh,
  DrawList3D, parseGltf, loadGltfTextures, addGltfToDrawList, INSTANCE3D_FLOATS, SKINNED_INSTANCE_FLOATS,
} from '../src/index.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const solid = (w, h, c) => ({ width: w, height: h, data: Uint8Array.from({ length: w * h * 4 }, (_, i) => c[i % 4]) });

test('a texture set checks its settings and its images', () => {
  assert.throws(() => new TextureSet({ size: 100 }), /power of two/);
  assert.throws(() => new TextureSet({ size: 8 }), /16 to 2048/);
  assert.throws(() => new TextureSet({ maxLayers: 0 }), /maxLayers/);
  const set = new TextureSet({ size: 16, maxLayers: 2 });
  assert.throws(() => set.add({ width: 4, height: 4, data: new Uint8Array(10) }), /expected 64/);
  assert.throws(() => set.add(null), /needs width/);
  assert.equal(set.version, 0);
  assert.equal(set.add(solid(16, 16, [1, 2, 3, 255]), 'a'), 0);
  assert.equal(set.add(solid(16, 16, [4, 5, 6, 255]), 'b'), 1);
  assert.equal(set.version, 2);
  assert.throws(() => set.add(solid(16, 16, [0, 0, 0, 255])), /full/);
  assert.equal(set.find('b'), 1);
  assert.equal(set.find('zzz'), -1);
});

test('mipmaps: a full chain down to 1 x 1, averaging as it goes', () => {
  const set = new TextureSet({ size: 64 });
  assert.equal(set.levels, 7);
  const l = set.add(solid(64, 64, [200, 100, 50, 255]));
  const { mips } = set.layers[l];
  assert.equal(mips.length, 7);
  mips.forEach((m, level) => assert.equal(m.length, Math.max(1, 64 >> level) ** 2 * 4, `level ${level} size`));
  assert.deepEqual([...mips[6]], [200, 100, 50, 255], 'a solid colour stays that colour at every level');
  const checker = set.add(proceduralTexture('checker', 64, { cells: 64, colors: [1, 1, 1, 0, 0, 0] }));
  const top = set.layers[checker].mips[6];
  near(top[0], 128, 2, 'a one-pixel checker averages to mid grey'); near(top[1], 128, 2); near(top[2], 128, 2);
  const quarter = set.layers[checker].mips[1];
  assert.ok(quarter.every((v, i) => i % 4 === 3 || Math.abs(v - 128) <= 1), 'already grey one level down');
});

test('images of another size are resampled to the set size, corners kept', () => {
  const set = new TextureSet({ size: 16 });
  const two = { width: 2, height: 2, data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) };
  const l = set.add(two);
  const m = set.layers[l].mips[0];
  assert.deepEqual([...m.subarray(0, 4)], [255, 0, 0, 255], 'top left stays red');
  assert.deepEqual([...m.subarray(15 * 4, 15 * 4 + 4)], [0, 255, 0, 255], 'top right stays green');
  assert.deepEqual([...m.subarray(15 * 16 * 4, 15 * 16 * 4 + 4)], [0, 0, 255, 255], 'bottom left stays blue');
  const wide = set.add({ width: 4, height: 2, data: new Uint8Array(4 * 2 * 4).fill(77) });
  assert.ok(set.layers[wide].mips[0].every((v) => v === 77), 'a non-square image of one colour stays one colour');
});

test('procedural textures: the right size, opaque, deterministic, bright enough to tint, and seamless when tiled', () => {
  const kinds = ['grass', 'brick', 'concrete', 'plates', 'checker', 'solid'];
  for (const kind of kinds) {
    const img = proceduralTexture(kind, 128, { seed: 3 });
    assert.equal(img.width, 128); assert.equal(img.data.length, 128 * 128 * 4);
    let sum = 0, minAlpha = 255;
    for (let i = 0; i < img.data.length; i += 4) { sum += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; minAlpha = Math.min(minAlpha, img.data[i + 3]); }
    const mean = sum / (128 * 128) / 255;
    assert.equal(minAlpha, 255, `${kind}: opaque`);
    if (kind !== 'checker') assert.ok(mean > 0.5 && mean <= 1, `${kind}: bright enough to be tinted (mean ${mean.toFixed(2)})`);
    assert.deepEqual(proceduralTexture(kind, 128, { seed: 3 }).data, img.data, `${kind}: same seed, same image`);
    if (['grass', 'brick', 'concrete', 'plates'].includes(kind)) {
      const col = (x) => (y) => img.data[(y * 128 + x) * 4 + 1];
      const row = (y) => (x) => img.data[(y * 128 + x) * 4 + 1];
      const diff = (a, b, n = 128) => { let d = 0; for (let i = 0; i < n; i++) d += Math.abs(a(i) - b(i)); return d / n; };
      const across = diff(col(127), col(0)), inside = Math.max(diff(col(63), col(64)), 0.5); // the wrap seam against an ordinary step between neighbours
      assert.ok(across <= inside * 3 + 3, `${kind}: left and right edges join up (${across.toFixed(2)} vs ${inside.toFixed(2)})`);
      assert.ok(diff(row(127), row(0)) <= Math.max(diff(row(63), row(64)), 0.5) * 3 + 3, `${kind}: top and bottom join up`);
    }
  }
  assert.notDeepEqual(proceduralTexture('grass', 64, { seed: 1 }).data, proceduralTexture('grass', 64, { seed: 2 }).data, 'another seed, another image');
  assert.throws(() => proceduralTexture('lava'), /unknown/);
});

test('meshes carry texture coordinates: boxes per face, planes across, spheres around; wrong sizes are refused', () => {
  const box = createBox(2, 4, 6);
  assert.equal(box.uv.length, box.vertexCount * 2);
  for (let f = 0; f < 6; f++) { // each face covers the full 0..1 square and has "up" at v = 0 on the sides
    const uvs = [...box.uv.subarray(f * 8, f * 8 + 8)];
    assert.deepEqual([Math.min(uvs[0], uvs[2], uvs[4], uvs[6]), Math.max(uvs[0], uvs[2], uvs[4], uvs[6])], [0, 1]);
    assert.deepEqual([Math.min(uvs[1], uvs[3], uvs[5], uvs[7]), Math.max(uvs[1], uvs[3], uvs[5], uvs[7])], [0, 1]);
  }
  const front = [...box.uv.subarray(0, 8)], ys = [box.vertices[1], box.vertices[6 + 1], box.vertices[12 + 1], box.vertices[18 + 1]];
  assert.ok(front[1] === 1 && ys[0] < 0 && front[5] === 0 && ys[2] > 0, 'on a side face the bottom edge has v = 1 and the top edge v = 0');
  const plane = createPlane(10, 10, 4, 4);
  assert.deepEqual([plane.uv[0], plane.uv[1]], [0, 0]); assert.deepEqual([plane.uv[plane.uv.length - 2], plane.uv[plane.uv.length - 1]], [1, 1]);
  for (const mesh of [createSphere(), createCylinder(), createCapsule()]) {
    assert.equal(mesh.uv.length, mesh.vertexCount * 2, `${mesh.name} has uv`);
    assert.ok(mesh.uv.every((v) => v >= -1e-6 && v <= 1 + 1e-6), `${mesh.name}: uv inside 0..1`);
  }
  assert.throws(() => createMesh([0, 0, 0, 0, 1, 0], [0, 0, 0], 'x', [0, 0, 1]), /2 floats/);
  assert.equal(createMesh([0, 0, 0, 0, 1, 0], [0, 0, 0]).uv, undefined, 'uv stays optional');
  const sk = createSkinnedMesh([0, 0, 0, 0, 1, 0], [0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0], 1, 'sk', [0.25, 0.75]);
  assert.deepEqual([...sk.uv], [0.25, 0.75]);
});

test('materials on the draw list: set once, applied to what follows, reset by clear, validated', () => {
  const list = new DrawList3D(), box = createBox(), I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  list.add(box, I);
  list.setMaterial(3, 'planar', 0.25);
  list.add(box, I);
  list.setMaterial(5, 'uv', 2);
  list.add(box, I);
  list.setMaterial(null);
  list.add(box, I);
  const d = list.groups.get(box).data, at = (i) => [d[i * INSTANCE3D_FLOATS + 20], d[i * INSTANCE3D_FLOATS + 21], d[i * INSTANCE3D_FLOATS + 22]];
  assert.deepEqual(at(0), [-1, 0, 1]); assert.deepEqual(at(1), [3, 2, 0.25]); assert.deepEqual(at(2), [5, 1, 2]); assert.deepEqual(at(3), [-1, 0, 1]);
  list.setMaterial(7, 'planar', 1);
  list.clear();
  assert.deepEqual(list.material, [-1, 0, 1, 0], 'clear() drops the material');
  const sk = createSkinnedMesh([0, 0, 0, 0, 1, 0], [0, 0, 0], [0, 0, 0, 0], [1, 0, 0, 0], 1);
  list.setMaterial(2, 'planar', 0.5);
  list.addSkinned(sk, I, new Float32Array(16));
  const sd = list.skinned.get(sk).data;
  assert.deepEqual([sd[24], sd[25], sd[26]], [2, 2, 0.5], 'skinned instances carry it after the palette slot');
  assert.equal(SKINNED_INSTANCE_FLOATS, 28);
  assert.throws(() => list.setMaterial(-1), /whole number/);
  assert.throws(() => list.setMaterial(1.5), /whole number/);
  assert.throws(() => list.setMaterial(1, 'sphere'), /mapping/);
});

/** A glTF with one textured triangle: TEXCOORD_0 and a base colour texture from an embedded image (any bytes: parsing does not decode). */
function texturedModel({ withUv = true, badImage = false } = {}) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uv = new Float32Array([0, 1, 1, 1, 0, 0]);
  const bytes = new Uint8Array(pos.byteLength + uv.byteLength);
  bytes.set(new Uint8Array(pos.buffer), 0); bytes.set(new Uint8Array(uv.buffer), pos.byteLength);
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]).toString('base64');
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    images: [{ uri: `data:image/png;base64,${png}` }],
    textures: [{ source: badImage ? 4 : 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.5, 1], baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: withUv ? { POSITION: 0, TEXCOORD_0: 1 } : { POSITION: 0 }, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
}

test('glTF textures: coordinates, the base colour image, decoding into a set, and drawing with it', async () => {
  const model = parseGltf(texturedModel());
  assert.deepEqual(model.warnings, []);
  const mesh = model.instances[0].mesh;
  assert.deepEqual([...mesh.uv], [0, 1, 1, 1, 0, 0], 'TEXCOORD_0 becomes mesh.uv');
  assert.equal(model.instances[0].image, 0);
  assert.equal(model.images.length, 1);
  assert.equal(model.images[0].mimeType, 'image/png');
  assert.deepEqual([...model.images[0].bytes], [137, 80, 78, 71, 1, 2, 3, 4], 'the embedded file is handed over undecoded');

  const set = new TextureSet({ size: 16 });
  const decoded = [];
  const layers = await loadGltfTextures(model, set, async (bytes, mime) => { decoded.push([bytes.length, mime]); return solid(4, 4, [10, 20, 30, 255]); });
  assert.deepEqual(decoded, [[8, 'image/png']]);
  assert.equal(layers.get(0), 0);
  assert.equal(set.layers.length, 1);

  const list = new DrawList3D();
  addGltfToDrawList(list, model, undefined, {}, layers);
  const d = list.groups.get(mesh).data;
  assert.deepEqual([d[20], d[21], d[22]], [0, 1, 1], 'drawn with layer 0, by the mesh uv');
  assert.deepEqual(list.material, [-1, 0, 1, 0], 'the draw list is left without a material');
  list.clear();
  addGltfToDrawList(list, model); // no layers given: drawn untextured
  assert.equal(list.groups.get(mesh).data[20], -1);
});

test('glTF textures: a texture without coordinates, a second set of coordinates, and bad references are reported', async () => {
  const noUv = parseGltf(texturedModel({ withUv: false }));
  assert.ok(noUv.warnings.some((w) => /no TEXCOORD_0/.test(w)));
  assert.equal(noUv.instances[0].image, undefined);
  const other = texturedModel(); other.materials[0].normalTexture = { index: 0 };
  const read = parseGltf(other);
  assert.equal(read.materials[0].images.normal, 0, 'a normal picture is read now, not ignored');
  assert.ok(!read.warnings.some((w) => /only base colour textures/.test(w)));
  const second = texturedModel(); second.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1;
  assert.ok(parseGltf(second).warnings.some((w) => /second set of texture coordinates/.test(w)));
  assert.throws(() => parseGltf(texturedModel({ badImage: true })), /image 4, which does not exist/);
  const external = texturedModel(); external.images = [{ uri: 'wood.png' }];
  const m = parseGltf(external);
  assert.equal(m.images[0].bytes, null); assert.equal(m.images[0].uri, 'wood.png');
  await assert.rejects(() => loadGltfTextures(m, new TextureSet({ size: 16 }), async () => solid(2, 2, [0, 0, 0, 255])), /wood\.png/);
  const given = parseGltf(external, { buffers: { 'wood.png': new Uint8Array([1, 2, 3]).buffer } });
  assert.deepEqual([...given.images[0].bytes], [1, 2, 3], 'external image files can be passed in like external buffers');
});
