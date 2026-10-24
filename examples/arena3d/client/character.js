// The arena's player model, built in code (no art files): a 13-joint humanoid skeleton, three skinned meshes that share it
// (clothes tinted by the player's colour, skin, and dark details), and walk / run / idle / airborne clips.
// Coordinates: feet at y = 0, facing -z, about 1.76 m tall. Place it with its feet at the bottom of the player's capsule.
import { Skeleton, AnimationClip, createSkinnedMesh, createSphere, createBox } from '../../../packages/render/src/index.js';
import { quat } from '../../../packages/math/src/index.js';

/** Joint indices. */
export const J = Object.freeze({
  HIPS: 0, SPINE: 1, HEAD: 2, ARM_L: 3, FORE_L: 4, ARM_R: 5, FORE_R: 6,
  THIGH_L: 7, SHIN_L: 8, FOOT_L: 9, THIGH_R: 10, SHIN_R: 11, FOOT_R: 12,
});
const JOINTS = [
  { name: 'hips', parent: -1, t: [0, 0.95, 0] },
  { name: 'spine', parent: J.HIPS, t: [0, 0.15, 0] },
  { name: 'head', parent: J.SPINE, t: [0, 0.4, 0] },
  { name: 'upperArmL', parent: J.SPINE, t: [-0.28, 0.32, 0] },
  { name: 'foreArmL', parent: J.ARM_L, t: [0, -0.3, 0] },
  { name: 'upperArmR', parent: J.SPINE, t: [0.28, 0.32, 0] },
  { name: 'foreArmR', parent: J.ARM_R, t: [0, -0.3, 0] },
  { name: 'thighL', parent: J.HIPS, t: [-0.11, -0.03, 0] },
  { name: 'shinL', parent: J.THIGH_L, t: [0, -0.42, 0] },
  { name: 'footL', parent: J.SHIN_L, t: [0, -0.4, 0] },
  { name: 'thighR', parent: J.HIPS, t: [0.11, -0.03, 0] },
  { name: 'shinR', parent: J.THIGH_R, t: [0, -0.42, 0] },
  { name: 'footR', parent: J.SHIN_R, t: [0, -0.4, 0] },
];

const smooth = (t) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
/** Weight of the joint BELOW a bend at height `yb` (0 above, 1 below, blended over +-h). */
const below = (y, yb, h) => smooth((yb + h - y) / (2 * h));

/** Collects vertices with joint weights and builds a skinned mesh. */
class Part {
  constructor() { this.v = []; this.joints = []; this.weights = []; this.idx = []; }

  vertex(x, y, z, nx, ny, nz, jw) {
    this.v.push(x, y, z, nx, ny, nz);
    for (let k = 0; k < 4; k++) { this.joints.push(jw[k] ? jw[k][0] : 0); this.weights.push(jw[k] ? jw[k][1] : 0); }
    return this.v.length / 6 - 1;
  }

  /** A vertical tube through rings (listed top to bottom), closed at both ends. Each ring: {y, cx, cz, rx, rz, jw}. */
  tube(rings, segments = 10) {
    const base = this.v.length / 6;
    for (const r of rings) {
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const nx = c / r.rx, nz = sn / r.rz, len = Math.hypot(nx, nz);
        this.vertex(r.cx + c * r.rx, r.y, r.cz + sn * r.rz, nx / len, 0, nz / len, r.jw);
      }
    }
    for (let r = 0; r + 1 < rings.length; r++) for (let s = 0; s < segments; s++) {
      const i = base + r * (segments + 1) + s;
      this.idx.push(i, i + 1, i + segments + 2, i, i + segments + 2, i + segments + 1);
    }
    for (const [ring, ny] of [[rings[0], 1], [rings[rings.length - 1], -1]]) {
      const centre = this.vertex(ring.cx, ring.y, ring.cz, 0, ny, 0, ring.jw);
      const first = this.v.length / 6;
      for (let s = 0; s <= segments; s++) { const a = (s / segments) * Math.PI * 2; this.vertex(ring.cx + Math.cos(a) * ring.rx, ring.y, ring.cz + Math.sin(a) * ring.rz, 0, ny, 0, ring.jw); }
      for (let s = 0; s < segments; s++) { if (ny > 0) this.idx.push(centre, first + s + 1, first + s); else this.idx.push(centre, first + s, first + s + 1); }
    }
  }

  /** An ellipsoid following one joint. */
  sphere(cx, cy, cz, rx, ry, rz, joint) {
    const s = createSphere(1, 14, 10), base = this.v.length / 6;
    for (let i = 0; i < s.vertexCount; i++) {
      const o = i * 6, nx = s.vertices[o + 3] / rx, ny = s.vertices[o + 4] / ry, nz = s.vertices[o + 5] / rz, len = Math.hypot(nx, ny, nz);
      this.vertex(cx + s.vertices[o] * rx, cy + s.vertices[o + 1] * ry, cz + s.vertices[o + 2] * rz, nx / len, ny / len, nz / len, [[joint, 1]]);
    }
    for (const i of s.indices) this.idx.push(base + i);
  }

  /** A box following one joint. */
  box(cx, cy, cz, hx, hy, hz, joint) {
    const b = createBox(hx * 2, hy * 2, hz * 2), base = this.v.length / 6;
    for (let i = 0; i < b.vertexCount; i++) { const o = i * 6; this.vertex(cx + b.vertices[o], cy + b.vertices[o + 1], cz + b.vertices[o + 2], b.vertices[o + 3], b.vertices[o + 4], b.vertices[o + 5], [[joint, 1]]); }
    for (const i of b.indices) this.idx.push(base + i);
  }

  mesh(name) { return createSkinnedMesh(this.v, this.idx, this.joints, this.weights, JOINTS.length, name); }
}

