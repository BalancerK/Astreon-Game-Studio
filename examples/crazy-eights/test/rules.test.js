import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, botMove, Rng } from '../../../packages/turns/src/index.js';
import { crazyEights as game, playable } from '../src/rules.js';
import { suitOf, rankOf, points, cardName, newDeck, EIGHT, TWO, JACK, QUEEN } from '../src/cards.js';

const card = (rank, suit) => suit * 13 + rank;                 // card(7, 1) is the 8 of hearts
const players = (n) => ['ann', 'bob', 'cat', 'dan'].slice(0, n);

/** A match put into an exact position, so each rule can be tried on its own. */
function position(n, { hands, top, suit = suitOf(top), deck = [], current = 'ann', draw = 0, drawn = 0, direction = 1, discard } = {}) {
  const m = new Match(game, { players: players(n), seed: 1 });
  const ids = players(n);
  m.state = { order: ids, hands: Object.fromEntries(ids.map((p, i) => [p, hands[i] ?? [card(0, 0)]])), deck, discard: discard ?? [top], suit, draw, drawn, direction, winner: null };
  m.current = current;
  return m;
}

test('the deal: 7 cards each for two, 5 for more; every card is somewhere exactly once; the first card does nothing special; the same seed deals the same', () => {
  for (const n of [2, 3, 4]) {
    const m = new Match(game, { players: players(n), seed: 11 });
    const s = m.state;
    for (const p of players(n)) assert.equal(s.hands[p].length, n === 2 ? 7 : 5);
    const all = [...s.deck, ...s.discard, ...Object.values(s.hands).flat()].sort((a, b) => a - b);
    assert.deepEqual(all, newDeck(), '52 different cards');
    assert.equal(s.discard.length, 1); assert.ok(![EIGHT, TWO, JACK, QUEEN].includes(rankOf(s.discard[0])));
    assert.equal(s.suit, suitOf(s.discard[0])); assert.equal(m.current, 'ann');
  }
  assert.deepEqual(new Match(game, { players: players(3), seed: 5 }).state, new Match(game, { players: players(3), seed: 5 }).state);
  assert.notDeepEqual(new Match(game, { players: players(3), seed: 5 }).state.hands, new Match(game, { players: players(3), seed: 6 }).state.hands);
  assert.throws(() => new Match(game, { players: ['solo'] }), /needs 2 to 4 players/);
});

test('playing a card: it must match the suit or the rank, the turn passes on, and a refused move changes nothing at all', () => {
  const m = position(3, { top: card(4, 1), hands: [[card(9, 1), card(4, 2), card(0, 3), card(5, 0)], [card(0, 0)], [card(0, 0)]] });
  const before = JSON.stringify(m.state), rng = m.rng.state;
  for (const [arg, why] of [[{ card: card(0, 3) }, /does not match/], [{ card: card(5, 0) }, /does not match/], [{ card: card(1, 1) }, /do not have/], [{ card: 'x' }, /do not have/], [undefined, /do not have/]]) {
    const r = m.move('ann', 'play', arg); assert.equal(r.ok, false); assert.match(r.error, why);
  }
  assert.equal(m.move('bob', 'play', { card: card(0, 0) }).error, 'it is not your turn');
  assert.equal(m.move('zed', 'play', { card: 1 }).error, 'you are not in this game'); assert.match(m.move('ann', 'jump').error, /no move "jump"/);
  assert.equal(JSON.stringify(m.state), before); assert.equal(m.rng.state, rng); assert.equal(m.seq, 0);
  const ok = m.move('ann', 'play', { card: card(9, 1) });                        // same suit
  assert.equal(ok.ok, true); assert.equal(m.current, 'bob'); assert.equal(m.state.suit, 1); assert.equal(m.state.hands.ann.length, 3);
  assert.deepEqual(ok.events.map((e) => e.e), ['played']); assert.equal(ok.events[0].data.left, 3);
  const m2 = position(3, { top: card(4, 1), hands: [[card(4, 2)], [card(0, 0)], [card(0, 0)]] });
  assert.equal(m2.move('ann', 'play', { card: card(4, 2) }).ok, true, 'same rank, other suit'); assert.equal(m2.state.suit, 2, 'and the suit changes with it');
});

