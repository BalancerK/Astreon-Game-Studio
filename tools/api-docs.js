// The API reference: node tools/api-docs.js [write | check | coverage]
//   write      generate docs/api/*.md and docs/api/index.html from the source (default)
//   check      fail if the files in docs/api are out of date (npm test runs this)
//   coverage   which public exports have no description
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, coverage, writeAll, checkAll, undocumented } from './api-docs-lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cmd = process.argv[2] ?? 'write';
if (cmd === 'write') {
  const files = writeAll(root);
  console.log(`wrote ${files.length} files to docs/api`);
} else if (cmd === 'check') {
  const stale = checkAll(root), missing = undocumented(root);
  if (missing.length) { console.error(`these exports have no description (add a /** comment above them):\n  ${missing.join('\n  ')}`); process.exit(1); }
  if (stale.length) { console.error(`docs/api is out of date (${stale.join(', ')}): run npm run docs`); process.exit(1); }
  console.log('docs/api is up to date and every export is documented.');
} else if (cmd === 'coverage') {
  let total = 0, documented = 0;
  for (const p of buildModel(root).packages) {
    const c = coverage(p); total += c.total; documented += c.documented;
    console.log(`${p.title.padEnd(24)} ${String(c.documented).padStart(3)} / ${String(c.total).padEnd(3)}  ${c.missing.slice(0, 12).join(', ')}${c.missing.length > 12 ? ', …' : ''}`);
  }
  console.log(`${'all'.padEnd(24)} ${documented} / ${total}  (${Math.round((documented / total) * 100)}%)`);
} else { console.error('usage: node tools/api-docs.js [write | check | coverage]'); process.exit(2); }
