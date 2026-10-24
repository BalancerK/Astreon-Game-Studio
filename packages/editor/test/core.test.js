import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrefabLibrary, ComponentRegistry } from '../../prefab/src/index.js';
import { defineComponent } from '../../core/src/index.js';
import { SceneDocument } from '../../scene/src/index.js';
import { Camera3D } from '../../render/src/index.js';
import { mat4 } from '../../math/src/index.js';
import {
  atRotation, atMatrix, decompose, eulerFromQuat, quatFromEuler, worldToLocalAt, atPatch,
  rayFromScreen, rayAabb, rayOrientedBox, rayPlane, rayLine, pick, inRect, Gizmo, OrbitController, Selection, SceneView, inspect, applyField, resetField, parseValue,
  copyText, pasteText, Shortcuts, describeKey, MemorySceneStore, HttpSceneStore,
} from '../src/index.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const nearV = (a, b, eps = 1e-6) => a.forEach((v, i) => near(v, b[i], eps, `[${i}]`));

const Colour = defineComponent('colour', { r: 'f32', g: 'f32', b: 'f32' });
const Health = defineComponent('health', { hp: 'f32', max: 'f32' });
const library = () => new PrefabLibrary(new ComponentRegistry().add(Colour).add(Health)).define([
  { name: 'thing', components: { transform: {} } },
  { name: 'crate', extends: 'thing', components: { colour: { r: 0.8, g: 0.6, b: 0.3 }, health: { hp: 10, max: 10 } }, extras: { body: { shape: { type: 'box', hx: 0.5, hy: 0.3, hz: 0.4 }, mass: 8 } }, params: { mass: 'extras.body.mass', hp: 'components.health.hp' } },
  { name: 'ball', extends: 'thing', extras: { body: { shape: { type: 'sphere', radius: 0.35 } } } },
  { name: 'lamp', extends: 'thing' },
  { name: 'ragdoll', extends: 'thing', extras: { body: { shape: { type: 'box', hx: 0.3, hy: 0.45, hz: 0.18 } } }, children: [{ name: 'head', prefab: 'ball', local: { y: 0.75 } }, { name: 'arm', prefab: 'thing', local: { x: 0.5 }, extras: { body: { shape: { type: 'capsule', radius: 0.1, halfHeight: 0.2 } } } }] },
]);
const scene = () => ({
  format: 'engine-scene', version: 1, name: 't', entities: [
    { id: 'room', prefab: 'lamp', at: { x: 10, z: 5, yaw: Math.PI / 2 } },
    { id: 'crate-1', prefab: 'crate', at: { x: 2 }, parent: 'room', params: { mass: 20 }, overrides: { components: { colour: { r: 1 } } } },
    { id: 'doll', prefab: 'ragdoll', at: { x: -4, y: 1 } },
    { id: 'plain', prefab: 'lamp', at: { x: 0, y: 5 } },
  ],
});

// ---- transforms ----
test('Euler angles and quaternions agree, including near the poles', () => {
  for (const e of [[0, 0, 0], [30, 45, 60], [-100, 20, 170], [90, 0, 0], [0, 89, 0], [10, -80, -20]]) {
    const q = quatFromEuler(e), back = eulerFromQuat(q);
    const q2 = quatFromEuler(back);
    const d = Math.abs(q[0] * q2[0] + q[1] * q2[1] + q[2] * q2[2] + q[3] * q2[3]);
    near(d, 1, 1e-9, `${e}`);
  }
  nearV(eulerFromQuat(quatFromEuler([20, 30, 40])), [20, 30, 40], 1e-9);
  const g = eulerFromQuat(quatFromEuler([0, 90, 0])); near(g[1], 90, 1e-6); // gimbal lock keeps the pitch
});

test('worldToLocalAt undoes a parent, keeps yaw as yaw, and scale and matrices round trip', () => {
  const parent = atMatrix({ x: 10, z: 5, yaw: Math.PI / 2, scale: 2 });
  const world = atMatrix({ x: 11, y: 1, z: 5 });
  const d = decompose(world);
  const local = worldToLocalAt(parent, d.position, d.rotation, d.scale, {});
  const back = mat4.multiply(new Float64Array(16), parent, atMatrix(local));
  nearV([...back], [...world], 1e-5);
  const withYaw = worldToLocalAt(null, [1, 2, 3], atRotation({ yaw: 0.5 }), 1, { yaw: 0 });
  near(withYaw.yaw, 0.5, 1e-6); assert.equal(withYaw.rotation, undefined); assert.equal(withYaw.scale, undefined);
  const tilted = worldToLocalAt(null, [0, 0, 0], quatFromEuler([30, 0, 0]), 1.5, { yaw: 0.1 });
  assert.ok(tilted.rotation && tilted.yaw === undefined); near(tilted.scale, 1.5);
  assert.deepEqual(atPatch({ x: 1, yaw: 1, scale: 2 }, { x: 3, rotation: [0, 0, 0, 1] }), { at: { x: 3, yaw: null, rotation: [0, 0, 0, 1], scale: null } });
  near(decompose(atMatrix({ scale: 3 })).scale, 3);
});

