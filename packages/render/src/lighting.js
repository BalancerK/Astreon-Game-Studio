import { filterColor } from './filters.js';

/**
 * 2D lighting: point lights, spot lights and a sun, with **normal maps** (flat sprites get relief), **shadows** from anything you draw into an occluder batch, and many lights at once. It works on
 * WebGPU and WebGL2 (the Canvas2D fallback draws unlit).
 *
 * ```js
 * atlas.add('floor', 64, 64, paintFloor, { normal: paintFloorNormals });          // a normal map beside the picture
 * const lighting = new Lighting2D({ ambient: '#202838' });
 * const torch = lighting.add(Light2D.point({ x: 120, y: 90, radius: 160, color: '#ffb060', shadows: true }));
 * lighting.add(Light2D.spot({ x: 300, y: 40, angle: Math.PI / 2, cone: 0.9, radius: 260 }));
 * renderer.render({ camera, batch: world, lighting, occluders: walls });           // `walls`: a batch of the things that block light
 * torch.x = player.x;                                                              // lights are plain objects: move them each frame
 * ```
 * Everything drawn in that call is lit; a sprite made with `unlit: true`, and anything drawn in another `render` call, is not. Lights are in world units.
 */

/** Most lights drawn at once (extra ones are dropped, farthest from the screen's middle first). */
export const MAX_LIGHTS = 64;
/** Most lights that can cast shadows at once (the rest still light, without shadows). */
export const MAX_SHADOW_LIGHTS = 16;
/** Directions in each shadow-casting light's shadow map. */
export const SHADOW_ANGLES = 512;
/** Most steps a shadow ray takes through the occluder picture. */
export const SHADOW_MARCH_STEPS = 512;
/** Samples along a sun's shadow ray. */
export const SUN_STEPS = 32;
/** Floats in the lighting uniform block: 4 header vectors, then 4 vectors for each light. */
export const LIGHTING_UNIFORM_FLOATS = (4 + MAX_LIGHTS * 4) * 4;

/** Light kinds as the shaders see them. */
export const LIGHT_TYPE = Object.freeze({ point: 0, spot: 1, directional: 2 });

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Light descriptions. Each is a plain object: change `x`, `y`, `color`, `intensity` and the rest between frames.
 * `height` is how far the light hangs above the picture (in world units): low lights rake across relief, high ones light it from above.
 */
export const Light2D = {
  /** A light that shines in all directions, fading to nothing at `radius`. `size` (world units) is how big the lamp is: a bigger one makes softer shadow edges. `falloff` 1 is gentle, 3 is sharp. */
  point: ({ x = 0, y = 0, height, radius = 150, color = '#ffffff', intensity = 1, falloff = 2, shadows = false, size = 4 } = {}) => ({ type: 'point', x, y, height, radius, color, intensity, falloff, shadows, size }),
  /** A light in a cone. `angle` is the direction it points (radians, 0 right, positive turning clockwise on screen), `cone` the full angle of the lit cone, `softness` 0..1 how gradually the edge fades. */
  spot: ({ x = 0, y = 0, height, angle = 0, cone = Math.PI / 3, softness = 0.3, radius = 220, color = '#ffffff', intensity = 1, falloff = 2, shadows = false, size = 4 } = {}) => ({ type: 'spot', x, y, height, angle, cone, softness, radius, color, intensity, falloff, shadows, size }),
  /** Light from far away, like the sun, with no position. `angle` is the direction the light travels (radians), `elevation` how high it stands (0 on the horizon, up to pi/2 overhead); `shadowLength` (world units) is how far a shadow reaches. */
  directional: ({ angle = Math.PI / 4, elevation = Math.PI / 4, color = '#ffffff', intensity = 1, shadows = false, shadowLength = 120, size = 2 } = {}) => ({ type: 'directional', angle, elevation, color, intensity, shadows, shadowLength, size }),
};

