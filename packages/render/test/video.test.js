import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextureSet, Atlas, VideoTexture, VideoSprite, FrameWatcher, fitRect, drawFitted, sourceSize } from '../src/index.js';

const solid = (size, r, g, b) => { const data = new Uint8Array(size * size * 4); for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i); return { width: size, height: size, data }; };

/** A canvas stand-in that records what is drawn into it and hands back flat colour pixels for `getImageData`. */
function fakeCanvas(w, h) {
  const calls = [];
  let fill = '#000';
  const ctx = {
    calls,
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
    fillRect(...a) { calls.push(['fillRect', fill, ...a]); },
    drawImage(src, ...a) { calls.push(['drawImage', src.colour, ...a]); },
    getImageData(x, y, cw, ch) { const c = calls.filter((k) => k[0] === 'drawImage').at(-1)?.[1] ?? [0, 0, 0]; return solid(cw, ...c); },
    save() {}, restore() {}, beginPath() {}, clip() {}, rect() {}, clearRect(...a) { calls.push(['clearRect', ...a]); },
  };
  return { width: w, height: h, getContext: () => ctx, ctx };
}

/** A video stand-in: `colour` is what its picture is; `present()` is a new frame being shown. */
function fakeVideo({ withFrameCallback = true } = {}) {
  const v = { videoWidth: 160, videoHeight: 90, readyState: 4, currentTime: 0, colour: [255, 0, 0], callbacks: [], cancelled: [] };
  if (withFrameCallback) {
    v.requestVideoFrameCallback = (fn) => { v.callbacks.push(fn); return v.callbacks.length; };
    v.cancelVideoFrameCallback = (h) => v.cancelled.push(h);
  }
  v.present = (colour) => { if (colour) v.colour = colour; const cbs = v.callbacks.splice(0); cbs.forEach((fn) => fn()); };
  return v;
}

test('TextureSet.update replaces a layer in place, rebuilds the mips without allocating, and bumps only that layer\'s version', () => {
  const set = new TextureSet({ size: 16, maxLayers: 4 });
  const a = set.add(solid(16, 255, 0, 0)), b = set.add(solid(16, 0, 255, 0));
  const mips = set.layers[a].mips, v0 = set.layers[a].version, setVersion = set.version;
  set.update(a, solid(16, 0, 0, 255));
  assert.equal(set.layers[a].mips, mips, 'same arrays, nothing allocated');
  assert.deepEqual([...set.layers[a].mips[0].slice(0, 4)], [0, 0, 255, 255]);
  assert.deepEqual([...set.layers[a].mips[4]], [0, 0, 255, 255], 'down to the 1 x 1 level');
  assert.equal(set.layers[a].version, v0 + 1); assert.equal(set.layers[b].version, 1); assert.equal(set.version, setVersion);
  set.update(a, solid(8, 10, 20, 30));
  assert.deepEqual([...set.layers[a].mips[0].slice(0, 4)], [10, 20, 30, 255], 'another size is resampled');
});

test('TextureSet.update names its mistakes', () => {
  const set = new TextureSet({ size: 16 });
  set.add(solid(16, 1, 2, 3));
  assert.throws(() => set.update(5, solid(16, 0, 0, 0)), /no layer 5/);
  assert.throws(() => set.update(0, { width: 16, height: 16, data: new Uint8Array(4) }), /expected 1024/);
  assert.throws(() => set.update(0, null), /needs width/);
  const compressed = new TextureSet({ size: 16, format: 'bc1' });
  assert.throws(() => compressed.update(0, solid(16, 0, 0, 0)), /no layer 0|cannot be changed/);
});

test('fitRect: cover crops, contain letterboxes, stretch squeezes', () => {
  assert.deepEqual(fitRect(160, 90, 64, 64, 'cover'), { sx: 35, sy: 0, sw: 90, sh: 90, dx: 0, dy: 0, dw: 64, dh: 64 });
  const c = fitRect(160, 90, 64, 64, 'contain');
  assert.deepEqual([c.sx, c.sy, c.sw, c.sh, c.dx, c.dw, c.dh], [0, 0, 160, 90, 0, 64, 36]); assert.equal(c.dy, 14);
  assert.deepEqual(fitRect(160, 90, 64, 64, 'stretch'), { sx: 0, sy: 0, sw: 160, sh: 90, dx: 0, dy: 0, dw: 64, dh: 64 });
  assert.deepEqual(fitRect(0, 0, 64, 64), { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 64, dh: 64 }, 'a video that has no size yet');
  assert.deepEqual(sourceSize({ videoWidth: 5, videoHeight: 6 }), [5, 6]); assert.deepEqual(sourceSize({ width: 7, height: 8 }), [7, 8]); assert.deepEqual(sourceSize({ displayWidth: 3, displayHeight: 4 }), [3, 4]);
});

