import { quat } from '../../math/src/index.js';
import { AnimationClip, samplePose } from './skeleton.js';

/**
 * Inverse kinematics and animation retargeting for `Skeleton` poses. Presentation only, like the rest of the skeleton code: it runs on clients, after the animator has
 * produced a pose, and changes the local rotations in that pose (never the deterministic simulation).
 *
 * All positions and directions are in the skeleton's *model space*: the space of `skeleton.jointWorld(i)`, which includes `skeleton.rootMatrix`. To aim a foot at a point in the
 * world, move the point into the character's model space first (multiply by the inverse of the matrix you draw the character with).
 *
 * - `solveTwoBone`: an arm or a leg (three joints) reaches a target, bending toward a pole point (the knee or elbow direction).
 * - `solveChain`: any number of joints (a tail, a spine, a tentacle, a rope) reach a target (FABRIK).
 * - `aimJoint`: turn a joint (a head, a turret, an eye) to look at a point, with an angle limit.
 * - `autoMapJoints`, `retargetPose`, `retargetClip`: play an animation made for one skeleton on another with different proportions or rest pose.
 */

const rotOf = new Float64Array(4);

/** Rotation (unit quaternion, [x, y, z, w]) of a 4x4 matrix's upper 3x3, ignoring uniform scale. @param {ArrayLike<number>} m @param {number[] | Float64Array} out */
function matrixRotation(m, out) {
  let ax = m[0], ay = m[1], az = m[2], bx = m[4], by = m[5], bz = m[6], cx = m[8], cy = m[9], cz = m[10];
  const sa = Math.hypot(ax, ay, az) || 1, sb = Math.hypot(bx, by, bz) || 1, sc = Math.hypot(cx, cy, cz) || 1;
  ax /= sa; ay /= sa; az /= sa; bx /= sb; by /= sb; bz /= sb; cx /= sc; cy /= sc; cz /= sc;
  const trace = ax + by + cz;
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); out[3] = 0.25 / s; out[0] = (bz - cy) * s; out[1] = (cx - az) * s; out[2] = (ay - bx) * s; }
  else if (ax > by && ax > cz) { const s = 2 * Math.sqrt(1 + ax - by - cz); out[3] = (bz - cy) / s; out[0] = 0.25 * s; out[1] = (bx + ay) / s; out[2] = (cx + az) / s; }
  else if (by > cz) { const s = 2 * Math.sqrt(1 + by - ax - cz); out[3] = (cx - az) / s; out[0] = (bx + ay) / s; out[1] = 0.25 * s; out[2] = (cy + bz) / s; }
  else { const s = 2 * Math.sqrt(1 + cz - ax - by); out[3] = (ay - bx) / s; out[0] = (cx + az) / s; out[1] = (cy + bz) / s; out[2] = 0.25 * s; }
  return quat.normalize(out, out);
}

