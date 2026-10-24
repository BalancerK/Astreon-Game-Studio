import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateMachine, machineFromData } from '../src/index.js';

const log = () => { const l = []; return { l, f: (s) => () => l.push(s) }; };

test('a machine starts in its initial state, runs enter / update / exit, and follows when-transitions in priority order', () => {
  const { l } = log();
  const ctx = { speed: 0, hp: 10 };
  const m = new StateMachine({
    initial: 'idle',
    states: {
      idle: { enter: () => l.push('+idle'), exit: () => l.push('-idle'), update: () => l.push('~idle'), transitions: [{ to: 'walk', when: (c) => c.speed > 0.1 }, { to: 'run', when: (c) => c.speed > 5, priority: 5 }] },
      walk: { enter: (c, mm, from) => l.push(`+walk from ${from}`), transitions: [{ to: 'idle', when: (c) => c.speed <= 0.1 }] },
      run: { enter: () => l.push('+run') },
    },
  });
  m.update(0.1, ctx);
  assert.equal(m.state, 'idle'); assert.deepEqual(l, ['+idle', '~idle']);
  ctx.speed = 7; l.length = 0;
  m.update(0.1, ctx);
  assert.equal(m.state, 'run', 'the higher priority transition wins although walk is listed first');
  assert.deepEqual(l, ['-idle', '+run']);
  ctx.speed = 0.5; m.update(0.1, ctx);
  assert.equal(m.state, 'run', 'run has no way out');
});

