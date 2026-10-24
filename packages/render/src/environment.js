/**
 * Environment lighting for the 3D renderers: the light that comes from all around, as a small cube of colours (a sky, a room, a sunset). Surfaces with a physically based material
 * (see `materials.js`) are lit by it and reflect it, so a polished metal shows the sky and a rough stone is lit softly from where the light really is; and it can be drawn as the sky behind
 * everything. An `Environment` is plain data made in Node or the browser, with no GPU in it; give it to a renderer with `renderer.setEnvironment(env)`.
 *
 * Making one costs a few tens of milliseconds, once: the cube is turned into
 * - **spherical harmonics** (nine numbers per colour channel) that give the soft light a surface facing any direction receives, for its diffuse colour, and
 * - a **prefiltered chain** of smaller and smaller, blurrier cubes, one for each step of roughness, so a rough surface reflects a blurred sky and a smooth one a sharp one,
 * and everything is deterministic (no random numbers, no clock), so the same input always gives the same bytes.
 *
 * Directions: +y is up, the cube faces are in the usual order (+x, -x, +y, -y, +z, -z), and a picture wrapped round the sky (`environmentFromImage`) has the -z direction in its middle.
 */

import { decodeImageInBrowser } from './gltf.js';

const FACES = 6;
/** Faces of a cube map, in the order the GPU wants them: +x, -x, +y, -y, +z, -z. */
export const CUBE_FACES = ['+x', '-x', '+y', '-y', '+z', '-z'];
/** The numbers of the environment block of the renderers' uniform table (in vec4s, after the 128 materials of 5 vec4s each). */
export const ENV_BLOCK_AT = 640;
/** Size of the environment block: parameters (2), nine spherical harmonic colours, and the inverse view-projection matrix (4), padded to 16, then eight for a procedural sky (see sky.js) and 49 for water (see water.js). */
export const ENV_BLOCK_VEC4S = 73;

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * The direction a texel of a cube face looks at (not normalised).
 * @param {number} face 0 to 5, in `CUBE_FACES` order
 * @param {number} sc across the face, -1 to 1 (left to right)
 * @param {number} tc down the face, -1 to 1 (top to bottom)
 * @param {number[]} [out]
 */
export function cubeDirection(face, sc, tc, out = [0, 0, 0]) {
  switch (face) {
    case 0: out[0] = 1; out[1] = -tc; out[2] = -sc; break;
    case 1: out[0] = -1; out[1] = -tc; out[2] = sc; break;
    case 2: out[0] = sc; out[1] = 1; out[2] = tc; break;
    case 3: out[0] = sc; out[1] = -1; out[2] = -tc; break;
    case 4: out[0] = sc; out[1] = -tc; out[2] = 1; break;
    default: out[0] = -sc; out[1] = -tc; out[2] = -1; break;
  }
  return out;
}

/** Which face a direction hits, and where on it (u, v from 0 to 1, v downward). The inverse of `cubeDirection`. */
function cubeLookup(x, y, z, out) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face, sc, tc, ma;
  if (ax >= ay && ax >= az) { ma = ax; if (x > 0) { face = 0; sc = -z; tc = -y; } else { face = 1; sc = z; tc = -y; } }
  else if (ay >= az) { ma = ay; if (y > 0) { face = 2; sc = x; tc = z; } else { face = 3; sc = x; tc = -z; } }
  else { ma = az; if (z > 0) { face = 4; sc = x; tc = -y; } else { face = 5; sc = -x; tc = -y; } }
  out.face = face; out.u = 0.5 * (sc / ma + 1); out.v = 0.5 * (tc / ma + 1);
  return out;
}

const hit = { face: 0, u: 0, v: 0 };

