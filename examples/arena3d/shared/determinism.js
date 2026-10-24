// Cross-engine determinism suite for the 3D arena's shared rules: the level geometry, player movement over it (what the client
// predicts) and shot tracing. Every hash must be identical in Node, Chrome and Firefox, or prediction would drift.
import { buildArenaLevel } from './level.js';
import { createBody, stepPlayer, lookDirection } from './game.js';
import { traceShot } from './shot.js';

class Hasher {
  constructor() { this.h = 0x811c9dc5; this.f64 = new Float64Array(1); this.u32 = new Uint32Array(this.f64.buffer); }
  word(w) { for (let i = 0; i < 4; i++) this.h = Math.imul(this.h ^ ((w >>> (i * 8)) & 255), 0x01000193); }
  num(v) { this.f64[0] = v; this.word(this.u32[0]); this.word(this.u32[1]); }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function scripted(t) {
  const phase = Math.floor(t / 25);
  const dirs = [[127, 0], [127, 127], [0, 127], [-127, 60], [-127, -127], [0, -127], [90, -127], [0, 0]];
  const [x, y] = dirs[(phase * 5 + 3) % dirs.length];
  return { moveX: x, moveY: y, buttons: (phase % 3 === 0 ? 2 : 0) | (t % 70 === 0 ? 1 : 0), yaw: Math.fround(((phase * 0.9) % 6.28) - 3.14) };
}

export function runArena3dSuite() {
  const exact = {}, probe = {};
  const { world, spawns } = buildArenaLevel();
  let h = new Hasher();
  for (let i = 0; i < world.verts.length; i++) h.num(world.verts[i]);
  exact['arena3d.level'] = h.hex;

  h = new Hasher();
  const input = { moveX: 0, moveY: 0, buttons: 0, yaw: 0 };
  spawns.forEach(([sx, sy, sz], k) => {
    const body = createBody(sx, sy, sz);
    for (let t = 0; t < 600; t++) {
      Object.assign(input, scripted(t + k * 13));
      stepPlayer(world, body, input, 1 / 60);
      if (t % 10 === 0) { h.num(body.x); h.num(body.y); h.num(body.z); h.num(body.vy); h.word(body.grounded ? 1 : 0); }
    }
  });
  exact['arena3d.walk'] = h.hex;

  h = new Hasher();
  const out = { victim: -1, reach: 0 };
  const ids = [3, 4, 5], xs = [0, 5, -8], ys = [0.9, 1.2, 0.9], zs = [-20, 14, 3];
  for (let k = 0; k < 400; k++) {
    const yaw = Math.fround(k * 0.0157), pitch = Math.fround(((k % 21) - 10) * 0.02);
    const [dx, dy, dz] = lookDirection(yaw, pitch);
    traceShot(world, (k % 9) - 4, 1.6, (k % 7) - 3, dx, dy, dz, 120, 3, ids, xs, ys, zs, 0.4, 0.9, 0.4, out);
    h.num(out.victim); h.num(out.reach);
  }
  exact['arena3d.shots'] = h.hex;
  return { exact, probe };
}
