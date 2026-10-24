// Build the documentation website from the repository's Markdown.
//   node tools/site.js write    makes docs/site/ (open docs/site/index.html in a browser, or host the folder anywhere)
//   node tools/site.js check    fails if docs/site/ is out of date or a link leads nowhere (npm test runs this)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, SITE_DIR } from './site-lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'write';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const site = buildSite(root, { version });

// the files of the site: generated pages, the style and script, and the images the pages use
const files = new Map(Object.entries(site.files).map(([p, c]) => [p, Buffer.from(c)]));
for (const f of ['site.css', 'site.js', 'lab.js']) files.set(`assets/${f}`, readFileSync(join(root, 'tools/site-assets', f)));
for (const [src, out] of site.images) files.set(out, readFileSync(join(root, src)));

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
const target = join(root, SITE_DIR);
const existing = new Map(walk(target).map((f) => [relative(target, f).replace(/\\/g, '/'), f]));

if (mode === 'check') {
  const bad = [...site.problems];
  for (const [p, buf] of files) { if (!existing.has(p)) bad.push(`${p} is missing`); else if (!readFileSync(existing.get(p)).equals(buf)) bad.push(`${p} is out of date`); }
  for (const p of existing.keys()) if (!files.has(p)) bad.push(`${p} should not exist`);
  if (bad.length) { console.error(`${SITE_DIR} is not up to date:\n  ${bad.slice(0, 20).join('\n  ')}\nRun: node tools/site.js write`); process.exit(1); }
  console.log(`${SITE_DIR} is up to date (${site.pages.length} pages, no broken links).`);
} else if (mode === 'write') {
  if (site.problems.length) { console.error(`Problems found:\n  ${site.problems.join('\n  ')}`); process.exit(1); }
  for (const p of existing.keys()) if (!files.has(p)) rmSync(existing.get(p));
  for (const [p, buf] of files) { const f = join(target, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buf); }
  console.log(`Wrote ${files.size} files to ${SITE_DIR} (${site.pages.length} pages). Open ${SITE_DIR}/index.html`);
} else { console.error('usage: node tools/site.js write | check'); process.exit(2); }