const ring = (y, rx, rz, jw, cx = 0, cz = 0) => ({ y, cx, cz, rx, rz, jw });

function buildMeshes() {
  const body = new Part(), skin = new Part(), dark = new Part();

  // torso: hips below ~0.98 m, spine above
  const torso = (y, rx, rz) => { const w = below(y, 1.02, 0.08); return ring(y, rx, rz, [[J.SPINE, 1 - w], [J.HIPS, w]]); };
  body.tube([torso(1.52, 0.14, 0.09), torso(1.46, 0.22, 0.12), torso(1.3, 0.2, 0.115), torso(1.12, 0.17, 0.1), torso(1.0, 0.18, 0.105), torso(0.9, 0.18, 0.105)], 12);

  for (const [sx, up, fore] of [[-1, J.ARM_L, J.FORE_L], [1, J.ARM_R, J.FORE_R]]) {
    const arm = (y, r) => { const w = below(y, 1.12, 0.08); return ring(y, r, r, [[up, 1 - w], [fore, w]], sx * 0.28); };
    body.tube([arm(1.46, 0.06), arm(1.36, 0.058), arm(1.22, 0.05), arm(1.12, 0.047), arm(1.0, 0.043), arm(0.9, 0.04)], 8);
    body.sphere(sx * 0.28, 1.44, 0, 0.07, 0.07, 0.07, up); // shoulder
    skin.sphere(sx * 0.28, 0.84, 0, 0.05, 0.055, 0.05, fore); // hand
  }
  for (const [sx, thigh, shin, foot] of [[-1, J.THIGH_L, J.SHIN_L, J.FOOT_L], [1, J.THIGH_R, J.SHIN_R, J.FOOT_R]]) {
    const leg = (y, r) => {
      const knee = below(y, 0.5, 0.1), ankle = below(y, 0.1, 0.06);
      return ring(y, r, r, [[thigh, 1 - knee], [shin, knee * (1 - ankle)], [foot, knee * ankle]], sx * 0.11);
    };
    body.tube([leg(0.95, 0.105), leg(0.8, 0.1), leg(0.62, 0.085), leg(0.5, 0.075), leg(0.38, 0.065), leg(0.2, 0.055), leg(0.12, 0.055)], 8);
    dark.box(sx * 0.11, 0.045, -0.03, 0.06, 0.045, 0.11, foot); // shoe
  }
  skin.sphere(0, 1.63, 0, 0.115, 0.13, 0.12, J.HEAD);
  dark.box(0, 1.65, -0.105, 0.078, 0.035, 0.03, J.HEAD); // visor: shows which way the player faces
  return { body: body.mesh('character-body'), skin: skin.mesh('character-skin'), dark: dark.mesh('character-dark') };
}

const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const mul = (...qs) => qs.reduce((acc, q) => quat.multiply([0, 0, 0, 1], acc, q), [0, 0, 0, 1]);

/**
 * Build a looping clip by evaluating `frame(phase)` (0..1) at a number of keys. `frame` returns rotations by joint index
 * ({[joint]: quaternion}) and optionally the hips' height.
 */
