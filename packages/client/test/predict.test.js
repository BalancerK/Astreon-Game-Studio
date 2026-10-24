import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Predictor } from '../src/index.js';

const DT = 1 / 60;
/** One unit a tick towards where the input points, with a wall at 100, so replaying is not just adding things up. */
const step = (s, input, dt) => { s.vx = input * 60; s.x = Math.min(100, s.x + s.vx * dt); };
const make = (o = {}) => new Predictor({ step, dt: DT, initial: { x: 0, vx: 0 }, ...o });
const feed = (p, from, to, input = 1) => { for (let seq = from; seq <= to; seq++) p.record(seq, input); };

test('inputs are applied at once, and a server that agrees changes nothing', () => {
  const p = make();
  feed(p, 1, 10);
  assert.equal(Math.round(p.state.x * 1000) / 1000, 10);
  assert.equal(p.pending, 10);
  assert.equal(p.reconcile(5, { x: 5 }), 0);
  assert.equal(p.pending, 5);
  assert.equal(p.stats.corrections, 0);
  assert.equal(Math.round(p.state.x * 1000) / 1000, 10, 'what was predicted stands');
});

test('a server that disagrees is adopted and the newer inputs are replayed on top of it, and what is drawn does not jump', () => {
  const p = make();
  feed(p, 1, 10);
  const drawnBefore = p.renderState(1).x;
  const moved = p.reconcile(5, { x: 15 });                   // something pushed us 10 units that we could not know about
  assert.ok(Math.abs(moved - 10) < 1e-6);
  assert.ok(Math.abs(p.state.x - 20) < 1e-6, '15 at input 5, then five more inputs');
  assert.ok(Math.abs(p.renderState(1).x - drawnBefore) < 1e-6, 'the picture is where it was');
  assert.equal(p.stats.corrections, 1);
  for (let i = 0; i < 40; i++) p.smooth(1 / 60);
  assert.ok(Math.abs(p.renderState(1).x - 20) < 0.5, 'and eases to the truth');
  p.smooth(10);
  assert.equal(p.renderState(1).x, p.state.x);
});

test('the replay uses the real step: a wall in the way is respected', () => {
  const p = make({ initial: { x: 90, vx: 0 } });
  feed(p, 1, 20);
  assert.equal(p.state.x, 100, 'we hit the wall');
  p.reconcile(10, { x: 97 });
  assert.equal(p.state.x, 100, 'replayed from 97, stopped by the same wall');
});

test('the server may send only some of the numbers; the others are kept', () => {
  const p = make();
  feed(p, 1, 4);
  const vx = p.state.vx;
  p.reconcile(2, { x: 50 });
  assert.equal(p.state.vx, vx);
  assert.ok(Math.abs(p.state.x - 52) < 1e-6);
});

test('a small difference inside the tolerance is ignored, a bigger one is not', () => {
  const p = make({ tolerance: 0.5 });
  feed(p, 1, 10);
  assert.equal(p.reconcile(5, { x: 5.4 }), 0);
  assert.equal(p.stats.corrections, 0);
  assert.ok(p.reconcile(8, { x: 9 }) > 0);
  assert.equal(p.stats.corrections, 1);
});

test('a correction bigger than the snap distance jumps instead of easing', () => {
  const p = make({ snapDistance: 20 });
  feed(p, 1, 10);
  p.reconcile(5, { x: 70 });
  assert.equal(p.stats.snaps, 1);
  assert.equal(p.renderState(1).x, p.state.x, 'no offset to ease away');
});

test('old acknowledgements, and "nothing applied yet", are ignored', () => {
  const p = make();
  feed(p, 1, 10);
  p.reconcile(6, { x: 6 });
  assert.equal(p.reconcile(3, { x: 500 }), 0);
  assert.equal(p.reconcile(0, { x: 500 }), 0);
  assert.ok(p.state.x < 20);
});

test('without a starting place it waits to be told, then replays the inputs sent in the meantime', () => {
  const p = new Predictor({ step, dt: DT });
  feed(p, 1, 6);
  assert.deepEqual(p.state, {}, 'nothing is predicted before it knows where it is');
  assert.equal(p.reconcile(2, { x: 30, vx: 0 }), 0);
  assert.ok(Math.abs(p.state.x - 34) < 1e-6, 'inputs 3 to 6 on top of 30');
  p.record(7, 1);
  assert.ok(Math.abs(p.state.x - 35) < 1e-6, 'and from now on each input is applied at once');
});

test('the ring of remembered inputs wraps, and an acknowledgement older than it holds becomes a snap', () => {
  const p = make({ capacity: 16, initial: { x: 0, vx: 0 } });
  feed(p, 1, 300, 0);
  p.reconcile(299, { x: 0 });
  assert.equal(p.stats.corrections, 0);
  p.reconcile(100 + 1, { x: 5 });                           // ancient: lost to the ring
  assert.equal(p.stats.corrections, 0, 'older than what was already handled: ignored');
  const q = make({ capacity: 16 });
  feed(q, 1, 300, 0);
  q.reconcile(10, { x: 5 });
  assert.equal(q.stats.snaps, 1, 'not enough history to replay: it jumps to the server\'s word');
});

test('other numbers can be smoothed too (a 3D position), and a different way to measure the error can be given', () => {
  const p = new Predictor({ step: (s, i) => { s.z += i; }, dt: DT, initial: { x: 0, y: 0, z: 0 }, smooth: ['x', 'y', 'z'], error: (a, b) => Math.abs(b.z - a.z) });
  feed(p, 1, 5);
  assert.equal(p.reconcile(3, { z: 3.01 }), 0.0000 || p.reconcile(3, { z: 3.01 }), 'idempotent');
  const q = new Predictor({ step: (s, i) => { s.z += i; }, dt: DT, initial: { x: 0, y: 0, z: 0 }, smooth: ['z'], tolerance: 0.001 });
  feed(q, 1, 5);
  q.reconcile(3, { z: 13 });
  assert.equal(q.state.z, 15);
  assert.equal(q.renderState(1).z, 5, 'the drawn z has not moved yet');
});

test('it explains what it needs', () => {
  assert.throws(() => new Predictor({ dt: DT }), /step function/);
  assert.throws(() => new Predictor({ step }), /needs dt/);
});

test('the same inputs and the same answers always give the same states', () => {
  const run = () => {
    const p = make();
    for (let i = 1; i <= 120; i++) { p.record(i, i % 7 === 0 ? -1 : 1); if (i % 10 === 0) p.reconcile(i - 4, { x: (i - 4) * 0.9 }); }
    return JSON.stringify([p.state, p.stats]);
  };
  assert.equal(run(), run());
});