const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const mul = (a, b) => quat.multiply([0, 0, 0, 1], a, b);
const rot = (q, v) => quat.rotate([0, 0, 0], q, v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

/** The shortest rotation taking direction u to direction v (both need not be unit length). */
function fromTo(u, v) {
  const a = norm(u), b = norm(v), d = dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) { // opposite: turn half a circle about any axis square to u
    const axis = norm(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  return quat.normalize([0, 0, 0, 1], [c[0], c[1], c[2], 1 + d]);
}

/** World positions and rotations of every joint for a pose (model space). */
function worldOf(skeleton, pose) {
  skeleton.computePalette(pose, scratchPalette(skeleton));
  const n = skeleton.count, pos = new Array(n), rotq = new Array(n);
  for (let i = 0; i < n; i++) { const m = skeleton.jointWorld(i); pos[i] = [m[12], m[13], m[14]]; rotq[i] = Array.from(matrixRotation(m, rotOf)); }
  return { pos, rot: rotq };
}
const palettes = new WeakMap();
const scratchPalette = (skeleton) => { let p = palettes.get(skeleton); if (!p) { p = new Float32Array(skeleton.count * 16); palettes.set(skeleton, p); } return p; };

/** Rotation of what joint i hangs from (the parent joint, or the skeleton's root matrix). */
function parentRotation(skeleton, world, i) {
  const p = skeleton.parents[i];
  return p >= 0 ? world.rot[p] : Array.from(matrixRotation(skeleton.rootMatrix, rotOf));
}

/** Set joint i's local rotation in `pose` so its world rotation becomes `wr`, blended from the pose's current rotation by `weight`. */
function setWorldRotation(skeleton, pose, world, i, wr, weight) {
  const local = mul(conj(parentRotation(skeleton, world, i)), wr);
  const cur = [pose.r[i * 4], pose.r[i * 4 + 1], pose.r[i * 4 + 2], pose.r[i * 4 + 3]];
  const out = [0, 0, 0, 1];
  if (weight >= 1) quat.normalize(out, local); else quat.nlerp(out, cur, local, weight);
  for (let k = 0; k < 4; k++) pose.r[i * 4 + k] = out[k];
}

/**
 * Reach a target with a three-joint limb (an arm: shoulder, elbow, wrist; a leg: hip, knee, ankle) by the exact two-bone solution: the limb bends at the middle joint, in the plane
 * that holds the pole point, and stretches straight toward a target that is out of reach (it never overextends or folds past straight). Edits the rotations of `root` and `mid` in `pose`.
 * `mid` must be a child of `root` and `end` a child of `mid`.
 * @param {import('./skeleton.js').Skeleton} skeleton @param {import('./skeleton.js').Pose} pose
 * @param {{root: number, mid: number, end: number, target: ArrayLike<number>, pole?: ArrayLike<number>, weight?: number, endRotation?: ArrayLike<number>}} o
 *   `target`: where the end joint should go. `pole`: a point the middle joint should bend toward (a knee points forward: put the pole in front of the knee); without it the limb keeps the side it is bent to now.
 *   `weight` 0..1: how much of the solution to apply (0 leaves the pose, 1 reaches fully), for fading IK in and out. `endRotation`: a world rotation (quaternion) to give the end joint (a foot lying flat on a slope).
 * @returns {{reached: boolean, distance: number}} Whether the target was within reach, and how far from the end joint it now is.
 */
export function solveTwoBone(skeleton, pose, { root, mid, end, target, pole, weight = 1, endRotation }) {
  if (skeleton.parents[mid] !== root || skeleton.parents[end] !== mid) throw new Error('solveTwoBone needs mid to be a child of root and end a child of mid');
  if (weight <= 0) return { reached: false, distance: Infinity };
  let w = worldOf(skeleton, pose);
  const a = w.pos[root], b = w.pos[mid], c = w.pos[end];
  const lab = len(sub(b, a)), lbc = len(sub(c, b));
  if (lab < 1e-9 || lbc < 1e-9) return { reached: false, distance: len(sub(c, target)) };
  const toTarget = sub(target, a), want = len(toTarget);
  const reach = lab + lbc, floor = Math.abs(lab - lbc);
  const lat = Math.max(floor + 1e-6, Math.min(reach - 1e-6, want));            // the distance the end joint will really be at
  const d = norm(toTarget);
  const along = (lab * lab - lbc * lbc + lat * lat) / (2 * lat);
  const h = Math.sqrt(Math.max(lab * lab - along * along, 0));
  let side = pole ? sub(pole, a) : sub(b, a);                                  // the bend toward the pole, or the way it is bent now
  side = sub(side, scale(d, dot(side, d)));
  if (len(side) < 1e-6) { side = sub(sub(b, a), scale(d, dot(sub(b, a), d))); }
  if (len(side) < 1e-6) side = cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const bend = norm(side);
  const newB = add(add(a, scale(d, along)), scale(bend, h));
  const newC = add(a, scale(d, lat));
  // the root joint turns so that the upper bone points at the new elbow, then the middle joint so that the lower bone points at the new wrist
  const q1 = fromTo(sub(b, a), sub(newB, a));
  setWorldRotation(skeleton, pose, w, root, mul(q1, w.rot[root]), weight);
  w = worldOf(skeleton, pose);
  const q2 = fromTo(sub(w.pos[end], w.pos[mid]), sub(newC, w.pos[mid]));
  setWorldRotation(skeleton, pose, w, mid, mul(q2, w.rot[mid]), weight);
  if (endRotation) { w = worldOf(skeleton, pose); setWorldRotation(skeleton, pose, w, end, Array.from(endRotation), weight); }
  w = worldOf(skeleton, pose);
  return { reached: want <= reach + 1e-6, distance: len(sub(w.pos[end], target)) };
}

/**
 * Reach a target with a chain of joints, each the child of the one before (FABRIK: the chain is pulled to the target from its tip and then pinned back to its root, a few times over).
 * The root of the chain stays put and bone lengths are kept; a target out of reach stretches the chain straight toward it. Good for tails, spines, necks, tentacles, ropes and for
 * arms or legs where you do not need a pole. Edits the rotations of every joint in the chain but the last.
 * @param {import('./skeleton.js').Skeleton} skeleton @param {import('./skeleton.js').Pose} pose
 * @param {number[]} chain Joint numbers from the root of the chain to its tip (at least two).
 * @param {ArrayLike<number>} target
 * @param {{iterations?: number, tolerance?: number, weight?: number}} [o] `iterations` (16), `tolerance` in model units (1e-4), `weight` 0..1 as for `solveTwoBone`.
 * @returns {{reached: boolean, distance: number, iterations: number}}
 */
export function solveChain(skeleton, pose, chain, target, { iterations = 16, tolerance = 1e-4, weight = 1 } = {}) {
  if (chain.length < 2) throw new Error('solveChain needs at least two joints');
  for (let k = 1; k < chain.length; k++) if (skeleton.parents[chain[k]] !== chain[k - 1]) throw new Error(`solveChain: joint ${chain[k]} is not a child of joint ${chain[k - 1]}`);
  if (weight <= 0) return { reached: false, distance: Infinity, iterations: 0 };
  let w = worldOf(skeleton, pose);
  const p = chain.map((j) => w.pos[j].slice()), lens = [];
  for (let k = 0; k + 1 < p.length; k++) lens.push(len(sub(p[k + 1], p[k])));
  const total = lens.reduce((x, y) => x + y, 0), root = p[0].slice(), tip = p.length - 1;
  const tgt = [target[0], target[1], target[2]];
  let n = 0;
  if (len(sub(tgt, root)) >= total) {                                          // out of reach: straight toward it
    const d = norm(sub(tgt, root));
    for (let k = 1; k <= tip; k++) p[k] = add(p[k - 1], scale(d, lens[k - 1]));
  } else {
    while (n < iterations && len(sub(p[tip], tgt)) > tolerance) {
      p[tip] = tgt.slice();
      for (let k = tip - 1; k >= 0; k--) p[k] = add(p[k + 1], scale(norm(sub(p[k], p[k + 1])), lens[k]));   // from the tip back to the root
      p[0] = root.slice();
      for (let k = 1; k <= tip; k++) p[k] = add(p[k - 1], scale(norm(sub(p[k], p[k - 1])), lens[k - 1]));   // and out again
      n++;
    }
  }
  // positions to rotations: each joint turns its bone onto its new direction
  for (let k = 0; k < tip; k++) {
    w = worldOf(skeleton, pose);
    const q = fromTo(sub(w.pos[chain[k + 1]], w.pos[chain[k]]), sub(p[k + 1], p[k]));
    setWorldRotation(skeleton, pose, w, chain[k], mul(q, w.rot[chain[k]]), weight);
  }
  w = worldOf(skeleton, pose);
  const distance = len(sub(w.pos[chain[tip]], tgt));
  return { reached: len(sub(tgt, root)) <= total + 1e-6 && distance <= Math.max(tolerance * 10, 1e-3) || distance <= tolerance, distance, iterations: n };
}

/**
 * Turn one joint to face a point: its `axis` (a direction in the joint's own space: the way a head looks, a turret fires) is rotated by the shortest turn toward the target.
 * `limit` caps how far, in radians, the joint may turn from where the pose has it, so a head follows a target over the shoulder only so far; `weight` fades the effect.
 * @param {import('./skeleton.js').Skeleton} skeleton @param {import('./skeleton.js').Pose} pose @param {number} joint
 * @param {ArrayLike<number>} target
 * @param {{axis?: ArrayLike<number>, weight?: number, limit?: number}} [o] `axis` default [0, 0, 1] (the way glTF characters face).
 * @returns {{angle: number, limited: boolean}} How far the joint turned, and whether the limit held it back.
 */
export function aimJoint(skeleton, pose, joint, target, { axis = [0, 0, 1], weight = 1, limit = Math.PI } = {}) {
  if (weight <= 0) return { angle: 0, limited: false };
  const w = worldOf(skeleton, pose);
  const facing = rot(w.rot[joint], norm([axis[0], axis[1], axis[2]]));
  let q = fromTo(facing, sub([target[0], target[1], target[2]], w.pos[joint]));
  let angle = 2 * Math.acos(Math.min(1, Math.abs(q[3])));
  let limited = false;
  if (angle > limit) { q = slerpFromIdentity(q, limit / angle); angle = limit; limited = true; }
  setWorldRotation(skeleton, pose, w, joint, mul(q, w.rot[joint]), weight);
  return { angle: angle * Math.min(1, weight), limited };
}

/** A fraction `s` of the rotation q (a turn about the same axis, `s` times as far). */
function slerpFromIdentity(q, s) {
  const qq = q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
  const half = Math.acos(Math.min(1, qq[3])), sin = Math.sin(half);
  if (sin < 1e-9) return [0, 0, 0, 1];
  const axis = [qq[0] / sin, qq[1] / sin, qq[2] / sin], a = half * s;
  return [axis[0] * Math.sin(a), axis[1] * Math.sin(a), axis[2] * Math.sin(a), Math.cos(a)];
}

// ---------------------------------------------------------------- retargeting

const IGNORED = new Set(['mixamorig', 'bip', 'bip01', 'bip001', 'j', 'c', 'def', 'org', 'armature', 'cc', 'base', 'jnt', 'skel', 'rig', 'mixamo']);
const FINGERS = { thumb: 'thumb', index: 'index', middle: 'middle', ring: 'ring', pinky: 'pinky', little: 'pinky' };
const BASES = {
  hips: 'hips', hip: 'hips', pelvis: 'hips', root: 'root',
  spine: 'spine', spine0: 'spine', spine1: 'spine.1', chest: 'spine.1', spine2: 'spine.2', upperchest: 'spine.2', spine3: 'spine.3',
  neck: 'neck', neck1: 'neck', head: 'head',
  shoulder: 'clavicle', clavicle: 'clavicle', collar: 'clavicle',
  upperarm: 'upperarm', arm: 'upperarm', forearm: 'lowerarm', lowerarm: 'lowerarm', elbow: 'lowerarm', hand: 'hand', wrist: 'hand',
  thigh: 'upleg', upleg: 'upleg', upperleg: 'upleg', calf: 'lowleg', shin: 'lowleg', lowerleg: 'lowleg', leg: 'lowleg', knee: 'lowleg',
  foot: 'foot', ankle: 'foot', toe: 'toe', toes: 'toe', toebase: 'toe', ball: 'toe',
};

/**
 * What body part a joint name means, in a form that matches across naming schemes (Mixamo's `mixamorig:LeftUpLeg`, Unity's `LeftUpperLeg`, Blender's `thigh.L`, 3ds Max's `Bip01 L Thigh`,
 * VRM's `J_Bip_L_UpperLeg` all give `upleg.l`). Returns null for a joint it does not know (a prop, a twist bone, a helper).
 * @param {string} name @returns {string | null}
 */
export function humanoidKey(name) {
  const split = String(name).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let side = '';
  const rest = [];
  for (let k = 0; k < split.length; k++) {
    const t = split[k];
    if (IGNORED.has(t)) { if (/^\d+$/.test(split[k + 1] ?? '')) k++; continue; }   // a prefix, and the number that belongs to it (Bip01, mixamorig1)
    if (t === 'l' || t === 'left') { side = 'l'; continue; }
    if (t === 'r' || t === 'right') { side = 'r'; continue; }
    rest.push(t);
  }
  if (!rest.length) return null;
  const words = [], numbers = [];
  for (const t of rest) (/^\d+$/.test(t) ? numbers : words).push(t);
  const joined = words.join('');
  const suffix = side ? `.${side}` : '';
  const finger = words.find((w) => FINGERS[w]);
  if (finger) return `${FINGERS[finger]}${numbers.length ? `.${+numbers[0]}` : ''}${suffix}`;
  const base = BASES[joined + (numbers.length ? +numbers[0] : '')] ?? BASES[joined];   // spine1 is its own joint; a number on a joint without a numbered form is ignored
  if (!base) return null;
  return base + suffix;
}

/**
 * Match the joints of one skeleton to another by what their names mean (`humanoidKey`). `overrides` maps source joint names to destination joint names for the ones that need help.
 * @param {import('./skeleton.js').Skeleton} src @param {import('./skeleton.js').Skeleton} dst @param {Record<string, string>} [overrides]
 * @returns {Int16Array} For each source joint, the destination joint it drives, or -1.
 */
export function autoMapJoints(src, dst, overrides = {}) {
  const byKey = new Map();
  dst.names.forEach((nm, i) => { const k = humanoidKey(nm); if (k && !byKey.has(k)) byKey.set(k, i); });
  const map = new Int16Array(src.count).fill(-1), taken = new Set();
  src.names.forEach((nm, i) => {
    let j = -1;
    if (overrides[nm] !== undefined) { j = dst.indexOf(overrides[nm]); if (j < 0) throw new Error(`retarget override: the destination has no joint "${overrides[nm]}"`); }
    else { const k = humanoidKey(nm); if (k && byKey.has(k)) j = byKey.get(k); }
    if (j >= 0 && !taken.has(j)) { map[i] = j; taken.add(j); }
  });
  return map;
}

const restCache = new WeakMap();
/** World rotations and positions of the rest pose, cached per skeleton. */
function restWorld(skeleton) {
  let r = restCache.get(skeleton);
  if (!r) { r = worldOf(skeleton, skeleton.createPose().setRest(skeleton)); restCache.set(skeleton, r); }
  return r;
}

/**
 * Copy the movement of a pose of one skeleton onto another. Each mapped joint gets the *change from rest* the source joint has in the world, applied to its own rest orientation, so
 * rigs whose rest poses differ (A-pose against T-pose, bones pointing along different axes) still move the same way. Joints with no counterpart stay at rest. The hips (the
 * mapped joints with no mapped parent) also copy the source's movement, scaled by how much taller or shorter the destination's hips are, so a short character does not slide.
 * @param {import('./skeleton.js').Skeleton} srcSkeleton @param {import('./skeleton.js').Pose} srcPose @param {import('./skeleton.js').Skeleton} dstSkeleton
 * @param {import('./skeleton.js').Pose} out The destination pose, overwritten.
 * @param {Int16Array | number[]} [map] From `autoMapJoints` (the default, made here: pass it in when retargeting many frames).
 * @param {{translation?: boolean}} [o] `translation: false` keeps the hips where the destination rest has them.
 */
export function retargetPose(srcSkeleton, srcPose, dstSkeleton, out, map = autoMapJoints(srcSkeleton, dstSkeleton), { translation = true } = {}) {
  const sw = worldOf(srcSkeleton, srcPose), sr = restWorld(srcSkeleton), dr = restWorld(dstSkeleton);
  const dstToSrc = new Int16Array(dstSkeleton.count).fill(-1);
  for (let i = 0; i < map.length; i++) if (map[i] >= 0) dstToSrc[map[i]] = i;
  out.setRest(dstSkeleton);
  const wd = new Array(dstSkeleton.count), rootRot = Array.from(matrixRotation(dstSkeleton.rootMatrix, rotOf));
  for (let o = 0; o < dstSkeleton.count; o++) {
    const i = dstSkeleton.order[o], p = dstSkeleton.parents[i], parentWorld = p >= 0 ? wd[p] : rootRot, s = dstToSrc[i];
    if (s >= 0) {
      const delta = mul(sw.rot[s], conj(sr.rot[s]));                           // how the source joint has turned in the world since rest
      wd[i] = mul(delta, dr.rot[i]);
      const local = mul(conj(parentWorld), wd[i]);
      for (let k = 0; k < 4; k++) out.r[i * 4 + k] = local[k];
      const srcParent = srcSkeleton.parents[s];
      if (translation && (srcParent < 0 || map[srcParent] < 0)) {              // a hips joint: copy its movement, scaled to the new body
        const ratio = sr.pos[s][1] > 1e-3 && dr.pos[i][1] > 1e-3 ? dr.pos[i][1] / sr.pos[s][1] : 1;
        for (let k = 0; k < 3; k++) out.t[i * 3 + k] = dstSkeleton.restT[i * 3 + k] + (srcPose.t[s * 3 + k] - srcSkeleton.restT[s * 3 + k]) * ratio;
      }
    } else {
      const local = [dstSkeleton.restR[i * 4], dstSkeleton.restR[i * 4 + 1], dstSkeleton.restR[i * 4 + 2], dstSkeleton.restR[i * 4 + 3]];
      wd[i] = mul(parentWorld, local);
    }
  }
  return out;
}

/**
 * Make a copy of an animation clip for another skeleton: the clip is sampled `fps` times a second, each pose retargeted (`retargetPose`), and a rotation track written for every
 * destination joint that has a counterpart (and a translation track for the hips). Loop, duration and events carry over.
 * @param {AnimationClip} clip @param {import('./skeleton.js').Skeleton} srcSkeleton @param {import('./skeleton.js').Skeleton} dstSkeleton
 * @param {{map?: Int16Array | number[], overrides?: Record<string, string>, fps?: number, translation?: boolean, name?: string}} [o]
 * @returns {AnimationClip}
 */
export function retargetClip(clip, srcSkeleton, dstSkeleton, { map, overrides, fps = 30, translation = true, name } = {}) {
  const m = map ?? autoMapJoints(srcSkeleton, dstSkeleton, overrides);
  const steps = Math.max(1, Math.ceil(clip.duration * fps)), times = [];
  for (let k = 0; k <= steps; k++) times.push(Math.min(clip.duration, k / fps));
  const src = srcSkeleton.createPose(), dst = dstSkeleton.createPose();
  const mapped = []; // destination joints that receive a track
  const hips = new Set();
  m.forEach((d, s) => { if (d >= 0) { mapped.push(d); const sp = srcSkeleton.parents[s]; if (sp < 0 || m[sp] < 0) hips.add(d); } });
  const rValues = new Map(mapped.map((d) => [d, new Float32Array(times.length * 4)])), tValues = new Map([...hips].map((d) => [d, new Float32Array(times.length * 3)]));
  times.forEach((t, k) => {
    samplePose(srcSkeleton, clip, t >= clip.duration && clip.loop ? clip.duration - 1e-6 : t, src);
    retargetPose(srcSkeleton, src, dstSkeleton, dst, m, { translation });
    for (const d of mapped) rValues.get(d).set(dst.r.subarray(d * 4, d * 4 + 4), k * 4);
    if (translation) for (const d of hips) tValues.get(d).set(dst.t.subarray(d * 3, d * 3 + 3), k * 3);
  });
  const tracks = [];
  for (const d of mapped) tracks.push({ joint: d, path: 'r', times, values: rValues.get(d) });
  if (translation) for (const d of hips) tracks.push({ joint: d, path: 't', times, values: tValues.get(d) });
  return new AnimationClip(name ?? `${clip.name}-retargeted`, tracks, { loop: clip.loop, duration: clip.duration, events: clip.events.map((e) => ({ time: e.time, name: e.name, data: e.data })) });
}

// ---------------------------------------------------------------- ragdolls

/** Skeleton joints paired with ragdoll bones by what their names mean: `[joint, bone][]` for every joint that has a bone. */
function ragdollPairs(skeleton, ragdoll) {
  const byKey = new Map();
  ragdoll.names.forEach((nm, b) => { const k = humanoidKey(nm) ?? nm; if (!byKey.has(k)) byKey.set(k, b); });
  const out = [];
  skeleton.names.forEach((nm, j) => { const k = humanoidKey(nm); if (k && byKey.has(k)) out.push([j, byKey.get(k)]); });
  return out;
}

/**
 * Draw a ragdoll with a skeleton: copies how each ragdoll body has turned from its rest orientation onto the matching joint (joints are paired with bones by name, as in retargeting),
 * and moves the hips with the body. Joints with no bone (fingers, a tail, twist bones) keep the rest pose relative to their parent (they go along with it rigidly). `ragdoll` is a `Ragdoll` from `@engine/physics` (anything with the same `names`, `modelRotationDelta`, `modelJointPosition` and `rest` will do), and the skeleton and the
 * ragdoll are taken to share a model space (feet on the ground, facing the same way).
 * @param {import('./skeleton.js').Skeleton} skeleton @param {import('./skeleton.js').Pose} pose Overwritten: every joint takes the rest pose, then the paired ones what the bodies say.
 * @param {{names: string[], modelRotationDelta(i: number): number[], modelJointPosition(i: number): number[], rest: {from: number[]}[]}} ragdoll
 * @returns {import('./skeleton.js').Pose} `pose`
 */
export function poseFromRagdoll(skeleton, pose, ragdoll) {
  const pairs = ragdollPairs(skeleton, ragdoll), boneOf = new Int16Array(skeleton.count).fill(-1);
  for (const [j, b] of pairs) boneOf[j] = b;
  pose.setRest(skeleton);
  const rest = restWorld(skeleton), n = skeleton.count;
  const wr = new Array(n), wp = new Array(n), rootRot = Array.from(matrixRotation(skeleton.rootMatrix, rotOf));
  for (let o = 0; o < n; o++) {
    const i = skeleton.order[o], p = skeleton.parents[i], pr = p >= 0 ? wr[p] : rootRot;
    if (boneOf[i] >= 0) {
      const delta = ragdoll.modelRotationDelta(boneOf[i]);
      wr[i] = mul(delta, rest.rot[i]);
      const local = mul(conj(pr), wr[i]);
      for (let k = 0; k < 4; k++) pose.r[i * 4 + k] = local[k];
      const hipsType = p < 0 || boneOf[p] < 0;
      if (hipsType) {                                                  // nothing above it moves it: it follows the body
        const now = ragdoll.modelJointPosition(boneOf[i]), was = ragdoll.rest[boneOf[i]].from;
        const target = [rest.pos[i][0] + now[0] - was[0], rest.pos[i][1] + now[1] - was[1], rest.pos[i][2] + now[2] - was[2]];
        const parentPos = p >= 0 ? wp[p] : [skeleton.rootMatrix[12], skeleton.rootMatrix[13], skeleton.rootMatrix[14]];
        const t = rot(conj(pr), sub(target, parentPos));
        for (let k = 0; k < 3; k++) pose.t[i * 3 + k] = t[k];
        wp[i] = target;
      } else wp[i] = add(wp[p], rot(wr[p], [skeleton.restT[i * 3], skeleton.restT[i * 3 + 1], skeleton.restT[i * 3 + 2]]));
    } else {
      const local = [skeleton.restR[i * 4], skeleton.restR[i * 4 + 1], skeleton.restR[i * 4 + 2], skeleton.restR[i * 4 + 3]];
      wr[i] = mul(pr, local);
      for (let k = 0; k < 4; k++) pose.r[i * 4 + k] = local[k];
      const t = [skeleton.restT[i * 3], skeleton.restT[i * 3 + 1], skeleton.restT[i * 3 + 2]];
      for (let k = 0; k < 3; k++) pose.t[i * 3 + k] = t[k];
      wp[i] = p >= 0 ? add(wp[p], rot(wr[p], t)) : add([skeleton.rootMatrix[12], skeleton.rootMatrix[13], skeleton.rootMatrix[14]], rot(pr, t));
    }
  }
  return pose;
}

/**
 * Start a ragdoll from an animated pose: puts each body where the matching joint of `pose` has its bone (`ragdoll.setBone`), clears the spin and gives every body `velocity` (the speed the
 * character was moving at, so it carries on that way). Then add the ragdoll to the world (or leave it there asleep) and stop playing the animation.
 * @param {import('./skeleton.js').Skeleton} skeleton @param {import('./skeleton.js').Pose} pose
 * @param {{names: string[], setBone(i: number, delta: number[], from: number[]): void, clearSpin(): void, setLinearVelocity(x: number, y: number, z: number): void}} ragdoll
 * @param {{velocity?: number[]}} [o]
 */
export function poseToRagdoll(skeleton, pose, ragdoll, { velocity } = {}) {
  const world = worldOf(skeleton, pose), rest = restWorld(skeleton);
  for (const [j, b] of ragdollPairs(skeleton, ragdoll)) ragdoll.setBone(b, mul(world.rot[j], conj(rest.rot[j])), world.pos[j]);
  ragdoll.clearSpin();
  if (velocity) ragdoll.setLinearVelocity(velocity[0], velocity[1], velocity[2]);
}

/**
 * Fit a ragdoll description to a skeleton: takes `base` (from `humanoidRagdollSpec`, giving the bones, radii, masses and joint types) and moves every bone to where the skeleton's own joints are
 * at rest (a bone runs from its joint to its child's; the head, hands and feet use a fixed length where the skeleton has no joint to end at). Bones the skeleton has no joint for keep the base positions.
 * @param {import('./skeleton.js').Skeleton} skeleton
 * @param {{bones: {name: string, parent: number, from: number[], to: number[], radius: number, mass: number, joint?: object}[]}} base
 * @returns {{bones: object[]}} A new description; `base` is not changed.
 */
export function ragdollSpecFromSkeleton(skeleton, base) {
  const rest = restWorld(skeleton), joint = new Map();
  skeleton.names.forEach((nm, j) => { const k = humanoidKey(nm); if (k && !joint.has(k)) joint.set(k, j); });
  const pos = (name) => { const j = joint.get(name); return j === undefined ? null : rest.pos[j].slice(); };
  const bones = base.bones.map((b) => ({ ...b, from: b.from.slice(), to: b.to.slice() }));
  const at = new Map(bones.map((b) => [b.name, b]));
  const place = (name, from, to) => { const b = at.get(name); if (b && from) { b.from = from; if (to) b.to = to; } };
  const side = (s) => {
    place(`upperarm.${s}`, pos(`upperarm.${s}`), pos(`lowerarm.${s}`)); place(`lowerarm.${s}`, pos(`lowerarm.${s}`), pos(`hand.${s}`));
    place(`upleg.${s}`, pos(`upleg.${s}`), pos(`lowleg.${s}`)); place(`lowleg.${s}`, pos(`lowleg.${s}`), pos(`foot.${s}`));
    const foot = pos(`foot.${s}`), toe = pos(`toe.${s}`);
    if (foot) place(`foot.${s}`, foot, toe ?? [foot[0], foot[1] - 0.01, foot[2] + (at.get(`foot.${s}`).to[2] - at.get(`foot.${s}`).from[2])]);
  };
  side('l'); side('r');
  const spineJoint = pos('spine'), neck = pos('neck') ?? pos('head'), headJoint = pos('head');
  place('hips', pos('hips'), spineJoint);
  if (at.has('spine.1')) place('spine.1', spineJoint ?? at.get('hips').to, neck);
  if (at.has('head') && headJoint) place('head', neck ?? headJoint, [headJoint[0], headJoint[1] + (at.get('head').to[1] - at.get('head').from[1]), headJoint[2]]);
  return { bones };
}
