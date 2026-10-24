import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkeleton, parseSkeletonColor, Skeleton, drawSkeleton, attachmentWorldVertices, skeletonBounds, hitTest, pointInPolygon, DeformTimeline } from '../src/index.js';
import { MeshBatch2D, MESH_VERTEX_WORDS, META_ADDITIVE, packTint, Atlas } from '../../render/src/index.js';
import { RIG, makeSkeleton, makeData, near } from './fixtures.js';

const n = (a, b, eps, msg) => near(assert, a, b, eps, msg);

function fakeAtlas() {
  const ctx = () => ({ save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, set fillStyle(v) {} });
  const atlas = new Atlas({ size: 128, createCanvas: () => ({ getContext: () => ctx() }) });
  for (const [name, w, h] of [['rig/torso', 40, 20], ['rig/torso-alt', 40, 20], ['rig/arm', 60, 10], ['rig/cape', 40, 20], ['rig/glow', 16, 16]]) atlas.add(name, w, h, () => {});
  return atlas;
}

// ------------------------------------------------------------------ loading

test('colours: with or without alpha and the hash, or as numbers', () => {
  assert.deepEqual(parseSkeletonColor('ff8000'), [1, 128 / 255, 0, 1]); assert.deepEqual(parseSkeletonColor('#00ff0080').map((v) => +v.toFixed(3)), [0, 1, 0, 0.502]); assert.deepEqual(parseSkeletonColor([0.5, 0.5, 0.5]), [0.5, 0.5, 0.5, 1]);
  assert.deepEqual(parseSkeletonColor(undefined, [1, 0, 0, 1]), [1, 0, 0, 1]); assert.throws(() => parseSkeletonColor('red'), /not a colour/);
});

test('a skeleton loads from an object or from JSON text, with everything in place', () => {
  const data = parseSkeleton(JSON.stringify(RIG));
  assert.equal(data.name, 'test-rig'); assert.equal(data.bones.length, 7); assert.equal(data.bones[3].parent.name, 'torso'); assert.equal(data.slots[3].blend, 'additive'); n(data.slots[3].color[3], 128 / 255, 1e-6);
  assert.deepEqual([...data.skins.keys()], ['default', 'alt']); assert.equal(data.defaultSkin.name, 'default'); assert.equal(data.events.get('footstep').string, 'left'); assert.equal(data.animations.size, 12);
  const cape = data.defaultSkin.get(data.findSlot('cape').index, 'cape'); assert.equal(cape.type, 'mesh'); assert.equal(cape.vertexCount, 4); assert.equal(cape.weighted, false); assert.equal(cape.triangles.length, 6); n(cape.color[2], 0, 1e-9);
  assert.equal(data.findBone('nope'), null);
});

test('weighted meshes: each point lists the bones that move it, with positions in their own space and weights', () => {
  const data = parseSkeleton({ bones: [{ name: 'a' }, { name: 'b', parent: 'a', x: 10 }], slots: [{ name: 's', bone: 'a', attachment: 'm' }], skins: [{ name: 'default', attachments: { s: { m: {
    type: 'mesh', path: 'p', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices: [1, 0, 0, 0, 1, 2, 0, 5, 0, 0.25, 1, 5, 0, 0.75, 1, 1, 10, 0, 1] } } } }] });
  const m = data.defaultSkin.get(0, 'm');
  assert.equal(m.weighted, true); assert.deepEqual(Array.from(m.bonesPerVertex), [1, 2, 1]); assert.deepEqual(Array.from(m.boneIndices), [0, 0, 1, 1]); assert.equal(m.influences, 4); assert.equal(m.local.length, 12);
  assert.throws(() => parseSkeleton({ bones: [{ name: 'a' }], slots: [{ name: 's', bone: 'a' }], skins: [{ name: 'default', attachments: { s: { m: { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices: [1, 9, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1] } } } }] }), /no bone number 9/);
});

