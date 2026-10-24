import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SteeringAgent, seek, flee, arrive, pursue, evade, wander, separation, alignment, cohesion, avoidObstacles, blend, limit, accelerate, PathFollower,
  SUCCESS, FAILURE, RUNNING, Action, Condition, Sequence, Selector, Parallel, bt, BehaviorTree, fromData, describe, canSee, canHear, Memory,
} from '../src/index.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const lcg = (seed = 1) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

test('seek, flee and arrive give the right directions and speeds', () => {
  const a = new SteeringAgent({ maxSpeed: 5 });
  const s = seek(a, 3, 4); near(s.x, 3, 1e-9); near(s.z, 4, 1e-9);
  const f = flee(a, 3, 4); near(f.x, -3, 1e-9); near(f.z, -4, 1e-9);
  assert.deepEqual(seek(a, 0, 0), { x: 0, z: 0 }, 'already there');
  near(Math.hypot(arrive(a, 30, 0, 2).x, 0), 5, 1e-9); // far away: full speed
  near(arrive(a, 1, 0, 2).x, 2.5, 1e-9, 'half way into the slow zone: half speed');
  near(arrive(a, 0.0001, 0, 2).x, 0, 0.01);
});

test('an agent that seeks a point actually gets there and stops', () => {
  const a = new SteeringAgent({ maxSpeed: 4, maxAccel: 30 });
  const d = { x: 0, z: 0 };
  for (let i = 0; i < 600; i++) {
    arrive(a, 10, 5, 2, d); accelerate(a, d, 1 / 60);
    a.x += a.vx / 60; a.z += a.vz / 60;
  }
  near(a.x, 10, 0.05); near(a.z, 5, 0.05); near(Math.hypot(a.vx, a.vz), 0, 0.05);
  const b = new SteeringAgent({ maxSpeed: 4, maxAccel: 8 });
  accelerate(b, { x: 4, z: 0 }, 0.1);
  near(b.vx, 0.8, 1e-9, 'acceleration is limited: 8 m/s2 for 0.1 s');
});

test('pursue leads a moving target, evade runs from where it will be', () => {
  const hunter = new SteeringAgent({ x: 0, z: 0, maxSpeed: 6 });
  const target = { x: 10, z: 0, vx: 0, vz: 3 };
  const p = pursue(hunter, target);
  assert.ok(p.z > 0 && p.x > 0, 'aims ahead of it, not at it');
  const chase = new SteeringAgent({ x: 0, z: 0, maxSpeed: 6 }), prey = { x: 10, z: 0, vx: 0, vz: 3 };
  let caught = false;
  for (let i = 0; i < 600 && !caught; i++) { const v = pursue(chase, prey); chase.x += v.x / 60; chase.z += v.z / 60; prey.z += prey.vz / 60; caught = Math.hypot(chase.x - prey.x, chase.z - prey.z) < 0.3; }
  assert.ok(caught, 'a faster pursuer catches it');
  const e = evade(hunter, target); assert.ok(e.x < 0, 'runs the other way');
});

test('wander changes heading slowly and is reproducible with a seeded generator', () => {
  const run = (seed) => { const a = new SteeringAgent({ maxSpeed: 5 }), st = { dx: 1, dz: 0 }, rng = lcg(seed), out = []; for (let i = 0; i < 100; i++) { const v = wander(a, st, rng, 0.2); out.push(v.x, v.z); } return out; };
  assert.deepEqual(run(3), run(3)); assert.notDeepEqual(run(3), run(4));
  const a = new SteeringAgent({ maxSpeed: 5 }), st = { dx: 1, dz: 0 };
  let last = null, maxTurn = 0;
  const rng = lcg(5);
  for (let i = 0; i < 200; i++) { const v = wander(a, st, rng, 0.1); const h = Math.atan2(v.z, v.x); if (last !== null) { let d = Math.abs(h - last); if (d > Math.PI) d = 2 * Math.PI - d; maxTurn = Math.max(maxTurn, d); } last = h; }
  assert.ok(maxTurn < 0.5, `it does not jitter: ${maxTurn}`);
  const w = wander(a, st, lcg(1)); near(Math.hypot(w.x, w.z), 3, 1e-9, 'walks at 60% of top speed');
});

