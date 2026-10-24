// A small 3D world for the arcade kit, drawn on the same 2D canvas the rest of the kit uses: a first-person camera, blocks (walls, pillars, crates, floors of any size),
// gems to collect, a sky and a floor with lines on it, and walking that does not go through blocks. Everything is plain data (a camera is an object with numbers,
// a block is `{x, z, w, d, h, color}`), so the Time Machine, saving and hot reload work as they do for everything else. It is not the GPU renderer of
// `@engine/render`: it draws flat-shaded boxes from far to near, which is plenty for a first 3D game and runs inside the studio's game worker.
//
// The world: x goes right, y goes up, z goes towards you. A camera at yaw 0 looks along -z; a positive yaw turns it to the left. One unit is about one metre.
import { screen } from './screen.js';
import { mouseDelta } from './control.js';

const NEAR = 0.1;
const LIGHT = norm(0.45, 0.85, 0.3);
const key = (keys, ...codes) => codes.some((c) => keys.has(c));

function norm(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

/**
 * A first-person camera: where the eyes are, which way they look, and how wide they see.
 * @param {{x?: number, y?: number, z?: number, yaw?: number, pitch?: number, fov?: number, eye?: number}} [o]
 *   `y` is the height of the eyes (`eye` is how high they are when standing: jumping raises `y`), `yaw` and `pitch` are in radians (up and down is `pitch`),
 *   `fov` is the field of view in degrees
 * @returns {{x: number, y: number, z: number, yaw: number, pitch: number, fov: number, eye: number, vy: number}}
 */
export function camera3d({ x = 0, y, z = 0, yaw = 0, pitch = 0, fov = 70, eye = 1.6 } = {}) {
  return { x, y: y ?? eye, z, yaw, pitch, fov, eye, vy: 0 };
}

/** Which way a camera looks along the floor, as `{x, z}` (a unit step), and which way is to its right. */
export function forward3d(cam) {
  return { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw), rightX: Math.cos(cam.yaw), rightZ: -Math.sin(cam.yaw) };
}

const STEP = 0.5;                                  // the highest ledge you walk up without jumping

/** A point in a block's own frame (a turned block is a plain box there). */
function local(b, x, z) {
  const c = b.yaw ? Math.cos(b.yaw) : 1;
  const s = b.yaw ? Math.sin(b.yaw) : 0;
  return [(x - b.x) * c - (z - b.z) * s, (x - b.x) * s + (z - b.z) * c];
}

/** How high the top of a block is above a point of the floor: the same everywhere for a box, rising along the ramp for a ramp. */
function topAt(b, x, z) {
  const y = b.y ?? 0;
  const h = b.h ?? 3;
  if (!b.ramp) return y + h;
  const [, lz] = local(b, x, z);
  return y + h * Math.max(0, Math.min(1, (b.d / 2 - lz) / b.d));                 // low at the near end (+z), full height at the far end
}

/** Is this point (a walker of `radius` there) over the block? */
function over(b, x, z, radius) {
  const [lx, lz] = local(b, x, z);
  return Math.abs(lx) < b.w / 2 + radius && Math.abs(lz) < b.d / 2 + radius;
}

/**
 * The height of the ground under a walker: the highest top of the blocks under it that it can step onto (no more than a step above its feet), or the floor, 0.
 * @param {object[]} blocks
 * @param {number} x
 * @param {number} z
 * @param {number} [feet] how high the feet are now
 * @param {number} [radius]
 * @returns {number}
 */
export function groundAt(blocks, x, z, feet = 0, radius = 0.3) {
  let top = 0;
  for (const b of blocks) {
    if (b.solid === false || !over(b, x, z, radius)) continue;
    const t = topAt(b, x, z);
    if (t <= feet + STEP && t > top) top = t;
  }
  return top;
}

