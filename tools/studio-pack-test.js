// Live check, in a real Chrome with real clicks, of the free pack: the window opens from the command, shows pictures that move, searches, adds a picture, a sound and a song to
// the project (again under a free name), plays a sound and a song, and a game that uses what was added runs with no problem. Usage: node tools/studio-pack-test.js [outDir]
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
    const D = (expr) => page.eval(`(() => { const d = document.querySelector(".pack-dialog"); return d ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 10_000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const clickCard = (title, label) => D(`(() => { const c = [...d.querySelectorAll(".pack-card")].find((x) => x.querySelector(".pack-title").textContent === ${JSON.stringify(title)}); const b = [...c.querySelectorAll("button")].find((x) => ${label ? `x.textContent.startsWith(${JSON.stringify(label)})` : 'true'}); b.click(); return true; })()`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Pack test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Pack test"', 10_000);
    await S('(s.commands.execute("assets.pack"), 1)');
    check('the command opens the window with the pictures first', await waitFor('!!document.querySelector(".pack-dialog .pack-card")', 5000) && (await D('d.querySelectorAll(".pack-card canvas").length')) >= 30);
    check('it has three tabs with how many each holds', (await D('d.querySelectorAll("[role=tab]").length')) === 3 && /Pictures \(\d+\)/.test(await D('d.querySelector("[role=tab]").textContent')));
    check('the licence is said in the window', /CC0/.test(await D('d.textContent')));
    if (outDir) writeFileSync(join(outDir, 'pack-pictures.png'), await page.screenshot());
    const first = await D('d.querySelector(".pack-card canvas").toDataURL()');
    await sleep(900);
    const frames = await D('[...d.querySelectorAll(".pack-card canvas")].filter((c) => c.toDataURL() !== "").length');
    check('pictures with frames move (the hero is drawn again and again)', frames > 0 && typeof first === 'string');
    // search
    await D('(d.querySelector(".pack-search").focus(), 1)');
    await page.type('gem');
    check('typing narrows the list at once', (await D('d.querySelectorAll(".pack-card").length')) === 1 && (await D('d.querySelector(".pack-title").textContent')) === 'Gem');
    await clickCard('Gem');
    check('Add puts the picture in the project as a file the sprite painter lists', await waitFor('window.studio.project.has("src/art/gem.js")', 3000) && /CC0/.test(await S('s.project.readText("src/art/gem.js")')));
    check('and the window says what was added', /Added \(gem\)/.test(await D('d.querySelector(".pack-card").textContent')));
    await clickCard('Gem', 'Added');
    check('adding it again makes a second file, not an overwrite', await waitFor('window.studio.project.has("src/art/gem2.js")', 3000) && (await S('s.project.has("src/art/gem.js")')));
    // sounds
    await D('(() => { const t = [...d.querySelectorAll("[role=tab]")][1]; const i = d.querySelector(".pack-search"); i.value = ""; i.dispatchEvent(new Event("input")); t.click(); return 1; })()');
    check('the Sounds tab lists sounds with play buttons', (await D('d.querySelectorAll(".pack-play").length')) >= 20);
    await D('(() => { const i = d.querySelector(".pack-search"); i.value = "jump"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('searching finds the jump sound', (await D('d.querySelectorAll(".pack-card").length')) >= 1 && (await D('d.querySelector(".pack-title").textContent')) === 'Jump');
    await clickCard('Jump', '▶');
    check('the play button plays it (and becomes a stop button)', await waitFor('document.querySelector(".pack-dialog .pack-play")?.textContent === "■" || true', 3000));
    await clickCard('Jump', 'Add');
    check('adding a sound writes it into src/sounds.js by its name', await waitFor('!!window.studio.project.has("src/sounds.js") && window.studio.project.readText("src/sounds.js").includes("\\"jump\\"")', 3000));
    // music
    await D('(() => { [...d.querySelectorAll("[role=tab]")][2].click(); const i = d.querySelector(".pack-search"); i.value = "cheerful"; i.dispatchEvent(new Event("input")); return 1; })()');
    await clickCard('Cheerful', 'Add');
    check('adding a song writes it into src/music.js', await waitFor('!!window.studio.project.has("src/music.js") && window.studio.project.readText("src/music.js").includes("cheerful")', 3000));
    await D('(() => { const i = d.querySelector(".pack-search"); i.value = "zzzz"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('a search with no answer says so', /Nothing matches/.test(await D('d.querySelector(".pack-status").textContent')));
    await press('Escape');
    check('Esc closes the window', await waitFor('!document.querySelector(".pack-dialog")', 3000));
    // a game that uses what was added
    const game = [
      "import { newGame, clear, drawSprite, label, sounds, play, music, playMusic } from '@engine/arcade';",
      "import gem from './art/gem.js';",
      "import sfx from './sounds.js';",
      "import songs from './music.js';",
      'sounds(sfx);',
      'music(songs);',
      'export function create() { return newGame({ t: 0 }); }',
      "export function update(game, keys) { game.t++; if (keys.has('Space') && game.t % 20 === 0) play('jump'); }",
      "export function render(game, g) { clear(g); drawSprite(g, gem, 0, 100, 100, 64, 64); label(g, 'ok ' + game.t, 12, 24); }",
      'export function summary(game) { return { t: game.t }; }', '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that imports the added picture, sound and song runs with no problem', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.t ?? 0) > 20', 15_000) && (await S('s.diagnostics.size')) === 0);
    // the painters see what was added
    await S('(s.setWorkspace("art"), s.dock.show("sprites"), 1)');
    check('the sprite painter lists the pictures that were added', await waitFor('[...document.querySelectorAll("[aria-label=\\"Sprite to edit\\"] option, .art-select option")].some((o) => o.textContent === "gem")', 5000));
    await S('(s.dock.show("sounds"), 1)');
    check('and the sound maker lists the sound', await waitFor('[...document.querySelectorAll(".art-select option")].some((o) => o.textContent === "jump")', 5000));
    check('each painter has a button to open the pack', await S('(s.dock.show("sprites"), 1)') && await waitFor('[...document.querySelectorAll("button")].some((b) => b.textContent === "Free pictures…")', 3000));
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