test('flocking: separation pushes apart, cohesion pulls together, alignment matches headings', () => {
  const a = new SteeringAgent({ x: 0, z: 0, maxSpeed: 4 });
  const near1 = { x: 0.5, z: 0, radius: 0.4 }, far = { x: 20, z: 0, radius: 0.4 };
  assert.ok(separation(a, [near1]).x < 0, 'pushed away from the one on its right');
  assert.deepEqual(separation(a, [far]), { x: 0, z: 0 }, 'ignores the far one');
  assert.ok(cohesion(a, [far]).x > 0);
  const al = alignment(a, [{ x: 1, z: 1, vx: 2, vz: 0 }, { x: 2, z: 2, vx: 4, vz: 2 }]);
  near(al.x, 3, 1e-9); near(al.z, 1, 1e-9);
  const crowd = Array.from({ length: 12 }, (_, i) => new SteeringAgent({ x: (i % 4) * 0.3, z: Math.floor(i / 4) * 0.3, maxSpeed: 2, radius: 0.3 }));
  for (let step = 0; step < 300; step++) for (const c of crowd) { const v = separation(c, crowd, 1); accelerate(c, v, 1 / 60); c.x += c.vx / 60; c.z += c.vz / 60; }
  let closest = Infinity; for (const c of crowd) for (const o of crowd) if (c !== o) closest = Math.min(closest, Math.hypot(c.x - o.x, c.z - o.z));
  assert.ok(closest > 0.8, `the crowd spreads out: ${closest}`);
});

test('obstacle avoidance swerves to a clear side and backs off when boxed in', () => {
  const a = new SteeringAgent({ x: 0, z: 0, maxSpeed: 4 }); a.vx = 4; a.vz = 0;
  const wall = (x0, z0, x1, z1) => { // a wall at x = 2 from z = -1 to 5
    if (x0 === x1) return false; const t = (2 - x0) / (x1 - x0); if (t < 0 || t > 1) return false; const z = z0 + (z1 - z0) * t; return z > -1 && z < 5;
  };
  assert.deepEqual(avoidObstacles(a, () => false), { x: 0, z: 0 }, 'free: no correction');
  const v = avoidObstacles(a, wall);
  assert.ok(v.z < 0 && v.x > 0, `swerves to the clear side (negative z): ${JSON.stringify(v)}`);
  const boxed = avoidObstacles(a, () => true);
  assert.ok(boxed.x < 0, 'boxed in: backs off');
});

test('blend adds weighted desires and limits them to top speed', () => {
  const a = new SteeringAgent({ maxSpeed: 4 });
  const v = blend(a, [[{ x: 4, z: 0 }, 1], [{ x: 0, z: 4 }, 1]]);
  near(Math.hypot(v.x, v.z), 4, 1e-9);
  assert.deepEqual(limit({ x: 3, z: 4 }, 10), { x: 3, z: 4 });
});

test('a path follower walks a path, slows at the end, finishes, and notices when it is stuck', () => {
  const path = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }];
  const a = new SteeringAgent({ maxSpeed: 4, maxAccel: 40 });
  const f = new PathFollower(path), d = { x: 0, z: 0 };
  near(f.remaining(a), 20, 1e-9);
  let t = 0;
  while (!f.done && t < 20) { f.desired(a, 1 / 60, d); accelerate(a, d, 1 / 60); a.x += a.vx / 60; a.z += a.vz / 60; t += 1 / 60; }
  assert.ok(f.done && t < 9, `arrived in ${t.toFixed(1)} s`);
  near(a.x, 10, 0.5); near(a.z, 10, 0.5);
  assert.equal(f.remaining(a), 0);
  const stuckAgent = new SteeringAgent({ maxSpeed: 4 }), s = new PathFollower(path, { stuckTime: 0.5 });
  for (let i = 0; i < 60; i++) s.desired(stuckAgent, 1 / 60, d); // it never moves
  assert.ok(s.stuck, 'no progress: stuck');
  s.set(path); assert.ok(!s.stuck, 'a new path clears it');
  assert.equal(new PathFollower([]).done, true);
});

