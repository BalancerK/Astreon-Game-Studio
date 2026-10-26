import { INSTANCE_WORDS, packTint } from './batch.js';

/**
 * Tile maps for big levels. A `TileMap` holds layers of tiles in chunks of 16 x 16; `drawTileMap` puts only the chunks the camera can see into the sprite batch, and each chunk's sprites are
 * built once and kept, so a frame costs a memory copy of the visible chunks rather than one `push` per tile (a 1000 x 1000 map costs the same to draw as a 20 x 15 one). Tiles that animate are
 * the only ones worked out each frame. It works with every renderer, since it only fills the batch.
 *
 * - A tile is a number (its "gid"): 0 is empty, and a tileset covers the numbers from its `firstGid`. The top three bits are Tiled's flip flags (`FLIP_H`, `FLIP_V`, `FLIP_D`), so maps made
 *   in Tiled load as they are (`tileMapFromTiled`).
 * - Layers have an offset, a parallax factor, an opacity and a tint; a layer can be infinite (chunks are made as you write to them, negative coordinates included).
 * - Changing a tile (`layer.set`) rebuilds only its own chunk, on the next draw.
 */

/** Tiled's flags in the top bits of a tile number: mirrored left to right, top to bottom, and across the diagonal (applied in that order: diagonal, then horizontal, then vertical). */
export const FLIP_H = 0x80000000;
/** The flag for a tile mirrored top to bottom. */
export const FLIP_V = 0x40000000;
/** The flag for a tile mirrored across the diagonal. */
export const FLIP_D = 0x20000000;
const FLAGS = 0xe0000000, ID = 0x1fffffff;
/** Tiles along one side of a chunk. */
export const CHUNK = 16;
const CELLS = CHUNK * CHUNK;

// For each combination of flip flags (bit 2 = H, bit 1 = V, bit 0 = D): how to draw the picture so it ends up as Tiled says, as a turn (quarter turns, clockwise on screen) and a mirror.
// Worked out once by trying all eight; see the test, which checks every corner of every combination.
const ORIENTATION = (() => {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const out = [];
  for (let flags = 0; flags < 8; flags++) {
    const want = corners.map(([x, y]) => {
      let p = [x, y];
      if (flags & 1) p = [p[1], p[0]];
      if (flags & 4) p = [-p[0], p[1]];
      if (flags & 2) p = [p[0], -p[1]];
      return p;
    });
    let found = null;
    for (let turns = 0; turns < 4 && !found; turns++) for (const mirror of [false, true]) {
      const ok = corners.every(([x, y], i) => {
        let p = [mirror ? -x : x, y];
        for (let t = 0; t < turns; t++) p = [-p[1], p[0]];                                  // a quarter turn clockwise with y down
        return p[0] === want[i][0] && p[1] === want[i][1];
      });
      if (ok) { found = { turns, mirror }; break; }
    }
    out.push(found);
  }
  return out;
})();

/** The turn (in quarter turns clockwise) and mirror that draw a tile with these flip flags; exported for tests. */
export function tileOrientation(gid) {
  const o = ORIENTATION[((gid & FLIP_H) ? 4 : 0) | ((gid & FLIP_V) ? 2 : 0) | ((gid & FLIP_D) ? 1 : 0)];
  return o;
}

/**
 * The pictures of tiles: a run of tile numbers starting at `firstGid`, each a rectangle of one atlas sprite.
 */
export class TileSet {
  /**
   * @param {object} o
   * @param {string} [o.name]
   * @param {number} [o.firstGid] The number of this set's first tile (default 1; `TileMap.addTileset` renumbers it when sets would overlap)
   * @param {number} o.tileW Width of one tile in world units
   * @param {number} o.tileH
   * @param {(id: number) => import('./atlas.js').Sprite} o.sprite The atlas rectangle of tile `id` (0-based within the set)
   * @param {number} o.count How many tiles the set has
   * @param {Record<number, {id: number, ms: number}[]>} [o.animations] Tiles that animate: tile id to its frames (a tile id and how many milliseconds it shows)
   */
  constructor({ name = 'tiles', firstGid = 1, tileW, tileH, sprite, count, animations = {} }) {
    if (!(tileW > 0 && tileH > 0)) throw new Error('a tileset needs tileW and tileH');
    if (!(count >= 1) || typeof sprite !== 'function') throw new Error('a tileset needs a count and a sprite(id) function');
    this.name = name; this.firstGid = firstGid; this.tileW = tileW; this.tileH = tileH; this.count = count; this.sprite = sprite;
    /** @type {Map<number, {frames: {id: number, ms: number}[], total: number}>} */
    this.animations = new Map();
    for (const [id, frames] of Object.entries(animations)) this.animate(Number(id), frames);
    this.cache = new Map();
  }