/** How high a block is at the highest place a walker at (x, z) touches: for a ramp that is the part just ahead of its middle, so a steep ramp is a wall. */
function reach(b, x, z, radius) {
  if (!b.ramp) return (b.y ?? 0) + (b.h ?? 3);
  const [, lz] = local(b, x, z);
  const t = Math.max(0, Math.min(1, (b.d / 2 - (lz - radius)) / b.d));
  return (b.y ?? 0) + (b.h ?? 3) * t;
}

const HEAD = 1.7;                                  // how far above the feet a walker's head is, for what hangs overhead

const blocking = (b, x, z, radius, feet) => b.solid !== false && over(b, x, z, radius)
  && reach(b, x, z, radius) > feet + STEP && (b.y ?? 0) < feet + HEAD;

/**
 * Move a point along the floor and slide along blocks instead of going through them. It tries the two directions one after the other, so walking
 * at a wall at an angle slides along it. A block no higher than a step above the feet is walked up, not stopped at; a ramp is walked up.
 * @param {{x: number, z: number}} pos where it is now
 * @param {number} dx how far to go along x
 * @param {number} dz how far to go along z
 * @param {{x: number, z: number, w: number, d: number, h?: number, y?: number, yaw?: number, solid?: boolean, ramp?: boolean}[]} blocks
 * @param {number} [radius] how wide the walker is
 * @param {number} [feet] the height of the walker's feet
 * @returns {{x: number, z: number}} the new place
 */
export function slideAgainst(pos, dx, dz, blocks, radius = 0.35, feet = 0) {
  const hits = (x, z) => blocks.some((b) => blocking(b, x, z, radius, feet));
  let x = pos.x;
  let z = pos.z;
  if (!hits(x + dx, z)) x += dx;
  if (!hits(x, z + dz)) z += dz;
  return { x, z };
}

/**
 * Fall, land and climb: one tick of up and down for a walker standing on blocks. It sets `cam.y` (the eyes) and `cam.grounded`. `move3d` does this for you.
 * @param {ReturnType<typeof camera3d>} cam changed in place
 * @param {object[]} blocks
 * @param {number} dt
 * @param {number} [gravity]
 */
function settle(cam, blocks, dt, gravity = 20) {
  let feet = cam.y - cam.eye;
  const ground = groundAt(blocks, cam.x, cam.z, feet);
  cam.ground = ground;
  if (cam.vy <= 0 && feet <= ground + 0.03) {                                       // on the ground: follow it up a step or a ramp, or down a ramp
    feet = feet < ground ? Math.min(ground, feet + 6 * dt) : ground;
    cam.vy = 0;
    cam.grounded = true;
  } else {
    cam.vy -= gravity * dt;
    const before = feet;
    feet += cam.vy * dt;
    cam.grounded = false;
    if (cam.vy > 0) {                                                                 // going up: bump your head on what hangs over you
      const head = cam.eye + 0.15;
      for (const b of blocks) {
        const bottom = b.y ?? 0;
        if (b.solid === false || bottom < before + head - 0.05 || !over(b, cam.x, cam.z, 0.3) || feet + head <= bottom) continue;
        feet = bottom - head;
        cam.vy = 0;
      }
    }
    if (cam.vy <= 0 && feet <= ground) { feet = ground; cam.vy = 0; cam.grounded = true; }
  }
  cam.y = feet + cam.eye;
}

/**
 * Walk and turn with the keys, one tick: the left and right arrows (or Q and E) turn, up and down arrow (or W and S) walk, A and D sidestep. Blocks stop you.
 * @param {ReturnType<typeof camera3d>} cam changed in place
 * @param {Set<string>} keys the keys held down
 * @param {number} dt seconds
 * @param {{speed?: number, turn?: number, radius?: number, blocks?: object[]}} [o] `speed` in units a second, `turn` in radians a second
 * @returns {number} how far it moved (0 when you stood still or were stopped)
 */
