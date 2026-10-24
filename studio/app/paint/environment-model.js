// The Environment panel's logic: the sky (time of day, haze, clouds, stars), the water (level, colours, waves) and the ground (hills) of a 3D place, kept in `environment.json` as
// plain text so it travels with the project. The numbers here are only a description; the panel's preview draws them with the engine's renderer, and a game made with the engine reads
// the same file and gives the same numbers to `createSky`, `createWaterStyle` and a height map. No engine code is needed to read, change or check the file, so it all runs in Node tests.

export const FILE = 'environment.json';

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

/** Every setting, with what it is when the file says nothing. */
export const DEFAULTS = Object.freeze({
  sky: Object.freeze({ hour: 15, turbidity: 3, clouds: 0.35, stars: true, exposure: 1.5 }),
  water: Object.freeze({ on: true, level: 0, shallow: '#1a8c80', deep: '#00194d', clarity: 6, opacity: 0.95, waves: 0.4 }),
  terrain: Object.freeze({ hills: 8, roughness: 0.5, seed: 7, color: '#8a7a55' }),
});

/** The range of each number, with the words the panel shows for it. */
export const FIELDS = {
  sky: [
    { key: 'hour', label: 'Time of day', min: 0, max: 24, step: 0.1, help: '0 is midnight, 12 is noon' },
    { key: 'turbidity', label: 'Haze', min: 1, max: 12, step: 0.1, help: 'Clear mountain air at 1, thick dusty air at 12' },
    { key: 'clouds', label: 'Clouds', min: 0, max: 1, step: 0.05, help: '0 is a clear sky' },
    { key: 'exposure', label: 'Brightness', min: 0.5, max: 3, step: 0.05, help: 'How bright the sky is drawn' },
  ],
  water: [
    { key: 'level', label: 'Water level', min: -10, max: 10, step: 0.25, help: 'How high the water stands, in metres' },
    { key: 'clarity', label: 'Clearness', min: 0.5, max: 30, step: 0.5, help: 'How far down you can see' },
    { key: 'opacity', label: 'Opacity', min: 0.2, max: 1, step: 0.02, help: 'How much of the bottom is hidden' },
    { key: 'waves', label: 'Waves', min: 0, max: 1.5, step: 0.05, help: '0 is a still pond' },
  ],
  terrain: [
    { key: 'hills', label: 'Hill height', min: 0, max: 24, step: 0.5, help: 'How tall the hills are, in metres' },
    { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.05, help: 'Smooth rolling land at 0, jagged at 1' },
    { key: 'seed', label: 'Land number', min: 0, max: 999, step: 1, help: 'A different number is a different piece of land' },
  ],
};

const COLOURS = { water: ['shallow', 'deep'], terrain: ['color'] };

/** A set of ready-made places to start from. */
export const STARTERS = {
  day: () => clean({}),
  sunset: () => clean({ sky: { hour: 18.6, turbidity: 5, clouds: 0.5 }, water: { shallow: '#2a7f8c', deep: '#0a2050' } }),
  night: () => clean({ sky: { hour: 1, clouds: 0.15, stars: true, exposure: 1.8 }, water: { waves: 0.25 } }),
  storm: () => clean({ sky: { hour: 14, turbidity: 9, clouds: 1, exposure: 1.1 }, water: { waves: 1.2, clarity: 2, opacity: 1 } }),
  desert: () => clean({ sky: { hour: 12, turbidity: 6, clouds: 0 }, water: { on: false }, terrain: { hills: 12, roughness: 0.3, color: '#c9a566' } }),
};

function section(name, raw, problems) {
  const out = { ...DEFAULTS[name] };
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw !== undefined && r !== raw) problems.push(`"${name}" should be an object in curly braces.`);
  for (const [key, def] of Object.entries(DEFAULTS[name])) {
    if (r[key] === undefined) continue;
    const spec = FIELDS[name].find((f) => f.key === key);
    if (typeof def === 'boolean') {
      if (typeof r[key] === 'boolean') out[key] = r[key]; else problems.push(`${name}.${key} must be true or false.`);
    } else if (COLOURS[name]?.includes(key)) {
      if (typeof r[key] === 'string' && HEX.test(r[key])) out[key] = r[key].toLowerCase();
      else problems.push(`${name}.${key} must be a colour like #1a8c80.`);
    } else if (Number.isFinite(r[key])) out[key] = clamp(r[key], spec.min, spec.max);
    else problems.push(`${name}.${key} must be a number.`);
  }
  if (name === 'terrain') out.seed = Math.round(out.seed);
  return out;
}

