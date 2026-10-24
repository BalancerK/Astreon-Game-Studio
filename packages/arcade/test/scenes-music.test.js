import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawImage, setAssetHost, drawThings, newGame, loadScene, music, playMusic, stopMusic, cleanSong, setSoundSink, all,
} from '../src/index.js';

const recorder = () => {
  const calls = [];
  const g = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...args) => calls.push([k, ...args])),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  return { g, calls };
};
const picture = (width, height) => ({ width, height });
const drawn = (r) => r.calls.find((c) => c[0] === 'drawImage').slice(2);

test('a sheet of frames: cols and rows pick a cell, counting along the first row and then the next', () => {
  setAssetHost(new Map([['assets/sheet.png', picture(120, 80)]]));          // 4 columns, 2 rows of 30 x 40
  const at = (frame, extra = {}) => { const r = recorder(); drawImage(r.g, 'assets/sheet.png', 5, 6, undefined, undefined, { cols: 4, rows: 2, frame, ...extra }); return drawn(r); };
  assert.deepEqual(at(0), [0, 0, 30, 40, 5, 6, 30, 40]);
  assert.deepEqual(at(3), [90, 0, 30, 40, 5, 6, 30, 40]);
  assert.deepEqual(at(4), [0, 40, 30, 40, 5, 6, 30, 40], 'the next row');
  assert.deepEqual(at(7), [90, 40, 30, 40, 5, 6, 30, 40]);
  assert.deepEqual(at(99), [90, 40, 30, 40, 5, 6, 30, 40], 'past the end stays on the last cell');
  assert.deepEqual(at(-3), [0, 0, 30, 40, 5, 6, 30, 40]);
  const flipped = recorder();
  drawImage(flipped.g, 'assets/sheet.png', 0, 0, 60, 80, { cols: 4, rows: 2, frame: 5, flip: true });
  assert.deepEqual(drawn(flipped), [30, 40, 30, 40, 0, 0, 60, 80]);
  // strips and whole pictures behave as before
  const strip = recorder();
  drawImage(strip.g, 'assets/sheet.png', 0, 0, undefined, undefined, { frames: 4, frame: 2 });
  assert.deepEqual(drawn(strip), [60, 0, 30, 80, 0, 0, 30, 80]);
  const whole = recorder();
  drawImage(whole.g, 'assets/sheet.png', 1, 2);
  assert.deepEqual(drawn(whole), [0, 0, 120, 80, 1, 2, 120, 80]);
  setAssetHost(null);
});

test('things with cols and rows draw from a sheet', () => {
  setAssetHost(new Map([['assets/s.png', picture(64, 64)]]));
  const game = newGame();
  game.things.push({ id: 1, kind: 'a', x: 0, y: 0, w: 16, h: 16, image: 'assets/s.png', cols: 2, rows: 2, frame: 3 });
  const r = recorder();
  drawThings(r.g, game);
  assert.deepEqual(drawn(r), [32, 32, 32, 32, 0, 0, 16, 16]);
  setAssetHost(null);
});

test('loadScene spawns every thing where it was placed, with its extra fields, and says how big the scene is', () => {
  const game = newGame();
  const scene = {
    w: 640, h: 360,
    things: [
      { kind: 'hero', x: 10, y: 20, w: 24, h: 32, color: '#5ac8ff' },
      { kind: 'coin', x: 100, y: 50, w: 16, h: 16, image: 'assets/coin.png', extra: { value: 5, vx: 20 } },
    ],
  };
  const made = loadScene(game, scene);
  assert.deepEqual([made.width, made.height, made.things.length], [640, 360, 2]);
  assert.deepEqual(all(game, 'hero').map((t) => [t.x, t.y, t.w, t.h, t.color]), [[10, 20, 24, 32, '#5ac8ff']]);
  const coin = all(game, 'coin')[0];
  assert.deepEqual([coin.value, coin.vx, coin.image, coin.extra], [5, 20, 'assets/coin.png', undefined], 'extra fields become fields of the thing');
  assert.deepEqual(loadScene(newGame(), { things: [] }), { width: 480, height: 320, things: [] });
  assert.throws(() => loadScene(newGame(), null), /Scene panel/);
  assert.throws(() => loadScene(newGame(), { things: [{ x: 1 }] }), /Thing 1 of the scene has no kind/);
});