export function move3d(cam, keys, dt, { speed = 4, turn = 2, radius = 0.35, blocks = [] } = {}) {
  cam.yaw += ((key(keys, 'ArrowLeft', 'KeyQ') ? 1 : 0) - (key(keys, 'ArrowRight', 'KeyE') ? 1 : 0)) * turn * dt;
  const ahead = (key(keys, 'ArrowUp', 'KeyW') ? 1 : 0) - (key(keys, 'ArrowDown', 'KeyS') ? 1 : 0);
  const side = (key(keys, 'KeyD') ? 1 : 0) - (key(keys, 'KeyA') ? 1 : 0);
  let moved = 0;
  if (ahead || side) {
    const f = forward3d(cam);
    const len = Math.hypot(ahead, side);
    const step = speed * dt / len;
    const to = slideAgainst(cam, (f.x * ahead + f.rightX * side) * step, (f.z * ahead + f.rightZ * side) * step, blocks, radius, cam.y - cam.eye);
    moved = Math.hypot(to.x - cam.x, to.z - cam.z);
    cam.x = to.x;
    cam.z = to.z;
  }
  settle(cam, blocks, dt);                                           // walk up steps and ramps, fall off ledges, land
  cam.settled = true;                                                // (jump3d then only has to start the jump)
  return moved;
}

/**
 * Look around with the mouse: moving it turns the camera (left and right) and tilts it (up and down). The first time this is called the page learns that the game
 * wants the mouse, so a click on the game takes hold of it (Esc lets go). Call it every tick with the keys, next to {@link move3d}.
 * @param {ReturnType<typeof camera3d>} cam changed in place (it also remembers where the mouse was)
 * @param {Set<string>} keys
 * @param {{sensitivity?: number, invertY?: boolean}} [o] `sensitivity` is radians a pixel
 * @returns {boolean} true while the mouse is held (so you can show a hint when it is not)
 */
export function mouseLook3d(cam, keys, { sensitivity = 0.0025, invertY = false } = {}) {
  const m = mouseDelta(keys, cam);
  if (!m.locked) return false;
  cam.yaw -= m.dx * sensitivity;
  cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch - (invertY ? -1 : 1) * m.dy * sensitivity));
  return true;
}

/**
 * Walk something towards a place along the floor, sliding along blocks, for a guardian that chases you. Changes `thing.x` and `thing.z`.
 * @param {{x: number, z: number}} thing
 * @param {{x: number, z: number}} target
 * @param {number} speed units a second
 * @param {number} dt
 * @param {object[]} [blocks] what stops it
 * @param {number} [radius]
 * @returns {number} the distance left to the target
 */
export function chase3d(thing, target, speed, dt, blocks = [], radius = 0.4) {
  const dx = target.x - thing.x;
  const dz = target.z - thing.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return 0;
  const step = Math.min(dist, speed * dt);
  const to = slideAgainst(thing, (dx / dist) * step, (dz / dist) * step, blocks, radius);
  thing.x = to.x;
  thing.z = to.z;
  return Math.hypot(target.x - thing.x, target.z - thing.z);
}

/**
 * Jump with the space bar: it starts a jump when you are on the ground (the floor, a ledge, a ramp). You come down again by gravity, onto whatever is under you.
 * Call it every tick, next to {@link move3d} (which does the falling and landing); on its own it does those too, for the floor or for `blocks`.
 * @param {ReturnType<typeof camera3d>} cam changed in place
 * @param {Set<string>} keys
 * @param {number} dt
 * @param {{strength?: number, gravity?: number, blocks?: object[]}} [o] `strength` is how fast the jump starts (units a second); `gravity` how fast it slows
 * @returns {boolean} true while you are on the ground
 */
export function jump3d(cam, keys, dt, { strength = 6, gravity = 20, blocks = [] } = {}) {
  const onGround = cam.vy <= 0 && cam.y - cam.eye <= (cam.ground ?? 0) + 0.03;                 // feet on the ground that was found last tick
  if (onGround && keys.has('Space')) { cam.vy = strength; cam.grounded = false; }
  if (cam.settled) cam.settled = false;                              // move3d did the falling this tick
  else settle(cam, blocks, dt, gravity);
  return !!cam.grounded;
}

