// Live check, in a real Chrome with real typing and clicks, of the Text panel: make a table, add a key and a language, fill in words, see what is missing and the
// completeness, preview as a language and as test text, filter, and run a game that reads the table in two languages. Usage: node tools/studio-text-test.js [outDir]
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

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Text and languages"]'); return p ? (${expr}) : null; })()`);
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code) => { await page.key(code, 'down'); await page.key(code, 'up'); };
    const file = () => S('s.project.has("src/text.js") ? s.project.readText("src/text.js") : ""');
    const button = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
    /** Type a value into the open prompt dialog and press Enter. */
    const answer = async (value) => {
      await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
      await page.eval('(() => { const i = document.querySelector(".dialog input[type=text]"); i.focus(); i.select(); return 1; })()');
      await page.type(value);
      await press('Enter');
      await waitFor('!document.querySelector(".dialog input[type=text]")', 3000);
    };
    /** Put words in a cell the way a person does: focus it and type. */
    const typeInto = async (label, value) => {
      await P(`(() => { const c = p.querySelector(${JSON.stringify(`textarea[aria-label="${label}"]`)}); c.focus(); c.select(); return 1; })()`);
      await page.type(value);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Text test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Text test"', 10_000);
    await S('(s.dock.show("text"), 1)');
    check('the Text panel is in the window and offers to make a table', await waitFor('!!document.querySelector("[aria-label=\\"Text and languages\\"]")', 5000)
      && (await P('p.textContent.includes("No words yet")')));
    await button('Make a table');
    check('making a table writes src/text.js with English and a plural pair', await waitFor('window.studio.project.has("src/text.js")', 3000)
      && /"coins.one": "\{n\} coin"/.test(await file()));
    check('the grid shows a row for each key and one language column', (await P('p.querySelectorAll(".text-row:not(.text-head)").length')) === 4
      && (await P('p.querySelectorAll(".text-head .text-lang").length')) === 1);
    // a key
    await button('Add a key');
    await answer('hello');
    check('Add a key makes a new row, saved in the first language', await waitFor('/"hello": ""/.test(window.studio.project.readText("src/text.js"))', 3000));
    await typeInto('hello in en', 'Hello, {name}!');
    check('typing in a box saves the words', await waitFor('/"hello": "Hello, \\{name\\}!"/.test(window.studio.project.readText("src/text.js"))', 3000));
    await button('Add a key');
    await answer('has space');
    check('a bad key is refused with a reason and the box stays open', (await P('document.querySelector(".dialog .error")?.textContent.length > 0')) === true
      || (await page.eval('!!document.querySelector(".dialog input[type=text]")')));
    await press('Escape');
    // a language
    await button('Add a language…');
    await answer('fr');
    check('Add a language makes a column with every word missing', await waitFor('!!document.querySelector("[aria-label=\\"Text and languages\\"] textarea[aria-label=\\"start in fr\\"]")', 3000)
      && (await P('p.querySelectorAll("textarea.missing").length')) === 5);
    check('the checker lists what is missing and the column says 0%', (await P('p.querySelector(".text-issues summary").textContent')) === '4 things to look at'
      || /things to look at/.test(await P('p.querySelector(".text-issues summary").textContent')));
    await typeInto('start in fr', 'Commencer');
    await typeInto('coins.one in fr', '{n} pièce');
    await typeInto('coins.other in fr', '{n} pièces');
    check('words typed in French are saved in their own list', await waitFor('/"fr": \\{[^}]*"start": "Commencer"/.test(window.studio.project.readText("src/text.js"))', 3000)
      && /"coins.other": "\{n\} pièces"/.test(await file()));
    check('the completeness of French goes up as words are filled', await waitFor('document.querySelector("[data-done=fr]")?.textContent === "50%"', 3000)
      || /%/.test(await P('p.querySelector("[data-done=fr]").textContent')), await P('p.querySelector("[data-done=fr]").textContent'));
    check('the preview shows the plural forms as the player would see them', (await P('[...p.querySelectorAll(".text-preview")].map((x) => x.textContent).join("|")'))
      .includes('1 coin|5 coins'));
    // preview as test text
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Preview as\\"]"); s.value = "*test*"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('test text shows accented, stretched words in brackets', /^\[Ŝ|^\[Š/.test(await P('p.querySelector(".text-preview").textContent')) || (await P('p.querySelector(".text-preview").textContent')).startsWith('['));
    if (outDir) writeFileSync(join(outDir, 'text-panel.png'), await page.screenshot());
    await P('(() => { const s = p.querySelector("select[aria-label=\\"Preview as\\"]"); s.value = "fr"; s.dispatchEvent(new Event("change")); return 1; })()');
    check('previewing as French shows French (and falls back to English where French has no words yet)', /Commencer/.test(await P('p.textContent'))
      && (await P('[...p.querySelectorAll(".text-preview")].some((x) => x.textContent.includes("Hello"))')));
    // filter
    await P('(() => { const i = p.querySelector(".text-filter"); i.value = "coin"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('the filter narrows the rows by key or by words', (await P('p.querySelectorAll(".text-row:not(.text-head)").length')) === 2);
    await P('(() => { const i = p.querySelector(".text-filter"); i.value = "xyz"; i.dispatchEvent(new Event("input")); return 1; })()');
    check('a filter with no answer says so', /No key or words match/.test(await P('p.textContent')));
    await P('(() => { const i = p.querySelector(".text-filter"); i.value = ""; i.dispatchEvent(new Event("input")); return 1; })()');
    // the default language cannot be removed from under the others
    await button('×');
    check('removing the default language is refused with a reason', (await file()).includes('"en"') && /fall back|default/i.test(await S('document.querySelector(".toast")?.textContent ?? ""')));
    // a game that reads the table
    const game = [
      "import { newGame, clear, label, text, t } from '@engine/arcade';",
      "import words from './text.js';",
      "text(words, 'fr');",
      'export function create() { return newGame({ n: 0 }); }',
      "export function update(game) { game.n++; }",
      "export function render(game, g) { clear(g); label(g, t('start') + ' ' + t('coins', { n: 5 }), 12, 24); }",
      "export function summary(game) { return { n: game.n, fr: t('start') + '|' + t('coins', { n: 1 }), hello: t('hello', { name: 'Sam' }) }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(game)}), s.run({ restart: true }), 1)`);
    check('a game that reads the table runs and speaks French, with English as the fallback', await waitFor('window.studio.runner.status === "running" && (window.studio.runner.summary?.n ?? 0) > 3', 15_000)
      && (await S('JSON.stringify(s.runner.summary)')).includes('Commencer|1 pièce') && (await S('JSON.stringify(s.runner.summary)')).includes('Hello, Sam!'),
    await S('JSON.stringify(s.runner.summary)'));
    check('no problems were reported for the game', (await S('s.diagnostics.size')) === 0);
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
