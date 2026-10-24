// Build profiles: named ways of making the game for players. "Release" leaves out the tests and notes and turns the debug switch off; "Debug" keeps everything and turns it on;
// you can make others ("itch page", "phone", "demo with two levels"). A profile says what the page is called, whether it can be installed and used offline, whether the
// game is told it is a debug build (the kit's `build().debug`), and which files to leave out. They live in `build.json` in the project, so they travel with it. Pure
// functions, tested in Node.
import { resolveRelative } from './bundle.js';

export const FILE = 'build.json';
export const LIMITS = { profiles: 12, exclude: 40, pattern: 120, title: 60 };
export const NAME = /^[a-z][\w-]{0,23}$/i;

/** What every build leaves out whatever the profile says: the profiles file itself. */
export const ALWAYS_EXCLUDED = [FILE];

export const DEFAULT_PROFILES = Object.freeze({
  release: Object.freeze({ title: '', offline: true, debug: false, exclude: Object.freeze(['tests/**', '**/*.test.js', '**/*.plugin.js']) }),
  debug: Object.freeze({ title: '', offline: false, debug: true, exclude: Object.freeze([]) }),
});

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Make a profile safe: short title, flags that are true or false, up to 40 patterns of plain characters. */
export function cleanProfile(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const exclude = (Array.isArray(r.exclude) ? r.exclude : []).filter((p) => typeof p === 'string').map((p) => p.trim().replace(/^\.?\//, ''))
    .filter((p) => p && p.length <= LIMITS.pattern && !p.includes('..')).slice(0, LIMITS.exclude);
  return {
    title: typeof r.title === 'string' ? r.title.replace(/[\r\n]+/g, ' ').trim().slice(0, LIMITS.title) : '',
    offline: r.offline === undefined ? true : Boolean(r.offline),
    debug: Boolean(r.debug),
    exclude: [...new Set(exclude)],
  };
}

/**
 * Make anything read from a file into profiles that are safe to use.
 * @param {unknown} raw
 * @returns {{selected: string, profiles: Record<string, ReturnType<typeof cleanProfile>>, problems: string[]}}
 */
export function cleanBuild(raw) {
  const problems = [];
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw !== undefined && r !== raw) problems.push('build.json should be an object in curly braces.');
  const profiles = {};
  for (const [name, spec] of Object.entries(r.profiles && typeof r.profiles === 'object' ? r.profiles : {})) {
    if (!NAME.test(name)) { problems.push(`"${name.slice(0, 24)}" is not a usable profile name (letters and numbers, up to 24).`); continue; }
    if (Object.keys(profiles).length >= LIMITS.profiles) { problems.push(`At most ${LIMITS.profiles} profiles.`); break; }
    profiles[name] = cleanProfile(spec);
  }
  if (!Object.keys(profiles).length) for (const [name, spec] of Object.entries(DEFAULT_PROFILES)) profiles[name] = cleanProfile(spec);
  const selected = typeof r.selected === 'string' && r.selected in profiles ? r.selected : Object.keys(profiles)[0];
  return { selected, profiles, problems };
}

/** Read the profiles out of a project's files (a missing or damaged file means the two usual profiles, never an error). */
export function buildOf(files) {
  const text = files?.[FILE];
  if (typeof text !== 'string' || !text.trim()) return cleanBuild(undefined);
  try {
    return cleanBuild(JSON.parse(text));
  } catch {
    return { ...cleanBuild(undefined), problems: ['build.json is not valid JSON, so the usual profiles are used.'] };
  }
}

/** The text of the file for some profiles (null when they are exactly the usual ones, so a project that changes nothing has no file). */
export function serializeBuild({ selected, profiles }) {
  const clean = cleanBuild({ selected, profiles });
  const usual = JSON.stringify(cleanBuild(undefined).profiles) === JSON.stringify(clean.profiles) && clean.selected === 'release';
  return usual ? null : `${JSON.stringify({ selected: clean.selected, profiles: clean.profiles }, null, 2)}\n`;
}

/** A pattern as a regular expression: `*` is any run of letters inside a folder, `**` goes through folders, `?` is one letter. */
export function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Whether a profile leaves a file out (a pattern for a folder, `docs`, leaves out everything in it). */
export function isExcluded(path, patterns) {
  if (ALWAYS_EXCLUDED.includes(path)) return true;
  return patterns.some((p) => globToRegExp(p).test(path) || globToRegExp(`${p.replace(/\/$/, '')}/**`).test(path));
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

/**
 * Apply a profile to a project: the files and assets it keeps, what it leaves out (with sizes), and any file it keeps that imports a file it left out (that build would fail).
 * @param {Record<string, string>} files the project's text files
 * @param {{path: string, bytes?: Uint8Array}[]} assets
 * @param {ReturnType<typeof cleanProfile>} profile
 */
export function applyProfile(files, assets, profile) {
  const kept = {};
  const left = [];
  const enc = new TextEncoder();
  for (const [path, text] of Object.entries(files)) {
    if (isExcluded(path, profile.exclude)) left.push({ path, bytes: enc.encode(String(text)).length });
    else kept[path] = text;
  }
  const keptAssets = [];
  for (const a of assets) {
    if (isExcluded(a.path, profile.exclude)) left.push({ path: a.path, bytes: a.bytes?.length ?? 0 });
    else keptAssets.push(a);
  }
  const gone = new Set(left.map((l) => l.path));
  const problems = [];
  for (const [path, text] of Object.entries(kept)) {
    if (!/\.js$/.test(path)) continue;
    for (const m of text.matchAll(IMPORT)) {
      const target = resolveRelative(path, m[2]);
      const hit = [target, `${target}.js`, `${target}/index.js`].find((c) => gone.has(c));
      if (hit) problems.push({ from: path, path: hit });
    }
  }
  return { files: kept, assets: keptAssets, left, problems };
}

// ---------- changing profiles ----------

/** Why a profile name cannot be used, or null. */
export function nameProblem(build, name) {
  if (!NAME.test(name)) return 'Use letters and numbers, starting with a letter (up to 24)';
  if (name in build.profiles) return 'There is already a profile with that name';
  if (Object.keys(build.profiles).length >= LIMITS.profiles) return `At most ${LIMITS.profiles} profiles`;
  return null;
}

/** A profile added, as a copy of another (or of release). */
export function addProfile(build, name, from = 'release') {
  const out = clone(build);
  out.profiles[name] = clone(build.profiles[from] ?? DEFAULT_PROFILES.release);
  out.selected = name;
  return out;
}

/** A profile taken away (one stays). */
export function removeProfile(build, name) {
  if (Object.keys(build.profiles).length <= 1) throw new Error('A project keeps at least one build profile.');
  const out = clone(build);
  delete out.profiles[name];
  if (out.selected === name) out.selected = Object.keys(out.profiles)[0];
  return out;
}

/** Settings of a profile changed (kept safe). */
export function updateProfile(build, name, patch) {
  const out = clone(build);
  out.profiles[name] = cleanProfile({ ...out.profiles[name], ...patch });
  return out;
}

/** The profile chosen for exporting and measuring. */
export function selectProfile(build, name) {
  return name in build.profiles ? { ...clone(build), selected: name } : build;
}

/** The note a build tells the game: its profile name and whether it is a debug build (what `build()` in the kit answers). */
export const buildNote = (name, profile) => ({ name, debug: Boolean(profile.debug) });