test('after, minTime and time in state', () => {
  const m = new StateMachine({ initial: 'a', states: { a: { transitions: [{ to: 'b', after: 1 }] }, b: { transitions: [{ to: 'c', when: () => true, minTime: 0.5 }] }, c: {} } });
  const ctx = {};
  for (let i = 0; i < 7; i++) m.update(0.125, ctx);
  assert.equal(m.state, 'a'); near(m.time, 0.875);
  m.update(0.125, ctx); assert.equal(m.state, 'b'); near(m.time, 0);
  for (let i = 0; i < 3; i++) m.update(0.125, ctx);
  assert.equal(m.state, 'b', 'minTime holds it');
  m.update(0.125, ctx); m.update(0.125, ctx);
  assert.equal(m.state, 'c');
});
function near(a, b, eps = 1e-9) { assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`); }

test('events: send takes the matching transition now, returns whether it did, and respects guards; on is the shorthand', () => {
  const ctx = { stunProof: false };
  const m = new StateMachine({
    initial: 'ok',
    states: {
      ok: { transitions: [{ to: 'stunned', event: 'hit', when: (c) => !c.stunProof }], on: { heal: 'ok', die: 'dead' } },
      stunned: { on: { recover: 'ok' } },
      dead: {},
    },
  });
  assert.equal(m.send('nothing', ctx), false);
  ctx.stunProof = true; assert.equal(m.send('hit', ctx), false); assert.equal(m.state, 'ok');
  ctx.stunProof = false; assert.equal(m.send('hit', ctx), true); assert.equal(m.state, 'stunned');
  assert.equal(m.send('recover', ctx), true); assert.equal(m.state, 'ok');
  m.send('die', ctx); assert.equal(m.state, 'dead');
  assert.equal(m.send('recover', ctx), false, 'not in a state that handles it');
});

test('posted events are handled at the end of the next update, in order; events do not trigger when-transitions and vice versa', () => {
  const l = [];
  const m = new StateMachine({ initial: 'a', states: { a: { on: { go: 'b' } }, b: { on: { go: 'c' }, update: () => l.push('b') }, c: { update: () => l.push('c') } } });
  m.post('go'); m.post('go');
  m.update(0.1, {});
  assert.equal(m.state, 'c');
  assert.deepEqual(l, [], 'the updates ran before the queue');
  const m2 = new StateMachine({ initial: 'a', states: { a: { transitions: [{ to: 'b', event: 'x', when: () => true }] }, b: {} } });
  m2.update(0.1, {}); assert.equal(m2.state, 'a', 'an event transition is not taken by plain updates');
});

test('actions run between exit and enter; reenter restarts the state; self transitions are otherwise ignored', () => {
  const { l } = log();
  const m = new StateMachine({ initial: 'a', states: { a: { enter: () => l.push('+a'), exit: () => l.push('-a'), on: { again: { to: 'a', reenter: true, action: () => l.push('action') }, noop: 'a' } } } });
  m.send('noop', {}); assert.deepEqual(l, ['+a']);
  m.send('again', {}); assert.deepEqual(l, ['+a', '-a', 'action', '+a']);
});

test('from-any transitions apply in every state and beat nothing but higher priorities', () => {
  const ctx = { hp: 10 };
  const m = new StateMachine({
    initial: 'a', any: [{ to: 'dead', when: (c) => c.hp <= 0, priority: 100 }],
    states: { a: { transitions: [{ to: 'b', when: () => true }] }, b: {}, dead: { transitions: [{ to: 'a', when: () => false }] } },
  });
  m.update(0.1, ctx); assert.equal(m.state, 'b');
  ctx.hp = 0; m.update(0.1, ctx); assert.equal(m.state, 'dead');
  m.update(0.1, ctx); assert.equal(m.state, 'dead', 'and a transition to the state you are in is not taken');
});

test('nested machines: enter and exit in order, paths, parent transitions take precedence, the child handles its own events first', () => {
  const { l } = log();
  const ctx = { ammo: 3, danger: false };
  const m = new StateMachine({
    initial: 'patrol',
    states: {
      patrol: { enter: () => l.push('+patrol'), exit: () => l.push('-patrol'), transitions: [{ to: 'combat', when: (c) => c.danger }] },
      combat: {
        enter: () => l.push('+combat'), exit: () => l.push('-combat'),
        transitions: [{ to: 'patrol', when: (c) => !c.danger }],
        machine: {
          initial: 'aim',
          states: {
            aim: { enter: () => l.push('+aim'), exit: () => l.push('-aim'), on: { fire: 'reload', jam: '../patrol' }, update: (c) => l.push('~aim') },
            reload: { enter: () => l.push('+reload'), exit: () => l.push('-reload'), transitions: [{ to: 'aim', after: 1 }] },
          },
        },
      },
    },
  });
  m.update(0.1, ctx);
  assert.equal(m.path, 'patrol');
  ctx.danger = true; l.length = 0;
  m.update(0.1, ctx);
  assert.equal(m.path, 'combat/aim'); assert.deepEqual(l, ['-patrol', '+combat', '+aim', '~aim']);
  assert.ok(m.is('combat') && m.is('combat/aim') && !m.is('combat/reload') && !m.is('patrol'));
  l.length = 0;
  assert.equal(m.send('fire', ctx), true); assert.equal(m.path, 'combat/reload'); assert.deepEqual(l, ['-aim', '+reload']);
  for (let i = 0; i < 11; i++) m.update(0.1, ctx);
  assert.equal(m.path, 'combat/aim', 'the child\'s own timer');
  l.length = 0;
  ctx.danger = false; m.update(0.1, ctx);
  assert.equal(m.path, 'patrol'); assert.deepEqual(l.slice(0, 3), ['-aim', '-combat', '+patrol'], 'leaving a parent exits the child first');
  ctx.danger = true; m.update(0.1, ctx);
  assert.equal(m.send('jam', ctx), true, '"../patrol" moves the outer machine');
  assert.equal(m.path, 'patrol');
});

test('going to a nested path directly, and history', () => {
  const ctx = {};
  const m = new StateMachine({
    initial: 'idle',
    states: {
      idle: { on: { fight: 'combat/reload', fightAgain: { to: 'combat', history: true }, calm: 'idle' } },
      combat: { on: { stop: 'idle' }, machine: { initial: 'aim', states: { aim: {}, reload: { on: { done: 'aim' } } } } },
    },
  });
  m.start(ctx);
  m.send('fight', ctx); assert.equal(m.path, 'combat/reload');
  m.send('stop', ctx); assert.equal(m.path, 'idle');
  m.send('fightAgain', ctx); assert.equal(m.path, 'combat/reload', 'history returns to where the child was');
  m.send('stop', ctx);
  m.send('fight', ctx); m.send('done', ctx); m.send('stop', ctx);
  m.send('fightAgain', ctx); assert.equal(m.path, 'combat/aim');
  assert.throws(() => m.go(ctx, 'idle/inside'), /has no machine inside it/);
  assert.throws(() => m.go(ctx, '../x'), /goes above the top machine/);
  assert.throws(() => m.go(ctx, 'nowhere'), /no state "nowhere"/);
});

test('a loop of instant transitions is caught instead of hanging', () => {
  const m = new StateMachine({ initial: 'a', states: { a: { transitions: [{ to: 'b', when: () => true }] }, b: { transitions: [{ to: 'a', when: () => true }] } } });
  assert.throws(() => m.update(0.1, {}), /more than 16 transitions in one update/);
});

test('onTransition reports every change with the event that caused it', () => {
  const seen = [];
  const m = new StateMachine({ initial: 'a', states: { a: { on: { go: 'b' }, transitions: [{ to: 'c', when: (c) => c.x }] }, b: {}, c: {} } });
  m.onTransition = (from, to, event) => seen.push([from, to, event]);
  m.send('go', {});
  assert.deepEqual(seen, [['a', 'b', 'go']]);
});

test('save and load put a nested machine back exactly: state path, times, memory, history', () => {
  const cfg = () => ({ initial: 'a', states: { a: { on: { go: 'b' } }, b: { machine: { initial: 'x', states: { x: { on: { next: 'y' } }, y: { transitions: [{ to: 'x', after: 2 }] } } }, on: { back: 'a' } } } });
  const ctx = {};
  const m = new StateMachine(cfg());
  m.send('go', ctx); m.send('next', ctx); m.data.score = 7; m.child.data.n = 3;
  m.update(0.5, ctx);
  const saved = JSON.parse(JSON.stringify(m.save()));
  const m2 = new StateMachine(cfg()).load(saved);
  assert.equal(m2.path, 'b/y'); assert.equal(m2.data.score, 7); assert.equal(m2.child.data.n, 3);
  near(m2.child.time, 0.5);
  for (let i = 0; i < 16; i++) m2.update(0.1, ctx);
  assert.equal(m2.path, 'b/x', 'the restored timer carries on (0.5 s done, 1.5 s to go)');
  assert.throws(() => new StateMachine({ initial: 'q', states: { q: {} } }).load(saved), /saved state "b" does not exist/);
});

test('describe gives a readable outline', () => {
  const m = new StateMachine({ initial: 'idle', any: [{ to: 'dead', when: () => false }], states: { idle: { transitions: [{ to: 'run', when: () => false }], on: { hit: 'dead' } }, run: { transitions: [{ to: 'idle', after: 2 }] }, dead: {} } });
  const d = m.describe();
  assert.match(d, /idle \(initial\) -> run, dead on hit/); assert.match(d, /run -> idle after 2s/); assert.match(d, /from any: dead/);
});

test('bad configurations are rejected up front', () => {
  assert.throws(() => new StateMachine({ initial: 'x', states: { a: {} } }), /initial state "x" is not one of a/);
  assert.throws(() => new StateMachine({ initial: 'a', states: { a: { transitions: [{ when: () => true }] } } }), /needs "to"/);
});

test('machines can be defined as data with named functions', () => {
  const calls = [];
  const registry = { fast: (c) => c.speed > 5, play: (c, m) => calls.push(`play ${m.state}`), stop: () => calls.push('stop'), log: () => calls.push('action') };
  const spec = JSON.parse(JSON.stringify({ initial: 'slow', states: { slow: { enter: 'play', transitions: [{ to: 'quick', when: 'fast', action: 'log' }] }, quick: { enter: 'play', exit: 'stop' } } }));
  const m = machineFromData(spec, registry);
  const ctx = { speed: 1 };
  m.update(0.1, ctx); ctx.speed = 9; m.update(0.1, ctx);
  assert.equal(m.state, 'quick'); assert.deepEqual(calls, ['play slow', 'action', 'play quick']);
  assert.throws(() => machineFromData({ initial: 'a', states: { a: { enter: 'missing' } } }, registry), /no function named "missing"/);
});
