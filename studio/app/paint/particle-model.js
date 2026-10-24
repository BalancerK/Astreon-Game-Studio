// The Particles panel's logic: effects (fire, smoke, sparkles, rain...) kept in `src/particles.js` as plain JSON, one recipe for each effect:
//
//   export default { "fire": { "rate": 40, "colors": ["#ffd23c", "#ff7a3c"], "shape": "circle", "speed": [20, 60], "angle": -90, "spread": 40, "life": [0.4, 0.9], ... } };
//
// This builds and changes recipes, starts you from presets, makes a random variation for "surprise me", and reads and writes the file. Making a recipe safe is the kit's own
// `cleanRecipe`, so the panel and the game agree on what every number means.
import { cleanRecipe, recipeProblems, PARTICLE_LIMITS } from '../../../packages/arcade/src/particles.js';

export { cleanRecipe, recipeProblems, PARTICLE_LIMITS };

const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const NAME = /^[a-z][\w-]{0,31}$/i;
const L = PARTICLE_LIMITS;

/** The controls: a key, words, a range, a step and what it is (a number, a pair of numbers). */
export const FIELDS = [
  { key: 'count', label: 'How many in a burst', min: 0, max: L.count, step: 1, help: 'Used by emit(...), once.' },
  { key: 'rate', label: 'Made each second', min: 0, max: L.rate, step: 1, help: 'Used by stream(...), while it burns.' },
  { key: 'speed', label: 'Speed (pixels a second)', min: 0, max: L.speed, step: 5, pair: true, names: ['slowest', 'fastest'] },
  { key: 'angle', label: 'Direction (degrees)', min: -360, max: 360, step: 5, help: '0 is right, 90 is down, -90 is up.' },
  { key: 'spread', label: 'How wide (degrees)', min: 0, max: 360, step: 5, help: '360 goes every way.' },
  { key: 'life', label: 'Lasts (seconds)', min: 0.05, max: L.life, step: 0.05, pair: true, names: ['shortest', 'longest'] },
  { key: 'size', label: 'Size (pixels)', min: 0, max: L.size, step: 0.5, pair: true, names: ['at the start', 'at the end'] },
  { key: 'gravity', label: 'Gravity', min: -L.gravity, max: L.gravity, step: 10, help: 'Down is more than 0; below 0 floats up.' },
  { key: 'drag', label: 'Slows down', min: 0, max: L.drag, step: 0.1 },
  { key: 'radius', label: 'Starts within (pixels)', min: 0, max: L.radius, step: 1 },
];

/** Ready-made effects. `use` says how a game plays it. */
export const PRESETS = {
  fire: { rate: 60, count: 10, colors: ['#ffd23c', '#ff9f43', '#ff5a3c'], shape: 'circle', speed: [20, 70], angle: -90, spread: 36, life: [0.4,
    0.9], size: [9, 1], gravity: -80, drag: 0.5, radius: 6, fade: true, use: 'stream' },
  smoke: { rate: 14, count: 8, colors: ['#8a93a6', '#b9c1d1', '#5b6378'], shape: 'circle', speed: [10, 30], angle: -90, spread: 30, life: [1.2,
    2.2], size: [6, 22], gravity: -20, drag: 0.4, radius: 5, fade: true, use: 'stream' },
  explosion: { count: 60, rate: 0, colors: ['#ffd23c', '#ff9f43', '#e84a5f', '#f5f0e6'], shape: 'circle', speed: [60, 320], angle: 0, spread: 360,
    life: [0.3, 0.8], size: [8, 1], gravity: 120, drag: 1.5, radius: 4, fade: true, use: 'emit' },
  sparkle: { count: 14, rate: 20, colors: ['#ffffff', '#ffe98a', '#9af0b8'], shape: 'square', speed: [10, 80], angle: 0, spread: 360, life: [0.4,
    0.9], size: [4, 0], gravity: 0, drag: 1, radius: 10, fade: false, use: 'emit' },
  rain: { rate: 120, count: 20, colors: ['#5ac8ff', '#7bc4f0'], shape: 'square', speed: [380, 460], angle: 100, spread: 6, life: [0.5, 0.8],
    size: [2, 2], gravity: 200, drag: 0, radius: 200, fade: false, use: 'stream' },
  snow: { rate: 40, count: 20, colors: ['#ffffff', '#d8f2ff'], shape: 'circle', speed: [15, 40], angle: 90, spread: 50, life: [3, 5], size: [4, 3],
    gravity: 8, drag: 0.2, radius: 200, fade: true, use: 'stream' },
  confetti: { count: 70, rate: 0, colors: ['#e84a5f', '#ffd23c', '#4ade80', '#5ac8ff', '#8b8bff', '#ff8fb1'], shape: 'square', speed: [120, 420],
    angle: -90, spread: 120, life: [1, 2], size: [6, 5], gravity: 420, drag: 1.2, radius: 6, fade: true, use: 'emit' },
  dust: { count: 8, rate: 0, colors: ['#c8b79a', '#a8946e'], shape: 'circle', speed: [15, 50], angle: -90, spread: 140, life: [0.25, 0.5], size: [5,
    1], gravity: -20, drag: 3, radius: 3, fade: true, use: 'emit' },
  heal: { count: 16, rate: 24, colors: ['#4ade80', '#9af0b8', '#ffffff'], shape: 'circle', speed: [20, 70], angle: -90, spread: 70, life: [0.6,
    1.1], size: [5, 1], gravity: -50, drag: 0.8, radius: 14, fade: true, use: 'emit' },
  coin: { count: 12, rate: 0, colors: ['#ffd23c', '#fff0a0', '#d99a1e'], shape: 'square', speed: [60, 200], angle: -90, spread: 200, life: [0.3,
    0.6], size: [4, 1], gravity: 500, drag: 0.5, radius: 3, fade: true, use: 'emit' },
};

