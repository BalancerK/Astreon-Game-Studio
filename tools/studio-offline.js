// The list of files the studio needs to work with no network, and a version number made from what is in them. The studio's service worker (studio/sw.js) keeps
// these files, so once the studio has been opened online it can be opened again, and used, offline.
//   node tools/studio-offline.js write [file]   writes studio/offline-files.js (do this when publishing the studio on a web host)
//   node tools/studio-offline.js list           prints what would be kept
// The development server (npm run studio) makes the same file on the fly, so there is nothing to keep up to date while working.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = new Set(['.js', '.mjs', '.html', '.css', '.json', '.svg', '.webmanifest', '.wgsl', '.glsl']);
const STUDIO_DIRS = ['app', 'runner', 'export', 'plugins', 'netlab', 'scene3d'];
const STUDIO_FILES = ['index.html', 'manifest.webmanifest', 'icon.svg'];

function walk(dir, out, skip = () => false) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (skip(path, name)) continue;
    if (statSync(path).isDirectory()) walk(path, out, skip);
    else if (KEEP.has(extname(name).toLowerCase())) out.push(path);
  }
}

/** The files to keep, as paths from the repository root with forward slashes, in a fixed order. */
export function studioFiles(root = ROOT) {
  const found = [];
  for (const f of STUDIO_FILES) found.push(join(root, 'studio', f));
  for (const d of STUDIO_DIRS) walk(join(root, 'studio', d), found, (_, name) => name === 'test' || name.endsWith('.test.js'));
  for (const pkg of readdirSync(join(root, 'packages'))) {
    const src = join(root, 'packages', pkg, 'src');
    try { if (statSync(src).isDirectory()) walk(src, found); } catch { /* a package without src */ }
  }
  return found.map((p) => relative(root, p).split(sep).join('/')).filter((p) => p !== 'studio/offline-files.js').sort();
}

/** The text of studio/offline-files.js: the list, and a version that changes whenever any listed file does. */
export function offlineScript(root = ROOT) {
  const files = studioFiles(root);
  const hash = createHash('sha256');
  for (const f of files) { hash.update(f); hash.update('\0'); hash.update(readFileSync(join(root, f))); hash.update('\0'); }
  const version = hash.digest('hex').slice(0, 12);
  return `// Made by tools/studio-offline.js: the files the studio keeps for offline use, and a version made from their contents.\n`
    + `self.STUDIO_OFFLINE = ${JSON.stringify({ version, files }, null, 1)};\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, target] = process.argv.slice(2);
  if (command === 'write') {
    const out = resolve(target ?? join(ROOT, 'studio', 'offline-files.js'));
    writeFileSync(out, offlineScript());
    console.log(`Wrote ${relative(ROOT, out)} (${studioFiles().length} files).`);
  } else if (command === 'list') {
    console.log(studioFiles().join('\n'));
  } else {
    console.log('usage: node tools/studio-offline.js write [file] | list');
    process.exit(2);
  }
}
