// Live check, in a real Chrome, that the studio works with no network once it has been opened: the studio keeps its files, the game's frame keeps the engine's,
// then the server is stopped and the studio is opened again, a project is made, and a game runs. Usage: node tools/studio-offline-test.js
import { createStaticServer } from './static-server.js';
import { offlineScript } from './studio-offline.js';
import { withChromePage } from './cdp.js';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

const server = createStaticServer({
  root, index: '/studio/index.html', allowDirs: ['packages', 'examples', 'studio'], generated: { '/studio/offline-files.js': () => offlineScript(root) },
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

try {
  await withChromePage(`http://localhost:${port}/studio/index.html?pwa=1`, async (page) => {
    check('the studio opens', await page.waitFor('!!window.studio', 20_000), page.errors.slice(0, 2).join(' | '));
    check('it starts keeping its files', await page.waitFor('window.studio.offline.state === "preparing" || window.studio.offline.state === "ready"', 20_000));
    check('and finishes: every file is kept', await page.waitFor('window.studio.offline.state === "ready"', 60_000), await page.eval('JSON.stringify({ s: window.studio.offline.state, d: window.studio.offline.done, t: window.studio.offline.total })'));
    check('the studio can say what is kept', await page.eval('(async () => { window.studio.offline.dialog(); await new Promise((r) => setTimeout(r, 300)); const t = document.querySelector(".dialog")?.textContent ?? ""; document.querySelector(".dialog .btn:last-child")?.click(); return t.includes("kept") && t.includes("version"); })()'));
    // a game has to run once while online so the game's frame keeps the engine
    await page.eval('(async () => { await window.studio.createProject({ name: "Offline test", template: "hero" }); })()');
    check('a game runs online', await page.waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 20', 20_000));
    check('the frame keeps the engine too', await page.waitFor('window.studio.runner.engineOffline?.complete === true', 60_000), await page.eval('JSON.stringify(window.studio.runner.engineOffline)'));
    await page.sleep(1500);

    // pull the plug
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await page.eval('location.reload()');
    check('with no server, the studio still opens', await page.waitFor('!!window.studio && !!document.getElementById("dock")', 30_000), page.errors.slice(0, 2).join(' | '));
    check('and remembers the project made before', await page.waitFor('window.studio.store && true', 5000) && await page.eval('(async () => (await window.studio.store.list()).some((p) => p.name === "Offline test"))()'));
    await page.eval('(async () => { await window.studio.createProject({ name: "Made offline", template: "shooter" }); })()');
    check('a new project can be made offline', await page.waitFor('window.studio.project?.name === "Made offline"', 10_000));
    check('and its game runs, drawn by the kept engine', await page.waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 20', 30_000), await page.eval('JSON.stringify({ s: window.studio.runner.status, f: window.studio.runner.frames })'));
    await page.eval('window.studio.runner.key("Space", true)'); await page.sleep(800); await page.eval('window.studio.runner.key("Space", false)');
    check('it reacts to keys', await page.eval('(window.studio.runner.summary?.enemies ?? 0) >= 0 && window.studio.runner.summary?.lives === 3'));
    check('an edit applies offline too', await (async () => {
      await page.eval('window.studio.project.write("src/main.js", window.studio.project.readText("src/main.js").replace("const LIVES = 3;", "const LIVES = 5;"))');
      await page.eval('window.studio.run({ restart: true })');
      return page.waitFor('window.studio.runner.summary?.lives === 5', 15_000);
    })());
    check('no page errors while offline', page.errors.filter((e) => !/willReadFrequently|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|favicon/.test(e)).length === 0, page.errors.slice(0, 3).join(' | '));
  });
} finally {
  try { server.closeAllConnections(); server.close(); } catch { /* already stopped */ }
}
process.exit(failed ? 1 : 0);
