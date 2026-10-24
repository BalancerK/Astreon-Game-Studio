// A project's own settings: its title, the size of the game's screen, its background colour and the letter and colour of its icon. They live in a plain text
// file, `project.json`, so they are part of the project (they travel in a zip, show in git, can be edited by hand). A missing or damaged file means the usual
// defaults, never an error: a game always starts. Pure functions, tested in Node.

export const FILE = 'project.json';
export const LIMITS = { min: 120, max: 1920, title: 60 };

export const DEFAULTS = Object.freeze({
  title: '',
  width: 480,
  height: 320,
  background: '#12161f',
  icon: Object.freeze({ letter: '', color: '#4f46e5' }),
});

/** Sizes people ask for. */
export const PRESETS = [
  { id: 'classic', label: 'Classic (480 × 320)', width: 480, height: 320 },
  { id: 'wide', label: 'Wide screen (640 × 360)', width: 640, height: 360 },
  { id: 'large', label: 'Large wide screen (960 × 540)', width: 960, height: 540 },
  { id: 'portrait', label: 'Phone upright (360 × 640)', width: 360, height: 640 },
  { id: 'square', label: 'Square (400 × 400)', width: 400, height: 400 },
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const size = (v, fallback) => (Number.isFinite(v) ? Math.max(LIMITS.min, Math.min(LIMITS.max, Math.round(v))) : fallback);

/**
 * Make anything that was read from a file into settings that are safe to use.
 * @param {unknown} raw
 * @returns {{settings: typeof DEFAULTS, problems: string[]}}
 */
export function cleanSettings(raw) {
  const problems = [];
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw !== undefined && r !== raw) problems.push('project.json should be an object in curly braces.');
  const pick = (key, ok, fallback, why) => {
    if (r[key] === undefined) return fallback;
    if (ok(r[key])) return r[key];
    problems.push(why);
    return fallback;
  };
  const rawTitle = pick('title', (v) => typeof v === 'string', DEFAULTS.title, 'title must be text.');
  const title = rawTitle.replace(/[\r\n]+/g, ' ').trim().slice(0, LIMITS.title);
  const width = pick('width', Number.isFinite, DEFAULTS.width, 'width must be a number.');
  const height = pick('height', Number.isFinite, DEFAULTS.height, 'height must be a number.');
  const outside = (v) => Number.isFinite(v) && (v < LIMITS.min || v > LIMITS.max);
  if (outside(width) || outside(height)) problems.push(`The screen size is kept between ${LIMITS.min} and ${LIMITS.max}.`);
  const colourOk = (v) => typeof v === 'string' && HEX.test(v);
  const background = pick('background', colourOk, DEFAULTS.background, 'background must be a colour like #12161f.');
  const icon = r.icon && typeof r.icon === 'object' ? r.icon : {};
  const letter = typeof icon.letter === 'string' ? [...icon.letter.trim()][0] ?? '' : '';
  const color = typeof icon.color === 'string' && HEX.test(icon.color) ? icon.color : DEFAULTS.icon.color;
  const settings = { title, width: size(width, DEFAULTS.width), height: size(height, DEFAULTS.height), background, icon: { letter, color } };
  return { settings, problems };
}

/** Read the settings out of a project's files. */
export function settingsOf(files) {
  const text = files?.[FILE];
  if (typeof text !== 'string' || !text.trim()) return { settings: cleanSettings(undefined).settings, problems: [] };
  try {
    return cleanSettings(JSON.parse(text));
  } catch {
    return { settings: cleanSettings(undefined).settings, problems: ['project.json is not valid JSON, so the usual settings are used.'] };
  }
}

/** The file's text for some settings (only what differs from the usual, so a project that changes nothing has no file). */
export function serialize(settings) {
  const { settings: s } = cleanSettings(settings);
  const out = {};
  if (s.title) out.title = s.title;
  if (s.width !== DEFAULTS.width) out.width = s.width;
  if (s.height !== DEFAULTS.height) out.height = s.height;
  if (s.background !== DEFAULTS.background) out.background = s.background;
  if (s.icon.letter || s.icon.color !== DEFAULTS.icon.color) out.icon = { letter: s.icon.letter, color: s.icon.color };
  return Object.keys(out).length ? `${JSON.stringify(out, null, 2)}\n` : null;
}

/** The ratio of a screen as a short name ("3:2", "16:9"), or the plain numbers when it is not a usual one. */
export function aspectName(width, height) {
  const g = (a, b) => (b ? g(b, a % b) : a);
  const d = g(width, height);
  const w = width / d;
  const h = height / d;
  return w <= 21 && h <= 21 ? `${w}:${h}` : `${(width / height).toFixed(2)}:1`;
}
