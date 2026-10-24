import { createMesh } from './mesh.js';
import { createDecal } from './decal.js';

/**
 * Terrain: ground from a grid of heights. A `Heightmap` is plain data (made from noise, a picture, or a function; sculpted, smoothed and eroded; asked for height, slope and rays), and a `Terrain` turns
 * it into chunks of mesh at several levels of detail, with skirts so neighbouring levels never show cracks, and a **splat map** that blends four pictures by slope and height.
 *
 * ```js
 * const map = Heightmap.fromNoise({ size: 257, cell: 1, seed: 7, amplitude: 40 });          // 256 x 256 metres
 * const terrain = new Terrain(map, { chunkCells: 32, lods: 4 });
 * const splat = splatMap(map, { size: 256, rock: { slope: [28, 42] }, sand: { height: [-2, 2] }, snow: { height: [26, 34] } });
 * const layer = textures.add(splat);                                                        // after four pictures: grass, rock, sand, snow
 * // each frame:
 * list.setTerrain(layer, firstOfFourLayers, 0.25);
 * terrain.addToDrawList(list, camera);
 * ```
 * Everything is in world metres, +y up. Sample (i, j) is at x = originX + i * cell, z = originZ + j * cell. No GPU is involved until you draw.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-9), 0, 1); return t * t * (3 - 2 * t); };

/** A whole number hashed from three whole numbers (for repeatable noise). */
function hash3(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const unit = (h) => h / 4294967296;

/**
 * Smooth value noise in two dimensions, between 0 and 1: the same for the same seed on every machine.
 * @param {number} x @param {number} y @param {number} [seed]
 */
export function valueNoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = unit(hash3(ix, iy, seed)), b = unit(hash3(ix + 1, iy, seed)), c = unit(hash3(ix, iy + 1, seed)), d = unit(hash3(ix + 1, iy + 1, seed));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fractal noise: several octaves of `valueNoise`, each finer and fainter, between 0 and 1.
 * @param {number} x @param {number} y @param {{seed?: number, octaves?: number, lacunarity?: number, persistence?: number, ridged?: boolean}} [o]
 */
export function fbm(x, y, { seed = 0, octaves = 5, lacunarity = 2, persistence = 0.5, ridged = false } = {}) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    let n = valueNoise(x * f, y * f, seed + o * 101);
    if (ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp; norm += amp; amp *= persistence; f *= lacunarity;
  }
  return sum / norm;
}

/** A grid of heights. */
export class Heightmap {
  /**
   * @param {number} size Samples along each side (at least 2); the map covers `(size - 1) * cell` metres.
   * @param {{cell?: number, originX?: number, originZ?: number, heights?: Float32Array}} [o] `cell`: metres between samples. `originX`, `originZ`: the world position of sample (0, 0).
   */
  constructor(size, { cell = 1, originX = 0, originZ = 0, heights } = {}) {
    if (!Number.isInteger(size) || size < 2) throw new Error('a heightmap needs at least 2 x 2 samples');
    if (heights && heights.length !== size * size) throw new Error(`a ${size} x ${size} heightmap needs ${size * size} heights (got ${heights.length})`);
    this.size = size; this.cell = cell; this.originX = originX; this.originZ = originZ;
    this.heights = heights ?? new Float32Array(size * size);
    /** Counts every change, so meshes made from it know when they are out of date. */
    this.version = 0;
  }

  /** How many metres the map covers along each side. */
  get width() { return (this.size - 1) * this.cell; }

