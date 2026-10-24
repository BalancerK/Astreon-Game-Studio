// Suggestions while you type, built from what the editor knows: the engine's own API (from the generated index), the names the file imports, the names it
// declares, and the members of the thing before a dot. Choosing an engine name that is not imported yet adds its import line too. Pure functions on
// text and the API index, so they are tested in Node; the page only draws the list.
import { fuzzyMatch } from '../util/fuzzy.js';
import { lineStart } from './ops.js';

/**
 * @typedef {Object} Item
 * @property {string} label the name
 * @property {string} kind function, class, constant, method, property, variable, module
 * @property {string} detail a short signature or origin
 * @property {string} doc one sentence about it
 * @property {string} source file, imported, engine or member (where it came from)
 * @property {string} [pkg] the engine package, when it has one
 * @property {number} score how well it matches what was typed
 */

const ID = /[A-Za-z_$][\w$]*/g;
const DECLARED = /\b(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
const IMPORT_LINE = /import\s*\{([^}]*)\}\s*from\s*(['"])(@engine\/[\w-]+)\2\s*;?/g;
export const MAX_ITEMS = 12;

/** Index lookup tables, built once per index: name -> [{pkg, entry}]. */
const tables = new WeakMap();
function tableOf(api) {
  let t = tables.get(api);
  if (!t) {
    t = { byName: new Map(), all: [] };
    for (const [pkg, p] of Object.entries(api.packages)) {
      for (const entry of p.exports) {
        const row = { pkg, entry };
        t.all.push(row);
        if (!t.byName.has(entry.n)) t.byName.set(entry.n, []);
        t.byName.get(entry.n).push(row);
      }
    }
    tables.set(api, t);
  }
  return t;
}

/** The names a file imports from the engine: local name -> { pkg, name }. */
export function importedNames(text) {
  const out = new Map();
  for (const m of text.matchAll(IMPORT_LINE)) {
    const pkg = m[3].slice('@engine/'.length);
    for (const part of m[1].split(',')) {
      const [name, local] = part.trim().split(/\s+as\s+/);
      if (name) out.set(local || name, { pkg, name });
    }
  }
  return out;
}

/** Names the file declares itself (const, let, var, function, class), most recent first, without duplicates. */
export function declaredNames(text) {
  const seen = new Set();
  const list = [];
  for (const m of text.matchAll(DECLARED)) if (!seen.has(m[1])) { seen.add(m[1]); list.push(m[1]); }
  return list;
}

/** Find an engine export by name, preferring the package the file imports it from. */
export function lookup(api, name, imports = new Map()) {
  const rows = tableOf(api).byName.get(imports.get(name)?.name ?? name);
  if (!rows) return null;
  const pkg = imports.get(name)?.pkg;
  return rows.find((r) => r.pkg === pkg) ?? rows[0];
}

/**
 * Add `name` to the file's imports: into the existing import from that package, else as a new line after the last import (or at the top).
 * @returns {{from: number, to: number, insert: string}} an edit
 */
export function addImport(text, name, pkg) {
  const source = `@engine/${pkg}`;
  for (const m of text.matchAll(IMPORT_LINE)) {
    if (m[3] !== source) continue;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => n.split(/\s+as\s+/)[0] === name)) return { from: 0, to: 0, insert: '' };
    const open = m.index + m[0].indexOf('{') + 1;
    const close = m.index + m[0].indexOf('}');
    const spaced = text[open] === ' ';
    return { from: open, to: close, insert: `${spaced ? ' ' : ''}${[...names, name].join(', ')}${spaced ? ' ' : ''}` };
  }
  let at = 0;
  for (const m of text.matchAll(/^import[^\n]*\n/gm)) at = m.index + m[0].length;
  const line = `import { ${name} } from '${source}';\n`;
  return { from: at, to: at, insert: at === 0 && text.length && !text.startsWith('\n') ? `${line}\n` : line };
}

/** The identifier before a dot: `ship.pos.` gives "pos", and the thing it was made from if the file says `pos = new Vec2(`. */
function receiver(text, dotAt) {
  const before = text.slice(Math.max(0, dotAt - 80), dotAt);
  const m = /([A-Za-z_$][\w$]*)\s*(?:\(\s*\))?$/.exec(before);
  if (!m) return null;
  const made = new RegExp(`\\b${m[1].replace(/\$/g, '\\$')}\\s*=\\s*new\\s+([A-Za-z_$][\\w$]*)`).exec(text);
  return { name: m[1], made: made?.[1] ?? null };
}

const rank = (list, query, key = (x) => x.label) => {
  const out = [];
  for (const item of list) {
    const m = query ? fuzzyMatch(query, key(item)) : { score: 0 };
    if (m && (!query || m.score >= 0.2 * query.length)) out.push({ ...item, score: m.score });
  }
  return out;
};

const memberItems = (cls, pkg) => (cls.m ?? []).map((m) => ({
  label: m.n, kind: m.k === 'method' ? 'method' : 'property', detail: m.s, doc: m.d, source: 'member', pkg,
}));

/**
 * What to offer at a position.
 * @param {string} text the whole file
 * @param {number} pos the caret
 * @param {object} api the generated API index
 * @param {{explicit?: boolean, files?: string[]}} [o] `explicit`: the person asked (Ctrl+Space), so offer even with nothing typed; `files`: other project files
 * @returns {null | {from: number, to: number, items: Item[], importContext: boolean}} the range the choice will replace, and the best matches
 */
