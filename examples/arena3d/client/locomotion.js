// Turns what the network tells us about a player (where they are, which way they look, whether they are on the ground) into
// a pose: idle, walk and run blended by speed, an airborne pose, legs that follow the direction of travel (so strafing and
// backing up look right while the torso keeps facing where the player aims), and a head that looks up and down.
// Presentation only: it never feeds back into the simulation.
import { blendPoses, samplePose } from '../../../packages/render/src/index.js';
import { quat, wrapAngle, lerpAngle } from '../../../packages/math/src/index.js';
import { J } from './character.js';

const WALK_CYCLE_M = 3.0, RUN_CYCLE_M = 4.2; // metres travelled per full leg cycle
const SOLE_POINTS = [[0, -0.1, 0.1], [0, -0.1, -0.14]]; // heel and toe, in the foot joint's frame (ankle 0.1 m above the sole)

const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const tmp = [0, 0, 0, 1];

/** Pose state of one visible player. Call `update` every frame, then use `palette` (and the model rotation `yaw`). */
export class CharacterRig {
  /** @param {ReturnType<import('./character.js').createCharacter>} character */
  constructor(character) {
    this.character = character;
    const sk = character.skeleton;
    this.palette = new Float32Array(sk.count * 16);
    this.poseIdle = sk.createPose(); this.poseWalk = sk.createPose(); this.poseRun = sk.createPose();
    this.poseAir = sk.createPose(); this.poseLoco = sk.createPose(); this.pose = sk.createPose();
    this.started = false;
    this.lastX = 0; this.lastZ = 0;
    this.vx = 0; this.vz = 0;       // smoothed velocity on the ground plane
    this.speed = 0;
    this.phase = 0;                  // leg cycle, 0..1
    this.idleTime = 0;
    this.air = 0;                    // 0 on the ground .. 1 airborne
    this.legTurn = 0;                // how far the legs are turned from the facing direction, radians
  }

  /** Call instead of `update` for a frame in which the player is not drawn: the next `update` starts afresh instead of seeing a jump. */
  skip() { this.started = false; }

  /**
   * @param {number} dt Seconds since the last call
   * @param {number} x Position (the bottom of the player's capsule is `y - halfHeight`; only the ground plane matters here)
   * @param {number} z
   * @param {number} yaw Where the player is looking, radians
   * @param {number} pitch
   * @param {boolean} grounded
   * @returns {Float32Array} the skinning palette
   */
  update(dt, x, z, yaw, pitch, grounded) {
    const { skeleton, clips } = this.character;
    dt = Math.max(1e-4, Math.min(0.1, dt));
    if (!this.started || Math.hypot(x - this.lastX, z - this.lastZ) > 4) { // first sight, or a respawn: no velocity to speak of
      this.started = true; this.vx = 0; this.vz = 0;
    } else {
      const k = 1 - Math.exp(-dt * 10);
      this.vx += ((x - this.lastX) / dt - this.vx) * k;
      this.vz += ((z - this.lastZ) / dt - this.vz) * k;
    }
    this.lastX = x; this.lastZ = z;
    this.speed = Math.hypot(this.vx, this.vz);

    // which way the legs point: along the direction of travel, folded into the front half (moving backwards = legs run in reverse)
    let target = 0, dir = 1;
    if (this.speed > 0.4) {
      const delta = wrapAngle(Math.atan2(-this.vx, -this.vz) - yaw); // heading relative to where the player faces
      if (Math.abs(delta) > Math.PI / 2) { target = wrapAngle(delta - Math.sign(delta) * Math.PI); dir = -1; } else target = delta;
    }
    this.legTurn = lerpAngle(this.legTurn, target, 1 - Math.exp(-dt * 10));

    const run = clamp01((this.speed - 4.9) / (6.8 - 4.9));
    const move = smoothstep(0.3, 1.5, this.speed);
    this.phase = (this.phase + dir * (this.speed / (WALK_CYCLE_M + (RUN_CYCLE_M - WALK_CYCLE_M) * run)) * dt) % 1;
    if (this.phase < 0) this.phase += 1;
    this.idleTime += dt;

    samplePose(skeleton, clips.idle, this.idleTime, this.poseIdle);
    let pose = this.poseIdle;
    if (move > 0.001) {
      samplePose(skeleton, clips.walk, this.phase, this.poseWalk);
      let loco = this.poseWalk;
      if (run > 0.001) { samplePose(skeleton, clips.run, this.phase, this.poseRun); blendPoses(this.poseLoco, this.poseWalk, this.poseRun, run); loco = this.poseLoco; }
      if (move < 0.999) { blendPoses(this.pose, this.poseIdle, loco, move); pose = this.pose; } else pose = loco;
    }
    this.air += ((grounded ? 0 : 1) - this.air) * (1 - Math.exp(-dt * 14));
    if (this.air > 0.002) {
      samplePose(skeleton, clips.air, this.idleTime, this.poseAir);
      if (pose !== this.pose) this.pose.copy(pose);
      blendPoses(this.pose, this.pose, this.poseAir, this.air);
      pose = this.pose;
    }
    if (pose !== this.pose) this.pose.copy(pose);
    const out = this.pose;

    const turn = this.legTurn * (1 - this.air); // in the air the body just follows the aim
    const rotate = (joint, q, pre) => {
      const o = joint * 4, cur = [out.r[o], out.r[o + 1], out.r[o + 2], out.r[o + 3]];
      quat.multiply(tmp, pre ? q : cur, pre ? cur : q);
      for (let k = 0; k < 4; k++) out.r[o + k] = tmp[k];
    };
    if (Math.abs(turn) > 1e-4) { rotate(J.HIPS, qy(turn), true); rotate(J.SPINE, qy(-turn), true); } // legs follow the travel direction, torso keeps facing the aim
    const look = Math.max(-1.2, Math.min(1.2, pitch));
    rotate(J.SPINE, qx(look * 0.2), false);
    rotate(J.HEAD, qx(look * 0.6), false);

    skeleton.computePalette(out, this.palette);
    this.#plantFeet(skeleton);
    return this.palette;
  }

  /** Lower the whole body so the lowest sole touches the floor (the legs swing from the hips, so without this the feet float or sink). */
  #plantFeet(skeleton) {
    let lowest = Infinity;
    for (const foot of [J.FOOT_L, J.FOOT_R]) {
      const m = skeleton.jointWorld(foot);
      for (const p of SOLE_POINTS) lowest = Math.min(lowest, m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]);
    }
    if (!Number.isFinite(lowest)) return;
    for (let j = 0; j < skeleton.count; j++) this.palette[j * 16 + 13] -= lowest; // translate every joint down (palette = T * world * inverseBind)
  }
}
