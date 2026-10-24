import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, defineComponent } from '../../core/src/index.js';
import { PrefabLibrary, ComponentRegistry, PrefabSpawner, Transform, Parent, LocalTransform, Tags, TransformSystem, expandPaths, mergeDeep } from '../src/index.js';

const Health = defineComponent('health', { hp: 'f32', max: 'f32' });
const Team = defineComponent('team', { id: 'u8' });
const Light = defineComponent('light', { intensity: 'f32', radius: 'f32' });
const near = (a, b, eps = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);

function setup(specs = []) {
  const registry = new ComponentRegistry().add(Health).add(Team, { enums: { id: { red: 0, blue: 1 } } }).add(Light);
  const library = new PrefabLibrary(registry);
  library.define(specs);
  const world = new World(1024);
  const spawner = new PrefabSpawner(world, library);
  return { registry, library, world, spawner };
}
const f = (world, comp, id) => Object.fromEntries(comp.fields.map((k) => [k, world.data(comp)[k][id & 0xfffff]]));

const SPECS = [
  { name: 'prop', components: { transform: {}, health: { hp: 10, max: 10 } }, tags: ['prop'] },
  { name: 'crate', extends: 'prop', components: { health: { hp: 40, max: 40 } }, tags: ['breakable'], extras: { body: { shape: 'box', mass: 20 } }, params: { hp: 'components.health.hp', mass: 'extras.body.mass' } },
  { name: 'lamp', components: { light: { intensity: 1, radius: 8 } } },
  { name: 'lamppost', components: { transform: {} }, children: [{ name: 'bulb', prefab: 'lamp', local: { y: 3 } }, { name: 'base', components: { health: { hp: 100, max: 100 } }, local: { y: 0.2 } }] },
];

test('a prefab makes an entity with its components, tags and a transform; unspecified fields start at 0 (identity for transforms)', () => {
  const { world, spawner, library } = setup(SPECS);
  const inst = spawner.spawn('crate', { at: { x: 3, y: 1, z: -2 } });
  const e = inst.root;
  assert.deepEqual(f(world, Health, e), { hp: 40, max: 40 });
  const t = f(world, Transform, e);
  near(t.x, 3); near(t.y, 1); near(t.z, -2); assert.equal(t.qw, 1); assert.equal(t.sx, 1);
  assert.deepEqual(library.tagNames(world.data(Tags).bits[e & 0xfffff]).sort(), ['breakable', 'prop'], 'tags are united from the base');
  assert.equal(inst.entities.length, 1);
  assert.equal(inst.get(''), e);
});

test('extends: bases first, then own values on top, field by field; lists of bases; circles are caught', () => {
  const { library } = setup([
    { name: 'a', components: { health: { hp: 1, max: 5 } }, extras: { x: { p: 1, q: 2 } }, tags: ['t1'] },
    { name: 'b', components: { health: { hp: 2 }, light: { intensity: 3 } }, extras: { x: { q: 9 } }, tags: ['t2'] },
    { name: 'c', extends: ['a', 'b'], components: { health: { max: 7 } } },
    { name: 'loop1', extends: 'loop2' }, { name: 'loop2', extends: 'loop1' },
  ]);
  const c = library.resolve('c');
  assert.deepEqual(c.components, { health: { hp: 2, max: 7 }, light: { intensity: 3 } });
  assert.deepEqual(c.extras, { x: { p: 1, q: 9 } });
  assert.deepEqual(c.tags, ['t1', 't2']);
  assert.throws(() => library.resolve('loop1'), /extend each other in a circle: loop1 -> loop2 -> loop1/);
  assert.throws(() => library.resolve('nope'), /no prefab named "nope"/);
  c.components.health.hp = 99;
  assert.equal(library.resolve('c').components.health.hp, 2, 'resolve gives a copy: changing it changes nothing');
});