/** A blank effect: a small yellow burst. */
export function newEffect() {
  return { ...cleanRecipe({}), use: 'emit' };
}

/** The recipe of a preset, as the file holds it (whole, so what you see is what is saved). */
export function preset(name) {
  const p = clone(PRESETS[name]);
  return { ...cleanRecipe(p), use: p.use };
}

// ---------- the file ----------

/** The effects as the text of a file. */
export function serializeParticles(effects) {
  const body = Object.entries(effects).map(([name, e]) => `  ${JSON.stringify(name)}: ${JSON.stringify(e)}`).join(',\n');
  const note = '// Made with the studio\'s Particles panel. Each effect is a recipe: colors, speed, direction, how long, how big, gravity.';
  const use = '// Use them with emit(game, particles.name, x, y) or stream(game, particles.name, x, y, dt) from @engine/arcade.';
  return `${note}\n${use}\nexport default {\n${body}\n};\n`;
}

/** Read an effects file. Throws an Error that says what is wrong. */
export function parseParticles(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of effects: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This effects file has been edited into something the Particles panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The effects file should hold an object of named effects.');
  const out = {};
  for (const [name, e] of Object.entries(data)) {
    if (!NAME.test(name) || !e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`The effect "${name.slice(0, 32)}" is not usable.`);
    out[name] = { ...cleanRecipe(e), use: e.use === 'stream' ? 'stream' : 'emit' };
  }
  return out;
}

/** A name for a new effect that is not taken. */
export function freeName(taken, wanted) {
  const base = String(wanted).replace(/[^\w-]/g, '').replace(/^[^a-z]+/i, '') || 'effect';
  if (!(base in taken)) return base;
  for (let n = 2; n < 1000; n++) if (!(`${base}${n}` in taken)) return `${base}${n}`;
  return `${base}${Date.now()}`;
}

/** Why a name cannot be used, or null. */
export function nameProblem(name, taken) {
  if (!NAME.test(name)) return 'Use letters and numbers, starting with a letter';
  return taken(name) ? 'There is already an effect with that name' : null;
}

// ---------- changing an effect ----------

const keep = (e, next) => ({ ...cleanRecipe(next), use: e.use === 'stream' ? 'stream' : 'emit' });

/** One number set (kept within its limits). */
export function setValue(e, key, value) {
  return keep(e, { ...e, [key]: Number(value) });
}

/** One end of a pair set (speed, life, size). The pair stays in order only for life; speed and size may run either way (a size can shrink). */
export function setPair(e, key, index, value) {
  const pair = [...e[key]];
  pair[index] = Number(value);
  if (key === 'life' || key === 'speed') {
    if (index === 0 && pair[0] > pair[1]) pair[1] = pair[0];
    if (index === 1 && pair[1] < pair[0]) pair[0] = pair[1];
  }
  return keep(e, { ...e, [key]: pair });
}

/** The shape of the particles. */
export function setShape(e, shape) {
  return keep(e, { ...e, shape });
}

/** Whether particles fade out as they age. */
export function setFade(e, fade) {
  return keep(e, { ...e, fade: Boolean(fade) });
}

/** How a game plays this effect (a note for the panel and the help text: once, or all the time). */
export function setUse(e, use) {
  return { ...clone(e), use: use === 'stream' ? 'stream' : 'emit' };
}

/** A color added (up to six). */
export function addColor(e, color = '#ffffff') {
  return keep(e, { ...e, colors: [...e.colors, color] });
}

/** A color changed. */
export function setColor(e, index, color) {
  return keep(e, { ...e, colors: e.colors.map((c, i) => (i === index ? color : c)) });
}

/** A color taken away (one stays). */
export function removeColor(e, index) {
  if (e.colors.length <= 1) return e;
  return keep(e, { ...e, colors: e.colors.filter((_, i) => i !== index) });
}

/** A small random generator, so "surprise me" with the same number gives the same effect. */
function lcg(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** A random variation of an effect: every number moves by up to `amount` (0 to 1) of its range, colors keep their number and shift a little. */
export function mutate(e, seed, amount = 0.3) {
  const r = lcg(seed);
  const out = clone(e);
  for (const f of FIELDS) {
    const span = (f.max - f.min) * amount * 0.25;
    const wiggle = (v) => clamp(v + (r() - 0.5) * 2 * span, f.min, f.max);
    if (f.pair) out[f.key] = e[f.key].map(wiggle);
    else out[f.key] = f.key === 'angle' || f.key === 'spread' || f.key === 'gravity' ? wiggle(e[f.key]) : wiggle(e[f.key]);
  }
  out.life = [Math.min(out.life[0], out.life[1]), Math.max(out.life[0], out.life[1])];
  out.speed = [Math.min(out.speed[0], out.speed[1]), Math.max(out.speed[0], out.speed[1])];
  out.colors = e.colors.map((c) => shift(c, r, amount));
  for (const f of FIELDS) if (!f.pair) out[f.key] = Math.round(out[f.key] / f.step) * f.step;
  return keep(e, out);
}

/** A color moved a little in each of red, green and blue. */
function shift(color, r, amount) {
  const hex = /^#([0-9a-f]{3})$/i.test(color) ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return color;
  const parts = [1, 3, 5].map((i) => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) + (r() - 0.5) * 2 * 255 * amount * 0.4), 0, 255));
  return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
}
