// Checks for a game: small tests you write next to it to make sure it still works after you change it. A test file is a plain module:
//
//   import { test, expect, simulate } from '@engine/arcade';
//   import * as game from the game's own file, src/main.js (written as a path that starts with ../src/)
//
//   test('the hero starts with three lives', () => { expect(game.create().lives).toBe(3); });
//   test('holding right moves the hero', () => {
//     const state = simulate(game, 60, { keys: () => new Set(['ArrowRight']) });          // one second of play
//     expect(state.hero.x).toBeGreaterThan(100);
//   });
//
// The studio's Tests panel runs every `*.test.js` file in the project (in its own closed box, away from the game) and shows what passed and what failed, with what was
// expected. Nothing here touches the page, so the same file also runs in Node.

const LIMITS = { name: 200, text: 300, tests: 500 };
const shorten = (s, n = LIMITS.text) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a value looks like in a message: JSON where it can be, plain words where it cannot (functions, undefined, loops). */
export function show(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return shorten(JSON.stringify(value), 120);
  try { return shorten(JSON.stringify(value) ?? String(value), 120); } catch { return 'something that cannot be shown'; }
}

/** Do two values have the same contents? Numbers, text, true and false, lists and plain objects are compared inside out (NaN equals NaN). */
export function same(a, b, seen = new WeakSet()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (seen.has(a)) return false;
  seen.add(a);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k], seen));
}

class CheckError extends Error {
  constructor(message, expected, actual) {
    super(message);
    this.expected = expected === undefined ? undefined : show(expected);
    this.actual = actual === undefined && expected === undefined ? undefined : show(actual);
  }
}

/** Matchers for a value: `expect(x).toBe(3)`. `expect(x).not.toBe(3)` says the opposite. */
export function expect(actual) {
  const make = (negate) => {
    const check = (pass, message, notMessage, expected) => {
      if (pass === negate) throw new CheckError(negate ? notMessage : message, expected, actual);
    };
    return {
      toBe: (expected) => check(Object.is(actual, expected), `Expected ${show(actual)} to be ${show(expected)}.`, `Expected ${show(actual)} not to be ${show(expected)}.`, expected),
      toEqual: (expected) => check(same(actual, expected), `Expected ${show(actual)} to equal ${show(expected)}.`, `Expected ${show(actual)} not to equal ${show(expected)}.`, expected),
      toBeCloseTo: (expected, digits = 2) => check(Math.abs(actual - expected) < 10 ** -digits / 2, `Expected ${show(actual)} to be close to ${show(expected)}.`,
        `Expected ${show(actual)} not to be close to ${show(expected)}.`, expected),
      toBeTruthy: () => check(Boolean(actual), `Expected ${show(actual)} to be true-ish.`, `Expected ${show(actual)} not to be true-ish.`),
      toBeFalsy: () => check(!actual, `Expected ${show(actual)} to be false-ish.`, `Expected ${show(actual)} not to be false-ish.`),
      toBeGreaterThan: (n) => check(actual > n, `Expected ${show(actual)} to be more than ${show(n)}.`, `Expected ${show(actual)} not to be more than ${show(n)}.`, n),
      toBeLessThan: (n) => check(actual < n, `Expected ${show(actual)} to be less than ${show(n)}.`, `Expected ${show(actual)} not to be less than ${show(n)}.`, n),
      toContain: (item) => check(typeof actual === 'string' ? actual.includes(item) : Array.isArray(actual) && actual.some((x) => same(x, item)),
        `Expected ${show(actual)} to contain ${show(item)}.`, `Expected ${show(actual)} not to contain ${show(item)}.`, item),
      toHaveLength: (n) => check(actual?.length === n, `Expected a length of ${n} but got ${show(actual?.length)}.`, `Expected a length other than ${n}.`, n),
      toThrow: (match) => {
        let thrown;
        try { actual(); } catch (error) { thrown = error; }
        const said = String(thrown?.message ?? thrown ?? '');
        const ok = thrown !== undefined && (match === undefined || (match instanceof RegExp ? match.test(said) : said.includes(match)));
        check(ok, thrown === undefined ? 'Expected it to throw, but it did not.' : `Expected it to throw ${show(match)}, but it said ${show(said)}.`, 'Expected it not to throw.');
      },
    };
  };
  return { ...make(false), not: make(true) };
}

const list = () => (globalThis.__checkList ??= []);

/**
 * Add a check. It runs when the studio (or `runChecks`) runs the file.
 * @param {string} name what is being checked, in words
 * @param {() => void | Promise<void>} fn throws (or `expect` does) when something is wrong
 */
export function test(name, fn) {
  if (typeof fn !== 'function') throw new Error(`test("${name}") needs a function to run.`);
  if (list().length >= LIMITS.tests) throw new Error(`At most ${LIMITS.tests} checks in one run.`);
  list().push({ name: shorten(String(name), LIMITS.name), fn });
}

/**
 * Play a game's own `create` and `update` for some ticks without drawing, and give back its state, so a check can say what happened.
 * @param {{create: () => any, update: Function}} mod the game's own module (its `create` and `update`), imported as a namespace
 * @param {number} [ticks]
 * @param {{keys?: Set<string> | ((tick: number, state: any) => Set<string>), dt?: number, state?: any}} [o]
 */
export function simulate(mod, ticks = 60, { keys, dt = 1 / 60, state } = {}) {
  const game = state ?? mod.create();
  for (let i = 0; i < ticks; i++) mod.update(game, typeof keys === 'function' ? keys(i, game) : keys ?? new Set(), dt);
  return game;
}

/**
 * Run the checks that have been added since the last run, one after another, and clear the list.
 * @param {{timeoutMs?: number}} [o] how long one check may take
 * @returns {Promise<{name: string, ok: boolean, ms: number, error?: {message: string, expected?: string, actual?: string}}[]>}
 */
export async function runChecks({ timeoutMs = 2000 } = {}) {
  const todo = list().splice(0);
  const results = [];
  for (const { name, fn } of todo) {
    const t0 = Date.now();
    try {
      let timer;
      const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`This check took more than ${timeoutMs / 1000} seconds.`)), timeoutMs); });
      try { await Promise.race([Promise.resolve().then(fn), late]); } finally { clearTimeout(timer); }
      results.push({ name, ok: true, ms: Date.now() - t0 });
    } catch (error) {
      results.push({
        name, ok: false, ms: Date.now() - t0,
        error: { message: shorten(String(error?.message ?? error)), expected: error?.expected, actual: error?.actual },
      });
    }
  }
  return results;
}