test('bad skeletons are refused with a message that says what and where', () => {
  const bad = (patch, re) => assert.throws(() => makeData(patch), re);
  assert.throws(() => parseSkeleton({}), /needs bones/); assert.throws(() => parseSkeleton(null), /JSON object/);
  bad({ bones: [{ name: 'a' }, { name: 'a', parent: 'a' }] }, /two bones are called "a"/); bad({ bones: [{ name: 'a' }, { name: 'b' }] }, /no parent/); bad({ bones: [{ name: 'a' }, { name: 'b', parent: 'c' }, { name: 'c', parent: 'a' }] }, /parent "c" must come earlier/);
  bad({ slots: [{ name: 's', bone: 'ghost' }] }, /no bone "ghost"/); bad({ slots: [{ name: 's', bone: 'root', blend: 'multiply' }] }, /blend/);
  bad({ skins: [{ name: 'default', attachments: { nowhere: {} } }] }, /no slot "nowhere"/); bad({ skins: [{ name: 'default', attachments: { torso: { x: { type: 'wing' } } } }] }, /unknown type "wing"/);
  bad({ skins: [{ name: 'default', attachments: { torso: { m: { type: 'mesh', uvs: [0, 0, 1], triangles: [0, 1, 2], vertices: [] } } } }] }, /uvs are pairs/);
  bad({ skins: [{ name: 'default', attachments: { torso: { m: { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 7], vertices: [0, 0, 1, 0, 0, 1] } } } }] }, /triangles are triples/);
  bad({ skins: [{ name: 'default' }, { name: 'default' }] }, /two skins/);
  bad({ animations: { a: { bones: { ghost: {} } } } }, /no bone "ghost"/); bad({ animations: { a: { slots: { ghost: {} } } } }, /no slot "ghost"/);
  bad({ animations: { a: { bones: { head: { rotate: [{ time: 1, value: 0 }, { time: 0, value: 0 }] } } } } }, /key times must be numbers in order/);
  bad({ animations: { a: { bones: { head: { rotate: [{ time: 0, value: 0, curve: [1, 2] }] } } } } }, /curve is/); bad({ animations: { a: { events: [{ time: 0, name: 'undeclared' }] } } }, /no event "undeclared"/);
  bad({ animations: { a: { deform: { default: { torso: { torso: [{ time: 0, vertices: [] }] } } } } } }, /not a mesh/); bad({ animations: { a: { deform: { default: { cape: { cape: [{ time: 0, vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] } } } } } }, /too many numbers/);
  bad({ animations: { a: { drawOrder: [{ time: 0, offsets: [{ slot: 'hit', offset: 3 }] }] } } }, /out of the list/); bad({ animations: { a: { ik: { ghost: [{ time: 0 }] } } } }, /no IK constraint/);
  void RIG;
});

test('deform keys can start part way into the points', () => {
  const data = makeData({ animations: { d: { deform: { default: { cape: { cape: [{ time: 0, offset: 4, vertices: [1, 2, 3, 4] }] } } } } } });
  const t = data.animation('d').timelines[0]; assert.ok(t instanceof DeformTimeline); assert.deepEqual(Array.from(t.frames[0]), [0, 0, 0, 0, 1, 2, 3, 4]);
});

// ------------------------------------------------------------------ geometry

test('regions: four corners in the world, from the attachment\'s own offset, turn and size', () => {
  const s = makeSkeleton(); s.updateWorldTransform();
  const out = new Float32Array(8), torso = s.findSlot('torso'), att = s.attachmentOf(torso);
  assert.equal(attachmentWorldVertices(s, torso, att, out), 4);
  // torso bone: world (0,-50) pointing up; the region is 40 x 20 centred 20 along the bone: x runs up the screen, y runs across it
  const pts = []; for (let i = 0; i < 4; i++) pts.push([out[i * 2], out[i * 2 + 1]]);
  n(pts[0][0], -10, 1e-4); n(pts[0][1], -50 - 0, 1e-4, 'top left of the region is at local (0, -10)... in the bone\'s turned space'); n(pts[2][0], 10, 1e-4); n(pts[2][1], -90, 1e-4);
  const sized = new Float32Array(8); attachmentWorldVertices(s, s.findSlot('glow'), s.attachmentOf(s.findSlot('glow')), sized, 0, { width: 99, height: 99 });
  n(Math.hypot(sized[2] - sized[0], sized[3] - sized[1]), 16, 1e-4, 'the attachment\'s own size wins over the sprite\'s');
  const sprite = new Float32Array(8); const noSize = parseSkeleton({ bones: [{ name: 'r' }], slots: [{ name: 's', bone: 'r', attachment: 'a' }], skins: [{ name: 'default', attachments: { s: { a: { type: 'region', path: 'p' } } } }] }); const ns = new Skeleton(noSize); ns.updateWorldTransform();
  attachmentWorldVertices(ns, ns.slots[0], ns.attachmentOf(ns.slots[0]), sprite, 0, { width: 30, height: 10 }); assert.deepEqual(Array.from(sprite), [-15, -5, 15, -5, 15, 5, -15, 5], 'a region with no size takes its sprite\'s');
});