/** Bilinear lookup of a cube of `size` texels a side (faces of RGB floats) in a direction, clamped at the edges of a face. */
function sampleCube(faces, size, x, y, z, out) {
  cubeLookup(x, y, z, hit);
  const fx = clamp(hit.u * size - 0.5, 0, size - 1), fy = clamp(hit.v * size - 0.5, 0, size - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const f = faces[hit.face];
  for (let c = 0; c < 3; c++) {
    const a = f[(y0 * size + x0) * 3 + c] * (1 - tx) + f[(y0 * size + x1) * 3 + c] * tx;
    const b = f[(y1 * size + x0) * 3 + c] * (1 - tx) + f[(y1 * size + x1) * 3 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

/** The faces of a cube made by filling each texel from a function of its direction (a unit vector). */
function fillCube(size, colourAt) {
  const faces = [];
  const d = [0, 0, 0], c = [0, 0, 0];
  for (let f = 0; f < FACES; f++) {
    const data = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        cubeDirection(f, (2 * (x + 0.5)) / size - 1, (2 * (y + 0.5)) / size - 1, d);
        const l = Math.hypot(d[0], d[1], d[2]);
        colourAt(d[0] / l, d[1] / l, d[2] / l, c);
        data[(y * size + x) * 3] = c[0]; data[(y * size + x) * 3 + 1] = c[1]; data[(y * size + x) * 3 + 2] = c[2];
      }
    }
    faces.push(data);
  }
  return faces;
}

// ---------- the sources ----------

/**
 * @typedef {Object} SkyOptions
 * @property {number[]} [zenith] Colour straight up, linear light (default a clear blue)
 * @property {number[]} [horizon] Colour at the horizon (default pale)
 * @property {number[]} [ground] Colour below the horizon (default a dark earth)
 * @property {{direction: number[], color?: number[], intensity?: number, size?: number}} [sun] A sun: the direction TO it, its colour, how bright (default 20, above 1 so it lights and glints strongly), and its radius in radians (default 0.05)
 * @property {number} [size] Texels per cube side: 16 to 256, a power of two (default 64)
 */

/**
 * A sky made from a few colours and a sun, with no picture needed: the colours blend from the horizon up to the zenith and down to the ground, and the sun is a bright soft disc.
 * @param {SkyOptions} [o]
 * @returns {Environment}
 */
export function skyEnvironment({ zenith = [0.18, 0.38, 0.85], horizon = [0.72, 0.8, 0.9], ground = [0.16, 0.14, 0.12], sun, size = 64 } = {}) {
  const sd = sun ? norm3(sun.direction) : null;
  const sc = sun?.color ?? [1, 0.93, 0.8], si = sun?.intensity ?? 20, sr = sun?.size ?? 0.05;
  const edge0 = Math.cos(sr * 1.6), edge1 = Math.cos(sr);
  return buildEnvironment(fillCube(checkSize(size), (x, y, z, out) => {
    for (let k = 0; k < 3; k++) {
      out[k] = y >= 0 ? lerp(horizon[k], zenith[k], y ** 0.55) : lerp(horizon[k], ground[k], smoothstep(0, 0.25, -y));
    }
    if (sd) {
      const s = smoothstep(edge0, edge1, x * sd[0] + y * sd[1] + z * sd[2]) * si;
      for (let k = 0; k < 3; k++) out[k] += sc[k] * s;
    }
  }), size);
}

/**
 * An environment from a picture wrapped round the sky (an "equirectangular" panorama: the whole sky in one picture twice as wide as it is tall), like the ones sold as HDRIs.
 * RGBA bytes (a PNG or JPEG decoded by the browser) are read as sRGB and turned into linear light; a `Float32Array` of RGB or RGBA (from `parseHdr`) is used as it is, which is what keeps a
 * bright sun bright. The -z direction is in the middle of the picture.
 * @param {{width: number, height: number, data: ArrayLike<number>}} image
 * @param {{size?: number, intensity?: number}} [o] `size`: texels per cube side (default 64); `intensity`: multiplies everything (default 1)
 * @returns {Environment}
 */
export function environmentFromImage(image, { size = 64, intensity = 1 } = {}) {
  const { width: w, height: h, data } = image ?? {};
  if (!(w >= 2) || !(h >= 2)) throw new Error('an environment picture needs a width and a height of at least 2 pixels');
  const float = data instanceof Float32Array || data instanceof Float64Array;
  const stride = float ? (data.length === w * h * 4 ? 4 : 3) : 4;
  if (data.length !== w * h * stride) throw new Error(`the picture has ${data.length} values, expected ${w * h * stride} for ${w} x ${h}`);
  const lin = (v) => (float ? v : srgbByteToLinear(v));
  return buildEnvironment(fillCube(checkSize(size), (x, y, z, out) => {
    const u = (Math.atan2(x, -z) / TAU + 0.5) * w - 0.5, v = (Math.acos(clamp(y, -1, 1)) / Math.PI) * h - 0.5;
    const x0 = Math.floor(u), y0 = clamp(Math.floor(v), 0, h - 1), y1 = clamp(y0 + 1, 0, h - 1), tx = u - x0, ty = clamp(v - Math.floor(v), 0, 1);
    const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w;
    for (let c = 0; c < 3; c++) {
      const top = lin(data[(y0 * w + xa) * stride + c]) * (1 - tx) + lin(data[(y0 * w + xb) * stride + c]) * tx;
      const bottom = lin(data[(y1 * w + xa) * stride + c]) * (1 - tx) + lin(data[(y1 * w + xb) * stride + c]) * tx;
      out[c] = (top * (1 - ty) + bottom * ty) * intensity;
    }
  }), size);
}

/**
 * Fetch a panorama and make an environment from it: a Radiance `.hdr` file is read as it is (the best choice: it keeps the sun bright), a PNG or JPEG is decoded by the browser.
 * @param {string} url
 * @param {{size?: number, intensity?: number, fetchImpl?: typeof fetch, decode?: (bytes: Uint8Array, mimeType: string) => Promise<{width: number, height: number, data: ArrayLike<number>}>}} [o]
 *   `decode` is for tests and other hosts (default: the browser's own decoder)
 * @returns {Promise<Environment>}
 */
export async function loadEnvironment(url, { size = 64, intensity = 1, fetchImpl = globalThis.fetch, decode = decodeImageInBrowser } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = String(url).split(/[?#]/)[0].toLowerCase();
  if (name.endsWith('.hdr') || (bytes[0] === 0x23 && bytes[1] === 0x3f)) return environmentFromImage(parseHdr(bytes), { size, intensity });   // "#?" starts a Radiance file
  const mimeType = name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : name.endsWith('.webp') ? 'image/webp' : 'image/png';
  return environmentFromImage(await decode(bytes, mimeType), { size, intensity });
}

/** An environment made of one colour all round: a white one lights a surface to its own colour from every side. */
export function uniformEnvironment(color = [1, 1, 1], size = 16) {
  return buildEnvironment(fillCube(checkSize(size), (x, y, z, out) => { out[0] = color[0]; out[1] = color[1]; out[2] = color[2]; }), size);
}

const srgbByteToLinear = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function checkSize(size) {
  if (!Number.isInteger(size) || size < 16 || size > 256 || (size & (size - 1)) !== 0) throw new Error(`an environment cube is a power of two from 16 to 256 texels a side (got ${size})`);
  return size;
}

/**
 * Read a Radiance `.hdr` file (RGBE, flat or run-length encoded), the format HDR panoramas are usually shared in, into floating-point colours for `environmentFromImage`.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {{width: number, height: number, data: Float32Array}} RGB floats, top row first
 */
export function parseHdr(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  let p = 0;
  const line = () => { let s = ''; while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s; };
  const magic = line();
  if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error('this is not a Radiance .hdr file (it should start with #?RADIANCE)');
  let format = '';
  for (let l = line(); l !== '' && p < b.length; l = line()) if (l.startsWith('FORMAT=')) format = l.slice(7);
  if (format && format !== '32-bit_rle_rgbe') throw new Error(`the .hdr format "${format}" is not supported (only 32-bit_rle_rgbe)`);
  const res = /^([-+])Y (\d+) ([-+])X (\d+)$/.exec(line().trim());
  if (!res) throw new Error('the .hdr file has no readable size line');
  const height = Number(res[2]), width = Number(res[4]), flipY = res[1] === '+', flipX = res[3] === '-';
  if (!(width >= 1 && height >= 1 && width * height <= 16_000_000)) throw new Error(`the .hdr size ${width} x ${height} is not usable`);
  const out = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (p + 4 > b.length) throw new Error('the .hdr file ends early');
    if (width >= 8 && width < 32768 && b[p] === 2 && b[p + 1] === 2 && (b[p + 2] & 0x80) === 0) {   // run-length encoded: four separate channels
      if (((b[p + 2] << 8) | b[p + 3]) !== width) throw new Error('a line of the .hdr file has the wrong width');
      p += 4;
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width;) {
          if (p >= b.length) throw new Error('the .hdr file ends early');
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; if (x + n > width) throw new Error('a run in the .hdr file is too long'); while (n-- > 0) scan[(x++) * 4 + c] = v; }
          else { if (n === 0 || x + n > width || p + n > b.length) throw new Error('a run in the .hdr file is damaged'); while (n-- > 0) scan[(x++) * 4 + c] = b[p++]; }
        }
      }
    } else {                                                                                   // flat
      if (p + width * 4 > b.length) throw new Error('the .hdr file ends early');
      scan.set(b.subarray(p, p + width * 4));
      p += width * 4;
    }
    const row = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3], f = e === 0 ? 0 : 2 ** (e - 136), col = flipX ? width - 1 - x : x;
      out[(row * width + col) * 3] = scan[x * 4] * f; out[(row * width + col) * 3 + 1] = scan[x * 4 + 1] * f; out[(row * width + col) * 3 + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { width, height, data: out };
}

// ---------- what a cube is turned into ----------

/**
 * @typedef {Object} Environment
 * @property {number} size Texels per side of the sharpest cube
 * @property {{size: number, faces: Float32Array[]}[]} levels The prefiltered chain: level 0 is the environment itself, level k is blurred for roughness k / (levels - 1); faces are RGB floats, six of them
 * @property {Float32Array} sh Nine spherical harmonic colours (vec4 each, alpha unused), already scaled so the diffuse light facing n is `sh(n)` (see `environmentIrradiance`)
 * @property {number} maxLod The last level (the roughest)
 * @property {number} id Different for every environment made, so a renderer can tell when it has been given a new one
 */

let nextId = 1;

/** Real spherical harmonic basis (bands 0 to 2) at a unit direction. */
function shBasis(x, y, z, out) {
  out[0] = 0.282095;
  out[1] = 0.488603 * y; out[2] = 0.488603 * z; out[3] = 0.488603 * x;
  out[4] = 1.092548 * x * y; out[5] = 1.092548 * y * z; out[6] = 0.315392 * (3 * z * z - 1); out[7] = 1.092548 * x * z; out[8] = 0.546274 * (x * x - y * y);
  return out;
}

/** Cube texels' solid angle weights are not equal: the corners cover less of the sky. */
const texelSolidAngle = (size, sc, tc) => (2 / size) ** 2 / (1 + sc * sc + tc * tc) ** 1.5;

function projectSh(faces, size) {
  const coef = new Float64Array(27), basis = new Array(9).fill(0), d = [0, 0, 0];
  for (let f = 0; f < FACES; f++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sc = (2 * (x + 0.5)) / size - 1, tc = (2 * (y + 0.5)) / size - 1;
        cubeDirection(f, sc, tc, d);
        const l = Math.hypot(d[0], d[1], d[2]);
        shBasis(d[0] / l, d[1] / l, d[2] / l, basis);
        const w = texelSolidAngle(size, sc, tc), o = (y * size + x) * 3;
        for (let i = 0; i < 9; i++) for (let c = 0; c < 3; c++) coef[i * 3 + c] += faces[f][o + c] * basis[i] * w;
      }
    }
  }
  const band = [1, 2 / 3, 2 / 3, 2 / 3, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4];   // the cosine lobe's share of each band, divided by pi
  const sh = new Float32Array(36);
  for (let i = 0; i < 9; i++) for (let c = 0; c < 3; c++) sh[i * 4 + c] = coef[i * 3 + c] * band[i];
  return sh;
}

