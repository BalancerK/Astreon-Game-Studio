import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrawList3D, Camera3D, createBox, createLighting, lightType, spotAngles, planLocalShadows, resolveLocalShadowOptions, MAX_LOCAL_SHADOW_LAYERS } from '../src/index.js';
import { computeLocalMatrix } from '../src/shadow.js';
import { writeSceneUniforms, SCENE_UNIFORM_FLOATS, LIGHT_EXTRA_AT, LOCAL_SHADOW_MATRICES_AT } from '../src/webgpu3d.js';

const project = (m, x, y, z) => { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; };

test('a light is a point unless it has a direction or says otherwise', () => {
  assert.equal(lightType({ x: 0 }), 'point'); assert.equal(lightType({ direction: [0, -1, 0] }), 'spot');
  assert.equal(lightType({ type: 'area', direction: [0, -1, 0] }), 'area'); assert.equal(lightType({ type: 'point', direction: [0, -1, 0] }), 'point');
});

test('spot angles: defaults, penumbra and limits', () => {
  assert.deepEqual(spotAngles({}), { outer: 0.7, inner: 0.7 * 0.7 });
  assert.equal(spotAngles({ angle: 0.5, penumbra: 1 }).inner, 0);
  assert.equal(spotAngles({ angle: 9 }).outer, 1.5); assert.equal(spotAngles({ angle: 0 }).outer, 0.01);
});

test('local shadow options: defaults and checks', () => {
  assert.deepEqual(resolveLocalShadowOptions(true), { size: 1024, layers: 12, bias: 0.03, strength: 0.9 });
  assert.equal(resolveLocalShadowOptions({ strength: 5 }).strength, 1);
  assert.throws(() => resolveLocalShadowOptions({ size: 100.5 }), /local shadow size/); assert.throws(() => resolveLocalShadowOptions({ layers: 13 }), /local shadow layers/);
});

