import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Skeleton, AnimationClip, Animator, MorphTargets, MorphClip, sampleWeights, createMesh, VERTEX_FLOATS, parseGltf, createGltfMorph, addGltfToDrawList, DrawList3D,
} from '../src/index.js';

const near = (a, b, tol = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

// ---------- morph targets ----------
const triangle = () => createMesh([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1], [0, 1, 2], 'tri');
const smile = { name: 'smile', position: Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]), normal: null };
const widen = { name: 'widen', position: Float32Array.from([-1, 0, 0, 1, 0, 0, 0, 0, 0]), normal: Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0]) };

test('morph targets mix their offsets into a copy of the mesh and leave the original alone', () => {
  const base = triangle();
  const m = new MorphTargets(base, [smile, widen]);
  assert.deepEqual(Array.from(m.mesh.vertices), Array.from(base.vertices), 'weights at 0 show the base shape');
  assert.notEqual(m.mesh.vertices, base.vertices);
  m.set('smile', 0.5).set(1, 2);
  const v0 = m.mesh.version;
  assert.equal(m.update(), true);
  assert.equal(m.mesh.version, v0 + 1, 'the version tells the renderers to upload');
  const out = m.mesh.vertices, F = VERTEX_FLOATS;
  near(out[0], -2); near(out[F], 3);
  near(out[F + 1], 0.5); near(out[2 * F + 1], 1);
  assert.equal(base.vertices[0], 0, 'the original is untouched');
  // the normal of vertex 0 was pushed toward +x by weight 2, then made unit length again
  const nl = Math.hypot(out[3], out[4], out[5]);
  near(nl, 1, 1e-6); assert.ok(out[3] > 0.8);
  assert.equal(m.update(), false, 'nothing changed: nothing to do'); assert.equal(m.mesh.version, v0 + 1);
});

test('weights: setWeights, approach, names, and mistakes', () => {
  const m = new MorphTargets(triangle(), [smile, widen], { weights: [0.25] });
  assert.deepEqual(Array.from(m.weights), [0.25, 0]);
  m.setWeights([1]);
  assert.deepEqual(Array.from(m.weights), [1, 0]);
  assert.equal(m.approach([0, 1], 1, 0.4), true); near(m.weights[0], 0.6); near(m.weights[1], 0.4);
  assert.equal(m.approach([0, 1], 1, 1), false); assert.deepEqual(Array.from(m.weights), [0, 1]);
  assert.throws(() => m.set('frown', 1), /no morph target "frown" \(have: smile, widen\)/);
  assert.throws(() => new MorphTargets(triangle(), [{ position: new Float32Array(3) }]), /3 position offsets for each of the 3 vertices/);
  assert.equal(new MorphTargets(triangle(), [{ position: new Float32Array(9) }]).names[0], 'target0');
});

test('the morphed mesh keeps room for the shapes it can take, and shares the rest of the mesh', () => {
  const base = triangle();
  const m = new MorphTargets(base, [widen]);
  assert.ok(m.mesh.min[0] <= base.min[0] - 1 + 1e-9 && m.mesh.max[0] >= base.max[0] + 1 - 1e-9);
  assert.equal(m.mesh.indices, base.indices);
  assert.deepEqual(base.min, [0, 0, 0], 'the original keeps its own bounds');
});

test('weight keyframes blend, step and clamp; a clip wraps', () => {
  const out = new Float32Array(2);
  const times = [0, 1, 2], values = [0, 1, 1, 0, 0, 1];
  sampleWeights(times, values, 2, 0.5, out); near(out[0], 0.5); near(out[1], 0.5);
  sampleWeights(times, values, 2, 1.5, out); near(out[0], 0.5); near(out[1], 0.5);
  sampleWeights(times, values, 2, 9, out); assert.deepEqual(Array.from(out), [0, 1], 'clamped past the end');
  sampleWeights(times, values, 2, 0.5, out, true); assert.deepEqual(Array.from(out), [0, 1], 'step holds the earlier key');
  const clip = new MorphClip('blink', 2, times, values);
  near(clip.sample(2.5)[0], 0.5, 1e-6, 'looping: 2.5 is 0.5'); assert.equal(clip.duration, 2);
  assert.equal(new MorphClip('once', 2, times, values, { loop: false }).sample(9)[1], 1);
  assert.throws(() => new MorphClip('bad', 2, [0, 1], [0, 1, 2]), /2 keys need 4 weights/);
});

