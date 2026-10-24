// File helpers for the build: globbing, hashing, content types.
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

/** `*` = within a folder, `**` = any folders, `?` = one character, `{a,b}` = either. */
export function globToRegExp(glob) {
  let re = '', i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i += 2; if (glob[i] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; continue; }
      re += '[^/]*'; i++; continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '{') { const j = glob.indexOf('}', i); if (j < 0) throw new Error(`glob "${glob}": missing }`); re += `(?:${glob.slice(i + 1, j).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = j + 1; continue; }
    re += c.replace(/[.+^$()|[\]\\]/g, '\\$&'); i++;
  }
  return new RegExp(`^${re}$`);
}

/** Every file below `dir` as paths relative to it with forward slashes, sorted; dot files and folders and node_modules are skipped. */
export function walk(dir, skip = (name) => name.startsWith('.') || name === 'node_modules') {
  const out = [];
  const rec = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (skip(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) rec(r); else if (e.isFile()) out.push(r);
    }
  };
  rec('');
  return out;
}

/** Files below `root` matching any of the globs (relative to root), sorted. */
export function matchFiles(root, globs) {
  const res = globs.map(globToRegExp);
  return walk(root).filter((f) => res.some((r) => r.test(f)));
}

/** A short SHA-256 hex digest of some bytes, used in hashed file names (`length` hex digits, default 8). */
export const hashBytes = (bytes, length = 8) => createHash('sha256').update(bytes).digest('hex').slice(0, length);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.wgsl': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
export const contentType = (path) => TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
/** Text-like types worth compressing. */
export const compressible = (path) => /\.(html|js|mjs|css|json|svg|txt|wgsl|gltf|wasm|bin|glb)$/i.test(path);
export const sizeOf = (p) => statSync(p).size;