function clean(raw, problems = []) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw !== undefined && r !== raw) problems.push('environment.json should be an object in curly braces.');
  return { sky: section('sky', r.sky, problems), water: section('water', r.water, problems), terrain: section('terrain', r.terrain, problems) };
}

/**
 * Make anything read from a file into an environment that is safe to use.
 * @param {unknown} raw
 * @returns {{world: typeof DEFAULTS, problems: string[]}}
 */
export function cleanWorld(raw) {
  const problems = [];
  const world = clean(raw, problems);
  return { world, problems };
}

/**
 * Change some settings of one part (`'sky'`, `'water'` or `'terrain'`).
 * @param {object} world @param {'sky' | 'water' | 'terrain'} part @param {object} props @returns {object} a new environment
 */
export function setWorld(world, part, props) {
  if (!DEFAULTS[part]) throw new Error(`"${part}" is not a part of the environment (sky, water or terrain).`);
  const problems = [];
  const next = clean({ ...world, [part]: { ...world[part], ...props } }, problems);
  if (problems.length) throw new Error(problems[0]);
  return next;
}

/** The environment as the text of a file. */
export function serializeWorld(world) {
  return `${JSON.stringify(clean(world), null, 2)}\n`;
}

/** Read an environment from a file's text; a missing or damaged file gives the usual one and says what was wrong. */
export function parseWorld(text) {
  if (typeof text !== 'string' || !text.trim()) return { world: clean({}), problems: [] };
  try {
    return cleanWorld(JSON.parse(text));
  } catch {
    return { world: clean({}), problems: ['environment.json is not valid JSON, so the usual one is used.'] };
  }
}

// ---------- the ground ----------

const hash = (x, z, seed) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
function noise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = smooth(x - x0), fz = smooth(z - z0);
  const a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed), c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * fx;
  return top + (c + (d - c) * fx - top) * fz;
}

/**
 * How high the ground is at a place, in metres. The land is 64 metres across (0 to 64) and slopes down to the edge so the water can show; the same place always gives the same height.
 * @param {{hills: number, roughness: number, seed: number}} terrain
 * @param {number} x @param {number} z
 * @returns {number}
 */
export function groundHeight(terrain, x, z) {
  let sum = 0, amp = 1, freq = 1 / 24, total = 0;
  for (let octave = 0; octave < 4; octave++) {
    sum += noise(x * freq, z * freq, terrain.seed + octave * 31) * amp;
    total += amp;
    amp *= 0.35 + terrain.roughness * 0.35;
    freq *= 2;
  }
  const edge = Math.min(1, Math.hypot(x - 32, z - 32) / 32);                    // 0 in the middle, 1 at the rim
  const island = 1 - edge * edge;
  return (sum / total - 0.35) * terrain.hills * 2 * (0.25 + 0.75 * island) - 3 * edge * edge * edge;
}

/** `#rrggbb` as three numbers from 0 to 1. @param {string} hex @returns {number[]} */
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** What the environment says about its sky, in the terms `createSky` and `sunDirection` use. @param {object} world */
export function skySetup(world) {
  const s = world.sky;
  return { hour: s.hour, turbidity: s.turbidity, exposure: s.exposure, stars: s.stars, clouds: s.clouds > 0 ? { coverage: s.clouds } : false };
}

/** What the environment says about its water, in the terms `createWaterStyle` uses, or null when there is no water. @param {object} world */
export function waterSetup(world) {
  const w = world.water;
  if (!w.on) return null;
  return { level: w.level, shallow: rgb(w.shallow), deep: rgb(w.deep), clarity: w.clarity, opacity: w.opacity, waves: w.waves };
}

/** One sentence that says what the environment is like (for the panel's help text). @param {object} world @returns {string} */
export function describeWorld(world) {
  const t = world.sky.hour;
  const when = t < 5 || t >= 21 ? 'night' : t < 8 ? 'early morning' : t < 17 ? 'day' : t < 20 ? 'evening' : 'dusk';
  const clouds = world.sky.clouds > 0.6 ? 'heavy' : world.sky.clouds > 0 ? 'some' : 'no';
  const sea = world.water.on ? `water ${world.water.level} m up` : 'no water';
  return `A ${when} sky with ${clouds} clouds, ${sea}, and hills up to ${world.terrain.hills} m.`;
}