// ------------------------------------------------------------------ behaviour trees
const run = (root, ticks = 1, { dt = 0.1, bb = {}, rng } = {}) => { const tree = new BehaviorTree(root, { bb, rng }); const out = []; for (let i = 0; i < ticks; i++) out.push(tree.tick(dt)); return { tree, out }; };

test('sequence needs every child; selector takes the first that works', () => {
  const log = [];
  const ok = (n) => bt.action(() => { log.push(n); return SUCCESS; }), bad = (n) => bt.action(() => { log.push(n); return FAILURE; });
  assert.equal(run(bt.sequence(ok('a'), ok('b'))).out[0], SUCCESS);
  assert.equal(run(bt.sequence(ok('c'), bad('d'), ok('e'))).out[0], FAILURE); assert.ok(!log.includes('e'));
  log.length = 0;
  assert.equal(run(bt.selector(bad('1'), ok('2'), ok('3'))).out[0], SUCCESS); assert.deepEqual(log, ['1', '2']);
  assert.equal(run(bt.selector(bad('x'), bad('y'))).out[0], FAILURE);
  assert.equal(run(bt.sequence()).out[0], SUCCESS, 'an empty sequence succeeds');
});

test('a running child is resumed, not restarted, by a sequence (and the earlier children are not run again)', () => {
  let a = 0, b = 0, finish = false;
  const tree = new BehaviorTree(bt.sequence(bt.action(() => { a++; }), bt.action(() => { b++; return finish ? SUCCESS : RUNNING; })));
  assert.equal(tree.tick(0.1), RUNNING); assert.equal(tree.tick(0.1), RUNNING);
  assert.deepEqual([a, b], [1, 2]);
  finish = true;
  assert.equal(tree.tick(0.1), SUCCESS); assert.deepEqual([a, b], [1, 3]);
  assert.equal(tree.tick(0.1), SUCCESS); assert.deepEqual([a, b], [2, 4], 'a finished sequence starts over');
});

test('a selector lets a higher priority behaviour interrupt a lower one that is running, and resets the interrupted branch', () => {
  let danger = false, resets = 0;
  const flee = bt.reactiveSequence(bt.condition(() => danger), bt.action(() => RUNNING)); // re-checks its condition every tick
  const patrolWait = bt.wait(10);
  const tree = new BehaviorTree(bt.selector(flee, patrolWait));
  tree.tick(1); tree.tick(1);
  assert.ok(tree.ctx.mem[patrolWait.id].t >= 2, 'patrolling (waiting)');
  danger = true; tree.tick(1);
  assert.equal(tree.ctx.mem[patrolWait.id], undefined, 'the interrupted wait forgot its timer');
  danger = false; tree.tick(1);
  assert.ok(tree.ctx.mem[patrolWait.id].t === 1, 'and starts again from zero');
  assert.equal(resets, 0);
});

test('wait, repeat, retry, cooldown, timeout, inverter, always', () => {
  assert.deepEqual(run(bt.wait(0.35), 5).out, [RUNNING, RUNNING, RUNNING, SUCCESS, RUNNING]);
  let n = 0;
  const counted = run(bt.repeat(bt.action(() => { n++; }), 3), 4).out;
  assert.deepEqual(counted, [RUNNING, RUNNING, SUCCESS, RUNNING]); assert.equal(n, 4);
  let tries = 0;
  assert.deepEqual(run(bt.retry(bt.action(() => { tries++; return tries < 3 ? FAILURE : SUCCESS; }), 5), 3).out, [RUNNING, RUNNING, SUCCESS]);
  assert.deepEqual(run(bt.retry(bt.action(() => FAILURE), 2), 2).out, [RUNNING, FAILURE]);
  let shots = 0;
  const cd = run(bt.cooldown(bt.action(() => { shots++; }), 0.35), 8).out;
  assert.deepEqual(cd, [SUCCESS, FAILURE, FAILURE, FAILURE, SUCCESS, FAILURE, FAILURE, FAILURE]); assert.equal(shots, 2);
  assert.deepEqual(run(bt.timeout(bt.action(() => RUNNING), 0.25), 4).out, [RUNNING, RUNNING, FAILURE, RUNNING]);
  assert.equal(run(bt.not(bt.action(() => FAILURE))).out[0], SUCCESS);
  assert.equal(run(bt.always(bt.action(() => FAILURE))).out[0], SUCCESS);
  assert.equal(run(bt.not(bt.action(() => RUNNING))).out[0], RUNNING);
});

