/**
 * Bones, slots, skins and constraints: the model of a 2D skeleton and the maths that turns the pose of its bones into where everything is on the screen. The world is y down like the
 * rest of the engine; angles are in degrees, and a positive angle turns clockwise on the screen.
 */

const DEG = Math.PI / 180, RAD = 180 / Math.PI;

/** How a bone takes on its parent's movement. `normal` follows all of it; `onlyTranslation` follows only where the parent is; `noRotationOrReflection` ignores the parent's turning; `noScale` ignores its size; `noScaleOrReflection` ignores its size and mirroring. */
export const INHERIT = Object.freeze({ normal: 0, onlyTranslation: 1, noRotationOrReflection: 2, noScale: 3, noScaleOrReflection: 4 });

/** Shortest turn from angle `a` to angle `b`, in degrees (between -180 and 180). @param {number} a @param {number} b */
export const angleDelta = (a, b) => { const d = (b - a) % 360; return d > 180 ? d - 360 : d < -180 ? d + 360 : d; };

/**
 * One bone of the skeleton as designed (its pose at rest: the "setup pose").
 * @typedef {object} BoneData
 * @property {number} index @property {string} name @property {BoneData | null} parent @property {number} length Length along its own x axis (for drawing and for IK) @property {number} x @property {number} y @property {number} rotation
 * @property {number} scaleX @property {number} scaleY @property {number} shearX @property {number} shearY @property {number} inherit One of `INHERIT`.
 */
/**
 * @typedef {object} SlotData
 * @property {number} index @property {string} name @property {BoneData} bone @property {number[]} color Setup colour [r, g, b, a] in 0..1 @property {string | null} attachment The attachment shown at rest @property {'normal' | 'additive'} blend
 */
/**
 * A picture hung on a slot. `region`: one sprite from the atlas. `mesh`: a sprite cut into triangles whose points follow bones and can be pushed around by deform animations. `boundingbox`: an invisible outline for hit tests.
 * @typedef {object} Attachment
 * @property {'region' | 'mesh' | 'boundingbox'} type @property {string} name @property {string} path The atlas sprite name @property {number[]} color
 */

/** A bone at run time: its pose now (`x`, `y`, `rotation`, `scaleX`, `scaleY`, `shearX`, `shearY` are relative to its parent) and where that puts it in the world (`worldX`, `worldY`, and `a b c d`, the matrix of its axes). */
export class Bone {
  /** @param {BoneData} data @param {Skeleton} skeleton @param {Bone | null} parent */
  constructor(data, skeleton, parent) {
    this.data = data; this.skeleton = skeleton; this.parent = parent;
    /** @type {Bone[]} */ this.children = [];
    this.x = 0; this.y = 0; this.rotation = 0; this.scaleX = 1; this.scaleY = 1; this.shearX = 0; this.shearY = 0; this.inherit = INHERIT.normal;
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.worldX = 0; this.worldY = 0;
    this.setToSetupPose();
  }

  /** Put this bone back to the pose it was designed in. */
  setToSetupPose() {
    const d = this.data;
    this.x = d.x; this.y = d.y; this.rotation = d.rotation; this.scaleX = d.scaleX; this.scaleY = d.scaleY; this.shearX = d.shearX; this.shearY = d.shearY; this.inherit = d.inherit;
  }