test('children: nested prefabs and inline children, with local poses, parents and world transforms', () => {
  const { world, spawner } = setup(SPECS);
  const inst = spawner.spawn('lamppost', { at: { x: 10, y: 0, z: 5, yaw: Math.PI / 2 } });
  assert.deepEqual([...inst.byPath.keys()], ['', 'bulb', 'base']);
  const bulb = inst.get('bulb'), base = inst.get('base');
  assert.deepEqual(f(world, Light, bulb), { intensity: 1, radius: 8 }, 'the child prefab brought its component');
  assert.equal(f(world, Health, base).hp, 100, 'and an inline child has its own');
  assert.equal(world.data(Parent).id[bulb & 0xfffff], inst.root);
  near(f(world, LocalTransform, bulb).y, 3);
  const w = f(world, Transform, bulb);
  near(w.x, 10); near(w.y, 3); near(w.z, 5, 1e-5, 'on the axis of the yaw: it stays above the root');
  const sys = new TransformSystem();
  const rootPos = world.data(Transform);
  rootPos.x[inst.root & 0xfffff] = 20; // move the root: children follow after the system runs
  sys.update(world);
  near(f(world, Transform, bulb).x, 20); near(f(world, Transform, base).y, 0.2);
});

test('a child offset in x follows the parent\'s rotation and scale', () => {
  const { world, spawner } = setup([{ name: 'arm', components: { transform: {} }, children: [{ name: 'hand', components: { transform: {} }, local: { x: 2 } }] }]);
  const inst = spawner.spawn('arm', { at: { x: 1, y: 0, z: 0, yaw: Math.PI / 2, scale: 2 } });
  const hand = f(world, Transform, inst.get('hand'));
  // rotated a quarter turn about y (x -> -z) and doubled: the hand is 4 m away along -z
  near(hand.x, 1, 1e-5); near(hand.z, -4, 1e-5); near(hand.sx, 2);
});

test('parameters and overrides: named knobs, dotted paths, nested objects, children by name, null removes', () => {
  const { world, spawner } = setup(SPECS);
  const a = spawner.spawn('crate', { params: { hp: 5, mass: 99 } });
  assert.equal(f(world, Health, a.root).hp, 5); assert.equal(a.spec.extras.body.mass, 99);
  const b = spawner.spawn('crate', { overrides: { 'components.health.max': 60, 'tags': ['special'] } });
  assert.equal(f(world, Health, b.root).max, 60);
  const c = spawner.spawn('lamppost', { overrides: { children: { bulb: { components: { light: { intensity: 5 } }, local: { y: 4 } } } } });
  assert.equal(f(world, Light, c.get('bulb')).intensity, 5); near(f(world, LocalTransform, c.get('bulb')).y, 4);
  assert.equal(f(world, Light, c.get('bulb')).radius, 8, 'the rest of the child prefab is intact');
  const d = spawner.spawn('lamppost', { overrides: { 'children.base': null } });
  assert.deepEqual([...d.byPath.keys()], ['', 'bulb'], 'a null child is not made');
  const e = spawner.spawn('crate', { overrides: { components: { health: null } } });
  assert.equal(world.has(e.root, Health), false, 'a null component is not added');
  assert.throws(() => spawner.spawn('crate', { params: { colour: 1 } }), /has no parameter "colour" \(it has hp, mass\)/);
  assert.throws(() => spawner.spawn('lamppost', { overrides: { children: { nope: {} } } }), /has no child "nope"/);
});

test('values may be booleans and named constants, and bad ones say exactly what is wrong', () => {
  const { library, spawner, world } = setup([{ name: 'unit', components: { team: { id: 'blue' }, health: { hp: true } } }]);
  const u = spawner.spawn('unit');
  assert.equal(world.data(Team).id[u.root & 0xfffff], 1); assert.equal(f(world, Health, u.root).hp, 1);
  library.define({ name: 'bad', components: { team: { id: 'green' }, health: { mana: 3 }, ghost: {} } });
  assert.throws(() => spawner.spawn('bad'), /team\.id: "green" is not a number or one of red, blue/);
  assert.throws(() => library.validate(), /"green" is not a number[\s\S]*no field "mana"[\s\S]*unknown component "ghost"/);
});