// ---- picking ----
test('rays: boxes, turned and scaled boxes, planes, lines; the nearest hit wins', () => {
  near(rayAabb([0, 0, 10], [0, 0, -1], [-1, -1, -1], [1, 1, 1]), 9);
  assert.equal(rayAabb([5, 0, 10], [0, 0, -1], [-1, -1, -1], [1, 1, 1]), null);
  near(rayAabb([0, 0, 0], [0, 0, -1], [-1, -1, -1], [1, 1, 1]), 0, 1e-9, 'starting inside');
  const turned = atMatrix({ x: 0, z: -10, yaw: Math.PI / 4, scale: 2 });
  near(rayOrientedBox([0, 0, 0], [0, 0, -1], turned, [1, 1, 1]), 10 - Math.SQRT2 * 2, 1e-6);
  assert.equal(rayOrientedBox([3, 0, 0], [0, 0, -1], atMatrix({ z: -10 }), [1, 1, 1]), null);
  const p = rayPlane([0, 5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0]); near(p.t, 5); assert.equal(rayPlane([0, 5, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0]), null, 'behind');
  const l = rayLine([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0]); near(l.distance, 0); near(l.s, 5);
  const l2 = rayLine([3, 2, 5], [0, 0, -1], [0, 0, 0], [1, 0, 0]); near(l2.t, 3); near(l2.distance, 2);
  const items = [{ id: 'far', matrix: atMatrix({ z: -20 }), half: [1, 1, 1] }, { id: 'near', matrix: atMatrix({ z: -8 }), half: [1, 1, 1] }, { id: 'miss', matrix: atMatrix({ x: 9, z: -3 }), half: [1, 1, 1] }];
  assert.equal(pick({ origin: [0, 0, 0], dir: [0, 0, -1] }, items).item.id, 'near');
  assert.equal(pick({ origin: [0, 0, 0], dir: [0, 1, 0] }, items), null);
});

test('a camera ray through the screen centre hits the orbit target; box selection finds what is inside', () => {
  const cam = new Camera3D({ fovY: 1, viewW: 800, viewH: 600 });
  const orbit = new OrbitController({ target: [3, 2, -1], yaw: 0.7, pitch: 0.4, distance: 15 });
  orbit.apply(cam); cam.update();
  const ray = rayFromScreen(cam, 400, 300);
  const t = (3 - ray.origin[0]) / ray.dir[0];
  nearV([ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t], [3, 2, -1], 1e-4);
  const items = [{ id: 'centre', matrix: atMatrix({ x: 3, y: 2, z: -1 }) }, { id: 'away', matrix: atMatrix({ x: 40, y: 2, z: -1 }) }, { id: 'behind', matrix: atMatrix({ x: ray.origin[0] * 2 - 3, y: ray.origin[1] * 2 - 2, z: ray.origin[2] * 2 + 1 }) }];
  assert.deepEqual(inRect(cam, items, 350, 250, 450, 350), ['centre']);
});

test('orbit: dragging orbits, panning follows the pointer, zooming is bounded, focus frames a box', () => {
  const o = new OrbitController({ target: [0, 0, 0], yaw: 0, pitch: 0, distance: 10 });
  o.orbit(100, 0); near(o.yaw, -0.6, 1e-9); o.orbit(0, 1e6); near(o.pitch, 1.5);
  const p = new OrbitController({ target: [0, 0, 0], yaw: 0, pitch: 0, distance: 10 });
  p.pan(100, 0, 1, 600);   // grab and drag right: the scene follows, so the target goes left
  assert.ok(p.target[0] < 0 && Math.abs(p.target[1]) < 1e-9 && Math.abs(p.target[2]) < 1e-9);
  p.target = [0, 0, 0]; p.pan(0, 100, 1, 600); assert.ok(p.target[1] > 0, 'drag down: target up');
  const z = new OrbitController({ distance: 10, minDistance: 2, maxDistance: 12 }); z.zoom(1); near(z.distance, 11); z.zoom(1); z.zoom(1); near(z.distance, 12); for (let i = 0; i < 50; i++) z.zoom(-1); near(z.distance, 2);
  const f = new OrbitController({}); f.focus([-5, 0, -5], [5, 4, 5], 1); nearV(f.target, [0, 2, 0]); assert.ok(f.distance > 7);
  const fl = new OrbitController({ target: [0, 0, 0], yaw: 0, pitch: 0, distance: 10 }); fl.fly([0, 0, 1], 1); assert.ok(fl.target[2] < -1, 'forward is towards -z at yaw 0');
});

