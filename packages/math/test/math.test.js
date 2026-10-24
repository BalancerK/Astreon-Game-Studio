import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PI, HALF_PI, sin, cos, sincos, tan, atan, atan2, asin, acos, wrapAngle, deltaAngle, lerpAngle, vec3, quat, mat4 } from '../src/index.js';
import { runMathSuite } from '../browser-test/suite.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (diff ${Math.abs(a - b)})`);
const worstError = (f, g, gen, n = 50_000) => { let w = 0; for (let i = 0; i < n; i++) { const x = gen(); const e = Math.abs(f(x) - g(x)); if (e > w) w = e; } return w; };

test('sin and cos agree with the reference to within one unit in the last place, everywhere games use them', () => {
  const r = rng(1);
  for (const [name, range] of [['small', 1e-3], ['ordinary', 20], ['many turns', 2e5], ['edge of the exact range', 1.5e6]]) {
    const gen = () => (r() - 0.5) * 2 * range;
    const es = worstError(sin, Math.sin, gen), ec = worstError(cos, Math.cos, gen);
    assert.ok(es <= 2.3e-16, `sin ${name}: worst error ${es}`);
    assert.ok(ec <= 2.3e-16, `cos ${name}: worst error ${ec}`);
  }
  near(worstError(sin, Math.sin, () => (r() - 0.5) * 2e-6), 0, 0, 'tiny angles are exact');
});

test('exact properties: odd and even symmetry, matching sincos, signed zero, quadrants, sin^2 + cos^2 = 1', () => {
  const r = rng(2);
  const out = [0, 0];
  for (let i = 0; i < 20_000; i++) {
    const x = (r() - 0.5) * 100;
    assert.equal(sin(-x), -sin(x), `sin is exactly odd at ${x}`);
    assert.equal(cos(-x), cos(x), `cos is exactly even at ${x}`);
    sincos(x, out);
    assert.equal(out[0], sin(x));
    assert.equal(out[1], cos(x));
    near(out[0] * out[0] + out[1] * out[1], 1, 4.5e-16, 'unit circle');
  }
  assert.ok(Object.is(sin(-0), -0) && Object.is(sin(0), 0) && cos(0) === 1 && cos(-0) === 1);
  for (const [x, s, c] of [[0, 0, 1], [HALF_PI, 1, 0], [PI, 0, -1], [3 * HALF_PI, -1, 0], [-HALF_PI, -1, 0], [PI / 6, 0.5, Math.sqrt(3) / 2], [PI / 4, Math.SQRT1_2, Math.SQRT1_2]]) {
    near(sin(x), s, 2e-16, `sin(${x})`);
    near(cos(x), c, 2e-16, `cos(${x})`);
  }
  for (const bad of [NaN, Infinity, -Infinity]) { assert.ok(Number.isNaN(sin(bad)) && Number.isNaN(cos(bad)) && Number.isNaN(tan(bad))); }
  assert.ok(Number.isNaN(sincos(NaN, out)[0]) && Number.isNaN(out[1]));
  near(sin(1e300), Math.sin(1e300), 2, 'absurd inputs still return a number in range');
  assert.ok(Math.abs(sin(1e300)) <= 1 && Math.abs(cos(1e15)) <= 1);
  // periodicity holds to the precision of the argument
  near(sin(1 + 2 * PI * 1000), sin(1), 1e-11, 'periodic');
});

test('tan, atan, asin, acos', () => {
  const r = rng(3);
  assert.ok(worstError(tan, Math.tan, () => (r() - 0.5) * 3) <= 1e-14);
  assert.ok(worstError(atan, Math.atan, () => (r() - 0.5) * 100) <= 2.3e-16);
  assert.ok(worstError(atan, Math.atan, () => (r() - 0.5) * 1e12) <= 2.3e-16);
  assert.ok(worstError(asin, Math.asin, () => r() * 2 - 1) <= 5e-16);
  assert.ok(worstError(acos, Math.acos, () => r() * 2 - 1) <= 5e-16);
  assert.equal(atan(Infinity), HALF_PI);
  assert.equal(atan(-Infinity), -HALF_PI);
  assert.ok(Number.isNaN(atan(NaN)));
  assert.ok(Object.is(atan(-0), -0));
  assert.equal(asin(1), HALF_PI); assert.equal(asin(-1), -HALF_PI); assert.equal(acos(1), 0); assert.equal(acos(-1), PI);
  for (const bad of [1.0000000000000002, -2, NaN, Infinity]) { assert.ok(Number.isNaN(asin(bad)) && Number.isNaN(acos(bad)), `domain: ${bad}`); }
  near(asin(sin(0.7)), 0.7, 3e-16);
  near(acos(cos(2.1)), 2.1, 6e-16);
  near(tan(PI / 4), 1, 3e-16);
});

