// Keeping a project and a folder on the computer the same, so git and other tools can see the project's files. This is the logic with no page in it: reading a
// folder (through the browser's directory handle, or anything shaped like one), writing to it, and *planning* a two-way sync from three facts per file: what the
// project has, what the folder has, and what both had the last time they agreed. Only a file that changed on one side since then is copied; a file changed on
// both is a conflict, and nothing is ever lost: the project's version stays and the folder's is kept beside it. A mass deletion is held back.
// Text files and the project's pictures and sounds travel the same way; a file's "content" is its text, or its bytes for a picture or a sound.
import { hashText } from '../../export/pwa.js';
import { assetKind, looksLikeAsset, sniff, fingerprint, LIMITS as ASSET_LIMITS } from './assets.js';

export const TEXT_FILE = /\.(js|mjs|json|md|txt|html|css|svg|csv|glsl|wgsl)$/i;
export const LIMITS = { files: 400, fileBytes: 2_000_000, totalBytes: 24_000_000, depth: 8 };
const SKIP_DIR = /^(\.|node_modules$)/;
export const CONFLICTS = 'conflicts/';

/** The project paths that are the folder's copy of a file changed in both places: `{copy, original}` each. */
export const conflictCopies = (paths) => paths.filter((p) => p.startsWith(CONFLICTS))
  .map((copy) => ({ copy, original: copy.slice(CONFLICTS.length) }));

const bytesHashes = new WeakMap();                    // a picture is looked at once, not at every sync

/** A short fingerprint of a file's content (text or bytes), to tell whether it changed. */
export function hashOf(content) {
  if (typeof content === 'string') return hashText(content);
  let h = bytesHashes.get(content);
  if (!h) { h = `b${fingerprint(content)}`; bytesHashes.set(content, h); }
  return h;
}

/**
 * A way to say which files the link should not touch: one pattern per line. `*` is any run of letters inside a name, `**` also crosses folders; a pattern with no
 * `/` matches a name anywhere (`*.psd`, `notes.txt`); one with a `/` matches from the top (`src/old/*.js`); one ending in `/` is a whole folder (`drafts/`).
 * @param {string[]} patterns
 * @returns {(path: string) => boolean} true for a path that is ignored
 */
export function ignoreMatcher(patterns) {
  const rules = [];
  for (const raw of patterns ?? []) {
    let p = String(raw).trim();
    if (!p || p.startsWith('#')) continue;
    const dir = p.endsWith('/');
    if (dir) p = p.slice(0, -1);
    p = p.replace(/^\//, '');
    if (!p) continue;
    const re = p.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '<DEEP>').replace(/\*/g, '[^/]*').replace(/<DEEP>/g, '.*');
    rules.push(new RegExp(`^${p.includes('/') ? '' : '(?:.*/)?'}${re}(?:/.*)?$`));
  }
  return (path) => rules.some((r) => r.test(path));
}

/** The project's name for a file of the folder: a picture or sound in a chosen folder (`art/hero.png`) lives in the project as `assets/art/hero.png`. */
export function toProjectPath(path, assetDirs = []) {
  return assetDirs.some((d) => path.startsWith(`${d}/`)) ? `assets/${path}` : path;
}

/** The folder's name for a file of the project (the other way round). */
export function toFolderPath(path, assetDirs = []) {
  return assetDirs.some((d) => path.startsWith(`assets/${d}/`)) ? path.slice('assets/'.length) : path;
}

/** Tidy the list of folders whose pictures and sounds should be brought in: no `assets`, no hidden or `..`, no repeats, a sensible number. */
export function cleanAssetDirs(list) {
  const out = [];
  for (const raw of list ?? []) {
    const d = String(raw).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!d || d.length > 100 || d.split('/').some((s) => !okName(s) || s.startsWith('.') || SKIP_DIR.test(s))) continue;
    if (d === 'assets' || d.startsWith('assets/') || d === 'conflicts' || out.includes(d)) continue;
    out.push(d);
  }
  return out.slice(0, 20);
}

/** Keep only the entries of a record (path -> anything) whose path passes `keep`. */
export const only = (record, keep) => Object.fromEntries(Object.entries(record).filter(([path]) => keep(path)));

const okName = (name) => name.length > 0 && name.length <= 100 && !/[\\/\0]/.test(name) && name !== '.' && name !== '..';

