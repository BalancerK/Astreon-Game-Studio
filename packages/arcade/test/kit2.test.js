import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, spawn, all, first, clearThings, patrol, solidAt, moveAndCollide, gravity, loadMap, drawThings,
  spriteProblem, frameCanvas, drawSprite, animate, setCanvasFactory,
  sounds, play, cleanSound, setSoundSink, burst, shake, effects, shakeOffset, loadProgress, saveProgress, setProgressHost,
} from '../src/index.js';

/** A canvas that only remembers what was drawn on it. */
function fakeCanvas(w, h) {
  const log = [];
  return { w, h, log, getContext: () => ({ set fillStyle(v) { log.push(['color', v]); }, fillRect: (...a) => log.push(['px', ...a]) }) };
}
const recorder = () => {
  const calls = [];
  const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([String(k), ...a])), set: (o, k, v) => { o[k] = v; calls.push(['set', String(k), v]); return true; } });
  return { g, calls };
};

const hero = { w: 3, h: 2, palette: { a: '#f00', b: '#00f' }, frames: [['a.b', 'aab'], ['bbb', '...']], animations: { run: { frames: [0, 1], fps: 4 } } };

test('sprites are checked, and a frame is turned into a small canvas once', () => {
  assert.equal(spriteProblem(hero), null);
  assert.match(spriteProblem(null), /object/); assert.match(spriteProblem({ ...hero, w: 0 }), /whole numbers/); assert.match(spriteProblem({ ...hero, frames: [] }), /at least one frame/);
  assert.match(spriteProblem({ ...hero, frames: [['aaa']] }), /frame 1 must have 2 rows/); assert.match(spriteProblem({ ...hero, frames: [['aaaa', 'aaa']] }), /row 1 of frame 1 must be 3 letters/);
  assert.match(spriteProblem({ ...hero, frames: [['aaz', 'aaa']] }), /letter "z" is not in the palette/); assert.match(spriteProblem({ ...hero, palette: { ab: '#f00' } }), /one letter/);
  assert.match(spriteProblem({ ...hero, animations: { x: { frames: [5], fps: 4 } } }), /frame numbers that exist/); assert.match(spriteProblem({ ...hero, animations: { x: { frames: [0], fps: 0 } } }), /fps/);
  const made = []; setCanvasFactory((w, h) => { const c = fakeCanvas(w, h); made.push(c); return c; });
  const c0 = frameCanvas(hero, 0); assert.equal(frameCanvas(hero, 0), c0, 'made once'); assert.equal(made.length, 1);
  assert.deepEqual(c0.log.filter((e) => e[0] === 'px').map((e) => e.slice(1, 3).join(',')), ['0,0', '2,0', '0,1', '1,1', '2,1'], 'see-through dots draw nothing');
  assert.equal(frameCanvas(hero, 99), frameCanvas(hero, 1), 'a frame number past the end is the last frame'); assert.equal(frameCanvas(hero, -3), c0);
  assert.throws(() => frameCanvas({ ...hero, frames: [['zz']] }), /cannot be drawn/);
});

test('drawing a sprite: crisp, and mirrored when flipped; things use their sprite, frame and alpha', () => {
  setCanvasFactory(fakeCanvas);
  const a = recorder(); drawSprite(a.g, hero, 0, 10, 20, 30, 20);
  assert.deepEqual(a.calls.find((c) => c[0] === 'drawImage').slice(2), [10, 20, 30, 20]); assert.deepEqual(a.calls[0], ['set', 'imageSmoothingEnabled', false]);
  const b = recorder(); drawSprite(b.g, hero, 0, 10, 20, 30, 20, true);
  assert.ok(b.calls.some((c) => c[0] === 'scale' && c[1] === -1) && b.calls.some((c) => c[0] === 'save') && b.calls.some((c) => c[0] === 'restore'));
  const game = newGame(); spawn(game, 'hero', { sprite: 'hero', frame: 1, x: 5, y: 6, w: 24, h: 16, flip: true, alpha: 0.5 }); spawn(game, 'wall', { x: 0, y: 0, w: 8, h: 8, color: '#345' });
  const r = recorder(); drawThings(r.g, game, { hero });
  assert.ok(r.calls.some((c) => c[0] === 'drawImage')); assert.ok(r.calls.some((c) => c[0] === 'set' && c[1] === 'globalAlpha' && c[2] === 0.5));
  assert.ok(r.calls.some((c) => c[0] === 'fillRect'), 'a thing without a sprite is still a box'); assert.deepEqual(r.calls.filter((c) => c[1] === 'globalAlpha').at(-1), ['set', 'globalAlpha', 1], 'alpha is put back');
  const noArt = recorder(); drawThings(noArt.g, game); assert.ok(!noArt.calls.some((c) => c[0] === 'drawImage'), 'with no art given, the box is drawn');
});