/**
 * A block to build with: its middle (`x`, `z`), its size (`w` wide, `d` deep, `h` tall, standing on `y`, the floor by default), colour, and how far it is turned
 * (`yaw` in radians, positive turns it to the left): a turned wall is stopped at and drawn as it stands.
 */
export function block(x, z, w, d, h = 3, color = '#8a93a6', y = 0, yaw = 0) {
  const b = { x, z, w, d, h, y, color };
  if (yaw) b.yaw = yaw;
  return b;
}

/**
 * A ramp: like a block, but its top rises from the floor at the near end (the +z side, where you walk up from when you face -z) to its full height `h` at the far
 * end, turned by `yaw` like a block. You walk up it, you can run up onto what it leads to, and it does not stop you.
 */
export function ramp(x, z, w, d, h = 1, color = '#9a8f78', y = 0, yaw = 0) {
  return { ...block(x, z, w, d, h, color, y, yaw), ramp: true };
}

/**
 * Stairs: `steps` blocks, each higher than the last, as a list to put in your blocks (`...stairs(...)`). The first step is at the near end (+z) and the last, at
 * height `h`, at the far end; each step is no higher than you walk up (keep `h / steps` to half a unit or less).
 */
export function stairs(x, z, w, d, h = 1, steps = 4, color = '#9a8f78', y = 0, yaw = 0) {
  const c = yaw ? Math.cos(yaw) : 1;
  const s = yaw ? Math.sin(yaw) : 0;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const lz = d / 2 - (i + 0.5) * (d / steps);
    out.push(block(x + lz * s, z + lz * c, w, d / steps, (h * (i + 1)) / steps, color, y, yaw));
  }
  return out;
}

/** A gem to collect: where it floats (`x`, `z`, height `y`), its size (`r`) and colour. */
export function gem(x, z, y = 1, color = '#4cf0c4', r = 0.3) {
  return { x, z, y, r, color };
}

// ---- looking ----

function setup(cam, W, H) {
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  const sp = Math.sin(cam.pitch);
  const cp = Math.cos(cam.pitch);
  return { cam, W, H, sy, cy, sp, cp, focal: (H / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) };
}

/** A point of the world in the camera's own space: `{r}` to the right, `{u}` up, `{d}` ahead (the depth). */
function toCamera(v, x, y, z) {
  const dx = x - v.cam.x;
  const dy = y - v.cam.y;
  const dz = z - v.cam.z;
  const r = dx * v.cy - dz * v.sy;
  const ah = -dx * v.sy - dz * v.cy;
  return { r, u: dy * v.cp - ah * v.sp, d: ah * v.cp + dy * v.sp };                  // looking up (a positive pitch) moves what is ahead down the screen
}

const onScreen = (v, p) => ({ x: v.W / 2 + (p.r / p.d) * v.focal, y: v.H / 2 - (p.u / p.d) * v.focal });

/**
 * Where a point of the world is on the screen.
 * @param {ReturnType<typeof camera3d>} cam
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{width?: number, height?: number}} [size] the screen's size (the project's by default)
 * @returns {{x: number, y: number, depth: number, scale: number} | null} null when the point is behind you; `scale` is pixels for one unit at that distance
 */
export function project3d(cam, x, y, z, { width = screen().width, height = screen().height } = {}) {
  const v = setup(cam, width, height);
  const p = toCamera(v, x, y, z);
  if (p.d < NEAR) return null;
  const s = onScreen(v, p);
  return { x: s.x, y: s.y, depth: p.d, scale: v.focal / p.d };
}

// ---- colour ----

const parse = (c) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4), 16)];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

/** The colour of a surface: its own colour, lit from one side, and fading into the fog with distance. */
function shade(color, light, depth, fog) {
  const base = parse(color);
  if (!base) return color;
  const lit = base.map((v) => Math.round(Math.min(255, v * (0.5 + 0.5 * light))));
  if (!fog || depth <= fog.near) return css(lit);
  return css(mix(lit, fog.rgb, Math.min(1, (depth - fog.near) / Math.max(0.01, fog.far - fog.near))));
}

