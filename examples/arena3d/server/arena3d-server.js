// Authoritative 3D arena server. Players and bots are `CharacterController` bodies walking a triangle level; clients get delta
// snapshots filtered by interest (on the ground plane), predict their own movement and shots, and the server judges shots
// against what the shooter saw (lag compensation with 3D bodies).
import { World, FixedLoop, INDEX_MASK } from '../../../packages/core/src/index.js';
import {
  BinaryWriter, BinaryReader, ProtocolError, Snapshot, InputBatch,
  MSG, REJECT, PROTOCOL_VERSION, packetType, decodeHello, decodeInput, encodeWelcome, encodeReject, writeSnapshotHeader,
} from '../../../packages/protocol/src/index.js';
import { InterestGrid, ClientReplicator } from '../../../packages/server/src/index.js';
import { ModManager, loadCatalog } from '../../../packages/mods/src/node.js';
import { modRoute } from '../../arena/server/mod-route.js';
import { pushOutEllipsoid } from '../../../packages/physics/src/index.js';
import { CHANNEL, createRng } from '../../../packages/transport/src/index.js';
import { listenWebSocket } from '../../../packages/transport/src/node.js';
import { createStaticServer } from '../../../tools/static-server.js';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
import {
  WORLD, BODY, TICK_RATE, BUTTON_FIRE, Pos3, Look, Motion, Style, Health, netSchema, inputSchema, createRules, createBody, stepPlayer, eyeY, lookDirection,
} from '../shared/game.js';
import { buildArenaLevel } from '../shared/level.js';
import { traceShot } from '../shared/shot.js';
import { encodeShot, encodeMessage } from '../shared/events.js';
import { applyRules } from '../shared/rules.js';
import { InputQueue } from './input-queue.js';
import { separateBodies } from './separation.js';
import { resolveViewTick } from './weapon.js';
import { createBots } from './bots.js';

/** What mods may ask the game to do. The game validates every command again against live state before acting. */
export const MOD_COMMANDS = Object.freeze({
  heal: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } },
  damage: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } },
  teleport: { id: { type: 'int', min: 0 }, x: { type: 'number', min: -64, max: 64 }, y: { type: 'number', min: -8, max: 56 }, z: { type: 'number', min: -64, max: 64 } },
  message: { text: { type: 'string', maxLength: 120 } },
});

const MAX_ENTITIES = 4096;
const snap = (codec, v) => codec.dequantize(codec.quantize(v)); // the nearest position the network can carry

/**
 * @param {object} [o]
 * @param {number} [o.port]
 * @param {string} [o.host]
 * @param {number} [o.bots] Bots that make the world busy.
 * @param {boolean} [o.botAi] Bots navigate the level, look for players, chase and shoot (default); false: they wander at random.
 * @param {number} [o.tickRate]
 * @param {number} [o.seed]
 * @param {boolean} [o.manualTicks] Tests drive `server.step()` themselves instead of a timer.
 * @param {boolean} [o.listen] False: no sockets at all; connections are given to `server.attach(transport)`.
 * @param {number} [o.viewRadius] Each client only receives entities within this horizontal distance (Infinity = everything).
 * @param {number} [o.bandwidth] Per-client budget in bytes per second (Infinity = unlimited).
 * @param {boolean} [o.lagCompensation] Judge shots against what the shooter saw (default on).
 * @param {number} [o.maxRewindMs] Furthest back a shot may be judged.
 * @param {number} [o.resumeWindowMs] After a disconnect the player stays in the world, frozen, this long so they can reconnect with their session token (0 = remove at once).
 * @param {boolean} [o.collide] Push overlapping players and bots apart (default true).
 * @param {{dir?: string, bundles?: any[], ids?: string[], policy?: object, mode?: 'process' | 'inline', log?: (m: string) => void}} [o.mods] Mods to load: a catalog directory (optionally only `ids`) and/or ready bundles.
 * @param {boolean} [o.serveStatic] Also serve the browser client over HTTP on the same port (default on).
 */
