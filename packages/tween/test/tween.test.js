import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EASINGS, EASING_NAMES, resolveEase, cubicBezier, steps, exp2, Tween, Timeline, Tweens } from '../src/index.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const run = (anim, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) anim.update(dt); };

test('exp2 matches the real thing, using nothing but + - * /', () => {
  for (let x = -12; x <= 12; x += 0.37) near(exp2(x) / 2 ** x, 1, 1e-13, `2^${x}`);
});

test('every easing starts at 0 and ends at 1, and is finite in between', () => {
  assert.ok(EASING_NAMES.length >= 31);
  for (const name of EASING_NAMES) {
    const f = EASINGS[name];
    near(f(0), 0, 1e-3, `${name}(0)`); near(f(1), 1, 1e-9, `${name}(1)`);
    for (let t = 0; t <= 1; t += 0.05) assert.ok(Number.isFinite(f(t)), `${name}(${t})`);
  }
});

test('easings match their textbook values', () => {
  near(EASINGS.quadIn(0.5), 0.25); near(EASINGS.cubicOut(0.5), 0.875); near(EASINGS.quartInOut(0.25), 0.03125);
  near(EASINGS.sineIn(0.5), 1 - Math.SQRT1_2, 1e-12); near(EASINGS.sineOut(0.5), Math.SQRT1_2, 1e-12); near(EASINGS.sineInOut(0.5), 0.5, 1e-12);
  near(EASINGS.expoOut(0.5), 1 - 2 ** -5, 1e-12); near(EASINGS.circOut(0.5), Math.sqrt(0.75), 1e-12);
  near(EASINGS.backIn(0.5), 2.70158 * 0.125 - 1.70158 * 0.25, 1e-12);
  assert.ok(EASINGS.backOut(0.8) > 1, 'back overshoots');
  near(EASINGS.elasticOut(0.3), 0.875, 1e-9); assert.ok(EASINGS.elasticOut(0.4) > 1, 'elastic rings');
  near(EASINGS.bounceOut(0.5), 0.765625); near(EASINGS.bounceIn(0.5), 1 - 0.765625);
  for (const n of ['quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce']) {
    for (let t = 0.05; t < 1; t += 0.1) {
      near(EASINGS[`${n}Out`](t), 1 - EASINGS[`${n}In`](1 - t), 1e-9, `${n} out mirrors in at ${t}`);
      near(EASINGS[`${n}InOut`](t) + EASINGS[`${n}InOut`](1 - t), 1, 1e-9, `${n} in-out is symmetric at ${t}`);
    }
  }
});

test('cubic beziers match CSS ease curves; steps jump at the ends; resolveEase takes all forms', () => {
  const ease = cubicBezier(0.25, 0.1, 0.25, 1);                      // CSS "ease"
  near(ease(0.5), 0.8024, 1e-3); near(ease(0), 0); near(ease(1), 1);
  const lin = cubicBezier(0, 0, 1, 1);
  for (let t = 0; t <= 1; t += 0.1) near(lin(t), t, 1e-5);
  const s = steps(4);
  assert.deepEqual([0, 0.24, 0.25, 0.9, 1].map(s), [0, 0, 0.25, 0.75, 1]);
  assert.equal(resolveEase('quadIn')(0.5), 0.25); assert.equal(resolveEase((t) => t * 3)(1), 3); near(resolveEase([0, 0, 1, 1])(0.3), 0.3, 1e-5);
  assert.throws(() => resolveEase('wobble'), /unknown easing "wobble"/);
  assert.throws(() => cubicBezier(2, 0, 0, 1), /between 0 and 1/);
});

test('a tween moves a property linearly, starting from where it is, and calls back', () => {
  const o = { x: 10 };
  const log = [];
  const tw = new Tween(o, { to: { x: 110 } }, { duration: 1, onStart: () => log.push('start'), onComplete: () => log.push('complete'), onUpdate: () => log.push('u') });
  tw.update(0.25); near(o.x, 35);
  tw.update(0.25); near(o.x, 60);
  assert.equal(tw.done, false);
  tw.update(0.6); assert.equal(o.x, 110); assert.equal(tw.done, true);
  assert.deepEqual([log[0], log.at(-1), log.filter((l) => l === 'complete').length], ['start', 'complete', 1]);
  tw.update(1); assert.equal(log.filter((l) => l === 'complete').length, 1, 'only once');
});