function fogOf(o) {
  const rgb = parse(o.fog ?? o.horizon ?? '#12161f');
  return o.fogFar === 0 ? null : { rgb, near: (o.fogFar ?? 40) * 0.4, far: o.fogFar ?? 40 };
}

// ---- drawing ----

/** Cut a polygon (points in camera space) to what is in front of the camera. */
function clipNear(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = a.d >= NEAR;
    const inb = b.d >= NEAR;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (NEAR - a.d) / (b.d - a.d);
      out.push({ r: a.r + (b.r - a.r) * t, u: a.u + (b.u - a.u) * t, d: NEAR });
    }
  }
  return out;
}

function fillPolygon(g, v, poly, fill, outline = true) {
  const pts = clipNear(poly);
  if (pts.length < 3) return;
  g.beginPath();
  pts.forEach((p, i) => { const s = onScreen(v, p); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (!outline) return;
  g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  g.lineWidth = 1;
  g.stroke();
}

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
];

/** The faces of a ramp as corners in the block's own frame: [x, height, z] each. */
const RAMP_FACES = (w, d, h) => {
  const a = [-w / 2, 0, d / 2];
  const b = [w / 2, 0, d / 2];
  const c = [w / 2, h, -d / 2];
  const e = [-w / 2, h, -d / 2];
  const f = [-w / 2, 0, -d / 2];
  const g = [w / 2, 0, -d / 2];
  return [[a, b, c, e], [f, g, c, e], [a, f, e], [b, g, c]];
};

function ramp3d(g, v, cam, b, o, fog) {
  const y0 = b.y ?? 0;
  const c = b.yaw ? Math.cos(b.yaw) : 1;
  const s = b.yaw ? Math.sin(b.yaw) : 0;
  const world = ([lx, ly, lz]) => [b.x + lx * c + lz * s, y0 + ly, b.z - lx * s + lz * c];
  const middle = world([0, (b.h ?? 1) / 3, 0]);
  for (const face of RAMP_FACES(b.w, b.d, b.h ?? 1)) {
    const pts = face.map(world);
    const centre = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length, m[2] + p[2] / pts.length], [0, 0, 0]);
    const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const w = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    let n = norm(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
    if (n[0] * (centre[0] - middle[0]) + n[1] * (centre[1] - middle[1]) + n[2] * (centre[2] - middle[2]) < 0) n = [-n[0], -n[1], -n[2]];       // point away from the ramp
    if (n[0] * (cam.x - centre[0]) + n[1] * (cam.y - centre[1]) + n[2] * (cam.z - centre[2]) <= 0) continue;                                  // facing away
    const light = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    fillPolygon(g, v, pts.map((p) => toCamera(v, p[0], p[1], p[2])), shade(b.color, light, Math.hypot(centre[0] - cam.x, centre[2] - cam.z), fog), !b.seam);
  }
}

/** Draw the faces of one block that face the camera. Used by {@link drawWorld3d}; call it yourself to draw a block by itself. */
export function block3d(g, cam, b, o = {}, view = null) {
  const v = view ?? setup(cam, o.width ?? screen().width, o.height ?? screen().height);
  const fog = fogOf(o);
  if (b.ramp) return ramp3d(g, v, cam, b, o, fog);
  const y0 = b.y ?? 0;
  const h = b.h ?? 3;
  const c = b.yaw ? Math.cos(b.yaw) : 1;
  const s = b.yaw ? Math.sin(b.yaw) : 0;
  const world = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];          // a point of the block's own frame, in the world
  for (const f of FACES) {
    const nx = f.n[0] * c + f.n[2] * s;
    const nz = -f.n[0] * s + f.n[2] * c;
    const [cx, cz] = world(f.n[0] * b.w / 2, f.n[2] * b.d / 2);
    const cy = y0 + h / 2 + f.n[1] * h / 2;
    if (nx * (cam.x - cx) + f.n[1] * (cam.y - cy) + nz * (cam.z - cz) <= 0) continue;          // facing away
    const poly = f.c.map(([px, py, pz]) => { const [wx, wz] = world((px - 0.5) * b.w, (pz - 0.5) * b.d); return toCamera(v, wx, y0 + py * h, wz); });
    const light = Math.max(0, nx * LIGHT[0] + f.n[1] * LIGHT[1] + nz * LIGHT[2]);
    const depth = Math.hypot(cx - cam.x, cz - cam.z);
    fillPolygon(g, v, poly, shade(b.color, light, depth, fog), !b.seam);
  }
}

