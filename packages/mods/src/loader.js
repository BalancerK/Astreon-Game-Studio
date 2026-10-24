// Reads mods from disk into bundles. Node only. Hostile directories are expected: symlinks are skipped (they
// could point outside the mod), only plain files within size limits are read, and nothing is executed here.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_LIMITS, validateBundle } from './bundle.js';

const SKIP = new Set(['node_modules', 'signature.json', 'mod.json']);
const TEXT_EXT = /\.(js|json|md|txt)$/;

/**
 * Load one mod directory: `mod.json` plus its text files (any depth up to 3), plus an optional `signature.json`.
 * @param {string} dir
 * @returns {{ok: true, bundle: import('./bundle.js').Bundle, errors: []} | {ok: false, bundle: null, errors: string[]}}
 */
export function loadBundleDir(dir) {
  const errors = [];
  let manifest;
  try {
    const st = lstatSync(join(dir, 'mod.json'));
    if (!st.isFile() || st.size > 16 * 1024) return { ok: false, bundle: null, errors: ['mod.json must be a regular file under 16 KB'] };
    manifest = JSON.parse(readFileSync(join(dir, 'mod.json'), 'utf8'));
  } catch (e) {
    return { ok: false, bundle: null, errors: [`cannot read mod.json: ${e.message}`] };
  }

  const files = {};
  let total = 0;
  const walk = (rel, depth) => {
    if (depth > 3) { errors.push(`too deeply nested: ${rel}`); return; }
    let names;
    try { names = readdirSync(join(dir, rel)); } catch (e) { errors.push(`cannot list ${rel || '.'}: ${e.message}`); return; }
    for (const name of names.sort()) {
      if (name.startsWith('.') || SKIP.has(name)) continue;
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, path));
      if (st.isSymbolicLink()) { errors.push(`symbolic link ignored: ${path}`); continue; }
      if (st.isDirectory()) { walk(path, depth + 1); continue; }
      if (!st.isFile() || !TEXT_EXT.test(name)) continue;
      if (st.size > BUNDLE_LIMITS.fileBytes) { errors.push(`file too large: ${path} (${st.size} bytes)`); continue; }
      total += st.size;
      if (total > BUNDLE_LIMITS.totalBytes || Object.keys(files).length >= BUNDLE_LIMITS.files) { errors.push('bundle exceeds the size or file-count limit'); return; }
      files[path] = readFileSync(join(dir, path), 'utf8');
    }
  };
  walk('', 0);
  // markdown/text files are documentation, not part of what runs: keep only scripts and data
  for (const name of Object.keys(files)) if (!/\.(js|json)$/.test(name)) delete files[name];
  // a data mod carries its data in mod.json; stray files would make it look like it has code
  if (manifest && manifest.tier === 'data') for (const name of Object.keys(files)) delete files[name];

  let signature = null;
  try {
    const st = lstatSync(join(dir, 'signature.json'));
    if (st.isFile() && st.size < 1024) signature = JSON.parse(readFileSync(join(dir, 'signature.json'), 'utf8'));
  } catch { /* unsigned */ }

  const bundle = { manifest, files, signature };
  const v = validateBundle(bundle);
  if (!v.ok) return { ok: false, bundle: null, errors: [...errors, ...v.errors] };
  return { ok: true, bundle, errors: [] };
}

/**
 * Load every mod directory under `root`. Problems are reported per directory, never thrown.
 * @param {string} root
 * @returns {{bundles: import('./bundle.js').Bundle[], problems: {dir: string, errors: string[]}[]}}
 */
export function loadCatalog(root) {
  const bundles = [], problems = [];
  let names = [];
  try { names = readdirSync(root).sort(); } catch (e) { return { bundles, problems: [{ dir: root, errors: [`cannot read catalog: ${e.message}`] }] }; }
  for (const name of names) {
    if (name.startsWith('_') || name.startsWith('.')) continue; // _template and friends
    const dir = join(root, name);
    try { if (!lstatSync(dir).isDirectory()) continue; } catch { continue; }
    const r = loadBundleDir(dir);
    if (r.ok) bundles.push(r.bundle); else problems.push({ dir: name, errors: r.errors });
  }
  return { bundles, problems };
}
