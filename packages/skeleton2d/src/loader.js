import { INHERIT } from './skeleton.js';
import { Animation, RotateTimeline, Vec2Timeline, ColorTimeline, AttachmentTimeline, DeformTimeline, DrawOrderTimeline, IkTimeline, EventTimeline } from './animation.js';

/**
 * Reading a skeleton from JSON. The format (all angles in degrees, y down):
 *
 * ```json
 * {
 *   "skeleton": { "name": "hero" },
 *   "bones":  [ { "name": "root" }, { "name": "hip", "parent": "root", "x": 0, "y": -40, "rotation": 0, "length": 30, "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0, "inherit": "normal" } ],
 *   "slots":  [ { "name": "torso", "bone": "hip", "attachment": "torso", "color": "ffffffff", "blend": "normal" } ],
 *   "ik":     [ { "name": "leg", "bones": ["thigh", "shin"], "target": "foot-target", "mix": 1, "bend": 1 } ],
 *   "skins":  [ { "name": "default", "attachments": { "torso": {
 *       "torso": { "type": "region", "path": "hero/torso", "x": 0, "y": 0, "rotation": 0, "scaleX": 1, "scaleY": 1, "width": 40, "height": 60, "color": "ffffffff" },
 *       "cape":  { "type": "mesh", "path": "hero/cape", "uvs": [0,0, 1,0, 1,1, 0,1], "triangles": [0,1,2, 0,2,3], "vertices": [-20,-30, 20,-30, 20,30, -20,30], "color": "ffffffff" } } } } ],
 *   "events": { "footstep": { "int": 0, "float": 0, "string": "" } },
 *   "animations": { "walk": {
 *       "bones": { "hip": { "rotate": [ { "time": 0, "value": 0 }, { "time": 0.5, "value": 10, "curve": [0.25, 0, 0.75, 1] } ], "translate": [ { "time": 0, "x": 0, "y": 0 } ], "scale": [], "shear": [] } },
 *       "slots": { "torso": { "attachment": [ { "time": 0, "name": "torso" } ], "color": [ { "time": 0, "color": "ffffffff" } ] } },
 *       "ik": { "leg": [ { "time": 0, "mix": 1, "bend": 1 } ] },
 *       "deform": { "default": { "cape": { "cape": [ { "time": 0, "vertices": [0,0, 0,0, 0,0, 0,0] }, { "time": 1, "vertices": [4,0, 4,0, 0,0, 0,0] } ] } } },
 *       "drawOrder": [ { "time": 0.3, "offsets": [ { "slot": "torso", "offset": 1 } ] } ],
 *       "events": [ { "time": 0.25, "name": "footstep" } ] } }
 * }
 * ```
 * A mesh whose `vertices` is longer than twice its point count is weighted: for each point, a count of bones, then for each bone its number, the point's x and y in that bone's space, and the weight (the weights of a point add up to 1).
 * Bone keys are relative to the setup pose (see `animation.js`). Curves: leave out for a straight line, `"stepped"` to hold, or four numbers for a Bezier ease.
 */

/**
 * @typedef {import('./skeleton.js').BoneData} BoneData
 * @typedef {import('./skeleton.js').SlotData} SlotData
 */

const INHERIT_NAMES = { normal: INHERIT.normal, onlyTranslation: INHERIT.onlyTranslation, noRotationOrReflection: INHERIT.noRotationOrReflection, noScale: INHERIT.noScale, noScaleOrReflection: INHERIT.noScaleOrReflection };

/** A colour as [r, g, b, a] in 0..1 from "rrggbb", "rrggbbaa" (with or without a #) or an array. @param {string | number[] | undefined} c @param {number[]} [fallback] */
export function parseSkeletonColor(c, fallback = [1, 1, 1, 1]) {
  if (c === undefined || c === null) return fallback.slice();
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] ?? 1];
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(c));
  if (!m) throw new Error(`not a colour: ${c}`);
  const n = (h, i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(m[1], 0), n(m[1], 2), n(m[1], 4), m[2] ? n(m[2], 0) : 1];
}

/** The pictures of one outfit: attachments by slot and name. */
export class Skin {
  /** @param {string} name */
  constructor(name) { this.name = name; /** @type {Map<number, Map<string, import('./skeleton.js').Attachment>>} */ this.attachments = new Map(); }
  /** @param {number} slot @param {string} name @param {import('./skeleton.js').Attachment} attachment */
  set(slot, name, attachment) { let m = this.attachments.get(slot); if (!m) this.attachments.set(slot, m = new Map()); m.set(name, attachment); }
  /** @param {number} slot @param {string} name */
  get(slot, name) { return this.attachments.get(slot)?.get(name) ?? null; }
}