test('parallel runs everything each tick under an all or one policy', () => {
  const calls = [0, 0];
  const all = bt.parallel('all', bt.action(() => { calls[0]++; return SUCCESS; }), bt.action(() => { calls[1]++; return RUNNING; }));
  assert.equal(run(all, 2).out[1], RUNNING); assert.deepEqual(calls, [2, 2]);
  assert.equal(run(bt.parallel('one', bt.action(() => RUNNING), bt.action(() => SUCCESS))).out[0], SUCCESS);
  assert.equal(run(bt.parallel('all', bt.action(() => FAILURE), bt.action(() => RUNNING))).out[0], FAILURE);
});

test('random selection follows the weights and sticks with a running choice', () => {
  const counts = [0, 0, 0];
  const node = bt.random([1, 3, 0], bt.action(() => { counts[0]++; }), bt.action(() => { counts[1]++; }), bt.action(() => { counts[2]++; }));
  const tree = new BehaviorTree(node, { rng: lcg(7) });
  for (let i = 0; i < 4000; i++) tree.tick(0.1);
  assert.equal(counts[2], 0);
  assert.ok(counts[1] > counts[0] * 2.4 && counts[1] < counts[0] * 3.8, `about 3 to 1: ${counts}`);
  let a = 0;
  const sticky = new BehaviorTree(bt.random(null, bt.action(() => { a++; return a < 5 ? RUNNING : SUCCESS; }), bt.action(() => FAILURE)), { rng: lcg(2) });
  const seen = new Set(); for (let i = 0; i < 4; i++) seen.add(sticky.tick(0.1));
  assert.ok(seen.size === 1, 'a running child keeps running (no re-roll in between)');
});

test('a guard stops its child when its condition stops holding', () => {
  let ok = true, started = 0;
  const tree = new BehaviorTree(bt.guard(() => ok, bt.sequence(bt.action(() => { started++; }), bt.wait(5))));
  tree.tick(1); tree.tick(1);
  assert.equal(started, 1);
  ok = false; assert.equal(tree.tick(1), FAILURE);
  ok = true; tree.tick(1); assert.equal(started, 2, 'and restarts from the beginning when it holds again');
});

test('many agents can share one tree definition without sharing state', () => {
  const root = bt.sequence(bt.action((ctx) => { ctx.bb.count = (ctx.bb.count ?? 0) + 1; }), bt.wait(0.25), bt.action((ctx) => { ctx.bb.done = true; }));
  const a = new BehaviorTree(root), b = new BehaviorTree(root);
  a.tick(0.1); a.tick(0.1); a.tick(0.1);
  b.tick(0.1);
  assert.equal(a.bb.done, true); assert.equal(b.bb.done, undefined); assert.equal(b.bb.count, 1);
  b.reset(); b.tick(0.1); assert.equal(b.bb.count, 2, 'reset starts over');
});

test('trees can be built from plain data with named functions, and a missing name is a clear error', () => {
  const calls = [];
  const registry = { hungry: (c) => c.bb.hungry, eat: () => { calls.push('eat'); }, wander: () => { calls.push('wander'); } };
  const spec = { type: 'selector', children: [{ type: 'sequence', children: [{ type: 'condition', name: 'hungry' }, { type: 'action', name: 'eat' }] }, { type: 'action', name: 'wander' }] };
  const tree = new BehaviorTree(fromData(JSON.parse(JSON.stringify(spec)), registry), { bb: { hungry: false } });
  tree.tick(0.1); tree.bb.hungry = true; tree.tick(0.1);
  assert.deepEqual(calls, ['wander', 'eat']);
  assert.throws(() => fromData({ type: 'action', name: 'nope' }, registry), /no function named "nope"/);
  assert.throws(() => fromData({ type: 'dance' }, registry), /unknown node type "dance"/);
  assert.match(describe(fromData(spec, registry)), /Selector[\s\S]*Sequence[\s\S]*Condition hungry/);
});

