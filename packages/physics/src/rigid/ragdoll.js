// Ragdolls: a character as capsule bodies joined by limited joints, built from a plain description. Only + - * / and sqrt (and the engine's own sin and cos for the facing).
import { RigidBody, capsule } from './body.js';
import { BallJoint, ConeJoint, HingeJoint, FixedJoint } from './joints.js';
import { sin, cos } from '../../../math/src/index.js';

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { // q * v * conj(q)
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [v[0] + q[3] * tx + (q[1] * tz - q[2] * ty), v[1] + q[3] * ty + (q[2] * tx - q[0] * tz), v[2] + q[3] * tz + (q[0] * ty - q[1] * tx)];
};
const qnorm = (q) => { const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
/** The rotation taking +y to the direction d (shortest turn). */
function yTo(d) {
  const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]), x = d[0] / l, y = d[1] / l, z = d[2] / l;
  if (y < -0.999999) return [1, 0, 0, 0];
  return qnorm([z, 0, -x, 1 + y]);                       // cross((0,1,0), d) = (z, 0, -x), and w = 1 + dot
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * @typedef {Object} RagdollBone
 * @property {string} name What it is (a joint name of the skeleton it will drive, see `poseFromRagdoll`).
 * @property {number} parent Index of the bone it hangs from, or -1 for the root.
 * @property {number[]} from Where it starts (the joint with its parent) in model space. @property {number[]} to Where it ends.
 * @property {number} radius Thickness of its capsule. @property {number} mass kg.
 * @property {{type: 'cone', swing: number} | {type: 'hinge', axis: number[], limits: number[]} | {type: 'ball'} | {type: 'fixed'}} [joint] How it is joined to its parent at `from`: a `cone` swings within `swing` radians of
 *   the way the bone points (a shoulder, a hip, a neck); a `hinge` bends about `axis` (model space) between `limits` radians (an elbow, a knee).
 */

/**
 * The description of a humanoid ragdoll of 13 bodies (hips, chest, head, upper and lower arms, upper and lower legs, feet), standing with its arms a little out from its sides, facing +z,
 * its left side toward +x, feet at y = 0. For tight joints step the world with `substeps: 4` and `iterations: 16` or more (a foot landing hard is the stiffest thing it meets). Elbows bend forward and knees backward, only; shoulders, hips, neck and ankles swing within limits; bones are named as `humanoidKey` names them
 * in `@engine/render` so that `poseFromRagdoll` finds the joints of a skeleton.
 * @param {{height?: number, mass?: number}} [o] `height` in metres (1.8), `mass` in kg (75).
 * @returns {{bones: RagdollBone[]}}
 */
export function humanoidRagdollSpec({ height = 1.8, mass = 75 } = {}) {
  const H = height, bones = [];
  const push = (name, parent, from, to, radius, share, joint) => bones.push({ name, parent, from, to, radius: radius * H, mass: share * mass, joint });
  const P = (x, y, z) => [x * H, y * H, z * H];
  push('hips', -1, P(0, 0.50, 0), P(0, 0.58, 0), 0.075, 0.14);
  push('spine.1', 0, P(0, 0.58, 0), P(0, 0.80, 0), 0.08, 0.30, { type: 'cone', swing: 0.5 });
  push('head', 1, P(0, 0.84, 0), P(0, 0.94, 0), 0.055, 0.07, { type: 'cone', swing: 0.65 });
  for (const [side, tag] of [[1, 'l'], [-1, 'r']]) {
    const shoulder = P(side * 0.11, 0.78, 0), armDir = [side * 0.22, -1, 0], al = Math.sqrt(armDir[0] * armDir[0] + 1);
    const elbow = add(shoulder, [armDir[0] / al * 0.17 * H, -1 / al * 0.17 * H, 0]), wrist = add(elbow, [armDir[0] / al * 0.16 * H, -1 / al * 0.16 * H, 0]);
    const i = bones.length;
    push(`upperarm.${tag}`, 1, shoulder, elbow, 0.03, 0.03, { type: 'cone', swing: 1.9 });
    push(`lowerarm.${tag}`, i, elbow, wrist, 0.025, 0.03, { type: 'hinge', axis: [-1, 0, 0], limits: [0, 2.5] });
  }
  for (const [side, tag] of [[1, 'l'], [-1, 'r']]) {
    const hip = P(side * 0.055, 0.50, 0), knee = P(side * 0.06, 0.285, 0.01), ankle = P(side * 0.06, 0.05, 0);
    const i = bones.length;
    push(`upleg.${tag}`, 0, hip, knee, 0.045, 0.10, { type: 'cone', swing: 1.3 });
    push(`lowleg.${tag}`, i, knee, ankle, 0.035, 0.05, { type: 'hinge', axis: [1, 0, 0], limits: [0, 2.4] });
    push(`foot.${tag}`, i + 1, ankle, P(side * 0.06, 0.04, 0.12), 0.03, 0.03, { type: 'cone', swing: 0.6 });   // feet are heavier than they are in life: a very light body on a heavy leg makes a joint stretch when it lands
  }
  const total = bones.reduce((m, b) => m + b.mass, 0);
  for (const b of bones) b.mass *= mass / total;                                 // the shares add up to exactly `mass`
  return { bones };
}

