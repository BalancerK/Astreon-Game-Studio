// Checks the built-page smoke check itself: a project whose page loads cleanly passes, and a project whose built page throws (or whose script cannot load) fails.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = join(dirname(fileURLToPath(import.meta.url)), 'built-smoke.js');
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'smoke-proj-'));
  for (const [rel, data] of Object.entries(files)) { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); }
  return root;
}
const page = '<!doctype html><title>t</title><body><script type="module" src="main.js"></script>';
const cases = [
  ['a clean page', { 'index.html': page, 'main.js': "import { x } from './dep.js';\ndocument.title = String(x);\nexport {};", 'dep.js': 'export const x = 1;' }, 0],
  ['an import that is used above its line (works as a module, and now in the bundle)', { 'index.html': page, 'main.js': "early();\nimport { x } from './dep.js';\nfunction early() { document.title = String(x); }\nexport {};", 'dep.js': 'export const x = 1;' }, 0],
  ['a page that throws', { 'index.html': page, 'main.js': "throw new Error('broken on load');\nexport {};" }, 1],
];
let bad = 0;
for (const [name, files, expected] of cases) {
  const root = project(files);
  const r = spawnSync(process.execPath, [tool, root, '--wait=1'], { encoding: 'utf8' });
  const ok = r.status === expected;
  console.log(`  ${name}: ${ok ? 'PASS' : `FAIL (exit ${r.status}, wanted ${expected})\n${r.stdout}${r.stderr}`}`);
  if (!ok) bad++;
  rmSync(root, { recursive: true, force: true });
}
if (bad) { console.log(`${bad} failed`); process.exit(1); }
console.log('built-smoke-test: PASS');