test('delay: nothing moves and nothing is read until it ends; the start is taken then', () => {
  const o = { x: 0 };
  const tw = new Tween(o, { to: { x: 10 } }, { duration: 1, delay: 0.5 });
  tw.update(0.4); assert.equal(o.x, 0);
  o.x = 100;                                                       // moved by something else during the delay
  tw.update(0.6); near(o.x, 55, 1e-9, 'half way from 100 to 10');
  tw.update(1); assert.equal(o.x, 10);
});

test('easing is applied, and so are names, functions and beziers', () => {
  const o = { x: 0, y: 0, z: 0 };
  const a = new Tween(o, { to: { x: 1 } }, { duration: 1, ease: 'quadIn' }); a.seek(0.5); near(o.x, 0.25);
  const b = new Tween(o, { to: { y: 1 } }, { duration: 1, ease: (t) => t * t * t }); b.seek(0.5); near(o.y, 0.125);
  const c = new Tween(o, { to: { z: 1 } }, { duration: 1, ease: [0, 0, 1, 1] }); c.seek(0.5); near(o.z, 0.5, 1e-5);
});

test('repeat, repeatDelay and yoyo; the end is where yoyo says', () => {
  const o = { x: 0 };
  const tw = new Tween(o, { to: { x: 10 } }, { duration: 1, repeat: 2, yoyo: true });
  const repeats = [];
  tw.onRepeat = () => repeats.push(o.x);
  tw.seek(0.5); near(o.x, 5);
  tw.seek(1.5); near(o.x, 5); tw.seek(1.25); near(o.x, 7.5, 1e-9, 'coming back');
  tw.seek(2.5); near(o.x, 5);
  tw.seek(3); assert.equal(o.x, 10); assert.equal(tw.done, true, 'three plays, the last one forward');
  const p = { x: 0 };
  const gap = new Tween(p, { to: { x: 10 } }, { duration: 1, repeat: 1, repeatDelay: 1 });
  gap.seek(1.5); assert.equal(p.x, 10, 'holds the end during the gap'); gap.seek(2.5); near(p.x, 5); gap.seek(3); assert.equal(gap.done, true);
  assert.equal(gap.totalDuration, 3);
  const q = { x: 0 };
  const w = new Tween(q, { to: { x: 1 } }, { duration: 1, repeat: -1 });
  w.update(1000.25); near(q.x, 0.25, 1e-6); assert.equal(w.done, false); assert.equal(w.totalDuration, Infinity);
});

test('onRepeat is called once per repeat, even when a big step crosses several', () => {
  let n = 0, completed = 0;
  const tw = new Tween({ x: 0 }, { to: { x: 1 } }, { duration: 1, repeat: 3, onRepeat: () => n++, onComplete: () => completed++ });
  tw.update(2.5); assert.equal(n, 2);
  tw.update(5); assert.equal(n, 3); assert.equal(completed, 1);
});

test('from, fromTo, relative values, lists of numbers, dotted paths and typed arrays', () => {
  const o = { x: 100, pos: { y: 4 }, color: [1, 0, 0], buf: new Float32Array([0, 0]) };
  new Tween(o, { from: { x: 0 } }, { duration: 1 }).seek(0.5); near(o.x, 50);
  o.x = 100;
  new Tween(o, { from: { x: 0 }, to: { x: 10 } }, { duration: 1 }).seek(0.5); near(o.x, 5);
  new Tween(o, { to: { x: '+=50' } }, { duration: 1 }).seek(1); near(o.x, 55);
  new Tween(o, { to: { x: '-=20' } }, { duration: 1 }).seek(1); near(o.x, 35);
  new Tween(o, { to: { 'pos.y': 8 } }, { duration: 1 }).seek(0.5); near(o.pos.y, 6);
  const c = new Tween(o, { to: { color: [0, 0, 1] } }, { duration: 1 }); c.seek(0.5);
  assert.deepEqual(o.color, [0.5, 0, 0.5]); assert.ok(Array.isArray(o.color), 'tweened in place');
  new Tween(o, { to: { buf: [4, 8] } }, { duration: 1 }).seek(0.5); assert.deepEqual([...o.buf], [2, 4]);
});

test('mistakes are named', () => {
  assert.throws(() => new Tween(null, { to: { x: 1 } }), /needs an object/);
  assert.throws(() => new Tween({}, {}), /`to` and\/or `from`/);
  assert.throws(() => new Tween({ a: 1 }, { to: { 'a.b': 1 } }), /"a" is not an object/);
  assert.throws(() => new Tween({ x: 'red' }, { to: { x: 1 } }).seek(0.1), /not a number/);
  assert.throws(() => new Tween({ x: 1 }, { to: { x: NaN } }).seek(0.1), /must go to a number/);
  assert.throws(() => new Tween({ x: 1 }, { to: { x: '*2' } }).seek(0.1), /relative values look like/);
  assert.throws(() => new Tween({ x: 1 }, { to: { x: 1 } }, { duration: -1 }), /duration/);
  assert.throws(() => new Tween({ x: 1 }, { to: { x: 1 } }, { repeat: 1.5 }), /whole number/);
  assert.throws(() => new Tween({ x: 1 }, { to: { x: 1 } }, { ease: 'nope' }), /unknown easing/);
});

