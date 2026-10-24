// Working out which of the engine's files a project needs. A game imports `@engine/arcade`; that file imports others; the exported game must carry exactly
// those, no more. This reads import statements (not a full parse: the engine's own files are plain and regular) and follows them.

const ENGINE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])@engine\/([a-z0-9-]+)(\/[^'"]*)?\1/g;
const RELATIVE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\1/g;
export const MAX_FILES = 300;

/** The engine files a piece of code asks for directly: `@engine/arcade` is `arcade/src/index.js`. */
export function engineImports(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(ENGINE)) out.push(`${m[2]}${m[3] ?? '/src/index.js'}`);
  return out;
}

/** Resolve `./x.js` or `../y.js` against the folder of the file that asks for it. */
export function resolveRelative(from, spec) {
  const parts = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/**
 * Every engine file the project needs, following imports from file to file.
 * @param {Record<string, string>} files the project's files
 * @param {(path: string) => Promise<string | null>} read gives the text of an engine file (`arcade/src/index.js`), or null if there is none
 * @param {string[]} [extra] engine files to include whatever the project says (the runtime's own needs)
 * @returns {Promise<{files: Record<string, string>, missing: string[]}>} the files by path under the engine folder, and any that could not be read
 */
export async function collectEngine(files, read, extra = []) {
  const wanted = new Set(extra);
  for (const [path, text] of Object.entries(files)) if (path.endsWith('.js')) for (const f of engineImports(text)) wanted.add(f);
  const have = {};
  const missing = [];
  const queue = [...wanted];
  while (queue.length) {
    const path = queue.shift();
    if (path in have || missing.includes(path)) continue;
    if (Object.keys(have).length >= MAX_FILES) throw new Error(`The game needs more than ${MAX_FILES} engine files; something is wrong with its imports.`);
    const text = await read(path);
    if (text === null || text === undefined) { missing.push(path); continue; }
    have[path] = text;
    for (const m of text.matchAll(RELATIVE)) queue.push(resolveRelative(path, m[2]));
    for (const f of engineImports(text)) queue.push(f);
  }
  return { files: have, missing };
}