/** Halve a cube (averaging 2 x 2 texels) to make the next smaller level of a pyramid. */
function halveCube(faces, size) {
  const n = size >> 1;
  return faces.map((f) => {
    const out = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) {
      const i = ((y * 2) * size + x * 2) * 3 + c;
      out[(y * n + x) * 3 + c] = (f[i] + f[i + 3] + f[i + size * 3] + f[i + size * 3 + 3]) * 0.25;
    }
    return out;
  });
}

const radicalInverse = (i) => { let b = i >>> 0; b = ((b << 16) | (b >>> 16)) >>> 0; b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0; b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0; b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0; b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0; return b * 2.3283064365386963e-10; };

/**
 * Blur a cube for a roughness: for each texel, the colours the surface would reflect from around that direction, found by sampling the cube where a rough surface's highlight
 * reaches (GGX importance sampling with a fixed, evenly spread set of samples), each taken from the level of a pyramid of the cube that matches how much sky that sample stands for, so one very
 * bright point (a sun) is spread smoothly and never leaves speckles.
 */
function prefilter(pyramid, base, size, roughness, samples) {
  const alpha = roughness * roughness, a2 = alpha * alpha;
  const faces = [];
  const d = [0, 0, 0], c = [0, 0, 0];
  const baseTexelSolidAngle = (4 * Math.PI) / (6 * base * base);
  for (let f = 0; f < FACES; f++) {
    const data = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        cubeDirection(f, (2 * (x + 0.5)) / size - 1, (2 * (y + 0.5)) / size - 1, d);
        const l = Math.hypot(d[0], d[1], d[2]);
        const nx = d[0] / l, ny = d[1] / l, nz = d[2] / l;
        // a frame around n: t is perpendicular to n (n crossed with whichever axis is furthest from n), b is perpendicular to both
        let tx, ty, tz;
        if (Math.abs(ny) < 0.999) { tx = nz; ty = 0; tz = -nx; } else { tx = 0; ty = -nz; tz = ny; }   // n x (0,1,0), or n x (1,0,0)
        const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
        const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
        let r = 0, g = 0, bl = 0, wsum = 0;
        for (let i = 0; i < samples; i++) {
          const u1 = (i + 0.5) / samples, u2 = radicalInverse(i);
          const cosT = Math.sqrt((1 - u1) / (1 + (a2 - 1) * u1)), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), phi = TAU * u2;
          const hx = sinT * Math.cos(phi), hy = sinT * Math.sin(phi), hz = cosT;
          const wx = tx * hx + bx * hy + nx * hz, wy = ty * hx + by * hy + ny * hz, wz = tz * hx + bz * hy + nz * hz;   // the half vector in the world
          const vh = nx * wx + ny * wy + nz * wz;                                                                       // n = v = r: n.h = v.h
          const lx = 2 * vh * wx - nx, ly = 2 * vh * wy - ny, lz = 2 * vh * wz - nz;                                    // the light direction
          const ndl = nx * lx + ny * ly + nz * lz;
          if (ndl <= 0) continue;
          const dd = cosT * cosT * (a2 - 1) + 1, D = a2 / (Math.PI * dd * dd), pdf = (D * cosT) / (4 * vh) + 1e-4;
          const lod = clamp(0.5 * Math.log2(1 / (samples * pdf * baseTexelSolidAngle)) + 1, 0, pyramid.length - 1);
          const l0 = Math.floor(lod), l1 = Math.min(pyramid.length - 1, l0 + 1), t = lod - l0;
          sampleCube(pyramid[l0].faces, pyramid[l0].size, lx, ly, lz, c);
          let cr = c[0], cg = c[1], cb = c[2];
          if (t > 0 && l1 !== l0) { sampleCube(pyramid[l1].faces, pyramid[l1].size, lx, ly, lz, c); cr = cr * (1 - t) + c[0] * t; cg = cg * (1 - t) + c[1] * t; cb = cb * (1 - t) + c[2] * t; }
          r += cr * ndl; g += cg * ndl; bl += cb * ndl; wsum += ndl;
        }
        const o = (y * size + x) * 3;
        data[o] = r / wsum; data[o + 1] = g / wsum; data[o + 2] = bl / wsum;
      }
    }
    faces.push(data);
  }
  return faces;
}