/** A set of lights and the settings that go with them. */
export class Lighting2D {
  /**
   * @param {object} [o]
   * @param {number | string | number[]} [o.ambient] The light that reaches everywhere (a colour; dark by default). @param {number} [o.bump] How strongly normal maps tilt the surface (1 as painted, 0 flat).
   * @param {number} [o.specular] Shine from normal-mapped surfaces (0 none, 0.5 a gloss). @param {number} [o.shininess] How tight the shine is (higher is tighter).
   * @param {boolean} [o.selfShadow] Whether a sprite that is itself an occluder is shadowed by itself (off: light falls on the top of walls). @param {boolean} [o.enabled] Turn the whole thing off without removing it.
   */
  constructor({ ambient = '#181c28', bump = 1, specular = 0, shininess = 24, selfShadow = false, enabled = true } = {}) {
    this.ambient = ambient; this.bump = bump; this.specular = specular; this.shininess = shininess; this.selfShadow = selfShadow; this.enabled = enabled;
    /** @type {object[]} */ this.lights = [];
  }
  /** Add a light (from `Light2D`) and get it back. @template T @param {T} light @returns {T} */
  add(light) { this.lights.push(light); return light; }
  /** Take a light away. @param {object} light */
  remove(light) { const i = this.lights.indexOf(light); if (i >= 0) this.lights.splice(i, 1); }
  /** Remove every light. */
  clear() { this.lights.length = 0; }
}

/**
 * Turn the lighting into the numbers the shaders read, in canvas pixels.
 * @param {Lighting2D} lighting @param {import('./camera.js').Camera} camera @param {{dpr?: number, width: number, height: number, hasOccluders?: boolean, hasNormals?: boolean, out?: Float32Array}} o `width` and `height` are the canvas size in pixels.
 * @returns {{data: Float32Array, count: number, shadowRows: {x: number, y: number, radius: number}[], sun: boolean, dropped: number}}
 */
export function packLighting(lighting, camera, { dpr = 1, width, height, hasOccluders = false, hasNormals = false, out = new Float32Array(LIGHTING_UNIFORM_FLOATS) } = {}) {
  out.fill(0);
  const k = camera.zoom * dpr;
  const toX = (wx) => ((wx - camera.renderX) * camera.zoom + camera.viewW / 2) * dpr, toY = (wy) => ((wy - camera.renderY) * camera.zoom + camera.viewH / 2) * dpr;
  const candidates = [];
  for (const l of lighting.lights) {
    if (l.intensity <= 0) continue;
    if (l.type === 'directional') { candidates.push({ l, px: width / 2, py: height / 2, priority: -1 }); continue; }
    const px = toX(l.x), py = toY(l.y), r = Math.max(0, l.radius) * k;
    if (r <= 0 || px + r < 0 || px - r > width || py + r < 0 || py - r > height) continue;
    candidates.push({ l, px, py, r, priority: Math.hypot(px - width / 2, py - height / 2) });
  }
  candidates.sort((a, b) => a.priority - b.priority);
  const dropped = Math.max(0, candidates.length - MAX_LIGHTS);
  const ambient = filterColor(lighting.ambient);
  out[0] = ambient[0]; out[1] = ambient[1]; out[2] = ambient[2];
  out[4] = lighting.shininess; out[5] = lighting.specular; out[6] = lighting.selfShadow ? 1 : 0; out[7] = SHADOW_ANGLES;
  out[8] = width; out[9] = height; out[10] = hasOccluders ? 1 : 0;
  out[12] = lighting.bump; out[13] = hasNormals ? 1 : 0;
  const shadowRows = []; let sun = false, n = 0;
  for (const c of candidates.slice(0, MAX_LIGHTS)) {
    const l = c.l, o = (4 + n * 4) * 4, color = filterColor(l.color), wantShadow = !!l.shadows && hasOccluders;
    out[o + 4] = color[0] * l.intensity * color[3]; out[o + 5] = color[1] * l.intensity * color[3]; out[o + 6] = color[2] * l.intensity * color[3];
    if (l.type === 'directional') {
      const el = clamp(num(l.elevation, Math.PI / 4), 0.05, Math.PI / 2), ce = Math.cos(el);
      out[o + 7] = LIGHT_TYPE.directional;
      out[o + 8] = -Math.cos(l.angle) * ce; out[o + 9] = -Math.sin(l.angle) * ce; out[o + 10] = Math.sin(el);
      out[o + 12] = 1; out[o + 13] = -1; out[o + 14] = Math.max(0.5, l.size * k); out[o + 15] = wantShadow ? Math.max(1, l.shadowLength * k) : 0;
      if (wantShadow) sun = true;
    } else {
      const r = c.r, height3 = (l.height === undefined ? l.radius * 0.35 : l.height) * k;
      out[o] = c.px; out[o + 1] = c.py; out[o + 2] = height3; out[o + 3] = r;
      out[o + 7] = l.type === 'spot' ? LIGHT_TYPE.spot : LIGHT_TYPE.point;
      if (l.type === 'spot') {
        const half = clamp(num(l.cone, Math.PI / 3), 0.02, Math.PI * 2 - 0.02) / 2, soft = clamp(num(l.softness, 0.3), 0, 1);
        out[o + 8] = Math.cos(l.angle); out[o + 9] = Math.sin(l.angle); out[o + 10] = Math.cos(half); out[o + 11] = Math.cos(half * (1 - soft));
      }
      out[o + 12] = Math.max(0.01, num(l.falloff, 2));
      out[o + 14] = Math.max(0.5, l.size * k);
      if (wantShadow && shadowRows.length < MAX_SHADOW_LIGHTS) { out[o + 13] = shadowRows.length; shadowRows.push({ x: c.px, y: c.py, radius: r }); } else out[o + 13] = -1;
    }
    n++;
  }
  out[3] = n;
  return { data: out, count: n, shadowRows, sun, dropped };
}