/** Draw one gem as a diamond that faces you. Used by {@link drawWorld3d}. @param {number} [time] seconds, so gems float up and down */
export function gem3d(g, cam, gm, o = {}, view = null) {
  const v = view ?? setup(cam, o.width ?? screen().width, o.height ?? screen().height);
  const bob = Math.sin((o.time ?? 0) * 2.4 + gm.x * 1.7 + gm.z) * 0.08;
  const p = toCamera(v, gm.x, (gm.y ?? 1) + bob, gm.z);
  if (p.d < NEAR) return;
  const s = onScreen(v, p);
  const r = (gm.r ?? 0.3) * v.focal / p.d;
  const fog = fogOf(o);
  const depth = Math.hypot(gm.x - cam.x, gm.z - cam.z);
  const left = shade(gm.color ?? '#4cf0c4', 1, depth, fog);
  const right = shade(gm.color ?? '#4cf0c4', 0.1, depth, fog);
  g.beginPath(); g.moveTo(s.x, s.y - r * 1.4); g.lineTo(s.x - r, s.y); g.lineTo(s.x, s.y + r * 1.4); g.closePath();
  g.fillStyle = left; g.fill();
  g.beginPath(); g.moveTo(s.x, s.y - r * 1.4); g.lineTo(s.x + r, s.y); g.lineTo(s.x, s.y + r * 1.4); g.closePath();
  g.fillStyle = right; g.fill();
}

/**
 * Fill the screen with a sky above the horizon and ground below it (the horizon moves when the camera looks up or down).
 * @param {CanvasRenderingContext2D} g
 * @param {ReturnType<typeof camera3d>} cam
 * @param {{sky?: string, horizon?: string, ground?: string, width?: number, height?: number}} [o] colours (`#rrggbb`)
 */
export function sky3d(g, cam, { sky = '#2b4a7a', horizon = '#9fb6d8', ground = '#2a2f3a', width = screen().width, height = screen().height } = {}) {
  const v = setup(cam, width, height);
  const y = Math.max(0, Math.min(height, height / 2 + Math.tan(cam.pitch) * v.focal));
  const fade = (top, bottom, from, to) => {                // a gradient where the canvas has them, one flat colour where it does not (a test's canvas)
    const gradient = g.createLinearGradient?.(0, from, 0, Math.max(from + 1, to));
    if (!gradient?.addColorStop) return top;
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    return gradient;
  };
  g.fillStyle = fade(sky, horizon, 0, y);
  g.fillRect(0, 0, width, y);
  g.fillStyle = fade(horizon, ground, y, y + (height - y) * 0.18);
  g.fillRect(0, y, width, (height - y) * 0.18);
  g.fillStyle = ground;
  g.fillRect(0, y + (height - y) * 0.18, width, height - y - (height - y) * 0.18);
}