/**
 * A character made of rigid bodies. Build it from a description (`humanoidRagdollSpec()` or your own bones), `addTo(world)`, and step the world: it falls, collapses and comes to rest.
 * To go from an animation into a ragdoll, copy the animated pose onto the bodies with `setBone` (see `poseToRagdoll` in `@engine/render`), give it the character's velocity
 * (`setLinearVelocity`), and let go; to draw it, copy the bodies back onto a skeleton's pose (`poseFromRagdoll`).
 */
export class Ragdoll {
  /**
   * @param {{bones: RagdollBone[]}} spec
   * @param {object} [o]
   * @param {number} [o.x] @param {number} [o.y] @param {number} [o.z] Where the model-space origin (the feet) is placed in the world.
   * @param {number} [o.yaw] Turned this much (radians) about the vertical axis.
   * @param {number} [o.friction] 0.8. @param {number} [o.linearDamping] 0.08. @param {number} [o.angularDamping] 0.4: a ragdoll needs some, or its limbs flail.
   * @param {boolean} [o.selfCollision] Whether its own limbs collide with each other (false: they pass through, which is stable and rarely noticed).
   * @param {number} [o.group] @param {number} [o.mask] Collision filtering of every body, as for a `RigidBody`.
   * @param {any} [o.userData] Put on every body (an entity id).
   */
  constructor(spec, { x = 0, y = 0, z = 0, yaw = 0, friction = 0.8, linearDamping = 0.08, angularDamping = 0.4, selfCollision = false, group = 1, mask = 0xffff, userData = null } = {}) {
    this.spec = spec;
    this.count = spec.bones.length;
    this.names = spec.bones.map((b) => b.name);
    this.selfCollision = selfCollision;
    this.origin = [x, y, z];
    this.placement = [0, sin(yaw / 2), 0, cos(yaw / 2)];
    /** The bodies, in the order of the bones. @type {RigidBody[]} */ this.bodies = [];
    /** The joints, one for each bone but the root. */ this.joints = [];
    this.rest = spec.bones.map((b) => {                // the rest pose, in model space
      const dir = sub(b.to, b.from), q = yTo(dir);
      return { center: mid(b.from, b.to), from: b.from.slice(), q, dir };
    });
    spec.bones.forEach((b, i) => {
      const dx = b.to[0] - b.from[0], dy = b.to[1] - b.from[1], dz = b.to[2] - b.from[2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const half = Math.max(len / 2 - b.radius, 0.005);
      const wc = this.toWorld(this.rest[i].center), wq = qmul(this.placement, this.rest[i].q);
      const body = new RigidBody({ shape: capsule(b.radius, half), x: wc[0], y: wc[1], z: wc[2], rotation: wq, mass: b.mass, friction, linearDamping, angularDamping, group, mask, userData });
      body.key = `ragdoll:${b.name}`;
      this.bodies.push(body);
    });
    spec.bones.forEach((b, i) => {
      if (b.parent < 0) return;
      const parent = this.bodies[b.parent], body = this.bodies[i], anchor = this.toWorld(b.from), j = b.joint ?? { type: 'ball' };
      let joint;
      if (j.type === 'hinge') joint = new HingeJoint(parent, body, anchor, qrot(this.placement, j.axis), { limits: j.limits });
      else if (j.type === 'cone') joint = new ConeJoint(parent, body, anchor, qrot(this.placement, this.rest[i].dir), j.swing);
      else if (j.type === 'fixed') joint = new FixedJoint(parent, body, anchor);
      else joint = new BallJoint(parent, body, anchor);
      joint.key = `ragdoll:${b.name}`;
      this.joints.push(joint);
    });
  }

  /** A model-space point in the world. */
  toWorld(p) { const r = qrot(this.placement, p); return [r[0] + this.origin[0], r[1] + this.origin[1], r[2] + this.origin[2]]; }
  /** A world point in model space. */
  toModel(p) { return qrot(qconj(this.placement), [p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]]); }

