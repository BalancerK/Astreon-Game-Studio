/**
 * Every backend draws the same instance buffer: one quad per sprite, 11 words
 * (44 bytes) each, so switching renderer changes only upload and draw calls.
 *
 *  word 0-1  x, y        centre in world units
 *  word 2-3  w, h        size in world units (a negative w draws the sprite mirrored left to right)
 *  word 4    rotation    radians
 *  word 5-8  u0 v0 u1 v1 atlas rectangle, normalised 0..1
 *  word 9    tint        RGBA8, little-endian (R in the lowest byte); see packTint
 *  word 10   meta        atlas page in bits 0-7, flags above: bit 8 = signed-distance-field sprite (text), bit 9 = ignores 2D lighting
 *
 * Draw order is push order unless sprites are given a sort key (see `push` and `sort`). The key is NOT part of the
 * instance data: it lives in a parallel array and never reaches the GPU.
 */
export const INSTANCE_WORDS = 11;
/** Bytes per sprite instance in a `SpriteBatch` (`INSTANCE_WORDS` × 4). */
export const INSTANCE_BYTES = INSTANCE_WORDS * 4;

/** Pack 0..255 channel values into the tint word. */
export const packTint = (r, g, b, a = 255) => (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;

/** Flag in the instance meta word: the sprite is a signed distance field (anti-aliased by threshold in the shader). */
export const META_SDF = 256;

/** Flag in the instance meta word: the sprite ignores 2D lighting (see `Atlas.add`'s `unlit`). */
export const META_UNLIT = 512;

/** Opaque white: leaves the sprite's own colours unchanged. */
export const WHITE = 0xffffffff;

/**
 * Sort key for layered, depth-sorted 2D scenes: higher layers draw on top; within a layer, larger `y` (lower on
 * screen, nearer the viewer in a top-down view) draws on top. Keys are 32-bit floats, so keep `layer` below about
 * 200 and |y| below 40,000 for whole-unit precision.
 * @param {number} layer
 * @param {number} [y]
 */
export const sortKey = (layer, y = 0) => layer * 100000 + y;

// Order-preserving map from a float32 to an unsigned integer (so keys can be radix sorted by their bits).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const orderBits = (v) => { f32[0] = v; const b = u32[0]; return (b & 0x80000000 ? ~b : b | 0x80000000) >>> 0; };

/** Accumulates sprites for one frame. Reuse it every frame: `clear()` then `push()`. */
export class SpriteBatch {
  /** @param {number} [capacity] Initial sprite capacity (grows as needed). */
  constructor(capacity = 1024) {
    this.f32 = new Float32Array(capacity * INSTANCE_WORDS);
    this.u32 = new Uint32Array(this.f32.buffer);
    this.keys = new Float32Array(capacity);
    this.count = 0;
    /** True once a sprite was pushed with a smaller key than the one before it: `sort()` has work to do. */
    this.needsSort = false;
    this.lastKey = -Infinity;
    this.scratch = null; // lazily allocated sort buffers
  }

  clear() { this.count = 0; this.needsSort = false; this.lastKey = -Infinity; }

  get capacity() { return this.f32.length / INSTANCE_WORDS; }

  #grow() {
    const next = new Float32Array(this.f32.length * 2);
    next.set(this.f32);
    this.f32 = next;
    this.u32 = new Uint32Array(next.buffer);
    const keys = new Float32Array(this.keys.length * 2);
    keys.set(this.keys);
    this.keys = keys;
  }

  /**
   * @param {number} x Centre x (world)
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} rot Radians
   * @param {{u0: number, v0: number, u1: number, v1: number}} sprite Atlas entry
   * @param {number} [tint] See packTint
   * @param {number} [key] Sort key (default 0 = keep push order). Sprites draw in ascending key order, ties in push order;
   *   see `sortKey` and `sort`. Pushing keys in ascending order costs nothing extra.
   */
  push(x, y, w, h, rot, sprite, tint = WHITE, key = 0) {
    if ((this.count + 1) * INSTANCE_WORDS > this.f32.length) this.#grow();
    const i = this.count++;
    const o = i * INSTANCE_WORDS;
    if (key !== key) key = 0; // NaN would break the ordering
    if (key < this.lastKey) this.needsSort = true;
    this.lastKey = key;
    this.keys[i] = key;
    const f = this.f32;
    f[o] = x; f[o + 1] = y; f[o + 2] = w; f[o + 3] = h; f[o + 4] = rot;
    f[o + 5] = sprite.u0; f[o + 6] = sprite.v0; f[o + 7] = sprite.u1; f[o + 8] = sprite.v1;
    this.u32[o + 9] = tint;
    this.u32[o + 10] = (sprite.page | 0) | (sprite.sdf ? META_SDF : 0) | (sprite.unlit ? META_UNLIT : 0);
  }

  /**
   * Append sprites that are already in instance form (a cached block of `count` sprites, as `push` would have made them), moved by (`dx`, `dy`) and all given the same sort key. This is
   * how a tile map's chunks reach the batch: a copy of a few kilobytes instead of one `push` per tile.
   * @param {Float32Array} block `count * INSTANCE_WORDS` words
   * @param {number} count
   * @param {number} [dx]
   * @param {number} [dy]
   * @param {number} [key]
   */
  pushBlock(block, count, dx = 0, dy = 0, key = 0) {
    if (count <= 0) return;
    while ((this.count + count) * INSTANCE_WORDS > this.f32.length) this.#grow();
    const at = this.count * INSTANCE_WORDS;
    this.f32.set(block.subarray(0, count * INSTANCE_WORDS), at);
    if (dx !== 0 || dy !== 0) for (let i = 0; i < count; i++) { this.f32[at + i * INSTANCE_WORDS] += dx; this.f32[at + i * INSTANCE_WORDS + 1] += dy; }
    if (key !== key) key = 0;
    this.keys.fill(key, this.count, this.count + count);
    if (key < this.lastKey) this.needsSort = true;
    this.lastKey = key;
    this.count += count;
  }

  /**
   * Put the sprites into key order (stable: equal keys keep push order). Renderers call this for you; it does nothing
   * (and allocates nothing) when the keys were pushed in ascending order, so unsorted scenes pay no cost.
   * Uses a radix sort on the key bits: O(n), no comparator calls, buffers reused across frames.
   */
  sort() {
    if (!this.needsSort) return;
    const n = this.count;
    let sc = this.scratch;
    if (!sc || sc.order.length < n || sc.data.length < n * INSTANCE_WORDS || sc.keys.length < n) {
      const cap = Math.max(n, this.capacity);
      sc = this.scratch = { order: new Uint32Array(cap), tmp: new Uint32Array(cap), bits: new Uint32Array(cap), data: new Float32Array(cap * INSTANCE_WORDS), keys: new Float32Array(cap) };
    }
    let { order, tmp } = sc;
    const bits = sc.bits;
    for (let i = 0; i < n; i++) { order[i] = i; bits[i] = orderBits(this.keys[i]); }
    const counts = new Uint32Array(256);
    for (let shift = 0; shift < 32; shift += 8) {
      counts.fill(0);
      for (let i = 0; i < n; i++) counts[(bits[order[i]] >>> shift) & 255]++;
      if (counts[(bits[order[0]] >>> shift) & 255] === n) continue; // every key shares this byte
      let sum = 0;
      for (let b = 0; b < 256; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
      for (let i = 0; i < n; i++) { const idx = order[i]; tmp[counts[(bits[idx] >>> shift) & 255]++] = idx; }
      [order, tmp] = [tmp, order];
    }
    const src = this.f32, dst = sc.data, keys = this.keys, outKeys = sc.keys;
    for (let i = 0; i < n; i++) {
      const from = order[i] * INSTANCE_WORDS, to = i * INSTANCE_WORDS;
      for (let w = 0; w < INSTANCE_WORDS; w++) dst[to + w] = src[from + w];
      outKeys[i] = keys[order[i]];
    }
    // swap the sorted copy in; the old buffers become next frame's scratch
    sc.data = src; this.f32 = dst; this.u32 = new Uint32Array(dst.buffer);
    sc.keys = keys; this.keys = outKeys;
    this.needsSort = false;
    this.lastKey = n > 0 ? this.keys[n - 1] : -Infinity;
  }

  /** The used part of the buffer, for upload. */
  get used() { return this.f32.subarray(0, this.count * INSTANCE_WORDS); }
}
