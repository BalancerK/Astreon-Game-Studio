// Builds a project the way it is shipped, serves the result and opens every page in headless Chrome: a page that throws, rejects a promise, logs an error or cannot load a file fails the check. Tests that
// run the source in Node cannot see what the bundler does to it (a name used before its import line, an export that went missing, a script that does not parse); the built page can.
// Usage: node tools/built-smoke.js <project folder> [page.html ...] [--wait=5] [--allow=text,text]
//   With no pages it checks every page in the project's engine.config.json. `--allow` lists texts of messages that are expected (a missing favicon, a game server that is not running).
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, serve } from '../packages/build/src/index.js';
import { withChromePage } from './cdp.js';

const args = process.argv.slice(2), flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('='))), rest = args.filter((a) => !a.startsWith('--'));
const root = resolve(rest[0] ?? '.'), wait = Number(flags.wait ?? 5), allow = (flags.allow ?? 'favicon').split(',').filter(Boolean);
const configFile = join(root, 'engine.config.json'), config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
const pages = rest.length > 1 ? rest.slice(1) : (config.pages ?? ['index.html']);
const outDir = mkdtempSync(join(tmpdir(), 'built-smoke-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
try {
  build({ ...config, root, outDir, log: () => {} });
  const server = await serve({ root: outDir, port: 0, liveReload: false });
  try {
    for (const page of pages) {
      const problems = await withChromePage(`${server.url.replace(/\/$/, '')}/${page}`, async (p) => {
        await sleep(wait * 1000);
        return p.errors.filter((e) => !allow.some((a) => String(e).includes(a)));
      }).catch((e) => [`could not open the page: ${e.message}`]);
      if (problems.length) { failed++; console.log(`FAIL ${page}\n${problems.slice(0, 5).map((e) => `  ${String(e).split('\n')[0].slice(0, 220)}`).join('\n')}`); } else console.log(`ok   ${page}`);
    }
  } finally { await server.close(); }
} finally { rmSync(outDir, { recursive: true, force: true }); }
console.log(failed ? `${failed} of ${pages.length} pages failed` : `all ${pages.length} pages loaded cleanly`);
process.exit(failed ? 1 : 0);
