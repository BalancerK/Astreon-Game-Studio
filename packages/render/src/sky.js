import { buildEnvironment, cubeDirection, ENV_BLOCK_AT } from './environment.js';

/**
 * A procedural sky: a real atmosphere (light scattered by air and haze, so the blue overhead, the pale horizon and the red sunset all come from the same few numbers), a sun that
 * moves, clouds that drift, stars and a moon at night. It is drawn by the renderer per pixel, so it is sharp at any size and can change every frame at no cost, and the same model feeds
 * the lighting: `skyLighting` gives the sun's colour and direction and the ambient light for the time of day, and `proceduralSkyEnvironment` bakes a small cube so shiny things reflect this sky.
 *
 * ```js
 * const sky = createSky({ sun: sunDirection({ hour: 17.5, latitude: 45 }), turbidity: 3, clouds: { coverage: 0.5 }, stars: true });
 * // each frame (advance sky.time for drifting clouds and twinkling stars):
 * renderer.render({ camera, list, lighting: { ...createLighting(), ...skyLighting(sky), sky } });
 * renderer.setEnvironment(proceduralSkyEnvironment(sky));      // now and then (when the sun has moved a good deal): shiny surfaces reflect the sky
 * ```
 * The model is single scattering through a spherical atmosphere (Rayleigh and Mie), the same as the one in the shaders; `skyRadiance` is the CPU version, used by the tests and by anyone who
 * wants to know the colour of the sky in some direction. Directions: +y is up; `sunDirection` puts east at +x and north at -z.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Earth's radius and the top of the atmosphere, in km; the heights over which air and haze thin out; the scattering of air (per colour) and of haze, per km. */
const RE = 6360, RA = 6420, HR = 7.994, HM = 1.2, OBSERVER = 0.002;
const BETA_R = [5.8e-3, 13.5e-3, 33.1e-3], BETA_M = 21e-3;
/** Samples along the view ray, and along each ray toward the sun. */
export const SKY_VIEW_STEPS = 12;
export const SKY_LIGHT_STEPS = 4;
/** Vec4s of the sky block in the renderers' uniform table. */
export const SKY_BLOCK_VEC4S = 8;
/** Where the sky block starts in the uniform table (after the environment's own sixteen). */
export const SKY_BLOCK_AT = ENV_BLOCK_AT + 16;

/**
 * @typedef {object} Sky
 * @property {number[]} sun Unit vector pointing to the sun. @property {number} sunIntensity How bright the sunlit atmosphere is (default 22). @property {number} sunSize Angular radius of the sun's disc, radians (default 0.01).
 * @property {number} turbidity Haze: 2 very clear, 3 clear (default), 6 hazy, 10 smoggy. @property {number} rayleigh Strength of the blue air scattering (default 1). @property {number} mieG How much haze scatters forward (default 0.76).
 * @property {number} exposure Brightness of the picture (default 1.5). @property {number[]} ground Colour of the ground seen below the horizon, linear light.
 * @property {{coverage: number, density: number, scale: number, brightness: number, wind: number[]} | null} clouds @property {{brightness: number} | null} stars @property {{direction: number[], size: number, brightness: number} | null} moon
 * @property {number} time Seconds; moves the clouds along their wind and twinkles the stars.
 */

/**
 * Fill in a sky.
 * @param {{sun?: number[], sunIntensity?: number, sunSize?: number, turbidity?: number, rayleigh?: number, mieG?: number, exposure?: number, ground?: number[], clouds?: boolean | object, stars?: boolean | object, moon?: boolean | object, time?: number}} [o]
 * `clouds`: `true` or `{ coverage 0..1 (0.4), density 0..1 (0.9), scale (1.5: bigger is smaller clouds), brightness (1), wind [x, y] per second (0.004, 0.0015) }`. `stars`: `true` or `{ brightness }`.
 * `moon`: `true` or `{ direction, size (0.012), brightness (0.9) }`. @returns {Sky}
 */