// ------------------------------------------------------------------ perception
test('sight needs range, the field of view and a clear line', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  const see = (t, o) => canSee(eye, 0, -1, t, { range: 30, cosFov: Math.cos(0.9), ...o });
  assert.ok(see({ x: 0, y: 1, z: -10 }), 'straight ahead');
  assert.ok(!see({ x: 0, y: 1, z: 10 }), 'behind');
  assert.ok(!see({ x: 8, y: 1, z: -2 }), 'out of the cone to the side');
  assert.ok(!see({ x: 0, y: 1, z: -40 }), 'too far');
  assert.ok(!see({ x: 0, y: 1, z: -10 }, { blocked: () => true }), 'a wall in the way');
  assert.ok(see({ x: 0.2, y: 1, z: 0.1 }), 'something right beside you is always seen');
});

test('hearing depends on loudness and distance', () => {
  const l = { x: 0, y: 0, z: 0 };
  assert.ok(canHear(l, { x: 10, z: 0, loudness: 20 }));
  assert.ok(!canHear(l, { x: 30, z: 0, loudness: 20 }));
  assert.ok(canHear(l, { x: 30, z: 0, loudness: 20 }, { sensitivity: 2 }), 'sharper ears');
  assert.ok(!canHear(l, { x: 15, z: 0, loudness: 20 }, { muffled: () => true }), 'a wall halves the range');
});

test('memory remembers where something was seen, ages, extrapolates, and forgets', () => {
  const m = new Memory(5);
  m.see('enemy', 10, 0, 4, 2, 0);
  m.update(1);
  const g = m.guess('enemy'); near(g.x, 12, 1e-9); near(g.z, 4, 1e-9);
  m.update(3); near(m.guess('enemy', 1.5).x, 13, 1e-9, 'it does not extrapolate for ever');
  m.suspect('noise', 0, 0, 0);
  assert.equal(m.freshest().id, 'noise'); assert.equal(m.get('noise').seen, false);
  m.update(2);
  assert.equal(m.get('enemy'), null, 'forgotten after 5 s'); assert.ok(m.get('noise'));
  m.see('noise', 1, 0, 1); assert.equal(m.get('noise').seen, true);
  m.suspect('noise', 9, 0, 9); assert.equal(m.get('noise').x, 1, 'a fresh sighting is not overwritten by a mere suspicion');
});

test('a tree and a memory can be saved in the middle of what they are doing and carry on in a rebuilt tree', () => {
  const build = () => bt.sequence(bt.action((c) => { c.bb.steps = (c.bb.steps ?? 0) + 1; }), bt.wait(1), bt.cooldown(bt.action((c) => { c.bb.shots = (c.bb.shots ?? 0) + 1; }), 5), bt.wait(0.5));
  const a = new BehaviorTree(build(), { bb: { hp: 40, agent: { big: 'object' } } });
  a.tick(0.25); a.tick(0.25);
  const saved = JSON.parse(JSON.stringify(a.save(['hp', 'steps'])));
  assert.equal(saved.bb.hp, 40); assert.ok(!('agent' in saved.bb), 'only the named blackboard entries');
  const b = new BehaviorTree(build(), { bb: {} }).load(saved);
  assert.equal(b.bb.steps, 1);
  for (let i = 0; i < 7; i++) { a.tick(0.25); b.tick(0.25); }
  assert.equal(b.status, a.status); assert.equal(b.bb.shots, a.bb.shots);
  assert.throws(() => new BehaviorTree(bt.action(() => {})).load(saved), /does not fit this tree/);
  const m = new Memory(10); m.see('p', 1, 2, 3, 4, 5); m.update(2);
  const m2 = new Memory(10).load(JSON.parse(JSON.stringify(m.save())));
  assert.deepEqual(m2.get('p'), m.get('p')); assert.equal(m2.freshest().age, 2);
});