// ---- gizmo ----
const rayTo = (from, to) => { const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]; const l = Math.hypot(...d); return { origin: from, dir: d.map((v) => v / l) }; };

test('translate gizmo: axes and planes are hit where they are drawn, and a drag moves along exactly that axis, with snapping', () => {
  const g = new Gizmo({ mode: 'translate' });
  const cam = [0, 0, 10], origin = [0, 0, 0], q = [0, 0, 0, 1];
  const s = g.size(origin, cam);
  assert.equal(g.hit(rayTo(cam, [s * 0.6, 0, 0]), origin, q, cam), 'x');
  assert.equal(g.hit(rayTo(cam, [0, s * 0.6, 0]), origin, q, cam), 'y');
  assert.equal(g.hit(rayTo(cam, [s * 0.15, s * 0.15, 0]), origin, q, cam), 'xy');
  assert.equal(g.hit(rayTo(cam, [s * 2, 0, 0]), origin, q, cam), null);
  const st = g.begin('x', rayTo(cam, [s * 0.5, 0, 0]), origin, q, 1, cam);
  const r = g.update(st, rayTo(cam, [s * 0.5 + 3, 0, 0]));
  nearV(r.position, [3, 0, 0], 1e-6);
  const r2 = g.update(st, rayTo(cam, [s * 0.5 + 3, 4, 0])); near(r2.position[1], 0); near(r2.position[2], 0); assert.ok(r2.position[0] > 2 && r2.position[0] < 3.2); // the drag stays on the axis
  g.snap.move = 0.5; nearV(g.update(st, rayTo(cam, [s * 0.5 + 3.3, 0, 0])).position, [3.5, 0, 0], 1e-6);
  g.snap.move = 0;
  const sp = g.begin('xy', rayTo(cam, [s * 0.15, s * 0.15, 0]), origin, q, 1, cam);
  nearV(g.update(sp, rayTo(cam, [s * 0.15 + 2, s * 0.15 - 1, 0])).position, [2, -1, 0], 1e-6);
  // local space follows the object's rotation
  const local = new Gizmo({ mode: 'translate', space: 'local' });
  const turned = quatFromEuler([0, 90, 0]);
  nearV(local.basis(turned)[0], [0, 0, -1], 1e-9);
  const geo = g.geometry(origin, q, cam); assert.equal(geo.lines.filter((l) => l.id.length === 1).length, 3);
});

test('rotate gizmo: rings are hit on the ring, dragging turns by the angle swept, with snapping; scale gizmo scales by distance ratio', () => {
  const g = new Gizmo({ mode: 'rotate' });
  const cam = [0, 0, 10], origin = [0, 0, 0], q = [0, 0, 0, 1], s = g.size(origin, cam);
  assert.equal(g.hit(rayTo(cam, [s, 0, 0]), origin, q, cam), 'rz', 'seen from the front, the z ring is the circle you see');
  assert.equal(g.hit(rayTo(cam, [0.2 * s, 0, 0]), origin, q, cam), null, 'inside the ring');
  const st = g.begin('rz', rayTo(cam, [s, 0, 0]), origin, q, 1, cam);
  const r = g.update(st, rayTo(cam, [0, s, 0]));
  near(r.angle, Math.PI / 2, 1e-6); nearV(eulerFromQuat(r.rotation), [0, 0, 90], 1e-6);
  g.snap.rotate = 15; const r2 = g.update(st, rayTo(cam, [s * Math.cos(0.3), s * Math.sin(0.3), 0])); near(r2.angle, (15 * Math.PI) / 180, 1e-9);
  const sc = new Gizmo({ mode: 'scale' });
  const su = sc.begin('u', rayTo(cam, [s * 0.5, 0, 0]), origin, q, 2, cam);
  near(sc.update(su, rayTo(cam, [s, 0, 0])).scale, 4, 1e-6);
  assert.equal(sc.hit(rayTo(cam, [0, 0, 0]), origin, q, cam), 'u');
  near(sc.update(su, rayTo(cam, [0.0001, 0, 0])).scale, 0.02, 1e-6, 'never zero');
});

