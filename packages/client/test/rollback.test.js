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

test('a session can start from a game that is already going: from the state it was sent, at the frame that state is of', () => {
  const real = init();
  for (let f = 0; f < 50; f++) step(real, [0, 1].map((p) => press(p, f)));
  const joined = new RollbackSession({ players: 2, local: 0, init: () => structuredClone(real), step, checksum, blank: 0, startFrame: 50 });
  assert.equal(joined.frame, 50);
  for (let f = 50; f < 90; f++) {
    const frame = joined.addLocalInput(press(0, f));
    assert.equal(frame, f, 'input goes to the frame it is for');
    joined.setInput(1, f, press(1, f));
    assert.ok(joined.advance());
  }
  const rest = structuredClone(real);
  for (let f = 50; f < 90; f++) step(rest, [0, 1].map((p) => press(p, f)));
  assert.equal(checksum(joined.state), checksum(rest));
  assert.ok(joined.confirmedFrame >= 89, `confirmed up to ${joined.confirmedFrame}`);
});

test('the last word on an input, from a server: it replaces a guess or an earlier input, the frames since are played again, and an input that was right costs nothing', () => {
  const s = make(0, { maxRollback: 16 });
  for (let f = 0; f < 20; f++) { s.addLocalInput(press(0, f)); s.setInput(1, f, press(1, f)); s.advance(); }
  assert.equal(s.stats.rollbacks, 0, 'all told in time: nothing to take back');
  const before = checksum(s.state);
  for (let f = 20; f < 30; f++) { s.addLocalInput(press(0, f)); s.advance(); }        // player 1's inputs have not come: guessed
  s.setInput(1, 22, -1);                                                              // the truth about one frame, learned late
  s.setInput(1, 23, s.used[1].get(23));                                               // and one that was guessed right
  s.addLocalInput(press(0, 30)); s.advance();
  assert.equal(s.stats.rollbacks, 1);
  const check = make(0);
  for (let f = 0; f < 31; f++) { check.addLocalInput(press(0, f)); check.setInput(1, f, f === 22 ? -1 : f >= 20 ? s.used[1].get(f) : press(1, f)); check.advance(); }
  assert.equal(checksum(s.state), checksum(check.state), 'the same as if the truth had been known');
  assert.notEqual(checksum(s.state), before);
  // the server may also change this machine's own input (it arrived too late and was not used), as long as the frame is not yet confirmed by the server's word on the others
  const me = make(0, { maxRollback: 16 });
  for (let f = 0; f < 10; f++) { me.addLocalInput(1); if (f < 4) me.setInput(1, f, 0); me.advance(); }
  me.setInput(0, 6, 0);
  me.addLocalInput(1); me.advance();
  assert.equal(me.used[0].get(6), 0, 'the frame was played again with what the server said');
});

test('a change in the rules from some frame on makes the frames since be played again with the new rules', () => {
  let double = false;
  const doubling = (s, inputs, frame) => { if (frame >= 10 && double) s.x[0] += 5; step(s, inputs); };
  const s = new RollbackSession({ players: 2, local: 0, init, step: doubling, checksum, blank: 0, maxRollback: 40 });
  for (let f = 0; f < 20; f++) { s.addLocalInput(0); s.advance(); }
  const plain = checksum(s.state);
  double = true;
  s.redoFrom(10);
  s.addLocalInput(0); s.advance();
  assert.equal(s.stats.rollbacks, 1);
  assert.notEqual(checksum(s.state), plain);
  assert.equal(s.state.x[0], 0 + 5 * 11, 'frames 10 to 20 had the new rule');
});

test('with a server deciding every input, even the first frames are not taken as blank', () => {
  const s = new RollbackSession({ players: 2, local: 0, init, step, checksum, blank: 0, inputDelay: 2, assumeBlank: false, maxRollback: 40 });
  for (let f = 0; f < 6; f++) { s.addLocalInput(0); s.advance(); }
  s.setInput(1, 0, 1);
  s.setInput(0, 0, 0);
  s.addLocalInput(0); s.advance();
  assert.equal(s.used[1].get(0), 1, 'frame 0 was played again with what the server said');
});

test('with peers, an input is given once for each frame: asking again while the session could not move gives the same frame and keeps the first input, so the lead does not grow while waiting', () => {
  const s = new RollbackSession({ players: 2, local: 0, init, step, checksum, blank: 0, inputDelay: 1, maxRollback: 3 });
  const given = [];
  for (let t = 0; t < 12; t++) { given.push(s.addLocalInput(t + 1)); s.advance(); }          // nothing ever arrives from player 1: after three frames ahead it waits
  assert.ok(s.frame < 12, `it waited at frame ${s.frame}`);
  const stuck = given.slice(s.frame);
  assert.ok(stuck.length > 4 && new Set(stuck).size === 1, `the frame stays ${stuck[0]} while waiting: ${stuck}`);
  assert.equal(given[s.frame], stuck[0]);
  assert.equal(s.known[0].get(stuck[0]), s.frame + 1, 'the first input given for that frame is the one kept');
  assert.equal(stuck[0], s.frame + 1, 'the lead is still the delay (1 frame) plus the tick it waited in');
});

test('with a server deciding, the lead of the local inputs follows the delay down as well as up, and a command given again for the same frame replaces the old one', () => {
  const s = new RollbackSession({ players: 2, local: 0, init, step, checksum, blank: 0, inputDelay: 8, assumeBlank: false, serverDecides: true, maxRollback: 90 });
  for (let t = 0; t < 10; t++) { assert.equal(s.addLocalInput(1), s.frame + 8); s.advance(); }
  s.inputDelay = 0;                                                                            // the connection turned out to be good
  assert.equal(s.addLocalInput(7), s.frame, 'the next command is for the present frame, not eight frames on');
  assert.equal(s.known[0].get(s.frame), 7);
  assert.equal(s.addLocalInput(9), s.frame, 'given again before the session moved: the same frame');
  assert.equal(s.known[0].get(s.frame), 9, 'the newest command replaces the old one');
  s.advance();
  s.inputDelay = 3;
  assert.equal(s.addLocalInput(2), s.frame + 3, 'and up again');
  s.setInput(0, s.frame + 6, 5);                                                              // the server decided some frames ahead of this machine (it has joined late, and is catching up)
  s.inputDelay = 0;
  assert.equal(s.addLocalInput(1), s.frame + 7, 'a command is never for a frame the server has already decided: it would only be late');
  const peers = new RollbackSession({ players: 2, local: 0, init, step, checksum, blank: 0, inputDelay: 8, maxRollback: 90 });
  for (let t = 0; t < 10; t++) { peers.addLocalInput(1); peers.advance(); }
  peers.inputDelay = 0;
  assert.equal(peers.addLocalInput(7), peers.frame + 8, 'with peers a lead that grew stays: what was sent cannot be taken back');
});
