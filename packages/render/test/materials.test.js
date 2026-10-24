import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MaterialSet, cleanMaterial, MAX_MATERIALS, MATERIAL_FLOATS, pbrLight, pbrAmbient, srgbToLinear, linearToSrgb, TextureSet, DrawList3D, createBox, createSkinnedMesh,
  parseGltf, loadGltfTextures, loadGltfMaterials, addGltfToDrawList, INSTANCE3D_FLOATS, SKINNED_INSTANCE_FLOATS,
} from '../src/index.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const solid = (c) => ({ width: 4, height: 4, data: Uint8Array.from({ length: 64 }, (_, i) => c[i % 4]) });

test('a material gets every field filled in, held to its range, and refused when it makes no sense', () => {
  const m = cleanMaterial({});
  assert.deepEqual([m.baseColor, m.metallic, m.roughness, m.normalScale, m.occlusionStrength, m.emissive, m.alphaCutoff, m.uvScale, m.opaque],
    [[1, 1, 1, 1], 0, 0.5, 1, 1, [0, 0, 0], 0, 1, false]);
  assert.deepEqual([m.baseColorTexture, m.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture], [-1, -1, -1, -1, -1]);
  const wild = cleanMaterial({ metallic: 5, roughness: -2, normalScale: 99, emissive: [-1, 2, 3], alphaCutoff: 7, uvScale: 0 });
  assert.deepEqual([wild.metallic, wild.roughness, wild.normalScale, wild.emissive, wild.alphaCutoff, wild.uvScale], [1, 0, 8, [0, 2, 3], 1, 0.001]);
  assert.deepEqual(cleanMaterial(cleanMaterial({ metallic: 0.3, baseColor: [0.2, 0.4, 0.6, 0.8], emissiveTexture: 3 })), cleanMaterial({ metallic: 0.3, baseColor: [0.2, 0.4, 0.6, 0.8], emissiveTexture: 3 }));
  assert.throws(() => cleanMaterial({ metallic: NaN }), /metallic must be a number/);
  assert.throws(() => cleanMaterial({ baseColor: [1, 2] }), /baseColor needs 4 numbers/);
  assert.throws(() => cleanMaterial({ baseColor: 'red' }), /list of 4 numbers/);
  assert.throws(() => cleanMaterial({ normalTexture: 1.5 }), /texture layer number/);
  assert.throws(() => cleanMaterial({ normalTexture: -3 }), /texture layer number/);
  assert.throws(() => cleanMaterial(null), /is an object/);
});

test('a material set packs materials where the shaders read them, and says when it changed', () => {
  const set = new MaterialSet();
  assert.equal(set.version, 0);
  const a = set.add({ name: 'gold', baseColor: [1, 0.8, 0.3, 1], metallic: 1, roughness: 0.2, baseColorTexture: 4, normalTexture: 5, normalScale: 0.5, emissive: [1, 2, 3], alphaCutoff: 0.4, uvScale: 3, opaque: true });
  const b = set.add({ roughness: 0.9 });
  assert.deepEqual([a, b], [1, 2]);
  assert.equal(set.version, 2);
  const o = (id) => id * MATERIAL_FLOATS;
  const f = (id, from, n) => [...set.data.slice(o(id) + from, o(id) + from + n)].map((v) => Math.round(v * 1000) / 1000);
  assert.deepEqual(f(a, 0, 4), [1, 0.8, 0.3, 1]);
  assert.deepEqual(f(a, 4, 4), [1, 0.2, 0.5, 1], 'metallic, roughness, normal scale, occlusion strength');
  assert.deepEqual(f(a, 8, 4), [1, 2, 3, 0.4], 'emissive and the alpha cut-off');
  assert.deepEqual(f(a, 12, 4), [4, -1, 5, -1], 'base colour, metallic-roughness, normal and occlusion layers (-1 is none)');
  assert.deepEqual(f(a, 16, 4), [-1, 3, 1, 0], 'emissive layer, uv scale, opaque flag');
  assert.deepEqual(f(b, 4, 2), [0, 0.9]);
  assert.deepEqual(f(0, 0, 20), new Array(20).fill(0), 'slot 0 stays empty: material 0 means the simple lighting');
  set.set(b, { roughness: 0.1, metallic: 1 });
  assert.equal(set.version, 3);
  assert.deepEqual(f(b, 4, 2), [1, 0.1]);
  assert.equal(set.materials[b - 1].baseColor[0], 1, 'what was not changed stays');
  assert.equal(set.find('gold'), 1);
  assert.equal(set.find('nothing'), 0);
  assert.throws(() => set.set(9, {}), /no material 9/);
});