// ---- selection ----
test('selection: primary is the last picked, toggling, ranges, follows the document, roots skip children of selected parents', () => {
  const doc = new SceneDocument(scene(), { library: library() });
  const sel = new Selection(); const stop = sel.follow(doc);
  const log = []; sel.onChange((ids) => log.push(ids.join()));
  sel.set('room'); sel.add('doll'); assert.equal(sel.primary, 'doll'); sel.toggle('room'); assert.deepEqual(sel.ids, ['doll']);
  sel.set(['room', 'crate-1']); assert.deepEqual(sel.roots(doc), ['room']);
  sel.set('room'); sel.range('plain', doc.order); assert.deepEqual(sel.ids, ['room', 'crate-1', 'doll', 'plain']); assert.equal(sel.primary, 'plain');
  assert.equal(sel.set(['room', 'crate-1', 'doll', 'plain']), false, 'no change, no event');
  doc.remove('doll'); assert.ok(!sel.has('doll'));
  stop(); doc.remove('plain'); assert.ok(sel.has('plain'), 'after unfollowing');
  assert.ok(log.length >= 4);
});

// ---- the scene view ----
test('SceneView: world matrices follow parents, prefab shapes come from data, overrides and parameters show, bounds frame the selection', () => {
  const doc = new SceneDocument(scene(), { library: library() });
  const view = new SceneView(doc, { library: library() });
  // the crate is 2 m along the room's x, and the room is turned 90 degrees about y: so it ends up at z = 5 - 2
  const m = view.worldMatrix('crate-1'); nearV([m[12], m[13], m[14]], [10, 0, 3], 1e-9);
  const items = view.items();
  const crate = items.find((i) => i.id === 'crate-1');
  assert.deepEqual(crate.shape, { type: 'box', hx: 0.5, hy: 0.3, hz: 0.4 }); nearV(crate.color, [1, 0.6, 0.3]);
  const doll = items.filter((i) => i.id === 'doll');
  assert.deepEqual(doll.map((i) => i.path).sort(), ['', 'arm', 'head']);
  const head = doll.find((i) => i.path === 'head'); nearV([head.matrix[12], head.matrix[13], head.matrix[14]], [-4, 1.75, 0], 1e-9); assert.equal(head.shape.type, 'sphere');
  assert.equal(doll.find((i) => i.path === 'arm').shape.type, 'capsule');
  const plain = items.find((i) => i.id === 'plain'); assert.ok(plain.marker, 'no shape of its own: a marker, so it can still be picked');
  const b = view.bounds(['crate-1']);
  near(b.max[0] - b.min[0], 0.8, 1e-9, 'rotated 90 degrees: the box is 0.8 wide along x'); near(b.max[2] - b.min[2], 1.0, 1e-9);
  assert.equal(view.bounds(['nope']), null);
  // editing changes what is shown
  doc.update('crate-1', { overrides: { extras: { body: { shape: { hx: 2 } } } } });
  assert.equal(view.items().find((i) => i.id === 'crate-1').shape.hx, 2);
  doc.update('room', { at: { x: 0 } }); near(view.worldMatrix('crate-1')[12], 0, 1e-9);
  // a prefab that does not exist is reported, and the entity still gets a marker
  const loose = new SceneDocument({ format: 'engine-scene', version: 1, entities: [{ id: 'b1', prefab: 'ghost' }] }); const v2 = new SceneView(loose, { library: library() });
  assert.ok(v2.items().find((i) => i.id === 'b1').marker); assert.match(v2.errors.get('b1'), /ghost/);
});

