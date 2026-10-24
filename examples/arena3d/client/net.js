// Client networking for the 3D arena: handshake, snapshot decoding with acks, input sending, prediction of your own movement
// and shots. No DOM, so it runs in browsers and in Node (tests, bots).
import {
  BinaryWriter, BinaryReader, ProtocolError, MissingBaselineError, SnapshotCodec, SnapshotHistory, InputBatch,
  MSG, packetType, encodeHello, decodeWelcome, decodeReject, encodeInput, readSnapshotHeader,
} from '../../../packages/protocol/src/index.js';
import { connectWebSocket, CHANNEL } from '../../../packages/transport/src/index.js';
import { InterpolationClock } from '../../../packages/client/src/index.js';
import { netSchema, inputSchema, BUTTON_FIRE, BODY, eyeY, lookDirection } from '../shared/game.js';
import { buildArenaLevel } from '../shared/level.js';
import { decodeEvent, EVENT } from '../shared/events.js';
import { traceShot } from '../shared/shot.js';
import { wrapAngle } from '../../../packages/math/src/index.js';
import { verifyClientView, mergeRuleSets } from '../../../packages/mods/src/index.js';
import { createRules, applyRules, sanitizeClientData } from '../shared/rules.js';
import { sampleWorld, createSampleBuffer } from './interp.js';
import { PredictedPlayer3D } from './predict.js';

/** Browser default: the mod endpoint on the same origin as the page. */
async function defaultFetchMod(id, hash) {
  const res = await fetch(`/mods/${id}/${hash}`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`download of "${id}" failed (${res.status})`);
  return res.json();
}
const MAX_ENTITIES = 4096;
const REDUNDANCY = 3; // each input packet repeats the last 3 inputs, so a lost packet costs nothing
const [posComp, , motionComp] = netSchema.comps;
const [fx, fy, fz] = posComp.fields;
const [fvy, fgrounded] = motionComp.fields;
const yawCodec = inputSchema.codecs[inputSchema.names.indexOf('yaw')];
const pitchCodec = inputSchema.codecs[inputSchema.names.indexOf('pitch')];
const toWire = (codec, v) => codec.dequantize(codec.quantize(v)); // the value the server will see