/** Lines on the floor around you, so you can see yourself move. @param {{cell?: number, reach?: number, color?: string}} [o] */
export function floor3d(g, cam, { cell = 2, reach = 18, color = 'rgba(255, 255, 255, 0.10)', width = screen().width, height = screen().height } = {}) {
  const v = setup(cam, width, height);
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  const line = (ax, az, bx, bz) => {
    let a = toCamera(v, ax, 0, az);
    let b = toCamera(v, bx, 0, bz);
    if (a.d < NEAR && b.d < NEAR) return;
    if (a.d < NEAR) a = { r: a.r + (b.r - a.r) * ((NEAR - a.d) / (b.d - a.d)), u: a.u + (b.u - a.u) * ((NEAR - a.d) / (b.d - a.d)), d: NEAR };
    else if (b.d < NEAR) b = { r: b.r + (a.r - b.r) * ((NEAR - b.d) / (a.d - b.d)), u: b.u + (a.u - b.u) * ((NEAR - b.d) / (a.d - b.d)), d: NEAR };
    const sa = onScreen(v, a);
    const sb = onScreen(v, b);
    g.moveTo(sa.x, sa.y);
    g.lineTo(sb.x, sb.y);
  };
  const cx = Math.round(cam.x / cell) * cell;
  const cz = Math.round(cam.z / cell) * cell;
  for (let i = -reach; i <= reach; i += cell) {
    line(cx + i, cz - reach, cx + i, cz + reach);
    line(cx - reach, cz + i, cx + reach, cz + i);
  }
  g.stroke();
}

const PIECE = 3;

/**
 * Long blocks are drawn in pieces about three units long, each placed in the far-to-near order by its own middle: a long wall then never lands over a pillar
 * that stands in front of one end of it. (The pieces overlap a hair and have no outline, so you cannot see where they join.)
 */
function pieces(b) {
  if (b.ramp) return [b];
  const along = b.w >= b.d ? 'w' : 'd';
  const length = b[along];
  const n = Math.min(24, Math.ceil(length / PIECE));
  if (n <= 1) return [b];
  const c = b.yaw ? Math.cos(b.yaw) : 1;
  const s = b.yaw ? Math.sin(b.yaw) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = -length / 2 + (i + 0.5) * (length / n);
    const [lx, lz] = along === 'w' ? [t, 0] : [0, t];
    out.push({ ...b, x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c, [along]: length / n + 0.03, seam: true });
  }
  return out;
}

/**
 * Draw the whole world: the sky, the floor lines, then every block and gem from the farthest to the nearest, fading into fog in the distance.
 * @param {CanvasRenderingContext2D} g
 * @param {ReturnType<typeof camera3d>} cam
 * @param {{blocks?: object[], gems?: object[]}} world
 * @param {{time?: number, sky?: string, horizon?: string, ground?: string, fog?: string, fogFar?: number, grid?: boolean, cell?: number}} [o]
 *   `time` is seconds (gems float with it); `fogFar` is how far you can see, in units (0 turns the fog off); `grid: false` hides the floor lines. A block with `floor: true` (or lower than a step) is drawn first
 * @returns {number} how many blocks and gems were drawn (those too far away or behind you are skipped)
 */
export function drawWorld3d(g, cam, world, o = {}) {
  const width = o.width ?? screen().width;
  const height = o.height ?? screen().height;
  sky3d(g, cam, { ...o, width, height });
  if (o.grid !== false) floor3d(g, cam, { cell: o.cell, width, height });
  const v = setup(cam, width, height);
  const far = o.fogFar === 0 ? 1e9 : (o.fogFar ?? 40) + 4;
  const list = [];
  for (const b of world.blocks ?? []) {
    const d = Math.hypot(b.x - cam.x, b.z - cam.z);
    const flat = b.floor || (b.h ?? 3) < 0.3;                      // floors and thin slabs go first: they are under everything, whatever their middle's distance
    if (d - Math.max(b.w, b.d) >= far) continue;
    for (const piece of flat ? [b] : pieces(b)) {
      const pd = flat ? d + 1e6 : Math.hypot(piece.x - cam.x, piece.z - cam.z);
      list.push({ d: pd, draw: () => block3d(g, cam, piece, { ...o, width, height }, v) });
    }
  }
  for (const gm of world.gems ?? []) {
    const d = Math.hypot(gm.x - cam.x, gm.z - cam.z);
    if (d < far) list.push({ d, draw: () => gem3d(g, cam, gm, { ...o, width, height }, v) });
  }
  list.sort((a, b) => b.d - a.d);
  for (const item of list) item.draw();
  return list.length;
}
