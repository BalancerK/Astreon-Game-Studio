import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Atlas, SpriteBatch, Camera, INSTANCE_WORDS, Lighting2D, Light2D, packLighting, lightPixel, shadowRing, ringVisibility, MAX_LIGHTS, MAX_SHADOW_LIGHTS, SHADOW_ANGLES, packTint,
} from '../src/index.js';
import { META_UNLIT, META_SDF } from '../src/batch.js';
import { LIGHT_TYPE, LIGHTING_UNIFORM_FLOATS } from '../src/lighting.js';

const near = (a, b, eps = 1e-4, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const cam = (o = {}) => new Camera({ x: 100, y: 75, zoom: 1, viewW: 200, viewH: 150, ...o });
const pack = (lighting, o = {}, camera = cam()) => packLighting(lighting, camera, { dpr: 1, width: 200, height: 150, ...o });
const FLAT = [0, 0, 1];

function fakeAtlas(o = {}) {
  const calls = [];
  const ctx = () => ({ save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() { calls.push(['fillRect', ...arguments]); }, set fillStyle(v) { calls.push(['fill', v]); } });
  const atlas = new Atlas({ size: 64, maxPages: 3, createCanvas: () => { const c = { getContext: () => ctx() }; return c; }, ...o });
  return { atlas, calls };
}

// ------------------------------------------------------------------ atlas and batch

test('normal maps: a twin page for every page, flat where nothing was painted, and new pages get one too', () => {
  const { atlas, calls } = fakeAtlas();
  assert.equal(atlas.hasNormals, false); assert.equal(atlas.pages[0].normals, null);
  const a = atlas.add('a', 20, 20, () => {});
  assert.equal(atlas.hasNormals, false, 'sprites without normal maps cost nothing');
  atlas.setNormal('a', (g, x, y, w, h) => g.fillRect(x, y, w, h));
  assert.equal(atlas.hasNormals, true); assert.ok(atlas.pages[0].normals, 'the first page has a twin'); assert.equal(atlas.pages[0].normals.version, 1);
  assert.ok(calls.some((c) => c[0] === 'fill' && c[1] === 'rgb(128,128,255)'), 'flat is painted first');
  atlas.add('b', 40, 40, () => {}); atlas.add('c', 40, 40, () => {});
  assert.equal(atlas.pages.length, 2); assert.ok(atlas.pages[1].normals, 'a page added later has a twin too');
  const d = atlas.add('d', 10, 10, () => {}, { normal: () => {} });
  assert.equal(atlas.pages[d.page].normals.version >= 1, true);
  const v = atlas.version; atlas.setNormal('a', () => {}); assert.ok(atlas.version > v, 'repainting counts as a change');
  assert.throws(() => atlas.setNormal('missing', () => {}), /no sprite/);
  void a;
});

test('unlit sprites carry a flag in the instance data', () => {
  const { atlas } = fakeAtlas();
  const lit = atlas.add('lit', 8, 8, () => {}), unlit = atlas.add('unlit', 8, 8, () => {}, { unlit: true });
  assert.equal(lit.unlit, false); assert.equal(unlit.unlit, true);
  const b = new SpriteBatch(4); b.push(0, 0, 8, 8, 0, lit); b.push(0, 0, 8, 8, 0, unlit); b.push(0, 0, 8, 8, 0, { ...unlit, sdf: true });
  assert.equal(b.u32[10] & META_UNLIT, 0); assert.equal(b.u32[INSTANCE_WORDS + 10] & META_UNLIT, META_UNLIT); assert.equal(b.u32[2 * INSTANCE_WORDS + 10] & (META_UNLIT | META_SDF), META_UNLIT | META_SDF);
});

// ------------------------------------------------------------------ packing

test('lights: the lighting object holds, adds and removes lights', () => {
  const l = new Lighting2D({ ambient: '#102030' });
  const a = l.add(Light2D.point({ x: 1 })), b = l.add(Light2D.spot({ x: 2 })); l.add(Light2D.directional());
  assert.equal(l.lights.length, 3); l.remove(b); assert.deepEqual(l.lights.map((x) => x.type), ['point', 'directional']); l.remove({}); assert.equal(l.lights.length, 2); l.clear(); assert.equal(l.lights.length, 0);
  assert.equal(a.radius, 150); assert.equal(Light2D.spot({}).cone, Math.PI / 3); assert.equal(l.enabled, true); assert.equal(l.selfShadow, false);
});

test('packing: header, ambient, and one block of four vectors for each light, in canvas pixels', () => {
  const l = new Lighting2D({ ambient: '#ff8000', bump: 0.5, specular: 0.4, shininess: 12, selfShadow: true });
  l.add(Light2D.point({ x: 100, y: 75, radius: 50, color: '#ff0000', intensity: 2, height: 10, falloff: 3, size: 4 }));
  const p = pack(l, { hasOccluders: true, hasNormals: true });
  assert.equal(p.data.length, LIGHTING_UNIFORM_FLOATS); assert.equal(p.count, 1); assert.equal(p.dropped, 0);
  assert.deepEqual(Array.from(p.data.slice(0, 4)).map((v) => +v.toFixed(3)), [1, 0.502, 0, 1]);
  assert.deepEqual([p.data[4], +p.data[5].toFixed(4), p.data[6], p.data[7]], [12, 0.4, 1, SHADOW_ANGLES]); assert.deepEqual([p.data[8], p.data[9], p.data[10], p.data[12], p.data[13]], [200, 150, 1, 0.5, 1]);
  const o = 16; assert.deepEqual(Array.from(p.data.slice(o, o + 4)), [100, 75, 10, 50], 'position, height, radius'); assert.deepEqual(Array.from(p.data.slice(o + 4, o + 8)), [2, 0, 0, LIGHT_TYPE.point], 'colour times intensity, then the kind');
  assert.equal(p.data[o + 12], 3); assert.equal(p.data[o + 13], -1, 'no shadows asked for'); assert.equal(p.data[o + 14], 4);
  assert.equal(pack(l).data[10], 0, 'no occluders, no mask');
});

test('packing: the camera moves and scales the lights, and the pixel ratio scales sizes', () => {
  const l = new Lighting2D(); l.add(Light2D.point({ x: 120, y: 90, radius: 20, height: 5 }));
  const c = cam({ x: 110, y: 80, zoom: 2 });
  const p = pack(l, { dpr: 2, width: 400, height: 300 }, c);
  assert.deepEqual(Array.from(p.data.slice(16, 20)), [((120 - 110) * 2 + 100) * 2, ((90 - 80) * 2 + 75) * 2, 5 * 2 * 2, 20 * 2 * 2]);
  const h = new Lighting2D(); h.add(Light2D.point({ x: 0, y: 0, radius: 100 })); assert.equal(pack(h).data[16 + 2], 35, 'default height is a third of the radius');
});

test('packing: lights that cannot touch the screen are skipped, and extra ones are dropped, farthest first', () => {
  const l = new Lighting2D(); l.add(Light2D.point({ x: 1000, y: 75, radius: 50 })); l.add(Light2D.point({ x: 100, y: 75, radius: 50 })); l.add(Light2D.point({ x: 100, y: 75, radius: 50, intensity: 0 }));
  assert.equal(pack(l).count, 1, 'off screen and dark lights are skipped');
  const many = new Lighting2D();
  for (let i = 0; i < MAX_LIGHTS + 5; i++) many.add(Light2D.point({ x: i < MAX_LIGHTS ? 100 + (i % 7) : 195, y: i < MAX_LIGHTS ? 75 + (i % 5) : 148, radius: 30 }));
  const p = pack(many); assert.equal(p.count, MAX_LIGHTS); assert.equal(p.dropped, 5);
  const xs = []; for (let i = 0; i < p.count; i++) xs.push(p.data[(4 + i * 4) * 4]); assert.ok(xs.every((x) => x < 150), 'the ones kept are those nearest the middle');
  const sun = new Lighting2D(); sun.add(Light2D.directional({})); assert.equal(pack(sun).count, 1, 'a sun has no position to cull');
});

test('packing: shadow-casting lights get rows, up to the limit; the sun needs a length', () => {
  const l = new Lighting2D();
  for (let i = 0; i < MAX_SHADOW_LIGHTS + 3; i++) l.add(Light2D.point({ x: 100 + i, y: 75, radius: 40, shadows: true }));
  const p = pack(l, { hasOccluders: true });
  assert.equal(p.shadowRows.length, MAX_SHADOW_LIGHTS); assert.deepEqual(p.shadowRows[0], { x: 100, y: 75, radius: 40 });
  const rows = []; for (let i = 0; i < p.count; i++) rows.push(p.data[(4 + i * 4) * 4 + 13]); assert.equal(rows.filter((r) => r >= 0).length, MAX_SHADOW_LIGHTS); assert.equal(rows.filter((r) => r === -1).length, 3, 'the rest light without shadows');
  assert.equal(pack(l).shadowRows.length, 0, 'no occluders, no rows');
  const s = new Lighting2D(); s.add(Light2D.directional({ shadows: true, shadowLength: 50 })); assert.equal(pack(s, { hasOccluders: true }).sun, true); assert.equal(pack(s).sun, false);
});

test('packing: spot cones and the sun are stored as the shader reads them', () => {
  const l = new Lighting2D(); l.add(Light2D.spot({ x: 100, y: 75, angle: Math.PI / 2, cone: 1, softness: 0.5, radius: 50 })); l.add(Light2D.directional({ angle: 0, elevation: Math.PI / 2 }));
  const p = pack(l), sunAt = (4 + 0 * 4) * 4, spotAt = (4 + 1 * 4) * 4;
  assert.equal(p.data[sunAt + 7], LIGHT_TYPE.directional, 'the sun sorts first'); near(p.data[sunAt + 10], Math.sin(Math.PI / 2), 1e-6); assert.equal(Math.abs(p.data[sunAt + 8]) < 0.06, true, 'straight overhead has almost no sideways part');
  assert.equal(p.data[spotAt + 7], LIGHT_TYPE.spot); near(p.data[spotAt + 8], 0, 1e-6); near(p.data[spotAt + 9], 1, 1e-6); near(p.data[spotAt + 10], Math.cos(0.5), 1e-6); near(p.data[spotAt + 11], Math.cos(0.25), 1e-6);
});

// ------------------------------------------------------------------ the shading maths

const lit = (lighting, x, y, normal = FLAT, lookups, o) => lightPixel(pack(lighting, o), x, y, normal, lookups);

test('shading: ambient alone, and a flat surface under a point light is simply the falloff', () => {
  const l = new Lighting2D({ ambient: '#404040' });
  near(lit(l, 50, 50).light[0], 64 / 255, 1e-6);
  l.add(Light2D.point({ x: 100, y: 75, radius: 60, color: '#ffffff', height: 20, falloff: 2 }));
  const centre = lit(l, 100, 75).light[0], mid = lit(l, 130, 75).light[0], edge = lit(l, 158, 75).light[0], outside = lit(l, 170, 75).light[0];
  near(centre, 64 / 255 + 1, 1e-6, 'full strength at the middle'); assert.ok(mid < centre && edge < mid && edge > 64 / 255, 'fades with distance'); near(outside, 64 / 255, 1e-6, 'nothing past the radius');
  near(mid, 64 / 255 + (1 - 0.25) ** 2, 1e-6, '(1 - (d/r)^2) to the falloff power, with no extra darkening on a flat surface');
  const soft = new Lighting2D({ ambient: '#000000' }); soft.add(Light2D.point({ x: 100, y: 75, radius: 60, falloff: 1 })); assert.ok(lit(soft, 130, 75).light[0] > mid - 64 / 255, 'a lower falloff is gentler');
});

test('shading: the surface that faces the light is brighter, and bump scales the tilt', () => {
  const l = new Lighting2D({ ambient: '#000000' }); l.add(Light2D.point({ x: 60, y: 75, radius: 120, height: 25 }));
  const towards = lit(l, 100, 75, [-0.7, 0, 0.714]).light[0], away = lit(l, 100, 75, [0.7, 0, 0.714]).light[0], flat = lit(l, 100, 75).light[0];
  assert.ok(towards > flat && flat > away, `${towards} > ${flat} > ${away}`); assert.ok(away >= 0);
  const noBump = new Lighting2D({ ambient: '#000000', bump: 0 }); noBump.add(Light2D.point({ x: 60, y: 75, radius: 120, height: 25 }));
  near(lit(noBump, 100, 75, [-0.7, 0, 0.714]).light[0], flat, 1e-6, 'bump 0 is flat'); const strong = new Lighting2D({ ambient: '#000', bump: 2 }); strong.add(Light2D.point({ x: 60, y: 75, radius: 120, height: 25 }));
  assert.ok(lit(strong, 100, 75, [-0.5, 0, 0.866]).light[0] > lit(l, 100, 75, [-0.5, 0, 0.866]).light[0], 'a bigger bump tilts more');
  near(lit(l, 100, 75, [0, 0, 1]).light[0], lit(l, 100, 75, [0, 0, 5]).light[0], 1e-6, 'normals are normalised');
});

test('shading: a spot light lights its cone, with a soft edge, and nothing behind it', () => {
  const l = new Lighting2D({ ambient: '#000000' }); l.add(Light2D.spot({ x: 20, y: 75, angle: 0, cone: 1, softness: 0.5, radius: 150, height: 20 }));
  const on = lit(l, 90, 75).light[0], edge = lit(l, 90, 75 + 70 * Math.tan(0.4)).light[0], off = lit(l, 90, 75 + 70 * Math.tan(0.6)).light[0], behind = lit(l, 5, 75).light[0];
  assert.ok(on > 0.2); assert.ok(edge > 0 && edge < on, 'inside the soft edge'); near(off, 0, 1e-9, 'outside the cone'); near(behind, 0, 1e-9);
  const hard = new Lighting2D({ ambient: '#000000' }); hard.add(Light2D.spot({ x: 20, y: 75, angle: 0, cone: 1, softness: 0, radius: 150, height: 20 }));
  assert.ok(lit(hard, 90, 75 + 70 * Math.tan(0.45)).light[0] > 0 && lit(hard, 90, 75 + 70 * Math.tan(0.55)).light[0] === 0, 'softness 0 is a sharp edge');
  const turned = new Lighting2D({ ambient: '#000000' }); turned.add(Light2D.spot({ x: 20, y: 75, angle: Math.PI / 2, cone: 1, radius: 150, height: 20 })); assert.ok(lit(turned, 20, 130).light[0] > 0 && lit(turned, 90, 75).light[0] === 0, 'angle turns it');
});

test('shading: a sun lights everywhere equally, and its elevation decides how a tilted surface is lit', () => {
  const l = new Lighting2D({ ambient: '#000000' }); l.add(Light2D.directional({ angle: 0, elevation: 0.5, intensity: 0.8 }));
  near(lit(l, 10, 10).light[0], lit(l, 190, 140).light[0], 1e-9, 'no position, no fade'); near(lit(l, 10, 10).light[0], 0.8, 1e-6, 'a flat surface is lit by the whole intensity');
  const facing = lit(l, 50, 50, [-0.5, 0, 0.866]).light[0], away = lit(l, 50, 50, [0.5, 0, 0.866]).light[0]; assert.ok(facing > 0.8 && away < 0.8, 'the sun travels right, so a surface leaning left is turned toward it');
});

test('shading: specular adds shine on tilted surfaces only, never on a flat one', () => {
  const l = new Lighting2D({ ambient: '#000', specular: 0.8, shininess: 30 }); l.add(Light2D.point({ x: 100, y: 75, radius: 100, height: 40 }));
  assert.deepEqual(lit(l, 100, 75).shine, [0, 0, 0], 'a flat surface does not shine'); const tilted = lit(l, 140, 75, [-0.4, 0, 0.917]).shine[0]; assert.ok(tilted >= 0);
  const peaks = [-0.1, -0.3, -0.5, -0.7].map((nx) => lit(l, 140, 75, [nx, 0, Math.sqrt(1 - nx * nx)]).shine[0]); assert.ok(Math.max(...peaks) > 0.05, `somewhere it shines: ${peaks}`);
  const off = new Lighting2D({ ambient: '#000' }); off.add(Light2D.point({ x: 100, y: 75, radius: 100, height: 40 })); assert.deepEqual(lit(off, 140, 75, [-0.4, 0, 0.917]).shine, [0, 0, 0], 'specular 0 is off');
});

test('shadows: the shadow ring is the distance to the first thing in the way, as a fraction of the radius', () => {
  const wall = (x, y) => (x >= 120 && x < 130 && y >= 60 && y < 90 ? 1 : 0);
  const ring = shadowRing(wall, 100, 75, 60);
  assert.equal(ring.length, SHADOW_ANGLES); near(ring[Math.floor(SHADOW_ANGLES * 0.0)], 20 / 60, 0.03, 'straight at the wall'); near(ring[SHADOW_ANGLES / 2], 1, 1e-9, 'the other way is clear');
  near(ring[SHADOW_ANGLES / 4], 1, 1e-9, 'straight down misses the wall'); assert.ok(ring[10] < 1 && ring[SHADOW_ANGLES - 10] < 1, 'a little to either side still hits');
  assert.ok(shadowRing(() => 0, 100, 75, 60).every((v) => v === 1), 'an empty mask is all clear'); assert.ok(shadowRing(() => 1, 100, 75, 60).every((v) => v <= 1 / 60 + 1e-9), 'a full mask blocks at once');
});

test('shadows: visible before the wall, dark behind it, soft at the edge, and bigger lamps blur more', () => {
  const wall = (x, y) => (x >= 120 && x < 130 && y >= 60 && y < 90 ? 1 : 0), ring = shadowRing(wall, 100, 75, 80);
  const at = (x, y, size = 4) => ringVisibility(ring, 80, (x - 100) / Math.hypot(x - 100, y - 75), (y - 75) / Math.hypot(x - 100, y - 75), Math.hypot(x - 100, y - 75), size);
  assert.equal(at(110, 75), 1, 'in front of the wall'); assert.equal(at(160, 75), 0, 'behind it'); assert.equal(at(130, 140), 1, 'well off to the side');
  const edgeAngle = Math.atan2(60 - 75, 20); const px = 160, py = 75 + Math.tan(edgeAngle) * 60;
  const sharp = at(px, py, 0.5), blurry = at(px, py, 20); assert.ok(sharp === 0 || sharp === 1 || sharp === 0.2 || sharp === 0.4 || sharp === 0.6 || sharp === 0.8); assert.ok(blurry > 0 && blurry < 1, `a penumbra at the edge: ${blurry}`);
  const l = new Lighting2D({ ambient: '#000' }); l.add(Light2D.point({ x: 100, y: 75, radius: 80, height: 20, shadows: true }));
  const p = packLighting(l, cam(), { dpr: 1, width: 200, height: 150, hasOccluders: true, hasNormals: false });
  const withShadow = lightPixel(p, 160, 75, FLAT, { ring: () => ring, maskAt: wall }).light[0], without = lightPixel(p, 160, 75, FLAT, {}).light[0];
  assert.equal(withShadow, 0); assert.ok(without > 0);
  const onWall = lightPixel(p, 125, 75, FLAT, { ring: () => ring, maskAt: wall }).light[0]; assert.ok(onWall > 0, 'a pixel inside the occluder is not shadowed by default');
  const s = new Lighting2D({ ambient: '#000', selfShadow: true }); s.add(Light2D.point({ x: 100, y: 75, radius: 80, height: 20, shadows: true }));
  const ps = packLighting(s, cam(), { dpr: 1, width: 200, height: 150, hasOccluders: true }); assert.equal(lightPixel(ps, 125, 75, FLAT, { ring: () => ring, maskAt: wall }).light[0], 0, 'with selfShadow it is');
});

test('shadows: a sun shadow reaches as far as its length and no further, and softens with size', () => {
  const post = (x, y) => (x >= 100 && x < 106 && y >= 70 && y < 80 ? 1 : 0);
  const l = new Lighting2D({ ambient: '#000' }); l.add(Light2D.directional({ angle: 0, elevation: 0.6, shadows: true, shadowLength: 40, size: 2 }));
  const p = packLighting(l, cam(), { dpr: 1, width: 200, height: 150, hasOccluders: true });
  const at = (x, y) => lightPixel(p, x, y, FLAT, { maskAt: post }).light[0];
  assert.equal(at(120, 75), 0, 'just behind the post'); assert.equal(at(160, 75), at(10, 10), 'past the shadow length it is lit again'); assert.ok(at(120, 120) > 0, 'not beside it'); assert.ok(at(90, 75) > 0, 'nor in front of it (the light comes from the left)');
  assert.ok(at(120, 79.5) < at(120, 100) && at(120, 79.5) >= 0, 'the edge');
});