export class Arena3dClient {
  /**
   * @param {object} o
   * @param {string} [o.url]
   * @param {typeof WebSocket} [o.WebSocketImpl]
   * @param {import('../../../packages/transport/src/index.js').Transport} [o.transport]
   * @param {() => number} [o.now]
   * @param {boolean} [o.predict] Predict your own movement (default on).
   * @param {boolean} [o.predictShots] Predict your own shots (default on, needs `predict`).
   * @param {number | null} [o.fixedDelayMs]
   * @param {object} [o.clockOptions]
   * @param {{createTransport: () => import('../../../packages/transport/src/index.js').Transport, maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number, setTimer?: (ms: number, fn: () => void) => void} | null} [o.reconnect]
   *   Reconnect automatically after an unexpected disconnect, presenting the session token so the server gives back the same player.
   * @param {(id: string, hash: string) => Promise<any>} [o.fetchMod] Download a mod's client view (default: GET /mods/<id>/<hash> on the page's origin).
   */
  constructor({ url, WebSocketImpl, transport, now = () => performance.now(), predict = true, predictShots = true, fixedDelayMs = null, clockOptions = {}, reconnect = null, fetchMod = defaultFetchMod }) {
    this.fetchMod = fetchMod;
    /** Presentation data from verified mods. */
    this.theme = {};
    /** Mods loaded for this connection: `{id, version, hash}`. */
    this.mods = [];
    this.modCache = new Map();
    this.welcomeGen = 0;
    /** Called with each verified mod load: `(mods)`. */
    this.onModsLoaded = null;
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.givenTransport = transport;
    this.transport = undefined;
    this.reconnectOpts = reconnect && {
      maxAttempts: 8, baseDelayMs: 250, maxDelayMs: 4000, setTimer: (ms, fn) => setTimeout(fn, ms), ...reconnect,
    };
    /** Token the server issued; sent in HELLO after a disconnect to resume the same player. */
    this.session = '';
    this.closing = false;
    this.attempt = 0;
    this.hadWelcome = false;
    /** True if the latest WELCOME resumed an existing player rather than creating a new one. */
    this.resumed = false;
    /** Called after a successful reconnect: `{resumed, selfId}`. */
    this.onReconnect = null;
    this.now = now;
    this.predictEnabled = predict;
    this.predictShots = predictShots;
    this.fixedDelayMs = fixedDelayMs;
    this.clockOptions = clockOptions;
    this.level = buildArenaLevel();
    this.rules = createRules();
    /** Called the moment you fire, with the predicted shot. @type {((shot: object) => void) | null} */
    this.onPredictedShot = null;
    /** Called when the server's verdict on one of your predicted shots arrives: `{predicted, event, agreed}`. */
    this.onShotResult = null;
    /** Called with each game event the server sends (others' shots, messages, corrected shots). */
    this.onEvent = null;
    this.nextFireSeq = 0;
    this.predictedShots = new Map();
    this.shotStats = { predicted: 0, confirmed: 0, agreed: 0, disagreed: 0, unconfirmed: 0, cooldownResyncs: 0 };
    this.scratch = { samples: null, ids: new Uint32Array(1024), xs: new Float64Array(1024), ys: new Float64Array(1024), zs: new Float64Array(1024), out: { victim: -1, reach: 0 } };
    this.lastRenderTick = NaN;
    this.clock = null;
    this.sentSeq = new Int32Array(256).fill(-1);
    this.sentAt = new Float64Array(256);
    this.lastAckSeen = 0;
    this.rttMs = NaN;
    this.lastSnapshotBytes = NaN;
    /** @type {PredictedPlayer3D | null} */
    this.predicted = null;
    this.inputAck = 0;
    this.state = /** @type {'connecting'|'handshaking'|'loading-mods'|'playing'|'reconnecting'|'rejected'|'closed'} */ ('connecting');
    this.closeReason = '';
    this.selfId = -1;
    this.tickRate = 60;
    this.latestTick = 0;
    this.history = new SnapshotHistory(netSchema, MAX_ENTITIES, 64);
    this.codec = new SnapshotCodec(netSchema, MAX_ENTITIES);
    this.batch = new InputBatch(inputSchema);
    this.writer = new BinaryWriter(256);
    this.pending = [];
    this.seq = 0;
    this.needFull = false;
    this.stats = { snapshots: 0, bytes: 0, stale: 0, missingBaseline: 0, protocolErrors: 0, fullSnapshots: 0, reconnects: 0 };
  }

  start() {
    // The first connection may be handed in; every later attempt (and a factory-only setup) asks the factory.
    const t = (this.transport === undefined ? this.givenTransport : null)
      ?? this.reconnectOpts?.createTransport()
      ?? connectWebSocket(this.url, { WebSocketImpl: this.WebSocketImpl });
    this.transport = t;
    const hello = () => {
      this.state = 'handshaking';
      this.writer.reset();
      encodeHello(this.writer, { schemaHash: netSchema.hash, inputHash: inputSchema.hash, token: this.session });
      t.send(this.writer.finish(), CHANNEL.RELIABLE);
    };
    t.onOpen = hello;
    t.onMessage = (bytes) => { if (t === this.transport) this.#onMessage(bytes); };
    t.onClose = (reason) => {
      if (t !== this.transport) return; // a connection we already gave up on
      if (this.state === 'rejected') { this.closeReason ||= reason; return; }
      if (this.reconnectOpts && !this.closing) { this.#scheduleReconnect(reason); return; }
      this.state = 'closed';
      this.closeReason ||= reason;
    };
    if (t.state === 'open') hello(); // transports that are open from the start never fire onOpen
    return this;
  }

  #scheduleReconnect(reason) {
    const o = this.reconnectOpts;
    if (this.attempt >= o.maxAttempts) {
      this.state = 'closed';
      this.closeReason = `reconnect failed: ${reason}`;
      return;
    }
    this.state = 'reconnecting';
    const delay = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** this.attempt);
    this.attempt++;
    o.setTimer(delay, () => {
      if (this.closing || this.state !== 'reconnecting') return;
      this.#resetForReconnect();
      try { this.start(); } catch (e) { this.#scheduleReconnect(e && e.message ? e.message : String(e)); }
    });
  }

  /** A new connection starts from a clean slate: the server restarts replication and input numbering on resume. */
  #resetForReconnect() {
    this.history = new SnapshotHistory(netSchema, MAX_ENTITIES, 64);
    this.latestTick = 0;
    this.needFull = false;
    this.clock = null;
    this.predicted = null;
    this.welcomeGen++;
    this.pending = [];
    this.seq = 0;
    this.sentSeq.fill(-1);
    this.lastAckSeen = 0;
    this.inputAck = 0;
    this.lastRenderTick = NaN;
    this.rttMs = NaN;
    this.nextFireSeq = 0;
    this.predictedShots.clear();
  }