test('atan2: every special case of the standard, and agreement elsewhere', () => {
  const specials = [0, -0, 1, -1, 2, -3, Infinity, -Infinity, NaN, 1e-320, -1e-320, 1e300, -1e300];
  for (const y of specials) for (const x of specials) {
    const mine = atan2(y, x), ref = Math.atan2(y, x);
    if (Number.isNaN(ref)) assert.ok(Number.isNaN(mine), `atan2(${y}, ${x})`);
    else if (Number.isFinite(x) && Number.isFinite(y) && x !== 0 && y !== 0) near(mine, ref, 2.3e-16, `atan2(${y}, ${x})`); // ordinary values may differ in the last bit between engines
    else assert.ok(Object.is(mine, ref) || Math.abs(mine - ref) <= 2.3e-16, `atan2(${y}, ${x}) = ${mine}, reference ${ref}`); // zeros and infinities are exactly specified
  }
  assert.ok(Object.is(atan2(0, 1), 0) && Object.is(atan2(-0, 1), -0), 'signed zero is kept');
  assert.equal(atan2(0, -1), PI);
  assert.equal(atan2(-0, -1), -PI);
  const r = rng(4);
  assert.ok(worstError((x) => atan2(x, 3.7), (x) => Math.atan2(x, 3.7), () => (r() - 0.5) * 40) <= 2.3e-16);
  assert.ok(worstError((x) => atan2(2.5, x), (x) => Math.atan2(2.5, x), () => (r() - 0.5) * 40) <= 2.3e-16);
  // all four quadrants, and a full circle of directions comes back as the angle it was built from
  for (let i = -170; i <= 170; i += 10) { const a = (i * PI) / 180; near(atan2(sin(a), cos(a)), a, 4.5e-16, `${i} degrees`); }
});

test('angle helpers: wrapping, shortest turn, interpolation', () => {
  assert.equal(wrapAngle(1), 1);
  assert.equal(wrapAngle(PI), PI);
  near(Math.abs(wrapAngle(3 * PI)), PI, 1e-15); // odd multiples of pi are both +pi and -pi
  near(wrapAngle(-3.5 * PI), 0.5 * PI, 1e-15);
  near(wrapAngle(100 * PI + 0.25), 0.25, 1e-12);
  near(deltaAngle(0.9 * PI, -0.9 * PI), 0.2 * PI, 1e-15, 'across the wrap: a short turn, not a long one');
  near(deltaAngle(-0.9 * PI, 0.9 * PI), -0.2 * PI, 1e-15);
  near(lerpAngle(0.9 * PI, -0.9 * PI, 0.5), PI, 1e-15, 'halfway across the seam');
  assert.equal(lerpAngle(1, 2, 0), 1);
  near(lerpAngle(1, 2, 1), 2, 1e-15);
});

