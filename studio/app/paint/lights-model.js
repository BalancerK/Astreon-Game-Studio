// The Lights panel's logic: how dark the screen is, a tint and a vignette over it, and the lights that cut through the dark, kept in `src/lights.js` as plain JSON:
//
//   export default { "screen": { "darkness": 0.7, "ambient": "#0a0e24" }, "lights": [{ "name": "torches", "follow": "torch", "radius": 110, "color": "#ffb347", "flicker": 0.5 }] };
//
// This builds and changes the set, holds every number to the range the kit draws well, and reads and writes the file. Judging a set is the kit's own `lightProblems`, so the
// panel and the game agree.
import { lightProblems, LIGHT_LIMITS, SCREEN_DEFAULTS } from '../../../packages/arcade/src/lights.js';

export { lightProblems, LIGHT_LIMITS, SCREEN_DEFAULTS };

const clone = (x) => JSON.parse(JSON.stringify(x));
const COLOR = /^#[0-9a-f]{6}$/i;
const NAMES = /^[\w -]{1,32}$/;
const KIND = /^[a-z][\w-]{0,31}$/i;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

/** The sorts of light that can be added, each as it starts. */
export const LIGHT_SORTS = {
  torch: { label: 'Torches: one on every thing of a kind', light: { follow: 'torch', radius: 110, color: '#ffb347', intensity: 1, flicker: 0.5 } },
  glow: { label: 'A glow round the hero', light: { follow: 'hero', radius: 90, color: '#ffffff', intensity: 0.9, flicker: 0 } },
  lamp: { label: 'A lamp at a place in the world', light: { x: 240, y: 120, radius: 130, color: '#ffe6a8', intensity: 1, flicker: 0.1 } },
  moon: { label: 'A big cold light', light: { x: 100, y: 60, radius: 260, color: '#7fa8ff', intensity: 0.6, flicker: 0 } },
};

/** Ready-made sets to start from. */
export const STARTERS = {
  night: () => ({ screen: { ...SCREEN_DEFAULTS, darkness: 0.7, ambient: '#0a0e2a', vignette: 0.3 }, lights: [
    { name: 'hero glow', ...clone(LIGHT_SORTS.glow.light) }, { name: 'torches', ...clone(LIGHT_SORTS.torch.light) },
  ] }),
  cave: () => ({ screen: { ...SCREEN_DEFAULTS, darkness: 0.9, ambient: '#050508', vignette: 0.5 }, lights: [
    { name: 'hero glow', ...clone(LIGHT_SORTS.glow.light), radius: 110, color: '#ffd9a0' },
  ] }),
  sunset: () => ({ screen: { ...SCREEN_DEFAULTS, darkness: 0, tint: '#ff8a3c', tintAlpha: 0.18, vignette: 0.35 }, lights: [] }),
};

/** A new set: a gentle night. */
export function newLights() {
  return STARTERS.night();
}