const SONG = { bpm: 120, tracks: [{ wave: 'triangle', gain: 0.4, decay: 1, notes: [['A3', 2], [null, 1], ['C#4', 1]] }, { notes: [['E4', 4]] }] };

test('a song is cleaned before the page that plays it believes it', () => {
  const clean = cleanSong(SONG);
  assert.equal(clean.bpm, 120);
  assert.deepEqual(clean.tracks[0], { wave: 'triangle', gain: 0.4, decay: 1, notes: [['A3', 2], [null, 1], ['C#4', 1]] });
  assert.deepEqual(clean.tracks[1], { wave: 'square', gain: 0.3, notes: [['E4', 4]] }, 'a plain track gets a plain voice');
  for (const bad of [null, {}, { tracks: [] }, { bpm: 20, tracks: SONG.tracks }, { bpm: 500, tracks: SONG.tracks }, { tracks: [{ notes: [['H9', 1]] }] },
    { tracks: [{ notes: [['A4', 0]] }] }, { tracks: [{ notes: [['A4', 99]] }] }, { tracks: [{ notes: [['A4', 1, 2, 3]] }] }, { tracks: [{ notes: 'A4' }] },
    { tracks: Array.from({ length: 9 }, () => ({ notes: [['A4', 1]] })) }, { tracks: [{ notes: Array.from({ length: 601 }, () => ['A4', 0.25]) }] },
    { bpm: 40, tracks: [{ notes: Array.from({ length: 20 }, () => ['A4', 16]) }] }]) {
    assert.equal(cleanSong(bad), null, JSON.stringify(bad)?.slice(0, 60));
  }
  assert.equal(cleanSong({ tracks: [{ wave: 'evil', gain: 9, decay: 99, lowpass: 5, notes: [['A4', 1]] }] }).tracks[0].wave, 'square');
  const t = cleanSong({ tracks: [{ gain: 9, decay: 99, lowpass: 5, notes: [['A4', 1]] }] }).tracks[0];
  assert.deepEqual([t.gain, t.decay, t.lowpass], [1, 8, 100]);
});

test('playMusic and stopMusic send the song to the page, by name, and a wrong name explains itself', () => {
  const sent = [];
  setSoundSink((m) => sent.push(m));
  music({ calm: SONG });
  playMusic('calm');
  playMusic('calm', { volume: 2, loop: false });
  stopMusic();
  assert.deepEqual(sent.map((m) => [m.t, m.action, m.name, m.volume, m.loop]), [['music', 'play', 'calm', 0.6, true], ['music', 'play', 'calm', 1, false], ['music', 'stop', undefined, undefined, undefined]]);
  assert.equal(sent[0].spec, SONG);
  assert.throws(() => playMusic('nope'), /no song called "nope" \(the songs are: calm\)/);
  music({});
  assert.throws(() => playMusic('x'), /Give your songs names with music/);
  setSoundSink((message) => { globalThis.postMessage?.(message); });
});

test('timed runs the function and returns its result, and reports its time only when a profiler is listening', async () => {
  const { timed } = await import('../src/index.js');
  assert.equal(timed('quiet', () => 42), 42, 'with nothing listening it just runs');
  const marks = [];
  globalThis.__engineProfile = { mark: (name, ms) => marks.push([name, ms]) };
  try {
    assert.equal(timed('work', () => { let n = 0; for (let i = 0; i < 1000; i++) n += i; return n; }), 499500);
    assert.deepEqual(marks.map((m) => m[0]), ['work']);
    assert.ok(marks[0][1] >= 0);
    assert.throws(() => timed('boom', () => { throw new Error('x'); }), /x/);
    assert.deepEqual(marks.map((m) => m[0]), ['work', 'boom'], 'the time is reported even when the function throws');
  } finally { delete globalThis.__engineProfile; }
});