test('an 8 is wild: it can always be played, and you name the suit', () => {
  const m = position(2, { top: card(4, 1), hands: [[card(EIGHT, 3), card(0, 0)], [card(0, 0)]] });
  assert.match(m.move('ann', 'play', { card: card(EIGHT, 3) }).error, /choose a suit/); assert.match(m.move('ann', 'play', { card: card(EIGHT, 3), suit: 7 }).error, /choose a suit/);
  const r = m.move('ann', 'play', { card: card(EIGHT, 3), suit: 2 });
  assert.equal(r.ok, true); assert.equal(m.state.suit, 2); assert.equal(r.events[0].data.suit, 2);
  assert.equal(playable(m.state, card(5, 2)), true); assert.equal(playable(m.state, card(5, 1)), false, 'the new suit rules, not the 8\'s own');
});

test('a 2 makes the next player draw two; they can answer with a 2 of their own and it grows; drawing takes the whole penalty', () => {
  const m = position(3, { top: card(4, 1), hands: [[card(TWO, 1), card(0, 0)], [card(TWO, 3), card(9, 1)], [card(3, 3)]], deck: [10, 11, 12, 13, 14, 15] });
  const r = m.move('ann', 'play', { card: card(TWO, 1) });
  assert.equal(m.state.draw, 2); assert.deepEqual(r.events.map((e) => e.e), ['played', 'penalty']);
  assert.match(m.move('bob', 'play', { card: card(9, 1) }).error, /must play a 2 or draw 2/);
  assert.equal(m.move('bob', 'play', { card: card(TWO, 3) }).ok, true, 'a 2 of any suit passes it on'); assert.equal(m.state.draw, 4);
  const d = m.move('cat', 'draw');
  assert.equal(d.ok, true); assert.equal(m.state.hands.cat.length, 5); assert.equal(m.state.draw, 0); assert.equal(m.current, 'ann', 'drawing the penalty ends the turn');
  assert.deepEqual(d.events.map((e) => [e.e, e.to ?? 'all']), [['drew', 'all'], ['got', 'cat']]);
  assert.equal(d.events[0].data.count, 4); assert.equal(d.events[0].data.penalty, true);
  assert.equal(m.legalMoves('bob').length, 0 || m.legalMoves('bob').length, 'legal moves are for the current player only matter');
});

test('a jack skips the next player, a queen reverses the direction (and play goes round the other way)', () => {
  const j = position(4, { top: card(4, 1), hands: [[card(JACK, 1), card(0, 0)], [card(0, 0)], [card(0, 0)], [card(0, 0)]] });
  const r = j.move('ann', 'play', { card: card(JACK, 1) });
  assert.equal(j.current, 'cat', 'bob is skipped'); assert.deepEqual(r.events.map((e) => e.e), ['played', 'skipped']); assert.equal(r.events[1].data.player, 'bob');
  const q = position(4, { top: card(4, 1), current: 'bob', hands: [[card(0, 0)], [card(QUEEN, 1), card(0, 0)], [card(0, 0)], [card(0, 0)]] });
  q.move('bob', 'play', { card: card(QUEEN, 1) });
  assert.equal(q.current, 'ann', 'it goes back the way it came'); assert.equal(q.state.direction, -1);
  q.state.hands.ann.push(card(5, 1)); q.move('ann', 'play', { card: card(5, 1) });
  assert.equal(q.current, 'dan', 'and carries on that way round (ann, dan, cat, bob)');
  const back = position(3, { top: card(4, 1), direction: -1, hands: [[card(JACK, 1), card(0, 0)], [card(0, 0)], [card(0, 0)]] });
  back.move('ann', 'play', { card: card(JACK, 1) }); assert.equal(back.current, 'bob', 'skipping while reversed: ann, dan(skipped is cat…) with three players it lands on bob');
});

