import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostOptions, circleOfConfusion, Camera3D } from '../src/index.js';
import { writePostUniforms, writeFxUniforms, aoSize, postFxWgsl, POST_UNIFORM_FLOATS, FX_UNIFORM_FLOATS, POST_WGSL, POST_GLSL_COMPOSITE } from '../src/post.js';

test('depth effects are off unless asked for, and fill in defaults when they are', () => {
  const off = resolvePostOptions(true);
  assert.equal(off.ao, null); assert.equal(off.dof, null); assert.equal(off.fxaa, false); assert.equal(off.needsDepth, false);
  const on = resolvePostOptions({ ao: true, dof: true, fxaa: true });
  assert.deepEqual(on.ao, { radius: 0.5, intensity: 1, bias: 0.03, power: 1.5, samples: 12, scale: 1 });
  assert.deepEqual(on.dof, { focus: 10, range: 0, aperture: 1, maxBlur: 8, taps: 24 });
  assert.equal(on.fxaa, true); assert.equal(on.needsDepth, true);
  assert.equal(resolvePostOptions({ fxaa: true }).needsDepth, false, 'FXAA does not read depth');
  assert.equal(resolvePostOptions({ dof: { focus: 3 } }).needsDepth, true);
});

test('depth effect settings are clamped and checked', () => {
  const o = resolvePostOptions({ ao: { samples: 999, scale: 0.01, intensity: 5, power: -1 }, dof: { taps: 1, maxBlur: 99, focus: 4 } });
  assert.equal(o.ao.samples, 32); assert.equal(o.ao.scale, 0.25); assert.equal(o.ao.intensity, 1); assert.equal(o.ao.power, 0.1);
  assert.equal(o.dof.taps, 8); assert.equal(o.dof.maxBlur, 32);
  assert.throws(() => resolvePostOptions({ ao: { radius: 0 } }), /ao\.radius must be above 0/);
  assert.throws(() => resolvePostOptions({ dof: { focus: 0 } }), /dof\.focus must be above 0/);
});

test('an orthographic camera turns the depth effects off (and keeps FXAA)', () => {
  const o = resolvePostOptions({ ao: true, dof: true, fxaa: true }, { ortho: 5 });
  assert.equal(o.ao, null); assert.equal(o.dof, null); assert.equal(o.needsDepth, false); assert.equal(o.fxaa, true);
  assert.notEqual(resolvePostOptions({ ao: true }, { ortho: 0 }).ao, null);
});

test('the composite is told whether occlusion is on; the effects block holds camera, settings and size', () => {
  const p = resolvePostOptions({ ao: { radius: 2, bias: 0.1, intensity: 0.5, power: 2, samples: 16 }, dof: { focus: 7, range: 1, maxBlur: 5, aperture: 2, taps: 32 } });
  assert.equal(writePostUniforms(new Float32Array(POST_UNIFORM_FLOATS), p)[20], 1);
  assert.equal(writePostUniforms(new Float32Array(POST_UNIFORM_FLOATS), resolvePostOptions({}))[20], 0);
  const cam = new Camera3D({ near: 0.2, far: 500, fovY: 1, viewW: 320, viewH: 180 }).update();
  const u = writeFxUniforms(new Float32Array(FX_UNIFORM_FLOATS), p, cam, 320, 180);
  const f = (a) => Array.from(a, (v) => +v.toFixed(4));
  assert.deepEqual(f(u.slice(0, 2)), [0.2, 500]); assert.ok(Math.abs(u[3] - 1 / Math.tan(0.5)) < 1e-4, 'the vertical projection scale');
  assert.ok(Math.abs(u[2] - u[3] / (320 / 180)) < 1e-4, 'the horizontal one is smaller by the aspect');
  assert.deepEqual(f(u.slice(4, 12)), [2, 0.1, 0.5, 2, 7, 1, 5, 2]); assert.deepEqual(f(u.slice(12)), [320, 180, 16, 32]);
});