  /**
   * Cut a sheet (one atlas sprite holding a grid of tiles) into tiles.
   * @param {import('./atlas.js').Sprite} sheet
   * @param {object} o `tileW`, `tileH` (in pixels of the sheet, also the size they are drawn at unless `drawW`/`drawH` say otherwise), `columns`, `count`, `margin`, `spacing`, and the options of the constructor
   */
  static fromSheet(sheet, { tileW, tileH, columns = Math.floor(sheet.w / tileW), count = columns * Math.floor(sheet.h / tileH), margin = 0, spacing = 0, drawW = tileW, drawH = tileH, ...rest } = {}) {
    if (!(columns >= 1)) throw new Error('the sheet is narrower than one tile');
    const size = (sheet.u1 - sheet.u0) / sheet.w;                                           // atlas units per pixel
    const sprite = (id) => {
      const x = margin + (id % columns) * (tileW + spacing), y = margin + Math.floor(id / columns) * (tileH + spacing);
      return { u0: sheet.u0 + x * size, v0: sheet.v0 + y * size, u1: sheet.u0 + (x + tileW) * size, v1: sheet.v0 + (y + tileH) * size, w: tileW, h: tileH, page: sheet.page, sdf: false };
    };
    return new TileSet({ ...rest, tileW: drawW, tileH: drawH, sprite, count });
  }

  /** Make tile `id` animate: its frames, each a tile id of this set and the milliseconds it shows. */
  animate(id, frames) {
    if (!Array.isArray(frames) || frames.length === 0) throw new Error(`tile ${id}: an animation needs frames`);
    const total = frames.reduce((a, f) => a + Math.max(1, f.ms), 0);
    this.animations.set(id, { frames: frames.map((f) => ({ id: f.id, ms: Math.max(1, f.ms) })), total });
    return this;
  }

  /** The tile id shown at `time` seconds (the tile itself when it does not animate). */
  frameAt(id, time) {
    const a = this.animations.get(id);
    if (!a) return id;
    let t = (time * 1000) % a.total;
    for (const f of a.frames) { if (t < f.ms) return f.id; t -= f.ms; }
    return a.frames[a.frames.length - 1].id;
  }

  /** @returns {import('./atlas.js').Sprite} */
  spriteOf(id) {
    let s = this.cache.get(id);
    if (!s) { s = this.sprite(id); this.cache.set(id, s); }
    return s;
  }
}

const chunkKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

/** One layer of a tile map: tiles in chunks, made when written to, so a layer can be as big as you like and can reach into negative coordinates. */
export class TileLayer {
  constructor(map, { name = 'layer', offsetX = 0, offsetY = 0, parallaxX = 1, parallaxY = 1, opacity = 1, tint = 0xffffff, visible = true } = {}) {
    this.map = map; this.name = name; this.offsetX = offsetX; this.offsetY = offsetY; this.parallaxX = parallaxX; this.parallaxY = parallaxY;
    this.visible = visible;
    /** @type {Map<number, {cx: number, cy: number, data: Uint32Array, built: number, style: number, block: Float32Array | null, count: number, animated: number[]}>} */
    this.chunks = new Map();
    this.style = 0;
    this.#opacity = opacity; this.#tint = tint;
  }

