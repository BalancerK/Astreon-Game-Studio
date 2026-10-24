// Crazy Eights, as rules. Play a card that matches the top card's suit or rank; an 8 is wild (you name the suit). First to empty their hand wins.
//   2  the next player draws two (or plays a 2 of their own, and the next draws four…)
//   J  the next player is skipped        Q  the direction of play reverses
// This file is the whole game: no screen, no network.
// The server runs it, bots read it, the page asks it what is legal, and the tests call it directly.
import { defineGame } from '../../../packages/turns/src/index.js';
import { newDeck, suitOf, rankOf, points, EIGHT, TWO, JACK, QUEEN } from './cards.js';

const MAX_DRAWS = 3; // cards you may draw looking for one to play

const top = (G) => G.discard[G.discard.length - 1];
/** The player `steps` places after `from` in the current direction of play. */
const nextAfter = (G, from, steps = 1) => {
  const n = G.order.length;
  const index = (G.order.indexOf(from) + G.direction * steps) % n;
  return G.order[(index + n) % n];
};

/** Can this card be played now? */
export function playable(G, card) {
  if (G.draw > 0) return rankOf(card) === TWO;            // a penalty is pending: only another 2 passes it on
  return rankOf(card) === EIGHT || suitOf(card) === G.suit || rankOf(card) === rankOf(top(G));
}

const cardsLeft = (G) => G.deck.length + Math.max(0, G.discard.length - 1);

/** Draw one card, reshuffling the discard pile (except its top card) when the deck runs out. */
function takeCard(G, ctx) {
  if (G.deck.length === 0) {
    if (G.discard.length <= 1) return null;
    const keep = G.discard.pop();
    G.deck = ctx.random.shuffle(G.discard); G.discard = [keep];
    ctx.emit('reshuffled', { cards: G.deck.length });
  }
  return G.deck.pop();
}

