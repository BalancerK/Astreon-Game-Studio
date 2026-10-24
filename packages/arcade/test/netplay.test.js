import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lockstep, keyList, setNetInfo, me, playerCount, isOnline, isWaiting } from '../src/index.js';

/** A tiny two-player game: each player's square moves with their keys; the state hash is the whole state. */
const newState = () => ({ p: [{ x: 0 }, { x: 100 }], tick: 0 });
function step(s, inputs) {
  for (let i = 0; i < 2; i++) { if (inputs[i].has('ArrowRight')) s.p[i].x += 2; if (inputs[i].has('ArrowLeft')) s.p[i].x -= 1; }
  s.tick++;
}
const hash = (s) => `${s.tick}:${s.p[0].x}:${s.p[1].x}`;

/** Two computers joined by a network that can delay, duplicate and reorder (a seeded shuffle); each plays a script of keys. */
function play({ ticks = 300, delay = 3, lag = 4, dup = 0, shuffle = false, scripts, wire = (m) => m, checkEvery = 60 }) {
  const ls = [new Lockstep({ me: 0, delay, checkEvery }), new Lockstep({ me: 1, delay, checkEvery })];
  const states = [newState(), newState()], wireq = [[], []];                    // wireq[to]: [{at, message, from}]
  let rng = 12345; const rand = () => (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
  const send = (from, message, now) => {
    if (!message) return;
    const to = 1 - from, copies = 1 + (rand() < dup ? 1 : 0);
    for (let c = 0; c < copies; c++) wireq[to].push({ at: now + lag + (shuffle ? Math.floor(rand() * 6) : 0), message: wire(structuredClone(message)), from });
  };
  const simulated = [0, 0];
  for (let now = 0; now < ticks * 12; now++) {
    for (let p = 0; p < 2; p++) {
      const l = ls[p];
      const due = wireq[p].filter((w) => w.at <= now); wireq[p] = wireq[p].filter((w) => w.at > now);
      if (shuffle) due.sort(() => rand() - 0.5);
      for (const w of due) l.receive(w.message, w.from);
      if (simulated[p] >= ticks) continue;
      send(p, l.local(scripts[p](simulated[p])), now);
      if (l.ready()) {
        const inputs = l.take(); step(states[p], inputs);
        send(p, l.done(l.wantsSum(l.frame + 1) ? hash(states[p]) : undefined), now);
        simulated[p]++;
      }
    }
  }
  return { ls, states, simulated };
}
const press = (p) => (t) => (p === 0 ? (t % 7 < 4 ? ['ArrowRight'] : []) : (t % 5 < 2 ? ['ArrowLeft'] : ['ArrowRight']));

test('two computers given each other\'s keys end up with exactly the same game', () => {
  const r = play({ scripts: [press(0), press(1)] });
  assert.deepEqual(r.simulated, [300, 300]); assert.equal(hash(r.states[0]), hash(r.states[1])); assert.notEqual(r.states[0].p[0].x, 0); assert.equal(r.ls[0].desyncAt, null); assert.equal(r.ls[1].desyncAt, null);
});

test('late, doubled and reordered messages change nothing', () => {
  const clean = play({ scripts: [press(0), press(1)] });
  for (const o of [{ lag: 1 }, { lag: 9 }, { dup: 0.7 }, { shuffle: true, lag: 3 }, { shuffle: true, dup: 0.5, lag: 7 }]) {
    const r = play({ scripts: [press(0), press(1)], ...o });
    assert.deepEqual(r.simulated, [300, 300], JSON.stringify(o)); assert.equal(hash(r.states[0]), hash(clean.states[0]), JSON.stringify(o)); assert.equal(hash(r.states[1]), hash(clean.states[0]));
    assert.equal(r.ls[0].desyncAt, null); assert.equal(r.ls[1].desyncAt, null);
  }
});

test('the keys held on a tick are used `delay` ticks later, and the first ticks have nobody pressing anything', () => {
  const r = play({ ticks: 8, delay: 3, scripts: [() => ['ArrowRight'], () => []] });
  assert.equal(r.states[0].p[0].x, 2 * (8 - 3), 'five of the eight ticks had the key');
  const none = play({ ticks: 8, delay: 0, scripts: [() => ['ArrowRight'], () => []] }); assert.equal(none.states[0].p[0].x, 16);
});

test('a tick waits for the friend, counts the wait, and goes on when the keys arrive', () => {
  const a = new Lockstep({ me: 0, delay: 2 });
  for (let i = 0; i < 2; i++) { a.local([]); assert.ok(a.ready()); a.take(); a.done(); }      // the first two ticks need nothing from anyone
  assert.ok(a.local([]), 'on tick 2 our keys are chosen for tick 4');
  assert.equal(a.ready(), false); assert.equal(a.stalls, 1);
  assert.throws(() => a.take(), /before the keys/);
  assert.equal(a.local([]), null, 'one set of keys per tick');
  assert.ok(a.receive({ t: 'in', f: 2, k: ['KeyA'] }, 1)); assert.ok(a.ready()); const ins = a.take(); assert.equal(ins.length, 2); assert.ok(ins[1].has('KeyA')); assert.equal(ins[0].size, 0);
});

test('a message is used once: a second copy with other keys is ignored, and an old one is dropped quietly', () => {
  const a = new Lockstep({ me: 0, delay: 1 });
  a.local(['KeyX']);
  assert.ok(a.receive({ t: 'in', f: 1, k: ['KeyB', 'KeyA'] }, 1)); assert.ok(a.receive({ t: 'in', f: 1, k: ['KeyZ'] }, 1));
  a.take(); a.done(); assert.ok(a.ready()); const ins = a.take(); assert.deepEqual([...ins[1]], ['KeyA', 'KeyB'], 'the first copy counts, in a fixed order');
  a.done(); assert.equal(a.receive({ t: 'in', f: 0, k: [] }, 1), true); assert.equal(a.refused, 0);
});

test('nonsense is refused and counted: wrong shapes, far-future ticks, ourselves, strangers', () => {
  const a = new Lockstep({ me: 0, window: 50 });
  const bad = [[{ t: 'in', f: -1, k: [] }, 1], [{ t: 'in', f: 1.5, k: [] }, 1], [{ t: 'in', f: 1, k: 'KeyA' }, 1], [{ t: 'in', f: 1, k: [5] }, 1], [{ t: 'in', f: 51, k: [] }, 1], [{ t: 'in', f: 1, k: new Array(30).fill('KeyA') }, 1],
    [{ t: 'in', f: 1, k: ['x'.repeat(41)] }, 1], [{ t: 'in', f: 1, k: [] }, 0], [{ t: 'in', f: 1, k: [] }, 5], [{ t: 'in', f: 1, k: [] }, -1], [{ t: 'huh' }, 1], [null, 1], ['text', 1], [{ t: 'sum', f: 'x', h: 'a' }, 1], [{ t: 'sum', f: 3, h: 'x'.repeat(50) }, 1]];
  for (const [m, from] of bad) assert.equal(a.receive(m, from), false, JSON.stringify(m));
  assert.equal(a.refused, bad.length); assert.ok(a.receive({ t: 'in', f: 50, k: [] }, 1), 'the edge of the window is fine');
});

test('computers that disagree notice, at the next fingerprint', () => {
  // player 1's copy of the game quietly differs: its fingerprint is wrong from tick 100 on
  let flip = false;
  const r = play({ ticks: 200, scripts: [press(0), press(1)], wire: (m) => { if (m.t === 'sum' && m.f >= 120) m.h += 'x'; return m; } });
  assert.equal(r.ls[0].desyncAt, 120); assert.equal(r.ls[1].desyncAt, 120); void flip;
  const fine = play({ ticks: 200, scripts: [press(0), press(1)] }); assert.equal(fine.ls[0].desyncAt, null);
  const off = new Lockstep({ checkEvery: 0 }); assert.equal(off.wantsSum(60), false); assert.equal(off.done('h'), null);
});

test('more than two players, and the checks on the settings', () => {
  const t = [0, 1, 2].map((me) => new Lockstep({ players: 3, me, delay: 1 }));
  for (const l of t) { l.take(); l.done(); }
  const msgs = t.map((l, i) => ({ i, m: l.local([`Key${i}`]) }));
  for (const l of t) for (const { i, m } of msgs) if (i !== l.me) l.receive(m, i);
  for (const l of t) { assert.ok(l.ready()); assert.deepEqual(l.take().map((s) => [...s]), [['Key0'], ['Key1'], ['Key2']]); }
  assert.throws(() => new Lockstep({ players: 1 }), /at least 2/); assert.throws(() => new Lockstep({ players: 2, me: 2 }), /not one of/);
});

test('key lists are sorted, limited and cleaned', () => {
  assert.deepEqual(keyList(new Set(['KeyB', 'KeyA'])), ['KeyA', 'KeyB']); assert.deepEqual(keyList(['a', 5, 'x'.repeat(50), 'b']), ['a', 'b']); assert.equal(keyList(Array.from({ length: 50 }, (_, i) => `K${i}`)).length, 24);
});

test('what the kit knows about who is playing', () => {
  assert.deepEqual([me(), playerCount(), isOnline(), isWaiting()], [0, 1, false, false]);
  setNetInfo({ me: 1, players: 2, online: true, waiting: true }); assert.deepEqual([me(), playerCount(), isOnline(), isWaiting()], [1, 2, true, true]);
  setNetInfo({ me: 0, players: 1, online: false, waiting: false });
});