test('a set holds 127 materials and then says it is full', () => {
  const set = new MaterialSet();
  for (let i = 0; i < MAX_MATERIALS; i++) set.add({});
  assert.throws(() => set.add({}), /full/);
});

test('instances carry their surface material, plain and skinned, and clear() forgets it', () => {
  const list = new DrawList3D();
  const box = createBox(1, 1, 1);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  list.add(box, identity);
  list.setSurface(7);
  list.add(box, identity);
  list.setSurface();
  list.add(box, identity);
  const d = list.groups.get(box).data;
  assert.deepEqual([d[23], d[INSTANCE3D_FLOATS + 23], d[2 * INSTANCE3D_FLOATS + 23]], [0, 7, 0]);
  const n = box.vertexCount;
  const skinned = createSkinnedMesh(box.vertices, box.indices, new Array(n * 4).fill(0), Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 1, 's');
  list.setSurface(3);
  list.addSkinned(skinned, identity, new Float32Array(identity));
  assert.equal(list.skinned.get(skinned).data[27], 3);
  assert.equal(list.skinned.get(skinned).data.length >= SKINNED_INSTANCE_FLOATS, true);
  list.clear();
  assert.equal(list.material[3], 0);
  assert.throws(() => list.setSurface(128), /1 to 127/);
  assert.throws(() => list.setSurface(-1), /1 to 127/);
  assert.throws(() => list.setSurface(1.5), /1 to 127/);
});

// ---------- the shading model written out on the CPU ----------

test('sRGB and linear light convert back and forth, and meet at the ends', () => {
  for (let c = 0; c <= 1; c += 0.05) near(linearToSrgb(srgbToLinear(c)), c, 1e-9);
  assert.equal(srgbToLinear(0), 0);
  near(srgbToLinear(1), 1, 1e-12);
  near(srgbToLinear(0.5), 0.2140, 0.001);
});

test('a white matte surface lit square on by a light of 1 comes out white, like the simple lighting', () => {
  const s = { baseColor: [1, 1, 1], metallic: 0, roughness: 1 };
  const r = pbrLight(s, [0, 0, 1], [0, 0, 1], [0, 0, 1], [1, 1, 1]);
  near(r.diffuse[0], 1, 1e-9);
  assert.ok(r.specular[0] < 0.2, 'a rough surface has little highlight');
  const behind = pbrLight(s, [0, 0, 1], [0, 0, 1], [0, 0, -1], [1, 1, 1]);
  assert.deepEqual([...behind.diffuse, ...behind.specular], [0, 0, 0, 0, 0, 0], 'a light behind a surface does not light it');
});

test('a metal has no diffuse light, and takes the colour of its metal in its highlight', () => {
  const gold = { baseColor: [1, 0.77, 0.34], metallic: 1, roughness: 0.3 };
  const r = pbrLight(gold, [0, 0, 1], [0, 0, 1], [0, 0, 1], [1, 1, 1]);
  assert.deepEqual(r.diffuse, [0, 0, 0]);
  assert.ok(r.specular[0] > r.specular[1] && r.specular[1] > r.specular[2], 'gold is red-yellow, not grey');
  const plastic = pbrLight({ ...gold, metallic: 0, baseColor: [0.8, 0.1, 0.1] }, [0, 0, 1], [0, 0, 1], [0, 0, 1], [1, 1, 1]);
  near(plastic.specular[0], plastic.specular[1], 1e-9, 'the highlight of a dielectric is white');
});

test('a smoother surface has a smaller, brighter highlight', () => {
  const at = (rough, tilt) => {
    const n = [Math.sin(tilt), 0, Math.cos(tilt)];
    return pbrLight({ baseColor: [1, 1, 1], metallic: 0, roughness: rough }, n, [0, 0, 1], [0, 0, 1], [1, 1, 1]).specular[0];
  };
  assert.ok(at(0.1, 0) > at(0.7, 0), 'the peak is brighter when smooth');
  assert.ok(at(0.1, 0.35) < at(0.7, 0.35), 'and falls away faster');
});

