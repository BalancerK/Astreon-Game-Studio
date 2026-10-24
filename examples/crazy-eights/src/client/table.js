// The table: where everything is (`layout`), how it is drawn, and what a click means.
// It reads a `TurnClient` and draws; it never decides anything: the room does, and a click only ever asks the room for a move.
import { SpriteBatch, Camera, Font, packTint } from '../../../../packages/render/src/index.js';
import { SUIT_SYMBOLS, RANK_LABELS, suitOf, rankOf, isRed, cardName, EIGHT } from '../cards.js';

export const CARD_W = 80;                           // the size of a card in the atlas
export const CARD_H = 112;
const BACK = 52;                                    // the sprite index of a card's back
const SUIT_COLORS = ['#202633', '#d8383f', '#d8383f', '#202633'];

const WHITE = packTint(255, 255, 255);
const GOLD = packTint(255, 236, 140);
const suitTint = (suit) => (isRed(suit * 13) ? packTint(216, 56, 63) : packTint(32, 38, 51));

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** One card face: a rounded card, the rank and suit in the corner, and a big suit in the middle. */
function drawFace(g, c, x, y, w, h) {
  g.fillStyle = '#fbfaf5';
  roundRect(g, x + 2, y + 2, w - 4, h - 4, 9);
  g.fill();
  g.strokeStyle = '#b9b6aa';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = SUIT_COLORS[suitOf(c)];
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = 'bold 22px system-ui, sans-serif';
  g.fillText(RANK_LABELS[rankOf(c)], x + 9, y + 7);
  g.font = '20px system-ui, sans-serif';
  g.fillText(SUIT_SYMBOLS[suitOf(c)], x + 9, y + 31);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${rankOf(c) === EIGHT ? 'bold 52' : '46'}px system-ui, sans-serif`;     // an 8 is wild: a bigger suit
  g.fillText(SUIT_SYMBOLS[suitOf(c)], x + w / 2 + 6, y + h / 2 + 12);
}

/** The back of a card: blue with a border and a chequered pattern. */
function drawBack(g, x, y, w, h) {
  g.fillStyle = '#2f4a8f';
  roundRect(g, x + 2, y + 2, w - 4, h - 4, 9);
  g.fill();
  g.strokeStyle = '#e8e4d4';
  g.lineWidth = 3;
  roundRect(g, x + 8, y + 8, w - 16, h - 16, 6);
  g.stroke();
  g.fillStyle = '#4d6cc0';
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 7; j++) {
      if ((i + j) % 2 === 0) g.fillRect(x + 14 + i * 10, y + 14 + j * 12, 9, 11);
    }
  }
}

/**
 * Draw the 52 faces and the back into the atlas.
 * @returns {Array<{u0: number, v0: number, u1: number, v1: number}>} sprites 0..51, then the back (52); `dot` and `px` are plain shapes
 */
export function makeCardSprites(atlas) {
  const sprites = [];
  for (let c = 0; c < 52; c++) sprites.push(atlas.add(`card${c}`, CARD_W, CARD_H, (g, x, y, w, h) => drawFace(g, c, x, y, w, h)));
  sprites.push(atlas.add('back', CARD_W, CARD_H, drawBack));
  sprites.dot = atlas.add('dot', 16, 16, (g, x, y, w) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x + w / 2, y + w / 2, w / 2 - 1, 0, Math.PI * 2);
    g.fill();
  });
  sprites.px = atlas.add('px', 8, 8, (g, x, y, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(x, y, w, h);
  });
  return sprites;
}

const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (r, x, y) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export class Table {
  /**
   * @param {object} o
   * @param {import('../../../../packages/turns/src/index.js').TurnClient} o.client
   * @param {any[]} o.sprites from `makeCardSprites`
   * @param {Font} o.font
   * @param {(msg: string) => void} [o.onToast]
   */
  constructor({ client, sprites, font, onToast = () => {} }) {
    this.client = client;
    this.sprites = sprites;
    this.font = font;
    this.onToast = onToast;
    this.batch = new SpriteBatch(2048);
    this.camera = new Camera();
    this.w = 800;
    this.h = 600;
    this.pointer = { x: -1, y: -1 };
    /** @type {number | null} an 8 waiting for its suit */
    this.pendingEight = null;
    this.flights = [];                 // cards moving from one place to another
    this.toasts = [];                  // short messages
    this.lastHand = new Map();         // where each of my cards was drawn, so a played card flies from there
    this.layout = this.#layout();
    client.onEvents = (events, msg) => this.#onEvents(events, msg);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.camera.setScreenSpace(w, h);
  }

  // ---- where things are ----
  #layout() {
    const { w, h, client } = this;
    const v = client.view;
    const s = Math.max(0.55, Math.min(1.25, Math.min(w / 900, h / 640)));
    const cw = CARD_W * s;
    const ch = CARD_H * s;
    const L = { w, h, s, cw, ch, deck: null, discard: null, hand: [], seats: [], buttons: [], suits: null, over: !!client.over };
    L.deck = { x: w / 2 - cw * 0.95, y: h * 0.45 - ch / 2, w: cw, h: ch };
    L.discard = { x: w / 2 + cw * 0.15, y: h * 0.45 - ch / 2, w: cw, h: ch };
    if (!v) return L;
    const legal = client.legal ?? [];
    this.#layoutHand(L, v, legal);
    this.#layoutSeats(L, v);
    this.#layoutControls(L, legal);
    return L;
  }

  /** My hand: a fan along the bottom, playable cards raised, the one under the pointer raised more. */
  #layoutHand(L, v, legal) {
    const { w, h, client } = this;
    const { s, cw, ch } = L;
    const playable = new Set(legal.filter((m) => m.move === 'play').map((m) => m.arg.card));
    const n = v.hand.length;
    const span = Math.min(w - 120 * s, n * cw * 0.62 + cw * 0.4);
    const step = n > 1 ? (span - cw) / (n - 1) : 0;
    const x0 = (w - (step * (n - 1) + cw)) / 2;
    const hover = this.#handAt(this.pointer.x, this.pointer.y, x0, step, cw, ch, n);
    v.hand.forEach((card, i) => {
      const can = playable.has(card) && client.myTurn;
      const raise = (can ? 14 * s : 0) + (i === hover && can ? 12 * s : 0);
      L.hand.push({ card, x: x0 + i * step, y: h - ch - 18 * s - raise, w: cw, h: ch, playable: can, hover: i === hover });
    });
    L.me = { id: client.you, name: client.nameOf(client.you), count: n, current: v.current === client.you, x: w / 2, y: h - ch - 44 * s };
  }

  /** The other players, round the table in turn order starting after me. */
  #layoutSeats(L, v) {
    const { w, h, client } = this;
    const s = L.s;
    const order = v.order;
    const me = Math.max(0, order.indexOf(client.you));
    const others = Array.from({ length: order.length - 1 }, (_, k) => order[(me + 1 + k) % order.length]);
    const top = { x: w / 2, y: 70 * s + 18, a: 0 };
    const spots = [
      [top],
      [{ x: w * 0.2, y: h * 0.32, a: 90 }, { x: w * 0.8, y: h * 0.32, a: -90 }],
      [{ x: w * 0.14, y: h * 0.42, a: 90 }, top, { x: w * 0.86, y: h * 0.42, a: -90 }],
    ][others.length - 1] ?? [];
    others.forEach((id, i) => {
      const player = client.players.find((p) => p.id === id);
      L.seats.push({
        id, name: client.nameOf(id), count: v.counts[id] ?? 0, current: v.current === id,
        connected: player?.connected !== false, ...spots[i],
      });
    });
  }

  /** The Pass button, and the four suits to choose from after playing an 8. */
  #layoutControls(L, legal) {
    const { w, h, client } = this;
    const s = L.s;
    if (legal.some((m) => m.move === 'pass') && client.myTurn) {
      L.buttons.push({ id: 'pass', label: 'Pass', x: w - 120 * s - 20, y: h - 70 * s - 40, w: 120 * s, h: 44 * s });
    }
    if (this.pendingEight !== null) {
      const size = 86 * s;
      const gap = 14 * s;
      const total = 4 * size + 3 * gap;
      L.suits = [0, 1, 2, 3].map((suit) => ({ suit, x: (w - total) / 2 + suit * (size + gap), y: h * 0.45 - size / 2, w: size, h: size }));
    }
  }

  /** Which card of my hand is at this point (the one on top of the fan), or -1. */
  #handAt(px, py, x0, step, cw, ch, n) {
    if (px < 0) return -1;
    const top = this.h - ch - 60 * (this.layout?.s ?? 1);
    for (let i = n - 1; i >= 0; i--) {
      const x = x0 + i * step;
      const width = i === n - 1 ? cw : Math.max(step, 1);      // a covered card shows only its left edge
      if (px >= x && px <= x + width && py >= top && py <= this.h) return i;
    }
    return -1;
  }

  // ---- what a click means ----
  /** A pointer press at (x, y): ask the room for a move if the click means one. @returns {Promise<string> | string} what was done */
  click(x, y) {
    const L = this.layout = this.#layout();
    const c = this.client;
    const hit = (r) => inside(r, x, y);
    if (c.state === 'over' || !c.view) return 'nothing';
    if (L.suits) return this.#clickSuit(L, hit);
    const button = L.buttons.find(hit);
    if (button) return this.#send(button.id);
    if (hit(L.deck)) return this.#clickDeck();
    return this.#clickHand(L, x, y);
  }

  #clickSuit(L, hit) {
    const chosen = L.suits.find(hit);
    if (!chosen) {
      this.pendingEight = null;
      return 'cancelled';
    }
    const card = this.pendingEight;
    this.pendingEight = null;
    return this.#send('play', { card, suit: chosen.suit });
  }

  #clickDeck() {
    const c = this.client;
    if (!c.myTurn) return this.#refuse('Not your turn', 'not your turn');
    if (c.legal.some((m) => m.move === 'draw')) return this.#send('draw');
    return this.#refuse('You have a card to play', 'must play');
  }

  #clickHand(L, x, y) {
    const c = this.client;
    for (let i = L.hand.length - 1; i >= 0; i--) {
      const rect = L.hand[i];
      const right = i < L.hand.length - 1 ? rect.x + Math.max(1, L.hand[i + 1].x - rect.x) : rect.x + rect.w;   // not covered by the next card
      const hitsCard = x >= rect.x && x <= right && y >= rect.y && y <= rect.y + rect.h;
      if (!hitsCard) continue;
      if (!c.myTurn) return this.#refuse('Not your turn', 'not your turn');
      if (!rect.playable) {
        const why = c.view.draw > 0 ? `Play a 2 or draw ${c.view.draw}` : `${cardName(rect.card)} does not match`;
        return this.#refuse(why, 'not playable');
      }
      if (rankOf(rect.card) === EIGHT) {
        this.pendingEight = rect.card;                // an 8 asks for a suit before it is played
        return 'choose a suit';
      }
      return this.#send('play', { card: rect.card });
    }
    return 'nothing';
  }

  #refuse(message, result) {
    this.#toast(message);
    return result;
  }

  #send(move, arg) {
    return this.client.move(move, arg).then(() => move, (e) => {
      this.#toast(e.message);
      return `refused: ${e.message}`;
    });
  }

  // ---- events: toasts and cards in flight ----
  #toast(text) {
    this.toasts.push({ text, at: performance.now() });
    if (this.toasts.length > 4) this.toasts.shift();
    this.onToast(text);
  }

  #fly(from, to, face, dur = 380) {
    this.flights.push({ from, to, face, t0: performance.now(), dur });
  }

  #seatPos(id) {
    const seat = this.layout.seats.find((s) => s.id === id);
    return seat ? { x: seat.x, y: seat.y } : { x: this.w / 2, y: this.h - 80 };
  }

  #onEvents(events) {
    const c = this.client;
    const L = this.layout = this.#layout();
    for (const e of events) {
      const d = e.data;
      switch (e.e) {
        case 'start':
          this.#toast('Game on!');
          break;
        case 'played': {
          const own = d.player === c.you;
          const from = own ? (this.lastHand.get(d.card) ?? { x: this.w / 2, y: this.h - 100 }) : this.#seatPos(d.player);
          this.#fly(from, centre(L.discard), d.card);
          if (rankOf(d.card) === EIGHT) this.#toast(`${c.nameOf(d.player)} chose ${SUIT_SYMBOLS[d.suit]}`);
          break;
        }
        case 'drew':
          if (d.player !== c.you) {                   // backs fly from the deck to that player, one after another
            for (let i = 0; i < Math.min(d.count, 4); i++) {
              setTimeout(() => this.#fly(centre(L.deck), this.#seatPos(d.player), null, 320), i * 90);
            }
          }
          if (d.penalty) this.#toast(`${c.nameOf(d.player)} draws ${d.count}`);
          break;
        case 'got':                                   // my own new cards, face up
          d.cards.forEach((card, i) => {
            setTimeout(() => this.#fly(centre(L.deck), { x: this.w / 2, y: this.h - 90 }, card, 320), i * 90);
          });
          break;
        case 'skipped':
          this.#toast(`${c.nameOf(d.player)} is skipped`);
          break;
        case 'reversed':
          this.#toast('Direction reversed');
          break;
        case 'penalty':
          this.#toast(`Next player draws ${d.cards}`);
          break;
        case 'reshuffled':
          this.#toast('The discards are shuffled back in');
          break;
        case 'passed':
          this.#toast(`${c.nameOf(d.player)} passes`);
          break;
        default:
          break;
      }
    }
  }

  // ---- drawing ----
  /** Fill the batch with the table as it is now. Call every frame, then render `batch` with `camera`. */
  draw(now = performance.now()) {
    const { batch, client: c } = this;
    batch.clear();
    const L = this.layout = this.#layout();
    this.#drawFelt();
    if (!c.view) {
      this.#drawWaiting();
      return batch;
    }
    this.#drawSeats(L);
    this.#drawPiles(L, c.view);
    this.#drawHand(L);
    this.#drawTurnTimer();
    this.#drawButtons(L);
    if (L.suits) this.#drawSuitChooser(L);
    this.#drawFlights(L, now);
    this.#drawToasts(L, now);
    if (c.state === 'over' && c.over) this.#drawEnd(L, c.view);
    return batch;
  }

  /** A text on the batch: centred unless told otherwise. */
  #say(text, x, y, size, tint, shadow = true) {
    const options = { align: 'center', size, tint };
    if (shadow) options.shadow = {};
    this.font.draw(this.batch, text, x, y, options);
  }

  #card(index, x, y, w, h, tint = WHITE, rotation = 0) {
    this.batch.push(x + w / 2, y + h / 2, w, h, rotation, this.sprites[index], tint);
  }

  #drawFelt() {
    const { batch, sprites, w, h } = this;
    batch.push(w / 2, h / 2, w, h, 0, sprites.px, packTint(24, 94, 62));
    batch.push(w / 2, h * 0.45, Math.min(w * 0.62, 640), Math.min(h * 0.5, 280), 0, sprites.dot, packTint(28, 108, 72));
  }

  /** What to say before the game has a view: connecting, waiting for players, reconnecting, closed. */
  #drawWaiting() {
    const c = this.client;
    const here = c.players.filter((p) => !p.bot).length;
    const texts = {
      closed: c.closeReason || 'Disconnected',
      waiting: `Waiting for players… ${here} here`,
      reconnecting: 'Reconnecting…',
    };
    this.#say(texts[c.state] ?? 'Connecting…', this.w / 2, this.h / 2 - 10, 26, undefined);
    if (this.hint) this.#say(this.hint, this.w / 2, this.h / 2 + 30, 20, packTint(255, 232, 130));
  }

  /** The others: fanned backs, a name, a glow on whoever's turn it is. */
  #drawSeats(L) {
    const { batch, sprites } = this;
    for (const seat of L.seats) {
      const n = Math.min(seat.count, 9);
      const cw = L.cw * 0.55;
      const ch = L.ch * 0.55;
      const rotation = (seat.a * Math.PI) / 180;
      const horizontal = seat.a === 0;
      if (seat.current) batch.push(seat.x, seat.y, cw * 3.2, ch * 1.9, 0, sprites.dot, packTint(255, 226, 120, 70));
      for (let i = 0; i < n; i++) {
        const offset = (i - (n - 1) / 2) * cw * 0.28;
        batch.push(seat.x + (horizontal ? offset : 0), seat.y + (horizontal ? 0 : offset), cw, ch, rotation, sprites[BACK], WHITE);
      }
      const name = `${seat.name}${seat.connected ? '' : ' (away)'}`;
      this.#say(name, seat.x, seat.y + ch * 0.75 + (horizontal ? 4 : 0), 16 * Math.max(L.s, 0.8), seat.current ? GOLD : packTint(240, 240, 240));
      this.#say(`${seat.count}`, seat.x, seat.y - 8, 18 * L.s, WHITE);
    }
  }

  /** The deck and the discard pile, and which suit is being asked for. */
  #drawPiles(L, v) {
    const { batch, sprites } = this;
    const { deck, discard } = L;
    const layers = Math.min(5, Math.ceil(v.deckCount / 8));          // a taller stack for a bigger deck
    for (let i = 0; i < layers; i++) {
      batch.push(deck.x + deck.w / 2 - i * 1.5, deck.y + deck.h / 2 - i * 1.5, deck.w, deck.h, 0, sprites[BACK], WHITE);
    }
    if (v.deckCount === 0) batch.push(deck.x + deck.w / 2, deck.y + deck.h / 2, deck.w, deck.h, 0, sprites.dot, packTint(0, 0, 0, 60));
    this.#card(v.top, discard.x, discard.y, discard.w, discard.h);
    const sx = discard.x + discard.w + 34 * L.s;
    const sy = discard.y + discard.h / 2;
    batch.push(sx, sy, 56 * L.s, 56 * L.s, 0, sprites.dot, packTint(250, 248, 240));
    this.#say(SUIT_SYMBOLS[v.suit], sx, sy - 20 * L.s, 36 * L.s, suitTint(v.suit), false);
    this.#say(`${v.deckCount}`, deck.x + deck.w / 2, deck.y + deck.h + 6, 14 * L.s, packTint(220, 240, 225));
    if (v.draw > 0) this.#say(`+${v.draw}`, discard.x + discard.w / 2, discard.y - 30 * L.s, 30 * L.s, packTint(255, 140, 120));
  }

  #drawHand(L) {
    const c = this.client;
    this.lastHand.clear();
    for (const h of L.hand) {
      this.lastHand.set(h.card, { x: h.x + h.w / 2, y: h.y + h.h / 2 });
      const dim = c.myTurn && !h.playable ? 150 : 255;               // cards that cannot be played are dimmed on my turn
      this.#card(h.card, h.x, h.y, h.w, h.h, packTint(dim, dim, dim));
    }
    if (L.me) {
      const label = `${L.me.name}${L.me.current ? '  — your turn' : ''}`;
      this.#say(label, L.me.x, L.me.y - 6, 17 * Math.max(L.s, 0.8), L.me.current ? GOLD : packTint(235, 235, 235));
    }
  }

  /** A bar across the top that shrinks as the turn time runs out, red at the end. */
  #drawTurnTimer() {
    const c = this.client;
    const left = c.turnLeftMs();
    if (left === null || !c.turnMs) return;
    const fraction = Math.max(0, Math.min(1, left / c.turnMs));
    const tint = fraction < 0.25 ? packTint(235, 90, 80) : packTint(240, 214, 100);
    this.batch.push(this.w / 2, 4, this.w * fraction, 6, 0, this.sprites.px, tint);
  }

  #drawButtons(L) {
    for (const b of L.buttons) {
      this.batch.push(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 0, this.sprites.dot, packTint(240, 214, 100));
      this.#say(b.label, b.x + b.w / 2, b.y + b.h / 2 - 9 * L.s, 20 * L.s, packTint(40, 40, 30), false);
    }
  }

  /** Choosing a suit for an 8: the table dims and four big suits appear. */
  #drawSuitChooser(L) {
    const { batch, sprites } = this;
    batch.push(this.w / 2, this.h / 2, this.w, this.h, 0, sprites.px, packTint(0, 0, 0, 120));
    this.#say('Choose a suit', this.w / 2, L.suits[0].y - 44 * L.s, 26 * L.s, undefined);
    for (const b of L.suits) {
      batch.push(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 0, sprites.dot, packTint(250, 248, 240));
      this.#say(SUIT_SYMBOLS[b.suit], b.x + b.w / 2, b.y + b.h / 2 - 28 * L.s, 56 * L.s, suitTint(b.suit), false);
    }
  }

  /** Cards on their way from one place to another: eased, with a little hop and turn. */
  #drawFlights(L, now) {
    this.flights = this.flights.filter((f) => now - f.t0 < f.dur);
    for (const f of this.flights) {
      const t = Math.min(1, (now - f.t0) / f.dur);
      const ease = 1 - (1 - t) * (1 - t);
      const x = f.from.x + (f.to.x - f.from.x) * ease;
      const y = f.from.y + (f.to.y - f.from.y) * ease - Math.sin(t * Math.PI) * 24;
      this.batch.push(x, y, L.cw, L.ch, (1 - ease) * 0.3, this.sprites[f.face === null ? BACK : f.face], WHITE);
    }
  }

  /** Short messages that fade out. */
  #drawToasts(L, now) {
    this.toasts = this.toasts.filter((t) => now - t.at < 2600);
    this.toasts.forEach((t, i) => {
      const alpha = Math.round(255 * Math.min(1, (2600 - (now - t.at)) / 600));
      this.#say(t.text, this.w / 2, this.h * 0.72 - i * 26, 18 * Math.max(L.s, 0.85), packTint(255, 255, 255, alpha));
    });
  }

  /** The result: who won, and what everyone had left. */
  #drawEnd(L, v) {
    const c = this.client;
    this.batch.push(this.w / 2, this.h / 2, this.w, this.h, 0, this.sprites.px, packTint(0, 0, 0, 150));
    const winner = c.over.winners[0];
    const you = winner === c.you;
    this.#say(you ? 'You win!' : `${c.nameOf(winner)} wins`, this.w / 2, this.h * 0.28, 46 * L.s, you ? packTint(255, 232, 130) : WHITE);
    const scores = c.over.scores ?? {};
    c.players.forEach((p, i) => {
      const left = v.hands?.[p.id]?.length ?? 0;
      const points = scores[p.id] ? `   +${scores[p.id]} points` : '';
      const text = `${p.name}${p.id === winner ? '  🏆' : ''}   ${left} cards left${points}`;
      this.#say(text, this.w / 2, this.h * 0.4 + i * 30 * L.s, 20 * L.s, undefined);
    });
  }
}