  /**
   * Hills from noise.
   * @param {{size?: number, cell?: number, seed?: number, amplitude?: number, base?: number, frequency?: number, octaves?: number, persistence?: number, ridged?: boolean, island?: number, originX?: number, originZ?: number}} [o]
   * `amplitude`: metres from lowest to highest; `base`: height of the lowest; `frequency`: hills per 100 m; `island` 0..1 sinks the edges below `base` so the map is an island.
   */
  static fromNoise({ size = 129, cell = 1, seed = 1, amplitude = 30, base = 0, frequency = 1.5, octaves = 5, persistence = 0.5, ridged = false, island = 0, originX = 0, originZ = 0 } = {}) {
    const map = new Heightmap(size, { cell, originX, originZ });
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let h = fbm(i * cell * frequency / 100, j * cell * frequency / 100, { seed, octaves, persistence, ridged });
        if (island > 0) { const dx = (i / (size - 1)) * 2 - 1, dz = (j / (size - 1)) * 2 - 1; h = h * (1 - island * smooth(0.45, 1.05, Math.hypot(dx, dz))) - island * 0.35 * smooth(0.7, 1.1, Math.hypot(dx, dz)); }
        map.heights[j * size + i] = base + h * amplitude;
      }
    }
    return map;
  }

  /** A map from a function of world position. @param {number} size @param {(x: number, z: number) => number} fn @param {{cell?: number, originX?: number, originZ?: number}} [o] */
  static fromFunction(size, fn, { cell = 1, originX = 0, originZ = 0 } = {}) {
    const map = new Heightmap(size, { cell, originX, originZ });
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) map.heights[j * size + i] = fn(originX + i * cell, originZ + j * cell);
    return map;
  }

  /**
   * A map from a picture: brighter is higher. The picture is sampled onto a square grid.
   * @param {ArrayLike<number>} rgba Pixel data, 4 bytes per pixel, rows from the top. @param {number} width @param {number} height
   * @param {{size?: number, cell?: number, minHeight?: number, maxHeight?: number, channel?: 0 | 1 | 2, originX?: number, originZ?: number}} [o] `channel`: which colour to read (red by default).
   */
  static fromImageData(rgba, width, height, { size = Math.min(width, height), cell = 1, minHeight = 0, maxHeight = 50, channel = 0, originX = 0, originZ = 0 } = {}) {
    if (rgba.length < width * height * 4) throw new Error('the picture data is shorter than width x height x 4');
    const map = new Heightmap(size, { cell, originX, originZ });
    const at = (x, y) => rgba[(clamp(Math.round(y), 0, height - 1) * width + clamp(Math.round(x), 0, width - 1)) * 4 + channel] / 255;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const fx = (i / (size - 1)) * (width - 1), fy = (j / (size - 1)) * (height - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const v = at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
        map.heights[j * size + i] = minHeight + v * (maxHeight - minHeight);
      }
    }
    return map;
  }

  /** The height of a sample. @param {number} i @param {number} j */
  get(i, j) { return this.heights[clamp(j, 0, this.size - 1) * this.size + clamp(i, 0, this.size - 1)]; }
  /** Set the height of a sample. @param {number} i @param {number} j @param {number} h */
  set(i, j, h) { this.heights[j * this.size + i] = h; this.version++; }

  /** Is the world position over the map? */
  contains(x, z) { return x >= this.originX && z >= this.originZ && x <= this.originX + this.width && z <= this.originZ + this.width; }

  /** The ground height at a world position, smoothly between samples (the edge height beyond the map). @param {number} x @param {number} z */
  heightAt(x, z) {
    const fx = clamp((x - this.originX) / this.cell, 0, this.size - 1), fz = clamp((z - this.originZ) / this.cell, 0, this.size - 1);
    const i = Math.min(Math.floor(fx), this.size - 2), j = Math.min(Math.floor(fz), this.size - 2), tx = fx - i, tz = fz - j, s = this.size, h = this.heights;
    // each cell is two triangles, split the way the mesh splits it, so this is exactly the height of the surface you see
    const a = h[j * s + i], b = h[(j + 1) * s + i], c = h[j * s + i + 1], d = h[(j + 1) * s + i + 1];
    return tx + tz <= 1 ? a + (c - a) * tx + (b - a) * tz : d + (c - d) * (1 - tz) + (b - d) * (1 - tx);
  }

  /** The direction the ground faces at a world position, a unit vector pointing up and away. @param {number} x @param {number} z @param {number[]} [out] */
  normalAt(x, z, out = [0, 1, 0]) {
    const e = this.cell, hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z), hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    const nx = hl - hr, nz = hd - hu, ny = 2 * e, len = Math.hypot(nx, ny, nz);
    out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
    return out;
  }

  /** How steep the ground is at a world position, in degrees (0 flat, 90 a cliff). @param {number} x @param {number} z */
  slopeAt(x, z) { return Math.acos(clamp(this.normalAt(x, z)[1], -1, 1)) * 180 / Math.PI; }

  /** The lowest and highest sample. @returns {{min: number, max: number}} */
  range() {
    let min = Infinity, max = -Infinity;
    for (const v of this.heights) { if (v < min) min = v; if (v > max) max = v; }
    return { min, max };
  }

  /**
   * Where a ray first meets the ground.
   * @param {ArrayLike<number>} origin [x, y, z] @param {ArrayLike<number>} dir [x, y, z], need not be unit @param {number} [maxDistance]
   * @returns {{t: number, x: number, y: number, z: number, normal: number[]} | null} `t` is the distance along the unit direction.
   */
  raycast(origin, dir, maxDistance = Infinity) {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (!len) return null;
    const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len, step = this.cell * 0.5;
    const above = (t) => origin[1] + dy * t - this.heightAt(origin[0] + dx * t, origin[2] + dz * t);
    const { max } = this.range();
    let t = 0, prev = above(0);
    if (prev <= 0) return { t: 0, x: origin[0], y: this.heightAt(origin[0], origin[2]), z: origin[2], normal: this.normalAt(origin[0], origin[2]) };
    const limit = Math.min(maxDistance, this.width * 3 + Math.abs(origin[1]) * 2 + 1);
    while (t < limit) {
      const next = Math.min(t + step, limit), cur = above(next);
      if (cur <= 0) {                                              // crossed: narrow it down
        let lo = t, hi = next;
        for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid; }
        const x = origin[0] + dx * hi, z = origin[2] + dz * hi;
        return { t: hi, x, y: this.heightAt(x, z), z, normal: this.normalAt(x, z) };
      }
      if (dy >= 0 && origin[1] + dy * next > max + 1) return null;  // climbing above every hill
      t = next; prev = cur;
    }
    void prev;
    return null;
  }

  /**
   * Change the ground under a brush. Returns the changed rectangle of samples (for `Terrain.markDirty`).
   * @param {number} x World x. @param {number} z World z. @param {number} radius Metres. @param {number} amount Metres per call at the centre for `raise` and `lower`; 0..1 for `smooth` and `flatten`.
   * @param {'raise' | 'lower' | 'smooth' | 'flatten' | 'noise'} [mode] `flatten` pulls toward `target` (default: the height at the centre). @param {{target?: number, falloff?: number, seed?: number}} [o]
   * @returns {{i0: number, j0: number, i1: number, j1: number} | null}
   */
  sculpt(x, z, radius, amount, mode = 'raise', { target, falloff = 1, seed = 1 } = {}) {
    const s = this.size, ci = (x - this.originX) / this.cell, cj = (z - this.originZ) / this.cell, r = radius / this.cell;
    const i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(s - 1, Math.ceil(ci + r)), j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(s - 1, Math.ceil(cj + r));
    if (i1 < i0 || j1 < j0) return null;
    const centre = this.heightAt(x, z), goal = target ?? centre, old = mode === 'smooth' ? this.heights.slice() : null;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - ci, j - cj) / r;
        if (d >= 1) continue;
        const w = smooth(1, 0, d) ** falloff;                                       // 1 in the middle, 0 at the rim; a bigger falloff is a sharper peak
        const k = j * s + i;
        if (mode === 'raise') this.heights[k] += amount * w;
        else if (mode === 'lower') this.heights[k] -= amount * w;
        else if (mode === 'flatten') this.heights[k] += (goal - this.heights[k]) * clamp(amount, 0, 1) * w;
        else if (mode === 'noise') this.heights[k] += (valueNoise(i * 0.37, j * 0.37, seed) - 0.5) * 2 * amount * w;
        else if (mode === 'smooth') {
          const avg = (old[k] + old[Math.max(0, j - 1) * s + i] + old[Math.min(s - 1, j + 1) * s + i] + old[j * s + Math.max(0, i - 1)] + old[j * s + Math.min(s - 1, i + 1)]) / 5;
          this.heights[k] += (avg - old[k]) * clamp(amount, 0, 1) * w;
        } else throw new Error(`unknown sculpt mode "${mode}"`);
      }
    }
    this.version++;
    return { i0, j0, i1, j1 };
  }

  /**
   * Wear the ground down the way loose earth falls: wherever a slope is steeper than `talus` (rise over run), some of the height moves to the lower neighbour. Repeating it rounds off sharp peaks.
   * @param {number} [iterations] @param {number} [talus] @param {number} [amount] The share of the excess moved each time (0..0.5).
   */
  erode(iterations = 8, talus = 0.7, amount = 0.4) {
    const s = this.size, h = this.heights, limit = talus * this.cell;
    for (let it = 0; it < iterations; it++) {
      const delta = new Float32Array(h.length);
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          const k = j * s + i;
          let total = 0, maxDiff = 0;
          const diffs = [];
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= s || nj >= s) continue;
            const d = h[k] - h[nj * s + ni];
            if (d > limit) { diffs.push([nj * s + ni, d - limit]); total += d - limit; if (d > maxDiff) maxDiff = d; }
          }
          if (total <= 0) continue;
          const move = clamp(amount, 0, 0.5) * (maxDiff - limit);
          delta[k] -= move;
          for (const [n, excess] of diffs) delta[n] += move * (excess / total);
        }
      }
      for (let k = 0; k < h.length; k++) h[k] += delta[k];
    }
    this.version++;
  }

  /**
   * The ground as triangles (nine numbers each: three corners), for a collision world.
   * @param {{x0?: number, z0?: number, x1?: number, z1?: number, step?: number}} [o] The region in world metres, and how many samples to skip between vertices (1 is every sample).
   * @returns {Float32Array}
   */
  toTriangles({ x0 = this.originX, z0 = this.originZ, x1 = this.originX + this.width, z1 = this.originZ + this.width, step = 1 } = {}) {
    const s = this.size, i0 = clamp(Math.floor((x0 - this.originX) / this.cell), 0, s - 1), i1 = clamp(Math.ceil((x1 - this.originX) / this.cell), 0, s - 1), j0 = clamp(Math.floor((z0 - this.originZ) / this.cell), 0, s - 1), j1 = clamp(Math.ceil((z1 - this.originZ) / this.cell), 0, s - 1);
    const out = [];
    const v = (i, j) => [this.originX + i * this.cell, this.heights[j * s + i], this.originZ + j * this.cell];
    for (let j = j0; j + step <= j1; j += step) {
      for (let i = i0; i + step <= i1; i += step) {
        const a = v(i, j), b = v(i, j + step), c = v(i + step, j), d = v(i + step, j + step);
        out.push(...a, ...b, ...c, ...c, ...b, ...d);
      }
    }
    return Float32Array.from(out);
  }
}