export function createSky({ sun = [0.3, 0.6, 0.45], sunIntensity = 22, sunSize = 0.01, turbidity = 3, rayleigh = 1, mieG = 0.76, exposure = 1.5, ground = [0.18, 0.16, 0.13], clouds = false, stars = false, moon = false, time = 0 } = {}) {
  const c = clouds === true ? {} : clouds;
  const s = stars === true ? {} : stars;
  const m = moon === true ? {} : moon;
  return {
    sun: norm3(sun), sunIntensity, sunSize, turbidity: clamp(turbidity, 1, 20), rayleigh, mieG: clamp(mieG, 0, 0.99), exposure, ground,
    clouds: c ? { coverage: clamp(c.coverage ?? 0.4, 0, 1), density: clamp(c.density ?? 0.9, 0, 1), scale: c.scale ?? 1.5, brightness: c.brightness ?? 1, wind: c.wind ?? [0.004, 0.0015] } : null,
    stars: s ? { brightness: s.brightness ?? 1 } : null,
    moon: m ? { direction: norm3(m.direction ?? [-0.3, 0.55, -0.4]), size: m.size ?? 0.012, brightness: m.brightness ?? 0.9 } : null,
    time,
  };
}

/**
 * Where the sun is: a unit vector toward it, for a time of day and place.
 * @param {{hour?: number, dayOfYear?: number, latitude?: number}} [o] `hour`: local solar time, 0 to 24 (12 is noon). `dayOfYear`: 1 to 365 (172 is the northern midsummer). `latitude`: degrees, positive north.
 * @returns {number[]} East is +x, north is -z, up is +y.
 */
export function sunDirection({ hour = 12, dayOfYear = 80, latitude = 45 } = {}) {
  const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365), lat = latitude * Math.PI / 180, h = (hour - 12) * Math.PI / 12;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  // azimuth measured from north through east
  const cosAz = (Math.sin(decl) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat) || 1e-9);
  let az = Math.acos(clamp(cosAz, -1, 1)); if (h > 0) az = 2 * Math.PI - az;
  return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)];
}

// ---------------------------------------------------------------------------------------------------------------------------- noise (the same integer hash in the shaders)

function hash3(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const unit24 = (h) => (h >>> 8) / 16777216;
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = unit24(hash3(ix, iy, 11)), b = unit24(hash3(ix + 1, iy, 11)), c = unit24(hash3(ix, iy + 1, 11)), d = unit24(hash3(ix + 1, iy + 1, 11));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const cloudNoise = (x, y) => (vnoise(x, y) * 0.5 + vnoise(x * 2, y * 2) * 0.25 + vnoise(x * 4, y * 4) * 0.125 + vnoise(x * 8, y * 8) * 0.0625) / 0.9375;

// ---------------------------------------------------------------------------------------------------------------------------- the atmosphere

/** Distance along a ray from `o` (with unit direction `d`) to leave a sphere of radius `r` centred on the origin; the ray must start inside. */
function exitDistance(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  return -b + Math.sqrt(Math.max(b * b - c, 0));
}
/** Does a ray from `o` toward `d` hit the planet? */
function hitsPlanet(o, d) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - RE * RE, disc = b * b - c;
  return disc > 0 && -b - Math.sqrt(disc) > 0;
}

/**
 * How much of the sun's light gets to the ground, per colour (1 in a perfectly clear sky overhead; reddish and weak near the horizon; 0 when the sun is below it).
 * @param {Sky} sky @returns {number[]}
 */