test('validate checks every prefab: components, fields, child prefabs, circular containment, parameters', () => {
  const { library } = setup(SPECS);
  assert.equal(library.validate(), true);
  library.define({ name: 'inner', children: [{ name: 'again', prefab: 'outer' }] });
  library.define({ name: 'outer', children: [{ name: 'in', prefab: 'inner' }, { name: 'gone', prefab: 'missing' }] });
  assert.throws(() => library.validate(), /contains itself[\s\S]*no prefab named "missing"/);
});

test('extras go to the handlers the game registered, and what they return is run when the instance is destroyed', () => {
  const { world, spawner } = setup(SPECS);
  const log = [];
  spawner.extra('body', (cfg, ctx) => { log.push(['made', cfg.mass, ctx.entity === ctx.instance.root, ctx.path]); return () => log.push(['removed']); });
  const inst = spawner.spawn('crate');
  assert.deepEqual(log, [['made', 20, true, '']]);
  spawner.on('destroy', (i) => log.push(['going', i.prefab]));
  assert.ok(world.isAlive(inst.root));
  inst.destroy();
  assert.deepEqual(log.slice(1), [['going', 'crate'], ['removed']]);
  assert.ok(!world.isAlive(inst.root)); assert.equal(inst.alive, false);
  inst.destroy(); // twice is harmless
  assert.equal(log.length, 3);
  const strict = new PrefabSpawner(new World(64), setup(SPECS).library, { strictExtras: true });
  assert.throws(() => strict.spawn('crate'), /nobody handles extras "body"/);
});

test('a failed spawn leaves nothing behind', () => {
  const { world, spawner, library } = setup([{ name: 'broken', components: { transform: {} }, children: [{ name: 'c', components: { health: { nope: 1 } } }] }]);
  const before = world.entities.highWater - world.entities.freeCount;
  assert.throws(() => spawner.spawn('broken'), /no field "nope"/);
  assert.equal(world.entities.highWater - world.entities.freeCount, before);
  void library;
});

test('destroying an instance removes children too, and ids are not reused by mistake', () => {
  const { world, spawner } = setup(SPECS);
  const inst = spawner.spawn('lamppost');
  const ids = [...inst.entities];
  assert.equal(ids.length, 3);
  inst.destroy();
  for (const id of ids) assert.ok(!world.isAlive(id));
  const again = spawner.spawn('lamppost');
  assert.ok(again.entities.every((e) => !ids.includes(e)), 'recycled slots carry a new generation');
});

test('capture gives the overrides that rebuild the same thing: changed values, added and removed components, tags, children', () => {
  const { world, spawner, library } = setup(SPECS);
  const inst = spawner.spawn('lamppost', { at: { x: 4, y: 0, z: 9 } });
  assert.deepEqual(spawner.capture(inst).overrides, { 'components.transform': { x: 4, z: 9 } }, 'only the placement differs from the prefab');
  world.data(Health).hp[inst.get('base') & 0xfffff] = 55;
  world.data(Light).intensity[inst.get('bulb') & 0xfffff] = 2.5;
  world.add(inst.root, Team, { id: 1 });
  world.data(LocalTransform).y[inst.get('bulb') & 0xfffff] = 3.5;
  const cap = spawner.capture(inst);
  assert.equal(cap.overrides['children.base.components.health'].hp, 55);
  assert.equal(cap.overrides['children.bulb.components.light'].intensity, 2.5);
  assert.deepEqual(cap.overrides['components.team'], { id: 1 });
  near(cap.overrides['children.bulb.local'].y, 3.5);
  const copy = spawner.spawn(cap.prefab, { overrides: JSON.parse(JSON.stringify(cap.overrides)) });
  assert.equal(f(world, Health, copy.get('base')).hp, 55);
  assert.equal(f(world, Light, copy.get('bulb')).intensity, 2.5);
  assert.equal(world.data(Team).id[copy.root & 0xfffff], 1);
  near(f(world, LocalTransform, copy.get('bulb')).y, 3.5);
  near(f(world, Transform, copy.root).x, 4);
  assert.deepEqual(spawner.capture(copy).overrides, cap.overrides, 'capturing the copy gives the same overrides');
  world.destroy(inst.get('base')); world.remove(inst.root, Team);
  const cap2 = spawner.capture(inst);
  assert.equal(cap2.overrides['children.base'], null, 'a destroyed child is recorded');
  assert.equal(cap2.overrides['components.team'], undefined);
  const tagged = spawner.spawn('crate'); world.data(Tags).bits[tagged.root & 0xfffff] = library.tag('prop');
  assert.deepEqual(spawner.capture(tagged).overrides.tags, ['prop']);
});

