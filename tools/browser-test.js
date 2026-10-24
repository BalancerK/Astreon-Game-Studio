// Run a page in a headless browser and collect the JSON it POSTs to /report.
// Usage: node tools/browser-test.js <path-under-repo, e.g. /packages/render/browser-test/selftest.html> [--firefox] [--visible]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './static-server.js';
import { guardBrowser } from './browser-guard.js';

const PATHS = {
  chrome: [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ],
  firefox: [
    process.env.FIREFOX_PATH,
    'C:/Program Files/Mozilla Firefox/firefox.exe',
    'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
    '/usr/bin/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox',
  ],
};

/** @param {'chrome' | 'firefox'} browser @returns {string | undefined} */
export const findBrowser = (browser = 'chrome') => PATHS[browser].filter(Boolean).find((p) => existsSync(p));
export const findChrome = () => findBrowser('chrome');

/**
 * @param {string} pagePath
 * @param {{browser?: 'chrome' | 'firefox', timeoutMs?: number, flags?: string[], visible?: boolean, allowDirs?: string[]}} [o]
 * @returns {Promise<any>} The reported JSON.
 */
export async function runBrowserPage(pagePath, { browser = 'chrome', timeoutMs = 30_000, flags = [], visible = false, allowDirs } = {}) {
  const exe = findBrowser(browser);
  if (!exe) throw new Error(`no ${browser} found (set ${browser === 'chrome' ? 'CHROME_PATH' : 'FIREFOX_PATH'})`);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let report;
  let onReport;
  const reported = new Promise((r) => { onReport = r; });
  const server = createStaticServer({
    root,
    ...(allowDirs ? { allowDirs } : {}),
    handle: (req, res) => {
      if (req.method !== 'POST' || req.url !== '/report') return false;
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try { report = JSON.parse(Buffer.concat(chunks).toString()); } catch { report = { error: 'unparseable report' }; }
        res.writeHead(204).end();
        onReport();
      });
      return true;
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${pagePath}`;
  const profile = mkdtempSync(join(tmpdir(), `engine-${browser}-`));
  let args;
  if (browser === 'firefox') {
    writeFileSync(join(profile, 'user.js'), [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("app.update.enabled", false);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("startup.homepage_welcome_url", "");',
      'user_pref("browser.tabs.warnOnClose", false);',
    ].join('\n'));
    args = [...(visible ? [] : ['-headless']), '-no-remote', '-profile', profile, ...flags, url];
  } else {
    args = [
      ...(visible ? [] : ['--headless=new']),
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      ...flags, url,
    ];
  }
  const proc = spawn(exe, args, { stdio: 'ignore' });
  const guard = guardBrowser(proc, profile);                      // the browser never outlives this process, however it ends
  let timer;
  try {
    await Promise.race([
      reported,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no report from ${pagePath} in ${browser} within ${timeoutMs} ms`)), timeoutMs); }),
    ]);
    return report;
  } finally {
    clearTimeout(timer);
    guard.stop();
    server.close();
    server.closeAllConnections?.();
    await new Promise((r) => setTimeout(r, 400));
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold files */ }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const page = process.argv[2];
  if (!page) { console.error('usage: node tools/browser-test.js <page path> [--firefox] [--visible]'); process.exit(2); }
  const report = await runBrowserPage(page, { browser: process.argv.includes('--firefox') ? 'firefox' : 'chrome', visible: process.argv.includes('--visible') });
  console.log(JSON.stringify(report, null, 2));
}