/** The designed skeleton: bones, slots, constraints, skins, events and animations. Shared by every `Skeleton` made from it. */
export class SkeletonData {
  constructor(name = '') {
    this.name = name;
    /** @type {BoneData[]} */ this.bones = [];
    /** @type {SlotData[]} */ this.slots = [];
    /** @type {object[]} */ this.ik = [];
    /** @type {Map<string, Skin>} */ this.skins = new Map();
    /** @type {Skin | null} */ this.defaultSkin = null;
    /** @type {Map<string, {name: string, int: number, float: number, string: string}>} */ this.events = new Map();
    /** @type {Map<string, Animation>} */ this.animations = new Map();
  }
  findBone(name) { return this.bones.find((b) => b.name === name) ?? null; }
  findSlot(name) { return this.slots.find((s) => s.name === name) ?? null; }
  /** @param {string} name @returns {Animation} */
  animation(name) { const a = this.animations.get(name); if (!a) throw new Error(`no animation "${name}" (has: ${[...this.animations.keys()].join(', ') || 'none'})`); return a; }
}

const num = (v, d) => (v === undefined || v === null ? d : Number(v));
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const curveOf = (key) => {
  const c = key.curve;
  if (c === undefined || c === null || c === 'linear') return null;
  if (c === 'stepped') return 'stepped';
  need(Array.isArray(c) && c.length === 4 && c.every(Number.isFinite), 'a curve is "stepped" or four numbers');
  return c.slice();
};
const timesOf = (keys, what) => {
  let last = -Infinity;
  for (const k of keys) { need(Number.isFinite(k.time) && k.time >= last, `${what}: key times must be numbers in order`); last = k.time; }
  return keys.map((k) => k.time);
};

function parseVertices(vertices, count, weightedAllowed, what) {
  need(Array.isArray(vertices), `${what}: vertices are a list of numbers`);
  if (vertices.length === count * 2) return { weighted: false, local: Float32Array.from(vertices), influences: count, bonesPerVertex: null, boneIndices: null };
  need(weightedAllowed, `${what}: expected ${count * 2} numbers`);
  const per = [], bones = [], local = [];
  for (let i = 0; i < vertices.length;) {
    const n = vertices[i++];
    need(Number.isInteger(n) && n > 0, `${what}: a point lists how many bones move it`);
    per.push(n);
    for (let k = 0; k < n; k++) { bones.push(vertices[i++]); local.push(vertices[i++], vertices[i++], vertices[i++]); }
  }
  need(per.length === count, `${what}: ${per.length} points listed, ${count} expected`);
  return { weighted: true, local: Float32Array.from(local), influences: bones.length, bonesPerVertex: Int32Array.from(per), boneIndices: Int32Array.from(bones) };
}

/**
 * Read a skeleton from the JSON format described at the top of this file.
 * @param {string | object} source The JSON text or the parsed object. @returns {SkeletonData}
 */
