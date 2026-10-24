// Live check, in a real Chrome with a real mouse, of kinds with typed fields, names and pointers: make a door and a button in the Kinds panel, change a template and add, change and remove
// fields, then in the Scene panel name a door, point a button at it, see that renaming the door keeps the link, place a new door and get its template and fields, see problems
// pointed out, and run a game that loads the scene with the kinds and follows the pointer. Usage: node tools/studio-kinds-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { serializeScene } from '../studio/app/paint/scene-model.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KINDS = 'JSON.parse(window.studio.project.readText("src/kinds.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';
const SCENE = 'JSON.parse(window.studio.project.readText("scenes/rooms.js").replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))';

const SCENE_TEXT = serializeScene({ w: 480, h: 320, things: [
  { kind: 'door', x: 300, y: 100, w: 32, h: 48, color: '#c8a064' },
  { kind: 'button', x: 60, y: 200, w: 24, h: 12, color: '#d94f4f' },
] });
const GAME = [
  "import { clear, drawThings, loadScene, refOf } from '@engine/arcade';",
  "import kinds from './kinds.js';",
  "import scene from '../scenes/rooms.js';",
  'export function create() {',
  '  const game = { things: [], camera: { x: 0, y: 0 }, score: 0, nextId: 1, seed: 1, n: 0 };',
  '  loadScene(game, scene, kinds);',
  '  return game;',
  '}',
  'export function update(game) { game.n++; }',
  'export function render(game, g) { clear(g); drawThings(g, game); }',
  "export function summary(game) { const b = game.things.find((t) => t.kind === 'button'); const d = refOf(game, b, 'opens'); return { n: game.n, pointsAtDoor: !!d && d.kind === 'door', locked: d?.locked, delay: b.delay, doorName: d?.name }; }", '',
].join(String.fromCharCode(10));

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const K = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Kinds"]'); return p ? (${expr}) : null; })()`);
    const SC = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Scene editor"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const kclick = (label) => K(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)} || x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const setIn = (root, label, value, event = 'change') => page.eval(`(() => { const p = document.querySelector('[aria-label="${root}"]'); const i = [...p.querySelectorAll("input,select")].find((x) => x.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!i) return false; if (i.type === "checkbox") i.checked = ${JSON.stringify(value)}; else i.value = ${JSON.stringify(String(value))}; i.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); return true; })()`);
    const pickItem = (n) => SC(`(() => { p.querySelectorAll(".scene-item")[${n}].click(); return 1; })()`);

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Kinds test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Kinds test"', 10_000);
    await S('(s.commands.execute("workspace.art"), s.dock.show("kinds"), 1)');
    check('with no file the panel offers ready-made kinds', await waitFor('!!document.querySelector("[aria-label=\\"Kinds\\"] .empty button")', 5000) && (await K('p.querySelector(".empty").textContent.includes("A door")')));
    await kclick('A door');
    check('choosing one writes src/kinds.js with a locked flag', await waitFor('window.studio.project.has("src/kinds.js")', 4000) && (await S(`${KINDS}.door.fields.locked.type`)) === 'flag');
    await K('(() => { const s = p.querySelector("select[aria-label=\\"New kind from a ready-made one\\"]"); s.value = "button"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('a button kind is added with a pointer to a door', await waitFor(`${KINDS}.button?.fields.opens.type === "ref" && ${KINDS}.button.fields.opens.to === "door"`, 4000));
    await K('(() => { const s = p.querySelector("select[aria-label=\\"Kind to edit\\"]"); s.value = "door"; s.dispatchEvent(new Event("change")); return 1; })()');
    await setIn('Kinds', 'Width', 40);
    check('the template can change, and the file keeps it', await waitFor(`${KINDS}.door.template.w === 40`, 4000));
    // add a field through the dialog
    await K('(() => { const s = p.querySelector("select[aria-label=\\"Type of the new field\\"]"); s.value = "number"; s.dispatchEvent(new Event("change")); return 1; })()');
    await kclick('Add a field');
    await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
    await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
    await page.type('hp');
    await press('Enter');
    check('a number field is added through the dialog', await waitFor(`${KINDS}.door.fields.hp?.type === "number"`, 4000));
    await setIn('Kinds', 'Largest', 9);
    await setIn('Kinds', 'Starts at', 50);
    check('its smallest, largest and start are kept in range', await waitFor(`${KINDS}.door.fields.hp.max === 9 && ${KINDS}.door.fields.hp.default === 9`, 4000), await S(`JSON.stringify(${KINDS}.door.fields.hp)`));
    await setIn('Kinds', 'Type of hp', 'choice');
    check('changing the type gives a choice with something to choose from', await waitFor(`${KINDS}.door.fields.hp.type === "choice" && ${KINDS}.door.fields.hp.choices.length >= 2`, 4000));
    await kclick('Remove the field hp');
    check('a field can be removed', await waitFor(`!("hp" in ${KINDS}.door.fields)`, 4000));
    if (outDir) writeFileSync(join(outDir, 'kinds-panel.png'), await page.screenshot());

    // the scene: name the door, point the button at it
    await S(`(s.project.write("scenes/rooms.js", ${JSON.stringify(SCENE_TEXT)}), s.emit("files"), s.dock.show("scene2d"), 1)`);
    check('the Scene panel opens the scene', await waitFor('document.querySelectorAll("[aria-label=\\"Scene editor\\"] .scene-item").length === 2', 6000));
    await pickItem(0);
    check('a door shows its own field in the inspector', await waitFor('!!document.querySelector("[aria-label=\\"Scene editor\\"] input[aria-label=\\"locked\\"]")', 3000));
    await setIn('Scene editor', 'Name of this thing', 'front');
    check('a thing can be given a name', await waitFor(`${SCENE}.things[0].extra?.name === "front"`, 4000));
    await pickItem(1);
    check('the button has a pointer field that offers the named door', await waitFor('!!document.querySelector("[aria-label=\\"Scene editor\\"] select[aria-label=\\"opens\\"]")', 3000)
      && (await SC('[...p.querySelector("select[aria-label=\\"opens\\"]").options].map((o) => o.textContent).join()')).includes('front'));
    await setIn('Scene editor', 'opens', 'front');
    check('choosing the door writes the pointer into the scene', await waitFor(`${SCENE}.things[1].extra?.opens === "front"`, 4000));
    await setIn('Scene editor', 'delay', 99);
    check('a number field is held to its largest', await waitFor(`${SCENE}.things[1].extra?.delay === 10`, 4000));
    if (outDir) writeFileSync(join(outDir, 'kinds-scene.png'), await page.screenshot());
    await pickItem(0);
    await setIn('Scene editor', 'Name of this thing', 'gate');
    check('renaming the door moves the pointer to the new name', await waitFor(`${SCENE}.things[1].extra.opens === "gate" && ${SCENE}.things[0].extra.name === "gate"`, 4000));
    // a name that is taken
    await pickItem(1);
    await setIn('Scene editor', 'Name of this thing', 'gate');
    check('a name that another thing has is refused with a message', await waitFor('/already called/.test(document.querySelector("[aria-label=\\"Scene editor\\"] .level-notes").textContent)', 3000));
    // place a new door with the template
    await SC('(() => { const b = [...p.querySelectorAll(".scene-kinds button")].find((x) => x.textContent === "door"); b.click(); return 1; })()');
    const box = await SC('(() => { const r = p.querySelector("canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()');
    await page.mouse('mouseMoved', box[0] + box[2] * 0.2, box[1] + box[3] * 0.2);
    await page.mouse('mousePressed', box[0] + box[2] * 0.2, box[1] + box[3] * 0.2);
    await page.mouse('mouseReleased', box[0] + box[2] * 0.2, box[1] + box[3] * 0.2);
    check('a door placed with the mouse gets the template (40 wide) and the locked field', await waitFor(`${SCENE}.things.length === 3 && ${SCENE}.things[2].w === 40 && ${SCENE}.things[2].extra?.locked === true && !${SCENE}.things[2].extra.name`, 4000), await S(`JSON.stringify(${SCENE}.things[2])`));
    // a pointer to nothing is pointed out
    await S(`(s.project.write("scenes/rooms.js", ${JSON.stringify(SCENE_TEXT.replace('"color":"#d94f4f"', '"color":"#d94f4f","extra":{"opens":"nowhere"}'))}), s.emit("files"), 1)`);
    await sleep(500);
    await pickItem(1);
    check('a pointer to a name nothing has is listed as a problem', await waitFor('/nowhere/.test(document.querySelector("[aria-label=\\"Scene editor\\"] .scene-issues").textContent)', 5000));

    // a game that follows the pointer
    await S(`(s.project.write("scenes/rooms.js", ${JSON.stringify(SCENE_TEXT.replace('"color":"#c8a064"', '"color":"#c8a064","extra":{"name":"front"}').replace('"color":"#d94f4f"', '"color":"#d94f4f","extra":{"opens":"front"}'))}), `
      + `s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.emit("files"), 1)`);
    await sleep(600);
    await S('(s.run({ restart: true }), 1)');
    check('a game that loads the scene with the kinds follows the pointer, and gets the defaults',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 5', 15_000)
      && (await S('s.runner.summary.pointsAtDoor')) === true && (await S('s.runner.summary.locked')) === true && (await S('s.runner.summary.delay')) === 0 && (await S('s.runner.summary.doorName')) === 'front',
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