test('vec3: arithmetic, handedness, safe normalisation, and look directions', () => {
  const a = [1, 2, 3], b = [4, -5, 6], o = [0, 0, 0];
  assert.deepEqual(vec3.add(o, a, b), [5, -3, 9]);
  assert.deepEqual(vec3.sub(o, a, b), [-3, 7, -3]);
  assert.deepEqual(vec3.scale(o, a, 2), [2, 4, 6]);
  assert.deepEqual(vec3.addScaled(o, a, b, 2), [9, -8, 15]);
  assert.equal(vec3.dot(a, b), 12);
  assert.equal(vec3.lengthSq([2, 3, 6]), 49);
  assert.equal(vec3.length([2, 3, 6]), 7);
  assert.equal(vec3.distance([1, 1, 1], [3, 3, 2]), 3);
  assert.deepEqual(vec3.lerp(o, [0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
  assert.deepEqual(vec3.cross(o, [1, 0, 0], [0, 1, 0]), [0, 0, 1], 'x cross y is z: right-handed');
  assert.deepEqual(vec3.cross(o, [0, 1, 0], [0, 0, 1]), [1, 0, 0]);
  const same = [1, 2, 3];
  vec3.cross(same, same, [0, 0, 1]); // output may alias an input
  assert.deepEqual(same, [2, -1, 0]);
  assert.deepEqual(vec3.normalize(o, [0, 0, 0]), [0, 0, 0], 'zero stays zero, never NaN');
  near(vec3.length(vec3.normalize(o, [3, -4, 12])), 1, 2.3e-16);

  const f = [0, 0, 0], rt = [0, 0, 0];
  vec3.forward(f, 0, 0);
  assert.equal(f[0] + 0, 0); assert.equal(f[1], 0); assert.equal(f[2], -1, 'yaw 0, pitch 0 looks down -z');
  vec3.forward(f, HALF_PI, 0); near(f[0], -1, 2e-16); near(f[2], 0, 2e-16);
  vec3.forward(f, 0, HALF_PI); near(f[1], 1, 2e-16);
  const r = rng(5);
  for (let i = 0; i < 1000; i++) {
    const yaw = (r() - 0.5) * 12, pitch = (r() - 0.5) * 3;
    vec3.forward(f, yaw, pitch); vec3.right(rt, yaw);
    near(vec3.length(f), 1, 4.5e-16, 'unit');
    near(vec3.dot(f, rt), 0, 4.5e-16, 'forward is perpendicular to right');
    near(rt[1], 0, 0, 'right is horizontal');
    const up = vec3.cross([0, 0, 0], rt, f); // right x forward = up
    assert.ok(up[1] > 0, 'right x forward points up (a right-handed frame)');
  }
});

test('quat: rotations, composition order, inverse, and agreement with the look direction', () => {
  const o = [0, 0, 0], q = [0, 0, 0, 1], p = [0, 0, 0, 1], m = [0, 0, 0, 1];
  assert.deepEqual(quat.identity(q), [0, 0, 0, 1]);
  assert.deepEqual(quat.rotate(o, q, [1, 2, 3]), [1, 2, 3], 'identity leaves vectors alone');
  quat.fromAxisAngle(q, [0, 0, 1], HALF_PI);
  const x = quat.rotate(o, q, [1, 0, 0]);
  near(x[0], 0, 5e-16); near(x[1], 1, 5e-16); near(x[2], 0, 5e-16); // a quarter turn about z takes x to y
  quat.fromAxisAngle(q, [0, 1, 0], HALF_PI);
  quat.fromAxisAngle(p, [1, 0, 0], HALF_PI);
  quat.multiply(m, q, p); // p first, then q
  const v = quat.rotate([0, 0, 0], m, [0, 0, -1]);
  const viaSteps = quat.rotate([0, 0, 0], q, quat.rotate([0, 0, 0], p, [0, 0, -1]));
  for (let i = 0; i < 3; i++) near(v[i], viaSteps[i], 4.5e-16, 'multiply(a, b) applies b first');
  const inv = quat.conjugate([0, 0, 0, 1], m);
  const back = quat.rotate([0, 0, 0], inv, quat.rotate([0, 0, 0], m, [3, -2, 5]));
  near(back[0], 3, 1e-14); near(back[1], -2, 1e-14); near(back[2], 5, 1e-14);
  assert.deepEqual(quat.normalize([0, 0, 0, 0], [0, 0, 0, 0]), [0, 0, 0, 1], 'a zero quaternion becomes the identity');
  near(quat.dot(quat.normalize([0, 0, 0, 0], [1, 2, 3, 4]), quat.normalize([0, 0, 0, 0], [1, 2, 3, 4])), 1, 2.3e-16);

  const r = rng(6), f = [0, 0, 0];
  for (let i = 0; i < 500; i++) {
    const yaw = (r() - 0.5) * 12, pitch = (r() - 0.5) * 3;
    quat.fromYawPitchRoll(q, yaw, pitch, 0);
    near(Math.hypot(...q), 1, 4.5e-16, 'unit quaternion');
    const looked = quat.rotate([0, 0, 0], q, [0, 0, -1]);
    vec3.forward(f, yaw, pitch);
    for (let k = 0; k < 3; k++) near(looked[k], f[k], 1e-15, 'rotating -z by the orientation gives forward(yaw, pitch)');
  }
  quat.fromYawPitchRoll(q, 0, 0, HALF_PI); // roll: the camera tilts, the view direction does not
  const fwd = quat.rotate([0, 0, 0], q, [0, 0, -1]);
  near(fwd[2], -1, 5e-16);
  const up = quat.rotate([0, 0, 0], q, [0, 1, 0]);
  near(up[0], -1, 5e-16);
});

test('quat interpolation: endpoints, constant angular speed, shortest arc, and unit length', () => {
  const a = quat.fromAxisAngle([0, 0, 0, 1], [0, 1, 0], 0), b = quat.fromAxisAngle([0, 0, 0, 1], [0, 1, 0], 2);
  const o = [0, 0, 0, 1];
  for (let i = 0; i < 4; i++) near(quat.slerp(o, a, b, 0)[i], a[i], 1e-15);
  for (let i = 0; i < 4; i++) near(quat.slerp(o, a, b, 1)[i], b[i], 1e-15);
  const half = quat.slerp(o, a, b, 0.5);
  const expected = quat.fromAxisAngle([0, 0, 0, 1], [0, 1, 0], 1);
  for (let i = 0; i < 4; i++) near(half[i], expected[i], 1e-15, 'halfway is half the angle');
  const angleAt = (t) => { quat.slerp(o, a, b, t); return 2 * acos(Math.min(1, Math.abs(quat.dot(o, a)))); };
  const steps = [0.1, 0.2, 0.3, 0.4, 0.5].map(angleAt);
  for (let i = 1; i < steps.length; i++) near(steps[i] - steps[i - 1], steps[0], 1e-9, 'equal steps in t are equal angles');
  // q and -q are the same rotation: interpolation must take the short way round
  const neg = [-b[0], -b[1], -b[2], -b[3]];
  const viaNeg = quat.slerp([0, 0, 0, 1], a, neg, 0.5);
  for (let i = 0; i < 4; i++) near(Math.abs(viaNeg[i]), Math.abs(expected[i]), 1e-15);
  assert.ok(Math.abs(viaNeg[3]) > 0.5, 'did not go the long way (w would be near 0 or negative)');
  const near1 = quat.fromAxisAngle([0, 0, 0, 1], [0, 1, 0], 1e-5);
  near(Math.hypot(...quat.slerp(o, a, near1, 0.3)), 1, 4.5e-16, 'nearly parallel inputs stay unit length');
  near(Math.hypot(...quat.nlerp(o, a, b, 0.37)), 1, 4.5e-16);
});

test('the whole suite is repeatable and matches the recorded golden hashes (which Chrome and Firefox also reproduce)', () => {
  const golden = JSON.parse(readFileSync(new URL('./determinism.golden.json', import.meta.url), 'utf8'));
  const a = runMathSuite().exact, b = runMathSuite().exact;
  assert.deepEqual(a, b, 'two runs in one process agree');
  assert.deepEqual(a, golden, 'results changed: if intended, run `node tools/determinism.js --update` and review the diff');
});

test('speed: about as fast as the built-ins', () => {
  const r = rng(7);
  const xs = Float64Array.from({ length: 4096 }, () => (r() - 0.5) * 20);
  const run = (f) => { let acc = 0; const t0 = performance.now(); for (let k = 0; k < 250; k++) for (let i = 0; i < xs.length; i++) acc += f(xs[i]); return [performance.now() - t0, acc]; };
  run(sin); run(Math.sin);
  const [mine] = run(sin), [theirs] = run(Math.sin); // determinism-ok: timing comparison only
  assert.ok(mine < theirs * 6 + 50, `1M sines: ${mine.toFixed(1)} ms against ${theirs.toFixed(1)} ms for Math.sin`);
});

test('mat4: composition order, inverse, projection depth range, look-at and first-person view agree with the quaternion maths', () => {
  const m = mat4.create(), a = mat4.create(), b = mat4.create(), c = mat4.create();
  assert.deepEqual([...mat4.identity(m)], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // translate * scale applies the scale first
  mat4.translation(a, 10, 0, 0); mat4.scaling(b, 2, 2, 2); mat4.multiply(c, a, b);
  assert.deepEqual([...mat4.transformPoint([0, 0, 0], c, [1, 1, 1])], [12, 2, 2]);
  // quaternion rotation matrix equals quat.rotate
  const r = rng(8), q = [0, 0, 0, 1], v = [0, 0, 0], w = [0, 0, 0];
  for (let i = 0; i < 200; i++) {
    quat.fromYawPitchRoll(q, (r() - 0.5) * 10, (r() - 0.5) * 3, (r() - 0.5) * 3);
    mat4.fromQuat(m, q);
    vec3.set(v, r() * 10 - 5, r() * 10 - 5, r() * 10 - 5);
    mat4.transformDirection(w, m, v);
    const expected = quat.rotate([0, 0, 0], q, v);
    for (let k = 0; k < 3; k++) near(w[k], expected[k], 1e-13, 'matrix and quaternion rotate the same way');
    // a general matrix times its inverse is the identity
    mat4.compose(a, r() * 20 - 10, r() * 20 - 10, r() * 20 - 10, q, 0.5 + r(), 0.5 + r(), 0.5 + r());
    assert.ok(mat4.invert(b, a));
    mat4.multiply(c, a, b);
    for (let k = 0; k < 16; k++) near(c[k], k % 5 === 0 ? 1 : 0, 1e-12, 'a * a^-1');
  }
  assert.equal(mat4.invert(b, new Float64Array(16)), false, 'a singular matrix reports it and gives the identity');
  assert.equal(b[0], 1);
  // perspective: the near plane maps to depth 0, the far plane to depth 1, the centre stays centred, the fov edge hits the border
  const near_ = 0.1, far_ = 200, fov = 1.2, aspect = 16 / 9;
  mat4.perspective(a, fov, aspect, near_, far_);
  const ndc = [0, 0, 0];
  mat4.transformPoint(ndc, a, [0, 0, -near_]); near(ndc[2], 0, 1e-12, 'near plane depth');
  mat4.transformPoint(ndc, a, [0, 0, -far_]); near(ndc[2], 1, 1e-9, 'far plane depth');
  mat4.transformPoint(ndc, a, [0, 0, -10]); near(ndc[0], 0, 0); near(ndc[1], 0, 0);
  const halfH = 10 * tan(fov / 2);
  mat4.transformPoint(ndc, a, [0, halfH, -10]); near(ndc[1], 1, 1e-12, 'the top edge of the field of view');
  mat4.transformPoint(ndc, a, [halfH * aspect, 0, -10]); near(ndc[0], 1, 1e-12, 'the right edge, widened by the aspect ratio');
  mat4.orthographic(a, -4, 4, -3, 3, 1, 11);
  mat4.transformPoint(ndc, a, [4, 3, -1]); near(ndc[0], 1, 1e-15); near(ndc[1], 1, 1e-15); near(ndc[2], 0, 1e-15);
  mat4.transformPoint(ndc, a, [-4, -3, -11]); near(ndc[0], -1, 1e-15); near(ndc[1], -1, 1e-15); near(ndc[2], 1, 1e-15);
  // look-at: the eye maps to the origin and the target straight down -z
  mat4.lookAt(a, [3, 4, 5], [1, 1, 1], [0, 1, 0]);
  mat4.transformPoint(ndc, a, [3, 4, 5]); for (let k = 0; k < 3; k++) near(ndc[k], 0, 1e-13);
  mat4.transformPoint(ndc, a, [1, 1, 1]); near(ndc[0], 0, 1e-13); near(ndc[1], 0, 1e-13); assert.ok(ndc[2] < 0, 'in front of the camera');
  near(ndc[2], -vec3.distance([3, 4, 5], [1, 1, 1]), 1e-12, 'at its distance');
  // the first-person view looks along vec3.forward(yaw, pitch)
  for (let i = 0; i < 100; i++) {
    const yaw = (r() - 0.5) * 12, pitch = (r() - 0.5) * 2.5, pos = [r() * 40 - 20, r() * 40 - 20, r() * 40 - 20];
    mat4.viewFromYawPitch(a, pos[0], pos[1], pos[2], yaw, pitch);
    const f = vec3.forward([0, 0, 0], yaw, pitch);
    const ahead = vec3.addScaled([0, 0, 0], pos, f, 7);
    mat4.transformPoint(ndc, a, ahead);
    near(ndc[0], 0, 1e-12); near(ndc[1], 0, 1e-12); near(ndc[2], -7, 1e-12);
    mat4.transformPoint(ndc, a, pos); for (let k = 0; k < 3; k++) near(ndc[k], 0, 1e-12);
  }
});