test('expandPaths and mergeDeep behave', () => {
  assert.deepEqual(expandPaths({ 'a.b.c': 1, 'a.b.d': 2, e: 3, 'a.f': { g: 4 } }), { a: { b: { c: 1, d: 2 }, f: { g: 4 } }, e: 3 });
  assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { b: 9 }, l: [3] }), { a: { b: 9, c: 2 }, l: [3] });
});

test('JSON in, JSON out: a library survives a round trip through text', () => {
  const { library } = setup(SPECS);
  const text = JSON.stringify(library.toJSON());
  const again = new PrefabLibrary(library.registry).load(JSON.parse(text));
  assert.deepEqual(again.resolve('crate'), library.resolve('crate'));
  assert.deepEqual(again.names, library.names);
  assert.throws(() => again.define({ children: [] }), /needs a name/);
  assert.throws(() => again.define({ name: 'x', children: [{ name: 'a' }, { name: 'a' }] }), /two children are called "a"/);
});

test('the transform system handles deep trees in any creation order and stops at loops', () => {
  const { world } = setup();
  const make = (parent, x) => { const e = world.create(); world.add(e, Transform, { qw: 1, sx: 1, sy: 1, sz: 1 }); if (parent !== undefined) { world.add(e, Parent, { id: parent }); world.add(e, LocalTransform, { x, qw: 1, sx: 1, sy: 1, sz: 1 }); } return e; };
  const root = make(undefined), a = make(root, 1), b = make(a, 1), c = make(b, 1);
  world.data(Transform).x[root & 0xfffff] = 10;
  new TransformSystem().update(world);
  near(world.data(Transform).x[c & 0xfffff], 13);
  const x = make(undefined), y = make(x, 1); world.add(x, Parent, { id: y }); world.add(x, LocalTransform, { x: 1, qw: 1, sx: 1, sy: 1, sz: 1 });
  assert.doesNotThrow(() => new TransformSystem().update(world), 'a parent loop does not hang');
});

test('instances have ids and are tracked while alive; an id can be chosen when loading', () => {
  const { spawner } = setup(SPECS);
  const a = spawner.spawn('crate'), b = spawner.spawn('crate');
  assert.deepEqual([a.id, b.id], [1, 2]);
  assert.deepEqual([...spawner.instances.keys()], [1, 2]);
  const c = spawner.spawn('crate', { id: 10 });
  assert.equal(spawner.spawn('crate').id, 11, 'the counter moves past a chosen id');
  assert.throws(() => spawner.spawn('crate', { id: 10 }), /already exists/);
  a.destroy();
  assert.deepEqual([...spawner.instances.keys()], [2, 10, 11]);
  assert.equal(c.id, 10);
});

test('late extras run after the part\'s children exist, so a handler can wire parts together', () => {
  const { spawner } = setup([{ name: 'rig', extras: { early: 1, wire: 2 }, children: [{ name: 'a', extras: { early: 1 } }, { name: 'b', extras: { early: 1, wire: 2 } }] }]);
  const order = [];
  spawner.extra('early', (v, { path }) => order.push(`early ${path || 'root'}`));
  spawner.extra('wire', (v, { path, instance }) => order.push(`wire ${path || 'root'} sees ${instance.byPath.size} parts`), { after: true });
  spawner.spawn('rig');
  assert.deepEqual(order, ['early root', 'early a', 'early b', 'wire b sees 3 parts', 'wire root sees 3 parts']);
});
