// The network lab's brain: a tiny online game (one player you steer, one bot that circles) run over the engine's own simulated network, so you can feel what
// lag, jitter and lost packets do and what prediction, reconciliation and interpolation do about it. It is built from the engine's pieces (MemoryNetwork with
// a VirtualClock, LinkSimulator conditions, PacketLog, TimeSeries) and drives itself with `advance(ms)`, so it is exact and repeatable and runs in Node tests.
//
//   client (you)  --INPUT 7 bytes, 30 a second-->  server (the truth)
//   client (you)  <--SNAPSHOT 25 bytes, 30 a second--  server
//
// The server alone decides where things are. The client guesses ahead (prediction), fixes its guess when the truth arrives (reconciliation), and draws the
// bot a little in the past between two snapshots (interpolation). The server also pushes the player now and then (a "gust") in a way the client cannot know,
// so a wrong guess can be seen and its correction watched.
import { MemoryNetwork, CHANNEL } from '../../packages/transport/src/index.js';
import { PacketLog, TimeSeries } from '../../packages/debug/src/index.js';

export const TICK_MS = 1000 / 30;
export const ARENA = { w: 480, h: 320 };
const SPEED = 140;                        // pixels per second
const MSG = { INPUT: 1, SNAPSHOT: 2 };
const TYPE_NAME = { [MSG.INPUT]: 'INPUT', [MSG.SNAPSHOT]: 'SNAPSHOT' };

const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** One step of the player's movement: the same rule on the server and in the client's guess. */
export function moveStep(p, dx, dy) {
  const k = dx && dy ? Math.SQRT1_2 : 1;
  return { x: clampTo(p.x + dx * k * SPEED / 30, 8, ARENA.w - 8), y: clampTo(p.y + dy * k * SPEED / 30, 8, ARENA.h - 8) };
}

/** Where the server's bot is at a server tick: a steady circle. */
export function botAt(tick) {
  const a = (tick / 30) * 1.1;
  return { x: ARENA.w / 2 + Math.cos(a) * 110, y: ARENA.h / 2 + Math.sin(a) * 80 };
}

const encodeInput = (seq, dx, dy) => {
  const b = new Uint8Array(7);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.INPUT); v.setUint32(1, seq); v.setInt8(5, dx); v.setInt8(6, dy);
  return b;
};
const encodeSnapshot = (tick, ack, p, bot) => {
  const b = new Uint8Array(25);
  const v = new DataView(b.buffer);
  v.setUint8(0, MSG.SNAPSHOT); v.setUint32(1, tick); v.setUint32(5, ack);
  v.setFloat32(9, p.x); v.setFloat32(13, p.y); v.setFloat32(17, bot.x); v.setFloat32(21, bot.y);
  return b;
};

/**
 * @typedef {Object} LabSettings
 * @property {number} latencyMs one-way delay, each direction (the round trip is twice this)
 * @property {number} jitterMs extra random delay up to this much
 * @property {number} loss chance a packet is lost, 0 to 1
 * @property {boolean} prediction guess ahead instead of waiting for the server
 * @property {boolean} smoothing ease a correction in instead of jumping
 * @property {boolean} interpolation draw the bot between two snapshots, a little in the past
 */

export class NetLab {
  /** @param {Partial<LabSettings> & {seed?: number}} [o] */
  constructor({ seed = 1, ...settings } = {}) {
    /** @type {LabSettings} */
    this.settings = { latencyMs: 60, jitterMs: 10, loss: 0, prediction: true, smoothing: true, interpolation: true, ...settings };
    this.network = new MemoryNetwork({ seed });
    this.clock = this.network.clock;
    this.packets = new PacketLog(60);
    this.errorSeries = new TimeSeries(240);      // how far the guess was from the truth when a snapshot arrived, in pixels
    this.lagSeries = new TimeSeries(240);        // how far what you see is behind what you have just asked for, in pixels
    this.rttSeries = new TimeSeries(240);        // the round trip, from sending an input to hearing it was used, in milliseconds
    this.server = { tick: 0, player: { x: 80, y: 160 }, input: { dx: 0, dy: 0 }, lastSeq: 0 };
    this.client = {
      seq: 0, input: { dx: 0, dy: 0 }, predicted: { x: 80, y: 160 }, shown: { x: 80, y: 160 }, offset: { x: 0, y: 0 }, truth: { x: 80, y: 160 },
      pending: [], sentAt: new Map(), snapshots: [], lastTick: 0, bot: { x: 0, y: 0 },
    };
    this.counters = { inputsSent: 0, snapshotsSeen: 0, bytesOut: 0, bytesIn: 0, mispredictions: 0 };
    this.nextTick = TICK_MS;
    this.#connect();
    this.applySettings();
  }

