// What a studio plugin is, and the only ways it can talk to the studio. A plugin is one JavaScript module with a `manifest` (a plain JSON object: its name, what it
// adds, and what it asks to be allowed to do) and an `activate` function. It never runs inside the studio: it runs in a sandboxed frame that has no network, no
// storage and no way to reach the studio's page, and its only line to the studio is the messages below, each of which is checked here before anything acts.
// Pure functions, tested in Node.

export const PERMISSIONS = {
  'files.read': 'read the files of your project',
  'files.write': 'change, add and delete files in your project',
  'game.read': 'see the numbers your running game reports',
};

/** The calls a plugin may make, and the permission each needs (null: none). */
export const METHODS = {
  'files.list': 'files.read',
  'files.read': 'files.read',
  'files.write': 'files.write',
  'files.remove': 'files.write',
  'game.summary': 'game.read',
  'ui.toast': null,
  'log': null,
  'state.get': null,
  'state.set': null,
};

export const LIMITS = { code: 500_000, args: 2_000_000, state: 20_000, panels: 4, commands: 24, exporters: 6, importers: 6, text: 200, files: 400, fileBytes: 4_000_000 };
const ID = /^[a-z][a-z0-9-]{1,30}$/;
const ENTRY = /^[a-z][a-z0-9-]{0,30}$/;
const word = (v, max = LIMITS.text) => (typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null);

/** A path inside a project: no `..`, nothing absolute, plain characters. */
export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 200 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0')
    && !path.split('/').some((p) => p === '..' || p === '.' || p === '') && /^[\w .\-/@]+$/.test(path);
}

/**
 * Read the manifest out of a plugin's source without running any of it: it is the JSON object after `export const manifest =`.
 * @param {string} source
 * @returns {unknown} the parsed object
 */
export function parseManifest(source) {
  const m = /export\s+const\s+manifest\s*=\s*/.exec(String(source ?? ''));
  if (!m) throw new Error('This is not a plugin: it needs "export const manifest = { ... };" near the top.');
  const start = m.index + m[0].length;
  if (source[start] !== '{') throw new Error('The manifest must be a plain object in curly brackets.');
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)); } catch { throw new Error('The manifest must be plain JSON: names in "double quotes", no comments, no trailing commas.'); }
    }
  }
  throw new Error('The manifest is not closed with a }.');
}

/**
 * Check a manifest and return a clean copy, or throw an Error that says what is wrong.
 * @param {any} raw
 */
export function checkManifest(raw) {
  const bad = (why) => { throw new Error(`This plugin cannot be installed: ${why}.`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('the manifest is not an object');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) bad('"id" must be 2 to 31 letters, digits and dashes, starting with a letter');
  const name = word(raw.name, 60) ?? bad('it needs a "name"');
  const out = { id: raw.id, name, version: word(raw.version, 20) ?? '0.0.0', description: word(raw.description, 300) ?? '', permissions: [], panels: [], commands: [], exporters: [], importers: [] };
  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions)) bad('"permissions" must be a list');
    for (const p of raw.permissions) {
      if (!(p in PERMISSIONS)) bad(`"${String(p).slice(0, 30)}" is not a permission this studio knows`);
      if (!out.permissions.includes(p)) out.permissions.push(p);
    }
  }
  const items = (key, max, extra = () => ({})) => {
    const list = raw[key] ?? [];
    if (!Array.isArray(list)) bad(`"${key}" must be a list`);
    if (list.length > max) bad(`"${key}" has more than ${max} entries`);
    const seen = new Set();
    return list.map((x) => {
      if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !ENTRY.test(x.id) || seen.has(x.id)) bad(`every entry in "${key}" needs its own "id" (letters, digits, dashes)`);
      seen.add(x.id);
      return { id: x.id, title: word(x.title, 60) ?? bad(`"${x.id}" in "${key}" needs a "title"`), ...extra(x) };
    });
  };
  out.panels = items('panels', LIMITS.panels);
  out.commands = items('commands', LIMITS.commands);
  out.exporters = items('exporters', LIMITS.exporters);
  out.importers = items('importers', LIMITS.importers, (x) => ({ accept: typeof x.accept === 'string' && /^(\.[\w]+)(,\.[\w]+)*$/.test(x.accept) ? x.accept : '' }));
  return out;
}

/** The permission a call needs: undefined for a call that does not exist, null for one that needs none. */
export const permissionFor = (method) => (Object.hasOwn(METHODS, method) ? METHODS[method] : undefined);

/**
 * Check a request from a plugin's frame before acting on it.
 * @returns {{id: number, method: string, args: any[]} | null} a clean request, or null if it is not one
 */
export function parseRequest(data) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.t !== 'call') return null;
  if (!Number.isInteger(data.id) || data.id < 0 || typeof data.method !== 'string' || permissionFor(data.method) === undefined) return null;
  if (!Array.isArray(data.args) || data.args.length > 4) return null;
  let size = 0;
  try { size = JSON.stringify(data.args).length; } catch { return null; }
  return size <= LIMITS.args ? { id: data.id, method: data.method, args: data.args } : null;
}

/** Check what an exporter returns (files to put in a zip) or an importer returns (the files of a new project). */
export function checkFiles(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('A plugin must hand back an object of file names and text.');
  const entries = Object.entries(result);
  if (!entries.length) throw new Error('The plugin handed back no files.');
  if (entries.length > LIMITS.files) throw new Error(`The plugin handed back more than ${LIMITS.files} files.`);
  let total = 0;
  const out = {};
  for (const [path, text] of entries) {
    if (!safePath(path)) throw new Error(`"${String(path).slice(0, 40)}" is not a file name a plugin may use.`);
    if (typeof text !== 'string') throw new Error(`The file "${path}" must be text.`);
    total += text.length;
    if (total > LIMITS.fileBytes) throw new Error('The files the plugin handed back are too big.');
    out[path] = text;
  }
  return out;
}

/** A short plain-words list of what a plugin asks for, for the install question. */
export function describePermissions(manifest) {
  const asks = manifest.permissions.map((p) => PERMISSIONS[p]);
  return asks.length ? asks : ['nothing: it only shows its own panels and cannot see your project'];
}