  /** Work out where this bone is in the world from its pose and its parent's (the parent must be up to date). */
  updateWorld() {
    const p = this.parent, s = this.skeleton;
    const rx = (this.rotation + this.shearX) * DEG, ry = (this.rotation + 90 + this.shearY) * DEG;
    const la = Math.cos(rx) * this.scaleX, lb = Math.cos(ry) * this.scaleY, lc = Math.sin(rx) * this.scaleX, ld = Math.sin(ry) * this.scaleY;
    if (!p) {
      this.a = la * s.scaleX; this.b = lb * s.scaleX; this.c = lc * s.scaleY; this.d = ld * s.scaleY;
      this.worldX = this.x * s.scaleX + s.x; this.worldY = this.y * s.scaleY + s.y;
      return;
    }
    let pa = p.a, pb = p.b, pc = p.c, pd = p.d;
    this.worldX = pa * this.x + pb * this.y + p.worldX; this.worldY = pc * this.x + pd * this.y + p.worldY;
    switch (this.inherit) {
      case INHERIT.onlyTranslation:
        this.a = la * s.scaleX; this.b = lb * s.scaleX; this.c = lc * s.scaleY; this.d = ld * s.scaleY;
        break;
      case INHERIT.noRotationOrReflection: {
        let t = pa * pa + pc * pc, prx = 0;
        if (t > 0.0001) { t = Math.abs(pa * pd - pb * pc) / t; pa /= s.scaleX; pc /= s.scaleY; pb = -pc * t; pd = pa * t; prx = Math.atan2(pc, pa) * RAD; } else { pa = 0; pc = 0; prx = 90 - Math.atan2(pd, pb) * RAD; }
        const rx2 = (this.rotation + this.shearX - prx) * DEG, ry2 = (this.rotation + this.shearY - prx + 90) * DEG;
        const a2 = Math.cos(rx2) * this.scaleX, b2 = Math.cos(ry2) * this.scaleY, c2 = Math.sin(rx2) * this.scaleX, d2 = Math.sin(ry2) * this.scaleY;
        this.a = pa * a2 + pb * c2; this.b = pa * b2 + pb * d2; this.c = pc * a2 + pd * c2; this.d = pc * b2 + pd * d2;
        break;
      }
      case INHERIT.noScale: case INHERIT.noScaleOrReflection: {
        const cos = Math.cos(this.rotation * DEG), sin = Math.sin(this.rotation * DEG);
        let za = (pa * cos + pb * sin) / s.scaleX, zc = (pc * cos + pd * sin) / s.scaleY, t = Math.sqrt(za * za + zc * zc);
        if (t > 0.00001) t = 1 / t;
        za *= t; zc *= t; t = Math.sqrt(za * za + zc * zc);
        if (this.inherit === INHERIT.noScale && (pa * pd - pb * pc < 0) !== ((s.scaleX < 0) !== (s.scaleY < 0))) t = -t;
        const r = Math.PI / 2 + Math.atan2(zc, za), zb = Math.cos(r) * t, zd = Math.sin(r) * t;
        const a2 = Math.cos(this.shearX * DEG) * this.scaleX, b2 = Math.cos((90 + this.shearY) * DEG) * this.scaleY, c2 = Math.sin(this.shearX * DEG) * this.scaleX, d2 = Math.sin((90 + this.shearY) * DEG) * this.scaleY;
        this.a = za * a2 + zb * c2; this.b = za * b2 + zb * d2; this.c = zc * a2 + zd * c2; this.d = zc * b2 + zd * d2;
        break;
      }
      default:
        this.a = pa * la + pb * lc; this.b = pa * lb + pb * ld; this.c = pc * la + pd * lc; this.d = pc * lb + pd * ld;
    }
  }

  /** The direction of the bone's x axis in the world, in degrees. */
  get worldRotation() { return Math.atan2(this.c, this.a) * RAD; }
  /** The world position of the far end of the bone (its origin plus its length along its x axis). @param {{x: number, y: number}} [out] */
  tip(out = { x: 0, y: 0 }) { const l = this.data.length; out.x = this.a * l + this.worldX; out.y = this.c * l + this.worldY; return out; }

  /** A point in the world to the same point as this bone sees it (relative to its origin and axes). @param {number} wx @param {number} wy @param {{x: number, y: number}} [out] */
  worldToLocal(wx, wy, out = { x: 0, y: 0 }) {
    const det = this.a * this.d - this.b * this.c, dx = wx - this.worldX, dy = wy - this.worldY;
    out.x = (dx * this.d - dy * this.b) / det; out.y = (dy * this.a - dx * this.c) / det;
    return out;
  }
  /** A point in this bone's space to the world. @param {number} lx @param {number} ly @param {{x: number, y: number}} [out] */
  localToWorld(lx, ly, out = { x: 0, y: 0 }) { out.x = this.a * lx + this.b * ly + this.worldX; out.y = this.c * lx + this.d * ly + this.worldY; return out; }

