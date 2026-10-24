// The camera and the layers behind and in front of the game. `followSmooth` keeps the camera on a thing with a little delay, looks ahead of where it is going and ignores small
// moves. `drawLayers` paints the backdrop (sky, stars, clouds, hills, buildings, pictures) that moves slower than the world, so it looks far away: that is parallax. Everything is
// worked out from the camera's place and a clock kept in the game, so a game that is rewound or replayed draws exactly the same picture.

import { screen } from './screen.js';
import { drawImage } from './assets.js';
import { drawSprite } from './art.js';

/** What each kind of layer draws. */
export const LAYER_KINDS = {
  gradient: 'A sky: one colour fading into another, top to bottom, filling the screen',
  color: 'A flat band of one colour (water, ground), from "y" down for "height" pixels',
  stars: 'Little dots of light scattered across the sky',
  clouds: 'Soft clouds drifting by',
  hills: 'A rolling silhouette of hills that fills down to the bottom of the screen',
  buildings: 'A skyline of blocks of different heights',
  image: 'A picture file, repeated sideways',
  sprite: 'One of your sprites, repeated sideways',
};

/** The limits a layers file is held to. */
export const LAYER_LIMITS = { layers: 12, name: 32, size: 4000, parallax: 4 };

/** The camera settings and what they mean. */
export const CAMERA_DEFAULTS = { smooth: 0.15, lookAhead: 0, deadZone: 0 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod = (a, n) => ((a % n) + n) % n;

/**
 * Keep the camera on a thing, with a delay and a look ahead. Call it every frame in `update` (it needs `dt`). The camera never shows anything outside the map. The first call
 * puts the camera right on the thing.
 * @param {{camera?: {x: number, y: number}}} game
 * @param {import('./things.js').Thing | undefined} thing
 * @param {{width: number, height: number}} map the size of the whole world, for example what loadMap returned
 * @param {number} dt seconds since the last frame
 * @param {{smooth?: number, lookAhead?: number, deadZone?: number, width?: number, height?: number}} [opts] `smooth`: seconds to catch up (0 is no delay); `lookAhead`: pixels
 *   to show ahead of where the thing is heading; `deadZone`: pixels the thing may wander from the middle before the camera moves; `width`, `height`: the screen
 */
export function followSmooth(game, thing, map, dt, opts = {}) {
  if (!thing) return;
  if (!map || typeof map.width !== 'number') throw new Error('followSmooth needs the size of the level. In create, write game.map = loadMap(...).');
  const { smooth, lookAhead, deadZone } = { ...CAMERA_DEFAULTS, ...opts };
  const screenW = opts.width ?? screen().width;
  const screenH = opts.height ?? screen().height;
  const cx = thing.x + thing.w / 2;
  const cy = thing.y + thing.h / 2;
  const fresh = !game.camera?.follow;
  game.camera ??= { x: 0, y: 0 };
  const cam = game.camera;
  const state = cam.follow ??= { lx: cx, ly: cy, ox: 0, oy: 0 };
  const moved = { x: cx - state.lx, y: cy - state.ly };
  state.lx = cx;
  state.ly = cy;
  const k = smooth > 0 ? 1 - Math.exp(-Math.max(0, dt) / smooth) : 1;
  const heading = (d) => (Math.abs(d) < 0.01 ? 0 : Math.sign(d));
  state.ox += (heading(moved.x) * lookAhead - state.ox) * (fresh ? 1 : k);
  state.oy += (heading(moved.y) * lookAhead - state.oy) * (fresh ? 1 : k);
  let wantX = cx + state.ox;
  let wantY = cy + state.oy;
  if (deadZone > 0 && !fresh) {
    wantX = clamp(cam.x + screenW / 2, wantX - deadZone, wantX + deadZone);
    wantY = clamp(cam.y + screenH / 2, wantY - deadZone, wantY + deadZone);
  }
  const target = (want, size, world) => clamp(want - size / 2, 0, Math.max(0, world - size));
  const tx = target(wantX, screenW, map.width);
  const ty = target(wantY, screenH, map.height);
  cam.x = fresh ? tx : cam.x + (tx - cam.x) * k;
  cam.y = fresh ? ty : cam.y + (ty - cam.y) * k;
}

/**
 * Move the layers' clock on, so layers that scroll by themselves (clouds) keep moving. Call it every frame in `update`.
 * @param {{layerClock?: number}} game
 * @param {number} dt seconds since the last frame
 */
export function stepLayers(game, dt) {
  game.layerClock = (game.layerClock ?? 0) + Math.max(0, dt);
}

/** The layers as an array, from the array itself or from the whole file (`{ camera, layers }`). */
const listOf = (layers) => (Array.isArray(layers) ? layers : layers?.layers ?? []);

/** A number from the whole numbers `a`, `b` and the layer's seed, between 0 and 1. The same inputs always give the same number. */
function hash(a, b, seed) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function paintLayer(g, layer, art, ox, w, h) {
  const size = layer.size ?? 200;
  const color = layer.color ?? '#ffffff';
  const top = layer.y ?? 0;
  const first = Math.floor(-ox / size) - 1;
  const last = Math.ceil((w - ox) / size) + 1;
  if (layer.kind === 'gradient') {
    const fill = g.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, color);
    fill.addColorStop(1, layer.color2 ?? '#000000');
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
  } else if (layer.kind === 'color') {
    g.fillStyle = color;
    g.fillRect(0, top, w, layer.height ?? h - top);
  } else if (layer.kind === 'stars') {
    g.fillStyle = color;
    const band = layer.height ?? h;
    for (let cell = first; cell <= last; cell++) {
      for (let i = 0; i < 4; i++) {
        const x = cell * size + hash(cell, i, layer.seed ?? 1) * size + ox;
        const y = top + hash(cell, i + 17, layer.seed ?? 1) * band;
        const s = hash(cell, i + 31, layer.seed ?? 1) < 0.25 ? 2 : 1;
        g.fillRect(Math.round(x), Math.round(y), s, s);
      }
    }
  } else if (layer.kind === 'clouds') {
    g.fillStyle = color;
    const band = layer.height ?? 120;
    for (let cell = first; cell <= last; cell++) {
      if (hash(cell, 3, layer.seed ?? 1) < 0.35) continue;
      const x = cell * size + hash(cell, 5, layer.seed ?? 1) * size * 0.6 + ox;
      const y = top + hash(cell, 7, layer.seed ?? 1) * band;
      const r = 14 + hash(cell, 9, layer.seed ?? 1) * 16;
      for (const [dx, dy, k] of [[0, 0, 1], [r * 0.9, r * 0.2, 0.8], [-r * 0.9, r * 0.25, 0.7], [r * 0.3, -r * 0.35, 0.8]]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r * k * 1.2, r * k * 0.8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (layer.kind === 'hills') {
    const amp = layer.height ?? 60;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w + 4; x += 4) {
      const wx = x - ox;
      const wave = Math.sin((wx / size) * Math.PI * 2) + 0.5 * Math.sin((wx / size) * Math.PI * 2 * 2.3 + 1.7);
      g.lineTo(x, top + amp * (1 - wave / 1.5) / 2);
    }
    g.lineTo(w + 4, h);
    g.closePath();
    g.fill();
  } else if (layer.kind === 'buildings') {
    const base = layer.height ?? 160;
    g.fillStyle = color;
    for (let cell = first; cell <= last; cell++) {
      const width = size * (0.5 + hash(cell, 2, layer.seed ?? 1) * 0.45);
      const tall = base * (0.4 + hash(cell, 4, layer.seed ?? 1) * 0.6);
      g.fillRect(Math.round(cell * size + ox), Math.round(top + base - tall), Math.round(width), Math.ceil(tall + (h - top - base)));
    }
  } else if (layer.kind === 'image' || layer.kind === 'sprite') {
    const picture = layer.kind === 'sprite' ? art?.[layer.sprite] : null;
    if (layer.kind === 'sprite' && !picture) return;
    const tileW = layer.size ?? 256;
    const tileH = layer.height ?? tileW;
    for (let x = mod(ox, tileW) - tileW; x < w; x += tileW) {
      if (picture) drawSprite(g, picture, 0, Math.round(x), top, tileW, tileH, false);
      else if (layer.image) drawImage(g, layer.image, Math.round(x), top, tileW, tileH);
    }
  }
}

/**
 * Draw the layers. Call it before `drawThings` for the backdrop, and again with `{ front: true }` after it for layers that pass in front of everything (mist, leaves).
 * A layer's `parallax` says how much it moves with the camera: 1 moves with the world, 0.5 moves half as much (so it looks far away), 0 stays put on the screen.
 * @param {CanvasRenderingContext2D} g
 * @param {{camera?: {x: number, y: number}, layerClock?: number}} game
 * @param {Array<object> | {layers: Array<object>}} layers the layers, or the whole file from the Layers panel
 * @param {{front?: boolean, art?: Object<string, import('./art.js').Sprite>, width?: number, height?: number}} [opts] `front`: draw the layers marked "in front" instead
 */
export function drawLayers(g, game, layers, { front = false, art, width = screen().width, height = screen().height } = {}) {
  const cam = game.camera ?? { x: 0, y: 0 };
  const clock = game.layerClock ?? 0;
  g.save();
  for (const layer of listOf(layers)) {
    if (!layer || layer.hidden || !!layer.front !== front) continue;
    const [px, py] = layer.parallax ?? [0.5, 0];
    const [sx, sy] = layer.scroll ?? [0, 0];
    g.globalAlpha = layer.alpha ?? 1;
    g.save();
    g.translate(0, Math.round(-cam.y * py + sy * clock));
    paintLayer(g, layer, art, Math.round(-cam.x * px + sx * clock), width, height);
    g.restore();
  }
  g.restore();
}

/**
 * Say what is wrong with a set of layers, as short sentences (an empty list when it is fine).
 * @param {Array<object> | {camera?: object, layers: Array<object>}} file
 * @returns {string[]}
 */
export function layerProblems(file) {
  const out = [];
  const layers = listOf(file);
  if (layers.length > LAYER_LIMITS.layers) out.push(`There are ${layers.length} layers; more than ${LAYER_LIMITS.layers} is slow and hard to tell apart.`);
  layers.forEach((l, i) => {
    const name = l?.name ?? `layer ${i + 1}`;
    if (!l || !LAYER_KINDS[l.kind]) out.push(`The layer "${name}" is not a kind of layer the kit knows.`);
    else if (l.kind === 'sprite' && !l.sprite) out.push(`The layer "${name}" needs a sprite to repeat.`);
    else if (l.kind === 'image' && !l.image) out.push(`The layer "${name}" needs a picture file.`);
    else if (l.parallax && !(Array.isArray(l.parallax) && l.parallax.every((v) => Math.abs(v) <= LAYER_LIMITS.parallax))) {
      out.push(`The layer "${name}" has a parallax that is not two numbers.`);
    }
  });
  const cam = Array.isArray(file) ? null : file?.camera;
  if (cam && !(cam.smooth >= 0 && cam.lookAhead >= 0 && cam.deadZone >= 0)) out.push('The camera settings should be numbers that are not below 0.');
  return out;
}