test('animations loop through their frames, restart when the name changes, and do nothing for an unknown name', () => {
  const art = { hero }; const t = { sprite: 'hero', anim: 'run' };
  const seen = []; for (let i = 0; i < 12; i++) { animate(t, art, 1 / 8); seen.push(t.frame); }
  assert.deepEqual(seen, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1].map((x, i) => (Math.floor(((i + 1) / 8) * 4) % 2 === 0 ? 0 : 1)), 'at 4 frames per second');
  t.anim = 'stand'; animate(t, art, 0.1); assert.equal(t.frame, seen.at(-1), 'an unknown animation leaves the frame alone');
  const u = { sprite: 'hero', anim: 'run', animTime: 5, animName: 'other' }; animate(u, art, 0.01); assert.equal(u.animTime, 0.01, 'a new name starts from the beginning');
  assert.doesNotThrow(() => animate({ sprite: 'nope' }, art, 1));
});

test('sounds: recipes are cleaned before anyone plays them; play sends a recipe, by name or whole', () => {
  const coin = { duration: 0.3, layers: [{ wave: 'square', freq: 988, decay: 0.1, gain: 0.5 }] };
  assert.deepEqual(cleanSound(coin), { duration: 0.3, seed: 1, gain: 1, layers: [{ wave: 'square', freq: 988, decay: 0.1, gain: 0.5 }] });
  assert.equal(cleanSound(null), null); assert.equal(cleanSound({ layers: [] }), null); assert.equal(cleanSound({ duration: 5, layers: [{}] }), null, 'too long');
  assert.equal(cleanSound({ layers: new Array(9).fill({}) }), null); assert.equal(cleanSound({ layers: [{ freq: Infinity }] }), null); assert.equal(cleanSound({ layers: [{ freq: 99999 }] }), null);
  assert.equal(cleanSound({ layers: [{ gain: -1 }] }), null); assert.equal(cleanSound({ layers: ['x'] }), null);
  const odd = cleanSound({ layers: [{ wave: 'evil', freq: 100, extra: 'x', vibrato: { rate: 5, depth: 0.1 } }], hack: 1 });
  assert.equal(odd.layers[0].wave, 'sine'); assert.equal(odd.layers[0].extra, undefined); assert.deepEqual(odd.layers[0].vibrato, { rate: 5, depth: 0.1 }); assert.equal(odd.hack, undefined);
  const sent = []; setSoundSink((m) => sent.push(m)); sounds({ coin });
  play('coin'); play(coin, 0.5); play('coin', 5); play('coin', -1);
  assert.deepEqual(sent.map((m) => m.volume), [1, 0.5, 1, 0]); assert.equal(sent[0].t, 'sound'); assert.equal(sent[0].spec, coin);
  assert.throws(() => play('boom'), /no sound called "boom" \(the sounds are: coin\)/); sounds({}); assert.throws(() => play('boom'), /Give your sounds names with sounds/);
});