/**
 * Read the text files, pictures and sounds of a folder.
 * @param {any} dir a directory handle (`entries()`, and for files `getFile()`)
 * @param {Map<string, {stamp: string, text: string | Uint8Array}>} [cache] what was read last time (by project path): a file whose size and date are unchanged is not read again
 * @param {{ignore?: (path: string) => boolean, assetDirs?: string[]}} [o] files to leave alone, and folders whose pictures and sounds come in as `assets/<folder>/…`
 * @returns {Promise<{files: Map<string, {text: string | Uint8Array, stamp: string}>, skipped: string[], skippedPaths: Set<string>}>} `skippedPaths`: files
 *   that are there but were not read (too big, not what they say): they must not be taken for deleted
 */
export async function readFolder(dir, cache = new Map(), { ignore = () => false, assetDirs = [] } = {}) {
  const files = new Map();
  const skipped = [];
  const skippedPaths = new Set();
  let total = 0;
  let assets = 0;
  const mapped = new Map();                                    // project paths that came from a chosen folder (the folder's own assets/ wins)
  const walk = async (handle, prefix, depth) => {
    for await (const [name, entry] of handle.entries()) {
      if (!okName(name)) continue;
      if (ignore(`${prefix}${name}`)) continue;
      if (entry.kind === 'directory') {
        if (SKIP_DIR.test(name)) continue;
        if (depth >= LIMITS.depth) { skipped.push(`${prefix}${name}/ (too deep)`); continue; }
        await walk(entry, `${prefix}${name}/`, depth + 1);
      } else if (entry.kind === 'file') {
        const folderPath = `${prefix}${name}`;
        const path = toProjectPath(folderPath, assetDirs);
        const kind = assetKind(path);                                    // only the project's assets/ folder holds pictures and sounds
        if (name.startsWith('.') || (!kind && !TEXT_FILE.test(name))) {
          if (!name.startsWith('.') && looksLikeAsset(name) && !folderPath.startsWith(CONFLICTS)) {
            skipped.push(`${path} (a picture or sound outside assets/: move it into assets/, or add its folder in the Folder link window)`);
            skippedPaths.add(path);
          }
          continue;
        }
        if (folderPath !== path && files.has(path)) {
          skipped.push(`${folderPath} (the folder's assets/ has the same name)`);
          continue;
        }
        const file = await entry.getFile();
        if (file.size > (kind ? ASSET_LIMITS[kind] : LIMITS.fileBytes)) { skipped.push(`${path} (too big)`); skippedPaths.add(path); continue; }
        if (kind && assets >= ASSET_LIMITS.count) { skipped.push(`${path} (too many pictures and sounds)`); skippedPaths.add(path); continue; }
        if (files.size >= LIMITS.files) { skipped.push(`${path} (too many files)`); skippedPaths.add(path); continue; }
        total += file.size;
        if (total > LIMITS.totalBytes) { skipped.push(`${path} (too much in all)`); skippedPaths.add(path); continue; }
        const stamp = `${file.lastModified}:${file.size}`;
        const known = cache.get(path);
        let content = known?.stamp === stamp ? known.text : null;
        if (content === null && kind) {
          content = new Uint8Array(await file.arrayBuffer());
          const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
          if (!sniff(ext, content)) { skipped.push(`${path} (not really a .${ext} file)`); skippedPaths.add(path); total -= file.size; continue; }
        } else if (content === null) content = await file.text();
        if (kind) assets++;
        if (folderPath === path && mapped.has(path)) skipped.push(`${mapped.get(path)} (the folder's assets/ has the same name)`);
        if (folderPath !== path) mapped.set(path, folderPath);
        files.set(path, { stamp, text: content });
      }
    }
  };
  await walk(dir, '', 0);
  return { files, skipped, skippedPaths };
}

async function directoryFor(dir, path, create) {
  let at = dir;
  const parts = path.split('/');
  const file = parts.pop();
  for (const part of parts) at = await at.getDirectoryHandle(part, { create });
  return { at, file };
}

/** Write one file (text, or bytes for a picture or a sound) into a folder, making any folders on the way. */
export async function writeFile(dir, path, text) {
  const { at, file } = await directoryFor(dir, path, true);
  const handle = await at.getFileHandle(file, { create: true });
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
}