/**
 * A splat map for a heightmap: for every pixel, how much of each of four pictures shows (red, green, blue, alpha; they add up to 255). By default the first picture (grass) fills the
 * flat middle ground; the second (rock) takes steep slopes; the third (sand) low ground; the fourth (snow) high ground that is not too steep. Each rule is `{ slope: [from, to] }` in degrees
 * or `{ height: [from, to] }` in metres, with a smooth fade between the two; leave a rule out to leave that picture out.
 * @param {Heightmap} map
 * @param {{size?: number, rock?: {slope: number[]}, sand?: {height: number[]}, snow?: {height: number[], slope?: number[]}, noise?: number, noiseScale?: number, seed?: number}} [o]
 * `size`: pixels per side (use the texture set's size). `noise` 0..1 breaks up the edges between pictures (`noiseScale`: patches per 100 m).
 * @returns {Uint8ClampedArray} RGBA bytes, rows from z = the map's origin.
 */
export function splatMap(map, { size = 256, rock = { slope: [28, 42] }, sand = null, snow = null, noise = 0.15, noiseScale = 12, seed = 3 } = {}) {
  const out = new Uint8ClampedArray(size * size * 4), w = [0, 0, 0, 0];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = map.originX + ((px + 0.5) / size) * map.width, z = map.originZ + ((py + 0.5) / size) * map.width;
      const h = map.heightAt(x, z), slope = map.slopeAt(x, z), n = (fbm(x * noiseScale / 100, z * noiseScale / 100, { seed, octaves: 3 }) - 0.5) * 2 * noise;
      const r = rock ? smooth(rock.slope[0] + n * 15, rock.slope[1] + n * 15, slope) : 0;
      const sa = sand ? 1 - smooth(sand.height[0] + n * 4, sand.height[1] + n * 4, h) : 0;
      let sn = snow ? smooth(snow.height[0] + n * 6, snow.height[1] + n * 6, h) : 0;
      if (snow?.slope) sn *= 1 - smooth(snow.slope[0], snow.slope[1], slope);
      w[1] = r; w[2] = sa * (1 - r); w[3] = sn * (1 - r); w[0] = Math.max(0, 1 - w[1] - w[2] - w[3]);
      const total = w[0] + w[1] + w[2] + w[3] || 1, o = (py * size + px) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = Math.round((w[k] / total) * 255);
    }
  }
  return out;
}

