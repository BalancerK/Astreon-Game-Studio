// The proof that the tarballs work: install all of them into an empty project and import every package from there, the way a user would.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { npm } from './release-lib.js';

// packages that need a browser at import time are checked with the globals they touch faked
const BROWSER_STUBS = `globalThis.window ??= globalThis; globalThis.document ??= { createElement: () => ({ getContext: () => null, style: {}, addEventListener() {} }), addEventListener() {}, getElementById: () => null, head: { append() {} } }; globalThis.navigator ??= { gpu: undefined, getGamepads: () => [] }; globalThis.addEventListener ??= () => {}; globalThis.devicePixelRatio ??= 1;`;

export async function verifyInstall(outDir, results) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-verify-'));
  const lines = [];
  let failed = false;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'verify', version: '1.0.0', private: true, type: 'module' }));
    npm(['install', '--no-audit', '--no-fund', '--offline', ...results.map((r) => join(outDir, r.file))], { cwd: dir });
    lines.push(`installed ${results.length} tarballs into a fresh project`);
    const script = `${BROWSER_STUBS}
const names = ${JSON.stringify(results.map((r) => r.name))};
const out = [];
for (const n of names) {
  try { const m = await import('@engine/' + n); out.push([n, Object.keys(m).length, null]); }
  catch (e) { out.push([n, 0, e.message.split('\\n')[0]]); }
}
console.log(JSON.stringify(out));`;
    writeFileSync(join(dir, 'check.mjs'), script);
    const res = JSON.parse(execFileSync(process.execPath, ['check.mjs'], { cwd: dir, encoding: 'utf8' }));
    for (const [n, count, err] of res) { if (err) { failed = true; lines.push(`FAIL @engine/${n}: ${err}`); } else lines.push(`ok   @engine/${n}  (${count} exports)`); }
  } catch (e) { failed = true; lines.push(`FAIL ${e.stderr?.toString().split('\n').slice(0, 6).join('\n') || e.message}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  return { lines, failed };
}