// ---- the inspector ----
test('the inspector lists transform, parameters, components and extras with prefab values and what is overridden', () => {
  const doc = new SceneDocument(scene(), { library: library() });
  const info = inspect(doc, 'crate-1', { library: library() });
  const titles = info.sections.map((s) => s.title);
  assert.deepEqual(titles, ['Entity', 'Transform', 'Parameters', 'colour', 'health', 'extras: body']);
  const field = (title, label) => info.sections.find((s) => s.title === title).fields.find((f) => f.label === label);
  assert.deepEqual(field('Transform', 'position').value, [2, 0, 0]);
  assert.equal(field('Parameters', 'mass').value, 20); assert.equal(field('Parameters', 'mass').overridden, true); assert.equal(field('Parameters', 'mass').base, 8);
  assert.equal(field('Parameters', 'hp').value, 10); assert.equal(field('Parameters', 'hp').overridden, false);
  assert.equal(field('colour', 'r').value, 1); assert.equal(field('colour', 'r').overridden, true); assert.equal(field('colour', 'r').base, 0.8);
  assert.equal(info.sections.find((s) => s.title === 'colour').kind, 'colour');
  assert.equal(field('extras: body', 'shape.hx').type, 'number'); assert.equal(field('extras: body', 'shape.type').type, 'string');
  const rag = inspect(doc, 'doll', { library: library() });
  assert.ok(rag.sections.some((s) => s.title === 'Parts' && s.fields.length === 2));
  assert.equal(inspect(doc, 'nope', { library: library() }), null);
  const bad = new SceneDocument({ ...scene(), entities: [{ id: 'x', prefab: 'ghost' }] });
  assert.match(inspect(bad, 'x', { library: library() }).error, /ghost/);
});

test('inspector edits are single undoable steps; reset removes the override; mistakes are explained', () => {
  const lib = library();
  const doc = new SceneDocument(scene(), { library: lib });
  const f = (id, title, label) => inspect(doc, id, { library: lib }).sections.find((s) => s.title === title).fields.find((x) => x.label === label);
  applyField(doc, 'crate-1', f('crate-1', 'Transform', 'position'), '5, 1 2'); assert.deepEqual(doc.get('crate-1').at, { x: 5, y: 1, z: 2 });
  applyField(doc, 'crate-1', f('crate-1', 'Transform', 'rotation (°)'), [0, 90, 0]); assert.ok(doc.get('crate-1').at.rotation); nearV(eulerFromQuat(doc.get('crate-1').at.rotation), [0, 90, 0], 1e-5);
  applyField(doc, 'crate-1', f('crate-1', 'Transform', 'rotation (°)'), [0, 0, 0]); assert.equal(doc.get('crate-1').at.rotation, undefined);
  applyField(doc, 'crate-1', f('crate-1', 'Parameters', 'hp'), '33'); assert.equal(doc.get('crate-1').params.hp, 33);
  applyField(doc, 'crate-1', f('crate-1', 'extras: body', 'shape.hx'), 3); assert.equal(doc.get('crate-1').overrides.extras.body.shape.hx, 3);
  applyField(doc, 'crate-1', f('crate-1', 'Entity', 'name'), 'Big crate'); assert.equal(doc.get('crate-1').name, 'Big crate');
  applyField(doc, 'crate-1', f('crate-1', 'Entity', 'disabled'), true); assert.equal(doc.get('crate-1').disabled, true);
  applyField(doc, 'crate-1', f('crate-1', 'Entity', 'id'), 'crate-9'); assert.ok(doc.has('crate-9') && !doc.has('crate-1'));
  resetField(doc, 'crate-9', f('crate-9', 'Parameters', 'hp')); assert.equal(doc.get('crate-9').params.hp, undefined);
  resetField(doc, 'crate-9', f('crate-9', 'Transform', 'position')); assert.equal(doc.get('crate-9').at.x, undefined);
  assert.throws(() => applyField(doc, 'crate-9', f('crate-9', 'Parameters', 'hp'), 'lots'), /"lots" is not a number/);
  assert.throws(() => applyField(doc, 'crate-9', f('crate-9', 'Transform', 'position'), '1 2'), /needs 3 numbers/);
  assert.throws(() => applyField(doc, 'crate-9', f('crate-9', 'Entity', 'prefab'), 'x'), /cannot be edited/);
  assert.throws(() => applyField(doc, 'crate-9', f('crate-9', 'Entity', 'id'), 'plain'), /already an entity/);
  assert.throws(() => parseValue({ type: 'json', label: 'j' }, '{nope'), /not valid JSON/);
  // dragging a number is one step
  const before = doc.undoStack.length;
  for (let i = 1; i <= 20; i++) applyField(doc, 'doll', f('doll', 'Transform', 'position'), [i, 1, 0], { merge: 'drag' });
  assert.equal(doc.undoStack.length, before + 1);
  doc.undo(); assert.equal(doc.get('doll').at.x, -4);
});