/**
 * Paint on a splat map with a round brush: push the pixels under it toward one of the four pictures.
 * @param {Uint8ClampedArray} splat The map from `splatMap`. @param {number} size Its side in pixels. @param {Heightmap} map @param {number} x World x. @param {number} z World z. @param {number} radius Metres.
 * @param {0 | 1 | 2 | 3} layer Which picture to paint. @param {number} [strength] 0..1 per call at the centre.
 * @returns {{x0: number, y0: number, x1: number, y1: number} | null} The changed pixels (to upload again with `TextureSet.update`).
 */
export function paintSplat(splat, size, map, x, z, radius, layer, strength = 0.5) {
  const cx = ((x - map.originX) / map.width) * size, cy = ((z - map.originZ) / map.width) * size, r = (radius / map.width) * size;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
      if (d >= 1) continue;
      const k = clamp(strength, 0, 1) * smooth(1, 0, d), o = (py * size + px) * 4;
      for (let c = 0; c < 4; c++) splat[o + c] = Math.round(splat[o + c] * (1 - k) + (c === layer ? 255 : 0) * k);
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * One chunk of terrain. Its meshes are made when first asked for.
 * @typedef {object} TerrainChunk
 * @property {number} cx @property {number} cz Position in the grid of chunks. @property {number} i0 @property {number} j0 The first sample. @property {number[]} min @property {number[]} max Bounding box. @property {(import('./mesh.js').Mesh | null)[]} meshes One slot per level of detail.
 */

/** The ground of a heightmap as chunks of mesh with levels of detail. */
export class Terrain {
  /**
   * @param {Heightmap} map
   * @param {{chunkCells?: number, lods?: number, skirt?: number, lodDistance?: number}} [o] `chunkCells`: grid cells along a chunk (the map's cells must divide by it, and it by 2 to the power of `lods` less one). `lods`: levels of detail (each halves the cells).
   * `skirt`: how far (metres) the edge of each chunk is dropped to hide the join with a neighbour of a different level. `lodDistance`: how far (metres) the most detailed level reaches; each next level doubles it.
   */
  constructor(map, { chunkCells = 32, lods = 4, skirt = 2, lodDistance } = {}) {
    const cells = map.size - 1;
    if (cells % chunkCells !== 0) throw new Error(`a heightmap of ${cells} cells cannot be cut into chunks of ${chunkCells} cells (size - 1 must be a multiple of it)`);
    if (chunkCells % (1 << (lods - 1)) !== 0) throw new Error(`chunks of ${chunkCells} cells cannot have ${lods} levels of detail (it must divide by ${1 << (lods - 1)})`);
    this.map = map; this.chunkCells = chunkCells; this.lods = lods; this.skirt = skirt;
    this.lodDistance = lodDistance ?? chunkCells * map.cell * 1.5;
    this.chunksPerSide = cells / chunkCells;
    /** @type {TerrainChunk[]} */ this.chunks = [];
    this.discarded = [];
    /** Triangles in the meshes drawn last frame. */ this.triangles = 0;
    for (let cz = 0; cz < this.chunksPerSide; cz++) for (let cx = 0; cx < this.chunksPerSide; cx++) this.chunks.push({ cx, cz, i0: cx * chunkCells, j0: cz * chunkCells, min: [0, 0, 0], max: [0, 0, 0], meshes: new Array(lods).fill(null) });
    for (const c of this.chunks) this.#bounds(c);
  }

  #bounds(c) {
    const m = this.map, s = m.size, n = this.chunkCells;
    let lo = Infinity, hi = -Infinity;
    for (let j = c.j0; j <= c.j0 + n; j++) for (let i = c.i0; i <= c.i0 + n; i++) { const h = m.heights[j * s + i]; if (h < lo) lo = h; if (h > hi) hi = h; }
    c.min = [m.originX + c.i0 * m.cell, lo - this.skirt, m.originZ + c.j0 * m.cell]; c.max = [m.originX + (c.i0 + n) * m.cell, hi, m.originZ + (c.j0 + n) * m.cell];
  }

  /** Throw away the meshes of the chunks a sculpt touched (and recompute their bounds). Meshes that were uploaded to the GPU land in `takeDiscarded()`. @param {{i0: number, j0: number, i1: number, j1: number} | null} region */
  markDirty(region) {
    if (!region) return;
    const n = this.chunkCells, pad = 1;
    for (const c of this.chunks) {
      if (c.i0 > region.i1 + pad || c.i0 + n < region.i0 - pad || c.j0 > region.j1 + pad || c.j0 + n < region.j0 - pad) continue;
      for (let l = 0; l < this.lods; l++) if (c.meshes[l]) { this.discarded.push(c.meshes[l]); c.meshes[l] = null; }
      this.#bounds(c);
    }
  }

  /** The meshes replaced since the last call: pass each to `renderer.releaseMesh` to free its GPU memory. @returns {import('./mesh.js').Mesh[]} */
  takeDiscarded() { const d = this.discarded; this.discarded = []; return d; }

  /** Change the ground under a brush and refresh the chunks it touched (see `Heightmap.sculpt`). */
  sculpt(x, z, radius, amount, mode, options) { const r = this.map.sculpt(x, z, radius, amount, mode, options); this.markDirty(r); return r; }

  /** The mesh of one chunk at one level of detail. @param {TerrainChunk} chunk @param {number} lod */
  chunkMesh(chunk, lod) {
    if (!chunk.meshes[lod]) chunk.meshes[lod] = buildChunkMesh(this.map, chunk, lod, this.chunkCells, this.skirt);
    return chunk.meshes[lod];
  }

  /**
   * A decal lying on the ground (see `createDecal`): a bullet hole, a scorch, a footprint. It follows the ground's bumps exactly.
   * @param {Omit<Parameters<typeof createDecal>[1], 'position'> & {position: number[]}} options Same as `createDecal`; `normal` defaults to the ground's own.
   */
  createDecal(options) {
    const [w, h] = Array.isArray(options.size) ? options.size : [options.size ?? 1, options.size ?? 1], depth = options.depth ?? 1;
    const r = Math.hypot(w, h) / 2 + depth, [x, , z] = options.position;
    return createDecal(this.map.toTriangles({ x0: x - r, z0: z - r, x1: x + r, z1: z + r }), { ...options, normal: options.normal ?? this.map.normalAt(x, z) });
  }

  /**
   * Which level of detail a chunk uses from `distance` metres away: 0 is the most detailed.
   * @param {number} distance
   */
  lodFor(distance) {
    const d = Math.max(distance, 1e-6) / this.lodDistance;
    return clamp(d < 1 ? 0 : Math.floor(Math.log2(d)) + 1, 0, this.lods - 1);
  }

  /**
   * Add the chunks that can be seen to a draw list at the right level of detail. Set the list's texturing first (`list.setTerrain(...)`). Respects the list's frustum culling (`list.setCamera`).
   * @param {import('./drawlist.js').DrawList3D} list @param {{x: number, y: number, z: number}} camera Where the viewer is. @param {{r?: number, g?: number, b?: number, a?: number}} [colour] Tints the whole terrain.
   * @returns {number} How many chunks were added.
   */
  addToDrawList(list, camera, { r = 1, g = 1, b = 1, a = 1 } = {}) {
    let added = 0; this.triangles = 0;
    for (const c of this.chunks) {
      const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2, half = (c.max[0] - c.min[0]) / 2;
      const dist = Math.max(0, Math.hypot(camera.x - cx, camera.z - cz) - half);
      const mesh = this.chunkMesh(c, this.lodFor(dist));
      const before = list.count;
      list.add(mesh, IDENTITY, r, g, b, a);
      if (list.count > before) { added++; this.triangles += mesh.indices.length / 3; }
    }
    return added;
  }
}

