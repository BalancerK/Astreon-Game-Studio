// Live check, in a real Chrome with a real mouse and keyboard, of the Sequences panel: make a sequence from a ready-made one, see its tracks and events on the timeline, select, drag
// and add keys, change a key by typing, add and change an event, play it, nudge a key with the arrow keys, and run a game that plays the sequence: the door is shown, the game is told
// to open it, and the sequence ends. Usage: node tools/studio-sequences-test.js [outDir]
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
const PARSE = 'JSON.parse(window.studio.project.readText("src/sequences.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

const GAME = [
  "import { clear, drawThings, sounds, playSequence, stepSequence, sequenceActive, takeSequenceCommands, drawSequence } from '@engine/arcade';",
  "import all from './sequences.js';",
  "sounds({ door: { wave: 'square', pitch: 300 } });",
  'export function create() {',
  "  const game = { things: [{ kind: 'hero', x: 40, y: 100, w: 20, h: 20, color: '#8b8bff' }, { kind: 'door', x: 200, y: 100, w: 20, h: 40, hidden: true, color: '#c8a064' }],",
  '    camera: { x: 0, y: 0 }, score: 0, nextId: 3, seed: 1, n: 0, opened: 0 };',
  "  playSequence(game, all.door, 'door');",
  '  return game;',
  '}',
  'export function update(game, keys, dt) {',
  '  game.n++;',
  '  if (sequenceActive(game)) stepSequence(game, all.door, dt);',
  "  for (const c of takeSequenceCommands(game)) if (c.name === 'open-door') game.opened++;",
  '}',
  'export function render(game, g) { clear(g); drawThings(g, game); drawSequence(g, game); }',
  'export function summary(game) { return { n: game.n, heroX: game.things[0].x, doorHidden: !!game.things[1].hidden, opened: game.opened, active: sequenceActive(game) }; }', '',
].join(String.fromCharCode(10));

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Sequences"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)} || x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const keyCount = () => P('p.querySelectorAll("circle.seq-key").length');
    const centre = (selector, nth = 0) => P(`(() => { const r = p.querySelectorAll(${JSON.stringify(selector)})[${nth}].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Sequences test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Sequences test"', 10_000);
    await S('(s.commands.execute("workspace.art"), s.dock.show("sequences"), 1)');
    check('with no file the panel offers ready-made sequences', await waitFor('!!document.querySelector("[aria-label=\\"Sequences\\"] .empty button")', 5000) && (await P('p.querySelector(".empty").textContent.includes("cutscene")')));
    await click('A walk sequence');
    check('choosing one writes src/sequences.js with that sequence', await waitFor('window.studio.project.has("src/sequences.js")', 4000) && (await S(`Object.keys(${PARSE}).join()`)) === 'walk');
    check('the timeline shows a dot for every key and a diamond for the event', await waitFor('document.querySelectorAll("[aria-label=\\"Sequences\\"] circle.seq-key").length === 7', 4000)
      && (await P('p.querySelectorAll("path.seq-event").length')) === 1, await keyCount());
    check('every row is named', await P('["hero.x", "camera.x", "screen.fade", "screen.letterbox", "events"].every((n) => p.querySelector("svg").textContent.includes(n))'));
    if (outDir) writeFileSync(join(outDir, 'sequences-walk.png'), await page.screenshot());

    // select a key with a real click, and type a new time
    let [x, y] = await centre('circle.seq-key', 1);
    await page.mouse('mouseMoved', x, y);
    await page.mouse('mousePressed', x, y);
    await page.mouse('mouseReleased', x, y);
    check('clicking a dot selects it and shows it in the inspector', await waitFor('!!document.querySelector("[aria-label=\\"Sequences\\"] .clip-inspector h4") && document.querySelector("[aria-label=\\"Sequences\\"] .clip-inspector h4").textContent === "hero.x"', 3000));
    await P('(() => { const i = p.querySelector("input[aria-label=\\"Time (s)\\"]"); i.value = "2"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('typing a time moves the key, and the file keeps it', await waitFor(`${PARSE}.walk.tracks.hero.x[1][0] === 2`, 4000));
    // drag a key with the mouse
    [x, y] = await centre('circle.seq-key', 1);
    await page.mouse('mouseMoved', x, y);
    await page.mouse('mousePressed', x, y);
    await page.mouse('mouseMoved', x + 40, y);
    await page.mouse('mouseMoved', x + 80, y);
    await page.mouse('mouseReleased', x + 80, y);
    check('dragging a dot sideways changes when it happens', await waitFor(`${PARSE}.walk.tracks.hero.x[1][0] > 2.3`, 4000), await S(`JSON.stringify(${PARSE}.walk.tracks.hero.x)`));
    // click an empty place in a row to add a dot
    const before = await keyCount();
    const [lx, ly] = await centre('rect.seq-hit', 1);
    await page.mouse('mouseMoved', lx - 30, ly);
    await page.mouse('mousePressed', lx - 30, ly);
    await page.mouse('mouseReleased', lx - 30, ly);
    check('clicking an empty place in a row adds a dot', await waitFor(`document.querySelectorAll("[aria-label=\\"Sequences\\"] circle.seq-key").length === ${before + 1}`, 4000));
    // the arrow keys nudge
    await P('(() => { p.querySelector("circle.seq-key.on").focus(); return 1; })()');
    const t0 = await P('Number(p.querySelector("input[aria-label=\\"Time (s)\\"]").value)');
    await press('ArrowRight');
    check('the right arrow moves the key by a little', await waitFor(`Math.abs(Number(document.querySelector("[aria-label=\\"Sequences\\"] input[aria-label=\\"Time (s)\\"]").value) - ${t0} - 0.05) < 0.011`, 3000));
    await press('Delete');
    check('Delete takes the dot away', await waitFor(`document.querySelectorAll("[aria-label=\\"Sequences\\"] circle.seq-key").length === ${before}`, 3000));

    // events
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Add an event at the playhead\\"]"); s.value = "sound"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('adding an event puts a diamond on the timeline and opens it', await waitFor('document.querySelectorAll("[aria-label=\\"Sequences\\"] path.seq-event").length === 2', 4000)
      && (await P('p.querySelector(".clip-inspector h4").textContent')) === 'Play a sound');
    await P('(() => { const i = p.querySelector("input[aria-label=\\"Sound\\"]"); i.value = "boom"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('the event\'s settings are kept', await waitFor(`${PARSE}.walk.events.some((e) => e.kind === "sound" && e.name === "boom")`, 4000));
    check('a sound that does not exist is pointed out', await waitFor('!!document.querySelector("[aria-label=\\"Sequences\\"] details.text-issues:not([hidden])") && document.querySelector("[aria-label=\\"Sequences\\"] details.text-issues").textContent.includes("no sound called")', 4000));
    // play it
    await click('Play the cutscene');
    check('Play runs the little stage and fills in what has happened', await waitFor('document.querySelectorAll("[aria-label=\\"Sequences\\"] .seq-log li").length >= 1', 4000));
    await sleep(400);
    await click('Pause the cutscene');
    // a second sequence from the list
    await P('(() => { const s = p.querySelector("select[aria-label=\\"New sequence from a ready-made one\\"]"); s.value = "door"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('a second sequence is added next to the first', await waitFor(`Object.keys(${PARSE}).sort().join() === "door,walk"`, 4000));
    await P('(() => { const i = [...p.querySelectorAll("input[type=number]")].find((x) => x.getAttribute("aria-label") === "Length (s)"); i.value = "5"; i.dispatchEvent(new Event("change")); return 1; })()');
    check('the length can be changed', await waitFor(`${PARSE}.door.duration === 5`, 4000));
    await P('(() => { const i = [...p.querySelectorAll("input[type=number]")].find((x) => x.getAttribute("aria-label") === "Length (s)"); i.value = "3"; i.dispatchEvent(new Event("change")); return 1; })()');
    await waitFor(`${PARSE}.door.duration === 3`, 4000);
    if (outDir) writeFileSync(join(outDir, 'sequences-door.png'), await page.screenshot());

    // a game that plays it
    await S(`(s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.emit("files"), 1)`);
    await sleep(600);
    await S('(s.run({ restart: true }), 1)');
    check('a game that plays the door sequence: the hero walks, the door is shown, the game is told to open it, and the sequence ends',
      await waitFor('window.studio.runner.status === "running" && window.studio.runner.summary?.active === false && window.studio.runner.summary?.n > 10', 25_000)
      && (await S('s.runner.summary.opened')) === 1 && (await S('s.runner.summary.doorHidden')) === false && (await S('s.runner.summary.heroX')) > 100,
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
