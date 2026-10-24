// Cross-engine determinism suite for @engine/math: hashes every result bit for bit. Run by `node tools/determinism.js`
// in Node, Chrome and Firefox: every `exact` hash must be identical everywhere. (`probe` hashes the built-in Math.*
// versions of the same functions, to show why shared code must not use them.)
import { sin, cos, sincos, tan, atan, atan2, asin, acos, wrapAngle, deltaAngle, lerpAngle, vec3, quat, mat4 } from '../src/index.js';

/** xorshift32: integer-only PRNG, identical everywhere. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}
const unit = (u) => u / 4294967296;

class Hasher {
  constructor() { this.h = 0x811c9dc5; this.f64 = new Float64Array(1); this.u32 = new Uint32Array(this.f64.buffer); }
  word(w) { for (let i = 0; i < 4; i++) this.h = Math.imul(this.h ^ ((w >>> (i * 8)) & 255), 0x01000193); }
  /** Hash the exact bit pattern of a double (all NaNs count as one; -0 and +0 differ). */
  num(v) {
    if (v !== v) { this.word(0x7ff80000); this.word(0); return; }
    this.f64[0] = v;
    this.word(this.u32[0]);
    this.word(this.u32[1]);
  }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

/** Inputs spanning what games use and what breaks libraries: small, ordinary, near multiples of pi/2, huge. */
function angles(r) {
  const out = [0, -0, 1e-300, -1e-300, 5e-324, 1e-9, Math.PI, -Math.PI, Math.PI / 2, 3 * Math.PI / 2, 2 * Math.PI, 1e5, -1e5, 1.5e6, 1e9, 1e15, 1e300];
  for (let i = 0; i < 6000; i++) out.push((unit(r()) - 0.5) * 20);               // ordinary angles
  for (let i = 0; i < 2000; i++) out.push((unit(r()) - 0.5) * 2e5);               // many turns
  for (let i = 0; i < 2000; i++) out.push(((r() % 400) - 200) * (Math.PI / 2) + (unit(r()) - 0.5) * 1e-9); // hugging the axes
  for (let i = 0; i < 500; i++) out.push((unit(r()) - 0.5) * 4e9);                // far beyond the exact range
  return out;
}

function trigSuite() {
  const r = rng(101);
  const xs = angles(r);
  const h = { sin: new Hasher(), cos: new Hasher(), tan: new Hasher(), sincos: new Hasher() };
  const sc = [0, 0];
  for (const x of xs) {
    h.sin.num(sin(x)); h.cos.num(cos(x)); h.tan.num(tan(x));
    sincos(x, sc); h.sincos.num(sc[0]); h.sincos.num(sc[1]);
  }
  return { sin: h.sin.hex, cos: h.cos.hex, tan: h.tan.hex, sincos: h.sincos.hex };
}

function inverseSuite() {
  const r = rng(102);
  const ha = new Hasher(), h2 = new Hasher(), hs = new Hasher(), hc = new Hasher();
  const specials = [0, -0, 1, -1, Infinity, -Infinity, NaN, 1e-320, -1e-320, 1e300, -1e300, 0.5, -0.5];
  for (const y of specials) for (const x of specials) h2.num(atan2(y, x));
  for (let i = 0; i < 9000; i++) {
    const v = (unit(r()) - 0.5) * (i % 3 === 0 ? 4 : i % 3 === 1 ? 400 : 1e12);
    ha.num(atan(v));
    h2.num(atan2(v, (unit(r()) - 0.5) * 50)); h2.num(atan2((unit(r()) - 0.5) * 50, v));
    const u = unit(r()) * 2 - 1;
    hs.num(asin(u)); hc.num(acos(u));
  }
  for (const v of [1, -1, 1.0000000000000002, -1.0000000000000002, 2, NaN, 0, -0]) { hs.num(asin(v)); hc.num(acos(v)); }
  return { atan: ha.hex, atan2: h2.hex, asin: hs.hex, acos: hc.hex };
}

function angleSuite() {
  const r = rng(103);
  const h = new Hasher();
  for (let i = 0; i < 6000; i++) {
    const a = (unit(r()) - 0.5) * 60, b = (unit(r()) - 0.5) * 60;
    h.num(wrapAngle(a)); h.num(deltaAngle(a, b)); h.num(lerpAngle(a, b, unit(r())));
  }
  return h.hex;
}

function vectorSuite() {
  const r = rng(104);
  const h = new Hasher();
  const a = [0, 0, 0], b = [0, 0, 0], o = [0, 0, 0];
  const rv = (v) => { v[0] = (unit(r()) - 0.5) * 200; v[1] = (unit(r()) - 0.5) * 200; v[2] = (unit(r()) - 0.5) * 200; return v; };
  for (let i = 0; i < 4000; i++) {
    rv(a); rv(b);
    vec3.add(o, a, b); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    vec3.cross(o, a, b); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    vec3.normalize(o, a); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    vec3.lerp(o, a, b, unit(r())); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    h.num(vec3.dot(a, b)); h.num(vec3.length(a)); h.num(vec3.distance(a, b));
    vec3.forward(o, (unit(r()) - 0.5) * 12, (unit(r()) - 0.5) * 3); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    vec3.right(o, (unit(r()) - 0.5) * 12); h.num(o[0]); h.num(o[1]); h.num(o[2]);
  }
  return h.hex;
}