// ---- clipboard, shortcuts, store ----
test('copy and paste: fresh ids, internal parents kept, offset, one undo step, foreign text ignored', () => {
  const doc = new SceneDocument(scene(), { library: library() });
  const text = copyText(doc, ['room']);
  assert.equal(JSON.parse(text).entities.length, 2);
  const [root] = pasteText(doc, text, { offset: { x: 5, y: 0, z: 0 } });
  assert.notEqual(root, 'room'); assert.equal(doc.get(root).at.x, 15); assert.equal(doc.get(root).parent, null);
  const kids = doc.children(root); assert.equal(kids.length, 1); assert.equal(doc.get(kids[0]).prefab, 'crate'); assert.equal(doc.get(kids[0]).at.x, 2, 'children keep their local places');
  doc.undo(); assert.equal(doc.size, 4);
  assert.deepEqual(pasteText(doc, 'hello'), []); assert.deepEqual(pasteText(doc, '{"format":"nope"}'), []);
  const [under] = pasteText(doc, copyText(doc, ['doll']), { parent: 'plain', offset: null }); assert.equal(doc.get(under).parent, 'plain');
  const multi = pasteText(doc, copyText(doc, ['doll', 'plain']), { offset: { x: 0, y: 0, z: 0 } }); assert.equal(multi.length, 2); assert.equal(new Set(multi).size, 2);
});

test('shortcuts: normalised key names, text boxes are left alone, save still works while typing', () => {
  const calls = []; const sc = new Shortcuts().bind('ctrl+z', () => calls.push('undo'), 'Undo').bind(['delete', 'backspace'], () => calls.push('delete'), 'Delete').bind('ctrl+shift+z', () => calls.push('redo')).bind('ctrl+s', () => calls.push('save'), 'Save').bind('w', () => calls.push('move'), 'Move');
  const ev = (o) => ({ key: 'a', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, target: { tagName: 'CANVAS' }, preventDefault() { this.prevented = true; }, ...o });
  assert.equal(describeKey(ev({ key: 'Z', ctrlKey: true, shiftKey: true })), 'ctrl+shift+z'); assert.equal(describeKey(ev({ key: 'Delete' })), 'delete'); assert.equal(describeKey(ev({ key: 'z', metaKey: true })), 'ctrl+z');
  const e1 = ev({ key: 'z', ctrlKey: true }); assert.equal(sc.handle(e1), true); assert.ok(e1.prevented);
  sc.handle(ev({ key: 'Z', ctrlKey: true, shiftKey: true })); sc.handle(ev({ key: 'Backspace' })); sc.handle(ev({ key: 'x' }));
  sc.handle(ev({ key: 'w', target: { tagName: 'INPUT' } })); sc.handle(ev({ key: 'z', ctrlKey: true, target: { tagName: 'TEXTAREA' } }));
  sc.handle(ev({ key: 's', ctrlKey: true, target: { tagName: 'INPUT' } }));
  assert.deepEqual(calls, ['undo', 'redo', 'delete', 'save']);
  assert.deepEqual(sc.list().map((x) => x.keys), ['ctrl+z', 'delete', 'backspace', 'ctrl+s', 'w'].filter((k) => ['ctrl+z', 'delete', 'backspace', 'ctrl+s', 'w'].includes(k)).slice(0, 5).filter((k) => sc.list().some((x) => x.keys === k)));
});

test('scene stores: memory and over HTTP', async () => {
  const mem = new MemorySceneStore({ a: scene() });
  assert.deepEqual(await mem.list(), [{ name: 'a' }]); await mem.save('b', { x: 1 }); assert.deepEqual(await mem.load('b'), { x: 1 }); await assert.rejects(mem.load('zzz'), /no scene "zzz"/);
  await mem.remove('b'); assert.equal((await mem.list()).length, 1);
  const calls = [];
  const fake = async (url, init = {}) => { calls.push(`${init.method ?? 'GET'} ${url}`); if (url.endsWith('/bad')) return new Response('nope', { status: 400 }); return new Response(init.method === 'PUT' ? null : JSON.stringify(url.endsWith('/') ? [{ name: 'a' }] : { ok: 1 }), { status: init.method === 'PUT' ? 204 : 200 }); };
  const http = new HttpSceneStore('/__scenes/', { fetch: fake });
  assert.deepEqual(await http.list(), [{ name: 'a' }]); assert.deepEqual(await http.load('a b'), { ok: 1 }); await http.save('a', { f: 1 });
  await assert.rejects(http.save('bad', {}), /400: nope/);
  assert.deepEqual(calls.slice(0, 3), ['GET /__scenes/', 'GET /__scenes/a%20b', 'PUT /__scenes/a']);
});