  /** The body of a bone by name, or undefined. */
  body(name) { return this.bodies[this.names.indexOf(name)]; }

  /** Put the bodies and joints into a physics world. Unless `selfCollision`, the bodies are told to ignore each other. */
  addTo(world) {
    for (const b of this.bodies) world.add(b);
    for (const j of this.joints) world.addJoint(j);
    if (!this.selfCollision) for (let i = 0; i < this.bodies.length; i++) for (let k = i + 1; k < this.bodies.length; k++) world.ignoreCollision(this.bodies[i], this.bodies[k]);
    return this;
  }
  /** Take it out again. */
  removeFrom(world) {
    for (const j of this.joints) world.removeJoint(j);
    for (const b of this.bodies) world.remove(b);
    return this;
  }

  /** Where the bone's body is, in model space (the centre of the capsule). @param {number} i */
  modelPosition(i, out = [0, 0, 0]) { const p = this.toModel([this.bodies[i].x, this.bodies[i].y, this.bodies[i].z]); out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
  /** How much the bone's body has turned from its rest orientation, as a model-space quaternion [x, y, z, w] (the change to apply to the rest pose). */
  modelRotationDelta(i, out = [0, 0, 0, 1]) {
    const b = this.bodies[i], q = qmul(qconj(this.placement), [b.qx, b.qy, b.qz, b.qw]), d = qmul(q, qconj(this.rest[i].q));
    out[0] = d[0]; out[1] = d[1]; out[2] = d[2]; out[3] = d[3];
    return out;
  }
  /** Where bone i's joint (its `from` point) is now in model space, taken from its body. */
  modelJointPosition(i, out = [0, 0, 0]) {
    const d = this.modelRotationDelta(i), c = this.modelPosition(i), off = qrot(d, sub(this.rest[i].from, this.rest[i].center));
    out[0] = c[0] + off[0]; out[1] = c[1] + off[1]; out[2] = c[2] + off[2];
    return out;
  }

  /**
   * Put a bone's body where an animated pose has it: `delta` is how much the bone has turned from rest (model-space quaternion), `fromPosition` where its joint is (model space).
   * Does not touch velocities.
   */
  setBone(i, delta, fromPosition) {
    const r = this.rest[i], q = qmul(delta, r.q), c = add(fromPosition, qrot(delta, sub(r.center, r.from)));
    const wq = qnorm(qmul(this.placement, q)), wc = this.toWorld(c), b = this.bodies[i];
    b.x = wc[0]; b.y = wc[1]; b.z = wc[2]; b.qx = wq[0]; b.qy = wq[1]; b.qz = wq[2]; b.qw = wq[3];
    b.wake(); b.refresh();
  }
  /** Give every body this velocity (the speed the character was moving at). */
  setLinearVelocity(vx, vy, vz) { for (const b of this.bodies) b.setVelocity(vx, vy, vz); }
  /** Zero the spin of every body (after `setBone`). */
  clearSpin() { for (const b of this.bodies) b.setAngularVelocity(0, 0, 0); }
  /** A shove: an impulse (newton-seconds) on a bone (a name or an index), at a world point if given (a bullet hit, an explosion). */
  applyImpulse(bone, ix, iy, iz, px, py, pz) { (typeof bone === 'number' ? this.bodies[bone] : this.body(bone)).applyImpulse(ix, iy, iz, px, py, pz); }
  /** Total mass in kg. */
  get mass() { return this.bodies.reduce((s, b) => s + b.mass, 0); }
  /** The centre of mass in the world. */
  centerOfMass(out = [0, 0, 0]) {
    let m = 0; out[0] = out[1] = out[2] = 0;
    for (const b of this.bodies) { out[0] += b.x * b.mass; out[1] += b.y * b.mass; out[2] += b.z * b.mass; m += b.mass; }
    out[0] /= m; out[1] /= m; out[2] /= m;
    return out;
  }
  /** Whether every body is asleep. */
  get resting() { return this.bodies.every((b) => b.sleeping); }
}