function quaternionSuite() {
  const r = rng(105);
  const h = new Hasher();
  const q = [0, 0, 0, 1], p = [0, 0, 0, 1], m = [0, 0, 0, 1], v = [0, 0, 0], o = [0, 0, 0], axis = [0, 0, 0];
  const out4 = (x) => { h.num(x[0]); h.num(x[1]); h.num(x[2]); h.num(x[3]); };
  for (let i = 0; i < 3000; i++) {
    quat.fromYawPitchRoll(q, (unit(r()) - 0.5) * 12, (unit(r()) - 0.5) * 3, (unit(r()) - 0.5) * 6); out4(q);
    axis[0] = unit(r()) - 0.5; axis[1] = unit(r()) - 0.5; axis[2] = unit(r()) - 0.5; vec3.normalize(axis, axis);
    quat.fromAxisAngle(p, axis, (unit(r()) - 0.5) * 20); out4(p);
    quat.multiply(m, q, p); quat.normalize(m, m); out4(m);
    v[0] = (unit(r()) - 0.5) * 50; v[1] = (unit(r()) - 0.5) * 50; v[2] = (unit(r()) - 0.5) * 50;
    quat.rotate(o, m, v); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    quat.slerp(m, q, p, unit(r())); out4(m);
    quat.nlerp(m, q, p, unit(r())); out4(m);
    quat.conjugate(m, q); out4(m);
  }
  return h.hex;
}

function matrixSuite() {
  const r = rng(107);
  const h = new Hasher();
  const a = new Float64Array(16), b = new Float64Array(16), c = new Float64Array(16), d = new Float64Array(16);
  const q = [0, 0, 0, 1], p = [0, 0, 0], o = [0, 0, 0];
  const hash16 = (m) => { for (let i = 0; i < 16; i++) h.num(m[i]); };
  for (let i = 0; i < 2000; i++) {
    const yaw = (unit(r()) - 0.5) * 12, pitch = (unit(r()) - 0.5) * 3, roll = (unit(r()) - 0.5) * 2;
    mat4.perspective(a, 0.3 + unit(r()) * 2, 0.5 + unit(r()) * 2, 0.01 + unit(r()), 50 + unit(r()) * 5000); hash16(a);
    mat4.viewFromYawPitch(b, (unit(r()) - 0.5) * 100, (unit(r()) - 0.5) * 100, (unit(r()) - 0.5) * 100, yaw, pitch, roll); hash16(b);
    quat.fromYawPitchRoll(q, yaw, pitch, roll);
    mat4.compose(c, (unit(r()) - 0.5) * 50, (unit(r()) - 0.5) * 50, (unit(r()) - 0.5) * 50, q, 0.5 + unit(r()), 0.5 + unit(r()), 0.5 + unit(r())); hash16(c);
    mat4.multiply(d, a, b); hash16(d);
    mat4.multiply(d, d, c); hash16(d);
    h.word(mat4.invert(d, d) ? 1 : 0); hash16(d);
    p[0] = (unit(r()) - 0.5) * 20; p[1] = (unit(r()) - 0.5) * 20; p[2] = -1 - unit(r()) * 30;
    mat4.transformPoint(o, a, p); h.num(o[0]); h.num(o[1]); h.num(o[2]);
    vec3.set(p, (unit(r()) - 0.5) * 30, (unit(r()) - 0.5) * 30, (unit(r()) - 0.5) * 30);
    mat4.lookAt(c, p, [0, 0, 0], [0, 1, 0]); hash16(c);
    mat4.orthographic(c, -10, 10, -5, 5, 0.1, 100); hash16(c);
  }
  return h.hex;
}

/** The built-in versions of the same functions: allowed to differ between engines. */
function probes() {
  const r = rng(106);
  const xs = angles(r);
  const out = {};
  for (const [name, fn] of Object.entries({ sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: (x) => Math.atan2(x, 3.7), asin: (x) => Math.asin(Math.max(-1, Math.min(1, x))), acos: (x) => Math.acos(Math.max(-1, Math.min(1, x))) })) { // determinism-ok: deliberate probe of unspecified functions
    const h = new Hasher();
    for (const x of xs) h.num(fn(x));
    out[name] = h.hex;
  }
  return out;
}

/** @returns {{exact: Record<string, string>, probe: Record<string, string>}} */
export function runMathSuite() {
  const t = trigSuite(), i = inverseSuite();
  return {
    exact: {
      'math.sin': t.sin, 'math.cos': t.cos, 'math.tan': t.tan, 'math.sincos': t.sincos,
      'math.atan': i.atan, 'math.atan2': i.atan2, 'math.asin': i.asin, 'math.acos': i.acos,
      'math.angles': angleSuite(), 'math.vec3': vectorSuite(), 'math.quat': quaternionSuite(), 'math.mat4': matrixSuite(),
    },
    probe: Object.fromEntries(Object.entries(probes()).map(([k, v]) => [`math.${k}`, v])),
  };
}