test('meshes: points follow their bone, deform offsets move them, and weighted points blend bones', () => {
  const s = makeSkeleton(); s.updateWorldTransform();
  const cape = s.findSlot('cape'), att = s.attachmentOf(cape), out = new Float32Array(8);
  attachmentWorldVertices(s, cape, att, out); n(out[0], -10, 1e-4); n(out[1], -50, 1e-4); n(out[2], 10, 1e-4); n(out[3], -50, 1e-4, 'torso points up so local y runs along the screen x, mirrored');
  cape.deform = new Float32Array(8); cape.deform[0] = 5; attachmentWorldVertices(s, cape, att, out); n(out[0], -10, 1e-4, 'a deform x offset moves along the bone\'s x, which is up'); n(out[1], -55, 1e-4);
  const data = parseSkeleton({ bones: [{ name: 'a' }, { name: 'b', parent: 'a', x: 10, rotation: 90 }], slots: [{ name: 's', bone: 'a', attachment: 'm' }], skins: [{ name: 'default', attachments: { s: { m: {
    type: 'mesh', path: 'p', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices: [1, 0, 0, 0, 1, 2, 0, 5, 0, 0.25, 1, 5, 0, 0.75, 1, 1, 10, 0, 1] } } } }] });
  const w = new Skeleton(data); w.updateWorldTransform();
  const wo = new Float32Array(6), slot = w.slots[0], m = w.attachmentOf(slot);
  attachmentWorldVertices(w, slot, m, wo);
  n(wo[0], 0, 1e-9); n(wo[1], 0, 1e-9, 'point 0: bone a only'); n(wo[2], 0.25 * 5 + 0.75 * (10 + 0), 1e-9, 'point 1: 25% a at (5,0) and 75% b at local (5,0): b is at (10,0) turned 90 so its local x runs down'); n(wo[3], 0.75 * 5, 1e-9); n(wo[4], 10, 1e-9); n(wo[5], 10, 1e-9, 'point 2: bone b at local (10,0): 10 along its x axis, which points down');
  w.findBone('b').rotation = 180; w.updateWorldTransform(); attachmentWorldVertices(w, slot, m, wo); n(wo[2], 0.25 * 5 + 0.75 * (10 - 5), 1e-9, 'turning bone b moves the points it holds'); n(wo[4], 0, 1e-9);
});

test('bounds and hit tests', () => {
  const s = makeSkeleton(); s.updateWorldTransform();
  const b = skeletonBounds(s); assert.ok(b.x1 > b.x0 && b.y1 > b.y0); assert.ok(b.y0 <= -90 && b.y1 >= -50, `${JSON.stringify(b)}`);
  assert.equal(skeletonBounds(new Skeleton(parseSkeleton({ bones: [{ name: 'r' }], slots: [] }))), null, 'nothing shown, no bounds');
  const box = hitTest(s, 0, -70); assert.equal(box.attachment.name, 'hit'); assert.equal(hitTest(s, 500, 500), null);
  assert.equal(hitTest(s, 50, -90, { any: true }).attachment.name, 'arm'); assert.equal(hitTest(s, 50, -90), null, 'by default only bounding boxes count');
  assert.equal(pointInPolygon([0, 0, 10, 0, 10, 10, 0, 10], 4, 5, 5), true); assert.equal(pointInPolygon([0, 0, 10, 0, 10, 10, 0, 10], 4, 15, 5), false);
  s.setAttachment('hit', null); const mesh = hitTest(s, 5, -80, { any: true }); assert.equal(mesh.attachment.name, 'cape', 'with the box gone, the mesh in front of the torso is what is under the point');
});

// ------------------------------------------------------------------ drawing