export function completionsAt(text, pos, api, { explicit = false } = {}) {
  let from = pos;
  while (from > 0 && /[\w$]/.test(text[from - 1])) from--;
  const prefix = text.slice(from, pos);
  const line = text.slice(lineStart(text, pos), pos);
  const imports = importedNames(text);
  const t = tableOf(api);
  const done = (items, importContext = false) => {
    const ranked = items.sort((a, b) => b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label)).slice(0, MAX_ITEMS);
    return ranked.length ? { from, to: pos, items: ranked, importContext } : null;
  };

  const pkgMatch = /from\s*['"]@engine\/([\w-]*)$/.exec(line);              // import ... from '@engine/ma|'
  if (pkgMatch) {
    from = pos - pkgMatch[1].length;
    const items = Object.entries(api.packages).map(([name, p]) => ({
      label: name, kind: 'module', detail: `@engine/${name}`, doc: p.description, source: 'engine',
    }));
    return done(rank(items, pkgMatch[1]), true);
  }

  const open = text.lastIndexOf('import', pos);                             // import { Ve| } from '@engine/math'
  if (open >= 0 && !text.slice(open, pos).includes('}') && /^import\s*\{[^}]*$/.test(text.slice(open, pos)) && pos - open < 600) {
    const after = /^[^}]*\}\s*from\s*['"]@engine\/([\w-]+)/.exec(text.slice(pos));
    const rows = after ? (api.packages[after[1]]?.exports ?? []).map((entry) => ({ pkg: after[1], entry })) : t.all;
    return done(rank(rows.map(({ pkg, entry }) => ({
      label: entry.n, kind: entry.k, detail: after ? entry.s : `@engine/${pkg}`, doc: entry.d, source: 'engine', pkg,
    })), prefix), true);
  }

  if (text[from - 1] === '.' && text[from - 2] !== '.') {                   // member access: ship.|
    const r = receiver(text, from - 1);
    if (!r) return null;
    const cls = lookup(api, r.made ?? r.name, imports);
    if (cls?.entry.m) return done(rank(memberItems(cls.entry, cls.pkg), prefix));
    const used = new Set();                                                 // otherwise: names used after a dot elsewhere in this file
    for (const m of text.matchAll(/\.([A-Za-z_$][\w$]*)/g)) if (m.index + 1 !== from) used.add(m[1]);
    return done(rank([...used].map((n) => ({ label: n, kind: 'property', detail: '', doc: '', source: 'file' })), prefix));
  }

  if (!prefix && !explicit) return null;
  if (/^(?:\d)/.test(prefix)) return null;
  const items = [];
  const names = new Set();
  const add = (item) => { if (!names.has(item.label) && item.label !== prefix) { names.add(item.label); items.push(item); } };
  for (const [local, { pkg }] of imports) {
    const row = lookup(api, local, imports);
    const detail = row?.entry.s ?? `@engine/${pkg}`;
    add({ label: local, kind: row?.entry.k ?? 'variable', detail, doc: row?.entry.d ?? '', source: 'imported', pkg });
  }
  for (const n of declaredNames(text)) add({ label: n, kind: 'variable', detail: '', doc: '', source: 'file' });
  for (const m of text.matchAll(ID)) {
    if (m.index !== from && m[0].length > 2) add({ label: m[0], kind: 'variable', detail: '', doc: '', source: 'file' });
  }
  for (const { pkg, entry } of t.all) add({ label: entry.n, kind: entry.k, detail: `@engine/${pkg}`, doc: entry.d, source: 'engine', pkg });
  const ranked = rank(items, prefix);
  const bonus = { imported: 2, file: 1, engine: 0 };
  for (const r of ranked) r.score += bonus[r.source] ?? 0;
  return done(ranked);
}

/**
 * The edit that accepts a suggestion: the name replaces what was typed, and an engine name not yet imported brings its import line along.
 * @returns {{from: number, to: number, insert: string, anchor: number, head: number}}
 */
export function acceptEdit(text, range, item) {
  const call = item.kind === 'function' && !range.importContext && text[range.to] !== '(' ? '(' : '';
  const word = item.label + call;
  const plain = { from: range.from, to: range.to, insert: word, anchor: range.from + word.length, head: range.from + word.length };
  if (item.source !== 'engine' || !item.pkg || range.importContext) return plain;
  const imp = addImport(text, item.label, item.pkg);
  if (imp.to > range.from || (!imp.insert && imp.from === imp.to)) return plain;           // already imported, or the caret is inside the import line
  // one edit covering the import and the word, so undo takes both back together
  const insert = imp.insert + text.slice(imp.to, range.from) + word;
  return { from: imp.from, to: range.to, insert, anchor: imp.from + insert.length, head: imp.from + insert.length };
}

/** The call the caret is inside: `move(a, |b)` gives { name: "move", index: 1 }. Null when not inside a call, or in a string. */
export function callContext(text, pos) {
  let depth = 0;
  let commas = 0;
  for (let i = pos - 1; i >= 0 && pos - i < 400; i--) {
    const c = text[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) {
        if (c !== '(') return null;
        const m = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(Math.max(0, i - 60), i));
        return m && !/^(if|for|while|switch|catch|function|return)$/.test(m[1]) ? { name: m[1], index: commas } : null;
      }
      depth--;
    } else if (c === ',' && depth === 0) commas++;
    else if (c === ';' && depth === 0) return null;
  }
  return null;
}

/**
 * A description of a name for a hover or a parameter hint, from the API index.
 * @returns {null | {name: string, kind: string, signature: string, doc: string, pkg: string, params: string[][], returns: string[] | null}}
 */
export function describe(text, name, api) {
  const row = lookup(api, name, importedNames(text));
  if (!row) return null;
  const e = row.entry;
  return { name: e.n, kind: e.k, signature: e.s, doc: e.d, pkg: row.pkg, params: e.p ?? [], returns: e.r ?? null };
}
