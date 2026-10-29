// Does a project's built pages load? Build the project as it ships, serve the result and open every page in headless Chrome: a page that throws, rejects a promise, logs an error or cannot load a file
// fails. Tests that run the source in Node cannot see what the bundler does to it (a name used before its import line, an export that went missing, a script that does not parse); the built page can.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, serve } from '@engine/build';
import { withChromePage } from './chrome.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a project the way it ships, serve it and open each page in headless Chrome, collecting what goes wrong.
 * @param {string} root the project folder (its `engine.config.json` says how it is built)
 * @param {{pages?: string[], wait?: number, allow?: string[], args?: string[]}} [o] `pages` default to the config's; `wait` seconds on each page (5); `allow` texts of messages that are expected
 * (default `favicon`): a missing icon, a game server that is not running; `args` more Chrome flags
 * @returns {Promise<{ok: boolean, results: Array<{page: string, problems: string[]}>}>}
 */
export async function builtSmoke(root, { pages, wait = 5, allow = ['favicon'], args = [] } = {}) {
  root = resolve(root);
  const configFile = join(root, 'engine.config.json'), config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
  const list = pages ?? config.pages ?? ['index.html'];
  const outDir = mkdtempSync(join(tmpdir(), 'built-smoke-'));
  const results = [];
  try {
    build({ ...config, root, outDir, log: () => {} });
    const server = await serve({ root: outDir, port: 0, liveReload: false });
    try {
      for (const page of list) {
        const problems = await withChromePage(`${server.url.replace(/\/$/, '')}/${page}`, async (p) => {
          await sleep(wait * 1000);
          return p.errors.filter((e) => !allow.some((a) => String(e).includes(a))).map((e) => String(e).split('\n')[0].slice(0, 300));
        }, { args }).catch((e) => [`could not open the page: ${e.message}`]);
        results.push({ page, problems });
      }
    } finally { await server.close(); }
  } finally { rmSync(outDir, { recursive: true, force: true }); }
  return { ok: results.every((r) => r.problems.length === 0), results };
}
