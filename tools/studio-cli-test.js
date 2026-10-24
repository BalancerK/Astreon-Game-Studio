// Live check, in a real Chrome, of the command line: a project folder is made with `new`, served with `serve`, played, and changed on disk, and the open page
// reloads by itself with the change; then `build` writes the game as plain files that play from any web server. Usage: node tools/studio-cli-test.js
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, serveProject } from './studio-cli.js';
import { createServer } from 'node:http';
import { withChromePage } from './cdp.js';

let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const quiet = async (...args) => main(args, () => {});

const root = mkdtempSync(join(tmpdir(), 'studio-cli-live-'));
const game = join(root, 'hero-game');
let served;
let built;
try {
  check('new makes a project folder', (await quiet('new', game, '--template', 'hero')) === 0);
  check('check says it runs', (await quiet('check', game, '--seconds', '3')) === 0);
  served = await serveProject(game, { port: 0 });
  const fingerprint = (page, w, h) => page.eval(`(() => { const d = document.getElementById("game").getContext("2d").getImageData(0, 0, ${w}, ${h}).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; })()`);

  await withChromePage(served.url.replace('127.0.0.1', 'localhost'), async (page) => {
    check('the served game opens with its start button', await page.waitFor('document.getElementById("start") && !document.getElementById("start").hidden', 20_000), page.errors.slice(0, 2).join(' | '));
    check('at the usual size', await page.eval('document.getElementById("game").width === 480 && document.getElementById("game").height === 320'));
    const still = await fingerprint(page, 480, 320);
    await page.eval('document.getElementById("start").click()');
    await page.key('ArrowRight', 'down'); await page.sleep(900); await page.key('ArrowRight', 'up');
    check('and it plays: a key moves the hero', (await fingerprint(page, 480, 320)) !== still);
    // change the folder, as an editor would: a new screen size in project.json
    await page.eval('window.__first = true');
    writeFileSync(join(game, 'project.json'), JSON.stringify({ title: 'Changed on disk', width: 360, height: 640 }));
    check('after a change on disk the open page reloads by itself, with the change',
      await page.waitFor('document.getElementById("game")?.width === 360 && document.getElementById("game").height === 640 && !window.__first', 15_000),
      await page.eval('document.getElementById("game")?.width + "x" + document.getElementById("game")?.height'));
    check('and has the new title', (await page.eval('document.title')) === 'Changed on disk');
    // a mistake in the code shows as a message, not a blank page
    const mainPath = join(game, 'src/main.js');
    const original = readFileSync(mainPath, 'utf8');
    rmSync(mainPath);
    const said = await page.waitFor('document.body.textContent.includes("no src/main.js")', 15_000);
    check('with the main file gone the page says so', said, await page.eval('document.body.textContent.slice(0, 120)'));
    writeFileSync(mainPath, original);
    check('and recovers as soon as it is back', await page.waitFor('!!document.getElementById("game")', 15_000));
    const real = page.errors.filter((e) => !/favicon|willReadFrequently|status of 500/.test(e));          // the 500 is the error page we asked for
    check('no page errors', real.length === 0, real.slice(0, 2).join(' | '));
  });

  // build: plain files that any web server can serve
  const out = join(root, 'site');
  check('build writes the files', (await quiet('build', game, '--out', out)) === 0);
  const types = { html: 'text/html', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json' };
  built = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)) || 'index.html';
    try {
      res.writeHead(200, { 'content-type': `${types[name.split('.').pop()] ?? 'text/plain'}; charset=utf-8` }).end(readFileSync(join(out, name)));
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise((r) => built.listen(0, '127.0.0.1', r));
  await withChromePage(`http://localhost:${built.address().port}/`, async (page) => {
    check('the built game opens from a plain web server', await page.waitFor('document.getElementById("start") && !document.getElementById("start").hidden', 20_000), page.errors.slice(0, 2).join(' | '));
    check('with the size from project.json', await page.eval('document.getElementById("game").width === 360'));
    check('and no page errors', page.errors.filter((e) => !/favicon|willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
  });
} finally {
  served?.server.close();
  built?.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