test('the occlusion image is a fraction of the screen, never under 2 pixels', () => {
  assert.deepEqual(aoSize(1920, 1080, { scale: 0.5 }), { w: 960, h: 540 });
  assert.deepEqual(aoSize(3, 3, { scale: 0.25 }), { w: 2, h: 2 });
});

test('circle of confusion: nothing at the focus or inside the range, growing away from it, capped', () => {
  const dof = { focus: 10, range: 2, aperture: 1, maxBlur: 8 };
  assert.equal(circleOfConfusion(10, dof), 0); assert.equal(circleOfConfusion(11.9, dof), 0); assert.equal(circleOfConfusion(8.1, dof), 0);
  assert.ok(circleOfConfusion(20, dof) > 0 && circleOfConfusion(40, dof) > circleOfConfusion(20, dof));
  assert.ok(circleOfConfusion(5, dof) > circleOfConfusion(15, dof), 'the same distance either side blurs the nearer side more');
  assert.equal(circleOfConfusion(1, dof), 8, 'capped at maxBlur');
  assert.equal(circleOfConfusion(1e9, { focus: 10 }), 8 * (1 - 10 / 1e9), 'defaults: aperture 1, max blur 8');
  assert.equal(circleOfConfusion(30, { focus: 10, aperture: 0 }), 0, 'a closed aperture blurs nothing');
});

test('the depth shader matches the scene\'s depth texture (multisampled or not)', () => {
  assert.match(postFxWgsl(4), /texture_depth_multisampled_2d/); assert.doesNotMatch(postFxWgsl(4), /DEPTH_TYPE/);
  assert.match(postFxWgsl(1), /var depthTex: texture_depth_2d;/);
});

test('heat haze: off unless given, up to sixteen places, checked and clamped, and written after the grade block with the count, the clock and the picture shape', () => {
  assert.deepEqual(resolvePostOptions(true).heat, []);
  const p = resolvePostOptions({ heat: [{ x: 0.5, y: 0.4, radius: 0.1 }, { x: 0.1, y: 0.9, radius: 0.2, strength: 9 }, { x: NaN, y: 0, radius: 1 }, { x: 0, y: 0, radius: 0 }, null], heatTime: 2.5 });
  assert.equal(p.heat.length, 2, 'places that are not numbers, or have no reach, are left out');
  assert.equal(p.heat[0].strength, 0.004); assert.equal(p.heat[1].strength, 0.05, 'a strength is held to a sane size');
  assert.equal(resolvePostOptions({ heat: Array.from({ length: 40 }, () => ({ x: 0.5, y: 0.5, radius: 0.1 })) }).heat.length, 16);
  const u = writePostUniforms(new Float32Array(POST_UNIFORM_FLOATS), p, 16 / 9);
  assert.equal(POST_UNIFORM_FLOATS, 24 + 64);
  assert.equal(u[21], 2); assert.equal(u[22], 2.5); assert.ok(Math.abs(u[23] - 16 / 9) < 1e-6);
  assert.deepEqual([...u.slice(24, 28)].map((v) => +v.toFixed(3)), [0.5, 0.4, 0.1, 0.004]);
  assert.equal(u[24 + 8], 0, 'an unused place is zero');
  const none = writePostUniforms(new Float32Array(POST_UNIFORM_FLOATS), resolvePostOptions(true));
  assert.equal(none[21], 0);
});

test('both shaders read the haze: the same sixteen places and the same push', () => {
  for (const [name, src] of [['wgsl', POST_WGSL], ['glsl', POST_GLSL_COMPOSITE]]) {
    assert.ok(/16/.test(src) && /1\.0 - d/.test(src) && /70\.0/.test(src), `${name} has the haze`);
  }
  assert.ok(/uniform vec4 u_gr\[22\]/.test(POST_GLSL_COMPOSITE), 'the block holds six vec4s and sixteen places');
  assert.ok(/heat: array<vec4f, 16>/.test(POST_WGSL));
});