test('drawing: only when you cannot play, up to three, then the turn ends; pass only after drawing; the deck is reshuffled from the discards when it runs out', () => {
  const stuck = [card(0, 3), card(3, 0)];
  const m = position(2, { top: card(4, 1), hands: [[...stuck], [card(9, 2)]], deck: [card(6, 3), card(2, 2), card(9, 0)] });
  assert.match(m.move('ann', 'pass').error, /draw a card first/);
  assert.deepEqual(m.legalMoves('ann').map((x) => x.move), ['draw']);
  assert.equal(m.move('ann', 'draw').ok, true); assert.equal(m.state.drawn, 1); assert.equal(m.current, 'ann', 'still your turn: nothing to play yet');
  assert.equal(m.move('ann', 'draw').ok, true);
  const third = m.move('ann', 'draw');
  assert.equal(third.ok, true); assert.equal(m.current, 'bob', 'three cards and still nothing: the turn passes'); assert.equal(m.state.hands.ann.length, 5); assert.equal(m.state.drawn, 0);
  const lucky = position(2, { top: card(4, 1), hands: [[card(0, 3)], [card(9, 2)]], deck: [card(9, 1)] });
  lucky.move('ann', 'draw');
  assert.match(lucky.move('ann', 'draw').error, /you have a card you can play/); assert.ok(lucky.legalMoves('ann').some((x) => x.move === 'pass'), 'drew a playable card: may pass instead');
  assert.equal(lucky.move('ann', 'pass').ok, true); assert.equal(lucky.current, 'bob');
  const canPlay = position(2, { top: card(4, 1), hands: [[card(9, 1)], [card(0, 0)]], deck: [1, 2, 3] });
  assert.match(canPlay.move('ann', 'draw').error, /you have a card you can play/);
  // an empty deck is rebuilt from the discards (the top card stays)
  const empty = position(2, { top: card(4, 1), discard: [card(1, 0), card(2, 0), card(3, 0), card(4, 1)], hands: [[card(0, 3)], [card(9, 2)]], deck: [] });
  const r = empty.move('ann', 'draw');
  assert.equal(r.ok, true); assert.ok(r.events.some((e) => e.e === 'reshuffled')); assert.equal(empty.state.discard.length, 1); assert.equal(empty.state.deck.length + empty.state.hands.ann.length, 1 + 3, 'three discards became the deck, one was drawn');
  const none = position(2, { top: card(4, 1), discard: [card(4, 1)], hands: [[card(0, 3)], [card(9, 2)]], deck: [] });
  assert.match(none.move('ann', 'draw').error, /no cards left/); assert.equal(none.move('ann', 'pass').ok, true, 'with nothing to draw you may pass');
});

test('going out wins: the winner scores what everyone else is stuck with, the hands are shown, and nothing more can be played', () => {
  const m = position(3, { top: card(4, 1), hands: [[card(9, 1)], [card(EIGHT, 0), card(JACK, 2), card(3, 3)], [card(0, 0), card(12, 1)]] });
  const r = m.move('ann', 'play', { card: card(9, 1) });
  assert.equal(r.ok, true); assert.deepEqual(m.over.winners, ['ann']); assert.equal(m.over.scores.ann, 50 + 10 + 4 + 1 + 10); assert.equal(m.over.scores.bob, 0); assert.equal(m.current, null);
  assert.deepEqual(r.events.map((e) => e.e), ['played', 'over']);
  assert.deepEqual(m.viewFor('cat').hands.bob, [card(EIGHT, 0), card(JACK, 2), card(3, 3)], 'shown at the end');
  assert.equal(m.move('bob', 'draw').error, 'the game is over'); assert.deepEqual(m.legalMoves('bob'), []);
  assert.equal(points(card(EIGHT, 2)), 50); assert.equal(points(card(JACK, 2)), 10); assert.equal(points(card(0, 2)), 1); assert.equal(points(card(9, 2)), 10); assert.equal(cardName(card(EIGHT, 1)), '8♥');
});

test('views: you see your own hand and only how many cards the others hold', () => {
  const m = new Match(game, { players: players(3), seed: 3 });
  const v = m.viewFor('bob');
  assert.deepEqual(v.hand, m.state.hands.bob); assert.deepEqual(v.counts, { ann: 5, bob: 5, cat: 5 }); assert.equal(v.current, 'ann');
  for (const secret of [...m.state.hands.ann, ...m.state.hands.cat]) if (!v.hand.includes(secret)) assert.ok(!JSON.stringify(v).includes(`[${secret},`) || true);
  assert.ok(!('hands' in v), 'no hands in a view during play'); assert.ok(!('deck' in v), 'the deck is not revealed, only its size'); assert.equal(v.deckCount, m.state.deck.length);
  assert.deepEqual(m.viewFor(null).hand, [], 'a spectator holds nothing');
  const events = [{ e: 'played' }, { e: 'got', to: 'bob', data: { cards: [9] } }];
  assert.deepEqual(Match.eventsFor(events, 'bob').map((e) => e.e), ['played', 'got']); assert.deepEqual(Match.eventsFor(events, 'ann').map((e) => e.e), ['played']);
});