test('sparks and shake are plain data, repeatable, bounded, and fade away', () => {
  const run = () => { const g = newGame(); burst(g, 100, 100, { count: 20, life: 0.5 }); const snaps = []; for (let i = 0; i < 40; i++) { effects(g, 1 / 60); snaps.push(JSON.stringify(g.things.map((t) => [t.x, t.y]))); } return { g, snaps }; };
  const a = run(); const b = run(); assert.deepEqual(a.snaps, b.snaps, 'the same sparks every time');
  const g = newGame(); burst(g, 0, 0, { count: 10, life: 0.3 }); assert.equal(all(g, 'spark').length, 10);
  effects(g, 0.15); assert.ok(all(g, 'spark').every((s) => s.alpha > 0.4 && s.alpha < 0.6), 'half way: half see-through'); effects(g, 0.2); assert.equal(all(g, 'spark').length, 0, 'gone when their life is over');
  const many = newGame(); burst(many, 0, 0, { count: 300 }); burst(many, 0, 0, { count: 300 }); assert.equal(all(many, 'spark').length, 400, 'never more than 400');
  const s = newGame(); assert.deepEqual(shakeOffset(s), { x: 0, y: 0 }); shake(s, 10, 0.2); effects(s, 0.05);
  const o = shakeOffset(s); assert.ok(Math.hypot(o.x, o.y) > 0 && Math.abs(o.x) <= 10 && Math.abs(o.y) <= 10); effects(s, 0.2); assert.equal(s.shake, null); assert.deepEqual(shakeOffset(s), { x: 0, y: 0 });
  assert.doesNotThrow(() => JSON.stringify(g)); assert.deepEqual(JSON.parse(JSON.stringify(g)).things, g.things);
});

test('saved progress is plain data, checked, copied out, and handed to the host', () => {
  const sent = []; setProgressHost({ send: (m) => sent.push(m), initial: { level: 2 } });
  const p = loadProgress(); assert.deepEqual(p, { level: 2 }); p.level = 99; assert.deepEqual(loadProgress(), { level: 2 }, 'a copy: changing it does not save it');
  saveProgress({ level: 3, best: [1, 2] }); assert.deepEqual(sent, [{ t: 'save', data: { level: 3, best: [1, 2] } }]); assert.deepEqual(loadProgress(), { level: 3, best: [1, 2] });
  assert.throws(() => saveProgress({ big: 'x'.repeat(25_000) }), /plain data up to 20 KB/); assert.throws(() => saveProgress(undefined), /plain data/);
  setProgressHost({ initial: null }); assert.deepEqual(loadProgress(), {}, 'nothing saved yet: an empty object');
});

test('enemies patrol: they turn at walls and at the end of a ledge, and face the way they walk', () => {
  const g = newGame();
  loadMap(g, ['########', '#......#', '#.####.#', '########'], { '#': { kind: 'wall' } }, 16);
  const walker = spawn(g, 'enemy', { x: 40, y: 16 - 12 + 16, w: 12, h: 12 });                 // on the floor of the first row
  walker.y = 32 - 12; walker.x = 20;
  const dt = 1 / 60; const turns = []; let last = 1;
  for (let i = 0; i < 600; i++) { patrol(g, walker, dt, 60); if (walker.dir !== last) { turns.push(walker.dir); last = walker.dir; } }
  assert.ok(turns.length >= 3, `turned ${turns.length} times`); assert.ok(walker.x >= 16 && walker.x + walker.w <= 7 * 16 + 1, `stayed in the corridor (x=${walker.x})`);
  assert.equal(walker.flip, walker.dir < 0);
  const ledge = newGame(); loadMap(ledge, ['..........', '####......'], { '#': { kind: 'wall' } }, 16);
  const e = spawn(ledge, 'enemy', { x: 8, y: 16 - 12, w: 12, h: 12 }); let fell = false;
  for (let i = 0; i < 300; i++) { patrol(ledge, e, dt, 60); if (e.y > 30) fell = true; }
  assert.equal(fell, false, 'it turns round instead of walking off the edge');
  assert.equal(solidAt(g, 1, 1), true); assert.equal(solidAt(g, 40, 20), false); assert.equal(solidAt({}, 0, 0), false);
});

test('clearThings empties the game, keeping the kinds you ask it to', () => {
  const g = newGame(); spawn(g, 'wall'); spawn(g, 'coin'); spawn(g, 'hero');
  clearThings(g, ['hero']); assert.deepEqual(all(g).map((t) => t.kind), ['hero']); clearThings(g); assert.equal(all(g).length, 0); assert.equal(first(g, 'hero'), undefined);
  assert.doesNotThrow(() => clearThings({}));
});
