// Builds a project the way it is shipped, serves the result and opens every page in headless Chrome: a page that throws, rejects a promise, logs an error or cannot load a file fails the check.
// (The work is `builtSmoke` in `@engine/testkit`.) Usage: node tools/built-smoke.js <project folder> [page.html ...] [--wait=5] [--allow=text,text]
//   With no pages it checks every page in the project's engine.config.json. `--allow` lists texts of messages that are expected (a missing favicon, a game server that is not running).
import { resolve } from 'node:path';
import { builtSmoke } from '../packages/testkit/src/index.js';

const args = process.argv.slice(2), flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('='))), rest = args.filter((a) => !a.startsWith('--'));
const { ok, results } = await builtSmoke(resolve(rest[0] ?? '.'), { pages: rest.length > 1 ? rest.slice(1) : undefined, wait: Number(flags.wait ?? 5), allow: (flags.allow ?? 'favicon').split(',').filter(Boolean) });
for (const r of results) console.log(r.problems.length ? `FAIL ${r.page}\n${r.problems.slice(0, 5).map((e) => `  ${e}`).join('\n')}` : `ok   ${r.page}`);
const failed = results.filter((r) => r.problems.length).length;
console.log(failed ? `${failed} of ${results.length} pages failed` : `all ${results.length} pages loaded cleanly`);
process.exit(ok ? 0 : 1);
