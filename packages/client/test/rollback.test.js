import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RollbackSession } from '../src/index.js';

/** A little fighting game: two players walk along a line (-1, 0, 1), and one can hit (2) the other when they are close; being hit costs hit points. Not linear, so replaying matters. */
const init = () => ({ x: [0, 20], hp: [10, 10], tick: 0 });
function step(s, inputs) {
  s.tick++;
  inputs.forEach((input, p) => {
    const act = input ?? 0;
    if (act === 1 || act === -1) s.x[p] = Math.max(0, Math.min(30, s.x[p] + act));
    if (act === 2 && Math.abs(s.x[0] - s.x[1]) <= 3) s.hp[1 - p] = Math.max(0, s.hp[1 - p] - 1);
  });
}
const checksum = (s) => JSON.stringify(s).split('').reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const make = (local, extra = {}) => new RollbackSession({ players: 2, local, init, step, checksum, blank: 0, ...extra });

/** What each player pressed on each frame (a pattern with some turns and some hits). */
const press = (p, f) => [1, 1, 1, -1, 0, 2, 1, 0][(f * (p + 3) + p) % 8];

/** The truth: the whole game simulated with every input known. */
function reference(frames, delay = 0) {
  const s = init();
  for (let f = 0; f < frames; f++) step(s, [0, 1].map((p) => (f < delay ? 0 : press(p, f - delay))));
  return s;
}

/** Two machines, with `lag` frames between them each way. Returns both sessions after `ticks` ticks and everything delivered. */
function play({ ticks, lag, delay = 0, maxRollback = 8, jitter = false }) {
  const a = make(0, { inputDelay: delay, maxRollback });
  const b = make(1, { inputDelay: delay, maxRollback });
  const toA = [];
  const toB = [];
  let stalled = 0;
  for (let t = 0; t < ticks; t++) {
    for (const [queue, session] of [[toA, a], [toB, b]]) {
      while (queue.length && queue[0].at <= t) { const m = queue.shift(); session.addRemoteInput(m.player, m.frame, m.input); }
    }
    const fa = a.addLocalInput(press(0, t));
    const fb = b.addLocalInput(press(1, t));
    const extra = jitter ? (t % 3) : 0;
    toB.push({ at: t + lag + extra, player: 0, frame: fa, input: press(0, t) });
    toA.push({ at: t + lag + extra, player: 1, frame: fb, input: press(1, t) });
    toA.sort((x, y) => x.at - y.at);
    toB.sort((x, y) => x.at - y.at);
    for (const [queue, session] of [[toA, a], [toB, b]]) {                 // what has arrived by now (with no lag, what was just sent)
      while (queue.length && queue[0].at <= t) { const m = queue.shift(); session.addRemoteInput(m.player, m.frame, m.input); }
    }
    if (!a.advance()) stalled++;
    if (!b.advance()) stalled++;
  }
  for (const m of toB) b.addRemoteInput(m.player, m.frame, m.input);
  for (const m of toA) a.addRemoteInput(m.player, m.frame, m.input);
  return { a, b, stalled };
}

test('with no delay at all the game plays as if on one machine, with nothing to take back', () => {
  const { a, b } = play({ ticks: 60, lag: 0 });
  assert.equal(a.stats.rollbacks + b.stats.rollbacks, 0);
  assert.deepEqual(a.state, reference(60));
  assert.deepEqual(b.state, a.state);
});

test('with a delay between the players, both end up in exactly the state of the real game, and had to go back to get there', () => {
  const { a, b } = play({ ticks: 80, lag: 3 });
  assert.ok(a.stats.rollbacks > 0 && b.stats.rollbacks > 0, 'a guess was wrong at least once');
  const ca = a.confirmed();
  const cb = b.confirmed();
  assert.equal(ca.frame, cb.frame);
  assert.ok(ca.frame >= 70, 'almost everything is confirmed');
  assert.deepEqual(ca.state, reference(ca.frame), 'a confirmed state is the true state');
  assert.deepEqual(cb.state, ca.state);
  assert.equal(ca.checksum, cb.checksum);
});

test('the same holds when the messages arrive unevenly', () => {
  const { a, b } = play({ ticks: 90, lag: 2, jitter: true });
  const ca = a.confirmed();
  assert.deepEqual(ca.state, reference(ca.frame));
  assert.deepEqual(b.confirmed().state, ca.state);
});