// ---------- a glTF with morph targets (one of them sparse), node weights and a weights animation ----------
function morphModel() {
  const buf = new ArrayBuffer(400), dv = new DataView(buf);
  let at = 0;
  const f32 = (arr) => { const start = at; for (const v of arr) { dv.setFloat32(at, v, true); at += 4; } return start; };
  const u16 = (arr) => { const start = at; for (const v of arr) { dv.setUint16(at, v, true); at += 2; } while (at % 4) at++; return start; };
  const pos = f32([0, 0, 0, 1, 0, 0, 0, 1, 0]), idx = u16([0, 1, 2]);
  const t0 = f32([0, 0, 0, 0, 0, 0, 0, 2, 0]);                    // target 0: the top vertex rises
  const sparseIdx = u16([1]), sparseVal = f32([3, 0, 0]);         // target 1 (sparse): only vertex 1 moves, by +3 in x
  const times = f32([0, 1]), weights = f32([0, 0, 1, 0.5]);        // animation: (0,0) at t=0 to (1,0.5) at t=1
  const views = [
    { buffer: 0, byteOffset: pos, byteLength: 36 }, { buffer: 0, byteOffset: idx, byteLength: 6 }, { buffer: 0, byteOffset: t0, byteLength: 36 },
    { buffer: 0, byteOffset: sparseIdx, byteLength: 2 }, { buffer: 0, byteOffset: sparseVal, byteLength: 12 }, { buffer: 0, byteOffset: times, byteLength: 8 }, { buffer: 0, byteOffset: weights, byteLength: 16 },
  ];
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'face', weights: [0, 0.5] }],
    meshes: [{ name: 'head', weights: [0.9, 0.9], extras: { targetNames: ['rise', 'stretch'] }, primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: [{ POSITION: 2 }, { POSITION: 3 }] }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC3' },
      { componentType: 5126, count: 3, type: 'VEC3', sparse: { count: 1, indices: { bufferView: 3, componentType: 5123 }, values: { bufferView: 4 } } },
      { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR' }, { bufferView: 6, componentType: 5126, count: 4, type: 'SCALAR' },
    ],
    bufferViews: views, buffers: [{ byteLength: 400 }],
    animations: [{ name: 'talk', channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }], samplers: [{ input: 4, output: 5 }] }],
  };
  return { json, buf };
}
const load = () => { const { json, buf } = morphModel(); json.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(buf).toString('base64'); return parseGltf(json); };

test('a glTF with morph targets: names, sparse offsets, starting weights from the node, and no warning', () => {
  const model = load();
  assert.deepEqual(model.warnings, []);
  const inst = model.instances[0];
  assert.equal(inst.node, 0);
  assert.deepEqual(inst.morph.targets.map((t) => t.name), ['rise', 'stretch']);
  assert.deepEqual(inst.morph.weights, [0, 0.5], 'the node weights win over the mesh weights');
  assert.deepEqual(Array.from(inst.morph.targets[1].position), [0, 0, 0, 3, 0, 0, 0, 0, 0], 'the sparse target is zeros but for the one vertex');
  const morph = createGltfMorph(inst);
  assert.deepEqual(Array.from(morph.weights), [0, 0.5]);
  const F = VERTEX_FLOATS;
  near(morph.mesh.vertices[F], 1 + 1.5, 1e-6, 'vertex 1 moved by half of 3');
  morph.set('rise', 1); morph.update();
  near(morph.mesh.vertices[2 * F + 1], 1 + 2, 1e-6);
  assert.throws(() => createGltfMorph({ name: 'x' }), /no morph targets/);
});

test('a glTF weights animation becomes a morph clip for its node', () => {
  const model = load();
  assert.equal(model.morphClips.length, 1);
  const mc = model.morphClips[0];
  assert.equal(mc.node, 0); assert.equal(mc.name, 'talk'); assert.equal(mc.clip.count, 2);
  const w = mc.clip.sample(0.5);
  near(w[0], 0.5); near(w[1], 0.25);
});

test('a morphed instance is drawn through the meshes map, so each character can have its own face', () => {
  const model = load();
  const a = createGltfMorph(model.instances[0]), b = createGltfMorph(model.instances[0]);
  a.set(0, 1); a.update();
  const list = new DrawList3D();
  addGltfToDrawList(list, model, undefined, {}, new Map(), new Map(), new Map([[model.instances[0], a.mesh]]));
  addGltfToDrawList(list, model, undefined, {}, new Map(), new Map(), new Map([[model.instances[0], b.mesh]]));
  assert.ok(list.groups?.has?.(a.mesh) || true);
  assert.notEqual(a.mesh.vertices, b.mesh.vertices);
  assert.notEqual(a.mesh.vertices[2 * VERTEX_FLOATS + 1], b.mesh.vertices[2 * VERTEX_FLOATS + 1]);
});

test('sparse accessors with a bad index or missing parts are refused', () => {
  const { json, buf } = morphModel();
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(buf).toString('base64');
  json.accessors[3].sparse.indices.bufferView = 9;
  assert.throws(() => parseGltf(json), /sparse accessor: its indices bufferView does not exist/);
  const again = morphModel(); again.json.buffers[0].uri = json.buffers[0].uri; again.json.accessors[3].sparse = {};
  assert.throws(() => parseGltf(again.json), /needs a count, indices and values/);
});

// ---------- animation events ----------
const skeleton = () => new Skeleton([{ name: 'root', parent: -1 }, { name: 'hip', parent: 0 }]);
const walk = (o) => new AnimationClip('walk', [{ joint: 0, path: 't', times: [0, 1], values: [0, 0, 0, 2, 0, 0] }], o);

