// Easing functions: they turn "how far along in time" (0..1) into "how far along in value" (0..1). Built from + - * / and sqrt, and the sine from
// @engine/math, so a tween in a deterministic game gives the same bits on every machine (no Math.pow, Math.sin or Math.exp).
import { sin, cos, HALF_PI, PI } from '../../math/src/index.js';

const LN2 = 0.6931471805599453;

/** 2 to the power x, from + - * / only: the whole part by repeated doubling, the fraction by a series. */
export function exp2(x) {
  if (x > 1000) return Infinity;
  if (x < -1000) return 0;
  const n = Math.round(x), f = (x - n) * LN2;                  // x = n + f / ln2, with |f| <= 0.35
  let term = 1, sum = 1;
  for (let k = 1; k < 14; k++) { term = (term * f) / k; sum += term; }
  let r = sum;
  for (let i = 0, m = n < 0 ? -n : n; i < m; i++) r = n < 0 ? r * 0.5 : r * 2;
  return r;
}

const C1 = 1.70158, C2 = C1 * 1.525, C3 = C1 + 1;
const C4 = 2.0943951023931953, C5 = 1.3962634015954636;       // 2pi/3 and 2pi/4.5
const bounceOut = (t) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
  if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
  t -= 2.625 / d; return n * t * t + 0.984375;
};
const inOut = (easeIn) => (t) => (t < 0.5 ? easeIn(2 * t) / 2 : 1 - easeIn(2 - 2 * t) / 2);
const out = (easeIn) => (t) => 1 - easeIn(1 - t);

// the "in" form of each family; "out" and "inOut" are made from it
const IN = {
  sine: (t) => 1 - cos(t * HALF_PI),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t * t * t * t,
  quint: (t) => t * t * t * t * t,
  expo: (t) => (t <= 0 ? 0 : exp2(10 * t - 10)),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => C3 * t * t * t - C1 * t * t,
  elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : -exp2(10 * t - 10) * sin((t * 10 - 10.75) * C4)),
  bounce: (t) => 1 - bounceOut(1 - t),
};

/**
 * Every named easing, by name: `linear`, and `sineIn`, `sineOut`, `sineInOut` ... for sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce.
 * @type {Record<string, (t: number) => number>}
 */
export const EASINGS = { linear: (t) => t };
for (const [name, fn] of Object.entries(IN)) {
  EASINGS[`${name}In`] = fn;
  EASINGS[`${name}Out`] = name === 'bounce' ? bounceOut : out(fn);
  EASINGS[`${name}InOut`] = inOut(fn);
}
// the textbook forms of these two differ from the generic ones (sine uses sin directly, back and elastic have their own in-out curves)
EASINGS.sineOut = (t) => sin(t * HALF_PI);
EASINGS.sineInOut = (t) => -(cos(PI * t) - 1) / 2;
EASINGS.backInOut = (t) => (t < 0.5 ? (4 * t * t * ((C2 + 1) * 2 * t - C2)) / 2 : ((2 * t - 2) * (2 * t - 2) * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2);
EASINGS.elasticOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : exp2(-10 * t) * sin((t * 10 - 0.75) * C4) + 1);
EASINGS.elasticInOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? -(exp2(20 * t - 10) * sin((20 * t - 11.125) * C5)) / 2 : (exp2(-20 * t + 10) * sin((20 * t - 11.125) * C5)) / 2 + 1);

/** The names of all the easings, in a fixed order. */
export const EASING_NAMES = Object.keys(EASINGS);

/**
 * Anything that can say how to ease: a name (`'cubicOut'`), your own function of 0..1, or `[x1, y1, x2, y2]` for a CSS-style cubic bezier.
 * @typedef {string | ((t: number) => number) | number[]} EaseSpec
 */

/** Turn an `EaseSpec` into a function. An unknown name throws and lists the names. */
export function resolveEase(spec) {
  if (spec === undefined || spec === null) return EASINGS.linear;
  if (typeof spec === 'function') return spec;
  if (typeof spec === 'string') {
    const fn = EASINGS[spec];
    if (!fn) throw new Error(`unknown easing "${spec}" (try: ${EASING_NAMES.join(', ')})`);
    return fn;
  }
  if (Array.isArray(spec) && spec.length === 4) return cubicBezier(spec[0], spec[1], spec[2], spec[3]);
  throw new Error('an easing is a name, a function, or four numbers for a cubic bezier');
}

/** The easing along a CSS `cubic-bezier(x1, y1, x2, y2)` curve (x1 and x2 in 0..1), solved by Newton's method with a bisection fallback. */
export function cubicBezier(x1, y1, x2, y2) {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) throw new Error('a cubic bezier easing needs x1 and x2 between 0 and 1');
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s) => ((ax * s + bx) * s + cx) * s, dx = (s) => (3 * ax * s + 2 * bx) * s + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(s) - x;
      if (e < 1e-7 && e > -1e-7) return ((ay * s + by) * s + cy) * s;
      const d = dx(s);
      if (d < 1e-6 && d > -1e-6) break;
      s -= e / d;
    }
    let lo = 0, hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) { const e = sx(s); if (e < x) lo = s; else hi = s; s = (lo + hi) / 2; }
    return ((ay * s + by) * s + cy) * s;
  };
}

/** A staircase easing of `count` equal jumps (the value holds, then jumps at the end of each step): for sprite frames and ticking dials. */
export function steps(count) {
  if (!(count >= 1)) throw new Error('steps needs a count of at least 1');
  const n = Math.floor(count);
  return (t) => (t >= 1 ? 1 : Math.floor(t * n) / n);
}