  /** The local `rotation` that makes this bone's x axis point along `worldDegrees`, given where its parent is now. @param {number} worldDegrees */
  localRotationFor(worldDegrees) {
    const p = this.parent, s = this.skeleton, wx = Math.cos(worldDegrees * DEG), wy = Math.sin(worldDegrees * DEG);
    const pa = p ? p.a : s.scaleX, pb = p ? p.b : 0, pc = p ? p.c : 0, pd = p ? p.d : s.scaleY;
    const det = pa * pd - pb * pc || 1e-9, lx = (wx * pd - wy * pb) / det, ly = (wy * pa - wx * pc) / det;
    return Math.atan2(ly, lx) * RAD - this.shearX;
  }
}

/** A place on a bone where a picture hangs: its colour now, which attachment it shows, and how that attachment is deformed. */
export class Slot {
  /** @param {SlotData} data @param {Bone} bone */
  constructor(data, bone) {
    this.data = data; this.bone = bone;
    this.color = [1, 1, 1, 1];
    /** @type {string | null} */ this.attachment = null;
    /** @type {Float32Array | null} */ this.deform = null;
    this.setToSetupPose();
  }
  setToSetupPose() { this.color[0] = this.data.color[0]; this.color[1] = this.data.color[1]; this.color[2] = this.data.color[2]; this.color[3] = this.data.color[3]; this.attachment = this.data.attachment; this.deform = null; }
}

/** The pose of a two-bone or one-bone IK constraint right now. */
export class IkConstraint {
  /** @param {object} data @param {Skeleton} skeleton */
  constructor(data, skeleton) {
    this.data = data;
    this.bones = data.bones.map((b) => skeleton.bones[b.index]);
    this.target = skeleton.bones[data.target.index];
    this.mix = data.mix; this.bend = data.bend;
  }

  setToSetupPose() { this.mix = this.data.mix; this.bend = this.data.bend; }

  /** Turn the bones so the end of the chain reaches the target (as far as it can). Call after the bones' world transforms are up to date; the chain is brought up to date again. */
  apply() {
    const mix = this.mix;
    if (mix <= 0) return;
    const t = this.target;
    if (this.bones.length === 1) {
      const bone = this.bones[0];
      const world = Math.atan2(t.worldY - bone.worldY, t.worldX - bone.worldX) * RAD, want = bone.localRotationFor(world);
      bone.rotation += angleDelta(bone.rotation, want) * mix;
      bone.updateWorld();
      return;
    }
    const [parent, child] = this.bones;
    // the joint is where the child starts; the lengths are the two segments of the limb as they stand now
    const l1 = Math.hypot(child.worldX - parent.worldX, child.worldY - parent.worldY);
    const l2 = child.data.length * Math.hypot(child.a, child.c);
    const dx = t.worldX - parent.worldX, dy = t.worldY - parent.worldY;
    const dist = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
    const toTarget = Math.atan2(dy, dx);
    let parentAngle = toTarget;                                       // radians, the direction from the parent's origin to the joint
    if (l1 > 1e-6 && dist > 1e-6) parentAngle = toTarget - this.bend * Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))));
    // the child's origin may not lie on the parent's x axis; allow for that
    const beta = Math.atan2(child.y * parent.scaleY, child.x * parent.scaleX);
    const startParent = parent.rotation, startChild = child.rotation;
    const wantParent = parent.localRotationFor((parentAngle - beta) * RAD);
    parent.rotation = startParent + angleDelta(startParent, wantParent) * mix;
    parent.updateWorld(); child.updateWorld();
    const jx = child.worldX, jy = child.worldY, childAngle = Math.atan2(t.worldY - jy, t.worldX - jx) * RAD;
    const wantChild = child.localRotationFor(childAngle);
    child.rotation = startChild + angleDelta(startChild, wantChild) * mix;
    child.updateWorld();
  }
}

/**
 * The runtime copy of a skeleton: poses, slot colours and shown attachments, constraints. Animations change its bones' and slots' fields; `updateWorldTransform()` then works out where everything is.
 *
 * ```js
 * const skeleton = new Skeleton(data);
 * skeleton.x = 200; skeleton.y = 300;                // where its root bone stands
 * state.update(dt); state.apply(skeleton);            // an AnimationState poses it
 * skeleton.updateWorldTransform();
 * drawSkeleton(skeleton, meshes, atlas);
 * ```
 */
