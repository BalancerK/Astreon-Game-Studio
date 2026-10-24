// Lights and screen effects. `drawLights` lays darkness over the picture and cuts soft pools of light out of it, so a cave, a night or a dungeon is dark except where there is a
// torch, a lantern or the hero's own glow. It can also tint the whole screen a colour (a warm sunset, a cold dungeon) and darken the corners (a vignette). A light can sit at a place in
// the world or follow every thing of a kind, and can flicker. Everything is worked out from the things, the camera and the clock the game keeps (see `stepLayers`), so a game that is
// rewound or replayed draws exactly the same picture. Blur is not here: a canvas cannot do it fast enough on every machine to promise it.

import { screen } from './screen.js';
import { all } from './things.js';
import { newCanvas } from './art.js';
import { shakeOffset } from './effects.js';

/** The limits a lights file is held to. */
export const LIGHT_LIMITS = { lights: 24, radius: 1200, name: 32, occluders: 200 };

/** What the darkness, the tint and the vignette are when they are not set. */
export const SCREEN_DEFAULTS = { darkness: 0, ambient: '#0a0e24', tint: '', tintAlpha: 0, vignette: 0, occluders: [] };

const COLOR = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

/** The whole file (`{ screen, lights }`) or just the list of lights, as the two parts. */
const parts = (file) => ({
  screen: { ...SCREEN_DEFAULTS, ...(Array.isArray(file) ? {} : file?.screen) },
  lights: Array.isArray(file) ? file : file?.lights ?? [],
});

/**
 * How bright a flickering light is at a moment, from 0 to 1 (1 when it does not flicker). The same time always gives the same brightness.
 * @param {number} amount how much it flickers, from 0 to 1
 * @param {number} time the clock, in seconds
 * @param {number} [seed] makes one light flicker differently from another
 * @returns {number}
 */
export function flicker(amount, time, seed = 0) {
  if (!(amount > 0)) return 1;
  const wave = 0.5 + 0.25 * Math.sin(time * 13 + seed * 1.7) + 0.25 * Math.sin(time * 7.3 + seed * 3.1);
  return clamp(1 - amount * wave, 0, 1);
}

/** Where every light is on the screen: a light with a place, or one for each thing of the kind it follows. */
function placed(game, lights, cam, shake) {
  const out = [];
  lights.forEach((l, index) => {
    if (!l || l.hidden) return;
    if (l.follow) {
      for (const t of all(game, l.follow)) {
        out.push({ light: l, index, id: t.id ?? 0, x: t.x + t.w / 2 + (l.dx ?? 0) - cam.x + shake.x,
          y: t.y + t.h / 2 + (l.dy ?? 0) - cam.y + shake.y });
      }
    } else out.push({ light: l, index, id: 0, x: (l.x ?? 0) - cam.x + shake.x, y: (l.y ?? 0) - cam.y + shake.y });
  });
  return out.slice(0, LIGHT_LIMITS.lights * 4);
}

let dark = null;
let beam = null;
let tinted = null;

/**
 * The shadow a set of boxes throws from a light: for each side of a box that faces the light, the four corners of the area behind that side, stretching out to `reach`.
 * Together the shapes cover everything the boxes hide from the light. Boxes the light is inside are skipped (a light inside a wall would put the whole room in shadow).
 * @param {{x: number, y: number}} light where the light is
 * @param {Array<{x: number, y: number, w: number, h: number}>} boxes the things that block light
 * @param {number} reach how far the shadows run (the light's radius is enough)
 * @returns {Array<Array<[number, number]>>} shapes, each a list of corner points
 */
export function shadowShapes(light, boxes, reach) {
  const out = [];
  for (const b of boxes) {
    if (light.x > b.x && light.x < b.x + b.w && light.y > b.y && light.y < b.y + b.h) continue;
    const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      const nx = by - ay, ny = ax - bx;                                              // points away from the box's middle (corners go clockwise)
      if (nx * (light.x - ax) + ny * (light.y - ay) <= 0) continue;                   // this side faces away from the light: it adds nothing the others do not cover
      const far = (px, py) => {
        const dx = px - light.x, dy = py - light.y, len = Math.hypot(dx, dy) || 1;
        return [px + (dx / len) * reach, py + (dy / len) * reach];
      };
      out.push([[ax, ay], [bx, by], far(bx, by), far(ax, ay)]);
    }
  }
  return out;
}

