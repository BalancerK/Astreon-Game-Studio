import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent, INDEX_MASK, entityIndex, entityGeneration } from '../src/index.js';

const Pos = defineComponent('test:pos', { x: 'f32', y: 'f32' });
const Vel = defineComponent('test:vel', { x: 'f32', y: 'f32' });

function makeWorld() {
  const w = new World(16);
  w.register(Pos);
  w.register(Vel);
  return w;
}

test('add/has/remove and field storage', () => {
  const w = makeWorld();
  const e = w.create();
  w.add(e, Pos, { x: 1.5, y: 2 });
  assert.ok(w.has(e, Pos));
  assert.ok(!w.has(e, Vel));
  assert.equal(w.data(Pos).x[e & INDEX_MASK], 1.5);
  w.remove(e, Pos);
  assert.ok(!w.has(e, Pos));
});

test('recycled slot gets a new generation; stale ids are dead', () => {
  const w = makeWorld();
  const a = w.create();
  w.add(a, Pos, { x: 9 });
  assert.ok(w.destroy(a));
  const b = w.create();
  assert.equal(entityIndex(b), entityIndex(a));
  assert.equal(entityGeneration(b), entityGeneration(a) + 1);
  assert.ok(!w.isAlive(a));
  assert.ok(!w.has(a, Pos));
  assert.ok(!w.has(b, Pos), 'new entity must not inherit old components');
  assert.ok(!w.destroy(a), 'double destroy is a no-op');
  assert.throws(() => w.add(a, Pos), /not alive/);
});

test('add resets fields not provided', () => {
  const w = makeWorld();
  const a = w.create();
  w.add(a, Pos, { x: 5, y: 6 });
  w.remove(a, Pos);
  w.add(a, Pos, { x: 1 });
  assert.equal(w.data(Pos).y[entityIndex(a)], 0);
});

test('query returns only entities with all components', () => {
  const w = makeWorld();
  const out = new Uint32Array(16);
  const a = w.create(), b = w.create(), c = w.create();
  w.add(a, Pos); w.add(a, Vel);
  w.add(b, Pos);
  w.add(c, Pos); w.add(c, Vel);
  w.destroy(c);
  assert.deepEqual([...out.subarray(0, w.query(out, [Pos, Vel]))], [a]);
  assert.equal(w.query(out, [Pos]), 2);
});

test('capacity exhaustion throws', () => {
  const w = new World(2);
  w.create(); w.create();
  assert.throws(() => w.create(), /capacity/);
});

test('unknown component type is rejected', () => {
  assert.throws(() => defineComponent('x:y', { a: 'f16' }), /unknown type/);
});