export async function startArena3dServer({ port = 8080, host = '127.0.0.1', bots = 20, tickRate = TICK_RATE, seed = 1, manualTicks = false, listen = true, viewRadius = 110, bandwidth = Infinity, lagCompensation = true, maxRewindMs = 250, serveStatic = true, mods = undefined, collide = true, resumeWindowMs = 15_000, botAi = true } = {}) {
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
  const level = buildArenaLevel();
  const level3 = level.world;
  const world = new World(MAX_ENTITIES);
  for (const c of [Pos3, Look, Motion, Style, Health]) world.register(c);
  const px = world.data(Pos3).x, py = world.data(Pos3).y, pz = world.data(Pos3).z;
  const yawArr = world.data(Look).yaw, pitchArr = world.data(Look).pitch;
  const vyArr = world.data(Motion).vy, groundedArr = world.data(Motion).grounded;
  const hpArr = world.data(Health).hp;
  const [posC] = netSchema.comps;
  const codecX = posC.fields[0].codec, codecY = posC.fields[1].codec, codecZ = posC.fields[2].codec;

  const full = new Snapshot(netSchema, MAX_ENTITIES);
  const MAX_VISIBLE = 384;
  const grid = new InterestGrid({ width: WORLD.max - WORLD.min, height: WORLD.max - WORLD.min, capacity: MAX_ENTITIES, cellSize: Math.min(64, Math.max(16, viewRadius / 2)) });
  const visBuf = new Uint32Array(MAX_VISIBLE);
  const ids = new Uint32Array(MAX_ENTITIES);
  const writer = new BinaryWriter(65536);
  const inBatch = new InputBatch(inputSchema);
  const maxRewindTicks = Math.round((maxRewindMs / 1000) * tickRate);
  const shifted = new Float32Array(MAX_ENTITIES), shiftedZ = new Float32Array(MAX_ENTITIES); // positions on the ground plane, shifted to start at 0 (the interest grid starts at 0)
  void shifted; void shiftedZ;

  /** @type {Map<number, import('../../../packages/physics/src/index.js').CharacterController>} entity slot -> body */
  const bodies = new Map();
  const clients = new Set();
  const resumeWindowTicks = Math.round((resumeWindowMs / 1000) * tickRate);
  /** token -> {token, entity, client (the live connection or null), expiresTick, cooldownLeft}. Counted in ticks, so it is deterministic. */
  const sessions = new Map();
  const detached = new Set(); // sessions with no connection, waiting to be resumed or to expire
  const botState = new Map(); // slot -> {wx, wz, left, speed}
  const stats = { ticks: 0, tickMsTotal: 0, tickMsMax: 0, snapshotBytes: 0, snapshotsSent: 0, visibleSum: 0, shots: 0, hits: 0, kills: 0, pushes: 0, resumed: 0, sessionsExpired: 0, startedAt: Date.now() };
  let tick = 0;
  let spawnCursor = 0;

  function spawnPoint() {
    const s = level.spawns[spawnCursor++ % level.spawns.length];
    return [snap(codecX, s[0] + (rand() - 0.5) * 6), snap(codecY, s[1]), snap(codecZ, s[2] + (rand() - 0.5) * 6)];
  }

  function spawn(hue) {
    const e = world.create();
    const [x, y, z] = spawnPoint();
    world.add(e, Pos3, { x, y, z });
    world.add(e, Look, { yaw: 0, pitch: 0 });
    world.add(e, Motion, { vy: 0, grounded: 0 });
    world.add(e, Style, { hue });
    world.add(e, Health, { hp: rules.weapon.maxHp });
    bodies.set(e & INDEX_MASK, createBody(x, y, z, rules));
    return e;
  }

  function respawn(e) {
    const slot = e & INDEX_MASK, body = bodies.get(slot);
    const [x, y, z] = spawnPoint();
    body.x = x; body.y = y; body.z = z; body.vy = 0; body.grounded = false;
    hpArr[slot] = rules.weapon.maxHp;
    publish(slot, body);
  }

  /** Write a body's state into the replicated components. */
  function publish(slot, body) {
    px[slot] = body.x; py[slot] = body.y; pz[slot] = body.z;
    vyArr[slot] = body.vy; groundedArr[slot] = body.grounded ? 1 : 0;
  }

  const hitProbe = { x: 0, y: 0, z: 0 };
  const shotResult = { victim: -1, reach: 0 };
  const candId = new Uint32Array(MAX_ENTITIES), candX = new Float64Array(MAX_ENTITIES), candY = new Float64Array(MAX_ENTITIES), candZ = new Float64Array(MAX_ENTITIES);
  const fireIds = new Uint32Array(MAX_ENTITIES);
  const eventWriter = new BinaryWriter(96);

  /**
   * Fire the hitscan weapon for client `c` using the look angles and view tick carried by the input being applied. The
   * origin is the shooter's current (authoritative) eye, which equals what their client predicted for this input; targets
   * are judged where the shooter SAW them, then damage lands now.
   */
  function fire(c, shooterSlot, body, inp) {
    // Cooldown is counted in the player's own applied inputs (one per tick of their time): the client counts the same way,
    // so it can predict exactly when the server will accept the next shot.
    if (c.applied < c.nextFireApplied) return;
    c.nextFireApplied = c.applied + rules.weapon.cooldownTicks;
    stats.shots++;
    const dir = lookDirection(inp.yaw, inp.pitch);
    const dx = dir[0], dy = dir[1], dz = dir[2];
    const ox = body.x, oy = eyeY(body), oz = body.z;
    const viewTick = lagCompensation ? resolveViewTick(inp.view, tick, maxRewindTicks) : tick;

    let cands = 0;
    const n = world.query(fireIds, [Pos3, Health]);
    for (let k = 0; k < n; k++) {
      const id = fireIds[k], slot = id & INDEX_MASK;
      if (slot === shooterSlot) continue;
      if (lagCompensation) {
        if (!c.rep.positionAt(viewTick, id, hitProbe, 20)) continue; // the shooter could not see it: cannot be hit
        candX[cands] = hitProbe.x; candY[cands] = hitProbe.y; candZ[cands] = hitProbe.z;
      } else {
        candX[cands] = px[slot]; candY[cands] = py[slot]; candZ[cands] = pz[slot];
      }
      candId[cands] = id;
      cands++;
    }
    traceShot(level3, ox, oy, oz, dx, dy, dz, rules.weapon.range, cands, candId, candX, candY, candZ, BODY.radius, BODY.halfHeight, BODY.radius, shotResult);
    const victim = shotResult.victim, reach = shotResult.reach;
    if (victim >= 0) {
      stats.hits++;
      const vs = victim & INDEX_MASK;
      hpArr[vs] = Math.max(0, hpArr[vs] - rules.weapon.damage);
      if (hpArr[vs] === 0) { stats.kills++; recentKills.push({ killer: c.entity, victim }); respawn(victim); }
    }
    eventWriter.reset();
    encodeShot(eventWriter, { shooter: c.entity, hit: victim, seq: inp.seq, x0: ox, y0: oy, z0: oz, x1: ox + dx * reach, y1: oy + dy * reach, z1: oz + dz * reach });
    const bytes = eventWriter.finish();
    for (const other of clients) { // tell the shooter and everyone who could see them
      if (!other.ready) continue;
      const os = other.entity & INDEX_MASK;
      const ddx = px[os] - ox, ddz = pz[os] - oz;
      if (other === c || ddx * ddx + ddz * ddz <= viewRadius * viewRadius) other.conn.send(bytes, CHANNEL.UNRELIABLE);
    }
  }

  // the bots' minds (@engine/ai): navigation over the level, sight, memory, a behaviour tree. They shoot like players do, judged at current positions.
  const botEvents = new BinaryWriter(96);
  const brain = botAi ? createBots({
    level3, level, rand, rules, body: BODY,
    targets: () => { const out = []; for (const c of clients) if (c.ready && c.entity >= 0) out.push({ entity: c.entity, slot: c.entity & INDEX_MASK }); return out; },
    stateOf: (slot) => ({ x: px[slot], y: py[slot], z: pz[slot], hp: hpArr[slot] }),
    shoot: (bot, tx, ty, tz) => botShoot(bot, tx, ty, tz),
  }) : null;
  for (let i = 0; i < bots; i++) {
    const e = spawn((rand() * 256) | 0);
    botState.set(e & INDEX_MASK, brain ? new brain.Bot(e, e & INDEX_MASK, i) : { wx: 0, wz: 0, left: 0, speed: 2 + rand() * 4 });
  }

  /** A bot fires at a point: the same hitscan the players use, against the players' current positions (bots do not shoot each other). */
  function botShoot(bot, tx, ty, tz) {
    const body = bodies.get(bot.slot), ox = body.x, oy = eyeY(body), oz = body.z;
    const dx0 = tx - ox, dy0 = ty - oy, dz0 = tz - oz, l = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) || 1;
    const dx = dx0 / l, dy = dy0 / l, dz = dz0 / l;
    let cands = 0;
    for (const c of clients) {
      if (!c.ready || c.entity < 0) continue;
      const slot = c.entity & INDEX_MASK;
      candId[cands] = c.entity; candX[cands] = px[slot]; candY[cands] = py[slot]; candZ[cands] = pz[slot]; cands++;
    }
    stats.shots++;
    traceShot(level3, ox, oy, oz, dx, dy, dz, rules.weapon.range, cands, candId, candX, candY, candZ, BODY.radius, BODY.halfHeight, BODY.radius, shotResult);
    const victim = shotResult.victim, reach = shotResult.reach;
    if (victim >= 0) {
      stats.hits++;
      const vs = victim & INDEX_MASK;
      hpArr[vs] = Math.max(0, hpArr[vs] - rules.weapon.damage);
      if (hpArr[vs] === 0) { stats.kills++; recentKills.push({ killer: bot.entity, victim }); respawn(victim); }
    }
    botEvents.reset();
    encodeShot(botEvents, { shooter: bot.entity, hit: victim, seq: 0, x0: ox, y0: oy, z0: oz, x1: ox + dx * reach, y1: oy + dy * reach, z1: oz + dz * reach });
    const bytes = botEvents.finish();
    for (const other of clients) {
      if (!other.ready) continue;
      const os = other.entity & INDEX_MASK, ddx = px[os] - ox, ddz = pz[os] - oz;
      if (ddx * ddx + ddz * ddz <= viewRadius * viewRadius) other.conn.send(bytes, CHANNEL.UNRELIABLE);
    }
  }

  const alive = (id) => Number.isInteger(id) && world.isAlive(id) && world.has(id, Health);
  const pushProbe = { x: 0, y: 0, z: 0 }, modRay = { t: 0, index: -1, nx: 0, ny: 0, nz: 0 };
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
        const slot = cmd.id & INDEX_MASK, body = bodies.get(slot);
        if (!body) return;
        pushProbe.x = cmd.x; pushProbe.y = cmd.y; pushProbe.z = cmd.z;
        if (pushOutEllipsoid(level3, pushProbe, BODY.radius, BODY.halfHeight, BODY.radius)) return; // not inside geometry
        const tx = cmd.x - body.x, ty = cmd.y - body.y, tz = cmd.z - body.z, dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (dist > 0 && level3.raycast(body.x, body.y, body.z, tx / dist, ty / dist, tz / dist, dist, modRay)) return; // and not through walls (this also catches the inside of solids, which the check above cannot see)
        body.x = snap(codecX, cmd.x); body.y = snap(codecY, cmd.y); body.z = snap(codecZ, cmd.z); body.vy = 0; body.grounded = false;
        publish(slot, body);
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
  const recentKills = [];
  function buildModFrame() {
    const players = [];
    for (const c of clients) {
      if (!c.ready || players.length >= 64) continue;
      const i = c.entity & INDEX_MASK;
      players.push({ id: c.entity, x: px[i], y: py[i], z: pz[i], hp: hpArr[i] });
    }
    return { tick, players, kills: recentKills.splice(0, 32) };
  }

  const input = { seq: 0, moveX: 0, moveY: 0, buttons: 0, yaw: 0, pitch: 0, view: 0 };
  function simulate(dt) {
    for (const c of clients) {
      if (c.entity < 0) continue;
      const slot = c.entity & INDEX_MASK, body = bodies.get(slot);
      c.queue.tick();
      while (c.queue.pop(input)) {
        stepPlayer(level3, body, input, dt, rules);
        yawArr[slot] = input.yaw; pitchArr[slot] = input.pitch;
        c.lastApplied = input.seq;
        c.applied++;
        publish(slot, body);
        if (input.buttons & BUTTON_FIRE) fire(c, slot, body, input);
      }
    }
    for (const [slot, b] of botState) {
      const body = bodies.get(slot);
      if (brain) { // a thinking bot
        b.step(body, dt, hpArr[slot], tick);
        yawArr[slot] = b.yaw; pitchArr[slot] = b.pitch;
        body.update(level3, b.wishX, b.wishZ, b.jump, dt);
        publish(slot, body);
        continue;
      }
      b.left -= dt;
      if (b.left <= 0) {
        const a = rand() * 6.283185307179586;
        b.wx = Math.cos(a) * b.speed; b.wz = Math.sin(a) * b.speed; b.left = 0.8 + rand() * 2.2; // determinism-ok: bots only exist on the server, nothing predicts them
        yawArr[slot] = Math.atan2(-b.wx, -b.wz); // determinism-ok: server-only, display direction of a bot
      }
      body.update(level3, b.wx, b.wz, rand() < 0.004, dt);
      publish(slot, body);
    }
    if (collide) {
      stats.pushes += separateBodies(bodies, level3, BODY);
      for (const [slot, body] of bodies) publish(slot, body);
    }
  }

  function broadcast() {
    const n = world.query(ids, [Pos3]);
    full.capture(world, tick, ids, n);
    // the interest grid starts at the origin: shift the ground plane so (-64, -64) is (0, 0)
    for (let k = 0; k < n; k++) { const s = ids[k] & INDEX_MASK; shifted[s] = px[s] - WORLD.min; shiftedZ[s] = pz[s] - WORLD.min; }
    grid.rebuild(ids, n, shifted, shiftedZ);
    const generations = world.entities.generations;
    for (const c of clients) {
      if (!c.ready) continue;
      const self = c.entity & INDEX_MASK;
      const cx = shifted[self], cz = shiftedZ[self];
      const m = grid.query({
        cx, cy: cz, enterRadius: viewRadius, leaveRadius: viewRadius * 1.15,
        prevMark: c.rep.prevMark, generations, maxVisible: MAX_VISIBLE, outIds: visBuf,
      });
      c.rep.setVisible(visBuf, m);
      c.rep.buildView(full, tick, c.entity, cx, cz, shifted, shiftedZ);
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

  function runTick(dt) {
    const t0 = process.hrtime.bigint();
    tick++;
    for (const sess of detached) { // players who never came back
      if (tick < sess.expiresTick) continue;
      detached.delete(sess);
      sessions.delete(sess.token);
      removePlayer(sess.entity);
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
        removePlayer(sess.entity);
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

  function removePlayer(entity) {
    if (!world.isAlive(entity)) return;
    bodies.delete(entity & INDEX_MASK);
    world.destroy(entity);
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
      // Same player coming back: same entity and state. Replication and input numbering restart from scratch
      // (the client begins with a full snapshot and sequence number 1).
      const previous = sess.client;
      detached.delete(sess);
      sess.client = c;
      if (previous) previous.conn.close('replaced by a new connection'); // half-open connection the server had not noticed dying
      c.entity = sess.entity;
      c.nextFireApplied = sess.cooldownLeft ?? 0; // the new connection counts inputs from zero again
      stats.resumed++;
    } else {
      if (clients.size > 128) return reject(c, REJECT.SERVER_FULL, 'server full');
      c.entity = spawn((rand() * 256) | 0);
      sess = { token: randomBytes(16).toString('hex'), entity: c.entity, client: c, expiresTick: 0, cooldownLeft: 0 };
      sessions.set(sess.token, sess);
    }
    c.session = sess;
    c.rep = new ClientReplicator({
      schema: netSchema, worldCapacity: MAX_ENTITIES, maxVisible: MAX_VISIBLE, bytesPerSecond: bandwidth, tickRate,
      position: { component: 0, x: 'x', y: 'y', z: 'z' }, priorityRange: 40,
    });
    c.ready = true;
    writer.reset();
    encodeWelcome(writer, { clientId: c.entity, tickRate, serverTick: tick, plugins: advertisedMods, session: sess.token, resumed });
    c.conn.send(writer.finish(), CHANNEL.RELIABLE);
  }

  function handleInput(c, bytes) {
    decodeInput(new BinaryReader(bytes), inBatch);
    const n = inputSchema.names.length;
    for (let k = 0; k < inBatch.count; k++) { // every packet may carry inputs we have not seen (redundancy covers lost packets); the queue drops duplicates
      const o = k * n, v = inBatch.values;
      c.queue.push(inBatch.firstSeq + k, v[o], v[o + 1], v[o + 2], v[o + 3], v[o + 4], v[o + 5]);
    }
    const newest = inBatch.firstSeq + inBatch.count - 1;
    if (inBatch.count > 0 && newest > c.newestPacketSeq) {
      c.newestPacketSeq = newest;
      c.ackTick = inBatch.ackTick; // 0 asks for a full snapshot; older (reordered) packets must not roll this back
    }
  }

  const httpServer = listen && serveStatic ? createStaticServer({ root: ROOT, index: '/examples/arena3d/client/index.html', handle: modManager ? modRoute(() => modManager.clientViews()) : undefined }) : undefined;
  httpServer?.listen(port, host); // listenWebSocket attaches to it and waits until it is listening
  const listener = listen
    ? await listenWebSocket({ server: httpServer, port, host, path: (p) => p === '/ws' || /^\/ws\/[^/]+$/.test(p), maxPayload: 4096, maxMessagesPerSecond: 200, burstMessages: 400 })
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
    world, level, rules, bodies, clients, stats, listener, sessions, mods: modManager, botState,
    /** Serve a connection made by any transport (e.g. the in-memory network). */
    attach: onConnection,
    get tick() { return tick; },
    /** Run exactly one simulation tick (for tests). */
    step: () => runTick(1 / tickRate),
    async close() {
      if (timer) clearInterval(timer);
      await listener?.close();
      await modManager?.close();
    },
  };
}