  #opacity; #tint;
  /** 0 to 1. */
  get opacity() { return this.#opacity; }
  set opacity(v) { this.#opacity = v; this.style++; }
  /** 0xRRGGBB multiplied into every tile. */
  get tint() { return this.#tint; }
  set tint(v) { this.#tint = v; this.style++; }

  #chunk(tx, ty, make) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK), key = chunkKey(cx, cy);
    let c = this.chunks.get(key);
    if (!c && make) { c = { cx, cy, data: new Uint32Array(CELLS), built: -1, style: -1, block: null, count: 0, animated: [] }; this.chunks.set(key, c); }
    return c;
  }

  /** The tile number at a tile position (0 for empty or outside anything written). */
  get(tx, ty) {
    const c = this.#chunk(tx, ty, false);
    return c ? c.data[(((ty % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((tx % CHUNK) + CHUNK) % CHUNK)] : 0;
  }

  /** Put a tile (a number, flip flags included; 0 clears). Only the chunk it is in is rebuilt. */
  set(tx, ty, gid) {
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error(`tile positions are whole numbers (got ${tx}, ${ty})`);
    if (tx < -32768 * CHUNK || tx >= 32768 * CHUNK || ty < -32768 * CHUNK || ty >= 32768 * CHUNK) throw new Error('that tile position is too far away');
    const c = this.#chunk(tx, ty, gid !== 0);
    if (!c) return this;
    const i = (((ty % CHUNK) + CHUNK) % CHUNK) * CHUNK + (((tx % CHUNK) + CHUNK) % CHUNK);
    if (c.data[i] !== (gid >>> 0)) { c.data[i] = gid; c.built = -1; }
    return this;
  }

  /** Fill a rectangle of tiles with one tile number. */
  fill(tx, ty, w, h, gid) {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.set(x, y, gid);
    return this;
  }

  /** Load a block of tile numbers (row by row) with its top-left at (`x0`, `y0`). */
  setData(data, width, height, x0 = 0, y0 = 0) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const g = data[y * width + x]; if (g) this.set(x0 + x, y0 + y, g); }
    return this;
  }

  /** The smallest rectangle of tiles holding every tile, as `{x, y, w, h}`, or null when the layer is empty. */
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.chunks.values()) for (let i = 0; i < CELLS; i++) {
      if (!c.data[i]) continue;
      const x = c.cx * CHUNK + (i % CHUNK), y = c.cy * CHUNK + Math.floor(i / CHUNK);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Build the sprites of a chunk's still tiles, and list the tiles that animate. */
  _build(c) {
    const map = this.map;
    const tint = packTint(this.#tint >> 16 & 255, this.#tint >> 8 & 255, this.#tint & 255, Math.round(Math.max(0, Math.min(1, this.#opacity)) * 255));
    let count = 0;
    for (let i = 0; i < CELLS; i++) if (c.data[i]) count++;
    const block = new Float32Array(Math.max(1, count) * INSTANCE_WORDS), u32 = new Uint32Array(block.buffer);
    const animated = [];
    let n = 0;
    for (let i = 0; i < CELLS; i++) {
      const gid = c.data[i];
      if (!gid) continue;
      const tx = c.cx * CHUNK + (i % CHUNK), ty = c.cy * CHUNK + Math.floor(i / CHUNK);
      const r = map.resolve(gid);
      if (!r) continue;
      if (r.set.animations.has(r.id)) { animated.push(i); continue; }
      writeTile(block, u32, n++, map, r.set, r.id, gid, tx, ty, tint);
    }
    c.block = block; c.count = n; c.animated = animated; c.built = map.version; c.style = this.style;
  }
}

/** Write the instance of one tile at slot `n` of a block. */
function writeTile(block, u32, n, map, set, id, gid, tx, ty, tint) {
  const o = n * INSTANCE_WORDS, sp = set.spriteOf(id), w = set.tileW, h = set.tileH;
  const orient = tileOrientation(gid);
  block[o] = tx * map.tileW + w / 2;
  block[o + 1] = (ty + 1) * map.tileH - h / 2;                                               // a tile taller than the grid stands on its cell, as in Tiled
  block[o + 2] = orient.mirror ? -w : w;
  block[o + 3] = h;
  block[o + 4] = orient.turns * Math.PI / 2;
  block[o + 5] = sp.u0; block[o + 6] = sp.v0; block[o + 7] = sp.u1; block[o + 8] = sp.v1;
  u32[o + 9] = tint;
  u32[o + 10] = sp.page | 0;
}

/** A tile map: a grid size, tilesets and layers. */
export class TileMap {
  /** @param {object} o `tileW`, `tileH`: the size of one grid cell in world units */
  constructor({ tileW, tileH = tileW } = {}) {
    if (!(tileW > 0 && tileH > 0)) throw new Error('a tile map needs tileW and tileH');
    this.tileW = tileW; this.tileH = tileH;
    /** @type {TileSet[]} */
    this.tilesets = [];
    /** @type {TileLayer[]} */
    this.layers = [];
    /** Goes up when the tilesets change, which makes every chunk rebuild. */
    this.version = 0;
    this.scratch = new Float32Array(INSTANCE_WORDS * 4);
  }

  /** Add a tileset. Its tile numbers must not overlap an earlier set's: when they would, it is renumbered to follow. Returns the set. */
  addTileset(set) {
    const end = Math.max(1, ...this.tilesets.map((t) => t.firstGid + t.count));
    if (this.tilesets.some((t) => set.firstGid < t.firstGid + t.count && t.firstGid < set.firstGid + set.count)) set.firstGid = end;
    this.tilesets.push(set);
    this.tilesets.sort((a, b) => a.firstGid - b.firstGid);
    this.version++;
    return set;
  }

  /** Add a layer on top of the earlier ones. */
  addLayer(options) {
    const layer = new TileLayer(this, options);
    this.layers.push(layer);
    return layer;
  }

  /** The tileset and tile id of a tile number (flags ignored), or null. */
  resolve(gid) {
    const n = gid & ID;
    for (let i = this.tilesets.length - 1; i >= 0; i--) {
      const s = this.tilesets[i];
      if (n >= s.firstGid) return n < s.firstGid + s.count ? { set: s, id: n - s.firstGid } : null;
    }
    return null;
  }

  /** The tile position containing a world position. */
  worldToTile(x, y) { return { x: Math.floor(x / this.tileW), y: Math.floor(y / this.tileH) }; }
}

/**
 * Add a tile map to a sprite batch, for the chunks the camera sees.
 * @param {import('./batch.js').SpriteBatch} batch
 * @param {TileMap} map
 * @param {import('./camera.js').Camera} camera
 * @param {object} [o]
 * @param {number} [o.time] Seconds, for animated tiles (use game time so a paused game freezes them)
 * @param {number} [o.key] Sort key of the first layer; each layer after it is one more, so a map's layers sit among your own sprites (see `sortKey`)
 * @returns {number} the number of tiles added
 */
export function drawTileMap(batch, map, camera, { time = 0, key = 0 } = {}) {
  const halfW = camera.viewW / camera.zoom / 2 + Math.abs(camera.offsetX ?? 0), halfH = camera.viewH / camera.zoom / 2 + Math.abs(camera.offsetY ?? 0);
  const camX = camera.x, camY = camera.y;
  let tiles = 0;
  for (let li = 0; li < map.layers.length; li++) {
    const layer = map.layers[li];
    if (!layer.visible || layer.opacity <= 0) continue;
    const dx = layer.offsetX + camX * (1 - layer.parallaxX), dy = layer.offsetY + camY * (1 - layer.parallaxY);
    // the part of the layer's own space in view, in tiles (one extra tile each side for tiles taller than the grid)
    const x0 = Math.floor((camX - halfW - dx) / map.tileW) - 1, x1 = Math.floor((camX + halfW - dx) / map.tileW) + 1;
    const y0 = Math.floor((camY - halfH - dy) / map.tileH) - 2, y1 = Math.floor((camY + halfH - dy) / map.tileH) + 1;
    const layerKey = key + li;
    const cx0 = Math.floor(x0 / CHUNK), cx1 = Math.floor(x1 / CHUNK), cy0 = Math.floor(y0 / CHUNK), cy1 = Math.floor(y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = layer.chunks.get(chunkKey(cx, cy));
      if (!c) continue;
      if (c.built !== map.version || c.style !== layer.style) layer._build(c);
      if (c.count) batch.pushBlock(c.block, c.count, dx, dy, layerKey);
      tiles += c.count;
      if (c.animated.length) tiles += pushAnimated(batch, map, layer, c, time, dx, dy, layerKey);
    }
  }
  return tiles;
}

const oneTile = new Float32Array(INSTANCE_WORDS), oneTile32 = new Uint32Array(oneTile.buffer);
function pushAnimated(batch, map, layer, c, time, dx, dy, key) {
  const tint = packTint(layer.tint >> 16 & 255, layer.tint >> 8 & 255, layer.tint & 255, Math.round(Math.max(0, Math.min(1, layer.opacity)) * 255));
  for (const i of c.animated) {
    const gid = c.data[i], r = map.resolve(gid);
    writeTile(oneTile, oneTile32, 0, map, r.set, r.set.frameAt(r.id, time), gid, c.cx * CHUNK + (i % CHUNK), c.cy * CHUNK + Math.floor(i / CHUNK), tint);
    batch.pushBlock(oneTile, 1, dx, dy, key);
  }
  return c.animated.length;
}

// ---------- Tiled ----------

const decodeBase64 = (text) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const bin = atob(text), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function tiledData(layer, where) {
  const data = layer.data;
  if (Array.isArray(data)) return Uint32Array.from(data);
  if (typeof data === 'string') {
    if (layer.compression) throw new Error(`${where}: the tile data is compressed (${layer.compression}); in Tiled, set "Tile Layer Format" to CSV or Base64 (uncompressed)`);
    const b = decodeBase64(data);
    return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3)));
  }
  throw new Error(`${where}: it has no tile data`);
}

const tintOf = (s) => { if (!s) return 0xffffff; const h = String(s).replace('#', ''); return parseInt(h.length === 8 ? h.slice(2) : h, 16) || 0xffffff; };

/**
 * Make a tile map from a Tiled map in JSON (File > Export As > JSON). Orthogonal maps, finite or infinite, with tile layers (nested in groups too), embedded tilesets with their animations,
 * layer offsets, parallax, opacity and tint, and flipped tiles are read. Object layers, image layers and other map shapes (hexagonal, isometric) are skipped and named in `warnings`.
 * @param {object} json The parsed map
 * @param {object} o
 * @param {(tileset: object) => import('./atlas.js').Sprite} o.sheet Gives the atlas sprite holding a tileset's picture (`tileset.image` is the file name from Tiled, `tileset.name` its name)
 * @returns {{map: TileMap, warnings: string[], layers: Record<string, TileLayer>}}
 */
export function tileMapFromTiled(json, { sheet } = {}) {
  if (typeof sheet !== 'function') throw new Error('tileMapFromTiled needs sheet(tileset), which returns the atlas sprite of the tileset\'s picture');
  if (json.orientation && json.orientation !== 'orthogonal') throw new Error(`only orthogonal Tiled maps are supported (this one is ${json.orientation})`);
  const warnings = [];
  const map = new TileMap({ tileW: json.tilewidth, tileH: json.tileheight });
  for (const ts of json.tilesets ?? []) {
    if (ts.source) throw new Error(`the tileset "${ts.source}" is a separate file; in Tiled, embed tilesets in the map (or export the map with them embedded)`);
    const s = TileSet.fromSheet(sheet(ts), {
      name: ts.name, firstGid: ts.firstgid, tileW: ts.tilewidth, tileH: ts.tileheight, columns: ts.columns || undefined, count: ts.tilecount, margin: ts.margin ?? 0, spacing: ts.spacing ?? 0,
    });
    for (const t of ts.tiles ?? []) if (t.animation?.length) s.animate(t.id, t.animation.map((f) => ({ id: f.tileid, ms: f.duration })));
    map.tilesets.push(s);
  }
  map.tilesets.sort((a, b) => a.firstGid - b.firstGid);
  const layers = {};
  const walk = (list, prefix, ox, oy) => {
    for (const l of list ?? []) {
      const name = prefix + l.name;
      if (l.type === 'group') { walk(l.layers, `${name}/`, ox + (l.offsetx ?? 0), oy + (l.offsety ?? 0)); continue; }
      if (l.type !== 'tilelayer') { warnings.push(`layer "${name}" is a ${l.type} layer, which is skipped`); continue; }
      const layer = map.addLayer({
        name, offsetX: ox + (l.offsetx ?? 0), offsetY: oy + (l.offsety ?? 0), parallaxX: l.parallaxx ?? 1, parallaxY: l.parallaxy ?? 1, opacity: l.opacity ?? 1, tint: tintOf(l.tintcolor), visible: l.visible !== false,
      });
      if (l.chunks) for (const ch of l.chunks) layer.setData(tiledData(ch, `layer "${name}"`), ch.width, ch.height, ch.x, ch.y);
      else layer.setData(tiledData(l, `layer "${name}"`), l.width, l.height, l.x ?? 0, l.y ?? 0);
      layers[name] = layer;
    }
  };
  walk(json.layers, '', 0, 0);
  return { map, warnings, layers };
}