// ---------------------------------------------------------------------------------------------------------------------------- CPU reference

/**
 * The first hit on each of `angles` rays from (cx, cy), as a fraction of `radius` (1 = nothing in the way): the shadow map of one light, made the way the shader makes it.
 * @param {(x: number, y: number) => number} maskAt Occluder alpha 0..1 at a pixel position (continuous, centres at +0.5). @param {number} cx @param {number} cy @param {number} radius @param {number} [angles]
 * @returns {Float32Array}
 */
export function shadowRing(maskAt, cx, cy, radius, angles = SHADOW_ANGLES) {
  const out = new Float32Array(angles), step = Math.max(1, radius / SHADOW_MARCH_STEPS), n = Math.min(SHADOW_MARCH_STEPS, Math.ceil(radius / step));
  for (let i = 0; i < angles; i++) {
    const a = ((i + 0.5) / angles) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let hit = radius;
    for (let s = 1; s <= n; s++) { const d = s * step; if (maskAt(cx + dx * d, cy + dy * d) > 0.5) { hit = Math.min(d, radius); break; } }
    out[i] = hit / radius;
  }
  return out;
}

/** The fraction of a light that reaches distance `d` along direction (dx, dy), from one light's shadow ring: 1 lit, 0 in shadow, soft at the edges. */
export function ringVisibility(ring, radius, dx, dy, d, size, angles = SHADOW_ANGLES) {
  const dist = Math.max(1, d);
  const delta = clamp(size / dist, (Math.PI * 2) / angles, 0.2);
  let lit = 0;
  for (let k = -2; k <= 2; k++) {
    let u = (Math.atan2(dy, dx) + (k * delta) / 2) / (Math.PI * 2);
    u -= Math.floor(u);
    const f = u * angles - 0.5, i0 = Math.floor(f), t = f - i0;
    const a = ring[((i0 % angles) + angles) % angles], b = ring[(((i0 + 1) % angles) + angles) % angles];
    lit += d <= (a + (b - a) * t) * radius + 1.5 ? 1 : 0;
  }
  return lit / 5;
}