test('seek is exact and silent; seeking back restores; progress is settable', () => {
  const o = { x: 0 };
  let calls = 0;
  const tw = new Tween(o, { to: { x: 100 } }, { duration: 2, onUpdate: () => calls++, onComplete: () => calls++ });
  tw.seek(1.5); near(o.x, 75); tw.seek(0.5); near(o.x, 25); tw.seek(0); assert.equal(o.x, 0);
  assert.equal(calls, 0, 'seek does not call back');
  tw.progress = 0.5; near(o.x, 50); near(tw.progress, 0.5);
  tw.seek(99); assert.equal(o.x, 100); assert.equal(tw.done, true); tw.seek(1); assert.equal(tw.done, false);
});

test('timeScale, pause, resume, restart and kill', () => {
  const o = { x: 0 };
  const tw = new Tween(o, { to: { x: 10 } }, { duration: 1, timeScale: 2 });
  tw.update(0.25); near(o.x, 5);
  tw.pause(); tw.update(1); near(o.x, 5); tw.resume(); tw.update(0.25); near(o.x, 10);
  tw.restart(); assert.equal(o.x, 0); tw.update(0.25); near(o.x, 5);
  tw.kill(); tw.update(1); near(o.x, 5);
});

test('a manager plays, drops finished tweens, and can be slowed or stopped', () => {
  const tweens = new Tweens();
  const a = { x: 0 }, b = { x: 0 };
  tweens.to(a, { x: 1 }, { duration: 1 }); tweens.to(b, { x: 1 }, { duration: 2 });
  assert.equal(tweens.count, 2);
  tweens.update(1); near(a.x, 1); near(b.x, 0.5); assert.equal(tweens.count, 1);
  tweens.timeScale = 0.5; tweens.update(1); near(b.x, 0.75);
  tweens.paused = true; tweens.update(10); near(b.x, 0.75);
  tweens.paused = false; assert.equal(tweens.killTweensOf(b), 1); assert.equal(tweens.count, 0); tweens.update(1); near(b.x, 0.75);
  tweens.to(a, { x: 5 }); tweens.fromTo(b, { x: -1 }, { x: 1 }); tweens.killAll(); assert.equal(tweens.count, 0);
});

test('a callback may add tweens while the manager is updating', () => {
  const tweens = new Tweens();
  const o = { x: 0 }, p = { x: 0 };
  tweens.to(o, { x: 1 }, { duration: 0.5, onComplete: () => tweens.to(p, { x: 1 }, { duration: 0.5 }) });
  tweens.update(0.5); assert.equal(tweens.count, 1);
  tweens.update(0.5); near(p.x, 1);
});

test('timeline: steps in order, overlaps, labels, positions and calls', () => {
  const a = { x: 0 }, b = { x: 0 }, c = { x: 0 };
  const log = [];
  const tl = new Timeline()
    .to(a, { x: 10 }, { duration: 1 })
    .label('mid')
    .to(b, { x: 10 }, { duration: 1 }, '-=0.5')                    // starts at 0.5
    .to(c, { x: 10 }, { duration: 1 }, '<')                        // with b, at 0.5
    .call(() => log.push('boom'), 'mid+=0.25')                      // at 1.25
    .to(c, { x: 20 }, { duration: 1 }, 'mid+=1');                  // at 2
  assert.equal(tl.duration, 3);
  tl.seek(0.5); near(a.x, 5); assert.equal(b.x, 0); assert.equal(c.x, 0);
  tl.seek(1); near(a.x, 10); near(b.x, 5); near(c.x, 5);
  tl.seek(2.5); near(c.x, 15); near(b.x, 10);
  tl.seek(3); assert.equal(c.x, 20);
  assert.deepEqual(log, [], 'seek does not call');
  tl.seek(0); assert.deepEqual([a.x, b.x, c.x], [0, 0, 0], 'seeking back puts everything back');
  run(tl, 3.5); assert.deepEqual(log, ['boom']); assert.equal(tl.done, true);
});