/** Delete one file from a folder (a missing file is fine). */
export async function removeFile(dir, path) {
  try {
    const { at, file } = await directoryFor(dir, path, false);
    await at.removeEntry(file);
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
  }
}

/**
 * Work out what to copy where.
 * @param {Record<string, string | Uint8Array>} project the project's text files, pictures and sounds
 * @param {Map<string, {text: string | Uint8Array}> | Record<string, string | Uint8Array>} folder the folder's
 * @param {Record<string, string>} baseline path -> hash of the content both sides had when they last agreed
 * @param {{mode?: 'merge' | 'folder'}} [o] `folder`: the folder is the truth (the first time a folder is linked and the person chose it)
 * @returns {{ops: {side: 'project' | 'folder', path: string, text: string | Uint8Array | null}[], conflicts: string[], baseline: Record<string, string>, heldBack: string[]}}
 */
export function plan(project, folder, baseline = {}, { mode = 'merge' } = {}) {
  const f = folder instanceof Map ? Object.fromEntries([...folder].map(([k, v]) => [k, v.text])) : folder;
  const paths = new Set([...Object.keys(project), ...Object.keys(f), ...Object.keys(baseline)]);
  const ops = [];
  const conflicts = [];
  const next = {};
  const deletions = { project: [], folder: [] };
  const hash = (t) => (t === undefined ? null : hashOf(t));
  for (const path of [...paths].sort()) {
    const p = project[path];
    const q = f[path];
    const hp = hash(p);
    const hq = hash(q);
    const hb = baseline[path] ?? null;
    if (hp === hq) { if (hp !== null) next[path] = hp; continue; }                           // the same on both sides (or gone from both)
    if (mode === 'folder' && Object.keys(baseline).length === 0) {                           // first link, the folder is the truth
      ops.push({ side: 'project', path, text: q ?? null });
      if (q !== undefined) next[path] = hq; else deletions.project.push(path);
      continue;
    }
    if (hp === hb) {                                                                         // only the folder changed
      ops.push({ side: 'project', path, text: q ?? null });
      if (q !== undefined) next[path] = hq; else deletions.project.push(path);
    } else if (hq === hb) {                                                                  // only the project changed
      ops.push({ side: 'folder', path, text: p ?? null });
      if (p !== undefined) next[path] = hp; else deletions.folder.push(path);
    } else if (p !== undefined && q !== undefined) {                                         // both changed it: yours stays, the folder's is kept
      conflicts.push(path);
      ops.push({ side: 'folder', path, text: p });
      next[path] = hp;
      const copy = `${CONFLICTS}${path}`;
      ops.push({ side: 'project', path: copy, text: q });
      ops.push({ side: 'folder', path: copy, text: q });
      next[copy] = hq;
    } else if (p === undefined) {                                                            // deleted here, changed there: keep the change
      conflicts.push(path);
      ops.push({ side: 'project', path, text: q });
      next[path] = hq;
    } else {                                                                                 // deleted there, changed here: keep the change
      conflicts.push(path);
      ops.push({ side: 'folder', path, text: p });
      next[path] = hp;
    }
  }
  // a large share of the files vanishing at once is more likely a mistake (an empty folder, a git checkout half done) than a wish
  const known = Math.max(1, Object.keys(baseline).length);
  const heldBack = [];
  for (const side of ['project', 'folder']) {
    const gone = deletions[side];
    if (gone.length > 3 && gone.length / known > 0.5) {
      for (const path of gone) {
        const i = ops.findIndex((o) => o.side === side && o.path === path && o.text === null);
        if (i >= 0) ops.splice(i, 1);
        next[path] = baseline[path];
        heldBack.push(path);
      }
    }
  }
  return { ops, conflicts, baseline: next, heldBack };
}

/** Does this look like a folder handle we can use? */
export const isDirectoryHandle = (h) => !!h && h.kind === 'directory' && typeof h.entries === 'function' && typeof h.getFileHandle === 'function';

/** Leave out of a plan the files the folder has but could not be read: otherwise the project's copy would look like it had been deleted from the folder. */
export function without(record, paths) {
  if (!paths || !paths.size) return record;
  return Object.fromEntries(Object.entries(record).filter(([path]) => !paths.has(path)));
}