/**
 * Turn six faces of linear light into an `Environment`: spherical harmonics for the diffuse light and a prefiltered chain for reflections.
 * @param {Float32Array[]} faces six cube faces of `size` x `size` RGB floats
 * @param {number} size
 * @returns {Environment}
 */
export function buildEnvironment(faces, size) {
  if (!Array.isArray(faces) || faces.length !== FACES || faces.some((f) => f.length !== size * size * 3)) throw new Error(`an environment is six faces of ${size} x ${size} RGB values`);
  const pyramid = [{ size, faces }];
  while (pyramid.at(-1).size > 1) { const last = pyramid.at(-1); pyramid.push({ size: last.size >> 1, faces: halveCube(last.faces, last.size) }); }
  const count = Math.max(2, Math.log2(size) - 1);                             // 64 gives 5 levels: 64, 32, 16, 8 and 4
  const levels = [{ size, faces }];
  for (let k = 1; k < count; k++) {
    const s = size >> k;
    levels.push({ size: s, faces: prefilter(pyramid, size, s, k / (count - 1), s >= 16 ? 48 : 64) });
  }
  return { size, levels, sh: projectSh(faces, size), maxLod: count - 1, id: nextId++ };
}

// ---------- using one on the CPU (tests, tools, and anyone who wants to know what a surface will receive) ----------

