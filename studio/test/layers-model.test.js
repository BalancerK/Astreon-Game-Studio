import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newLayers, STARTERS, addLayer, removeLayer, moveLayer, duplicateLayer, setLayer, setCamera, serializeLayers, parseLayers, layerProblems, missingSprites, freeName,
} from '../app/paint/layers-model.js';

test('every starter is a set the kit accepts, and writes out and reads back the same', () => {
  for (const make of Object.values(STARTERS)) {
    const file = make();
    assert.deepEqual(layerProblems(file), []);
    assert.deepEqual(parseLayers(serializeLayers(file)), file);
  }
  assert.ok(newLayers().layers.length >= 2);
});

test('adding a layer gives it a free name and a start that looks like its kind', () => {
  let file = newLayers();
  let r = addLayer(file, 'hills');
  assert.equal(r.file.layers[r.index].name, 'hills');
  r = addLayer(r.file, 'hills');
  assert.equal(r.file.layers[r.index].name, 'hills 2');
  assert.throws(() => addLayer(file, 'lava'), /no kind/);
  for (let i = 0; i < 12; i++) { try { file = addLayer(file, 'stars').file; } catch { break; } }
  assert.throws(() => addLayer(file, 'stars'), /up to 12/);
  assert.equal(freeName([{ name: 'a' }], 'a'), 'a 2');
});

test('layers can be moved, copied and removed without changing the original', () => {
  const file = newLayers();
  const names = file.layers.map((l) => l.name);
  const moved = moveLayer(file, 0, 2);
  assert.deepEqual(moved.file.layers.map((l) => l.name), [names[1], names[2], names[0], names[3]]);
  assert.equal(moved.index, 2);
  assert.deepEqual(file.layers.map((l) => l.name), names, 'the original is untouched');
  const copy = duplicateLayer(file, 1);
  assert.equal(copy.file.layers[2].name, `${names[1]} 2`);
  assert.equal(removeLayer(file, 0).layers.length, names.length - 1);
});

test('changes are held to what draws well', () => {
  const file = newLayers();
  const a = setLayer(file, 1, { alpha: 7, size: 100000, parallax: [9, -9], color: '#ABCDEF', front: 1, seed: 12.7 });
  const l = a.layers[1];
  assert.equal(l.alpha, 1);
  assert.equal(l.size, 4000);
  assert.deepEqual(l.parallax, [4, -4]);
  assert.equal(l.color, '#abcdef');
  assert.equal(l.front, true);
  assert.equal(l.seed, 12);
  assert.throws(() => setLayer(file, 1, { color: 'red' }), /#5ac8ff/);
  assert.throws(() => setLayer(file, 1, { name: file.layers[0].name }), /already/);
  assert.throws(() => setLayer(file, 1, { name: '!!' }), /1 to 32/);
  assert.throws(() => setLayer(file, 1, { wiggle: 1 }), /not something/);
  assert.equal(setLayer(file, 1, { name: 'puffs' }).layers[1].name, 'puffs');
});

test('the camera settings are numbers from zero up', () => {
  const file = setCamera(newLayers(), { smooth: -3, lookAhead: 5000, deadZone: 12 });
  assert.deepEqual(file.camera, { smooth: 0, lookAhead: 400, deadZone: 12 });
  assert.throws(() => setCamera(newLayers(), { zoom: 2 }), /not a camera setting/);
});

test('a file that has been edited by hand is read kindly, and one that is broken is explained', () => {
  const text = 'export default { "camera": { "smooth": -1, "lookAhead": 20 }, "layers": [ { "name": "a", "kind": "hills" }, { "name": "a", "kind": "stars" }, { "kind": "lava" }, 5 ] };';
  const file = parseLayers(text);
  assert.deepEqual(file.layers.map((l) => l.name), ['a', 'a 2'], 'unknown kinds are dropped and a repeated name is made different');
  assert.equal(file.camera.smooth, 0.15, 'a bad number falls back to the default');
  assert.equal(file.camera.lookAhead, 20);
  assert.throws(() => parseLayers('nothing here'), /not a set of layers/);
  assert.throws(() => parseLayers('export default { oops };'), /plain JSON/);
  assert.throws(() => parseLayers('export default { "camera": {} };'), /list of "layers"/);
});

test('sprites the layers use that the project does not have are named', () => {
  const file = { camera: {}, layers: [{ name: 'a', kind: 'sprite', sprite: 'tree' }, { name: 'b', kind: 'sprite', sprite: 'hut' }] };
  assert.deepEqual(missingSprites(file, ['hut']), ['tree']);
});
