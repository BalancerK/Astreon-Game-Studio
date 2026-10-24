import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newLights, STARTERS, LIGHT_SORTS, addLight, removeLight, duplicateLight, setLight, setScreen, serializeLights, parseLights, lightProblems,
    followed, freeName,
} from '../app/paint/lights-model.js';

test('every starter is a set the kit accepts, and writes out and reads back the same', () => {
  for (const make of Object.values(STARTERS)) {
    const file = make();
    assert.deepEqual(lightProblems(file), []);
    assert.deepEqual(parseLights(serializeLights(file)), file);
  }
  assert.ok(newLights().lights.length >= 1);
});

test('every sort of light can be added, with a free name', () => {
  let file = newLights();
  for (const sort of Object.keys(LIGHT_SORTS)) {
    const r = addLight(file, sort);
    assert.equal(r.file.lights[r.index].name, sort);
    file = r.file;
  }
  assert.equal(addLight(file, 'torch').file.lights.at(-1).name, 'torch 2');
  assert.deepEqual(lightProblems(file), []);
  assert.throws(() => addLight(file, 'laser'), /no sort/);
  assert.equal(freeName([{ name: 'a' }, { name: 'a 2' }], 'a'), 'a 3');
});

test('there is a limit to how many lights', () => {
  let file = newLights();
  for (let i = file.lights.length; i < 24; i++) file = addLight(file, 'lamp').file;
  assert.throws(() => addLight(file, 'lamp'), /up to 24/);
  assert.throws(() => duplicateLight(file, 0), /up to 24/);
});

test('lights can be copied and removed without changing the original', () => {
  const file = newLights();
  const copy = duplicateLight(file, 0);
  assert.equal(copy.file.lights[1].name, 'hero glow 2');
  assert.equal(file.lights.length, 2);
  assert.equal(removeLight(file, 0).lights.length, 1);
});

test('changes are held to what draws well', () => {
  const file = newLights();
  const l = setLight(file, 0, { radius: 99999, intensity: 7, flicker: -1, color: '#ABCDEF', dx: 99999, seed: 5.9 }).lights[0];
  assert.equal(l.radius, 1200);
  assert.equal(l.intensity, 1);
  assert.equal(l.flicker, 0);
  assert.equal(l.color, '#abcdef');
  assert.equal(l.dx, 5000);
  assert.equal(l.seed, 5);
  assert.throws(() => setLight(file, 0, { color: 'blue' }), /#ffd27a/);
  assert.throws(() => setLight(file, 0, { name: 'torches' }), /already/);
  assert.throws(() => setLight(file, 0, { name: '??' }), /1 to 32/);
  assert.throws(() => setLight(file, 0, { follow: 'a b' }), /name/);
  assert.throws(() => setLight(file, 0, { wiggle: 1 }), /not something/);
});

test('a light that stops following gets a place, and one that follows loses it only in meaning', () => {
  const file = newLights();
  const fixed = setLight(file, 0, { follow: '' }).lights[0];
  assert.equal(fixed.follow, undefined);
  assert.equal(typeof fixed.x, 'number');
  assert.equal(setLight({ ...file, lights: [fixed] }, 0, { follow: 'torch' }).lights[0].follow, 'torch');
  assert.deepEqual(followed(file).sort(), ['hero', 'torch']);
});

test('the screen settings are numbers from 0 to 1 and colours', () => {
  const file = setScreen(newLights(), { darkness: 4, vignette: -2, tintAlpha: 0.3, tint: '#FF9A4A', ambient: '#000000' });
  assert.deepEqual([file.screen.darkness, file.screen.vignette, file.screen.tintAlpha, file.screen.tint], [1, 0, 0.3, '#ff9a4a']);
  assert.equal(setScreen(file, { tint: '' }).screen.tint, '');
  assert.throws(() => setScreen(file, { tint: 'orange' }), /#0a0e24/);
  assert.throws(() => setScreen(file, { glow: 1 }), /not a screen setting/);
});

test('a hand-edited file is read kindly, and a broken one is explained', () => {
  const text = 'export default { "screen": { "darkness": 9, "ambient": "red" }, "lights": [ { "name": "a", "radius": 20 }, { "name": "a", "radius": 30 }, { "radius": 0 }, 7 ] };';
  const file = parseLights(text);
  assert.deepEqual(file.lights.map((l) => l.name), ['a', 'a 2'], 'lights without a radius are dropped and a repeated name is made different');
  assert.equal(file.screen.darkness, 1);
  assert.equal(file.screen.ambient, '#0a0e24', 'a colour that is not one falls back');
  assert.throws(() => parseLights('nothing'), /not a set of lights/);
  assert.throws(() => parseLights('export default { nope };'), /plain JSON/);
  assert.throws(() => parseLights('export default { "screen": {} };'), /list of "lights"/);
});
