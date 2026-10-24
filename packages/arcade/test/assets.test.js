import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  image, imageSize, drawImage, setAssetHost, isAssetPath, drawThings, cleanSound, newGame, spawn,
} from '../src/index.js';

/** A canvas context that remembers what it was asked to draw. */
const recorder = () => {
  const calls = [];
  const g = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...args) => calls.push([k, ...args])),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { g, calls };
};
const picture = (width, height) => ({ width, height, tag: `${width}x${height}` });

test('paths: only assets/ and one plain file name are accepted', () => {
  for (const ok of ['assets/hero.png', 'assets/my sound.wav', 'assets/a-b_c.1.jpg']) assert.equal(isAssetPath(ok), true, ok);
  for (const bad of ['hero.png', 'assets/../src/main.js', 'assets/a/b.png', '/assets/x.png', 'assets/', 'assets/.x', 'assets/x\\y.png', 5, null, `assets/${'a'.repeat(90)}.png`]) {
    assert.equal(isAssetPath(bad), false, String(bad));
  }
});

test('pictures come from the host, by path, and a missing one is null', () => {
  setAssetHost(new Map([['assets/hero.png', picture(48, 16)]]));
  assert.equal(image('assets/hero.png').tag, '48x16'); assert.deepEqual(imageSize('assets/hero.png'), { w: 48, h: 16 });
  assert.equal(image('assets/none.png'), null); assert.equal(imageSize('assets/none.png'), null);
  setAssetHost(null);
  globalThis.__engineAssets = new Map([['assets/x.png', picture(8, 8)]]);
  assert.equal(image('assets/x.png').tag, '8x8', 'the studio page hands them over through a global');
  delete globalThis.__engineAssets;
  assert.equal(image('assets/x.png'), null);
});

test('drawImage: whole picture, a frame of a strip, mirrored, and a pink and black square when it is missing', () => {
  setAssetHost(new Map([['assets/sheet.png', picture(60, 20)]]));
  let r = recorder();
  drawImage(r.g, 'assets/sheet.png', 10, 20);
  assert.deepEqual(r.calls.find((c) => c[0] === 'drawImage').slice(2), [0, 0, 60, 20, 10, 20, 60, 20]);
  r = recorder(); drawImage(r.g, 'assets/sheet.png', 0, 0, 30, 30, { frames: 3, frame: 2 });
  assert.deepEqual(r.calls.find((c) => c[0] === 'drawImage').slice(2), [40, 0, 20, 20, 0, 0, 30, 30]);
  r = recorder(); drawImage(r.g, 'assets/sheet.png', 0, 0, 30, 30, { frames: 3, frame: 99 });
  assert.equal(r.calls.find((c) => c[0] === 'drawImage')[2], 40, 'a frame past the end shows the last one');
  r = recorder(); drawImage(r.g, 'assets/sheet.png', 5, 0, 30, 30, { flip: true });
  assert.ok(r.calls.some((c) => c[0] === 'scale' && c[1] === -1) && r.calls.some((c) => c[0] === 'translate' && c[1] === 35));
  r = recorder(); drawImage(r.g, 'assets/missing.png', 1, 2, 20, 10);
  assert.equal(r.calls.filter((c) => c[0] === 'fillRect').length, 3); assert.ok(!r.calls.some((c) => c[0] === 'drawImage'));
  setAssetHost(null);
});

test('things with an image are drawn from the file, before sprites, emoji and boxes; the thing holds only the path', () => {
  setAssetHost(new Map([['assets/coin.png', picture(16, 16)]]));
  const game = newGame();
  const coin = spawn(game, 'coin', { x: 4, y: 6, w: 16, h: 16, image: 'assets/coin.png', emoji: 'x' });
  spawn(game, 'box', { x: 50, y: 50 });
  const { g, calls } = recorder();
  drawThings(g, game);
  assert.equal(calls.filter((c) => c[0] === 'drawImage').length, 1); assert.equal(calls.filter((c) => c[0] === 'fillText').length, 0);
  assert.equal(JSON.stringify(coin).includes('"image":"assets/coin.png"'), true); assert.deepEqual(JSON.parse(JSON.stringify(game)), game);
  setAssetHost(null);
});

test('a sound file is a recipe with a path: only a safe assets path with a sound extension is kept', () => {
  assert.deepEqual(cleanSound({ file: 'assets/jump.wav' }), { file: 'assets/jump.wav' });
  assert.deepEqual(cleanSound({ file: 'assets/a.MP3', layers: 'ignored' }), { file: 'assets/a.MP3' });
  for (const bad of ['assets/hero.png', 'src/main.js', 'assets/../x.wav', 'http://example.com/a.wav', 5, '']) assert.equal(cleanSound({ file: bad }), null, String(bad));
});

test('the screen size and background come from the project settings, with the usual 480 by 320 when there are none', async () => {
  const { screen, clear, follow, newGame, spawn } = await import('../src/index.js');
  delete globalThis.__engineSettings;
  assert.deepEqual(screen(), { width: 480, height: 320, background: '#12161f' });
  globalThis.__engineSettings = { width: 800, height: 450, background: '#101820' };
  try {
    assert.deepEqual(screen(), { width: 800, height: 450, background: '#101820' });
    const r = recorder();
    clear(r.g);
    assert.equal(r.g.fillStyle, '#101820'); assert.deepEqual(r.calls.find((c) => c[0] === 'fillRect'), ['fillRect', 0, 0, 800, 450]);
    const r2 = recorder(); clear(r2.g, '#fff', 100, 50); assert.deepEqual(r2.calls.find((c) => c[0] === 'fillRect'), ['fillRect', 0, 0, 100, 50]);
    const game = newGame(); const hero = spawn(game, 'hero', { x: 1000, y: 500, w: 20, h: 20 });
    follow(game, hero, { width: 2000, height: 1000 });
    assert.equal(game.camera.x, 1000 + 10 - 400); assert.equal(game.camera.y, 500 + 10 - 225, 'the camera centres on the hero using the real screen size');
  } finally { delete globalThis.__engineSettings; }
});