test('timeline: a later step starts from where the earlier one left it, even when sought straight to the end', () => {
  const o = { x: 0 };
  const tl = new Timeline().to(o, { x: 100 }, { duration: 1 }).to(o, { x: 0 }, { duration: 1 });
  tl.seek(2); assert.equal(o.x, 0);
  tl.seek(1.5); near(o.x, 50); tl.seek(1); assert.equal(o.x, 100); tl.seek(0.25); near(o.x, 25);
  tl.seek(0); assert.equal(o.x, 0);
});

test('a step ahead of the clock does not capture or move anything', () => {
  const a = { x: 0 }, b = { x: 5 };
  const tl = new Timeline().to(a, { x: 1 }, { duration: 1 }).to(b, { x: 10 }, { duration: 1 });
  tl.update(0.5);
  b.x = 50;                                                        // changed before its step begins; the step must start from this
  tl.update(0.5 + 0.5); near(b.x, 50 + (10 - 50) * 0.5);
});

test('timeline: calls fire once each, in order, however the time is stepped', () => {
  for (const dt of [1 / 60, 0.3, 5]) {
    const log = [];
    const tl = new Timeline().call(() => log.push('zero'), 0).call(() => log.push('a'), 1).call(() => log.push('b'), 1).call(() => log.push('c'), 2).wait(1);
    for (let i = 0; i < 400 && !tl.done; i++) tl.update(dt);
    assert.deepEqual(log, ['zero', 'a', 'b', 'c'], `dt ${dt}`);
  }
});

test('timeline: repeat, yoyo and repeat callbacks', () => {
  const o = { x: 0 };
  const log = [];
  const tl = new Timeline({ repeat: 2, yoyo: true, onRepeat: () => log.push('r'), onComplete: () => log.push('done') });
  tl.to(o, { x: 10 }, { duration: 1 }).call(() => log.push('c'), 0.5);
  assert.equal(tl.totalDuration, 3);
  tl.seek(1.5); near(o.x, 5); tl.seek(1.75); near(o.x, 2.5, 1e-9, 'going back');
  tl.reset(); o.x = 0; log.length = 0;
  run(tl, 3.2);
  assert.deepEqual(log, ['c', 'r', 'c', 'r', 'c', 'done'], 'the call is made on each lap, backwards laps included');
  assert.equal(o.x, 10);
});

test('timeline: a nested timeline, a delay and a refusal of forever', () => {
  const o = { x: 0, y: 0 };
  const inner = new Timeline().to(o, { x: 4 }, { duration: 1 }).to(o, { y: 4 }, { duration: 1 });
  const outer = new Timeline({ delay: 1 }).add(inner, 0.5);
  assert.equal(outer.totalDuration, 1 + 0.5 + 2);
  outer.seek(1); assert.equal(o.x, 0); outer.seek(2); near(o.x, 2); outer.seek(2.5); near(o.x, 4); near(o.y, 0); outer.seek(3.5); near(o.y, 4);
  assert.throws(() => outer.add(new Tween({ x: 0 }, { to: { x: 1 } }, { repeat: -1 })), /repeats forever/);
  assert.throws(() => outer.add('nope'), /add a Tween/);
  assert.throws(() => outer.to(o, { x: 1 }, {}, 'later'), /no label "later"/);
  assert.throws(() => outer.to(o, { x: 1 }, {}, '++1'), /not a place/);
});

test('a manager plays a timeline and drops it, and killTweensOf finds a target inside one', () => {
  const tweens = new Tweens();
  const a = { x: 0 }, b = { x: 0 };
  const tl = tweens.timeline().to(a, { x: 1 }, { duration: 1 }).to(b, { x: 1 }, { duration: 1 });
  tweens.update(1); near(a.x, 1); assert.equal(tweens.count, 1);
  assert.equal(tweens.killTweensOf(b), 1); assert.equal(tweens.count, 0); assert.equal(tl.killed, true);
});

test('tweens are deterministic: two runs with different step sizes land on the same exact bits', () => {
  const play = (dt) => {
    const o = { x: 0, y: 0 };
    const tl = new Timeline({ repeat: 1, yoyo: true }).to(o, { x: 7 }, { duration: 1, ease: 'elasticOut' }).to(o, { y: 3 }, { duration: 1, ease: 'bounceInOut' }, '-=0.3');
    tl.seek(1.9);
    return [o.x, o.y];
  };
  assert.deepEqual(play(1), play(2));
  const o = { x: 0 }, p = { x: 0 };
  const a = new Tween(o, { to: { x: 1 } }, { duration: 1, ease: 'expoInOut' }), b = new Tween(p, { to: { x: 1 } }, { duration: 1, ease: 'expoInOut' });
  for (let i = 0; i < 30; i++) a.update(1 / 60);
  b.seek(30 / 60); near(o.x, p.x, 1e-12);
});