export function parseSkeleton(source) {
  const j = typeof source === 'string' ? JSON.parse(source) : source;
  need(j && typeof j === 'object', 'a skeleton is a JSON object');
  const data = new SkeletonData(j.skeleton?.name ?? '');
  need(Array.isArray(j.bones) && j.bones.length > 0, 'a skeleton needs bones');
  for (const b of j.bones) {
    need(typeof b.name === 'string' && b.name, 'a bone needs a name');
    need(!data.findBone(b.name), `two bones are called "${b.name}"`);
    let parent = null;
    if (b.parent !== undefined) { parent = data.findBone(b.parent); need(parent, `bone "${b.name}": parent "${b.parent}" must come earlier in the list`); } else need(data.bones.length === 0, `bone "${b.name}" has no parent (only the first bone may be the root)`);
    need(b.inherit === undefined || b.inherit in INHERIT_NAMES, `bone "${b.name}": unknown inherit "${b.inherit}"`);
    data.bones.push({ index: data.bones.length, name: b.name, parent, length: num(b.length, 0), x: num(b.x, 0), y: num(b.y, 0), rotation: num(b.rotation, 0), scaleX: num(b.scaleX, 1), scaleY: num(b.scaleY, 1), shearX: num(b.shearX, 0), shearY: num(b.shearY, 0), inherit: INHERIT_NAMES[b.inherit ?? 'normal'] });
  }
  for (const s of j.slots ?? []) {
    const bone = data.findBone(s.bone);
    need(bone, `slot "${s.name}": no bone "${s.bone}"`); need(!data.findSlot(s.name), `two slots are called "${s.name}"`);
    need(s.blend === undefined || s.blend === 'normal' || s.blend === 'additive', `slot "${s.name}": blend is "normal" or "additive"`);
    data.slots.push({ index: data.slots.length, name: s.name, bone, color: parseSkeletonColor(s.color), attachment: s.attachment ?? null, blend: s.blend ?? 'normal' });
  }
  for (const c of j.ik ?? []) {
    need(Array.isArray(c.bones) && (c.bones.length === 1 || c.bones.length === 2), `IK "${c.name}": one or two bones`);
    const bones = c.bones.map((n) => { const b = data.findBone(n); need(b, `IK "${c.name}": no bone "${n}"`); return b; }), target = data.findBone(c.target);
    need(target, `IK "${c.name}": no target bone "${c.target}"`);
    if (bones.length === 2) need(bones[1].parent === bones[0], `IK "${c.name}": the second bone must be a child of the first`);
    data.ik.push({ name: c.name, bones, target, mix: num(c.mix, 1), bend: c.bend === -1 ? -1 : 1 });
  }
  for (const [name, e] of Object.entries(j.events ?? {})) data.events.set(name, { name, int: num(e?.int, 0), float: num(e?.float, 0), string: e?.string ?? '' });

  const skins = j.skins?.length ? j.skins : [{ name: 'default', attachments: {} }];
  for (const sk of skins) {
    const skin = new Skin(sk.name ?? 'default');
    for (const [slotName, byName] of Object.entries(sk.attachments ?? {})) {
      const slot = data.findSlot(slotName);
      need(slot, `skin "${skin.name}": no slot "${slotName}"`);
      for (const [name, a] of Object.entries(byName)) {
        const what = `skin "${skin.name}", slot "${slotName}", attachment "${name}"`;
        const type = a.type ?? 'region', path = a.path ?? name, color = parseSkeletonColor(a.color);
        if (type === 'region') {
          skin.set(slot.index, name, { type, name, path, color, x: num(a.x, 0), y: num(a.y, 0), rotation: num(a.rotation, 0), scaleX: num(a.scaleX, 1), scaleY: num(a.scaleY, 1), width: num(a.width, 0), height: num(a.height, 0) });
        } else if (type === 'mesh') {
          need(Array.isArray(a.uvs) && a.uvs.length >= 6 && a.uvs.length % 2 === 0, `${what}: uvs are pairs, at least three points`);
          const count = a.uvs.length / 2, v = parseVertices(a.vertices, count, true, what);
          need(Array.isArray(a.triangles) && a.triangles.length % 3 === 0 && a.triangles.length > 0 && a.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < count), `${what}: triangles are triples of point numbers below ${count}`);
          if (v.weighted) for (const bi of v.boneIndices) need(Number.isInteger(bi) && bi >= 0 && bi < data.bones.length, `${what}: no bone number ${bi}`);
          skin.set(slot.index, name, { type, name, path, color, uvs: Float32Array.from(a.uvs), triangles: Uint16Array.from(a.triangles), vertexCount: count, hull: a.hull ?? count, ...v, width: num(a.width, 0), height: num(a.height, 0) });
        } else if (type === 'boundingbox') {
          const count = a.vertexCount ?? Math.floor(a.vertices?.length / 2), v = parseVertices(a.vertices, count, a.vertexCount !== undefined, what);
          skin.set(slot.index, name, { type, name, path, color, vertexCount: count, ...v });
        } else throw new Error(`${what}: unknown type "${type}"`);
      }
    }
    need(!data.skins.has(skin.name), `two skins are called "${skin.name}"`);
    data.skins.set(skin.name, skin);
  }
  data.defaultSkin = data.skins.get('default') ?? data.skins.values().next().value;

  for (const [name, an] of Object.entries(j.animations ?? {})) data.animations.set(name, parseAnimation(data, name, an));
  return data;
}