export function sunColor(sky) {
  const s = sky.sun;
  if (s[1] <= 0) return [0, 0, 0];
  const o = [0, RE + OBSERVER, 0], len = exitDistance(o, s, RA), steps = 8, ds = len / steps, ms = sky.turbidity / 3;
  let odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) { const t = (i + 0.5) * ds, h = Math.hypot(o[0] + s[0] * t, o[1] + s[1] * t, o[2] + s[2] * t) - RE; odR += Math.exp(-h / HR) * ds; odM += Math.exp(-h / HM) * ds; }
  return BETA_R.map((b) => Math.exp(-(b * sky.rayleigh * odR + BETA_M * ms * 1.1 * odM)));
}

/**
 * The light from a direction, in linear light before the sky's exposure (so it can be above 1 near the sun).
 * @param {number[]} dir A unit vector. @param {Sky} sky @param {number[]} [out] @param {{details?: boolean, disc?: boolean}} [o] `details: false` leaves out clouds, stars and the moon, `disc: false` the sun's disc (for the baked lighting cube).
 * @returns {number[]}
 */
export function skyRadiance(dir, sky, out = [0, 0, 0], { details = true, disc = true } = {}) {
  const s = sky.sun, ms = sky.turbidity / 3, rs = sky.rayleigh;
  const dy = Math.max(dir[1], 0.0005), len2 = Math.hypot(dir[0], dy, dir[2]), d = [dir[0] / len2, dy / len2, dir[2] / len2];
  const o = [0, RE + OBSERVER, 0], tMax = exitDistance(o, d, RA);
  let sumR = [0, 0, 0], sumM = [0, 0, 0], odR = 0, odM = 0;
  for (let i = 0; i < SKY_VIEW_STEPS; i++) {
    const t0 = tMax * (i / SKY_VIEW_STEPS) ** 2, t1 = tMax * ((i + 1) / SKY_VIEW_STEPS) ** 2, tm = (t0 + t1) / 2, ds = t1 - t0;
    const p = [o[0] + d[0] * tm, o[1] + d[1] * tm, o[2] + d[2] * tm], h = Math.hypot(p[0], p[1], p[2]) - RE;
    const hr = Math.exp(-h / HR) * ds, hm = Math.exp(-h / HM) * ds;
    odR += hr; odM += hm;
    if (hitsPlanet(p, s)) continue;                                                        // this part of the sky is in the planet's shadow
    const tl = exitDistance(p, s, RA), dl = tl / SKY_LIGHT_STEPS;
    let lR = 0, lM = 0;
    for (let j = 0; j < SKY_LIGHT_STEPS; j++) { const tt = (j + 0.5) * dl, hl = Math.hypot(p[0] + s[0] * tt, p[1] + s[1] * tt, p[2] + s[2] * tt) - RE; lR += Math.exp(-hl / HR) * dl; lM += Math.exp(-hl / HM) * dl; }
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(BETA_R[k] * rs * (odR + lR) + BETA_M * ms * 1.1 * (odM + lM)));
      sumR[k] += att * hr; sumM[k] += att * hm;
    }
  }
  const mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], g = sky.mieG;
  const phaseR = 3 / (16 * Math.PI) * (1 + mu * mu), phaseM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * (1 + g * g - 2 * g * mu) ** 1.5);
  const sky0 = [0, 1, 2].map((k) => (sumR[k] * BETA_R[k] * rs * phaseR + sumM[k] * BETA_M * ms * phaseM) * sky.sunIntensity);
  const tSun = sunColor(sky), above = Math.max(s[1], 0);
  // below the horizon: the ground, lit by the sun and the sky near the horizon, faded in over a few degrees
  const gl = (sky0[0] + sky0[1] + sky0[2]) / 3 * 0.5, groundRad = sky.ground.map((c, k) => c * (gl + tSun[k] * above * sky.sunIntensity * 0.05));
  const blend = smoothstep(0, -0.06, dir[1]);
  for (let k = 0; k < 3; k++) out[k] = mix(sky0[k], groundRad[k], blend);
  if (dir[1] <= 0) return out;
  if (details) {
    const night = smoothstep(0.0, -0.18, s[1]), view = dir[1];
    if (sky.clouds) {
      const c = sky.clouds, t = 1 / (view + 0.1), px = dir[0] * t * c.scale + sky.time * c.wind[0], py = dir[2] * t * c.scale + sky.time * c.wind[1];
      const n = cloudNoise(px, py), n2 = cloudNoise(px + s[0] * 0.12, py + s[2] * 0.12);
      const a = smoothstep(1 - c.coverage - 0.12, 1 - c.coverage + 0.12, n) * c.density * smoothstep(0, 0.15, view);
      const shade = clamp(1 - (n2 - n) * 2.5, 0.35, 1), gray = (out[0] + out[1] + out[2]) / 3;
      for (let k = 0; k < 3; k++) { const cloud = (tSun[k] * (0.9 * Math.max(s[1] + 0.15, 0) + 0.1) * shade * 1.3 + gray * 1.6) * c.brightness; out[k] = mix(out[k], cloud, a); }
    }
    if (sky.stars && night > 0) {
      const gx = dir[0] * 90, gy = dir[1] * 90, gz = dir[2] * 90, cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
      const h = hash3(cx, cy, cz);
      if (unit24(h) < 0.015) {
        const px = 0.25 + 0.5 * unit24(hash3(cx + 31, cy, cz)), py = 0.25 + 0.5 * unit24(hash3(cx, cy + 31, cz)), pz = 0.25 + 0.5 * unit24(hash3(cx, cy, cz + 31));
        const dd = Math.hypot(gx - cx - px, gy - cy - py, gz - cz - pz), twinkle = 0.8 + 0.2 * Math.sin(sky.time * 3 + unit24(hash3(cx, cy, cz + 77)) * 40);
        const star = smoothstep(0.14, 0.0, dd) * (0.3 + 0.7 * unit24(hash3(cx, cy + 53, cz))) * twinkle * sky.stars.brightness * 2 * night * smoothstep(0, 0.1, view);
        for (let k = 0; k < 3; k++) out[k] += star;
      }
    }
    if (sky.moon) {
      const m = sky.moon, cm = dir[0] * m.direction[0] + dir[1] * m.direction[1] + dir[2] * m.direction[2], r = m.size;
      const dsc = smoothstep(Math.cos(r * 1.08), Math.cos(r * 0.92), cm), halo = Math.exp(-(1 - cm) / (r * r * 40)) * 0.02, vis = (0.2 + 0.8 * night);
      for (let k = 0; k < 3; k++) out[k] += m.brightness * (dsc * 0.85 + halo) * vis * (k === 2 ? 1 : 0.96);
    }
  }
  if (disc) {
    const cosR = Math.cos(sky.sunSize), soft = (1 - cosR) * 0.5, sd = smoothstep(cosR - soft, cosR, mu);
    for (let k = 0; k < 3; k++) out[k] += tSun[k] * sd * 40;
  }
  return out;
}

