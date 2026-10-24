// Cross-engine determinism suite for tweens: every easing sampled finely, and a timeline of tweens (elastic, bounce, bezier, repeat, yoyo) played to the end.
// Run in Node, Chrome and Firefox by `node tools/determinism.js`: the hashes must match, so a tween inside a replayed or networked game lands on the same bits.
import { EASINGS, EASING_NAMES, cubicBezier, Timeline } from '../src/index.js';

class Hasher {
  constructor() { this.h = 0x811c9dc5; this.f64 = new Float64Array(1); this.u32 = new Uint32Array(this.f64.buffer); }
  word(w) { for (let i = 0; i < 4; i++) this.h = Math.imul(this.h ^ ((w >>> (i * 8)) & 255), 0x01000193); }
  num(v) { this.f64[0] = v; this.word(this.u32[0]); this.word(this.u32[1]); }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function easings() {
  const h = new Hasher();
  for (const name of EASING_NAMES) for (let i = 0; i <= 1000; i++) h.num(EASINGS[name](i / 1000));
  const bez = cubicBezier(0.25, 0.1, 0.25, 1);
  for (let i = 0; i <= 1000; i++) h.num(bez(i / 1000));
  return h.hex;
}

function timeline() {
  const h = new Hasher(), o = { x: 0, y: 0, c: [1, 0, 0] };
  const tl = new Timeline({ repeat: 2, yoyo: true })
    .to(o, { x: 100 }, { duration: 1.3, ease: 'elasticOut' })
    .to(o, { y: 50, c: [0, 0.5, 1] }, { duration: 1, ease: 'bounceInOut', delay: 0.2 }, '-=0.6')
    .to(o, { x: '-=30' }, { duration: 0.7, ease: [0.4, 0, 0.2, 1], repeat: 1, yoyo: true });
  for (let i = 0; i < 400; i++) { tl.update(1 / 60); h.num(o.x); h.num(o.y); h.num(o.c[0]); h.num(o.c[1]); h.num(o.c[2]); }
  return h.hex;
}

/** @returns {{exact: Record<string, string>, probe: {}}} */
export function runTweenSuite() {
  return { exact: { 'tween.easings': easings(), 'tween.timeline': timeline() }, probe: {} };
}
