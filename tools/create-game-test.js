// The whole new-user path, for real: pack the engine as npm would publish it, make a project from each template, install it from those
// tarballs, run the project's own tests, run its dev server and its production build, and open both in Chrome.
// Usage: node tools/create-game-test.js
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { pack, npm } from './release-lib.js';
import { createProject } from '../packages/create-game/src/index.js';
import { serve } from '../packages/build/src/index.js';
import { withChromePage } from './cdp.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

const work = mkdtempSync(join(tmpdir(), 'engine-newuser-'));
try {
  const tarballs = join(work, 'tarballs');
  const packed = await pack(root, tarballs);
  check('every package packs cleanly', packed.every((p) => p.problems.length === 0), packed.flatMap((p) => p.problems).join('; '));

  for (const template of ['2d', '3d', 'multiplayer']) {
    console.log(`--- template ${template}`);
    const dir = join(work, `game-${template}`);
    createProject({ dir, template, name: `my-${template}-game` });
    // the project asks for ^0.1.0 from the registry; installing the tarballs by hand stands in for the registry
    npm(['install', '--no-audit', '--no-fund', '--offline', ...packed.map((p) => join(tarballs, p.file))], { cwd: dir });
    check('the project installs from the packed engine', existsSync(join(dir, 'node_modules/@engine/render/src/index.js')));

    const tests = run(process.execPath, ['--test'], dir);
    check('the project\'s own tests pass', /fail 0/.test(tests) && /pass [1-9]/.test(tests), tests.match(/(pass|fail) \d+/g)?.join(' '));

    if (template === 'multiplayer') {
      // the game's own server serves the page, the API and the sockets; try it from source, then built
      const serverJs = join(dir, 'server/main.js');
      const runServer = async (extra) => {
        const port = await freePort();
        const proc = spawn(process.execPath, [serverJs, '--port', String(port), '--mode', 'inline', ...extra], { cwd: dir, stdio: 'pipe' });
        const url = `http://127.0.0.1:${port}/`;
        let up = false;
        for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`${url}api/leaderboard`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
        return { proc, url, up };
      };
      const openAndPlay = async (url, label) => withChromePage(url, async (p) => {
        check(`${label}: the menu opens with a guest account`, await p.waitFor('document.getElementById("menu") && !document.getElementById("menu").hidden && /rating 1000/.test(document.getElementById("who").textContent)', 20_000), p.errors.slice(0, 2).join(' | '));
        const r = JSON.parse(await p.eval('(() => { const b = document.getElementById("play-bots").getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()'));
        await p.mouse('mouseMoved', r.x, r.y); await p.mouse('mousePressed', r.x, r.y); await p.mouse('mouseReleased', r.x, r.y);
        check(`${label}: a table with robots starts`, await p.waitFor('window.__client && window.__client.state === "playing"', 20_000));
        check(`${label}: no page errors`, p.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, p.errors.slice(0, 2).join(' | '));
      });
      const dev = await runServer([]);
      try {
        check('npm run dev (the game server) starts', dev.up);
        const page = await (await fetch(dev.url)).text();
        check('the page carries the import map for @engine/*', /<script type="importmap">/.test(page));
        await openAndPlay(dev.url, 'from source');
      } finally { dev.proc.kill(); }
      const outM = run(process.execPath, [join(dir, 'node_modules/@engine/build/src/cli.js'), 'build'], dir);
      check('npm run build succeeds', /files, .* KB in/.test(outM), outM.split(String.fromCharCode(10)).pop());
      const built = await runServer(['--root', 'dist']);
      try { check('the server serves the built page', built.up); await openAndPlay(built.url, 'built'); } finally { built.proc.kill(); }
      continue;
    }

    // --- the dev server (through the project's own installed build tool)
    const port = await freePort();
    const devProc = spawn(process.execPath, [join(dir, 'node_modules/@engine/build/src/cli.js'), 'dev', '--port', String(port)], { cwd: dir, stdio: 'pipe' });
    const devUrl = `http://127.0.0.1:${port}/`;
    try {
      let up = false;
      for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(devUrl)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
      check('npm run dev serves the project', up);
      const page = await (await fetch(devUrl)).text();
      check('the dev server tells the browser where @engine/* is (import map)', /<script type="importmap">/.test(page) && page.includes('/@modules/@engine/render/src/index.js'));
      await withChromePage(devUrl, async (p) => {
        const ready = await p.waitFor(template === '2d' ? 'window.__game && window.__game.state' : 'window.__play && window.__play.loaded.instances.size === 8', 15_000);
        check('the game starts in the browser (from source)', ready, p.errors.slice(0, 2).join(' | '));
        if (template === '2d') {
          await p.key('KeyD'); await p.sleep(500); await p.key('KeyD', 'up');
          check('and responds to the keyboard', (await p.eval('window.__game.state.player.x')) > 410, String(await p.eval('window.__game.state.player.x')));
        } else {
          await p.sleep(600);
          const y0 = await p.eval("window.__play.yawOf('spinner-1')"); await p.sleep(700);
          check('and its spinners turn', Math.abs((await p.eval("window.__play.yawOf('spinner-1')")) - y0) > 0.5);
        }
        check('with no page errors', p.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, p.errors.slice(0, 2).join(' | '));
      });
      if (template === '3d') {
        await withChromePage(`${devUrl}editor.html`, async (p) => {
          const ready = await p.waitFor('window.__editor && window.__editor.doc.size === 8', 15_000);
          check('the scene editor opens the project\'s scene', ready, p.errors.slice(0, 2).join(' | '));
          await p.eval('window.__editor.doc.update("ball-1", { at: { x: 7 } }); 0');
          await p.eval('window.__editor.save(); 0'); await p.sleep(500);
          const saved = JSON.parse(readFileSync(join(dir, 'scenes/main.json'), 'utf8'));
          check('and saves the edited scene into the project\'s own file', saved.entities.find((e) => e.id === 'ball-1').at.x === 7);
          check('with no page errors', p.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, p.errors.slice(0, 2).join(' | '));
        });
      }
    } finally { devProc.kill(); }

    // --- the production build
    const out = run(process.execPath, [join(dir, 'node_modules/@engine/build/src/cli.js'), 'build'], dir);
    check('npm run build succeeds', /files, .* KB in/.test(out), out.split('\n').pop());
    const dist = join(dir, 'dist');
    const files = readdirSync(dist, { recursive: true }).map(String);
    check('the build has a hashed bundle, a manifest and compressed copies', files.some((f) => /^src[\\/]main\.[0-9a-f]{8}\.js$/.test(f)) && files.includes('manifest.json') && files.some((f) => f.endsWith('.br')), files.slice(0, 8).join(' '));
    const built = await serve({ root: dist, port: 0, liveReload: false });
    try {
      await withChromePage(built.url, async (p) => {
        const ready = await p.waitFor(template === '2d' ? 'window.__game && window.__game.state' : 'window.__play && window.__play.loaded.instances.size === 8', 15_000);
        check('the built game starts', ready, p.errors.slice(0, 2).join(' | '));
        if (template === '3d') check('and loaded its scene through the hashed manifest', await p.eval('performance.getEntriesByType("resource").some((r) => /scenes\\/main\\.[0-9a-f]{8}\\.json/.test(r.name))'));
        check('with no page errors', p.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, p.errors.slice(0, 2).join(' | '));
      });
    } finally { await built.close(); }
  }
} catch (e) {
  failed = true; console.log('FAIL', e.stack ?? e.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