/** The colour shown for a direction: the radiance with the sky's exposure applied and squeezed into 0..1 (`1 - exp(-radiance * exposure)`), still in linear light. @param {number[]} dir @param {Sky} sky @param {number[]} [out] */
export function skyColor(dir, sky, out = [0, 0, 0]) {
  skyRadiance(dir, sky, out);
  for (let k = 0; k < 3; k++) out[k] = 1 - Math.exp(-out[k] * sky.exposure);
  return out;
}

/**
 * The lighting settings that go with a sky: the direct light (the sun by day, the moon at night), the ambient light from the sky above and the ground below, and a fog colour of the horizon.
 * Spread them over `createLighting()`: `{ ...createLighting(), ...skyLighting(sky), sky }`.
 * @param {Sky} sky
 * @returns {{direction: number[], color: number[], ambientSky: number[], ambientGround: number[], fogColor: number[]}}
 */
export function skyLighting(sky) {
  const sun = sunColor(sky), up = skyColor([0, 1, 0], sky), s = sky.sun;
  const horizonDir = norm3([-s[0] || 0.01, 0.12, -s[2] || 0.01]), horizon = skyColor(horizonDir, sky);
  const day = smoothstep(-0.04, 0.12, s[1]);
  const moon = sky.moon ? sky.moon.direction : [-s[0], Math.max(0.2, -s[1]), -s[2]];
  const moonLit = sky.moon ? smoothstep(0, 0.2, moon[1]) * (1 - day) * 0.12 : 0;
  const direction = day > 0.01 ? s : moon.slice(), color = day > 0.01 ? sun.map((c) => c * day) : [0.55 * moonLit, 0.62 * moonLit, 0.8 * moonLit];
  const ambientSky = up.map((c, k) => c * 0.7 + 0.01 * (k + 1)), ambientGround = sky.ground.map((c, k) => c * (0.25 + 0.5 * horizon[k] * day) + 0.004);
  return { direction: norm3(direction), color, ambientSky, ambientGround, fogColor: horizon };
}