  #connect() {
    const listener = this.network.listen('lab');
    listener.onConnection = (transport) => {
      this.serverEnd = transport;
      transport.onMessage = (bytes) => this.#serverReceive(bytes);
    };
    this.clientEnd = this.network.connect('lab');
    this.clientEnd.onMessage = (bytes) => this.#clientReceive(bytes);
    this.clock.runUntil(this.clock.now());
  }

  /** Change the network or the tricks (takes effect at once). */
  set(changes) {
    Object.assign(this.settings, changes);
    this.applySettings();
  }

  applySettings() {
    const { latencyMs, jitterMs, loss } = this.settings;
    for (const end of [this.clientEnd, this.clientEnd?.peer]) {
      if (end?.outLink) Object.assign(end.outLink.config, { latencyMs, jitterMs, loss });
    }
  }

  /** The direction keys held: -1, 0 or 1 on each axis. */
  steer(dx, dy) {
    this.client.input = { dx: clampTo(Math.trunc(dx), -1, 1), dy: clampTo(Math.trunc(dy), -1, 1) };
  }

  /** The server pushes the player (something only the server knows about). */
  gust(dx = 1, dy = 0) {
    const s = this.server;
    s.player = { x: clampTo(s.player.x + dx * 50, 8, ARENA.w - 8), y: clampTo(s.player.y + dy * 50, 8, ARENA.h - 8) };
  }

  /** Run the lab forward by some milliseconds of its own time. */
  advance(ms) {
    const target = this.clock.now() + ms;
    while (this.nextTick <= target) {
      this.clock.runUntil(this.nextTick);
      this.#clientTick();
      this.#serverTick();
      this.nextTick += TICK_MS;
    }
    this.clock.runUntil(target);
    this.#settleView();
  }

  // ---- the client ----
  #clientTick() {
    const c = this.client;
    c.seq++;
    const { dx, dy } = c.input;
    c.pending.push({ seq: c.seq, dx, dy });
    if (c.pending.length > 120) c.pending.shift();
    c.sentAt.set(c.seq, this.clock.now());
    if (c.sentAt.size > 200) c.sentAt.delete(c.sentAt.keys().next().value);
    const bytes = encodeInput(c.seq, dx, dy);
    this.clientEnd.send(bytes, CHANNEL.UNRELIABLE);
    this.counters.inputsSent++;
    this.counters.bytesOut += bytes.length;
    this.packets.add({ time: this.clock.now(), dir: 'out', type: 'INPUT', size: bytes.length, detail: `seq ${c.seq}` });
    c.predicted = moveStep(c.predicted, dx, dy);                 // guess ahead, as if the server will agree
  }

  #clientReceive(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint8(0) !== MSG.SNAPSHOT) return;
    const c = this.client;
    const snap = { tick: v.getUint32(1), ack: v.getUint32(5), p: { x: v.getFloat32(9), y: v.getFloat32(13) }, bot: { x: v.getFloat32(17), y: v.getFloat32(21) }, at: this.clock.now() };
    this.counters.snapshotsSeen++;
    this.counters.bytesIn += bytes.length;
    this.packets.add({ time: snap.at, dir: 'in', type: TYPE_NAME[MSG.SNAPSHOT], size: bytes.length, detail: `tick ${snap.tick}, ack ${snap.ack}` });
    if (snap.tick <= c.lastTick) return;                           // an old one that arrived late
    c.lastTick = snap.tick;
    c.truth = snap.p;
    const sent = c.sentAt.get(snap.ack);
    if (sent !== undefined) this.rttSeries.push(snap.at - sent);
    c.snapshots.push(snap);
    if (c.snapshots.length > 40) c.snapshots.shift();
    // reconciliation: take the server's position for the last input it used, then redo the inputs it has not seen yet
    c.pending = c.pending.filter((i) => i.seq > snap.ack);
    let p = snap.p;
    for (const i of c.pending) p = moveStep(p, i.dx, i.dy);
    const error = dist(p, c.predicted);
    this.errorSeries.push(error);
    if (error > 1.5) this.counters.mispredictions++;
    if (this.settings.smoothing) { c.offset = { x: c.offset.x + (c.predicted.x - p.x), y: c.offset.y + (c.predicted.y - p.y) }; }
    else c.offset = { x: 0, y: 0 };
    c.predicted = p;
  }

  /** What the client draws now: its own player and the bot. */
  #settleView() {
    const c = this.client;
    c.offset = { x: c.offset.x * 0.82, y: c.offset.y * 0.82 };
    if (Math.hypot(c.offset.x, c.offset.y) < 0.05) c.offset = { x: 0, y: 0 };
    c.shown = this.settings.prediction ? { x: c.predicted.x + c.offset.x, y: c.predicted.y + c.offset.y } : { ...c.truth };
    c.bot = this.#botView();
    this.lagSeries.push(dist(c.shown, c.predicted));
  }

  #botView() {
    const snaps = this.client.snapshots;
    if (!snaps.length) return { x: ARENA.w / 2, y: ARENA.h / 2 };
    if (!this.settings.interpolation) return { ...snaps.at(-1).bot };
    // draw the bot as it was 100 ms ago, between the two snapshots on either side of that moment (their own clock: tick numbers)
    const latest = snaps.at(-1);
    const renderTick = latest.tick - 3 + ((this.clock.now() - latest.at) / TICK_MS);
    let a = snaps[0];
    let b = snaps[0];
    for (const s of snaps) { if (s.tick <= renderTick) a = s; if (s.tick >= renderTick) { b = s; break; } b = s; }
    if (a === b || b.tick === a.tick) return { ...a.bot };
    const t = clampTo((renderTick - a.tick) / (b.tick - a.tick), 0, 1);
    return { x: a.bot.x + (b.bot.x - a.bot.x) * t, y: a.bot.y + (b.bot.y - a.bot.y) * t };
  }

  // ---- the server ----
  #serverReceive(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint8(0) !== MSG.INPUT) return;
    const seq = v.getUint32(1);
    if (seq <= this.server.lastSeq) return;                        // a duplicate or an old one
    this.server.lastSeq = seq;
    this.server.input = { dx: v.getInt8(5), dy: v.getInt8(6) };
  }

  #serverTick() {
    const s = this.server;
    s.tick++;
    s.player = moveStep(s.player, s.input.dx, s.input.dy);
    if (this.serverEnd?.state === 'open') this.serverEnd.send(encodeSnapshot(s.tick, s.lastSeq, s.player, botAt(s.tick)), CHANNEL.UNRELIABLE);
  }

  /** What the lab reports: for the numbers beside the picture. */
  report() {
    const up = this.clientEnd.outLink.stats;
    const down = this.clientEnd.peer.outLink.stats;
    const secs = Math.max(0.001, this.clock.now() / 1000);
    return {
      rtt: this.rttSeries.stats(30), error: this.errorSeries.stats(30), lag: this.lagSeries.stats(30),
      sent: { packets: up.sent, lost: up.dropped }, received: { packets: down.sent - down.dropped, lost: down.dropped },
      bytesPerSecond: { out: Math.round(this.counters.bytesOut / secs), in: Math.round(this.counters.bytesIn / secs) },
      mispredictions: this.counters.mispredictions, time: this.clock.now(),
    };
  }
}
