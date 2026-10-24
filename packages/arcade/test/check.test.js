import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { test, expect, simulate, runChecks, same, show } from '../src/check.js';

/** Run some checks as the studio would and give back the results by name. */
async function run(define, o) {
  define();
  return Object.fromEntries((await runChecks(o)).map((r) => [r.name, r]));
}

nodeTest('passing and failing checks are told apart, with what was expected and what happened', async () => {
  const r = await run(() => {
    test('adds', () => { expect(1 + 1).toBe(2); });
    test('wrong', () => { expect(1 + 1).toBe(3); });
    test('threw', () => { throw new Error('boom'); });
    test('async works', async () => { await new Promise((ok) => setTimeout(ok, 5)); expect(true).toBeTruthy(); });
    test('async fails', async () => { await Promise.resolve(); expect('a').toBe('b'); });
  });
  assert.equal(r.adds.ok, true);
  assert.equal(r.wrong.ok, false);
  assert.equal(r.wrong.error.message, 'Expected 2 to be 3.');
  assert.equal(r.wrong.error.expected, '3');
  assert.equal(r.wrong.error.actual, '2');
  assert.equal(r.threw.error.message, 'boom');
  assert.equal(r['async works'].ok, true);
  assert.equal(r['async fails'].error.message, 'Expected "a" to be "b".');
  assert.ok(r.adds.ms >= 0);
});

nodeTest('every matcher passes when it should and fails (with words) when it should, and not turns it round', async () => {
  const good = (fn) => { fn(); };
  const bad = (fn, words) => assert.throws(fn, (e) => words.test(e.message) && e.constructor.name === 'CheckError');
  good(() => { expect(5).toBe(5); expect({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] }); expect(0.1 + 0.2).toBeCloseTo(0.3); });
  good(() => { expect(1).toBeTruthy(); expect(0).toBeFalsy(); expect(3).toBeGreaterThan(2); expect(1).toBeLessThan(2); });
  good(() => { expect('hello').toContain('ell'); expect([1, { a: 1 }]).toContain({ a: 1 }); expect([1, 2]).toHaveLength(2); expect('abc').toHaveLength(3); });
  good(() => { expect(() => { throw new Error('bad news'); }).toThrow(); expect(() => { throw new Error('bad news'); }).toThrow('news'); });
  good(() => { expect(() => { throw new Error('bad news'); }).toThrow(/^bad/); expect(() => {}).not.toThrow(); expect(NaN).toBe(NaN); });
  bad(() => expect({ a: 1 }).toEqual({ a: 2 }), /to equal/);
  bad(() => expect(0.5).toBeCloseTo(0.3), /close to/);
  bad(() => expect(0).toBeTruthy(), /true-ish/);
  bad(() => expect(1).toBeFalsy(), /false-ish/);
  bad(() => expect(1).toBeGreaterThan(2), /more than/);
  bad(() => expect(3).toBeLessThan(2), /less than/);
  bad(() => expect('abc').toContain('z'), /contain/);
  bad(() => expect([1]).toContain(2), /contain/);
  bad(() => expect([1]).toHaveLength(3), /length of 3 but got 1/);
  bad(() => expect(() => {}).toThrow(), /did not/);
  bad(() => expect(() => { throw new Error('x'); }).toThrow('y'), /but it said/);
  bad(() => expect(() => { throw new Error('x'); }).not.toThrow(), /not to throw/);
  good(() => { expect(1).not.toBe(2); expect([1]).not.toEqual([2]); expect(5).not.toBeGreaterThan(9); expect('a').not.toContain('b'); });
  bad(() => expect(1).not.toBe(1), /not to be/);
});

nodeTest('equality looks inside lists and objects, ignores key order, and does not loop forever on a cycle', () => {
  assert.ok(same({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
  assert.ok(!same([1, 2], { 0: 1, 1: 2 }), 'a list is not an object');
  assert.ok(!same({ a: 1 }, { a: 1, b: undefined }), 'a missing key is a difference');
  assert.ok(!same(null, {}));
  assert.ok(same(NaN, NaN) && !same(0, -0));
  const a = { self: null };
  a.self = a;
  const b = { self: null };
  b.self = b;
  assert.doesNotThrow(() => same(a, b));
});

nodeTest('values are shown in plain words: functions, undefined, loops, long data', () => {
  assert.equal(show(undefined), 'undefined');
  assert.equal(show(() => 1), 'a function');
  assert.equal(show('hi'), '"hi"');
  assert.equal(show(Infinity), 'Infinity');
  assert.equal(show({ a: 1 }), '{"a":1}');
  const loop = {};
  loop.me = loop;
  assert.equal(show(loop), 'something that cannot be shown');
  assert.ok(show('x'.repeat(500)).length <= 500);
  assert.ok(show(Array.from({ length: 200 }, (_, i) => i)).length <= 121);
});

nodeTest('a check that takes too long is stopped with a plain message, and the others still run', async () => {
  const r = await run(() => {
    test('slow', () => new Promise(() => {}));
    test('quick', () => {});
  }, { timeoutMs: 60 });
  assert.equal(r.slow.ok, false);
  assert.match(r.slow.error.message, /took more than/);
  assert.equal(r.quick.ok, true);
});

nodeTest('simulate plays a game\'s create and update with the keys given, without drawing', () => {
  const game = {
    create: () => ({ x: 0, ticks: 0 }),
    update: (s, keys, dt) => { s.ticks++; if (keys.has('ArrowRight')) s.x += 100 * dt; },
  };
  assert.equal(simulate(game, 30).x, 0);
  assert.equal(simulate(game, 30).ticks, 30);
  assert.ok(Math.abs(simulate(game, 60, { keys: new Set(['ArrowRight']) }).x - 100) < 1e-6);
  assert.ok(simulate(game, 60, { keys: (i) => (i < 30 ? new Set(['ArrowRight']) : new Set()) }).x > 49);
  const start = { x: 10, ticks: 0 };
  assert.equal(simulate(game, 1, { state: start }), start, 'carries on from a state you give');
  assert.ok(simulate(game, 1, { dt: 1, keys: new Set(['ArrowRight']) }).x === 100);
});

nodeTest('checks run once and the list is cleared; a test with no function and too many tests are refused', async () => {
  await run(() => { test('a', () => {}); });
  assert.deepEqual(await runChecks(), []);
  assert.throws(() => test('x', 5), /needs a function/);
  for (let i = 0; i < 500; i++) test(`t${i}`, () => {});
  assert.throws(() => test('one too many', () => {}), /At most 500/);
  await runChecks();
});