const IDENTITY = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

/** Build one chunk's mesh at a level of detail: a grid of vertices every `2^lod` samples, with outward-facing skirts on the four edges. */
export function buildChunkMesh(map, chunk, lod, chunkCells, skirt) {
  const step = 1 << lod, n = chunkCells / step, s = map.size, verts = [], uvs = [], index = [];
  const normal = [0, 1, 0], vertex = (i, j, drop) => {
    const x = map.originX + i * map.cell, z = map.originZ + j * map.cell, y = map.heights[j * s + i];
    map.normalAt(x, z, normal);
    verts.push(x, y - drop, z, normal[0], normal[1], normal[2]);
    uvs.push(i / (s - 1), j / (s - 1));
    return verts.length / 6 - 1;
  };
  const grid = [];
  for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) grid.push(vertex(chunk.i0 + a * step, chunk.j0 + b * step, 0));
  const at = (a, b) => grid[b * (n + 1) + a];
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const p = at(a, b), q = at(a, b + 1), r = at(a + 1, b), t = at(a + 1, b + 1);
      index.push(p, q, r, r, q, t);                                  // counter-clockwise seen from above
    }
  }
  if (skirt > 0) {
    const edge = (list, outward) => {                                // along an edge, in the order that makes the strip face `outward` (+1 or -1 turns it round)
      const top = list.map(([a, b]) => at(a, b)), low = list.map(([a, b]) => vertex(chunk.i0 + a * step, chunk.j0 + b * step, skirt));
      for (let k = 0; k < top.length - 1; k++) {
        if (outward > 0) index.push(top[k], low[k], top[k + 1], top[k + 1], low[k], low[k + 1]); else index.push(top[k], top[k + 1], low[k], top[k + 1], low[k + 1], low[k]);
      }
    };
    const range = Array.from({ length: n + 1 }, (_, k) => k);
    edge(range.map((a) => [a, 0]), -1);                              // the edge at the lowest z faces -z
    edge(range.map((a) => [a, n]), 1);                               // highest z faces +z
    edge(range.map((b) => [0, b]), 1);                               // lowest x faces -x
    edge(range.map((b) => [n, b]), -1);                              // highest x faces +x
  }
  return createMesh(verts, index, `terrain-${chunk.cx}-${chunk.cz}-lod${lod}`, uvs);
}