test('drawFitted paints the background, then the picture in its place', () => {
  const c = fakeCanvas(64, 64), v = fakeVideo();
  drawFitted(c.ctx, v, 10, 20, 64, 64, 'contain', '#123');
  assert.deepEqual(c.ctx.calls[0], ['fillRect', '#123', 10, 20, 64, 64]);
  assert.deepEqual(c.ctx.calls[1].slice(2), [0, 0, 160, 90, 10, 34, 64, 36]);
  c.ctx.calls.length = 0; drawFitted(c.ctx, { videoWidth: 0, videoHeight: 0 }, 0, 0, 64, 64);
  assert.equal(c.ctx.calls.length, 1, 'a video with no picture yet only gets the background');
});

test('FrameWatcher: a video that reports its frames is asked; one that does not is judged by its clock; a canvas is always new', () => {
  const v = fakeVideo(), w = new FrameWatcher(v);
  assert.equal(w.poll(), true, 'the first picture'); assert.equal(w.poll(), false, 'nothing new');
  v.present(); assert.equal(w.poll(), true); assert.equal(w.poll(), false);
  v.readyState = 1; v.present(); assert.equal(w.poll(), false, 'no data for the current frame yet');
  w.destroy(); assert.deepEqual(v.cancelled.length, 1);
  const old = fakeVideo({ withFrameCallback: false }), w2 = new FrameWatcher(old);
  assert.equal(w2.poll(), true); assert.equal(w2.poll(), false); old.currentTime = 0.04; assert.equal(w2.poll(), true); assert.equal(w2.poll(), false);
  assert.equal(new FrameWatcher({ width: 4, height: 4 }).poll(), true);
  w.destroy();
});

test('VideoTexture adds a black layer, then copies each new frame into it and nothing else', () => {
  const set = new TextureSet({ size: 16, maxLayers: 4 });
  set.add(solid(16, 9, 9, 9));
  const v = fakeVideo(), vt = new VideoTexture(set, v, { name: 'tv', fit: 'stretch', createCanvas: fakeCanvas });
  assert.equal(vt.layer, 1); assert.equal(set.find('tv'), 1);
  assert.deepEqual([...set.layers[1].mips[0].slice(0, 4)], [0, 0, 0, 255], 'black until the first frame');
  assert.equal(vt.update(), true);
  assert.deepEqual([...set.layers[1].mips[0].slice(0, 4)], [255, 0, 0, 255]);
  const version = set.layers[1].version;
  assert.equal(vt.update(), false); assert.equal(set.layers[1].version, version, 'no new frame: no work, nothing to upload');
  v.present([0, 0, 255]); assert.equal(vt.update(), true);
  assert.deepEqual([...set.layers[1].mips[0].slice(0, 4)], [0, 0, 255, 255]); assert.equal(set.layers[1].version, version + 1); assert.equal(vt.frames, 2);
  assert.deepEqual([...set.layers[0].mips[0].slice(0, 4)], [9, 9, 9, 255], 'other layers untouched');
  vt.destroy();
});

test('VideoSprite draws into its atlas rectangle and marks the page changed, only for new frames', () => {
  const pages = [];
  const atlas = new Atlas({ size: 128, createCanvas: (w, h) => { const c = fakeCanvas(w, h); pages.push(c); return c; } });
  const v = fakeVideo(), vs = new VideoSprite(atlas, v, { name: 'tv', width: 64, height: 36, fit: 'cover' });
  const sprite = atlas.get('tv'), pageVersion = atlas.pages[0].version;
  assert.equal(vs.sprite, sprite); assert.deepEqual([sprite.w, sprite.h], [64, 36]);
  assert.equal(vs.update(), true);
  assert.equal(atlas.pages[0].version, pageVersion + 1);
  const calls = pages[0].ctx.calls;
  assert.ok(calls.some((c) => c[0] === 'clearRect' && c[1] === sprite.x && c[2] === sprite.y), 'the old picture is cleared first');
  assert.ok(calls.some((c) => c[0] === 'drawImage' && c[8] === 64 && c[9] === 36), 'the picture is drawn at the sprite size');
  assert.equal(vs.update(), false); assert.equal(atlas.pages[0].version, pageVersion + 1);
  assert.throws(() => new VideoSprite(atlas, v, { name: '', width: 4, height: 4 }), /needs a name/);
  assert.throws(() => atlas.redraw('nope', () => {}), /no sprite "nope"/);
});
