// What a game loads: every file of the project, how big it is, what kind of thing it is (code, a sprite, sounds, music, words, a picture, a sound file...), whether the game
// reaches it (starting from src/main.js and following imports, and any file name written in the code as text), and who asks for it. Files nothing reaches are listed as
// unused, so they can be removed before the game is shipped. Pure functions, tested in Node.
import { resolveRelative } from '../../export/bundle.js';

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
const STRING = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** What kind of thing a file is, by where it lives and what it is called. */
export function kindOf(path) {
  if (/^src\/art\/[^/]+\.js$/.test(path)) return 'sprite';
  if (path === 'src/sounds.js') return 'sounds';
  if (path === 'src/music.js') return 'music';
  if (path === 'src/text.js') return 'words';
  if (path === 'src/states.js') return 'states';
  if (path === 'src/clips.js') return 'clips';
  if (path === 'src/particles.js') return 'particles';
  if (path === 'src/behaviors.js') return 'behaviors';
  if (path === 'src/ui.js') return 'ui';
  if (path === 'project.json' || path === 'build.json') return 'settings';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image';
  if (/\.(mp3|ogg|wav|m4a|flac)$/i.test(path)) return 'sound file';
  if (/\.js$/.test(path)) return /(^|\/)(tests?\/|[^/]*\.test\.js$)/.test(path) ? 'test' : /\.plugin\.js$/.test(path) ? 'plugin' : 'code';
  if (/\.(json|md|txt|csv)$/.test(path)) return 'data';
  return 'other';
}

/** The relative files a piece of code imports, and the project file names it writes as text, found without running anything. */
export function referencesIn(path, text, known) {
  const imports = new Set();
  const named = new Set();
  for (const m of text.matchAll(IMPORT)) {
    const target = resolveRelative(path, m[2]);
    for (const candidate of [target, `${target}.js`, `${target}/index.js`]) if (known.has(candidate)) { imports.add(candidate); break; }
  }
  for (const m of text.matchAll(STRING)) {
    const value = m[2].trim();
    if (!value || value.length > 120) continue;
    const relative = /^\.{1,2}\//.test(value) ? resolveRelative(path, value) : null;
    const direct = known.has(value) ? value : relative && known.has(relative) ? relative : null;
    if (direct && !imports.has(direct)) named.add(direct);
    else if (!direct && known.has(`assets/${value}`)) named.add(`assets/${value}`);
  }
  return { imports: [...imports], named: [...named] };
}

/**
 * Look over a project.
 * @param {Record<string, string>} files the project's text files
 * @param {{path: string, bytes: number}[]} [assets] the pictures and sound files (their sizes)
 * @param {string} [entry] where the game starts
 * @returns {{entries: {path: string, kind: string, bytes: number, used: boolean, usedBy: string[]}[], total: number, usedBytes: number, unusedBytes: number, missing: {from: string, path: string}[]}}
 */
export function analyzeResources(files, assets = [], entry = 'src/main.js') {
  const sizes = new Map();
  const enc = new TextEncoder();
  for (const [path, text] of Object.entries(files)) if (typeof text === 'string') sizes.set(path, enc.encode(text).length);
  for (const a of assets) sizes.set(a.path, a.bytes);
  const known = new Set(sizes.keys());
  const usedBy = new Map([...known].map((p) => [p, new Set()]));
  const reached = new Set();
  const missing = [];
  const queue = known.has(entry) ? [entry] : [];
  if (queue.length) reached.add(entry);
  while (queue.length) {
    const path = queue.shift();
    const text = files[path];
    if (typeof text !== 'string' || !/\.js$/.test(path)) continue;
    const { imports, named } = referencesIn(path, text, known);
    for (const target of [...imports, ...named]) {
      usedBy.get(target)?.add(path);
      if (!reached.has(target)) { reached.add(target); queue.push(target); }
    }
    for (const m of text.matchAll(IMPORT)) {
      const target = resolveRelative(path, m[2]);
      if (![target, `${target}.js`, `${target}/index.js`].some((c) => known.has(c))) missing.push({ from: path, path: m[2] });
    }
  }
  const settings = (p) => p === 'project.json' || p === 'build.json';
  const entries = [...known].sort().map((path) => ({
    path, kind: kindOf(path), bytes: sizes.get(path), used: reached.has(path) || settings(path), usedBy: [...usedBy.get(path)].sort(),
  }));
  const sum = (list) => list.reduce((n, e) => n + e.bytes, 0);
  return { entries, total: sum(entries), usedBytes: sum(entries.filter((e) => e.used)), unusedBytes: sum(entries.filter((e) => !e.used)), missing };
}

/** The entries grouped by kind, biggest group first, each with its size. */
export function byKind(entries) {
  const groups = new Map();
  for (const e of entries) {
    const g = groups.get(e.kind) ?? { kind: e.kind, entries: [], bytes: 0 };
    g.entries.push(e);
    g.bytes += e.bytes;
    groups.set(e.kind, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

/** A size in plain words. */
export const sizeWords = (n) => (n < 1000 ? `${n} B` : n < 1_000_000 ? `${Math.round(n / 100) / 10} KB` : `${Math.round(n / 100_000) / 10} MB`);