/** A name not used by another light: "torches", then "torches 2". */
export function freeName(lights, base) {
  const taken = new Set(lights.map((l) => l.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

// ---------- changing it ----------

/** Add a light of a sort. Returns the new set and the place of the new light. */
export function addLight(file, sort) {
  if (!LIGHT_SORTS[sort]) throw new Error(`There is no sort of light called "${sort}".`);
  if (file.lights.length >= LIGHT_LIMITS.lights) throw new Error(`A set can have up to ${LIGHT_LIMITS.lights} lights.`);
  const next = clone(file);
  next.lights.push({ name: freeName(next.lights, sort), ...clone(LIGHT_SORTS[sort].light) });
  return { file: next, index: next.lights.length - 1 };
}

/** Take a light out. */
export function removeLight(file, index) {
  const next = clone(file);
  next.lights.splice(index, 1);
  return next;
}

/** A copy of a light, right after it. */
export function duplicateLight(file, index) {
  if (file.lights.length >= LIGHT_LIMITS.lights) throw new Error(`A set can have up to ${LIGHT_LIMITS.lights} lights.`);
  const next = clone(file);
  const copy = clone(next.lights[index]);
  copy.name = freeName(next.lights, copy.name);
  next.lights.splice(index + 1, 0, copy);
  return { file: next, index: index + 1 };
}

/** Change fields of a light, held to what draws well. */
export function setLight(file, index, props) {
  const next = clone(file);
  const light = next.lights[index];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'name') {
      if (!NAMES.test(String(value))) throw new Error('A light name is 1 to 32 letters, numbers, spaces, dashes or underscores.');
      if (next.lights.some((l, i) => i !== index && l.name === value)) throw new Error(`There is already a light called "${value}".`);
      light.name = String(value);
    } else if (key === 'color') {
      if (!COLOR.test(String(value))) throw new Error('A colour looks like #ffd27a.');
      light.color = String(value).toLowerCase();
    } else if (key === 'follow') {
      if (value === '' || value === null) delete light.follow;
      else if (KIND.test(String(value))) light.follow = String(value);
      else throw new Error('A kind of thing is a name: letters, numbers, dashes and underscores.');
      if (!light.follow) { light.x ??= 240; light.y ??= 120; }
    } else if (key === 'radius') light.radius = clamp(value, 4, LIGHT_LIMITS.radius);
    else if (key === 'intensity') light.intensity = clamp(value, 0, 1);
    else if (key === 'flicker') light.flicker = clamp(value, 0, 1);
    else if (key === 'core') light.core = clamp(value, 0, 0.9);
    else if (key === 'shadows') { if (value) delete light.shadows; else light.shadows = false; }
    else if (key === 'x' || key === 'y' || key === 'dx' || key === 'dy') light[key] = clamp(value, -5000, 5000);
    else if (key === 'seed') light.seed = clamp(value, 0, 9999) | 0;
    else if (key === 'hidden') light.hidden = !!value;
    else throw new Error(`"${key}" is not something a light has.`);
  }
  return next;
}

/** Change the screen's darkness, tint and vignette. */
export function setScreen(file, props) {
  const next = clone(file);
  next.screen = { ...SCREEN_DEFAULTS, ...next.screen };
  for (const [key, value] of Object.entries(props)) {
    if (key === 'ambient' || key === 'tint') {
      if (key === 'tint' && value === '') next.screen.tint = '';
      else if (!COLOR.test(String(value))) throw new Error('A colour looks like #0a0e24.');
      else next.screen[key] = String(value).toLowerCase();
    } else if (key === 'occluders') {
      const kinds = (Array.isArray(value) ? value : String(value).split(/[\s,]+/)).filter(Boolean);
      if (kinds.some((k) => !KIND.test(String(k)))) throw new Error('A kind of thing is a name: letters, numbers, dashes and underscores.');
      next.screen.occluders = [...new Set(kinds.map(String))].slice(0, 16);
    } else if (key === 'darkness' || key === 'tintAlpha' || key === 'vignette') next.screen[key] = clamp(value, 0, 1);
    else throw new Error(`"${key}" is not a screen setting.`);
  }
  return next;
}

// ---------- the file ----------

/** The set as the text of a file. */
export function serializeLights(file) {
  const fx = JSON.stringify({ ...SCREEN_DEFAULTS, ...file.screen });
  const body = file.lights.map((l) => `    ${JSON.stringify(l)}`).join(',\n');
  return `// Made with the studio's Lights panel: how dark the screen is, a tint and a vignette, and the lights that cut through the dark.\n`
    + `// Use it with drawLights(g, game, lights) from @engine/arcade, after drawThings.\n`
    + `export default {\n  "screen": ${fx},\n  "lights": [\n${body}\n  ]\n};\n`;
}

/** Read a lights file. Throws an Error that says what is wrong. */
export function parseLights(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a set of lights: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This lights file has been edited into something the Lights panel cannot read. '
      + 'Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.lights)) {
    throw new Error('The lights file should hold "screen" and a list of "lights".');
  }
  const lights = data.lights.slice(0, LIGHT_LIMITS.lights).filter((l) => l && typeof l === 'object' && l.radius > 0);
  const seen = new Set();
  lights.forEach((l, i) => {
    let name = NAMES.test(String(l.name)) ? String(l.name) : `light ${i + 1}`;
    while (seen.has(name)) name += ' 2';
    seen.add(l.name = name.slice(0, 32));
  });
  const screen = { ...SCREEN_DEFAULTS };
  for (const key of ['darkness', 'tintAlpha', 'vignette']) if (Number.isFinite(data.screen?.[key])) screen[key] = clamp(data.screen[key], 0, 1);
  if (Array.isArray(data.screen?.occluders)) screen.occluders = data.screen.occluders.filter((k) => KIND.test(String(k))).map(String).slice(0, 16);
  for (const key of ['ambient',
    'tint']) if (typeof data.screen?.[key] === 'string' && (COLOR.test(data.screen[key]) || (key === 'tint' && data.screen[key] === ''))) {
    screen[key] = data.screen[key];
  }
  return { screen, lights };
}

/** The kinds of thing the lights follow, as names (so the panel can say which kinds a game needs to have). */
export function followed(file) {
  return [...new Set(file.lights.filter((l) => l.follow).map((l) => l.follow))];
}