export const crazyEights = defineGame({
  name: 'crazy-eights',
  players: { min: 2, max: 4 },
  turnMs: 30_000,

  setup({ players, random }) {
    const deck = random.shuffle(newDeck());
    const per = players.length === 2 ? 7 : 5;
    const hands = Object.fromEntries(players.map((p) => [p, []]));
    for (let i = 0; i < per; i++) for (const p of players) hands[p].push(deck.pop());
    // the first card: not one that does something
    const special = (c) => [EIGHT, TWO, JACK, QUEEN].includes(rankOf(c));
    let start = deck.pop();
    while (special(start)) { deck.unshift(start); start = deck.pop(); }
    return { order: [...players], hands, deck, discard: [start], suit: suitOf(start), draw: 0, drawn: 0, direction: 1, winner: null };
  },

  moves: {
    /** Play a card from your hand. `{ card, suit }`: `suit` is needed for an 8. */
    play(G, ctx, arg) {
      const card = arg?.card, hand = G.hands[ctx.player];
      if (!Number.isInteger(card) || !hand.includes(card)) ctx.fail('you do not have that card');
      if (!playable(G, card)) ctx.fail(G.draw > 0 ? `you must play a 2 or draw ${G.draw}` : 'that card does not match');
      let suit = suitOf(card);
      if (rankOf(card) === EIGHT) {
        if (!Number.isInteger(arg.suit) || arg.suit < 0 || arg.suit > 3) ctx.fail('choose a suit for the 8');
        suit = arg.suit;
      }
      hand.splice(hand.indexOf(card), 1);
      G.discard.push(card); G.suit = suit; G.drawn = 0;
      ctx.emit('played', { player: ctx.player, card, suit, left: hand.length });
      if (hand.length === 0) { G.winner = ctx.player; return; }
      const r = rankOf(card);
      if (r === TWO) { G.draw += 2; ctx.emit('penalty', { cards: G.draw }); }
      if (r === QUEEN) { G.direction = -G.direction; ctx.emit('reversed', { direction: G.direction }); }
      if (r === JACK) {
        const skipped = nextAfter(G, ctx.player);
        ctx.emit('skipped', { player: skipped });
        ctx.endTurn(nextAfter(G, ctx.player, 2));
        return;
      }
      ctx.endTurn(nextAfter(G, ctx.player));
    },

    /** Draw: one card to look for a play (up to three), or the whole penalty if a 2 was played at you. */
    draw(G, ctx) {
      const hand = G.hands[ctx.player];
      if (G.draw > 0) {
        const got = [];
        for (let i = 0; i < G.draw; i++) { const c = takeCard(G, ctx); if (c === null) break; got.push(c); hand.push(c); }
        ctx.emit('drew', { player: ctx.player, count: got.length, penalty: true });
        ctx.emitTo(ctx.player, 'got', { cards: got });
        G.draw = 0; G.drawn = 0; ctx.endTurn(nextAfter(G, ctx.player));
        return;
      }
      if (hand.some((x) => playable(G, x))) ctx.fail('you have a card you can play');
      if (G.drawn >= MAX_DRAWS) ctx.fail('you have already drawn three cards');
      const c = takeCard(G, ctx);
      if (c === null) ctx.fail('there are no cards left to draw');
      hand.push(c); G.drawn++;
      ctx.emit('drew', { player: ctx.player, count: 1 });
      ctx.emitTo(ctx.player, 'got', { cards: [c] });
      if (G.drawn >= MAX_DRAWS && !hand.some((x) => playable(G, x))) { G.drawn = 0; ctx.endTurn(nextAfter(G, ctx.player)); }
    },

    /** Pass: only after drawing (or when nothing is left to draw). */
    pass(G, ctx) {
      if (G.draw > 0) ctx.fail(`draw ${G.draw} cards`);
      if (G.drawn === 0 && cardsLeft(G) > 0) ctx.fail('draw a card first');
      ctx.emit('passed', { player: ctx.player });
      G.drawn = 0; ctx.endTurn(nextAfter(G, ctx.player));
    },
  },

  view(G, player, meta) {
    const over = !!meta.over;
    return {
      you: player, order: G.order, current: meta.current,
      hand: player && G.hands[player] ? [...G.hands[player]] : [],
      counts: Object.fromEntries(G.order.map((p) => [p, G.hands[p].length])),
      ...(over ? { hands: G.hands } : {}), // everyone's cards are shown at the end
      top: top(G), suit: G.suit, discardCount: G.discard.length, deckCount: G.deck.length,
      draw: G.draw, drawn: G.drawn, direction: G.direction,
    };
  },

  endIf(G) {
    if (!G.winner) return null;
    const scores = Object.fromEntries(G.order.map((p) => [p, 0]));
    scores[G.winner] = G.order.reduce((sum, p) => sum + G.hands[p].reduce((a, c) => a + points(c), 0), 0);
    return { winners: [G.winner], scores, reason: 'went out' };
  },

  legalMoves(G, player) {
    const hand = G.hands[player] ?? [], out = [];
    for (const card of hand) {
      if (!playable(G, card)) continue;
      if (rankOf(card) === EIGHT) for (let suit = 0; suit < 4; suit++) out.push({ move: 'play', arg: { card, suit } });
      else out.push({ move: 'play', arg: { card } });
    }
    if (G.draw > 0) { out.push({ move: 'draw' }); return out; }
    if (G.drawn < MAX_DRAWS && cardsLeft(G) > 0 && !hand.some((x) => playable(G, x))) out.push({ move: 'draw' });
    if (G.drawn > 0 || cardsLeft(G) === 0) out.push({ move: 'pass' });
    return out;
  },

  /** A reasonable player: shed expensive cards first, keep eights for last, name the suit it holds most of, draw only when stuck. */
  bot({ view, legal }) {
    const plays = legal.filter((m) => m.move === 'play');
    const plain = plays.filter((m) => rankOf(m.arg.card) !== EIGHT);
    if (plain.length) {
      const suitCount = [0, 0, 0, 0]; for (const c of view.hand) suitCount[suitOf(c)]++;
      const score = (m) => points(m.arg.card) * 10 + suitCount[suitOf(m.arg.card)];     // get rid of high cards, keep long suits
      return plain.reduce((best, m) => (score(m) > best.s ? { s: score(m), m } : best), { s: -1, m: null }).m;
    }
    if (plays.length) { // only eights: name the suit we hold most of among the other cards
      const counts = [0, 0, 0, 0]; for (const c of view.hand) if (rankOf(c) !== EIGHT) counts[suitOf(c)]++;
      const suit = counts.indexOf(Math.max(...counts));
      return plays.find((m) => m.arg.suit === suit) ?? plays[0];
    }
    return legal.find((m) => m.move === 'draw') ?? legal.find((m) => m.move === 'pass') ?? null;
  },
  onTimeout(G, player, players) {
    // a player who ran out of time gets what a robot would do
    const view = crazyEights.view(G, player, { over: null, current: player, players, seq: 0 });
    return crazyEights.bot({ view, legal: crazyEights.legalMoves(G, player, players) });
  },
});