test('drawing: regions are quads, meshes keep their triangles, in draw order, with uvs from the atlas', () => {
  const s = makeSkeleton(), atlas = fakeAtlas(), m = new MeshBatch2D(); s.updateWorldTransform();
  const tris = drawSkeleton(s, m, atlas);
  assert.equal(tris, 2 + 2 + 2 + 2, 'torso, arm, cape and glow; the bounding box is not drawn'); assert.equal(m.vertexCount, 16); assert.equal(m.indexCount, 24);
  const torso = atlas.get('rig/torso'), f = m.f32;
  assert.deepEqual([f[2], f[3], f[MESH_VERTEX_WORDS + 2], f[MESH_VERTEX_WORDS + 3], f[2 * MESH_VERTEX_WORDS + 2], f[2 * MESH_VERTEX_WORDS + 3], f[3 * MESH_VERTEX_WORDS + 2], f[3 * MESH_VERTEX_WORDS + 3]], [torso.u0, torso.v0, torso.u1, torso.v0, torso.u1, torso.v1, torso.u0, torso.v1].map(Math.fround));
  assert.deepEqual(Array.from(m.indices.slice(0, 6)), [0, 1, 2, 0, 2, 3]); assert.deepEqual(Array.from(m.indices.slice(12, 18)), [8, 9, 10, 8, 10, 11], 'the cape is the third picture and counts from its own first point');
  const cape = atlas.get('rig/cape'), co = 8 * MESH_VERTEX_WORDS; assert.equal(m.u32[co + 4], packTint(255, 128, 0, 255), 'the cape\'s own colour'); n(f[co + 2], cape.u0, 1e-6); n(f[co + 3], cape.v0, 1e-6); n(f[co + 2 + 2 * MESH_VERTEX_WORDS], cape.u1, 1e-6);
  const glowAt = 12 * MESH_VERTEX_WORDS; assert.equal(m.u32[glowAt + 5] & META_ADDITIVE, META_ADDITIVE, 'the glow slot is additive'); assert.equal(m.u32[5] & META_ADDITIVE, 0); assert.equal(m.u32[glowAt + 4] >>> 24, 128, 'its slot colour has alpha 128');
});

test('drawing: colours multiply (skeleton, slot, attachment, tint), hidden things are skipped, and the draw order and skin are followed', () => {
  const s = makeSkeleton(), atlas = fakeAtlas(); s.updateWorldTransform();
  s.color = [0.5, 1, 1, 1]; s.findSlot('torso').color[1] = 0.5; const m = new MeshBatch2D();
  drawSkeleton(s, m, atlas, { tint: [1, 1, 1, 0.5] });
  assert.equal(m.u32[4], packTint(128, 128, 255, 128), 'half red from the skeleton, half green from the slot, half alpha from the tint');
  s.findSlot('arm').color[3] = 0; s.setAttachment('hit', null); const m2 = new MeshBatch2D(); assert.equal(drawSkeleton(s, m2, atlas), 6, 'a clear slot is not drawn');
  const order = makeSkeleton(); order.updateWorldTransform(); order.drawOrder.reverse(); const m3 = new MeshBatch2D(); drawSkeleton(order, m3, atlas);
  assert.equal(m3.u32[5] & META_ADDITIVE, META_ADDITIVE, 'back to front follows drawOrder: the glow is first now');
  const alt = makeSkeleton(); alt.updateWorldTransform(); alt.setSkin('alt'); const m4 = new MeshBatch2D(); drawSkeleton(alt, m4, atlas); assert.equal(m4.u32[5], atlas.get('rig/torso-alt').page);
  const missing = makeSkeleton({ animations: {}, skins: [{ name: 'default', attachments: { torso: { torso: { type: 'region', path: 'rig/nothing', width: 4, height: 4 } } } }] }); missing.updateWorldTransform();
  assert.throws(() => drawSkeleton(missing, new MeshBatch2D(), atlas), /no sprite "rig\/nothing" \(attachment "torso"\)/);
});

test('drawing a skeleton that is posed: the points move with the bones', () => {
  const s = makeSkeleton(), atlas = fakeAtlas(); s.updateWorldTransform();
  const before = new MeshBatch2D(); drawSkeleton(s, before, atlas);
  s.findBone('torso').rotation += 90; s.updateWorldTransform(); const after = new MeshBatch2D(); drawSkeleton(s, after, atlas);
  assert.notEqual(before.f32[0], after.f32[0]); n(Math.hypot(after.f32[0] - after.f32[2 * 0 + MESH_VERTEX_WORDS], after.f32[1] - after.f32[MESH_VERTEX_WORDS + 1]), Math.hypot(before.f32[0] - before.f32[MESH_VERTEX_WORDS], before.f32[1] - before.f32[MESH_VERTEX_WORDS + 1]), 1e-4, 'a turn keeps the size');
  s.x = 1000; s.updateWorldTransform(); const moved = new MeshBatch2D(); drawSkeleton(s, moved, atlas); n(moved.f32[0], after.f32[0] + 1000, 1e-3, 'moving the skeleton moves its drawing');
});