function sampledClip(name, duration, frame, keys = 16) {
  const rot = new Map(), hipsY = [], times = [];
  for (let k = 0; k <= keys; k++) {
    const f = frame(k / keys);
    times.push((k / keys) * duration);
    for (const [j, q] of Object.entries(f.rot)) { if (!rot.has(+j)) rot.set(+j, []); rot.get(+j).push(...q); }
    hipsY.push(f.hipsY ?? 0.95);
  }
  const tracks = [...rot].map(([joint, values]) => ({ joint, path: 'r', times, values }));
  tracks.push({ joint: J.HIPS, path: 't', times, values: hipsY.flatMap((y) => [0, y, 0]) });
  return new AnimationClip(name, tracks, { loop: true, duration });
}

/** A walk or run cycle: legs and arms swing in opposition, the knees fold while a leg swings forward. */
function locomotionClip(name, { swing, knee, armSwing, elbow, lean, bob, twist }) {
  return sampledClip(name, 1, (phi) => {
    const a = 2 * Math.PI * phi, s = Math.sin(a), c = Math.cos(a);
    const thighL = swing * s, thighR = -swing * s;
    const kneeL = -(0.15 * knee + knee * Math.max(0, c)), kneeR = -(0.15 * knee + knee * Math.max(0, -c));
    return {
      hipsY: 0.95 - bob * (1 + Math.cos(2 * a)) / 2,
      rot: {
        [J.THIGH_L]: qx(thighL), [J.THIGH_R]: qx(thighR),
        [J.SHIN_L]: qx(kneeL), [J.SHIN_R]: qx(kneeR),
        [J.FOOT_L]: qx(-(thighL + kneeL) * 0.8), [J.FOOT_R]: qx(-(thighR + kneeR) * 0.8), // keep the soles roughly level
        [J.ARM_L]: qx(-armSwing * s), [J.ARM_R]: qx(armSwing * s),
        [J.FORE_L]: qx(elbow), [J.FORE_R]: qx(elbow),
        [J.SPINE]: mul(qx(lean), qy(twist * s)),
        [J.HEAD]: qx(-lean * 0.7),
      },
    };
  });
}

function buildClips() {
  const walk = locomotionClip('walk', { swing: 0.55, knee: 0.85, armSwing: 0.45, elbow: 0.3, lean: -0.04, bob: 0.025, twist: 0.1 });
  const run = locomotionClip('run', { swing: 0.95, knee: 1.45, armSwing: 0.9, elbow: 1.1, lean: -0.22, bob: 0.05, twist: 0.18 });
  const idle = sampledClip('idle', 3.2, (phi) => {
    const s = Math.sin(2 * Math.PI * phi);
    return {
      hipsY: 0.95 - 0.004 * (1 + s) / 2,
      rot: {
        [J.SPINE]: qx(0.015 * s), [J.HEAD]: qx(-0.01 * s),
        [J.ARM_L]: mul(qz(-0.06 - 0.015 * s), qx(0.02 * s)), [J.ARM_R]: mul(qz(0.06 + 0.015 * s), qx(0.02 * s)),
        [J.FORE_L]: qx(0.12), [J.FORE_R]: qx(0.12),
      },
    };
  }, 8);
  const air = sampledClip('air', 1, (phi) => {
    const s = Math.sin(2 * Math.PI * phi);
    return {
      hipsY: 0.95,
      rot: {
        [J.THIGH_L]: qx(0.6 + 0.05 * s), [J.THIGH_R]: qx(-0.25 - 0.05 * s),
        [J.SHIN_L]: qx(-1.0), [J.SHIN_R]: qx(-0.55),
        [J.FOOT_L]: qx(0.3), [J.FOOT_R]: qx(0.2),
        [J.ARM_L]: mul(qz(-0.9 - 0.05 * s), qx(0.3)), [J.ARM_R]: mul(qz(0.9 + 0.05 * s), qx(0.3)),
        [J.FORE_L]: qx(0.5), [J.FORE_R]: qx(0.5),
        [J.SPINE]: qx(-0.05),
      },
    };
  }, 8);
  return { walk, run, idle, air };
}

/** @returns {{skeleton: Skeleton, meshes: {body: object, skin: object, dark: object}, clips: {walk: AnimationClip, run: AnimationClip, idle: AnimationClip, air: AnimationClip}, height: number}} */
export function createCharacter() {
  return { skeleton: new Skeleton(JOINTS), meshes: buildMeshes(), clips: buildClips(), height: 1.76 };
}

/** Colours of the parts that do not take the player's tint. */
export const SKIN_COLOR = [0.93, 0.76, 0.62];
export const DARK_COLOR = [0.09, 0.09, 0.11];
