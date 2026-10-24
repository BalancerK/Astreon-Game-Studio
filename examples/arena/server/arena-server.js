// Authoritative arena server: static files + WebSocket on one port.
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, FixedLoop, INDEX_MASK } from '../../../packages/core/src/index.js';
import {
  BinaryWriter, BinaryReader, ProtocolError, Snapshot, InputBatch,
  MSG, REJECT, PROTOCOL_VERSION, packetType, decodeHello, decodeInput, encodeWelcome, encodeReject, writeSnapshotHeader,
} from '../../../packages/protocol/src/index.js';
import { InterestGrid, ClientReplicator } from '../../../packages/server/src/index.js';
import { CHANNEL, createRng } from '../../../packages/transport/src/index.js';
import { listenWebSocket } from '../../../packages/transport/src/node.js';
import { createStaticServer } from '../../../tools/static-server.js';
import { ModManager, loadCatalog } from '../../../packages/mods/src/node.js';
import { modRoute } from './mod-route.js';
import {
  WORLD, TICK_RATE, PLAYER_RADIUS, GROUP_WALL, BUTTON_FIRE, Pos, Style, Health, netSchema, inputSchema,
  buildWalls, buildWallHash, stepMover, applyInput,
} from '../shared/game.js';
import { encodeShot, encodeMessage } from '../shared/events.js';
import { createRules, applyRules } from '../shared/rules.js';
import { InputQueue } from './input-queue.js';
import { resolveViewTick } from './weapon.js';
import { traceShot } from '../shared/shot.js';

/** What mods may ask the game to do. The game validates every command again against live state before acting. */
export const MOD_COMMANDS = Object.freeze({
  heal: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } },
  damage: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } },
  teleport: { id: { type: 'int', min: 0 }, x: { type: 'number', min: 0, max: WORLD.w }, y: { type: 'number', min: 0, max: WORLD.h } },
  message: { text: { type: 'string', maxLength: 120 } },
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAX_ENTITIES = 4096;

/**
 * @param {object} [o]
 * @param {number} [o.port]
 * @param {string} [o.host]
 * @param {number} [o.bots] Wandering fast bots, to make the world busy.
 * @param {number} [o.tickRate]
 * @param {boolean} [o.serveStatic]
 * @param {number} [o.seed]
 * @param {boolean} [o.manualTicks] Tests drive `server.step()` themselves instead of a timer.
 * @param {boolean} [o.listen] False: no sockets at all; connections are given to `server.attach(transport)`.
 * @param {number} [o.viewRadius] Each client only receives entities within this distance of its player (Infinity = whole world).
 * @param {number} [o.bandwidth] Per-client budget in bytes per second (Infinity = unlimited).
 * @param {boolean} [o.lagCompensation] Judge shots against what the shooter saw (default on). Off = against the current world.
 * @param {number} [o.maxRewindMs] Furthest back a shot may be judged, however much lag the shooter claims.
 * @param {{dir?: string, bundles?: any[], ids?: string[], policy?: object, mode?: 'process' | 'inline', log?: (m: string) => void}} [o.mods] Mods to load: a catalog directory (optionally only `ids`) and/or ready bundles.
 * @param {number} [o.resumeWindowMs] After a disconnect the player's entity stays in the world this long so the same player can reconnect with their session token (0 = remove at once).
 */