function parseAnimation(data, name, an) {
  const timelines = [], at = `animation "${name}"`;
  for (const [boneName, tl] of Object.entries(an.bones ?? {})) {
    const bone = data.findBone(boneName);
    need(bone, `${at}: no bone "${boneName}"`);
    if (tl.rotate?.length) timelines.push(new RotateTimeline(bone.index, timesOf(tl.rotate, `${at}, ${boneName} rotate`), tl.rotate.map((k) => num(k.value ?? k.angle, 0)), tl.rotate.map(curveOf)));
    for (const [prop, kind, dx, dy] of [['translate', 'translate', 0, 0], ['scale', 'scale', 1, 1], ['shear', 'shear', 0, 0]]) {
      const keys = tl[prop];
      if (keys?.length) timelines.push(new Vec2Timeline(kind, bone.index, timesOf(keys, `${at}, ${boneName} ${prop}`), keys.flatMap((k) => [num(k.x, dx), num(k.y, dy)]), keys.map(curveOf)));
    }
  }
  for (const [slotName, tl] of Object.entries(an.slots ?? {})) {
    const slot = data.findSlot(slotName);
    need(slot, `${at}: no slot "${slotName}"`);
    if (tl.attachment?.length) timelines.push(new AttachmentTimeline(slot.index, timesOf(tl.attachment, `${at}, ${slotName} attachment`), tl.attachment.map((k) => k.name ?? null)));
    if (tl.color?.length) timelines.push(new ColorTimeline(slot.index, timesOf(tl.color, `${at}, ${slotName} color`), tl.color.flatMap((k) => parseSkeletonColor(k.color, slot.color)), tl.color.map(curveOf)));
  }
  for (const [ikName, keys] of Object.entries(an.ik ?? {})) {
    const index = data.ik.findIndex((c) => c.name === ikName);
    need(index >= 0, `${at}: no IK constraint "${ikName}"`);
    if (keys.length) timelines.push(new IkTimeline(index, timesOf(keys, `${at}, ${ikName}`), keys.map((k) => num(k.mix, 1)), keys.map((k) => (k.bend === -1 ? -1 : 1)), keys.map(curveOf)));
  }
  for (const [skinName, bySlot] of Object.entries(an.deform ?? {})) {
    const skin = data.skins.get(skinName);
    need(skin, `${at}: no skin "${skinName}"`);
    for (const [slotName, byAttachment] of Object.entries(bySlot)) {
      const slot = data.findSlot(slotName);
      need(slot, `${at}: no slot "${slotName}"`);
      for (const [attName, keys] of Object.entries(byAttachment)) {
        const att = skin.get(slot.index, attName);
        need(att && (att.type === 'mesh'), `${at}: "${attName}" in skin "${skinName}" is not a mesh`);
        const n = att.influences * 2;
        const frames = keys.map((k) => { const f = new Float32Array(n), off = k.offset ?? 0, v = k.vertices ?? []; need(off + v.length <= n, `${at}: a deform key has too many numbers (${off + v.length} > ${n})`); f.set(v, off); return f; });
        if (keys.length) timelines.push(new DeformTimeline(slot.index, att, timesOf(keys, `${at}, ${slotName} deform`), frames, keys.map(curveOf)));
      }
    }
  }
  if (an.drawOrder?.length) {
    const n = data.slots.length;
    const orders = an.drawOrder.map((k) => {
      if (!k.offsets?.length) return null;
      const offsets = k.offsets.map((o) => { const s = data.findSlot(o.slot); need(s, `${at}: no slot "${o.slot}"`); return { index: s.index, offset: o.offset }; }).sort((a, b) => a.index - b.index);
      const order = new Array(n).fill(-1), unchanged = [];
      let original = 0;
      for (const o of offsets) {
        while (original !== o.index) unchanged.push(original++);
        const to = original + o.offset;
        need(to >= 0 && to < n, `${at}: a draw order offset moves a slot out of the list`);
        order[to] = original++;
      }
      while (original < n) unchanged.push(original++);
      for (let i = n - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop();
      return order;
    });
    timelines.push(new DrawOrderTimeline(timesOf(an.drawOrder, `${at}, drawOrder`), orders));
  }
  if (an.events?.length) {
    const events = an.events.map((k) => {
      const base = data.events.get(k.name);
      need(base, `${at}: no event "${k.name}" (declare it under "events")`);
      return { name: k.name, int: num(k.int, base.int), float: num(k.float, base.float), string: k.string ?? base.string };
    });
    timelines.push(new EventTimeline(timesOf(an.events, `${at}, events`), events));
  }
  return new Animation(name, timelines, an.duration);
}