test('input delay means fewer rollbacks, because the other player has time to answer', () => {
  const none = play({ ticks: 120, lag: 3, delay: 0 });
  const some = play({ ticks: 120, lag: 3, delay: 3 });
  assert.ok(some.a.stats.rollbacks < none.a.stats.rollbacks, `${some.a.stats.rollbacks} < ${none.a.stats.rollbacks}`);
  assert.deepEqual(some.a.confirmed().state, reference(some.a.confirmed().frame, 3), 'with the first frames blank');
  assert.equal(some.a.confirmed().checksum, some.b.confirmed().checksum);
});

test('it never runs more than maxRollback frames ahead of what is confirmed: it waits', () => {
  const a = make(0, { maxRollback: 4 });
  let advanced = 0;
  for (let t = 0; t < 12; t++) { a.addLocalInput(1); if (a.advance()) advanced++; }
  assert.equal(advanced, 4);
  assert.ok(a.stats.stalls >= 1);
  a.addRemoteInput(1, 0, 0);
  a.addRemoteInput(1, 1, 0);
  a.addLocalInput(1);
  assert.equal(a.advance(), true, 'once the other player is heard from it carries on');
});

test('it cannot advance without this machine\'s own input for the frame', () => {
  const a = make(0);
  assert.equal(a.advance(), false);
  a.addLocalInput(1);
  assert.equal(a.advance(), true);
  assert.equal(a.advance(), false);
});

test('a guess that was right costs nothing', () => {
  const a = make(0);
  for (let f = 0; f < 6; f++) { a.addLocalInput(1); a.advance(); }
  for (let f = 0; f < 6; f++) a.addRemoteInput(1, f, 0);        // the other player did "nothing", as guessed
  a.addLocalInput(1);
  a.advance();
  assert.equal(a.stats.rollbacks, 0);
});

test('a wrong guess goes back only as far as the first frame that was wrong, and the longest rollback is counted', () => {
  const a = make(0);
  for (let f = 0; f < 6; f++) { a.addLocalInput(1); a.advance(); }
  a.addRemoteInput(1, 4, 1);                                     // frame 4 was guessed as "nothing"
  a.addLocalInput(1);
  a.advance();
  assert.equal(a.stats.rollbacks, 1);
  assert.equal(a.stats.resimulated, 2, 'frames 4 and 5 again');
  assert.equal(a.stats.maxRollback, 2);
  assert.equal(a.frame, 7);
});

test('inputs that arrive twice, or for the wrong player, change nothing', () => {
  const a = make(0);
  a.addLocalInput(1);
  a.advance();
  a.addRemoteInput(1, 0, 1);
  a.addRemoteInput(1, 0, 2);                                     // a second, different answer for the same frame is ignored
  a.addRemoteInput(0, 0, 2);                                     // our own player: ignored
  a.addRemoteInput(7, 0, 2);
  a.addLocalInput(1);
  a.advance();
  assert.equal(a.stats.rollbacks, 1, 'the first answer differed from the guess, once');
  assert.equal(a.known[1].get(0), 1, 'and the first answer is the one kept');
  assert.equal(a.known[0].get(0), 1, 'our own input is not overwritten');
});

test('when two machines stop agreeing, the checksums say so at the frame it happened', () => {
  const good = make(0);
  const buggy = new RollbackSession({ players: 2, local: 1, init, step: (s, inputs) => { step(s, inputs); if (s.tick === 20) s.hp[0] += 1; }, checksum, blank: 0 });
  for (let f = 0; f < 40; f++) {
    const fa = good.addLocalInput(press(0, f));
    const fb = buggy.addLocalInput(press(1, f));
    good.addRemoteInput(1, fb, press(1, f));
    buggy.addRemoteInput(0, fa, press(0, f));
    good.advance();
    buggy.advance();
  }
  const mine = good.confirmed();
  assert.equal(good.report(mine.frame, mine.checksum), true, 'it agrees with itself');
  assert.equal(good.desync, null);
  const theirs = buggy.confirmed();
  assert.equal(good.report(theirs.frame, theirs.checksum), false);
  assert.ok(good.desync && good.desync.frame === theirs.frame);
});

test('old state is forgotten, so a long game does not keep growing', () => {
  const { a } = play({ ticks: 600, lag: 2 });
  assert.ok(a.snapshots.size < 20, `${a.snapshots.size} snapshots kept`);
  assert.ok(a.known[0].size < 150);
});

test('it explains what it needs', () => {
  assert.throws(() => new RollbackSession({ players: 2, local: 5, init, step }), /which player is local/);
  assert.throws(() => new RollbackSession({ players: 2, local: 0 }), /init .* and step/);
});
