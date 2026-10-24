// Live check, in a real Chrome, of the Tables panel: a project with a data file and its schema shows as a grid; editing a number, a choice, a tick and a colour writes the file; rows can be
// added, copied, moved and removed; a value out of range is reported; and a change made to the file by hand shows up in the grid.
// Usage: node tools/studio-tables-test.js [outDir]
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

const SCHEMA = JSON.stringify({
  file: 'data/parts.js', title: 'Parts',
  tables: [{
    key: 'weapons', title: 'Weapons', columns: [
      { key: 'id', label: 'Name', type: 'text' }, { key: 'damage', label: 'Damage', type: 'number', min: 0, max: 500, step: 1 },
      { key: 'slot', label: 'Slot', type: 'enum', options: ['main', 'melee'] }, { key: 'auto', label: 'Automatic', type: 'bool' },
      { key: 'color', label: 'Colour', type: 'color' },
    ],
  }, {
    key: 'frames', title: 'Frames', columns: [{ key: 'id', label: 'Name', type: 'text' }, { key: 'weight', label: 'Weight', type: 'number', min: 1, max: 300 }],
  }],
});
const DATA = `// Parts.\nexport default {\n  "weapons": [\n    {"id":"rifle","damage":7,"slot":"main","auto":true,"color":"#ff8800"},\n    {"id":"blade","damage":40,"slot":"melee","auto":false,"color":"#00ccff"}\n  ],\n  "frames": [\n    {"id":"striker","weight":22}\n  ]\n};\n`;

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Tables"]'); return p ? (${expr}) : null; })()`);
    const FILE = 'window.studio.project.readText("data/parts.js")';
    const field = (label) => `p.querySelector('[aria-label=${JSON.stringify(label)}]')`;
    const change = (label, value, event = 'change') => P(`(() => { const e = ${field(label)}; if (!e) return false; e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); return true; })()`);
    const click = (label) => P(`(() => { const b = p.querySelector('button[title=${JSON.stringify(label)}]'); if (!b) return false; b.click(); return true; })()`);
    const parsed = () => page.eval(`JSON.parse(${FILE}.replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, ""))`);

    check('the studio opens', await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Tables test", template: "blank" }), 1)');
    await page.waitFor('window.studio.project?.name === "Tables test"', 10_000);
    await S('(s.dock.show("tables"), 1)');
    check('with no schema it explains how to make one', await page.waitFor('!!document.querySelector("[aria-label=\\"Tables\\"]")', 8000) && /No tables yet/.test(await P('p.textContent')));
    await S(`(s.project.write("data/parts.schema.json", ${JSON.stringify(SCHEMA)}), s.project.write("data/parts.js", ${JSON.stringify(DATA)}), s.emit("files"), 1)`);
    check('the grid appears with a row for each record', await page.waitFor('document.querySelectorAll("[aria-label=\\"Tables\\"] tbody tr").length === 2', 5000));
    check('the note counts the rows', /2 weapons, 1 frames/.test(await P('p.querySelector("[role=status]").textContent')));
    if (outDir) writeFileSync(join(outDir, 'tables.png'), await page.screenshot());

    await change('Weapons row 1, Damage', '9');
    check('editing a number is written to the file', await page.waitFor(`JSON.parse(${FILE}.replace(/^[\\s\\S]*?export default /, "").replace(/;\\s*$/, "")).weapons[0].damage === 9`, 4000));
    await change('Weapons row 2, Slot', 'main');
    await P(`(() => { const c = ${field('Weapons row 2, Automatic')}; c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()`);
    await change('Weapons row 2, Colour', '#112233', 'input');
    await sleep(500);
    const d = await parsed();
    check('a choice, a tick and a colour are written too', d.weapons[1].slot === 'main' && d.weapons[1].auto === true && d.weapons[1].color === '#112233', JSON.stringify(d.weapons[1]));
    check('the file keeps its comment and its form: export default, a record to a line', /^\/\/ /.test(await page.eval(FILE)) && (await page.eval(`${FILE}.split("\\n").filter((l) => l.startsWith("    {")).length`)) >= 3);

    await click('Copy row 1');
    check('copying a row adds one with a new name', await page.waitFor('document.querySelectorAll("[aria-label=\\"Tables\\"] tbody tr").length === 3', 3000)
      && (await P(`${field('Weapons row 2, Name')}.value`)) === 'rifle-1');
    await click('Remove row 2');
    check('removing takes it out', await page.waitFor('document.querySelectorAll("[aria-label=\\"Tables\\"] tbody tr").length === 2', 3000));
    await click('Add a row to Weapons');
    check('adding a row works', await page.waitFor('document.querySelectorAll("[aria-label=\\"Tables\\"] tbody tr").length === 3', 3000));
    await click('Move row 3 up');
    await sleep(400);
    check('moving a row up changes the order', (await P(`${field('Weapons row 2, Name')}.value`)).startsWith('new'));

    await change('Weapons row 1, Damage', '9000');
    check('a number out of range is reported by name', await page.waitFor('/Damage.*is 9000.*outside 0 to 500/.test(document.querySelector("[aria-label=\\"Tables\\"] ul")?.textContent ?? "")', 3000));
    await change('Weapons row 1, Damage', '12');
    check('and the report goes when it is fixed', await page.waitFor('!!document.querySelector("[aria-label=\\"Tables\\"] ul")?.hidden', 3000));

    await P('(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === "Frames"); b.click(); return 1; })()');
    check('the other table can be shown', await page.waitFor('!!document.querySelector("[aria-label=\\"Tables\\"] input[aria-label=\\"Frames row 1, Weight\\"]")', 3000));

    await S('(s.project.write("data/parts.js", ' + JSON.stringify(DATA.replace('"damage":7', '"damage":77')) + '), s.emit("files"), 1)');
    await P('(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === "Weapons"); b.click(); return 1; })()');
    check('a change made to the file by hand shows in the grid', await page.waitFor('document.querySelector("[aria-label=\\"Tables\\"] input[aria-label=\\"Weapons row 1, Damage\\"]")?.value === "77"', 4000));

    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