function rgba(hex, alpha) {
  const n = COLOR.test(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(alpha, 0, 1)})`;
}

function glow(g, x, y, radius, color, alpha, core = 0) {
  const fade = g.createRadialGradient(x, y, 0, x, y, radius);
  fade.addColorStop(0, rgba(color, alpha));
  if (core > 0) fade.addColorStop(clamp(core, 0, 0.9), rgba(color, alpha));          // a light with a core is at full strength out to there
  fade.addColorStop(core > 0 ? core + (1 - clamp(core, 0, 0.9)) * 0.55 : 0.55, rgba(color, alpha * 0.55));
  fade.addColorStop(1, rgba(color, 0));
  g.fillStyle = fade;
  g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** The boxes that block light: every thing of the listed kinds, where it is on the screen. */
function occluderBoxes(game, kinds, cam, shake) {
  const out = [];
  for (const kind of kinds.slice(0, 16)) {
    for (const t of all(game, kind)) out.push({ x: t.x - cam.x + shake.x, y: t.y - cam.y + shake.y, w: t.w, h: t.h });
  }
  return out.slice(0, LIGHT_LIMITS.occluders);
}

/** Does this light cast shadows? Only when some kinds block light, and the light has not turned it off. */
const shadowed = (spot, boxes) => boxes.length > 0 && spot.light.shadows !== false;

/** The light's glow with the shadows cut out of it, on a small canvas of its own: white, with the light's strength as its see-through-ness. */
function litMask(spot, boxes, alpha) {
  const radius = Math.ceil(spot.light.radius ?? 120);
  const size = radius * 2;
  const left = Math.round(spot.x) - radius, top = Math.round(spot.y) - radius;
  if (!beam || beam.width !== size || beam.height !== size) beam = newCanvas(size, size);
  const b = beam.getContext('2d');
  b.globalCompositeOperation = 'source-over';
  b.clearRect(0, 0, size, size);
  glow(b, radius, radius, radius, '#ffffff', alpha, spot.light.core);
  b.globalCompositeOperation = 'destination-out';
  b.fillStyle = '#000000';
  const near = boxes.filter((o) => o.x < spot.x + radius && o.x + o.w > spot.x - radius && o.y < spot.y + radius && o.y + o.h > spot.y - radius);
  for (const shape of shadowShapes(spot, near, radius * 1.5)) {
    b.beginPath();
    shape.forEach(([x, y], i) => (i ? b.lineTo(x - left, y - top) : b.moveTo(x - left, y - top)));
    b.closePath();
    b.fill();
  }
  for (const o of near) {                                                         // the blocking thing itself is not lit from inside
    if (spot.x > o.x && spot.x < o.x + o.w && spot.y > o.y && spot.y < o.y + o.h) continue;
    b.fillRect(o.x - left, o.y - top, o.w, o.h);
  }
  b.globalCompositeOperation = 'source-over';
  return { canvas: beam, x: left, y: top };
}

/** The same mask in a colour, as faint as `amount`. */
function tintMask(mask, color, amount) {
  const size = mask.canvas.width;
  if (!tinted || tinted.width !== size || tinted.height !== size) tinted = newCanvas(size, size);
  const t = tinted.getContext('2d');
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, size, size);
  t.drawImage(mask.canvas, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = rgba(color, amount);
  t.fillRect(0, 0, size, size);
  t.globalCompositeOperation = 'source-over';
  return tinted;
}

/**
 * Draw the lights and screen effects. Call it after `drawThings` (and before the text and screens that should stay bright).
 * @param {CanvasRenderingContext2D} g
 * @param {{camera?: {x: number, y: number}, layerClock?: number, things: import('./things.js').Thing[]}} game
 * @param {{screen?: object, lights: Array<object>} | Array<object>} file the whole file from the Lights panel, or just the list of lights
 * @param {{width?: number, height?: number}} [opts] the screen's size
 */
export function drawLights(g, game, file, { width = screen().width, height = screen().height } = {}) {
  const { screen: fx, lights } = parts(file);
  const cam = game.camera ?? { x: 0, y: 0 };
  const shake = shakeOffset(game);
  const clock = game.layerClock ?? 0;
  const spots = placed(game, lights, { x: Math.round(cam.x), y: Math.round(cam.y) }, { x: Math.round(shake.x), y: Math.round(shake.y) });
  const boxes = Array.isArray(fx.occluders) && fx.occluders.length ? occluderBoxes(game, fx.occluders, cam, shake) : [];
  const strength = (s) => (s.light.intensity ?? 1) * flicker(s.light.flicker, clock, (s.light.seed ?? 0) + s.index + s.id);
  g.save();
  if (fx.tint && fx.tintAlpha > 0) {
    g.fillStyle = rgba(fx.tint, fx.tintAlpha);
    g.fillRect(0, 0, width, height);
  }
  if (fx.darkness > 0) {
    if (!dark || dark.width !== width || dark.height !== height) dark = newCanvas(width, height);
    const d = dark.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, width, height);
    d.fillStyle = rgba(fx.ambient, fx.darkness);
    d.fillRect(0, 0, width, height);
    d.globalCompositeOperation = 'destination-out';                          // each light rubs a soft hole in the darkness
    for (const s of spots) {
      const mask = shadowed(s, boxes) ? litMask(s, boxes, strength(s)) : null;
      if (mask) d.drawImage(mask.canvas, mask.x, mask.y);
      else glow(d, s.x, s.y, s.light.radius ?? 120, '#ffffff', strength(s), s.light.core);
    }
    d.globalCompositeOperation = 'source-over';
    g.drawImage(dark, 0, 0);
  }
  g.globalCompositeOperation = 'lighter';                                    // and a coloured glow where the light falls
  for (const s of spots) {
    if (!s.light.color || s.light.color.toLowerCase() === '#ffffff') continue;
    const mask = shadowed(s, boxes) ? litMask(s, boxes, strength(s)) : null;
    if (mask) g.drawImage(tintMask(mask, s.light.color, 0.35), mask.x, mask.y);
    else glow(g, s.x, s.y, s.light.radius ?? 120, s.light.color, 0.35 * strength(s), s.light.core);
  }
  g.globalCompositeOperation = 'source-over';
  if (fx.vignette > 0) {
    const edge = g.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.hypot(width, height) / 2);
    edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
    edge.addColorStop(1, `rgba(0, 0, 0, ${clamp(fx.vignette, 0, 1)})`);
    g.fillStyle = edge;
    g.fillRect(0, 0, width, height);
  }
  g.restore();
}

/**
 * Say what is wrong with a lights file, as short sentences (an empty list when it is fine).
 * @param {{screen?: object, lights: Array<object>} | Array<object>} file
 * @returns {string[]}
 */
export function lightProblems(file) {
  const out = [];
  const { screen: fx, lights } = parts(file);
  if (lights.length > LIGHT_LIMITS.lights) out.push(`There are ${lights.length} lights; more than ${LIGHT_LIMITS.lights} is slow.`);
  lights.forEach((l, i) => {
    const name = l?.name ?? `light ${i + 1}`;
    if (!l || typeof l !== 'object') out.push(`The light "${name}" is not usable.`);
    else if (!(l.radius > 0)) out.push(`The light "${name}" needs a radius above 0.`);
    else if (l.color !== undefined && !COLOR.test(l.color)) out.push(`The light "${name}" has a colour that is not like #ffd27a.`);
    else if (l.core !== undefined && !(l.core >= 0 && l.core <= 0.9)) out.push(`The light "${name}" has a core that is not from 0 to 0.9.`);
    else if (l.follow !== undefined && !/^[a-z][\w-]{0,31}$/i.test(String(l.follow))) out.push(`The light "${name}" follows a kind that is not a name.`);
  });
  if (fx.darkness > 0 && !lights.some((l) => l && !l.hidden)) out.push('It is dark and there are no lights: the screen will be dim everywhere.');
  if (fx.tint && !COLOR.test(fx.tint)) out.push('The tint should be a colour like #ff9a4a.');
  if (!Array.isArray(fx.occluders) || fx.occluders.some((k) => !/^[a-z][\w-]{0,31}$/i.test(String(k)))) out.push('The things that block light should be a list of kind names.');
  if (![fx.darkness, fx.tintAlpha, fx.vignette].every((v) => v >= 0 && v <= 1)) out.push('Darkness, tint strength and vignette are from 0 to 1.');
  return out;
}