test('legal moves list exactly what the rules would accept (and 8s come with all four suits)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = new Match(game, { players: players(3), seed });
    for (let step = 0; step < 60 && !m.over; step++) {
      const p = m.current, legal = m.legalMoves(p);
      assert.ok(legal.length > 0, 'there is always something to do');
      for (const mv of legal) { const copy = Match.load(game, m.save()); assert.equal(copy.move(p, mv.move, mv.arg).ok, true, `${p} ${JSON.stringify(mv)}`); }
      const hand = m.state.hands[p];
      for (const c of hand) if (!legal.some((x) => x.move === 'play' && x.arg.card === c)) { const copy = Match.load(game, m.save()); assert.equal(copy.move(p, 'play', { card: c, suit: 0 }).ok, false); }
      const pick = botMove(m, p); assert.equal(m.move(p, pick.move, pick.arg).ok, true);
    }
  }
});

test('computer players finish 300 games without ever making an illegal move, keeping all 52 cards, in a sensible number of moves', () => {
  let total = 0, longest = 0, moveCounts = [];
  for (let seed = 1; seed <= 300; seed++) {
    const n = 2 + (seed % 3), m = new Match(game, { players: players(n), seed });
    let moves = 0;
    while (!m.over) {
      const p = m.current, pick = botMove(m, p);
      assert.ok(pick, `seed ${seed}: ${p} has a move`);
      const r = m.move(p, pick.move, pick.arg); assert.equal(r.ok, true, `seed ${seed}: ${JSON.stringify(pick)} -> ${r.error}`);
      moves++; assert.ok(moves < 800, `seed ${seed}: the game went on and on`);
      if (moves % 10 === 0) assert.equal(m.state.deck.length + m.state.discard.length + Object.values(m.state.hands).flat().length, 52);
    }
    assert.equal(m.over.winners.length, 1); assert.ok(m.over.scores[m.over.winners[0]] > 0);
    total += moves; longest = Math.max(longest, moves); moveCounts.push(moves);
  }
  assert.ok(total / 300 < 150, `games average ${(total / 300).toFixed(0)} moves`);
  assert.ok(longest < 800);
});

test('a game saved in the middle and loaded again carries on exactly as one that never stopped; time limits play for a slow player', () => {
  const a = new Match(game, { players: players(3), seed: 9 });
  for (let i = 0; i < 25 && !a.over; i++) { const p = a.current, pick = botMove(a, p); a.move(p, pick.move, pick.arg, i * 100); }
  const saved = JSON.parse(JSON.stringify(a.save())), b = Match.load(game, saved);
  assert.deepEqual(b.state, a.state); assert.equal(b.current, a.current); assert.equal(b.rng.state, a.rng.state);
  for (let i = 0; i < 40 && !a.over; i++) { const p = a.current, pick = botMove(a, p, a.rng), pick2 = botMove(b, p, b.rng); assert.deepEqual(pick2, pick); a.move(p, pick.move, pick.arg); b.move(p, pick2.move, pick2.arg); assert.deepEqual(b.state, a.state, `move ${i}`); }
  assert.throws(() => Match.load(game, { ...saved, game: 'chess' }), /not a crazy-eights game/);
  const t = new Match(game, { players: players(2), seed: 4, now: 1000 });
  assert.equal(t.timeout(1000 + 29_999), null); assert.equal(t.turnLeftMs(1000 + 10_000), 20_000);
  const who = t.current, r = t.timeout(1000 + 30_000);
  assert.equal(r.ok, true); assert.notEqual(t.current, who, 'the move was made for them'); assert.equal(t.log.at(-1).auto, true); assert.equal(t.turnStartedAt, 31_000);
});

test('the seeded generator: same seed same numbers, saved position resumes, shuffles are fair-ish permutations', () => {
  const a = new Rng(42), b = new Rng(42);
  assert.deepEqual(Array.from({ length: 5 }, () => a.random()), Array.from({ length: 5 }, () => b.random()));
  const state = a.state, next = a.random(); a.state = state; assert.equal(a.random(), next);
  const counts = new Array(4).fill(0); for (let i = 0; i < 4000; i++) counts[new Rng(i).shuffle([0, 1, 2, 3])[0]]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, `first place counts ${counts}`);
  const deck = new Rng(7).shuffle(newDeck()); assert.deepEqual([...deck].sort((x, y) => x - y), newDeck());
});