/**
 * The diffuse light a surface facing `n` receives from the environment (colour, linear light): what the shaders compute from the spherical harmonics.
 * A white environment of brightness 1 gives 1 in every direction.
 * @param {Environment} env
 * @param {number[]} n unit normal
 * @returns {number[]}
 */
export function environmentIrradiance(env, n) {
  const b = shBasis(n[0], n[1], n[2], new Array(9));
  const out = [0, 0, 0];
  for (let i = 0; i < 9; i++) for (let c = 0; c < 3; c++) out[c] += env.sh[i * 4 + c] * b[i];
  return out.map((v) => Math.max(0, v));
}

/**
 * The colour of the environment in a direction, from one level of the chain (a fractional `lod` blends two levels; 0 is the sharp environment, `maxLod` the roughest).
 * @param {Environment} env
 * @param {number[]} dir
 * @param {number} [lod]
 * @returns {number[]}
 */
export function sampleEnvironment(env, dir, lod = 0) {
  const l = clamp(lod, 0, env.maxLod), l0 = Math.floor(l), l1 = Math.min(env.maxLod, l0 + 1), t = l - l0;
  const a = sampleCube(env.levels[l0].faces, env.levels[l0].size, dir[0], dir[1], dir[2], [0, 0, 0]);
  if (t === 0 || l0 === l1) return a;
  const b = sampleCube(env.levels[l1].faces, env.levels[l1].size, dir[0], dir[1], dir[2], [0, 0, 0]);
  return [0, 1, 2].map((k) => a[k] * (1 - t) + b[k] * t);
}

