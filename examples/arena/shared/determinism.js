// Determinism suite: runs the code that client prediction and the server share, and hashes every
// result bit-for-bit. If two JavaScript engines (V8, SpiderMonkey, JavaScriptCore) disagree on any
// `exact` hash, prediction would drift on that engine. `probe` hashes cover Math functions the
// language does NOT specify exactly; they are informational and show why shared code avoids them.
import { World } from '../../../packages/core/src/index.js';
import { SpatialHash, sweepAabbVsAabb, moveAndSlide, createMoveResult } from '../../../packages/physics/src/index.js';
import { q, i8, u16, BinaryWriter, Snapshot, SnapshotCodec } from '../../../packages/protocol/src/index.js';
import { InterpolationClock } from '../../../packages/client/src/index.js';
import { applyInput, buildWalls, buildWallHash, netSchema, Pos, Style, Health, TICK_RATE } from './game.js';
import { PredictedPlayer } from '../client/predict.js';

/** xorshift32: integer-only PRNG, identical everywhere. Returns uint32. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}
const unit = (u) => u / 4294967296;

class Hasher {
  constructor() {
    this.h = 0x811c9dc5;
    this.f64 = new Float64Array(1);
    this.u32 = new Uint32Array(this.f64.buffer);
  }

  word(w) {
    for (let i = 0; i < 4; i++) this.h = Math.imul(this.h ^ ((w >>> (i * 8)) & 255), 0x01000193);
  }

  /** Hash the exact bit pattern of a double (all NaNs count as one). */
  num(v) {
    if (v !== v) { this.word(0x7ff80000); this.word(0); return; }
    this.f64[0] = v;
    this.word(this.u32[0]);
    this.word(this.u32[1]);
  }

  bytes(b) { for (let i = 0; i < b.length; i++) this.h = Math.imul(this.h ^ b[i], 0x01000193); }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function movement() {
  const walls = buildWallHash(buildWalls());
  const r = rng(1);
  const h = new Hasher();
  for (const dt of [1 / TICK_RATE, 1 / 120]) {
    for (let run = 0; run < 30; run++) {
      const p = { x: 100 + unit(r()) * 2200, y: 100 + unit(r()) * 2200 };
      for (let step = 0; step < 400; step++) {
        const mx = r() % 5 === 0 ? 0 : (r() % 255) - 127;
        const my = r() % 5 === 0 ? 0 : (r() % 255) - 127;
        applyInput(walls, p, mx, my, r() % 4, dt);
        h.num(p.x); h.num(p.y);
      }
    }
  }
  return h.hex;
}

function sweeps() {
  const r = rng(2);
  const h = new Hasher();
  const out = {};
  for (let scene = 0; scene < 20; scene++) {
    const size = 400;
    const cell = [8, 20, 50][scene % 3];
    const boxes = Array.from({ length: 60 }, () => ({ x: unit(r()) * size, y: unit(r()) * size, hw: 0.5 + unit(r()) * 12, hh: 0.5 + unit(r()) * 12 }));
    const hash = new SpatialHash({ width: size, height: size, cellSize: cell, capacity: boxes.length });
    boxes.forEach((b, i) => hash.insert(i, b.x, b.y, b.hw, b.hh));
    hash.build();
    for (let k = 0; k < 150; k++) {
      const hw = r() % 4 === 0 ? 0 : 0.3 + unit(r()) * Math.min(cell, 5);
      const hh = hw === 0 ? 0 : 0.3 + unit(r()) * Math.min(cell, 5);
      const cx = 20 + unit(r()) * 360, cy = 20 + unit(r()) * 360;
      const dx = (unit(r()) - 0.5) * 200, dy = (unit(r()) - 0.5) * 200;
      const found = hash.sweep(cx, cy, hw, hh, dx, dy, 0xffffffff, -1, out);
      h.word(found ? 1 : 0);
      if (found) { h.num(out.t); h.num(out.nx); h.num(out.ny); h.word(out.index); }
      const b = boxes[k % boxes.length];
      const n = sweepAabbVsAabb(cx, cy, hw, hh, dx, dy, b.x, b.y, b.hw, b.hh, out);
      h.word(n ? 1 : 0);
      if (n) { h.num(out.t); h.num(out.nx); h.num(out.ny); }
    }
  }
  return h.hex;
}

function slidingBigSteps() {
  const walls = buildWallHash(buildWalls());
  const r = rng(3);
  const h = new Hasher();
  const res = createMoveResult();
  for (let i = 0; i < 3000; i++) {
    const x = 60 + unit(r()) * 2280, y = 60 + unit(r()) * 2280;
    const dx = (unit(r()) - 0.5) * 900, dy = (unit(r()) - 0.5) * 900;
    moveAndSlide(walls, x, y, 14, 14, dx, dy, 1, -1, res);
    h.num(res.x); h.num(res.y); h.word(res.hit ? 1 : 0); h.num(res.nx); h.num(res.ny); h.word(res.index >>> 0);
  }
  return h.hex;
}

