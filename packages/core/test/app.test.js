import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, Scheduler, definePlugin, resolvePlugins, satisfies } from '../src/index.js';

const plug = (id, deps = {}, setup = () => {}, extra = {}) =>
  definePlugin({ id, version: '1.0.0', dependencies: deps, setup, ...extra });

test('scheduler honours before/after, stays stable, ignores absent names', () => {
  const s = new Scheduler();
  const log = [];
  s.add('c', () => log.push('c'), { after: ['b'] });
  s.add('a', () => log.push('a'), { before: ['render-not-installed'] });
  s.add('b', () => log.push('b'), { after: ['a'] });
  s.run();
  assert.deepEqual(log, ['a', 'b', 'c']);
});

test('scheduler reports cycles', () => {
  const s = new Scheduler();
  s.add('a', () => {}, { after: ['b'] });
  s.add('b', () => {}, { after: ['a'] });
  assert.throws(() => s.order(), /cycle.*a, b/);
});

test('semver ranges', () => {
  assert.ok(satisfies('1.2.3', '^1.0.0'));
  assert.ok(!satisfies('2.0.0', '^1.0.0'));
  assert.ok(satisfies('0.1.5', '^0.1.0'));
  assert.ok(!satisfies('0.2.0', '^0.1.0'));
  assert.ok(satisfies('1.0.0', '>=0.9.0'));
  assert.ok(satisfies('9.9.9', '*'));
  assert.throws(() => satisfies('1.0', '*x'), /invalid version/);
});

test('resolver orders dependencies first and reports problems clearly', () => {
  const a = plug('a', { b: '^1.0.0' });
  const b = plug('b');
  assert.deepEqual(resolvePlugins([a, b], '0.0.1').map((p) => p.id), ['b', 'a']);
  assert.throws(() => resolvePlugins([a], '0.0.1'), /missing plugin "b"/);
  assert.throws(() => resolvePlugins([plug('a', { b: '^2.0.0' }), b], '0.0.1'), /needs "b" \^2\.0\.0, found 1\.0\.0/);
  assert.throws(() => resolvePlugins([plug('x', {}, () => {}, { engine: '^9.0.0' })], '0.0.1'), /requires engine/);
  assert.throws(() => resolvePlugins([plug('p', { q: '*' }), plug('q', { p: '*' })], '0.0.1'), /cycle: p -> q -> p/);
  assert.throws(() => definePlugin({ id: 'Bad Id', version: '1.0.0', setup() {} }), /invalid plugin id/);
});

test('plugins namespace components/systems and cooperate via events and resources', () => {
  const app = new App({ capacity: 8 });
  const seen = [];
  const movement = plug('movement', {}, (p) => {
    const Pos = p.defineComponent('pos', { x: 'f32' });
    p.setResource('pos-component', Pos);
    p.addSystem('step', (dt) => {
      const x = p.world.data(Pos).x;
      x[0] += dt;
      p.emit('moved', x[0]);
    });
  });
  const logger = plug('logger', { movement: '^1.0.0' }, (p) => {
    p.events.on('movement:moved', (v) => seen.push(v));
    p.addSystem('late', () => seen.push('late'), { after: ['movement:step'] });
  });
  app.use(logger, movement); // order given by the caller does not matter
  const Pos = app.components.get('movement:pos');
  assert.ok(Pos);
  const e = app.world.create();
  app.world.add(e, Pos, { x: 1 });
  app.update(0.5, 0);
  assert.deepEqual(seen, [1.5, 'late']);
  assert.equal(app.resources.get('movement:pos-component'), Pos);
});

test('duplicate component names across plugins are rejected', () => {
  const app = new App({ capacity: 4 });
  assert.throws(
    () => app.use(plug('a', {}, (p) => { p.defineComponent('c', { v: 'u8' }); p.defineComponent('c', { v: 'u8' }); })),
    /duplicate component "a:c"/,
  );
});