export class Skeleton {
  /** @param {import('./loader.js').SkeletonData} data */
  constructor(data) {
    this.data = data;
    /** Where the root bone is placed in the world, and how big the whole skeleton is; a negative scale mirrors it. */
    this.x = 0; this.y = 0; this.scaleX = 1; this.scaleY = 1;
    /** A colour multiplied into every slot: [r, g, b, a] in 0..1. */
    this.color = [1, 1, 1, 1];
    /** @type {Bone[]} */ this.bones = [];
    for (const bd of data.bones) {
      const bone = new Bone(bd, this, bd.parent ? this.bones[bd.parent.index] : null);
      bone.parent?.children.push(bone);
      this.bones.push(bone);
    }
    /** @type {Slot[]} */ this.slots = data.slots.map((sd) => new Slot(sd, this.bones[sd.bone.index]));
    /** The slots in the order they are drawn (back to front); animations can change it. @type {Slot[]} */ this.drawOrder = this.slots.slice();
    /** @type {IkConstraint[]} */ this.ik = data.ik.map((d) => new IkConstraint(d, this));
    /** @type {import('./loader.js').Skin | null} */ this.skin = data.defaultSkin;
  }

  findBone(name) { return this.bones.find((b) => b.data.name === name) ?? null; }
  findSlot(name) { return this.slots.find((s) => s.data.name === name) ?? null; }
  findIk(name) { return this.ik.find((c) => c.data.name === name) ?? null; }

  /** Everything back to how it was designed: bones, slot colours and attachments, draw order, constraint settings. */
  setToSetupPose() {
    for (const b of this.bones) b.setToSetupPose();
    for (const s of this.slots) s.setToSetupPose();
    for (let i = 0; i < this.slots.length; i++) this.drawOrder[i] = this.slots[i];
    for (const c of this.ik) c.setToSetupPose();
  }

  /**
   * Show a skin (a different set of pictures for the same bones: another outfit). Slots keep their attachment names, so a name the new skin has is shown from the new skin.
   * @param {string | null} name `null` goes back to the default skin.
   */
  setSkin(name) {
    if (name === null) { this.skin = this.data.defaultSkin; return; }
    const skin = this.data.skins.get(name);
    if (!skin) throw new Error(`no skin "${name}"`);
    this.skin = skin;
  }

  /** The attachment a slot is showing now (from the current skin, else the default), or null. @param {Slot} slot @returns {Attachment | null} */
  attachmentOf(slot) {
    if (slot.attachment === null) return null;
    return this.skin?.get(slot.data.index, slot.attachment) ?? this.data.defaultSkin?.get(slot.data.index, slot.attachment) ?? null;
  }

  /** Make a slot show the attachment called `name` (or none). @param {string} slotName @param {string | null} name */
  setAttachment(slotName, name) {
    const slot = this.findSlot(slotName);
    if (!slot) throw new Error(`no slot "${slotName}"`);
    if (name !== null && !this.skin?.get(slot.data.index, name) && !this.data.defaultSkin?.get(slot.data.index, name)) throw new Error(`slot "${slotName}" has no attachment "${name}"`);
    slot.attachment = name; slot.deform = null;
  }

  /** Work out where every bone is in the world (and apply the IK constraints). Call after posing and after moving the skeleton. */
  updateWorldTransform() {
    for (const b of this.bones) b.updateWorld();
    for (const c of this.ik) {
      if (c.mix <= 0) continue;
      c.apply();
      const first = c.bones[0];                                       // bring everything below the constrained bones up to date
      const stack = [...first.children];
      while (stack.length) { const b = stack.shift(); if (c.bones.includes(b)) { stack.push(...b.children); continue; } b.updateWorld(); stack.push(...b.children); }
    }
  }

  /** Where a bone's tip or origin is: handy for attaching a sword, a particle emitter or a camera. @param {string} boneName @returns {{x: number, y: number, rotation: number}} */
  boneWorld(boneName) {
    const b = this.findBone(boneName);
    if (!b) throw new Error(`no bone "${boneName}"`);
    return { x: b.worldX, y: b.worldY, rotation: b.worldRotation };
  }
}