/**
 * A small cube of the sky for lighting and reflections (hand it to `renderer.setEnvironment`). It leaves out the sun's disc, because the sun lights things as a direct light, and the clouds,
 * stars and moon, which are too fine for a cube this size; make a new one when the sun has moved a good deal (once a minute of game time is plenty).
 * @param {Sky} sky @param {number} [size] 16 to 128, a power of two.
 */
export function proceduralSkyEnvironment(sky, size = 32) {
  const faces = [];
  const dir = [0, 0, 0], rad = [0, 0, 0];
  for (let face = 0; face < 6; face++) {
    const data = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        cubeDirection(face, ((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1, dir);
        const d = norm3(dir);
        skyRadiance(d, sky, rad, { details: false, disc: false });
        const o = (y * size + x) * 3;
        data[o] = rad[0] * sky.exposure; data[o + 1] = rad[1] * sky.exposure; data[o + 2] = rad[2] * sky.exposure;
      }
    }
    faces.push(data);
  }
  return buildEnvironment(faces, size);
}

/**
 * Write the sky's numbers (eight vec4s) into a renderer's uniform table: sun and its brightness; haze, air, forward scattering, exposure; ground colour and the cosine of the sun's size; cloud
 * coverage, density, scale, brightness; cloud offset, star brightness, time; moon direction and brightness; the moon's edge cosines and size and whether there are clouds; the sun's colour and whether there is a moon.
 * @param {Float32Array} table @param {number} at The vec4 to start at. @param {Sky} sky
 */
export function writeSkyBlock(table, at, sky) {
  const o = at * 4, c = sky.clouds, m = sky.moon, t = sunColor(sky);
  table.fill(0, o, o + SKY_BLOCK_VEC4S * 4);
  table.set([sky.sun[0], sky.sun[1], sky.sun[2], sky.sunIntensity], o);
  table.set([sky.turbidity / 3, sky.rayleigh, sky.mieG, sky.exposure], o + 4);
  table.set([sky.ground[0], sky.ground[1], sky.ground[2], Math.cos(sky.sunSize)], o + 8);
  if (c) table.set([c.coverage, c.density, c.scale, c.brightness, sky.time * c.wind[0], sky.time * c.wind[1]], o + 12);
  table[o + 18] = sky.stars ? sky.stars.brightness : 0; table[o + 19] = sky.time;
  if (m) table.set([m.direction[0], m.direction[1], m.direction[2], m.brightness, Math.cos(m.size * 1.08), Math.cos(m.size * 0.92), m.size], o + 20);
  table[o + 27] = c ? 1 : 0;
  table.set([t[0], t[1], t[2], m ? 1 : 0], o + 28);
}

/** The physical constants of the atmosphere model, shared with the shader sources in sky-shaders.js. */
export const SKY_CONSTANTS = Object.freeze({ RE, RA, HR, HM, OBSERVER, BETA_R, BETA_M });
