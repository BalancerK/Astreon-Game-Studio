// Live check, in a real Chrome with real clicks, of the sample plugin gallery: the samples are listed with what each may do, one click (and a yes to the permission
// question) installs each, none of them stops, and one that reads the game's numbers works with a running game. Usage: node tools/studio-plugin-gallery-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Plugins"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const install = async (title) => {
      await P(`(() => { p.querySelector('button[aria-label="Install ${title}"]').click(); return 1; })()`);
      await waitFor('!!document.querySelector(".dialog")', 5000);
      await page.eval('(() => { const b = [...document.querySelectorAll(".dialog button")].find((x) => x.textContent === "Install"); b.click(); return 1; })()');
      await waitFor('!document.querySelector(".dialog")', 5000);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Plugin gallery test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Plugin gallery test"', 10_000);
    await S('(s.dock.show("plugins"), 1)');
    check('the Plugins panel lists the six samples with what each is allowed to do', await waitFor('document.querySelectorAll("[aria-label=\\"Plugins\\"] .plugin-gallery .plugin-card").length === 6', 8000)
      && (await P('p.querySelector(".plugin-gallery").textContent.includes("nothing: it cannot see your project")'))
      && (await P('p.querySelector(".plugin-gallery").textContent.includes("see the numbers your running game reports")')));
    if (outDir) writeFileSync(join(outDir, 'plugin-gallery.png'), await page.screenshot());
    for (const title of ['Notepad', 'To-do list', 'Dice and coins', 'TODO finder', 'Number watcher', 'Project statistics']) {
      await install(title);
      check(`"${title}" installs with one click and a yes`, await waitFor(`[...window.studio.plugins.plugins.values()].some((p) => p.manifest.name === ${JSON.stringify(title)})`, 5000));
    }
    await sleep(1500);
    check('all six are on and none has stopped', (await S('s.plugins.plugins.size')) === 6 && (await S('s.plugins.failed.size')) === 0 && (await P('p.querySelectorAll(".plugin-card.on").length')) === 6,
      await S('JSON.stringify([...s.plugins.failed.entries()])'));
    check('the gallery marks the installed ones and offers no second install', (await P('p.querySelectorAll(".plugin-gallery .badge.on").length')) === 6 && (await P('!p.querySelector(".plugin-gallery button")')));
    check('their panels can be shown', await S('(s.dock.show("plugin:notepad:main"), s.dock.show("plugin:todo-list:list"), s.dock.show("plugin:score-watch:watch"), 1)'));
    // the number watcher with a running game, and the TODO finder with a note in the code
    const game = [
      "export function create() { return { n: 0 }; }",
      "export function update(game) { game.n++; }",
      "export function render(game, g) { g.fillStyle = '#123'; g.fillRect(0, 0, 480, 320); }",
      "export function summary(game) { return { n: game.n }; }",
      '// TODO: make the game fun', '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('with a game running, nothing stops', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 60', 15_000));
    await sleep(1500);
    check('still none has stopped', (await S('s.plugins.failed.size')) === 0, await S('JSON.stringify([...s.plugins.failed.entries()])'));
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