  #onMessage(bytes) {
    try {
      const type = packetType(bytes);
      if (type === MSG.WELCOME) {
        const w = decodeWelcome(new BinaryReader(bytes));
        this.selfId = w.clientId;
        this.tickRate = w.tickRate;
        this.clock = new InterpolationClock({ tickMs: 1000 / w.tickRate, fixedDelayMs: this.fixedDelayMs, ...this.clockOptions });
        this.session = w.session;
        this.resumed = w.resumed;
        this.attempt = 0;
        const gen = ++this.welcomeGen;
        if (w.plugins.length === 0) {
          this.rules = createRules(); this.theme = {}; this.mods = [];
          this.#enterPlaying(w);
        } else {
          // Nothing is applied or played until every advertised mod's data has been downloaded and its hash verified.
          this.state = 'loading-mods';
          this.#loadMods(w.plugins).then(
            (loaded) => {
              if (gen !== this.welcomeGen || this.state !== 'loading-mods') return;
              this.rules = loaded.rules; this.theme = loaded.theme; this.mods = w.plugins.map((p) => ({ ...p }));
              this.onModsLoaded?.(this.mods);
              this.#enterPlaying(w);
            },
            (e) => {
              if (gen !== this.welcomeGen) return;
              this.state = 'rejected'; // no automatic reconnect: retrying cannot fix a tampered or unavailable mod
              this.closing = true;
              this.closeReason = `mod verification failed: ${e && e.message ? e.message : e}`;
              this.transport?.close('mod verification failed');
            },
          );
        }
      } else if (type === MSG.REJECT) {
        const r = decodeReject(new BinaryReader(bytes));
        this.state = 'rejected';
        this.closeReason = r.message;
      } else if (type === MSG.SNAPSHOT) {
        this.#onSnapshot(bytes);
      } else if (type === MSG.EVENT) {
        this.#onGameEvent(decodeEvent(bytes));
      }
    } catch (e) {
      if (!(e instanceof ProtocolError)) throw e;
      this.stats.protocolErrors++;
    }
  }

  #enterPlaying(w) {
    if (this.predictEnabled) this.predicted = new PredictedPlayer3D(this.level.world, 1 / w.tickRate, { rules: this.rules });
    this.state = 'playing';
    if (this.hadWelcome) { this.stats.reconnects++; this.onReconnect?.({ resumed: w.resumed, selfId: w.clientId }); }
    this.hadWelcome = true;
  }

  /** Download, verify and combine the advertised mods' client data. Rejects on the first problem. */
  async #loadMods(plugins) {
    const views = [];
    for (const p of plugins) {
      let view = this.modCache.get(p.hash);
      if (!view) {
        view = await this.fetchMod(p.id, p.hash);
        if (!(await verifyClientView(view, p.hash))) throw new Error(`"${p.id}" does not match its advertised hash`);
        this.modCache.set(p.hash, view);
      }
      if (view.id !== p.id) throw new Error(`"${p.id}" is not the mod it claims to be`);
      views.push(view);
    }
    const rules = createRules();
    const { merged } = mergeRuleSets(views.map((v) => ({ mod: v.id, rules: v.rules ?? {} })));
    applyRules(rules, merged);
    const theme = {};
    for (const v of views) Object.assign(theme, sanitizeClientData(v.client).theme);
    return { rules, theme };
  }

  #onGameEvent(ev) {
    if (ev.kind === EVENT.SHOT && ev.shooter === this.selfId && ev.seq > 0) {
      const mine = this.predictedShots.get(ev.seq);
      const next = ev.seq + this.rules.weapon.cooldownTicks; // the server is the judge of when the next shot is allowed
      if (next !== this.nextFireSeq && (!mine || next > this.nextFireSeq)) { this.nextFireSeq = next; this.shotStats.cooldownResyncs++; }
      if (mine) {
        this.predictedShots.delete(ev.seq);
        this.shotStats.confirmed++;
        const agreed = mine.victim === ev.hit;
        if (agreed) this.shotStats.agreed++; else this.shotStats.disagreed++;
        this.onShotResult?.({ predicted: mine, event: ev, agreed });
        if (!agreed) this.onEvent?.({ ...ev, corrected: true });
        return;
      }
    }
    this.onEvent?.(ev);
  }

  /** Predict the shot this input fires: same cooldown counting and ray code as the server, judged against what you see. */
  #predictShot(seq, buttons, yaw, pitch) {
    const p = this.predicted;
    if (!this.predictShots || !p?.initialized || (buttons & BUTTON_FIRE) === 0) return;
    if (seq < this.nextFireSeq || !Number.isFinite(this.lastRenderTick)) return;
    const rules = this.rules.weapon;
    this.nextFireSeq = seq + rules.cooldownTicks;
    const sc = this.scratch;
    sc.samples ??= createSampleBuffer(1024);
    sampleWorld(this.history, Math.round(this.lastRenderTick * 4) / 4, sc.samples); // the tick we tell the server we were looking at
    const smp = sc.samples;
    let n = 0;
    for (let i = 0; i < smp.count; i++) {
      if (smp.ids[i] === this.selfId) continue;
      sc.ids[n] = smp.ids[i]; sc.xs[n] = smp.x[i]; sc.ys[n] = smp.y[i]; sc.zs[n] = smp.z[i];
      n++;
    }
    const d = lookDirection(yaw, pitch);
    const dx = d[0], dy = d[1], dz = d[2];
    const ox = p.body.x, oy = eyeY(p.body), oz = p.body.z;
    traceShot(this.level.world, ox, oy, oz, dx, dy, dz, rules.range, n, sc.ids, sc.xs, sc.ys, sc.zs, BODY.radius, BODY.halfHeight, BODY.radius, sc.out);
    const shot = { seq, x0: ox, y0: oy, z0: oz, x1: ox + dx * sc.out.reach, y1: oy + dy * sc.out.reach, z1: oz + dz * sc.out.reach, victim: sc.out.victim };
    this.predictedShots.set(seq, shot);
    this.shotStats.predicted++;
    for (const [q] of this.predictedShots) { // forget verdicts that never came
      if (seq - q <= 120) break;
      this.predictedShots.delete(q);
      this.shotStats.unconfirmed++;
    }
    this.onPredictedShot?.(shot);
  }

  #onSnapshot(bytes) {
    const r = new BinaryReader(bytes);
    const inputAck = readSnapshotHeader(r);
    const isFull = r.bytes[r.pos] === 0;
    const slot = this.history.acquire();
    try {
      this.codec.decode(r, (t) => this.history.get(t), slot);
    } catch (e) {
      if (e instanceof MissingBaselineError) { this.stats.missingBaseline++; this.needFull = true; return; }
      throw e;
    }
    if (slot.tick <= this.latestTick) { this.stats.stale++; return; }
    this.history.commit(slot);
    this.latestTick = slot.tick;
    this.needFull = false;
    this.stats.snapshots++;
    this.stats.bytes += bytes.length;
    this.lastSnapshotBytes = bytes.length;
    if (isFull) this.stats.fullSnapshots++;
    this.inputAck = inputAck;
    this.#reconcile(slot, inputAck);
    const now = this.now();
    this.clock?.onSnapshot(now, slot.tick);
    this.#measureRtt(inputAck, now);
  }

  #reconcile(snapshot, inputAck) {
    if (!this.predicted) return;
    const row = snapshot.rowOf(this.selfId);
    if (row < 0) return;
    const o = row * netSchema.fieldCount, v = snapshot.vals;
    this.predicted.reconcile(
      inputAck,
      fx.codec.dequantize(v[o + fx.col]), fy.codec.dequantize(v[o + fy.col]), fz.codec.dequantize(v[o + fz.col]),
      fvy.codec.dequantize(v[o + fvy.col]), fgrounded.codec.dequantize(v[o + fgrounded.col]) !== 0,
    );
  }

  #measureRtt(inputAck, now) {
    if (inputAck <= this.lastAckSeen) return;
    this.lastAckSeen = inputAck;
    const i = inputAck % 256;
    if (this.sentSeq[i] !== inputAck) return;
    const sample = now - this.sentAt[i];
    this.rttMs = Number.isNaN(this.rttMs) ? sample : this.rttMs + (sample - this.rttMs) / 8;
  }

  serverTickNow() { return this.clock ? this.clock.serverTickNow(this.now()) : NaN; }

  /** Server tick to draw other entities at (adaptive interpolation delay). Call once per frame. */
  renderTick() {
    this.lastRenderTick = this.clock ? this.clock.renderTick(this.now()) : NaN;
    return this.lastRenderTick;
  }

  /**
   * Send the current input. Call at a steady rate (the 60 Hz client loop).
   * @param {number} moveX -1..1 (+ = right)
   * @param {number} moveY -1..1 (+ = forward)
   * @param {number} buttons Bit flags
   * @param {number} yaw Look direction (radians, any range)
   * @param {number} pitch
   */
  sendInput(moveX, moveY, buttons, yaw, pitch) {
    if (this.state !== 'playing') return;
    const to127 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
    const qyaw = toWire(yawCodec, wrapAngle(yaw)), qpitch = toWire(pitchCodec, pitch);
    let view = 0;
    if ((buttons & BUTTON_FIRE) !== 0 && Number.isFinite(this.lastRenderTick)) view = (Math.round(this.lastRenderTick * 4) & 0xffff) || 1;
    this.pending.push([++this.seq, to127(moveX), to127(moveY), buttons & 255, qyaw, qpitch, view]);
    this.sentSeq[this.seq % 256] = this.seq;
    this.sentAt[this.seq % 256] = this.now();
    const last = this.pending[this.pending.length - 1];
    this.predicted?.record(last[0], last[1], last[2], last[3], qyaw);
    this.#predictShot(this.seq, buttons & 255, qyaw, qpitch);
    if (this.pending.length > REDUNDANCY) this.pending.shift();
    const b = this.batch;
    b.clear();
    b.ackTick = this.needFull ? 0 : this.latestTick;
    b.firstSeq = this.pending[0][0];
    for (const [, mx, my, bt, yw, pt, vw] of this.pending) b.push(0, [mx, my, bt, yw, pt, vw]);
    this.writer.reset();
    encodeInput(this.writer, b);
    this.transport.send(this.writer.finish(), CHANNEL.UNRELIABLE);
  }

  /** Leave on purpose: never reconnects. */
  close() {
    this.closing = true;
    this.transport?.close('client closed');
    if (this.state !== 'rejected') this.state = 'closed';
  }
}