export async function startArenaServer({ port = 8080, host = '127.0.0.1', bots = 40, tickRate = TICK_RATE, serveStatic = true, seed = 1, manualTicks = false, listen = true, viewRadius = 700, bandwidth = Infinity, lagCompensation = true, maxRewindMs = 250, resumeWindowMs = 15_000, mods = undefined } = {}) {
  const rand = createRng(seed);
  const rules = createRules();
  let modManager = null;
  let advertisedMods = []; // fixed at startup: the rules in force and what clients are told to load must match
  if (mods) {
    modManager = new ModManager({ commands: MOD_COMMANDS, policy: mods.policy, mode: mods.mode ?? 'process', log: mods.log });
    const bundles = [...(mods.bundles ?? [])];
    if (mods.dir) {
      const cat = loadCatalog(mods.dir);
      for (const pr of cat.problems) mods.log?.(`mod "${pr.dir}" skipped: ${pr.errors.join('; ')}`);
      bundles.push(...(mods.ids ? cat.bundles.filter((b) => mods.ids.includes(b.manifest.id)) : cat.bundles));
    }
    for (const b of bundles) {
      const r = modManager.add(b);
      if (!r.ok) mods.log?.(`mod "${b.manifest?.id}" refused: ${r.errors.join('; ')}`);
    }
    await modManager.start();
    advertisedMods = modManager.advertised();
    const { merged } = modManager.collectRules();
    for (const r of applyRules(rules, merged).rejected) mods.log?.(`rule "${r.key}" ignored: ${r.reason}`);
  }
  const recentKills = [];
  const world = new World(MAX_ENTITIES);
  world.register(Pos);
  world.register(Style);
  world.register(Health);
  const walls = buildWallHash(buildWalls());

  const full = new Snapshot(netSchema, MAX_ENTITIES); // the whole world this tick; clients get filtered views of it
  const MAX_VISIBLE = 384;
  const grid = new InterestGrid({ width: WORLD.w, height: WORLD.h, capacity: MAX_ENTITIES, cellSize: Math.min(512, Math.max(128, viewRadius / 2)) });
  const visBuf = new Uint32Array(MAX_VISIBLE);
  const ids = new Uint32Array(MAX_ENTITIES);
  const writer = new BinaryWriter(65536);
  const inBatch = new InputBatch(inputSchema);
  const posX = world.data(Pos).x, posY = world.data(Pos).y;
  const hpArr = world.data(Health).hp, radiusArr = world.data(Style).radius;
  const fireIds = new Uint32Array(MAX_ENTITIES);
  const eventWriter = new BinaryWriter(64);
  const maxRewindTicks = Math.round((maxRewindMs / 1000) * tickRate);
  const resumeWindowTicks = Math.round((resumeWindowMs / 1000) * tickRate);
  /** token -> {token, entity, client (the live connection or null), expiresTick, cooldownLeft}. Counted in ticks, so it is deterministic. */
  const sessions = new Map();
  const detached = new Set();

  /** @type {Set<any>} */
  const clients = new Set();
  const botState = new Map(); // entity slot -> {dx, dy, left, speed}
  const stats = { ticks: 0, tickMsTotal: 0, tickMsMax: 0, snapshotBytes: 0, snapshotsSent: 0, visibleSum: 0, shots: 0, hits: 0, kills: 0, resumed: 0, sessionsExpired: 0, startedAt: Date.now() };
  let tick = 0;

  function spawnPoint(radius) {
    const out = new Int32Array(8);
    for (let tries = 0; tries < 200; tries++) {
      const x = 100 + rand() * (WORLD.w - 200), y = 100 + rand() * (WORLD.h - 200);
      if (walls.queryRect(x - radius - 10, y - radius - 10, x + radius + 10, y + radius + 10, out) === 0) return { x, y };
    }
    return { x: WORLD.w / 2, y: WORLD.h / 2 };
  }

  function spawn(hue, radius) {
    const e = world.create();
    const p = spawnPoint(radius);
    world.add(e, Pos, p);
    world.add(e, Style, { hue, radius });
    world.add(e, Health, { hp: rules.weapon.maxHp });
    return e;
  }

  function respawn(e) {
    const slot = e & INDEX_MASK;
    const p = spawnPoint(radiusArr[slot]);
    posX[slot] = p.x; posY[slot] = p.y;
    hpArr[slot] = rules.weapon.maxHp;
  }

  const hitProbe = { x: 0, y: 0 };
  const shotResult = { victim: -1, reach: 0 };
  const candId = new Uint32Array(MAX_ENTITIES), candX = new Float64Array(MAX_ENTITIES), candY = new Float64Array(MAX_ENTITIES), candR = new Float64Array(MAX_ENTITIES);
  /**
   * Fire the hitscan weapon for client `c` using the aim and view tick carried by the input being applied.
   * The shooter's origin is their current (authoritative) position, which equals what their client predicted
   * for this input; targets are judged where the shooter SAW them, then damage lands now.
   */
  function fire(c, shooterSlot, inp) {
    // Cooldown is counted in the player's own applied inputs (one per tick of their time), not wall-clock ticks: the
    // client counts the same way, so it can predict exactly when the server will allow the next shot.
    if (c.applied < c.nextFireApplied) return;
    const ax = inp.aimX, ay = inp.aimY;
    const len = Math.sqrt(ax * ax + ay * ay);
    if (len === 0) return;
    c.nextFireApplied = c.applied + rules.weapon.cooldownTicks;
    stats.shots++;
    const dx = ax / len, dy = ay / len;
    const ox = posX[shooterSlot], oy = posY[shooterSlot];
    const viewTick = lagCompensation ? resolveViewTick(inp.view, tick, maxRewindTicks) : tick;

    let cands = 0;
    const n = world.query(fireIds, [Pos, Health]);
    for (let k = 0; k < n; k++) {
      const id = fireIds[k], slot = id & INDEX_MASK;
      if (slot === shooterSlot) continue;
      if (lagCompensation) {
        if (!c.rep.positionAt(viewTick, id, hitProbe)) continue; // the shooter could not see it: cannot be hit
        candX[cands] = hitProbe.x; candY[cands] = hitProbe.y;
      } else {
        candX[cands] = posX[slot]; candY[cands] = posY[slot];
      }
      candId[cands] = id; candR[cands] = radiusArr[slot];
      cands++;
    }
    traceShot(walls, ox, oy, dx, dy, rules.weapon.range, cands, candId, candX, candY, candR, shotResult);
    const victim = shotResult.victim, reach = shotResult.reach;
    if (victim >= 0) {
      stats.hits++;
      const vs = victim & INDEX_MASK;
      hpArr[vs] = Math.max(0, hpArr[vs] - rules.weapon.damage);
      if (hpArr[vs] === 0) { stats.kills++; recentKills.push({ killer: c.entity, victim }); respawn(victim); }
    }
    // tell everyone who could see the shooter
    eventWriter.reset();
    encodeShot(eventWriter, { shooter: c.entity, hit: victim, seq: inp.seq, x0: ox, y0: oy, x1: ox + dx * reach, y1: oy + dy * reach });
    const bytes = eventWriter.finish();
    for (const other of clients) {
      if (!other.ready) continue;
      const os = other.entity & INDEX_MASK;
      const ddx = posX[os] - ox, ddy = posY[os] - oy;
      if (other === c || ddx * ddx + ddy * ddy <= viewRadius * viewRadius) other.conn.send(bytes, CHANNEL.UNRELIABLE);
    }
  }

  for (let i = 0; i < bots; i++) {
    const e = spawn((rand() * 256) | 0, 10 + ((rand() * 6) | 0));
    botState.set(e & INDEX_MASK, { dx: 0, dy: 0, left: 0, speed: 300 + rand() * 500 });
  }

  const point = { x: 0, y: 0 };
  const input = { seq: 0, x: 0, y: 0, buttons: 0, aimX: 0, aimY: 0, view: 0 };
  function simulate(dt) {
    for (const c of clients) {
      if (c.entity < 0) continue; // 0 is a valid entity id; -1 means "not spawned"
      const i = c.entity & INDEX_MASK;
      c.queue.tick();
      while (c.queue.pop(input)) {
        point.x = posX[i]; point.y = posY[i];
        applyInput(walls, point, input.x, input.y, input.buttons, dt, rules);
        posX[i] = point.x; posY[i] = point.y;
        c.lastApplied = input.seq;
        c.applied++;
        if (input.buttons & BUTTON_FIRE) fire(c, i, input);
      }
    }
    for (const [i, b] of botState) {
      b.left -= dt;
      if (b.left <= 0) {
        const a = rand() * 2 - 1, c = rand() * 2 - 1;
        b.dx = a; b.dy = c; b.left = 0.4 + rand() * 1.6;
      }
      point.x = posX[i]; point.y = posY[i];
      const before = point.x + point.y;
      stepMover(walls, point, world.data(Style).radius[i], b.dx, b.dy, b.speed, dt);
      if (point.x + point.y === before) b.left = 0; // blocked: pick a new direction next tick
      posX[i] = point.x; posY[i] = point.y;
    }
  }

  function broadcast() {
    const n = world.query(ids, [Pos]);
    full.capture(world, tick, ids, n);
    grid.rebuild(ids, n, posX, posY);
    const generations = world.entities.generations;
    for (const c of clients) {
      if (!c.ready) continue;
      const self = c.entity & INDEX_MASK;
      const cx = posX[self], cy = posY[self];
      const m = grid.query({
        cx, cy, enterRadius: viewRadius, leaveRadius: viewRadius * 1.15,
        prevMark: c.rep.prevMark, generations, maxVisible: MAX_VISIBLE, outIds: visBuf,
      });
      c.rep.setVisible(visBuf, m);
      c.rep.buildView(full, tick, c.entity, cx, cy, posX, posY);
      writer.reset();
      writeSnapshotHeader(writer, c.lastApplied);
      const header = writer.pos;
      c.rep.encode(writer, c.ackTick, header);
      stats.snapshotBytes += writer.pos;
      stats.snapshotsSent++;
      stats.visibleSum += m;
      c.conn.send(writer.finish(), CHANNEL.UNRELIABLE);
    }
  }

  const alive = (id) => Number.isInteger(id) && world.isAlive(id) && world.has(id, Health);

  /** Carry out one validated mod command. The mod only proposes; every target and value is checked against live state. */
  function applyModCommand({ cmd }) {
    switch (cmd.op) {
      case 'heal': case 'damage': {
        if (!alive(cmd.id)) return;
        const slot = cmd.id & INDEX_MASK;
        const delta = Math.round(cmd.amount) * (cmd.op === 'heal' ? 1 : -1);
        hpArr[slot] = Math.min(rules.weapon.maxHp, Math.max(cmd.op === 'damage' ? 1 : 0, hpArr[slot] + delta)); // mods cannot kill
        return;
      }
      case 'teleport': {
        if (!alive(cmd.id)) return;
        const slot = cmd.id & INDEX_MASK, r = radiusArr[slot];
        const out = new Int32Array(1);
        if (walls.queryRect(cmd.x - r, cmd.y - r, cmd.x + r, cmd.y + r, out) > 0) return; // not inside a wall
        posX[slot] = Math.fround(cmd.x); posY[slot] = Math.fround(cmd.y);
        return;
      }
      case 'message': {
        eventWriter.reset();
        encodeMessage(eventWriter, { text: cmd.text.replace(/[^\x20-\x7e]/g, '') });
        const bytes = eventWriter.finish();
        for (const other of clients) if (other.ready) other.conn.send(bytes, CHANNEL.RELIABLE);
      }
    }
  }

  function buildModFrame() {
    const players = [];
    for (const c of clients) {
      if (!c.ready || players.length >= 64) continue;
      const i = c.entity & INDEX_MASK;
      players.push({ id: c.entity, x: posX[i], y: posY[i], hp: hpArr[i] });
    }
    const kills = recentKills.splice(0, 32);
    return { tick, players, kills };
  }

  let stallMs = 0;
  function runTick(dt) {
    const t0 = process.hrtime.bigint();
    tick++;
    if (stallMs > 0) { // test hook: burn CPU to emulate a runaway game script or a heavy tick
      const end = performance.now() + stallMs;
      stallMs = 0;
      while (performance.now() < end);
    }
    for (const sess of detached) { // players who never came back
      if (tick < sess.expiresTick) continue;
      detached.delete(sess);
      sessions.delete(sess.token);
      if (world.isAlive(sess.entity)) world.destroy(sess.entity);
      stats.sessionsExpired++;
    }
    simulate(dt);
    if (modManager) {
      for (const item of modManager.drainCommands()) applyModCommand(item);
      modManager.emitFrame(buildModFrame);
    }
    broadcast();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.ticks++;
    stats.tickMsTotal += ms;
    if (ms > stats.tickMsMax) stats.tickMsMax = ms;
  }

  const loop = new FixedLoop({ tickRate, update: (dt) => runTick(dt) });

  function onConnection(conn) {
    const c = { conn, entity: -1, ready: false, ackTick: 0, newestPacketSeq: -1, queue: new InputQueue({ eventMask: BUTTON_FIRE }), lastApplied: 0, applied: 0, nextFireApplied: 0 };
    clients.add(c);
    conn.onClose = () => {
      clients.delete(c);
      const sess = c.session;
      if (!sess || sess.client !== c) return; // never joined, or already taken over by a newer connection
      sess.client = null;
      sess.cooldownLeft = Math.max(0, c.nextFireApplied - c.applied);
      if (resumeWindowTicks > 0) { // keep the player in the world, frozen, so they can come back
        sess.expiresTick = tick + resumeWindowTicks;
        detached.add(sess);
      } else {
        sessions.delete(sess.token);
        if (world.isAlive(sess.entity)) world.destroy(sess.entity);
      }
    };
    conn.onMessage = (bytes) => {
      try {
        const type = packetType(bytes);
        if (type === MSG.HELLO && !c.ready) handleHello(c, bytes);
        else if (type === MSG.INPUT && c.ready) handleInput(c, bytes);
        else throw new ProtocolError(`unexpected message ${type}`);
      } catch (e) {
        if (e instanceof ProtocolError) conn.close('protocol error');
        else throw e;
      }
    };
  }

  function reject(c, reason, text) {
    writer.reset();
    encodeReject(writer, reason, text);
    c.conn.send(writer.finish(), CHANNEL.RELIABLE);
    c.conn.close(text);
  }

  function handleHello(c, bytes) {
    const hello = decodeHello(new BinaryReader(bytes));
    if (hello.version !== PROTOCOL_VERSION) return reject(c, REJECT.VERSION_MISMATCH, `protocol ${PROTOCOL_VERSION} required`);
    if (hello.schemaHash !== netSchema.hash || hello.inputHash !== inputSchema.hash) return reject(c, REJECT.SCHEMA_MISMATCH, 'schema mismatch');
    let sess = resumeWindowTicks > 0 && hello.token ? sessions.get(hello.token) : undefined;
    if (sess && !world.isAlive(sess.entity)) { sessions.delete(sess.token); detached.delete(sess); sess = undefined; }
    const resumed = !!sess;
    if (sess) {
      // Same player coming back: same entity, state and identity. Replication and input numbering restart
      // from scratch (the client begins with a full snapshot and sequence number 1).
      const previous = sess.client;
      detached.delete(sess);
      sess.client = c;
      if (previous) previous.conn.close('replaced by a new connection'); // half-open connection the server had not noticed dying
      c.entity = sess.entity;
      c.nextFireApplied = sess.cooldownLeft ?? 0; // the new connection starts counting inputs from zero again
      stats.resumed++;
    } else {
      if (clients.size > 256) return reject(c, REJECT.SERVER_FULL, 'server full');
      c.entity = spawn((rand() * 256) | 0, PLAYER_RADIUS);
      sess = { token: randomBytes(16).toString('hex'), entity: c.entity, client: c, expiresTick: 0, cooldownLeft: 0 };
      sessions.set(sess.token, sess);
    }
    c.session = sess;
    c.rep = new ClientReplicator({ schema: netSchema, worldCapacity: MAX_ENTITIES, maxVisible: MAX_VISIBLE, bytesPerSecond: bandwidth, tickRate });
    c.ready = true;
    writer.reset();
    encodeWelcome(writer, { clientId: c.entity, tickRate, serverTick: tick, plugins: advertisedMods, session: sess.token, resumed });
    c.conn.send(writer.finish(), CHANNEL.RELIABLE);
  }

  function handleInput(c, bytes) {
    decodeInput(new BinaryReader(bytes), inBatch);
    const n = inputSchema.names.length;
    // Every packet may carry inputs we have not seen (redundancy covers lost packets); the queue drops duplicates.
    for (let k = 0; k < inBatch.count; k++) {
      const o = k * n;
      c.queue.push(inBatch.firstSeq + k, inBatch.values[o], inBatch.values[o + 1], inBatch.values[o + 2], inBatch.values[o + 3], inBatch.values[o + 4], inBatch.values[o + 5]);
    }
    const newest = inBatch.firstSeq + inBatch.count - 1;
    if (inBatch.count > 0 && newest > c.newestPacketSeq) {
      c.newestPacketSeq = newest;
      c.ackTick = inBatch.ackTick; // 0 asks for a full snapshot; older (reordered) packets must not roll this back
    }
  }

  const server = listen && serveStatic
    ? createStaticServer({ root: ROOT, index: '/examples/arena/client/index.html', handle: modManager ? modRoute(() => modManager.clientViews()) : undefined })
    : undefined;
  server?.listen(port, host); // listenWebSocket attaches to it and waits until it is listening
  const listener = listen
    ? await listenWebSocket({ server, port, host, path: (p) => p === '/ws' || /^\/ws\/[^/]+$/.test(p), maxPayload: 4096, maxMessagesPerSecond: 200, burstMessages: 400 })
    : null;
  if (listener) listener.onConnection = onConnection;

  let timer = null;
  if (!manualTicks) {
    let last = process.hrtime.bigint();
    timer = setInterval(() => {
      const now = process.hrtime.bigint();
      loop.advance(Number(now - last) / 1e9);
      last = now;
    }, 4);
  }

  return {
    port: listener?.port ?? 0,
    world, clients, stats, listener, sessions, rules, mods: modManager,
    /** Serve a connection made by any transport (e.g. the in-memory network). */
    attach: onConnection,
    get tick() { return tick; },
    /** Block the event loop for `ms` during the next tick (tests of room isolation). */
    stallNextTick: (ms) => { stallMs = ms; },
    /** Run exactly one simulation tick (for tests). */
    step: () => runTick(1 / tickRate),
    async close() {
      if (timer) clearInterval(timer);
      await modManager?.close();
      await listener?.close();
      server?.close();
    },
  };
}