/**
 * A direction turned about the vertical axis, the way the renderers turn the environment when `lighting.environment.rotation` is set: the environment is rotated by `yaw` radians
 * (counter-clockwise seen from above), which is the same as looking up the world's direction rotated the other way.
 * @param {number[]} d
 * @param {number} yaw
 * @returns {number[]}
 */
export function rotateForEnvironment(d, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
}

/**
 * Colours for the simple lighting that roughly match an environment, so surfaces without a material sit comfortably beside ones that have: the diffuse light facing straight up and straight down.
 * @param {Environment} env
 * @param {number} [intensity]
 * @returns {{ambientSky: number[], ambientGround: number[]}}
 */
export function ambientFromEnvironment(env, intensity = 1) {
  return { ambientSky: environmentIrradiance(env, [0, 1, 0]).map((v) => v * intensity), ambientGround: environmentIrradiance(env, [0, -1, 0]).map((v) => v * intensity) };
}

// ---------- for the renderers ----------

/** A 32-bit float as the 16 bits of a half float (round to nearest; very large values become infinity, very small ones lose precision). */
export function toHalf(value) {
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0], sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15, mant = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  if (exp >= 31) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  let h = sign | (exp << 10) | (mant >> 13);
  if (mant & 0x1000) h++;
  return h;
}

/** One face of one level as RGBA half floats (alpha 1), the form the GPU textures are filled with. */
export function halfFaceData(level, face) {
  const src = level.faces[face], n = level.size * level.size, out = new Uint16Array(n * 4), one = toHalf(1);
  for (let i = 0; i < n; i++) { out[i * 4] = toHalf(src[i * 3]); out[i * 4 + 1] = toHalf(src[i * 3 + 1]); out[i * 4 + 2] = toHalf(src[i * 3 + 2]); out[i * 4 + 3] = one; }
  return out;
}

/**
 * Write the environment's per-frame numbers into the renderers' uniform table (starting at vec4 `ENV_BLOCK_AT`): the settings, the nine harmonics, and the inverse of the camera's
 * view-projection matrix (for the sky).
 * @param {Float32Array} table the table, in floats
 * @param {Environment | null} env
 * @param {{intensity?: number, rotation?: number, sky?: boolean, skyBlur?: number} | false | undefined} settings `lighting.environment`
 * @param {ArrayLike<number> | null} invViewProj
 * @returns {{lighting: boolean, sky: boolean}} whether surfaces use it and whether the sky is drawn
 */
export function writeEnvironmentBlock(table, env, settings, invViewProj) {
  const o = ENV_BLOCK_AT * 4;
  table.fill(0, o, o + ENV_BLOCK_VEC4S * 4);
  if (!env || settings === false) return { lighting: false, sky: false };
  const s = settings ?? {};
  const intensity = Number.isFinite(s.intensity) ? Math.max(0, s.intensity) : 1, yaw = Number.isFinite(s.rotation) ? s.rotation : 0;
  const sky = s.sky !== false, blur = clamp(Number.isFinite(s.skyBlur) ? s.skyBlur : 0, 0, 1);
  table[o] = intensity; table[o + 1] = Math.cos(yaw); table[o + 2] = Math.sin(yaw); table[o + 3] = env.maxLod;
  table[o + 4] = 1; table[o + 5] = blur * env.maxLod; table[o + 6] = sky ? 1 : 0; table[o + 7] = 0;
  table.set(env.sh, o + 8);
  if (invViewProj) for (let i = 0; i < 16; i++) table[o + 44 + i] = invViewProj[i];
  return { lighting: true, sky };
}