test('ambient light: a plain dielectric under an even sky is its own colour, and a metal reflects the sky', () => {
  const sky = [1, 1, 1], ground = [1, 1, 1];
  const plastic = pbrAmbient({ baseColor: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5 }, [0, 1, 0], [0, 1, 0], sky, ground);
  near(plastic.diffuse[0], 0.5, 1e-9);
  const mirror = pbrAmbient({ baseColor: [1, 1, 1], metallic: 1, roughness: 0.05 }, [0, 1, 0], [0, 1, 0], sky, ground);
  assert.deepEqual(mirror.diffuse, [0, 0, 0]);
  assert.ok(mirror.specular[0] > 0.8, 'a smooth white metal reflects nearly all of the sky');
  const up = pbrAmbient({ baseColor: [1, 1, 1], metallic: 1, roughness: 0.05 }, [0, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const down = pbrAmbient({ baseColor: [1, 1, 1], metallic: 1, roughness: 0.05 }, [0, -1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  assert.ok(up.specular[0] > up.specular[2] && down.specular[2] > down.specular[0], 'it reflects the sky above and the ground below');
});

// ---------- glTF ----------

/** One triangle with texture coordinates and two materials, one using all five kinds of picture. */
function pbrModel({ withUv = true, mode = 'OPAQUE', extra = {} } = {}) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uv = new Float32Array([0, 1, 1, 1, 0, 0]);
  const bytes = new Uint8Array(pos.byteLength + uv.byteLength);
  bytes.set(new Uint8Array(pos.buffer), 0); bytes.set(new Uint8Array(uv.buffer), pos.byteLength);
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]).toString('base64');
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    images: Array.from({ length: 5 }, (_, i) => ({ name: `img${i}`, uri: `data:image/png;base64,${png}` })),
    textures: [0, 1, 2, 3, 4].map((source) => ({ source })),
    materials: [{
      name: 'rusty',
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.5, 0.3, 1], metallicFactor: 0.8, roughnessFactor: 0.6, baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
      normalTexture: { index: 2, scale: 0.7 }, occlusionTexture: { index: 3, strength: 0.4 }, emissiveTexture: { index: 4 }, emissiveFactor: [1, 0.5, 0],
      alphaMode: mode, alphaCutoff: 0.3, extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } }, ...extra,
    }, { pbrMetallicRoughness: {} }],
    meshes: [{ primitives: [{ attributes: withUv ? { POSITION: 0, TEXCOORD_0: 1 } : { POSITION: 0 }, material: 0 }, { attributes: { POSITION: 0 }, material: 1 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
}

test('every part of a glTF material is read: factors, all five pictures, alpha mode and emissive strength', () => {
  const model = parseGltf(pbrModel());
  const m = model.materials[0];
  assert.equal(m.name, 'rusty');
  assert.deepEqual([m.baseColor, m.metallic, m.roughness, m.normalScale, m.occlusionStrength], [[0.9, 0.5, 0.3, 1], 0.8, 0.6, 0.7, 0.4]);
  assert.deepEqual(m.emissive, [4, 2, 0], 'emissive times KHR_materials_emissive_strength');
  assert.deepEqual(m.images, { base: 0, metallicRoughness: 1, normal: 2, occlusion: 3, emissive: 4 });
  assert.deepEqual([m.alphaMode, m.alphaCutoff], ['OPAQUE', 0.3]);
  assert.deepEqual(model.warnings, [], 'nothing is left out any more');
  const d = model.materials[1];
  assert.deepEqual([d.metallic, d.roughness, d.baseColor, d.emissive, d.images], [1, 1, [1, 1, 1, 1], [0, 0, 0], {}], 'glTF defaults: metallic 1, roughness 1');
  assert.equal(model.instances[0].material, 0);
  assert.equal(model.instances[0].textured, true);
  assert.equal(model.instances[1].textured, false);
});

test('things the loader still cannot do are reported, not silently dropped', () => {
  const second = pbrModel(); second.materials[0].normalTexture.texCoord = 1;
  const w = parseGltf(second).warnings.join(' | ');
  assert.match(w, /normal picture uses the second set of texture coordinates/);
  assert.equal(parseGltf(second).materials[0].images.normal, undefined, 'and is left out');
  const moved = pbrModel(); moved.materials[0].emissiveTexture.extensions = { KHR_texture_transform: { scale: [2, 2] } };
  assert.match(parseGltf(moved).warnings.join(' | '), /emissive picture has a texture transform/);
  assert.match(parseGltf(pbrModel({ extra: { doubleSided: true } })).warnings.join(' | '), /double-sided materials are drawn single-sided/);
  assert.match(parseGltf(pbrModel({ mode: 'BLEND' })).warnings.join(' | '), /BLEND are blended in the order/);
  const orphan = pbrModel(); orphan.textures[2] = {};
  assert.match(parseGltf(orphan).warnings.join(' | '), /normal picture points at a texture that has no image/);
  const bad = pbrModel(); bad.materials[0].emissiveTexture.index = 4; bad.textures[4].source = 9;
  assert.throws(() => parseGltf(bad), /image 9, which does not exist/);
});

test('loading a model with materials: every picture goes into the texture set once, and the materials into the material set', async () => {
  const model = parseGltf(pbrModel());
  const textures = new TextureSet({ size: 16, maxLayers: 8 });
  const seen = [];
  const layers = await loadGltfTextures(model, textures, async (bytes) => { seen.push(bytes.length); return solid([10, 20, 30, 255]); });
  assert.equal(layers.size, 5);
  assert.deepEqual([...layers.keys()].sort(), [0, 1, 2, 3, 4]);
  assert.equal(textures.layers.length, 5);
  const set = new MaterialSet();
  const ids = loadGltfMaterials(model, layers, set);
  const m = set.materials[ids.get(0) - 1];
  assert.deepEqual([m.baseColorTexture, m.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture], [0, 1, 2, 3, 4].map((i) => layers.get(i)));
  assert.deepEqual([m.metallic, m.roughness, m.normalScale, m.occlusionStrength, m.emissive, m.alphaCutoff, m.opaque], [0.8, 0.6, 0.7, 0.4, [4, 2, 0], 0, true]);
  assert.equal(ids.has(-2), true, 'the second material is there too, as the plain kind because its mesh has no texture coordinates');
  assert.equal(set.materials[ids.get(-2) - 1].opaque, true);
  assert.equal(set.materials.length, 2, 'one for each material that is used');
});

test('a cut-out material has its cut-off, a blended one does not, and a mesh with no coordinates gets the material without its pictures', async () => {
  const mask = parseGltf(pbrModel({ mode: 'MASK' }));
  const set = new MaterialSet();
  const ids = loadGltfMaterials(mask, new Map(), set);
  assert.equal(set.materials[ids.get(0) - 1].alphaCutoff, 0.3);
  assert.equal(set.materials[ids.get(0) - 1].opaque, false);
  const blend = new MaterialSet();
  const blended = loadGltfMaterials(parseGltf(pbrModel({ mode: 'BLEND' })), new Map(), blend);
  assert.deepEqual([blend.materials[blended.get(0) - 1].alphaCutoff, blend.materials[blended.get(0) - 1].opaque], [0, false]);
  const noUv = parseGltf(pbrModel({ withUv: false }));
  const textures = new TextureSet({ size: 16, maxLayers: 8 });
  const layers = await loadGltfTextures(noUv, textures, async () => solid([1, 2, 3, 255]));
  assert.equal(layers.size, 0, 'pictures that cannot be mapped are not even decoded');
  const s2 = new MaterialSet();
  const i2 = loadGltfMaterials(noUv, layers, s2);
  const plain = s2.materials[i2.get(-1 - 0) - 1];
  assert.deepEqual([plain.baseColorTexture, plain.normalTexture, plain.metallic], [-1, -1, 0.8], 'the numbers stay, the pictures go');
});

test('drawing a model with materials uses them, tinted by nothing but the material; drawing without them is as before', async () => {
  const model = parseGltf(pbrModel());
  const textures = new TextureSet({ size: 16, maxLayers: 8 });
  const layers = await loadGltfTextures(model, textures, async () => solid([9, 9, 9, 255]));
  const set = new MaterialSet();
  const ids = loadGltfMaterials(model, layers, set);
  const list = new DrawList3D();
  addGltfToDrawList(list, model, undefined, {}, layers, ids);
  const first = list.groups.get(model.instances[0].mesh).data;
  assert.equal(first[23], ids.get(0), 'the instance names its material');
  assert.deepEqual([first[16], first[17], first[18], first[19]], [1, 1, 1, 1], 'the base colour is in the material, not tinting it twice');
  assert.equal(first[20], -1, 'and the simple texture is off');
  assert.equal(list.material[3], 0, 'the draw list is left on the simple lighting');
  list.clear();
  addGltfToDrawList(list, model, undefined, {}, layers);                               // no materials given
  const old = list.groups.get(model.instances[0].mesh).data;
  assert.equal(old[23], 0);
  assert.deepEqual([old[16], old[17], old[18]].map((v) => Math.round(v * 10) / 10), [0.9, 0.5, 0.3], 'without them the colour factor tints, as before');
  assert.equal(old[20], layers.get(0), 'and the base colour picture is the simple texture');
});