/**
 * The lighting at one pixel, as the shader computes it: the factor that multiplies the picture's colour, and the shine that is added. A pixel's `normal` is [x, y, z] in screen
 * orientation (x right, y down, z toward the viewer), already turned by the sprite's rotation.
 * @param {ReturnType<typeof packLighting>} pack @param {number} px @param {number} py Pixel position (continuous).
 * @param {number[]} normal @param {{ring?: (row: number) => Float32Array, maskAt?: (x: number, y: number) => number}} [lookups] `ring(row)`: the shadow ring of a light; `maskAt`: occluder alpha.
 * @returns {{light: number[], shine: number[]}}
 */
export function lightPixel(pack, px, py, normal, { ring, maskAt } = {}) {
  const u = pack.data, count = u[3], shininess = u[4], specular = u[5], selfShadow = u[6] > 0.5, bump = u[12];
  let nx = normal[0] * bump, ny = normal[1] * bump, nz = normal[2];
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  const inside = !selfShadow && maskAt ? maskAt(px, py) > 0.5 : false;
  const light = [u[0], u[1], u[2]], shine = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const o = (4 + i * 4) * 4, type = u[o + 7];
    let lx, ly, lz, att = 1, vis = 1;
    if (type === 2) {
      lx = u[o + 8]; ly = u[o + 9]; lz = u[o + 10];
      const len = u[o + 15];
      if (len > 0 && maskAt && !inside) {
        const dl = Math.hypot(lx, ly) || 1, sx = lx / dl, sy = ly / dl, size = u[o + 14];
        let blocked = 0;
        for (const lane of [-1, 0, 1]) {
          const ox = -sy * lane * size * 0.5, oy = sx * lane * size * 0.5;
          let hit = false;
          for (let s = 1; s <= SUN_STEPS && !hit; s++) { const d = (s / SUN_STEPS) * len; hit = maskAt(px + sx * d + ox, py + sy * d + oy) > 0.5; }
          if (hit) blocked++;
        }
        vis = 1 - blocked / 3;
      }
    } else {
      const dx = u[o] - px, dy = u[o + 1] - py, dz = u[o + 2], d = Math.hypot(dx, dy), r = u[o + 3];
      if (d >= r) continue;
      const t = clamp(1 - (d / r) * (d / r), 0, 1);
      att = t ** u[o + 12];
      const len3 = Math.hypot(dx, dy, dz);
      lx = dx / len3; ly = dy / len3; lz = dz / len3;
      if (type === 1) {
        const c = d > 0 ? (-dx / d) * u[o + 8] + (-dy / d) * u[o + 9] : 1;
        const lo = u[o + 10], hi = u[o + 11], e = clamp((c - lo) / (hi - lo === 0 ? 1e-6 : hi - lo), 0, 1);
        att *= e * e * (3 - 2 * e);
      }
      const row = u[o + 13];
      if (row >= 0 && ring && !inside && d > 0) vis = ringVisibility(ring(row), r, -dx / d, -dy / d, d, u[o + 14]);
    }
    const lam = clamp((nx * lx + ny * ly + nz * lz) / Math.max(lz, 1e-3), 0, 2.5);
    const k = att * vis;
    light[0] += u[o + 4] * k * lam; light[1] += u[o + 5] * k * lam; light[2] += u[o + 6] * k * lam;
    if (specular > 0) {
      let hx = lx, hy = ly, hz = lz + 1; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
      const s = Math.max(0, nx * hx + ny * hy + nz * hz) ** shininess * specular * k * clamp((1 - nz) * 4, 0, 1);
      shine[0] += u[o + 4] * s; shine[1] += u[o + 5] * s; shine[2] += u[o + 6] * s;
    }
  }
  return { light, shine };
}
