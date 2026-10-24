// Live check, in a real Chrome with a real keyboard and mouse, of the Story panel: start a story, see it as a map, write a node by typing, break it and see the problem, add and
// rename nodes, play it in the preview with the real dialogue box, send the lines to the Text panel, and run a game that plays the story. Usage: node tools/studio-story-test.js [outDir]
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
const FILE_TEXT = 'window.studio.project.readText("src/dialogue.js")';

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Story"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await sleep(40); await page.key(code, 'up'); await sleep(40); };
    const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };
    const nodes = () => P('[...p.querySelectorAll("[data-node]")].map((n) => n.dataset.node).join()');
    const lit = () => P('(() => { const c = p.querySelector("canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 120 || d[i + 1] > 120) n++; return n; })()');

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Story test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Story test"', 10_000);
    await S('(s.dock.show("story"), 1)');
    check('the Story panel offers to start a story', await waitFor('!!document.querySelector("[aria-label=\\"Story\\"]")', 5000) && (await P('p.textContent.includes("No story yet")')));
    await click('Start a story');
    check('a story is started: the file is real JavaScript holding the text, and the map shows start and thanks', await waitFor('window.studio.project.has("src/dialogue.js")', 3000)
      && (await S(`new Function(${FILE_TEXT}.replace("export default", "return"))().includes("== start ==")`)) && (await nodes()) === 'start,thanks');
    await sleep(900);
    check('the preview plays the real dialogue box (speaker and words are drawn)', (await lit()) > 300, String(await lit()));
    if (outDir) writeFileSync(join(outDir, 'story-panel.png'), await page.screenshot());
    check('nothing is flagged for the starter story', await P('p.querySelector(".text-issues")?.hidden === true'));
    // play with the keyboard
    await P('(() => { p.querySelector("canvas").focus(); return 1; })()');
    await press('Enter');
    await sleep(100);
    await press('Enter');
    await sleep(200);
    await press('Enter');
    await sleep(200);
    await press('Digit1');
    await sleep(300);
    check('choosing "Yes, here it is." with the number key runs <<set trust += 1>> (the readout shows it)', /trust = 1/.test(await P('p.querySelector(".particle-count").textContent')), await P('p.querySelector(".particle-count").textContent'));
    // write a node
    await P('(() => { p.querySelector("[data-node=thanks]").dispatchEvent(new MouseEvent("click", { bubbles: true })); return 1; })()');
    check('clicking a node in the map picks it and shows its words', await waitFor('document.querySelector("[aria-label=\\"Story\\"] textarea.story-text")?.getAttribute("aria-label") === "Words of the node thanks"', 3000));
    await P('(() => { const t = p.querySelector("textarea.story-text"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return 1; })()');
    await press('Enter');
    await page.type('Sam: Bye for now!');
    check('typing in the node is saved in the file', await waitFor(`${FILE_TEXT}.includes("Sam: Bye for now!")`, 3000));
    // break it
    await P('(() => { p.querySelector("[data-node=start]").dispatchEvent(new MouseEvent("click", { bubbles: true })); return 1; })()');
    await waitFor('document.querySelector("[aria-label=\\"Story\\"] textarea.story-text")?.getAttribute("aria-label") === "Words of the node start"', 3000);
    await P('(() => { const t = p.querySelector("textarea.story-text"); t.value = t.value.replace("<<goto thanks>>", "<<goto thnks>>"); t.dispatchEvent(new Event("input")); return 1; })()');
    check('a <<goto>> to a node that is not there is reported, and the node nothing leads to is marked on the map', await waitFor('/thnks/.test(document.querySelector("[aria-label=\\"Story\\"] .text-issues")?.textContent ?? "")', 3000)
      && (await P('p.querySelector("[data-node=thanks]").classList.contains("bad")')) && (await P('/Nothing leads to "thanks"/.test(p.querySelector(".text-issues").textContent)')));
    await P('(() => { const t = p.querySelector("textarea.story-text"); t.value = t.value.replace("<<goto thnks>>", "<<goto thanks>>"); t.dispatchEvent(new Event("input")); return 1; })()');
    check('putting it right clears the problems', await waitFor('document.querySelector("[aria-label=\\"Story\\"] .text-issues")?.hidden === true', 3000));
    // add and rename nodes
    await click('Add a node');
    await answer('cave');
    check('Add a node makes it, picks it, and (as nothing leads to it) says so', await waitFor('/Nothing leads to "cave"/.test(document.querySelector("[aria-label=\\"Story\\"] .text-issues")?.textContent ?? "")', 3000) && (await nodes()).includes('cave'));
    await P('(() => { p.querySelector("[data-node=thanks]").dispatchEvent(new MouseEvent("click", { bubbles: true })); return 1; })()');
    await waitFor('document.querySelector("[aria-label=\\"Story\\"] textarea.story-text")?.getAttribute("aria-label") === "Words of the node thanks"', 3000);
    await click('Rename');
    await answer('gratitude');
    check('renaming a node changes every <<goto>> that pointed at it', await waitFor(`${FILE_TEXT}.includes("<<goto gratitude>>") && !${FILE_TEXT}.includes("<<goto thanks>>")`, 3000));
    // lines to the Text panel
    await click(await P('[...p.querySelectorAll("button")].find((b) => /^Send the \\d+ lines/.test(b.textContent)).textContent'));
    check('sending the lines to the Text panel makes src/text.js with a key for every line', await waitFor('window.studio.project.has("src/text.js") && window.studio.project.readText("src/text.js").includes("story.start.1")', 3000));
    // a game that plays the story
    const game = [
      "import { story, startStory, storyState, advanceStory, chooseStory, storyVar, storyActive } from '@engine/arcade';",
      "import dialogue from './dialogue.js';",
      'story(dialogue);',
      'export function create() { const g = { n: 0, said: [] }; startStory(g, \'start\'); return g; }',
      'export function update(g) {',
      '  g.n++;',
      '  const s = storyState(g);',
      "  if (g.n === 5) g.said.push(s.line.text);",
      '  if (g.n === 6) advanceStory(g);',
      '  if (g.n === 7) chooseStory(g, 0);',
      '  if (g.n === 8) advanceStory(g);',
      '}',
      "export function render(g, ctx) { ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 480, 320); }",
      "export function summary(g) { const s = storyState(g); return { n: g.n, first: g.said[0], line: s.line?.text, node: s.node, trust: storyVar(g, 'trust'), active: storyActive(g) ? 1 : 0 }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.emit("files"), s.run({ restart: true }), 1)`);
    check('a game that plays the story runs: it says the first line, takes the choice, and the story moves on with trust set',
      await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 12', 15_000)
      && /Hello there/.test(await S('s.runner.summary.first')) && (await S('s.runner.summary.trust')) === 1 && (await S('s.runner.summary.node')) === 'gratitude', await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