function quantization() {
  const r = rng(4);
  const h = new Hasher();
  const codecs = [q(-1000, 1000, 16), q(0, 2400, 16), q(0, 1, 8), q(-5, 5, 32), q(-100, 100, 16), i8, u16];
  for (const c of codecs) {
    const specials = [0, -0, 0.5, 1, -1, 2399.9999, 2400, 2400.0001, -1000, 1000, 1e9, -1e9, NaN, 0.1, 0.2, 0.3, 1 / 3];
    for (const v of specials) { const s = c.quantize(v); h.num(s); h.num(c.dequantize(s)); }
    for (let i = 0; i < 3000; i++) {
      const v = (unit(r()) - 0.5) * 6000;
      const s = c.quantize(v);
      h.num(s); h.num(c.dequantize(s));
    }
  }
  return h.hex;
}

function snapshotBytes() {
  const r = rng(5);
  const world = new World(256);
  world.register(Pos);
  world.register(Style);
  world.register(Health);
  const ids = new Uint32Array(256);
  for (let i = 0; i < 80; i++) {
    const e = world.create();
    world.add(e, Pos, { x: unit(r()) * 2400, y: unit(r()) * 2400 });
    world.add(e, Style, { hue: r() & 255, radius: 10 + (r() % 8) });
    world.add(e, Health, { hp: 1 + (r() % 100) });
  }
  const codec = new SnapshotCodec(netSchema, 256);
  const a = new Snapshot(netSchema, 256), b = new Snapshot(netSchema, 256);
  const w = new BinaryWriter(8192);
  const h = new Hasher();
  let n = world.query(ids, [Pos]);
  a.capture(world, 1, ids, n);
  const px = world.data(Pos).x, py = world.data(Pos).y;
  for (let tick = 2; tick < 40; tick++) {
    for (let i = 0; i < 80; i++) if (r() % 4 === 0) { px[i] += (unit(r()) - 0.5) * 20; py[i] += (unit(r()) - 0.5) * 20; }
    if (tick % 9 === 0) world.destroy(ids[r() % 80]);
    n = world.query(ids, [Pos]);
    b.capture(world, tick, ids, n);
    w.reset(); codec.encode(w, b, tick % 5 === 0 ? null : a); h.bytes(w.finish());
    a.tick = b.tick; a.count = b.count;
    a.ids.set(b.ids.subarray(0, b.count)); a.masks.set(b.masks.subarray(0, b.count));
    a.vals.set(b.vals.subarray(0, b.count * netSchema.fieldCount));
  }
  return h.hex;
}

function prediction() {
  const walls = buildWallHash(buildWalls());
  const r = rng(6);
  const h = new Hasher();
  const p = new PredictedPlayer(walls, 1 / TICK_RATE);
  const server = { x: 300, y: 300 };
  p.reconcile(0, server.x, server.y);
  for (let t = 1; t <= 2000; t++) {
    const mx = (r() % 255) - 127, my = (r() % 255) - 127, b = r() % 3 === 0 ? 1 : 0;
    p.record(t, mx, my, b);
    applyInput(walls, server, mx, my, b, 1 / TICK_RATE);
    if (t % 7 === 0) {
      const shove = r() % 40 === 0 ? 25 : 0; // occasional server-side disagreement to force replays
      p.reconcile(t - 3, server.x + shove, server.y);
    }
    h.num(p.x); h.num(p.y); h.num(p.offsetX); h.num(p.offsetY);
  }
  h.word(p.stats.corrections); h.word(p.stats.snaps);
  return h.hex;
}

function interpolationClock() {
  const r = rng(7);
  const h = new Hasher();
  const tickMs = 1000 / TICK_RATE;
  const c = new InterpolationClock({ tickMs });
  for (let i = 0; i < 3000; i++) {
    if (r() % 8 !== 0) c.onSnapshot(i * tickMs + 40 + unit(r()) * 30, i);
    h.num(c.renderTick(i * tickMs + 20));
    if (i % 50 === 0) { h.num(c.lateness ?? 0); h.num(c.jitter); h.num(c.gapPeak); h.num(c.bufferTicks); }
  }
  return h.hex;
}

/** Math functions the language leaves implementation-defined: engines may legitimately differ. */
function probes() {
  const out = {};
  const inputs = [];
  const r = rng(8);
  for (let i = 0; i < 4000; i++) inputs.push((unit(r()) - 0.5) * 40);
  const fns = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, exp: Math.exp, log: (x) => Math.log(Math.abs(x) + 1), // determinism-ok: deliberate probe of unspecified functions
    sinh: Math.sinh, cbrt: Math.cbrt, expm1: Math.expm1, log1p: (x) => Math.log1p(Math.abs(x)), // determinism-ok: deliberate probe of unspecified functions
    pow: (x) => Math.pow(Math.abs(x) + 0.1, 1.37), atan2: (x) => Math.atan2(x, 3.7), hypot: (x) => Math.hypot(x, 2.5), // determinism-ok: deliberate probe of unspecified functions
  };
  for (const [name, fn] of Object.entries(fns)) {
    const h = new Hasher();
    for (const x of inputs) h.num(fn(x));
    out[name] = h.hex;
  }
  return out;
}

/** @returns {{exact: Record<string, string>, probe: Record<string, string>}} */
export function runDeterminismSuite() {
  return {
    exact: {
      movement: movement(),
      sweeps: sweeps(),
      slidingBigSteps: slidingBigSteps(),
      quantization: quantization(),
      snapshotBytes: snapshotBytes(),
      prediction: prediction(),
      interpolationClock: interpolationClock(),
    },
    probe: probes(),
  };
}