test('shadow layers go to the nearest lights that ask: a point light takes six and a spot light one', () => {
  const cam = { x: 0, y: 0, z: 0 };
  const lights = [
    { x: 0, y: 0, z: 30, radius: 5, castShadow: true },                                  // far point light
    { x: 0, y: 0, z: 3, radius: 5, castShadow: true, direction: [0, -1, 0] },            // near spot
    { x: 0, y: 0, z: 1, radius: 5 },                                                     // near, but does not ask
    { x: 0, y: 0, z: 2, radius: 5, castShadow: true, type: 'area' },                     // area lights cast none
    { x: 0, y: 0, z: 10, radius: 5, castShadow: true },                                  // point
  ];
  const p = planLocalShadows(lights, cam, 12);
  assert.deepEqual(Array.from(p.slots), [-1, 0, -1, -1, 1], 'the spot (1 layer) and the nearer point light (6) fit; the far point light would be a 13th layer');
  assert.deepEqual(p.layers.map((l) => l.light), [1, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(p.layers.slice(1).map((l) => l.face), [0, 1, 2, 3, 4, 5]);
  const tight = planLocalShadows(lights, cam, 6);
  assert.deepEqual(Array.from(tight.slots), [-1, 0, -1, -1, -1], 'a point light that does not fit is skipped; the smaller spot light still fits');
  assert.equal(planLocalShadows([], cam, 12).layers.length, 0);
});

test('a spot light matrix puts points inside its cone inside the map, and points outside it outside', () => {
  const m = new Float64Array(16), light = { x: 1, y: 5, z: 2, radius: 20, direction: [0, -1, 0], angle: 0.5 };
  const texel = computeLocalMatrix(m, light, 0, 1024);
  assert.ok(texel > 0.001 && texel < 0.002, `texel ${texel}`);
  const inside = project(m, 1.5, 0, 2), edgeIn = project(m, 1 + 5 * Math.tan(0.45), 0, 2), outside = project(m, 1 + 5 * Math.tan(0.8), 0, 2);
  assert.ok(Math.abs(inside[0]) < 0.3 && Math.abs(inside[1]) < 0.05 && inside[2] > 0 && inside[2] < 1, JSON.stringify(inside));
  assert.ok(Math.abs(edgeIn[0]) < 1 && Math.abs(outside[0]) > 1, `${edgeIn[0]} ${outside[0]}`);
  assert.ok(project(m, 1, 4.9, 2)[2] < project(m, 1, 0, 2)[2], 'nearer to the light is smaller depth');
});

test('the six faces of a point light each hold the direction of their axis, and together cover every direction', () => {
  const light = { x: 3, y: 2, z: -1, radius: 12 }, ms = Array.from({ length: 6 }, () => new Float64Array(16));
  ms.forEach((m, f) => computeLocalMatrix(m, light, f, 512));
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  axes.forEach((a, f) => {
    const p = project(ms[f], light.x + a[0] * 5, light.y + a[1] * 5, light.z + a[2] * 5);
    assert.ok(Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6 && p[2] > 0 && p[2] < 1, `face ${f}: ${p}`);
  });
  // any direction is inside the face its biggest component picks (the order the shader uses: +x -x +y -y +z -z)
  for (let i = 0; i < 200; i++) {
    const d = [Math.sin(i * 12.9898), Math.cos(i * 78.233), Math.sin(i * 37.719 + 1)], a = d.map(Math.abs), major = a.indexOf(Math.max(...a));
    const face = major * 2 + (d[major] > 0 ? 0 : 1);
    const p = project(ms[face], light.x + d[0] * 4, light.y + d[1] * 4, light.z + d[2] * 4);
    assert.ok(Math.abs(p[0]) <= 1 && Math.abs(p[1]) <= 1 && p[2] >= 0 && p[2] <= 1, `direction ${d} face ${face}: ${p}`);
  }
});

test('the scene block carries each light kind, cone, panel and shadow slot, and the shadow matrices', () => {
  const cam = new Camera3D({}).update(), out = new Float32Array(SCENE_UNIFORM_FLOATS);
  const lights = [
    { x: 1, y: 2, z: 3, radius: 9, color: [1, 0.5, 0.25], intensity: 2 },
    { x: 0, y: 5, z: 0, radius: 9, direction: [0, -2, 0], angle: 0.5, penumbra: 0.5, castShadow: true },
    { type: 'area', x: 0, y: 3, z: 0, radius: 9, direction: [0, 0, 1], width: 4, height: 2 },
  ];
  const matrices = [new Float32Array(16).fill(7)];
  writeSceneUniforms(out, cam, { pointLights: lights }, null, { slots: Int32Array.from([-1, 0, -1]), matrices, texels: [0, 0.003, 0], size: 512, bias: 0.05, strength: 0.8 });
  const f = (a) => Array.from(a, (v) => +v.toFixed(4));
  assert.deepEqual(f(out.slice(60, 61)), [3]);
  assert.deepEqual(f(out.slice(64, 72)), [1, 2, 3, 9, 2, 1, 0.5, -1], 'position, radius, colour times intensity, no shadow slot');
  assert.equal(out[64 + 8 + 7], 0, 'the spot light shadow slot');
  const x = (k) => LIGHT_EXTRA_AT + k * 12;
  assert.deepEqual(f(out.slice(x(0), x(0) + 4)), [0, -1, 0, 0], 'a point light: default direction, kind 0');
  assert.deepEqual(f(out.slice(x(1), x(1) + 8)), [0, -1, 0, 1, +Math.cos(0.5).toFixed(4), +(1 / (Math.cos(0.25) - Math.cos(0.5))).toFixed(4), 0.003, 0.05], 'a spot light: unit direction, kind 1, cone, texel, bias');
  assert.deepEqual(f(out.slice(x(2), x(2) + 6)), [0, 0, 1, 2, 2, 1], 'an area light: kind 2, half the width and height');
  const right = f(out.slice(x(2) + 8, x(2) + 11));
  assert.ok(Math.abs(Math.hypot(...right) - 1) < 1e-3 && Math.abs(right[2]) < 1e-3 && Math.abs(right[1]) < 1e-3, `right axis ${right}: level and square to the panel`);
  assert.deepEqual(f(out.slice(LOCAL_SHADOW_MATRICES_AT, LOCAL_SHADOW_MATRICES_AT + 2)), [7, 7]);
  const info = LOCAL_SHADOW_MATRICES_AT + MAX_LOCAL_SHADOW_LAYERS * 16;
  assert.deepEqual(f(out.slice(info, info + 2)), [+(1 / 512).toFixed(4), 0.8]);
  writeSceneUniforms(out, cam, { pointLights: lights });
  assert.equal(out[64 + 8 + 7], -1, 'without a plan no light has a shadow slot');
  assert.equal(SCENE_UNIFORM_FLOATS % 4, 0);
});

test('the draw list keeps what is out of view but inside the reach of a light that casts shadows', () => {
  const cam = new Camera3D({ x: 0, y: 2, z: 10, yaw: 0, fovY: 0.9, viewW: 320, viewH: 180, far: 100 }).update(), box = createBox(1, 1, 1);
  const at = (x, y, z) => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const count = (shadows, ...places) => { const l = new DrawList3D(); l.setCamera(cam, shadows); for (const p of places) l.add(box, at(...p)); return l; };
  const behind = [0, 2, 25];
  assert.equal(count(undefined, behind).count, 0, 'behind the camera: dropped');
  const light = { x: 0, y: 4, z: 28, radius: 10, castShadow: true };
  assert.equal(count({ lights: [light] }, behind).count, 1, 'inside the reach of a shadow-casting light: kept');
  assert.equal(count({ lights: [{ ...light, castShadow: false }] }, behind).count, 0, 'a light that does not cast shadows keeps nothing');
  assert.equal(count({ lights: [{ ...light, type: 'area' }] }, behind).count, 0, 'nor does an area light');
  assert.equal(count({ lights: [{ ...light, radius: 2 }] }, behind).count, 0, 'out of its reach: dropped');
  assert.equal(count({ lights: [light] }, [0, 2, 0], behind).count, 2);
  const l = count({ lights: [light] }, behind); l.setCamera(cam); assert.equal(l.localCasters, null, 'setCamera starts again');
});

test('the default lighting has no lights', () => {
  assert.deepEqual(createLighting().pointLights, []);
});