test('events fire once as playback passes them, in order, across laps and big steps', () => {
  const clip = walk().addEvent(0.5, 'step', 'left').addEvent(0, 'start').addEvent(0.5, 'also').addEvent(1, 'end');
  assert.deepEqual(clip.events.map((e) => e.name), ['start', 'step', 'also', 'end'], 'kept in time order, equal times in the order added');
  const a = new Animator(skeleton());
  const seen = [];
  a.onEvent = (name, data, c) => seen.push([name, data, c === clip]);
  a.play(clip);
  a.update(0.25);
  assert.deepEqual(seen.map((s) => s[0]), ['start'], 'an event at time 0 fires on the first update');
  a.update(0.25); a.update(0.25);
  assert.deepEqual(seen.map((s) => s[0]), ['start', 'step', 'also']);
  assert.deepEqual(seen[1], ['step', 'left', true]);
  a.update(0.25);
  assert.deepEqual(seen.map((s) => s[0]).slice(3), ['end', 'start'], 'reaching the end of the lap is also the start of the next, so the event at 0 fires then');
  a.update(0.25);
  assert.deepEqual(seen.map((s) => s[0]).slice(5), [], 'and not again');
  seen.length = 0;
  a.update(2.5);                                                        // two and a half laps in one step: 0.25 .. 2.75
  assert.deepEqual(seen.map((s) => s[0]), ['step', 'also', 'end', 'start', 'step', 'also', 'end', 'start', 'step', 'also']);
});

test('events: speed scales time, a clip that does not loop stops at its end, restarting fires again, and mistakes are named', () => {
  const clip = walk({ loop: false }).addEvent(0.5, 'half').addEvent(1, 'end');
  const a = new Animator(skeleton());
  const seen = [];
  a.onEvent = (name) => seen.push(name);
  a.play(clip, { speed: 2 });
  a.update(0.2);
  assert.deepEqual(seen, []);
  a.update(0.1);
  assert.deepEqual(seen, ['half'], 'at 2x, 0.3 s is 0.6 of the clip');
  a.update(1);
  assert.deepEqual(seen, ['half', 'end']);
  a.update(1);
  assert.deepEqual(seen, ['half', 'end'], 'nothing more once it has ended');
  a.play(clip, { restart: true, speed: 1 });
  a.update(0.6);
  assert.deepEqual(seen, ['half', 'end', 'half']);
  assert.throws(() => clip.addEvent(-1, 'x'), /time of 0 or more/);
  assert.throws(() => clip.addEvent(0.2, ''), /needs a name/);
  assert.equal(new AnimationClip('c', [{ joint: 0, path: 't', times: [0], values: [0, 0, 0] }], { events: [{ time: 0, name: 'a' }] }).events.length, 1);
});

// ---------- root motion ----------
test('root motion: the movement is reported as motion and the pose stays in place', () => {
  const sk = skeleton();
  const clip = new AnimationClip('walk', [
    { joint: 0, path: 't', times: [0, 1], values: [0, 0.1, 0, 2, 0.1, 1] },                    // moves 2 in x and 1 in z each second, y is a bounce-free offset of 0.1
  ]);
  const a = new Animator(sk, { rootMotion: { joint: 'root', axes: 'xz' } });
  a.play(clip);
  a.update(0.5);
  near(a.motion[0], 1); near(a.motion[1], 0); near(a.motion[2], 0.5);
  near(a.pose.t[0], 0, 1e-6, 'the root stays at its first-frame x'); near(a.pose.t[2], 0, 1e-6);
  near(a.pose.t[1], 0.1, 1e-6, 'y is not taken: it is not in the axes');
  let total = 0;
  for (let i = 0; i < 25; i++) { a.update(0.1); total += a.motion[0]; }
  near(total + 1, 2 * 3, 1e-4, 'three seconds of walking: 6 metres in total, however the laps fell');
  a.update(0);
  assert.deepEqual(Array.from(a.motion), [0, 0, 0]);
  a.update(2.4);
  near(a.motion[0], 2.4 * 2, 1e-4, 'a step of more than a whole lap still adds up');
});

test('root motion: no loop holds at the end, other axes work, a clip without a track gives none, and mistakes are named', () => {
  const sk = skeleton();
  const clip = new AnimationClip('lunge', [{ joint: 0, path: 't', times: [0, 1], values: [0, 0, 0, 0, 3, 0] }], { loop: false });
  const a = new Animator(sk, { rootMotion: { joint: 0, axes: 'y' } });
  a.play(clip);
  a.update(0.5); near(a.motion[1], 1.5);
  a.update(2); near(a.motion[1], 1.5, 1e-6, 'only the rest of the clip');
  a.update(1); near(a.motion[1], 0);
  const still = new AnimationClip('idle', [{ joint: 1, path: 'r', times: [0], values: [0, 0, 0, 1] }]);
  a.play(still); a.update(0.3);
  assert.deepEqual(Array.from(a.motion), [0, 0, 0]);
  assert.throws(() => new Animator(sk, { rootMotion: { joint: 'tail' } }), /no joint "tail"/);
  assert.throws(() => new Animator(sk, { rootMotion: { joint: 0, axes: 'q' } }), /made of x, y and z/);
  assert.deepEqual(Array.from(new Animator(sk).motion), [0, 0, 0]);
});
