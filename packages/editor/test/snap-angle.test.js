import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapAngle } from '../src/snap.js';

const yawQ = (deg) => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
const rad = (d) => (d * Math.PI) / 180;
const UP = [0, 1, 0];
const WORLD = [yawQ(0)];
const close = (a, b) => Math.abs(a - b) < 1e-9;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('a turn about the upright axis snaps so the sides run parallel to the world: a few degrees off a quarter turn is a quarter turn', () => {
  assert.ok(close(snapAngle(UP, yawQ(0), rad(4), WORLD, { threshold: rad(6) }).angle, 0), '4 degrees: back to straight');
  assert.ok(close(snapAngle(UP, yawQ(0), rad(87), WORLD, { threshold: rad(6) }).angle, rad(90)), '87 degrees: a quarter turn');
  assert.ok(close(snapAngle(UP, yawQ(0), rad(-93), WORLD, { threshold: rad(6) }).angle, rad(-90)), 'the other way round');
  assert.ok(close(snapAngle(UP, yawQ(0), rad(178), WORLD, { threshold: rad(6) }).angle, rad(180)), 'and a half turn');
  assert.equal(snapAngle(UP, yawQ(0), rad(20), WORLD, { threshold: rad(6) }), null, 'twenty degrees from any side: nothing');
});

test('it starts from where the thing was: something already turned lines up with the world from there', () => {
  const out = snapAngle(UP, yawQ(30), rad(58), WORLD, { threshold: rad(6) });
  assert.ok(close(out.angle, rad(60)), '30 degrees and 60 more is 90: a quarter turn in all');
});

test('it also lines up with another object that is turned: its sides, and the sides a quarter turn on', () => {
  const targets = [yawQ(0), yawQ(30)];
  const out = snapAngle(UP, yawQ(0), rad(28), targets, { threshold: rad(6) });
  assert.ok(close(out.angle, rad(30)), 'parallel to the neighbour that is turned 30 degrees');
  assert.equal(out.target, 1, 'and it says which one it met');
  assert.ok(close(snapAngle(UP, yawQ(0), rad(118), targets, { threshold: rad(6) }).angle, rad(120)), 'its sides a quarter turn on count too');
  assert.ok(Math.abs(dot(out.to, out.from)) > 1 - 1e-9, 'the side of the thing and the side of the target are parallel after the turn');
});

test('the nearest of the possible angles wins', () => {
  const both = snapAngle(UP, yawQ(0), rad(28), [yawQ(35), yawQ(27)], { threshold: rad(8) });
  assert.ok(close(both.angle, rad(27)));
  assert.equal(both.target, 1);
});

test('a turn about a sideways axis works the same way, and a side that points along the axis cannot decide anything', () => {
  const tipped = [Math.sin(rad(2) / 2), 0, 0, Math.cos(rad(2) / 2)];                     // an object tipped 2 degrees about x
  const out = snapAngle([1, 0, 0], tipped, rad(87), WORLD, { threshold: rad(6) });
  assert.ok(close(out.angle, rad(88)), 'two degrees tipped and 88 more is a quarter turn');
  assert.equal(snapAngle(UP, yawQ(0), rad(2), [], { threshold: rad(6) }), null, 'nothing to meet');
  const lying = snapAngle(UP, yawQ(0), rad(2), [[0, 0, Math.SQRT1_2, Math.SQRT1_2]], { threshold: rad(6) });          // a target lying on its side
  assert.ok(lying === null || Number.isFinite(lying.angle), 'its upright side lies along the axis and is left out; the others still work or nothing happens');
});
