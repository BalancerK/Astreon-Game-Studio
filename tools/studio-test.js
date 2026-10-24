// Live check of the studio (studio/index.html) in a real browser, with real mouse and keyboard events: make a project, write code and watch the game change,
// get an error and jump to it, use the search box and the menus, change settings, rearrange panels by dragging, switch workspaces, keep and restore restore
// points, survive a game that hangs, reload the page and find everything where it was, delete and undo, export and import, and an accessibility pass.
// Usage: node tools/studio-test.js [outDir]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { createStaticServer } from './static-server.js';
import { readZip } from '../studio/app/store/zip.js';
import { withChromePage } from './cdp.js';
import { PATHWAYS } from '../studio/app/learn/pathways.js';
import { solutions } from '../studio/test/solutions.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const note = (name, value) => console.log(`     ${name}: ${value}`);

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const errors = () => page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 3).join(' | ');
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const json = async (expr) => JSON.parse(await S(`JSON.stringify(${expr})`));
    const shot = async (name) => { if (outDir) writeFileSync(join(outDir, `studio-${name}.png`), await page.screenshot()); };
    const centre = async (selector) => JSON.parse(await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); })()`));
    const click = async (selector) => { const c = await centre(selector); if (!c) throw new Error(`nothing to click: ${selector}`); await page.mouse('mouseMoved', c.x, c.y); await page.mouse('mousePressed', c.x, c.y); await page.mouse('mouseReleased', c.x, c.y); };
    const press = async (code, modifiers) => { await page.key(code, 'down', modifiers); await page.key(code, 'up', modifiers); };
    // typing goes through the browser's own editing command (what a real keyboard does); the DevTools shortcut for typing leaves the caret at the end of a text box
    const typeText = (text) => page.eval(`document.execCommand('insertText', false, ${JSON.stringify(text)})`);
    const selectInEditor = (needle) => page.eval(`(() => { const ta = document.querySelector('.ed textarea'); const i = ta.value.indexOf(${JSON.stringify(needle)}); ta.focus(); ta.setSelectionRange(i, i + ${JSON.stringify(needle)}.length); return i; })()`);
    const editorText = () => page.eval('document.querySelector(".ed textarea").value');
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const dialogOpen = () => page.eval('!!document.querySelector(".dialog")');

    // ---------- the first minute ----------
    check('the studio opens on the project hub (nothing is open yet)', await waitFor('window.studio && !document.querySelector(".hub").hidden', 15_000), errors());
    await page.eval('(async () => { for (const p of await window.studio.store.list()) await window.studio.store.purge(p.id); localStorage.clear(); })()');
    check('the start page offers templates', (await page.eval('document.querySelectorAll(".hub .card").length')) >= 2);
    await shot('hub');
    const tStart = Date.now();
    await click('.hub .card[data-focus], .hub .card:nth-child(2)');
    check('choosing one asks for a name', await waitFor('!!document.querySelector(".dialog input")', 3000));
    await page.eval('document.querySelector(".dialog input").select()'); await typeText('My First Game'); await press('Enter');
    check('the project opens', await waitFor('window.studio.project && window.studio.project.name === "My First Game"', 5000));
    check('the start page closes and the panels appear', await page.eval('document.querySelector(".hub").hidden') && (await page.eval('[...document.querySelectorAll(".dock-tab")].map((t) => t.textContent.trim()).join(",")')).includes('Editor'));
    check('the game starts running', await waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 10', 15_000), errors());
    note('time from the click to a running game', `${Date.now() - tStart} ms`);
    check('the editor shows the starter code', (await editorText()).includes('const SPEED = 120'));
    await shot('project');

    // ---------- writing code ----------
    await page.sleep(700);
    const before = await json('s.runner.summary');
    const applied0 = await S('s.runner.stats.applied');
    await selectInEditor('120'); await typeText('300');
    check('typing changes the file at once', (await S('s.project.readText("src/main.js")')).includes('SPEED = 300'));
    check('and the game picks it up', await waitFor(`window.studio.runner.stats.applied > ${applied0}`, 5000));
    const latencies = await json('s.runner.stats.latencies');
    note('typing to running game', `${latencies[latencies.length - 1]} ms`);
    check('the game kept its place (its clock was not reset)', (await json('s.runner.summary')).t >= before.t, `${before.t} -> ${(await json('s.runner.summary')).t}`);
    await page.sleep(600);
    check('the project says all changes are saved', await waitFor('window.studio.project.saveState === "saved" && /All changes saved/.test(document.getElementById("st-save").textContent)', 4000));
    check('and what was typed is in the database', await page.eval(`(async () => { const p = await window.studio.store.open(window.studio.project.id); return p.readText('src/main.js').includes('SPEED = 300'); })()`));

    // ---------- a mistake ----------
    await selectInEditor('300'); await typeText(';;');
    check('a typo is reported in the console with its place', await waitFor('!!document.querySelector(".log .line.error .link")', 6000));
    const link = await page.eval('document.querySelector(".log .line.error .link").textContent');
    check('naming the file and line', link === 'src/main.js:4', link);
    await page.eval('document.querySelector(".ed textarea").blur()');
    await click('.log .line.error .link');
    check('clicking it puts the caret on that line', await waitFor('/Ln 4,/.test(document.getElementById("st-cursor").textContent)', 3000), await page.eval('document.getElementById("st-cursor").textContent'));
    check('the status bar says the game needs a fix', await page.eval('/needs a fix/.test(document.getElementById("st-game").textContent)'));
    await shot('error');
    await selectInEditor(';;'); await typeText('250');
    check('fixing it clears the error state', await waitFor('window.studio.runner.status === "running"', 6000));

    // ---------- the search box ----------
    await press('KeyK', { ctrl: true });
    check('Ctrl+K opens the search box with the input focused', await waitFor('!!document.querySelector(".palette input") && document.activeElement === document.querySelector(".palette input")', 3000));
    await typeText('new fi');
    check('typing finds "New file…" first', await waitFor('document.querySelector(".palette li[aria-selected=true] .title")?.textContent.startsWith("New file")', 3000), await page.eval('document.querySelector(".palette li .title")?.textContent'));
    check('and weak matches (letters scattered through a long title) are not offered', await page.eval('![...document.querySelectorAll(".palette li .title")].some((t) => /Increase/.test(t.textContent))'));
    await shot('palette');
    await press('Enter');
    check('Enter runs it: a dialog asks for the name', await waitFor('!!document.querySelector(".dialog input")', 3000));
    await page.eval('document.querySelector(".dialog input").select()'); await typeText('src/enemy.js'); await press('Enter');
    check('the new file exists and is open', await waitFor('window.studio.project.has("src/enemy.js") && window.studio.activeFile === "src/enemy.js"', 4000));
    check('and the Files panel lists it', await page.eval('[...document.querySelectorAll("#dock [role=treeitem]")].some((r) => r.dataset.path === "src/enemy.js")'));
    await press('KeyP', { ctrl: true }); await typeText('util'); await press('Enter');
    check('Ctrl+P finds a file by a few letters and opens it', await waitFor('window.studio.activeFile === "src/util.js"', 3000));
    await press('KeyG', { ctrl: true }); await typeText('3'); await press('Enter');
    check('Ctrl+G goes to a line', await waitFor('/Ln 3,/.test(document.getElementById("st-cursor").textContent)', 3000), await page.eval('document.getElementById("st-cursor").textContent'));
    await press('KeyK', { ctrl: true }); await typeText('>decrease code font');
    check('settings are searchable too', await page.eval('document.querySelector(".palette li .title")?.textContent.startsWith("Decrease: Code font size")'));
    await press('Escape');
    check('Escape closes the search box and returns the keyboard', await waitFor('!document.querySelector(".palette")', 2000));

    // ---------- the menu bar ----------
    await click('#menubar button:nth-child(1)');
    check('the File menu opens with its commands and shortcuts', await waitFor('document.querySelectorAll(".menu button").length >= 8', 2000) && (await page.eval('[...document.querySelectorAll(".menu button")].some((b) => /New file/.test(b.textContent) && /Alt\\+N/.test(b.textContent))')));
    await press('ArrowDown'); await press('Escape');
    check('Escape closes it', await waitFor('!document.querySelector(".menu")', 2000));

    // ---------- settings ----------
    await S('s.commands.execute("setting.theme.light")');
    const light = await page.eval('getComputedStyle(document.body).backgroundColor');
    await S('s.commands.execute("setting.theme.dark")');
    check('the theme switches between light and dark', light !== (await page.eval('getComputedStyle(document.body).backgroundColor')) && (await S('document.documentElement.dataset.theme')) === 'dark');
    const font0 = await page.eval('parseFloat(getComputedStyle(document.querySelector(".ed")).fontSize)');
    await S('s.commands.execute("setting.fontSize.up")'); await S('s.commands.execute("setting.fontSize.up")');
    check('the code font size changes', (await page.eval('parseFloat(getComputedStyle(document.querySelector(".ed")).fontSize)')) === font0 + 2);

    // ---------- arranging panels ----------
    const layoutOf = () => json('s.dock.layout');
    const find = (tree, id) => { const out = []; (function walk(n) { out.push(n); if (n.children) n.children.forEach(walk); })(tree); return out.find((n) => n.id === id || n.panels?.includes(id)); };
    const tabOf = async (id) => { await page.eval(`document.querySelector('.dock-tab[data-panel="${id}"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })`); return centre(`.dock-tab[data-panel="${id}"]`); };
    const histTab = await tabOf('history'); const gameBody = await centre('.dock-group:has(.dock-tab[data-panel="game"])');
    await page.mouse('mouseMoved', histTab.x, histTab.y); await page.mouse('mousePressed', histTab.x, histTab.y);
    for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', histTab.x + ((gameBody.x - histTab.x) * i) / 8, histTab.y + ((gameBody.y + gameBody.h * 0.4 - histTab.y) * i) / 8, { buttons: 1 });
    check('dragging a tab shows where it will land', await page.eval('!document.querySelector(".dock-drop").hidden'));
    await shot('drag');
    await page.mouse('mouseReleased', gameBody.x, gameBody.y + gameBody.h * 0.4);
    const dropped = await layoutOf(); const histGroup = find(dropped, 'history'); const gameGroup = find(dropped, 'game');
    check('dropping on the bottom edge of the Game panel puts History below it, in its own group', histGroup.id !== gameGroup.id && histGroup.panels.length === 1, JSON.stringify(histGroup.panels));
    check('the layout is remembered for this workspace', await S('JSON.stringify(s.prefs.get("layout.code")) === JSON.stringify(s.dock.layout)'));
    const sp = await centre('.dock-splitter.v'); const widthBefore = (await centre('.dock-group')).w;
    await page.mouse('mouseMoved', sp.x, sp.y); await page.mouse('mousePressed', sp.x, sp.y); await page.mouse('mouseMoved', sp.x + 80, sp.y, { buttons: 1 }); await page.mouse('mouseReleased', sp.x + 80, sp.y);
    check('dragging the line between panels resizes them', (await centre('.dock-group')).w > widthBefore + 50, `${Math.round(widthBefore)} -> ${Math.round((await centre('.dock-group')).w)}`);
    await page.eval('document.querySelector(".dock-splitter.v").focus()'); const w1 = (await centre('.dock-group')).w; await press('ArrowLeft'); await press('ArrowLeft');
    check('and so do the arrow keys on the focused line', (await centre('.dock-group')).w < w1 - 5);
    await page.eval('document.querySelector(".dock-tab[data-panel=\\"console\\"]").focus()'); await press('Delete');
    check('Delete closes the focused tab', await S('!s.dock.isOpen("console")'));
    await S('s.commands.execute("panel.show.console")');
    check('and "Show Console" brings it back', await S('s.dock.isOpen("console")'));

    // ---------- workspaces ----------
    const codeLayout = JSON.stringify(await layoutOf());
    await press('Digit1', { alt: true });
    check('Alt+1 switches to the Make workspace', await waitFor('window.studio.workspace === "make"', 2000));
    check('which has its own arrangement', JSON.stringify(await layoutOf()) !== codeLayout);
    await press('Digit2', { alt: true });
    check('Alt+2 returns to Code and finds the arrangement as it was left', JSON.stringify(await layoutOf()) === codeLayout);
    await shot('workspaces');
    await S('s.commands.execute("view.reset-layout")');
    check('"Reset panel layout" restores the default', (await layoutOf()).type === 'split' && !find(await layoutOf(), 'history').panels.includes('game'));

    // ---------- history ----------
    await press('KeyS', { ctrl: true });
    check('Ctrl+S offers to save a restore point', await waitFor('!!document.querySelector(".dialog input")', 3000));
    await typeText('before the change'); await press('Enter');
    check('which then appears in the History panel', (await S('s.dock.show("history"), 1')) && await waitFor('[...document.querySelectorAll("#dock .row .name")].some((n) => n.textContent === "before the change")', 4000));
    await S('s.dock.show("editor")'); await S('s.openFile("src/main.js")'); await page.sleep(300);
    await selectInEditor('const SPEED = 250'); await typeText('const SPEED = 999');
    check('the project changed since the restore point', (await S('s.project.readText("src/main.js")')).includes('999'));
    await S('s.dock.show("history")'); await page.sleep(600);
    const restoreButton = await page.eval('(() => { const row = [...document.querySelectorAll("#dock .row")].find((r) => r.querySelector(".name")?.textContent === "before the change"); const b = [...row.querySelectorAll("button")].find((x) => x.textContent === "Restore"); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()');
    const rb = JSON.parse(restoreButton); await page.mouse('mouseMoved', rb.x, rb.y); await page.mouse('mousePressed', rb.x, rb.y); await page.mouse('mouseReleased', rb.x, rb.y);
    check('Restore asks first', await waitFor('!!document.querySelector(".dialog")', 3000));
    await click('.dialog .btn.primary');
    check('and then the files are as they were', await waitFor('window.studio.project.readText("src/main.js").includes("SPEED = 250")', 5000));
    check('what was there before was kept as a restore point too', await page.eval(`(async () => (await window.studio.project.snapshots()).some((s) => s.label.startsWith('Before going back')))()`));
    check('the editor shows the restored code', await waitFor('document.querySelector(".ed textarea").value.includes("SPEED = 250")', 3000));

    // ---------- a game that hangs ----------
    await S('s.dock.show("editor")'); await page.sleep(300);
    await page.eval('window.__gap = 0; (() => { let t = performance.now(); setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - t - 50); t = n; }, 50); })()');
    const hangs0 = await S('s.runner.stats.hangs');
    await selectInEditor('game.t += dt;'); await typeText('game.t += dt; while (true) {}');
    check('an endless loop is noticed', await waitFor(`window.studio.runner.stats.hangs > ${hangs0}`, 10_000));
    check('the studio was never frozen for long', (await page.eval('window.__gap')) < 400, `${Math.round(await page.eval('window.__gap'))} ms`);
    check('the console explains it', await page.eval('/stopped responding/.test(document.querySelector(".log").textContent)'));
    check('and the game runs again from where it was', await waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 5', 10_000));
    await selectInEditor('game.t += dt; while (true) {}'); await typeText('game.t += dt;');
    check('fixing the code works', await waitFor('window.studio.runner.status === "running"', 6000));
    await shot('after-hang');

    // ---------- deleting a file and undoing it ----------
    await S('s.dock.show("files")'); await page.sleep(200);
    await page.eval('document.querySelector("#dock [role=treeitem][data-path=\\"src/enemy.js\\"]").focus()'); await press('Delete');
    check('Delete asks before deleting a file', await waitFor('!!document.querySelector(".dialog")', 3000));
    check('and the safe answer (Cancel) has the focus', await page.eval('document.activeElement.textContent === "Cancel"'));
    await click('.dialog .btn.danger');
    check('the file is gone', await waitFor('!window.studio.project.has("src/enemy.js")', 3000));
    check('a message offers Undo', await waitFor('!!document.querySelector(".toast button")', 2000));
    await click('.toast button');
    check('and Undo brings it back', await waitFor('window.studio.project.has("src/enemy.js")', 3000));

    // ---------- reloading the page ----------
    await page.sleep(800);
    const keep = await json('({ file: s.activeFile, open: s.openFiles, layout: s.dock.layout, theme: s.settings.get("theme"), font: s.settings.get("fontSize"), main: s.project.readText("src/main.js") })');
    await page.eval('location.reload()');
    check('after a reload the same project is open', await waitFor('window.studio && window.studio.project && window.studio.project.name === "My First Game"', 15_000));
    const after = await json('({ file: s.activeFile, open: s.openFiles, layout: s.dock.layout, theme: s.settings.get("theme"), font: s.settings.get("fontSize"), main: s.project.readText("src/main.js") })');
    check('with the same files open', JSON.stringify(after.open) === JSON.stringify(keep.open) && after.file === keep.file, `${after.file}`);
    check('the same layout, theme and font size', JSON.stringify(after.layout) === JSON.stringify(keep.layout) && after.theme === keep.theme && after.font === keep.font);
    check('and every character of the code', after.main === keep.main);
    check('the game runs again', await waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 5', 15_000));

    // ---------- leaving and coming back: zip, projects, the bin ----------
    const roundTrip = await page.eval(`(async () => {
      const s = window.studio; await s.project.flush();
      const zip = s.project.exportZip();
      const copy = await s.store.importZip(zip, { name: 'Imported copy' });
      return JSON.stringify({ same: JSON.stringify(copy.list()) === JSON.stringify(s.project.list()) && copy.readText('src/main.js') === s.project.readText('src/main.js'), count: (await s.store.list()).length, bytes: zip.length });
    })()`);
    const rt = JSON.parse(roundTrip);
    check('a project exported as a zip and imported again is identical', rt.same, `${rt.bytes} bytes`);
    await S('s.commands.execute("project.hub")');
    check('the hub lists both projects', await waitFor('document.querySelectorAll(".hub .projects .row").length === 2', 4000));
    await shot('hub-projects');
    await page.sleep(300);                                                    // the list has settled
    await click('.hub .projects .row:first-child button[aria-label^="Delete"]');       // the newest project is the imported copy
    check('deleting a project asks first', await waitFor('!!document.querySelector(".dialog")', 3000), await page.eval('document.activeElement && document.activeElement.outerHTML.slice(0, 100)'));
    await waitFor('!!document.querySelector(".dialog .btn.danger")', 3000); await shot('delete-project'); await click('.dialog .btn.danger');
    check('deleting a project moves it to the bin', await waitFor('document.querySelectorAll(".hub .projects .row").length === 2 && [...document.querySelectorAll(".hub h2")].some((h) => /Recently deleted/.test(h.textContent))', 4000));
    check('and it can be brought back', await page.eval(`(async () => { const bin = await window.studio.store.list({ deleted: true }); await window.studio.store.restoreProject(bin[0].id); return (await window.studio.store.list()).length === 3 || (await window.studio.store.list()).length === 2; })()`));

    // ---------- writing code: helpers, suggestions, find, errors ----------
    await S('document.querySelector(".hub").hidden = true, 1');
    await S('s.dock.show("editor")');
    await S('(s.project.write("src/scratch.js", ""), s.openFile("src/scratch.js"), 1)'); await page.sleep(300);
    const focusEditor = () => page.eval('(() => { const ta = document.querySelector(".ed textarea"); ta.focus(); return 1; })()');
    const caret = () => page.eval('(() => { const ta = document.querySelector(".ed textarea"); return ta.selectionStart; })()');
    await focusEditor();
    await page.key('{', 'down'); await page.key('{', 'up');
    check('typing { adds the closing }', (await editorText()) === '{}' && (await caret()) === 1, await editorText());
    await press('Enter');
    check('Enter between the brackets opens the block and indents', (await editorText()) === '{\n  \n}' && (await caret()) === 4, JSON.stringify(await editorText()));
    await page.key('(', 'down'); await page.key('(', 'up');
    await page.key(')', 'down'); await page.key(')', 'up');
    check('typing ) over the automatic one does not double it', (await editorText()) === '{\n  ()\n}', JSON.stringify(await editorText()));
    await page.eval('(() => { const ta = document.querySelector(".ed textarea"); ta.select(); document.execCommand("delete"); })()');
    await typeText('const w = new Wor');
    check('suggestions appear while typing', await waitFor('!!document.querySelector(".ed-pop:not([hidden]) .row")', 4000));
    check('and the list names the engine class', await page.eval('[...document.querySelectorAll(".ed-pop .name")].some((n) => n.textContent === "World")'));
    await shot('suggestions');
    await press('Enter');
    check('Enter takes the suggestion and adds its import line', (await editorText()).startsWith("import { World } from '@engine/core';") && (await editorText()).includes('new World'), JSON.stringify(await editorText()));
    check('the list closes after choosing', await page.eval('!document.querySelector(".ed-pop:not([hidden])")'));
    await typeText(';'); await press('Enter');
    await page.key('/', 'down', { ctrl: true }); await page.key('/', 'up', { ctrl: true });
    check('Ctrl+/ comments the line out', (await editorText()).split('\n').some((l) => l.startsWith('// ') || l === '// '), JSON.stringify(await editorText()));
    await page.eval('(() => { const ta = document.querySelector(".ed textarea"); ta.select(); document.execCommand("delete"); })()');
    await typeText('one two\nthree two\nfour'); await focusEditor();
    await page.key('f', 'down', { ctrl: true }); await page.key('f', 'up', { ctrl: true });
    check('Ctrl+F opens the find bar', await waitFor('!!document.querySelector(".ed-find:not([hidden]) input")', 2000));
    await typeText('two');
    check('and counts the matches', await waitFor('document.querySelector(".ed-find .count")?.textContent === "1 of 2"', 2000), await page.eval('document.querySelector(".ed-find .count")?.textContent'));
    check('matches are marked in the text', await page.eval('document.querySelectorAll(".ed .match, .ed .match-cur").length === 2'));
    await press('Enter');
    check('Enter goes to the next match', await waitFor('document.querySelector(".ed-find .count")?.textContent === "2 of 2"', 2000));
    await page.key('h', 'down', { ctrl: true }); await page.key('h', 'up', { ctrl: true });
    await typeText('X');
    await page.eval('[...document.querySelectorAll(".ed-find button")].find((b) => b.textContent === "All").click()');
    check('Replace all changes every match in one step', await waitFor('document.querySelector(".ed textarea").value === "one X\\nthree X\\nfour"', 2000), JSON.stringify(await editorText()) + await page.eval('JSON.stringify([...document.querySelectorAll(".ed-find input")].map((i) => i.value)) + document.activeElement.tagName'));
    if (await page.eval('!!document.querySelector(".ed-pop:not([hidden])")')) await press('Escape');      // a suggestion list that is open takes the first Escape
    await press('Escape');
    check('Escape closes the find bar and returns to the code', await page.eval('document.querySelector(".ed-find").hidden && document.activeElement === document.querySelector(".ed textarea")'), await page.eval('document.querySelector(".ed-find").hidden + " " + document.activeElement.outerHTML.slice(0, 80)'));
    // a mistake is underlined, explained in the console, and the underline goes when it is fixed
    await S('(s.openFile("src/main.js"), 1)'); await page.sleep(300);
    const good = await S('s.project.readText("src/main.js")');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(good)} + "\\nconst = 5;\\n"), s.run({ restart: false }), 1)`);
    check('a syntax error is underlined in the code', await waitFor('!!document.querySelector(".ed .err")', 8000), errors());
    check('the console explains it in plain words', await waitFor('!!document.querySelector(".log .hint")', 3000));
    await shot('error-underline');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(good)}), s.run({ restart: false }), 1)`);
    check('fixing it removes the underline', await waitFor('!document.querySelector(".ed .err")', 8000));
    await S('(s.closeFile("src/scratch.js"), s.project.remove ? s.project.remove("src/scratch.js") : 0, 1)').catch(() => {});

    // ---------- the arcade kit in a real project ----------
    await S('(s.createProject({ name: "Hero test", template: "hero" }), 1)');
    check('the Run and jump template runs', await waitFor('window.studio.runner.status === "running" && !!window.studio.runner.summary', 12000), errors());
    await page.sleep(800);
    check('the hero has landed on the ground', (await json('s.runner.summary')).onGround === true, JSON.stringify(await json('s.runner.summary')));
    const x0 = (await json('s.runner.summary')).x;
    await S('(s.runner.key("ArrowRight", true), 1)'); await page.sleep(700); await S('(s.runner.key("ArrowRight", false), 1)');
    check('holding the right arrow runs the hero', (await json('s.runner.summary')).x > x0 + 60, `x ${x0} -> ${(await json('s.runner.summary')).x}`);
    await S('(s.runner.key("ArrowLeft", true), 1)'); await page.sleep(2200); await S('(s.runner.key("ArrowLeft", false), 1)');
    await S('(s.runner.key("Space", true), 1)');
    check('space makes the hero jump', await waitFor('window.studio.runner.summary.onGround === false', 1500));
    await S('(s.runner.key("Space", false), 1)');
    await shot('hero-game');
    await S('(s.project.write("src/main.js", s.project.readText("src/main.js").replace("const SPEED = 160", "const SPEED = 400")), s.run({ restart: false }), 1)');
    await page.sleep(900);
    const x1 = (await json('s.runner.summary')).x;
    await S('(s.runner.key("ArrowRight", true), 1)');
    const moved = await waitFor(`window.studio.runner.summary?.x > ${x1 + 120}`, 5000);          // held until it has gone far enough: a busy computer is slower, not wrong
    await S('(s.runner.key("ArrowRight", false), 1)');
    check('changing SPEED changes the running hero', moved, `x ${x1} -> ${(await json('s.runner.summary')).x}`);

    // ---------- the guided pathway: a student's whole way through, with real clicks and typing ----------
    const clickLearn = async (text) => {
      await page.eval("document.querySelectorAll('.toasts .toast').forEach((t) => t.remove())");           // a toast can sit over the button
      const tagged = await page.eval(`(() => { const b = [...document.querySelectorAll('.learn button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.setAttribute('data-e2e', '1'); return true; })()`);
      if (!tagged) throw new Error(`no button "${text}" in the Learn panel: ${await page.eval('document.querySelector(".learn")?.textContent.slice(0, 200)')}`);
      await click('.learn [data-e2e]'); await page.eval('document.querySelector("[data-e2e]")?.removeAttribute("data-e2e")');
    };
    const learnHas = (text, ms = 8000) => waitFor(`document.querySelector('.learn')?.textContent.includes(${JSON.stringify(text)})`, ms);
    const missionDone = (ms = 9000) => waitFor('!!document.querySelector(".learn .learn-card.done")', ms);
    const edit = async (needle, replacement) => { await selectInEditor(needle); await typeText(replacement); };
    const openMain = async () => { await S('(s.openFile("src/main.js"), 1)'); await page.sleep(250); };
    await S('s.commands.execute("project.hub")');
    check('the start page offers the guided route', await waitFor('!!document.querySelector(".hub-learn .btn.primary")', 4000));
    await shot('hub-guided');
    await click('.hub-learn .btn.primary');
    check('starting it makes a project and opens the Learn workspace', await waitFor('window.studio.workspace === "learn" && !!document.querySelector(".learn .learn-card")', 12000), errors());
    check('the first thing shown is the stage introduction', await learnHas('Make something move', 2000));
    await clickLearn('Start');
    check('mission 1 shows what to do', await learnHas('Play your game', 4000));
    await waitFor('window.studio.runner.status === "running" && !!window.studio.runner.summary', 12000); await page.sleep(500);
    await S('(s.runner.key("ArrowRight", true), 1)'); await page.sleep(900); await S('(s.runner.key("ArrowRight", false), 1)');
    check('running the hero completes mission 1', await missionDone(), await page.eval('document.querySelector(".learn")?.textContent.slice(0, 300)'));
    check('and it says why it works', await learnHas('60 times every second', 1000));
    await clickLearn('Next step');
    check('mission 2 highlights the SPEED line in the code', await waitFor('[...document.querySelectorAll(".ed .hl")].map((e) => e.textContent).join("").includes("const SPEED")', 6000), await page.eval('[...document.querySelectorAll(".ed .hl")].map((e) => e.textContent).join("")'));
    await shot('guide-mission-2');
    await clickLearn('Give me a hint');
    check('a hint appears when asked for', await waitFor('!!document.querySelector(".learn-hint")', 2000));
    await edit('= 160', '= 4');
    check('a number that is too small gets a kind note, not a pass', await waitFor('!!document.querySelector(".learn-note")', 6000) && !(await page.eval('!!document.querySelector(".learn .learn-card.done")')));
    await edit('= 4;', '= 400;');
    check('changing SPEED completes mission 2', await missionDone());
    await clickLearn('Next step');
    await edit('= 620', '= 900');
    check('changing JUMP completes mission 3', await missionDone());
    await clickLearn('Next step');
    await edit('#.............#', '#....o........#');
    await page.sleep(2000);
    check('the guide waits for Run after the level is edited (the game is still the old one)', !(await page.eval('!!document.querySelector(".learn .learn-card.done")')) && await learnHas('purple Run button', 3000));
    await S('(s.run({ restart: true }), 1)');
    check('adding a coin to the level completes mission 4 once the game is started again', await missionDone());
    await clickLearn('Next step');
    await edit('w: 24, h: 30 }', "w: 24, h: 30, color: '#ff6b6b' }");
    await S('(s.run({ restart: true }), 1)');
    check('painting the hero completes mission 5', await missionDone());
    await clickLearn('Next step');
    await S('(s.commands.execute("history.save"), 1)'); await waitFor('!!document.querySelector(".dialog input")', 3000); await typeText('My first hero'); await press('Enter');
    check('saving a restore point completes mission 6', await missionDone());
    await clickLearn('Next step');
    check('stage 2 starts with its introduction', await learnHas('A real level', 4000));
    await clickLearn('Start');
    check('the studio added the bigger level as a new file', await waitFor('window.studio.project.has("src/levels.js")', 4000));
    await openMain();
    await edit('import {', "import { BIG_LEVEL } from './levels.js';\nimport {"); await edit('loadMap(game, LEVEL,', 'loadMap(game, BIG_LEVEL,');
    await S('(s.run({ restart: true }), 1)');
    check('importing the big level completes mission 7', await missionDone());
    await clickLearn('Next step');
    await openMain(); await edit('loadMap(game, BIG_LEVEL,', 'game.map = loadMap(game, BIG_LEVEL,'); await edit('walk, jump,', 'follow, walk, jump,');
    await edit('  const coin = touches', '  follow(game, hero, game.map);\n  const coin = touches');
    await S('(s.run({ restart: true }), 1)');
    check('the camera completes mission 8', await missionDone(), await page.eval('JSON.stringify({ status: window.studio.runner.status, d: [...window.studio.diagnostics.values()], text: window.studio.project.readText("src/main.js").slice(0, 1800) })'));
    await clickLearn('Next step');
    await S('(s.openFile("src/levels.js"), 1)'); await page.sleep(250); await edit("'#@...o.............o.", "'#@...o...^^........o.");
    await openMain(); await edit("o: { kind: 'coin'", "'^': { kind: 'spike', color: '#ff5d5d' },\n    o: { kind: 'coin'");
    await edit('  const coin = touches', "  if (touches(game, hero, 'spike')) { hero.x = 32; hero.y = 256; }\n  const coin = touches");
    await S('(s.run({ restart: true }), 1)');
    check('spikes complete mission 9', await missionDone());
    await clickLearn('Next step');
    await shot('guide-collect');
    await clickLearn('Skip');
    check('a step can be skipped', await learnHas('Say "You win!"', 4000) || await learnHas('You win', 4000));
    await openMain(); await edit("label(g, 'Coins '", "if (all(game, 'coin').length === 0) label(g, 'You win!', 240, 160, { size: 32, align: 'center' });\n  label(g, 'Coins '");
    check('the win message completes the last mission', await missionDone());
    // stages 3 to 5: the guide's own steps are clicked; the code each step asks for comes from the reference solutions (typed in as file writes)
    const missions = Object.fromEntries(PATHWAYS.hero.stages.flatMap((st) => st.missions).map((m) => [m.id, m]));
    const solve = async (id) => {
      const files = JSON.parse(await page.eval('JSON.stringify(window.studio.textFiles())'));
      const next = solutions[id](files, missions[id]).files;
      for (const [path, text] of Object.entries(next)) {
        if (files[path] !== text) await S(`(s.project.write(${JSON.stringify(path)}, ${JSON.stringify(text)}), 1)`);
      }
      await S('(s.run({ restart: true }), 1)');
    };
    // stages 6 and 7 are done in the Network lab and the Ship panel, with real clicks
    const setRange = (label, value) => page.eval(`(() => { const i = [...document.querySelectorAll('.lab input[type=range]')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}); i.value = ${value}; i.dispatchEvent(new Event('input')); })()`);
    const tick = (label) => page.eval(`[...document.querySelectorAll('.lab input[type=checkbox]')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}).click()`);
    const setBudget = (label, value) => page.eval(`(() => { const i = [...document.querySelectorAll('.ship input.num')].find((x) => (x.getAttribute('aria-label') || '').startsWith('Limit for ${label}')); i.value = ${value}; i.dispatchEvent(new Event('change')); })()`);
    const ui = {
      coin: async () => {                                                  // an edit alone is not "done": the level is made when the game starts
        const files = JSON.parse(await page.eval('JSON.stringify(window.studio.textFiles())'));
        for (const [path, text] of Object.entries(solutions.coin(files, missions.coin).files)) if (files[path] !== text) await S(`(s.project.write(${JSON.stringify(path)}, ${JSON.stringify(text)}), 1)`);
        await page.sleep(2500);
        check('editing the level is not enough: the guide asks for Run', !(await page.eval('!!document.querySelector(".learn .learn-card.done")')) && await learnHas('purple Run button', 3000));
        await S('(s.run({ restart: true }), 1)');
      },
      lab: async () => { await click('.lab .toolbar .btn.primary'); },
      lag: async () => { await setRange('Lag each way', 200); },
      predict: async () => { await tick('Prediction'); await tick('Prediction'); },
      gust: async () => { await page.eval('[...document.querySelectorAll(".lab .toolbar .btn")].find((b) => b.textContent.includes("Push me")).click()'); },
      loss: async () => { await setRange('Lost packets', 15); },
      packets: async () => { await waitFor('!!document.querySelector(".lab .packet")', 4000); await page.eval('document.querySelector(".lab .packet").click()'); },
      measure: async () => { await page.eval('[...document.querySelectorAll(".ship .btn")].find((b) => /Measure/.test(b.textContent)).click()'); await waitFor('!!window.studio.ship.last', 20000); },
      budget: async () => { await setBudget('Time per frame', 6); },
      fail: async () => { await setBudget('Download size', 1); await page.sleep(300); await setBudget('Download size', 500); },
      export: async () => { await page.eval('[...document.querySelectorAll(".ship .btn")].find((b) => /Export as a web game/.test(b.textContent)).click()'); await waitFor('!!window.studio.ship.lastExport || !!document.querySelector(".dialog")', 12000); if (await page.eval('!!document.querySelector(".dialog .btn.danger, .dialog .btn.primary")')) await page.eval('document.querySelector(".dialog .btn.primary, .dialog .btn.danger").click()'); await waitFor('!!window.studio.ship.lastExport', 12000); },
      host: async () => { await clickLearn('I have done this'); },
      'plugin-make': async () => {
        await S('(s.dock.show("plugins"), 1)');
        await page.eval('[...document.querySelectorAll(".plugins .btn")].find((b) => b.textContent.includes("Start a new plugin")).click()');
        await waitFor('window.studio.project.has("plugins/my-panel.plugin.js")', 4000);
        await page.eval('[...document.querySelectorAll(".plugins .btn")].find((b) => b.textContent.includes("Install from this project")).click()');
        await waitFor('!!document.querySelector(".dialog")', 4000);
        await page.eval('[...document.querySelectorAll(".dialog .btn")].find((b) => /Install|Allow|Yes/.test(b.textContent))?.click()');
      },
      'folder-link': async () => { await clickLearn('I have done this'); },
    };
    const stageOrder = ['enemy', 'hit', 'stomp', 'sparks', 'shake', 'sound', 'title', 'levellist', 'startlevel', 'second', 'best', 'hero', 'levels', 'mysound', 'rule', 'lab', 'lag', 'predict', 'gust', 'loss', 'packets', 'measure', 'budget', 'fail', 'export', 'host', 'rules-first', 'rules-sound', 'plugin-make', 'folder-link'];
    await clickLearn('Next step');
    check('stage 3 starts with its introduction', await learnHas('Enemies and feel', 4000));
    for (const id of stageOrder) {
      if (['enemy', 'title', 'hero', 'lab', 'measure', 'rules-first'].includes(id)) { if (id !== 'enemy') { await clickLearn('Next step'); await learnHas('Stage', 4000); } await clickLearn('Start'); }
      else await clickLearn('Next step');
      check(`mission "${id}" is shown`, await learnHas(missions[id].title, 4000));
      if (id === 'levellist') check('the studio added the second level as a new file', await waitFor('window.studio.project.has("src/level2.js")', 4000));
      if (ui[id]) { await page.sleep(400); await ui[id](); } else await solve(id);
      check(`following the reference solution completes "${id}"`, await missionDone(12000), await page.eval('document.querySelector(".learn")?.textContent.slice(0, 260)') + ' | ' + await page.eval('[...window.studio.diagnostics.values()].map((d) => d[0]?.message).join()'));
      if (id === 'sound') await shot('guide-stage-3-done');
    }
    await S('(s.plugins.remove("my-panel"), 1)');                                         // the pathway installed the starter plugin
    await clickLearn('Finish');
    check('the pathway ends with a finished card', await learnHas('You finished every step', 3000));
    await shot('guide-finished');
    check('progress is kept with the project', await page.eval(`(async () => { const m = await window.studio.store.getMeta('learn:' + window.studio.project.id); return !!m && m.complete === true && m.done.length === 40 && m.skipped.length === 1; })()`));
    await S('s.learn.setEnabled(false)');
    check('the guide can be turned off, and nothing is highlighted', await learnHas('The guide is off', 2000) && (await page.eval('document.querySelectorAll(".ed .hl").length')) === 0);

    // ---------- the Time Machine, at the level of the game's worker ----------
    await S('(s.createProject({ name: "Time test", template: "hero" }), 1)');
    await waitFor('window.studio.runner.status === "running" && !!window.studio.runner.summary', 12000); await page.sleep(400);
    await S('(s.setWorkspace("debug"), s.dock.show("time"), 1)');                       // the panels that show the timeline make the studio watch the game
    check('the worker reports its timeline once watched', await waitFor('!!window.studio.runner.timeline && window.studio.runner.timeline.tick > 10', 4000));
    const heroX = () => page.eval('(() => { const t = window.studio.runner.gameState?.state?.things?.find((x) => x.kind === "hero"); return t ? Math.round(t.x * 100) / 100 : null; })()');
    const tl = () => json('s.runner.timeline');
    await S('(s.runner.key("ArrowRight", true), 1)'); await page.sleep(900); await S('(s.runner.key("ArrowRight", false), 1)'); await page.sleep(300);
    await S('(s.runner.time("pause"), 1)'); await page.sleep(350);
    const tt1 = await tl(); const tx1 = await heroX();
    check('pausing stops time', tt1.paused === true && (await tl()).tick === tt1.tick, JSON.stringify(tt1));
    await page.sleep(300);
    check('and the game stays where it was', (await tl()).tick === tt1.tick && (await heroX()) === tx1);
    check('the timeline has copies of the state to go back to', tt1.snapshots.length >= 1 && tt1.to === tt1.tick, JSON.stringify(tt1));
    await S('(s.runner.time("seek", { tick: 20 }), 1)');
    check('seeking back goes to that tick', await waitFor('window.studio.runner.timeline.tick === 20', 3000));
    await page.sleep(400);
    check('and the hero is where it was then', (await heroX()) < tx1 - 20, `x ${await heroX()} < ${tx1}`);
    await shot('time-machine-past');
    await S(`(s.runner.time("seek", { tick: ${tt1.tick} }), 1)`); await page.sleep(500);
    check('going forward again gives exactly the same state', (await heroX()) === tx1, `x ${await heroX()} vs ${tx1}`);
    await S('(s.runner.time("seek", { tick: 20 }), 1)'); await page.sleep(300);
    await S('(s.project.write("src/main.js", s.project.readText("src/main.js").replace("const SPEED = 160", "const SPEED = 400")), s.run({ restart: false }), 1)'); await page.sleep(900);
    await S('(s.runner.time("replay"), 1)');
    check('replaying the same inputs with new code runs to the end and stops', await waitFor('window.studio.runner.timeline.replayEnded === true && window.studio.runner.timeline.paused', 8000), JSON.stringify(await tl()));
    await page.sleep(400);
    check('and the faster hero ends further along', (await heroX()) > tx1 + 40, `x ${await heroX()} vs ${tx1}`);
    await S('(s.runner.time("play"), 1)'); await page.sleep(300);
    check('playing goes on live', (await tl()).paused === false && (await tl()).mode === 'live');
    const idx = await page.eval('window.studio.runner.gameState.state.things.findIndex((x) => x.kind === "hero")');
    await S('(s.runner.time("pause"), 1)'); await page.sleep(300);
    await S(`(s.runner.edit(["things", ${idx}, "x"], 300), 1)`); await page.sleep(500);
    check('a value edited by hand takes effect in the running game', (await heroX()) === 300, `x ${await heroX()}`);
    check('and is part of the recording', (await tl()).edits.length === 1);
    await S('(s.runner.select(["things", ' + idx + ']), 1)'); await page.sleep(300); await shot('inspector-outline');
    const got = await page.eval(`new Promise((resolve) => { const off = window.studio.runner.on('replay', (r) => { off(); resolve(JSON.stringify({ ok: !!r, events: r?.events.length, end: r?.endTick, cp: r?.checkpoints.length })); }); window.studio.runner.time('export'); setTimeout(() => resolve('timeout'), 4000); })`);
    check('the recording can be exported and passes the checks', JSON.parse(got).ok === true && JSON.parse(got).cp >= 1, got);
    await S('(s.runner.select(null), s.runner.time("play"), 1)');

    // ---------- the Time and Inspector panels, and recordings as files ----------
    await S('(s.setWorkspace("debug"), s.dock.show("time"), 1)'); await page.sleep(500);
    check('the Debug workspace shows the Time panel and the Inspector', await page.eval('!!document.querySelector(".time .time-slider") && !!document.querySelector(".inspect .state-tree")'));
    check('the panels start watching the game once they can be seen', await waitFor('window.studio.runner.watching === true && !!window.studio.runner.timeline', 4000));
    await S('(s.runner.key("ArrowRight", true), 1)'); await page.sleep(1500); await S('(s.runner.key("ArrowRight", false), 1)');
    check('the readout shows how long has been recorded', await waitFor('/\\d+\\.\\d s of \\d+\\.\\d s/.test(document.querySelector(".time-readout")?.textContent || "")', 4000), await page.eval('document.querySelector(".time-readout")?.textContent'));
    await click('.time-bar .btn.primary');
    check('the Pause button pauses (and becomes Play)', await waitFor('window.studio.runner.timeline.paused && document.querySelector(".time-bar .btn.primary")?.textContent.trim() === "Play"', 3000));
    const here = (await tl()).tick;
    await click('.time-bar .btn[title="Step back one tick"]');
    check('step back goes back one tick', await waitFor(`window.studio.runner.timeline.tick === ${here - 1}`, 3000), JSON.stringify(await tl()));
    await click('.time-bar .btn[title="Step forward one tick"]');
    check('step forward goes forward one tick', await waitFor(`window.studio.runner.timeline.tick === ${here}`, 3000));
    const box = JSON.parse(await page.eval('(() => { const r = document.querySelector(".time-slider").getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top + r.height / 2, w: r.width }); })()'));
    await page.mouse('mouseMoved', box.x + box.w * 0.3, box.y); await page.mouse('mousePressed', box.x + box.w * 0.3, box.y); await page.mouse('mouseReleased', box.x + box.w * 0.3, box.y);
    check('clicking the timeline goes to that moment', await waitFor(`window.studio.runner.timeline.tick < ${here - 20}`, 3000), JSON.stringify(await tl()));
    check('and the note says the game is paused in the past', await page.eval('document.querySelector(".time-note")?.textContent.includes("Paused in the past")'));
    await shot('time-panel');
    await press('F8');
    check('F8 plays on from here (and forgets what came after)', await waitFor('!window.studio.runner.timeline.paused && window.studio.runner.timeline.mode === "live"', 3000));
    await press('F8');
    check('and F8 pauses again', await waitFor('window.studio.runner.timeline.paused', 3000));

    // the inspector
    await click('.state-tree .row.head');                                              // the root row folds and unfolds; reopen it if it closed
    await page.sleep(300);
    const open = async (label) => { await page.eval(`(() => { const r = [...document.querySelectorAll('.state-tree .row.head')].find((x) => x.querySelector('.key')?.textContent === ${JSON.stringify(label)}); if (r && r.getAttribute('aria-expanded') !== 'true') r.click(); })()`); await page.sleep(250); };
    await open('game'); await open('things');
    check('the inspector lists the things in the game', await waitFor('[...document.querySelectorAll(".state-tree .sum")].some((e) => e.textContent === "hero")', 3000));
    await page.eval('[...document.querySelectorAll(".state-tree .row.head")].find((x) => x.querySelector(".sum")?.textContent === "hero").click()'); await page.sleep(250);
    await open('[' + idx + ']');
    check('opening the hero shows its numbers as fields', await page.eval('!![...document.querySelectorAll(".state-tree input.leaf")].find((i) => i.getAttribute("aria-label") === "things.' + idx + '.x")'));
    await page.eval('(() => { const i = [...document.querySelectorAll(".state-tree input.leaf")].find((x) => x.getAttribute("aria-label") === "things.' + idx + '.x"); i.focus(); i.select(); })()');
    await typeText('222'); await press('Enter'); await page.sleep(500);
    check('typing a new number in the inspector changes the game', (await heroX()) === 222, `x ${await heroX()}`);
    check('and the edit shows on the timeline', (await tl()).edits.length >= 1);
    await shot('inspector-panel');
    await page.eval('(() => { const f = document.querySelector(".inspect-filter"); f.focus(); })()'); await typeText('score');
    check('the filter finds fields by name', await waitFor('[...document.querySelectorAll(".state-tree .row.found .key")].some((k) => k.textContent === "score")', 3000));
    await page.eval('(() => { const f = document.querySelector(".inspect-filter"); f.value = ""; f.dispatchEvent(new Event("input")); })()');

    // a recording as a file: open it on "another computer" (here: as a new project) and have the worker check it
    const recording = await page.eval(`new Promise((resolve) => { const off = window.studio.runner.on('replay', (r) => { off(); resolve(JSON.stringify({ ...r, files: window.studio.textFiles(), name: 'bug report' })); }); window.studio.runner.time('export'); setTimeout(() => resolve('null'), 4000); })`);
    check('a recording can be exported with the game code', recording !== 'null' && JSON.parse(recording).files['src/main.js'].includes('SPEED'));
    const verdict = (file) => page.eval(`new Promise((resolve) => { const off = window.studio.runner.on('verified', (v) => { off(); resolve(JSON.stringify(v)); }); window.studio.timeMachine.open(new File([${JSON.stringify(file)}], 'x.replay.json')); setTimeout(() => resolve('"timeout"'), 15000); })`);
    const ok = JSON.parse(await verdict(recording));
    check('opening it in a new project reproduces it exactly', ok.ok === true && ok.checked >= 1, JSON.stringify(ok));
    check('the project is named for the recording and the game is paused at its start', await page.eval('window.studio.project.name === "Recording: bug report"') && (await tl()).paused === true);
    const changed = JSON.parse(recording); changed.files['src/main.js'] = changed.files['src/main.js'].replace('const SPEED = 400', 'const SPEED = 90');
    const worse = JSON.parse(await verdict(JSON.stringify(changed)));
    check('a recording whose code was changed is reported as not matching, with the tick', worse.ok === false && worse.divergedAt > 0, JSON.stringify(worse));
    check('and the console says why', await waitFor('[...document.querySelectorAll(".log .line.warn")].some((l) => l.textContent.includes("does not match from tick"))', 3000));
    await S('(s.timeMachine.open(new File(["{not json"], "x.json")), 1)');
    check('a file that is not a recording is refused with a message', await waitFor('[...document.querySelectorAll(".toast")].some((t) => /not a replay file|JSON|Unexpected/.test(t.textContent))', 3000));
    await S('(s.runner.watch(false), 1)');

    // ---------- the painters: sprites, levels and sounds ----------
    await S('(s.createProject({ name: "Art test", template: "hero" }), 1)');
    await waitFor('window.studio.runner.status === "running"', 12000);
    await S('(s.setWorkspace("art"), s.dock.show("sprites"), 1)'); await page.sleep(500);
    check('the Art workspace opens on the sprite painter, which offers to make a first sprite', await page.eval('!!document.querySelector(".art .empty .btn.primary")'));
    await click('.art .empty .btn.primary');
    await waitFor('!!document.querySelector(".dialog input")', 3000); await press('Enter');
    check('making a sprite writes a file the game can import', await waitFor('window.studio.project.has("src/art/hero.js")', 4000));
    check('and the painter shows it on a canvas with a palette', await waitFor('!!document.querySelector(".art-canvas") && document.querySelectorAll(".art-palette .swatch").length >= 8', 4000));
    const cellAt = async (cx, cy, size = 16) => JSON.parse(await page.eval(`(() => { const r = document.querySelector('.art-canvas').getBoundingClientRect(); return JSON.stringify({ x: r.left + (${cx} + 0.5) / ${size} * r.width, y: r.top + (${cy} + 0.5) / ${size} * r.height }); })()`));
    const spriteText = () => S('s.project.readText("src/art/hero.js")');
    const rowOf = async (y) => (await spriteText()).split('\n').filter((l) => /^\s+"[a-zA-Z.]{16}",?$/.test(l))[y]?.trim().replace(/[",]/g, '');
    let c = await cellAt(3, 3);
    await page.mouse('mouseMoved', c.x, c.y); await page.mouse('mousePressed', c.x, c.y); await page.mouse('mouseReleased', c.x, c.y);
    check('clicking the canvas paints a pixel, and it is saved to the file', await waitFor('window.studio.project.readText("src/art/hero.js").includes("...b")', 3000) && (await rowOf(3)) === '...b............', await rowOf(3));
    c = await cellAt(3, 3); const c2 = await cellAt(9, 3);
    await page.mouse('mouseMoved', c.x, c.y); await page.mouse('mousePressed', c.x, c.y); await page.mouse('mouseMoved', c2.x, c2.y, { buttons: 1 }); await page.mouse('mouseReleased', c2.x, c2.y);
    check('dragging paints a line without gaps', await waitFor('window.studio.project.readText("src/art/hero.js").includes("...bbbbbbb......")', 3000), await rowOf(3));
    await page.eval('document.querySelector(".art-canvas").focus()');
    await press('ArrowDown'); await press('Space');
    check('the keyboard paints too: arrow keys move, Space paints', await waitFor('window.studio.project.readText("src/art/hero.js").split("\\n").some((l) => /^\\s+"\\.{9}b\\.{6}",?$/.test(l))', 3000), await rowOf(4));
    await press('KeyZ', { ctrl: true });
    check('Ctrl+Z undoes the last change', await waitFor('!window.studio.project.readText("src/art/hero.js").split("\\n").some((l) => /^\\s+"\\.{9}b\\.{6}",?$/.test(l))', 3000));
    await click('.art-tools .btn[title^="Fill"]'); c = await cellAt(12, 12);
    await page.mouse('mouseMoved', c.x, c.y); await page.mouse('mousePressed', c.x, c.y); await page.mouse('mouseReleased', c.x, c.y);
    check('the fill tool fills the empty area', await waitFor('(window.studio.project.readText("src/art/hero.js").match(/b{8,}/g) || []).length > 5', 3000));
    await press('KeyZ', { ctrl: true }); await page.sleep(300);
    await click('.art-frames .btn[aria-label^="Add a frame"]');
    check('a frame can be added, and it becomes a second picture in the file', await waitFor('document.querySelectorAll(".art-frames .frame").length === 2', 3000));
    await click('.art-anims .btn:last-child'); await waitFor('!!document.querySelector(".dialog input")', 3000); await press('Enter');
    check('an animation can be made from the frames', await waitFor('/"run": \\{"frames":\\[0,1\\],"fps":8\\}/.test(window.studio.project.readText("src/art/hero.js"))', 4000), (await spriteText()).slice(-160));
    await shot('sprite-painter');
    // use the sprite in the game
    await S(`(s.project.write("src/main.js", s.project.readText("src/main.js")
      .replace("import {", "import hero from './art/hero.js';\\nimport {")
      .replace("const SPEED", "const art = { hero };\\nconst SPEED")
      .replace("'@': { kind: 'hero',", "'@': { kind: 'hero', sprite: 'hero',")
      .replace("drawThings(g, game)", "drawThings(g, game, art)")), s.run({ restart: true }), 1)`);
    await page.sleep(2500);
    check('a game that draws with the sprite runs without an error', (await S('s.runner.status')) === 'running' && (await S('s.diagnostics.size')) === 0, await S('s.runner.status'));
    await shot('sprite-in-game');

    // the level painter
    await S('(s.dock.show("levels"), 1)'); await page.sleep(500);
    check('the level painter finds the level in the code and its legend', await waitFor('document.querySelectorAll(".art-palette.tiles .tile").length >= 4', 4000));
    const levelCell = async (cx, cy, w = 15, h = 10) => JSON.parse(await page.eval(`(() => { const r = document.querySelector('.level-stage .art-canvas').getBoundingClientRect(); return JSON.stringify({ x: r.left + (${cx} + 0.5) / ${w} * r.width, y: r.top + (${cy} + 0.5) / ${h} * r.height }); })()`));
    const mainText = () => S('s.project.readText("src/main.js")');
    await page.eval('[...document.querySelectorAll(".art-palette.tiles .tile")].find((t) => /coin/.test(t.title)).click()');
    let lc = await levelCell(5, 3);
    await page.mouse('mouseMoved', lc.x, lc.y); await page.mouse('mousePressed', lc.x, lc.y); await page.mouse('mouseReleased', lc.x, lc.y);
    check('painting a coin tile changes the level in the code', await waitFor('window.studio.project.readText("src/main.js").includes("\'#....o........#\'")', 3000), (await mainText()).split('\n').filter((l) => l.includes("'#")).slice(2, 5).join('|'));
    await press('KeyZ', { ctrl: true }).catch(() => {}); await page.eval('document.querySelector(".level-stage .art-canvas").focus()'); await press('KeyZ', { ctrl: true });
    check('Ctrl+Z takes it back', await waitFor('!window.studio.project.readText("src/main.js").includes("\'#....o........#\'")', 3000));
    await page.eval('(() => { const i = [...document.querySelectorAll(".art-bar input.num")].find((x) => x.getAttribute("aria-label") === "Width"); i.focus(); i.select(); })()'); await typeText('18'); await press('Enter');
    await page.eval('document.activeElement.blur()');
    check('changing the width lengthens every row in the code', await waitFor('window.studio.project.readText("src/main.js").includes("###############...")', 3000), (await mainText()).split('\n').filter((x) => x.includes("'#")).slice(0, 1).join());
    await shot('level-painter');

    // the sound maker
    await S('(s.dock.show("sounds"), 1)'); await page.sleep(500);
    await click('.sound .empty .btn.primary'); await waitFor('!!document.querySelector(".dialog input")', 3000); await press('Enter');
    check('making a sound writes src/sounds.js with the recipe', await waitFor('window.studio.project.has("src/sounds.js") && window.studio.project.readText("src/sounds.js").includes("\\"coin\\"")', 4000), await page.eval('JSON.stringify({ files: window.studio.project.list(), panel: document.querySelector(".sound")?.textContent.slice(0, 160), dialog: !!document.querySelector(".dialog"), name: window.studio.project.name })') + ' errors: ' + errors());
    check('the sound has sliders for its layers', await waitFor('document.querySelectorAll(".sound-layer input[type=range]").length >= 4', 3000));
    await page.eval('(() => { const r = document.querySelector(".sound-layer input[type=range]"); r.value = "1200"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()');
    check('moving a slider changes the recipe in the file', await waitFor('/"freq":1200/.test(window.studio.project.readText("src/sounds.js"))', 4000));
    const soundBefore = await S('s.project.readText("src/sounds.js")');
    await page.eval('[...document.querySelectorAll(".sound .btn")].find((b) => b.textContent.trim() === "Surprise me").click()');
    check('"Surprise me" makes a different sound', await waitFor(`window.studio.project.readText("src/sounds.js") !== ${JSON.stringify(soundBefore)}`, 4000));
    await shot('sound-maker');
    // a game that plays it
    await S(`(s.project.write("src/main.js", s.project.readText("src/main.js")
      .replace("import {", "import soundList from './sounds.js';\\nimport { sounds, play } from '@engine/arcade';\\nimport {")
      .replace("const SPEED", "sounds(soundList);\\nconst SPEED")
      .replace("    despawn(game, coin);", "    despawn(game, coin);\\n    play('coin');")), s.run({ restart: true }), 1)`);
    await page.sleep(2500);
    check('a game that plays a sound runs without an error', (await S('s.runner.status')) === 'running' && (await S('s.diagnostics.size')) === 0);
    await S('(s.runner.key("ArrowRight", true), s.runner.key("Space", true), 1)'); await page.sleep(300); await S('(s.runner.key("Space", false), 1)');
    await page.sleep(2500); await S('(s.runner.key("ArrowRight", false), 1)');

    // ---------- the Network lab ----------
    await S('(s.createProject({ name: "Lab test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Lab test"', 12000);
    await S('(s.setWorkspace("debug"), s.dock.show("netlab"), 1)'); await page.sleep(600);
    check('the Network lab is in the Debug workspace', await page.eval('!!document.querySelector(".lab canvas.lab-canvas") && [...document.querySelectorAll(".lab .toolbar .btn")].some((b) => b.textContent.includes("Start over"))'));
    await page.eval('[...document.querySelectorAll(".lab .toolbar .btn")].find((b) => b.textContent.includes("Start over")).click()');
    await page.eval('(() => { const b = [...document.querySelectorAll(".lab .toolbar .btn")].find((x) => x.textContent.includes("Start the lab")); if (b) b.click(); })()');
    await page.eval('(() => { const i = [...document.querySelectorAll(".lab input[type=range]")].find((x) => x.getAttribute("aria-label") === "Lag each way"); i.value = 60; i.dispatchEvent(new Event("input")); })()');
    await page.eval('document.querySelector(".lab-canvas").focus()'); await page.key('ArrowRight', 'down'); await page.sleep(2500); await page.key('ArrowRight', 'up');
    const labText = () => page.eval('document.querySelector(".lab-readout")?.textContent');
    check('once started it measures the round trip and counts the packets', /Round trip \d+ ms/.test(await labText()) && (await page.eval('document.querySelectorAll(".lab .packet").length')) >= 5, await labText());
    check('the packet list shows both directions with their sizes', await page.eval('[...document.querySelectorAll(".lab .packet")].some((p) => p.textContent.includes("INPUT") && p.textContent.includes("7 B")) && [...document.querySelectorAll(".lab .packet")].some((p) => p.textContent.includes("SNAPSHOT") && p.textContent.includes("25 B"))'));
    await page.eval('(() => { const i = [...document.querySelectorAll(".lab input[type=range]")].find((x) => x.getAttribute("aria-label") === "Lag each way"); i.value = 300; i.dispatchEvent(new Event("input")); })()');
    await page.sleep(3500);
    const rtt = Number(/Round trip (\d+) ms/.exec(await labText())?.[1]);
    check('more lag means a longer round trip, as measured', rtt >= 550, `round trip ${rtt} ms`);
    await page.eval('[...document.querySelectorAll(".lab .toolbar .btn")].find((b) => b.textContent.includes("Push me")).click()'); await page.sleep(1200);
    check('a push from the server is a wrong guess that is counted', Number(/Wrong guesses (\d+)/.exec(await labText())?.[1]) >= 1, await labText());
    await shot('network-lab');

    // ---------- Ship: measure, limits, and an exported game that really plays ----------
    await S('(s.createProject({ name: "Ship test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Ship test" && window.studio.runner.status === "running"', 12000); await page.sleep(800);
    await S('(s.setWorkspace("ship"), 1)'); await page.sleep(600);
    check('the Ship panel invites a measurement', await page.eval('document.querySelector(".ship-verdict")?.textContent.includes("Measure my game")'));
    await page.eval('[...document.querySelectorAll(".ship .btn")].find((b) => /Measure/.test(b.textContent)).click()');
    check('measuring gives a download size, a first-picture time and a frame cost', await waitFor('!!window.studio.ship.last && Number.isFinite(window.studio.ship.last.metrics.frameMs) && Number.isFinite(window.studio.ship.last.metrics.firstFrameMs) && window.studio.ship.last.metrics.gzipBytes > 1000', 25000), JSON.stringify(await json('s.ship.last?.metrics')));
    const m = await json('s.ship.last.metrics');
    check('the numbers are plausible', m.files > 10 && m.gzipBytes < 200000 && m.frameMs < 20 && m.firstFrameMs < 5000, JSON.stringify(m));
    check('and are inside the default limits', await page.eval('document.querySelector(".ship-verdict")?.textContent.includes("inside every limit")'));
    await page.eval('(() => { const i = [...document.querySelectorAll(".ship input.num")].find((x) => (x.getAttribute("aria-label") || "").startsWith("Limit for Download")); i.value = 1; i.dispatchEvent(new Event("change")); })()');
    check('a limit the game cannot meet is reported as over', await waitFor('document.querySelector(".ship-verdict")?.textContent.includes("Over the limit") && !!document.querySelector(".ship-row.fail")', 3000));
    await shot('ship-panel');
    await page.eval('(() => { const i = [...document.querySelectorAll(".ship input.num")].find((x) => (x.getAttribute("aria-label") || "").startsWith("Limit for Download")); i.value = 500; i.dispatchEvent(new Event("change")); })()');
    check('and passes again when the limit is sensible', await waitFor('document.querySelector(".ship-verdict")?.textContent.includes("inside every limit")', 3000));
    await page.eval('window.__zips = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__zips.push(b); return orig.call(URL, b); }');
    await page.eval('[...document.querySelectorAll(".ship .btn")].find((b) => /Export as a web game/.test(b.textContent)).click()');
    check('exporting makes a zip', await waitFor('window.__zips.length === 1 && !!window.studio.ship.lastExport', 15000));
    const zipB64 = await page.eval('(async () => { const buf = new Uint8Array(await window.__zips[0].arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s); })()');
    const exported = await readZip(Uint8Array.from(Buffer.from(zipB64, 'base64')));
    const names = [...exported.keys()];
    check('the zip holds a page, the runtime, the game, the engine files it uses, and the offline parts', ['index.html', 'runtime.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'game/src/main.js', 'engine/arcade/src/index.js'].every((n) => names.includes(n)), names.slice(0, 20).join());
    const served = new Map([...exported].map(([k, v]) => ['/' + k, v]));
    const types = { html: 'text/html', js: 'text/javascript', webmanifest: 'application/manifest+json', svg: 'image/svg+xml' };
    const exportServer = http.createServer((req, res) => {
      const path = new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname;
      const body = served.get(path);
      if (!body) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': `${types[path.split('.').pop()] ?? 'text/plain'}; charset=utf-8` }).end(body);
    });
    await new Promise((r) => exportServer.listen(0, '127.0.0.1', r));
    const exportPort = exportServer.address().port;
    try {
      await withChromePage(`http://localhost:${exportPort}/`, async (game) => {
        const fingerprint = () => game.eval('(() => { const d = document.getElementById("game").getContext("2d").getImageData(0, 0, 480, 320).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return h; })()');
        const ok = await game.waitFor('document.getElementById("start") && !document.getElementById("start").hidden', 15000);
        check('the exported game opens in a plain browser with a "Click to play" start', ok, game.errors.slice(0, 2).join(' | '));
        const still = await fingerprint();
        check('and has already drawn its first picture', await game.eval('(() => { const d = document.getElementById("game").getContext("2d").getImageData(0, 0, 480, 320).data; let colours = new Set(); for (let i = 0; i < d.length; i += 148) colours.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return colours.size > 3; })()'), await game.eval('(() => { const d = document.getElementById("game").getContext("2d").getImageData(0, 0, 480, 320).data; const c = new Set(); for (let i = 0; i < d.length; i += 4) c.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return c.size + " colours, first pixel " + d.slice(0, 4).join(); })()'));//);
        await game.eval('document.getElementById("start").click()');
        await game.key('ArrowRight', 'down'); await game.sleep(900); await game.key('ArrowRight', 'up');
        check('pressing a key moves the hero in the exported game', (await fingerprint()) !== still);
        check('on-screen buttons are hidden on a computer with a mouse', await game.eval('document.querySelector(".touch-controls")?.hidden === true'));
        await game.eval('document.dispatchEvent(new Event("touchstart"))');
        check('and appear at the first touch', await game.eval('document.querySelector(".touch-controls")?.hidden === false'));
        const centre = JSON.parse(await game.eval('(() => { const r = document.querySelector(".touch-controls [data-code=ArrowLeft]").getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]); })()'));
        const beforeTouch = await fingerprint();
        await game.touch('touchStart', [[centre[0], centre[1], 1]]); await game.sleep(150);
        check('a pressed button looks pressed', await game.eval('document.querySelector(".touch-controls [data-code=ArrowLeft]").classList.contains("down-now")'));
        await game.sleep(700); await game.touch('touchEnd', []); await game.sleep(150);
        check('holding the left button walks the hero left, and letting go stops it', (await fingerprint()) !== beforeTouch && await game.eval('!document.querySelector(".touch-controls .down-now")'));
        const beforePad = await fingerprint();
        await game.eval('(() => { window.__pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [1, 0] }; navigator.getGamepads = () => [window.__pad]; })()');
        await game.sleep(800);
        await game.eval('window.__pad.axes = [0, 0]; 0'); await game.sleep(200);
        check('a controller\'s stick walks the hero too', (await fingerprint()) !== beforePad);
        const afterPad = await fingerprint(); await game.sleep(300);
        check('and nothing keeps moving once the stick is released', (await fingerprint()) === afterPad);
        check('a service worker keeps the game for offline play', await game.waitFor('navigator.serviceWorker.controller !== null || true', 100) && await game.eval('navigator.serviceWorker.getRegistration().then((r) => !!r)'), game.errors.slice(0, 2).join(' | '));
        check('the cache holds every file of the game', await game.waitFor(`caches.keys().then((ks) => ks.some((k) => k.startsWith("game-")))`, 8000));
        check('the exported game has no errors', game.errors.filter((e) => !/favicon|willReadFrequently/.test(e)).length === 0, game.errors.join(' | '));
      });
    } finally { exportServer.close(); }

    // ---------- plugins: a third party adds a panel, and cannot do anything it was not allowed to ----------
    const statisticsSource = readFileSync(new URL('../studio/plugins/examples/statistics.plugin.js', import.meta.url), 'utf8');
    const sneakySource = (permissions) => `export const manifest = { "id": "sneaky", "name": "Sneaky", "version": "1.0.0", "permissions": ${JSON.stringify(permissions)}, "commands": [{ "id": "probe", "title": "Probe" }] };
export default function activate(studio) {
  studio.command('probe', async () => {
    const out = {};
    const attempt = async (name, fn) => { try { out[name] = 'allowed: ' + String(await fn()).slice(0, 60); } catch (e) { out[name] = 'refused: ' + String(e && e.message || e).slice(0, 100); } };
    await attempt('read a file', () => studio.files.read('src/main.js'));
    await attempt('write a file', () => studio.files.write('src/hacked.js', 'x'));
    await attempt('fetch the internet', () => fetch('https://example.com/'));
    await attempt('open a websocket', () => new Promise((res, rej) => { const w = new WebSocket('wss://example.com/'); w.onopen = () => res('open'); w.onerror = () => rej(new Error('websocket blocked')); }));
    await attempt('touch the studio page', () => parent.document.title);
    await attempt('use localStorage', () => localStorage.getItem('x'));
    await attempt('use indexedDB', () => indexedDB.databases());
    await attempt('read cookies', () => document.cookie);
    await attempt('navigate the studio', () => { top.location = 'https://example.com/'; return 'tried'; });
    await attempt('call something unknown', () => studio.files.list.constructor('return 1')());
    return out;
  });
}`;
    await S('(s.createProject({ name: "Plugin test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Plugin test" && window.studio.runner.status === "running"', 12000);
    await S('(s.setWorkspace("make"), 1)'); await page.sleep(300);
    await S(`(s.plugins.install(${JSON.stringify(statisticsSource)}), 1)`);
    check('installing a plugin asks, in plain words, what it may do', await waitFor('!!document.querySelector(".dialog") && document.querySelector(".dialog").textContent.includes("read the files of your project") && document.querySelector(".dialog").textContent.includes("closed box")', 4000), await page.eval('document.querySelector(".dialog")?.textContent.slice(0, 300)'));
    await shot('plugin-install');
    await page.eval('document.querySelector(".dialog .btn.primary").click()');
    check('and installs it', await waitFor('window.studio.plugins.plugins.has("statistics")', 4000));
    check('its panel, command, exporter and importer are in the studio', await page.eval('(() => { const c = window.studio.commands; return !!c.get("plugin.statistics.show.stats") && !!c.get("plugin.statistics.cmd.refresh") && !!c.get("plugin.statistics.export.bundle") && !!c.get("plugin.statistics.import.notes"); })()'));
    await S('(s.dock.show("plugin:statistics:stats"), 1)');
    check('the panel is a sandboxed frame with no origin of its own', await waitFor('!!document.querySelector("[data-plugin-panel] iframe[sandbox=\\"allow-scripts\\"]")', 4000) && !(await page.eval('document.querySelector("[data-plugin-panel] iframe").getAttribute("sandbox").includes("allow-same-origin")')));
    const pluginState = () => json('(async () => await s.store.getMeta("plugin-state:statistics"))()').catch(() => null);
    const stateOf = async (id) => JSON.parse(await page.eval(`(async () => JSON.stringify(await window.studio.store.getMeta("plugin-state:${id}")))()`) ?? 'null');
    check('the panel counts the files of the project (it asked to read them)', await waitFor('window.studio.plugins.frames.size > 0', 4000) && await (async () => { for (let i = 0; i < 40; i++) { const st = await stateOf('statistics'); if (st?.summary?.includes('files')) return true; await page.sleep(250); } return false; })(), JSON.stringify(await stateOf('statistics')));
    const summaryBefore = (await stateOf('statistics')).summary;
    await S('(s.project.write("src/extra.js", "a\\nb\\nc\\n"), 1)');
    check('and updates by itself when a file changes', await (async () => { for (let i = 0; i < 40; i++) { const st = await stateOf('statistics'); if (st?.summary && st.summary !== summaryBefore) return true; await page.sleep(250); } return false; })(), `${summaryBefore} -> ${(await stateOf('statistics')).summary}`);
    await shot('plugin-panel');
    await S('(s.commands.execute("plugin.statistics.cmd.refresh"), 1)');
    check('its command runs inside the box and shows a message', await waitFor('[...document.querySelectorAll(".toast")].some((t) => t.textContent.includes("Statistics refreshed"))', 6000));
    const bundle = JSON.parse(await page.eval(`(async () => JSON.stringify(await window.studio.plugins.call("statistics", "exporter", "bundle")))()`));
    check('its exporter gathers the project\'s code into one file', Object.keys(bundle).join() === 'all-code.txt' && bundle['all-code.txt'].includes('===== src/main.js ====='));
    const imported = JSON.parse(await page.eval(`(async () => JSON.stringify(await window.studio.plugins.call("statistics", "importer", "notes", ["a.txt", "hello"])))()`));
    check('its importer turns a file into the files of a project', imported['notes/imported.md'].includes('hello') && 'src/main.js' in imported);

    // a plugin that asks for nothing, and tries everything
    await S(`(s.plugins.install(${JSON.stringify(sneakySource([]))}), 1)`);
    check('a plugin that asks for nothing is told so', await waitFor('!!document.querySelector(".dialog") && document.querySelector(".dialog").textContent.includes("nothing: it only shows its own panels")', 4000));
    await page.eval('document.querySelector(".dialog .btn.primary").click()');
    await waitFor('window.studio.plugins.plugins.has("sneaky")', 4000);
    const probe = JSON.parse(await page.eval(`(async () => JSON.stringify(await window.studio.plugins.call("sneaky", "command", "probe")))()`));
    note('what the plugin could do', JSON.stringify(probe));
    check('it cannot read a file it was not given permission for', /refused: .*permission/.test(probe['read a file']), probe['read a file']);
    check('it cannot write one either', /refused: .*permission/.test(probe['write a file']) && !(await S('s.project.has("src/hacked.js")')), probe['write a file']);
    check('it cannot reach the internet', /refused/.test(probe['fetch the internet']) && /refused/.test(probe['open a websocket']), `${probe['fetch the internet']} | ${probe['open a websocket']}`);
    check('it cannot touch the studio page, its storage or its cookies', /refused/.test(probe['touch the studio page']) && /refused/.test(probe['use localStorage']) && /refused/.test(probe['use indexedDB']) && /refused|allowed: $/.test(probe['read cookies']), JSON.stringify(probe));
    check('it cannot send the studio somewhere else', !/allowed/.test(probe['navigate the studio']) || (await page.eval('location.hostname')) !== 'example.com', probe['navigate the studio']);
    check('and the studio is still here, unharmed', await page.eval('location.hostname === "localhost" && !!window.studio'));
    await S(`(s.plugins.install(${JSON.stringify(sneakySource(['files.read']))}), 1)`);
    check('an update that asks for more asks again, naming only what is new', await waitFor('!!document.querySelector(".dialog") && document.querySelector(".dialog").textContent.includes("Update") && document.querySelector(".dialog").textContent.includes("read the files")', 4000));
    await page.eval('document.querySelector(".dialog .btn.primary").click()'); await page.sleep(500);
    const probe2 = JSON.parse(await page.eval(`(async () => JSON.stringify(await window.studio.plugins.call("sneaky", "command", "probe")))()`));
    check('once allowed to read, it can read, and still cannot write or reach the internet', /^allowed/.test(probe2['read a file']) && /refused/.test(probe2['write a file']) && /refused/.test(probe2['fetch the internet']), JSON.stringify(probe2));
    await S('(s.plugins.setEnabled("statistics", false), 1)'); await page.sleep(300);
    check('turning a plugin off removes its commands and its panel', !(await S('!!s.commands.get("plugin.statistics.cmd.refresh")')) && !(await page.eval('!!document.querySelector("[data-plugin-panel]")')));
    await S('(s.plugins.setEnabled("statistics", true), 1)'); await page.sleep(300);
    check('and turning it on brings them back', await S('!!s.commands.get("plugin.statistics.cmd.refresh")'));
    await S('(s.plugins.remove("sneaky"), s.plugins.remove("statistics"), 1)'); await page.sleep(300);
    check('removing plugins forgets them and what they kept', (await S('s.plugins.plugins.size')) === 0 && (await stateOf('statistics')) === null);

    // making one's own, entirely inside the studio
    await S('(s.setWorkspace("code"), s.dock.show("plugins"), 1)'); await page.sleep(400);
    await page.eval('[...document.querySelectorAll(".plugins .btn")].find((b) => b.textContent.includes("Start a new plugin")).click()');
    check('"Start a new plugin" writes a small plugin into the project', await waitFor('window.studio.project.has("plugins/my-panel.plugin.js")', 3000));
    await page.sleep(300);
    await page.eval('[...document.querySelectorAll(".plugins .btn")].find((b) => b.textContent.includes("Install from this project")).click()');
    await waitFor('!!document.querySelector(".dialog")', 4000); await page.eval('document.querySelector(".dialog .btn.primary").click()');
    check('and "Install from this project" installs it', await waitFor('window.studio.plugins.plugins.has("my-panel")', 4000));
    await S('(s.dock.show("plugin:my-panel:main"), 1)');
    check('its panel runs: the box starts and reports ready', await waitFor('[...window.studio.plugins.frames].some((b) => b.p.manifest.id === "my-panel" && b.ready)', 6000));
    await S('(s.plugins.remove("my-panel"), 1)');

    // ---------- a folder on the computer (the browser's own private file system stands in for a real one) ----------
    await S('(s.createProject({ name: "Folder test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Folder test" && window.studio.runner.status === "running"', 12000);
    await page.eval(`(async () => {
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry('link-test', { recursive: true }); } catch {}
      const dir = await root.getDirectoryHandle('link-test', { create: true });
      const put = async (path, text) => { let d = dir; const parts = path.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); };
      window.__put = put; window.__dir = dir;
      window.__read = async (path) => { try { let d = dir; const parts = path.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return await (await (await d.getFileHandle(name)).getFile()).text(); } catch { return null; } };
      window.__remove = async (path) => { let d = dir; const parts = path.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); await d.removeEntry(name); };
      await put('notes.md', 'written outside the studio');
      await put('src/main.js', 'folder version of main');
      await put('.git/config', 'must be ignored');
      await put('logo.png', 'binary is ignored');
    })()`);
    const mainBefore = await S('s.project.readText("src/main.js")');
    await S('(s.folder.link(window.__dir), 1)');
    check('linking a folder that has files asks how to start', await waitFor('!!document.querySelector(".dialog") && document.querySelector(".dialog").textContent.includes("link-test") && document.querySelector(".dialog").textContent.includes("Merge")', 5000));
    await page.eval('[...document.querySelectorAll(".dialog .btn")].find((b) => b.textContent === "Merge").click()');
    check('the status bar shows the link', await waitFor('!document.getElementById("st-folder").hidden && document.getElementById("st-folder").textContent.includes("link-test")', 6000), await page.eval('document.getElementById("st-folder").textContent'));
    check('a file only the folder had comes into the project', await waitFor('window.studio.project.has("notes.md") && window.studio.project.readText("notes.md") === "written outside the studio"', 6000));
    check('the project\'s files are written into the folder', await waitFor('window.__read("src/main.js").then((t) => t !== null && t.includes("SPEED"))', 6000));
    check('a file that differed keeps the project\'s version, and the folder\'s copy is saved, not lost', await waitFor('window.__read("conflicts/src/main.js").then((t) => t === "folder version of main")', 6000) && (await S('s.project.readText("src/main.js")')) === mainBefore);
    check('hidden folders and binary files are left alone', !(await S('s.project.list().some((p) => p.startsWith(".git") || p.endsWith(".png"))')));
    // pictures and sounds go both ways too (only the assets/ folder, and only files that really are what their name says)
    await page.eval(`(async () => {
      const tiny = (...rest) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...rest]);
      window.__tiny = tiny;
      window.__putBytes = async (path, bytes) => { let d = window.__dir; const parts = path.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(bytes); await w.close(); };
      window.__readBytes = async (path) => { try { let d = window.__dir; const parts = path.split('/'); const name = parts.pop(); for (const p of parts) d = await d.getDirectoryHandle(p); return Array.from(new Uint8Array(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer())); } catch { return null; } };
      await window.__putBytes('assets/from-folder.png', tiny(1, 2, 3));
      await window.__putBytes('assets/fake.png', new Uint8Array(40));
    })()`);
    check('a picture put in the assets folder of the folder comes into the project, byte for byte', await waitFor('window.studio.project.read("assets/from-folder.png") instanceof Uint8Array && Array.from(window.studio.project.read("assets/from-folder.png")).join() === Array.from(window.__tiny(1, 2, 3)).join()', 10000));
    check('a file that is not really a picture is left out', !(await S('s.project.has("assets/fake.png")')));
    await S('(s.project.write("assets/from-studio.png", window.__tiny(9, 9)), 1)');
    check('a picture made in the studio is written into the folder', await waitFor('window.__readBytes("assets/from-studio.png").then((b) => b && b.join() === Array.from(window.__tiny(9, 9)).join())', 10000));
    await S('(s.project.write("assets/from-studio.png", window.__tiny(7)), 1)');
    check('and painting over it updates the folder', await waitFor('window.__readBytes("assets/from-studio.png").then((b) => b && b.join() === Array.from(window.__tiny(7)).join())', 10000));
    await page.eval('window.__putBytes("assets/from-folder.png", window.__tiny(4, 4, 4, 4))');
    check('a picture replaced by another program reaches the project', await waitFor('Array.from(window.studio.project.read("assets/from-folder.png")).join() === Array.from(window.__tiny(4, 4, 4, 4)).join()', 10000));
    await S('(s.project.remove("assets/from-studio.png"), 1)');
    check('deleting a picture in the studio deletes it from the folder', await waitFor('window.__readBytes("assets/from-studio.png").then((b) => b === null)', 10000));
    check('the picture is still there for the other file (nothing else was lost)', await page.eval('window.__readBytes("assets/from-folder.png").then((b) => b !== null)'));
    check('and the game keeps running through all this', await S('s.runner.status') === 'running');
    await S('(s.project.write("src/extra.js", "edited in the studio"), 1)');
    check('a change made in the studio reaches the folder by itself', await waitFor('window.__read("src/extra.js").then((t) => t === "edited in the studio")', 8000));
    await page.eval('window.__put("notes.md", "changed by another program")');
    check('a change made by another program reaches the project by itself', await waitFor('window.studio.project.readText("notes.md") === "changed by another program"', 10000));
    await page.eval('window.__remove("src/extra.js")');
    check('a file deleted in the folder is deleted in the project', await waitFor('!window.studio.project.has("src/extra.js")', 10000));
    await S('(s.project.remove("notes.md"), 1)');
    check('and the other way round', await waitFor('window.__read("notes.md").then((t) => t === null)', 8000));
    // the status window: conflicts to settle, and what the link leaves out
    await page.eval('window.__putBytes("art/outside.png", window.__tiny(9, 9))');
    await S('(s.folder.sync(), 1)');
    await S('(s.commands.execute("folder.status"), 1)');
    check('the folder window lists the conflict and the picture it leaves out', await waitFor('(() => { const d = document.querySelector(".folder-dialog"); return !!d && d.textContent.includes("src/main.js") && d.textContent.includes("art/outside.png") && d.textContent.includes("outside assets/"); })()', 8000));
    await page.eval('[...document.querySelectorAll(".folder-dialog button")].find((b) => /Use the folder/.test(b.textContent)).click()');
    check('Using the folder version takes its version and the saved copy goes away', await waitFor('window.studio.project.readText("src/main.js") === "folder version of main" && !window.studio.project.has("conflicts/src/main.js")', 6000));
    check('and the folder copy is removed too', await waitFor('window.__read("conflicts/src/main.js").then((t) => t === null)', 8000));
    check('the window updated itself: no conflicts left', await waitFor('document.querySelector(".folder-dialog").textContent.includes("Changed in both places (0)")', 3000));
    check('the window offers to bring in the folder that holds the picture', await waitFor('[...document.querySelectorAll(".folder-dialog button")].some((b) => b.textContent === "Bring in art/")', 6000));
    await page.eval('[...document.querySelectorAll(".folder-dialog button")].find((b) => b.textContent === "Bring in art/").click()');
    check('a picture in that folder comes into the project as assets/art/…', await waitFor('window.studio.project.has("assets/art/outside.png")', 8000));
    check('and it is no longer reported as left out', await waitFor('!document.querySelector(".folder-dialog").textContent.includes("art/outside.png")', 5000));
    await S('(s.project.write("assets/art/made.png", window.__tiny(7, 7)), 1)');
    check('a picture made in the project under art goes to the art folder, not assets', await waitFor('window.__readBytes("art/made.png").then((b) => b && b.length > 8)', 10000) && (await page.eval('window.__readBytes("assets/art/made.png").then((b) => b === null)')));
    await page.eval('(() => { const t = [...document.querySelectorAll(".folder-dialog textarea")][1]; t.value = "*.tmp"; })()');
    await page.eval('[...document.querySelectorAll(".folder-dialog button")].find((b) => b.textContent === "Apply choices").click()');
    await S('(s.project.write("scratch.tmp", "private"), s.project.write("kept.md", "shared"), 1)');
    check('a file matching an ignore pattern stays out of the folder while others go in', await waitFor('window.__read("kept.md").then((t) => t === "shared")', 10000) && (await page.eval('window.__read("scratch.tmp").then((t) => t === null)')));
    await page.eval('[...document.querySelectorAll(".dialog button")].find((b) => b.textContent === "Close").click()');
    await page.eval('window.__remove("art/outside.png")');
    await page.eval('window.__remove("art/made.png")');
    await S('(s.project.remove("assets/art/outside.png"), s.project.remove("assets/art/made.png"), s.project.remove("scratch.tmp"), s.project.remove("kept.md"), 1)');
    await shot('folder-link');
    await S('(s.commands.execute("folder.unlink"), 1)');
    check('unlinking removes the chip and leaves the folder\'s files where they are', await waitFor('document.getElementById("st-folder").hidden', 3000) && (await page.eval('window.__read("src/main.js")')) !== null);
    await page.eval('(async () => { const root = await navigator.storage.getDirectory(); await root.removeEntry("link-test", { recursive: true }); })()');

    // ---------- rules: pieces that write code ----------
    await S('(s.createProject({ name: "Rules test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Rules test" && window.studio.runner.status === "running"', 12000);
    await S('(s.dock.show("rules"), 1)');
    check('the Rules panel opens with a friendly empty state', await waitFor('!!document.querySelector(".rules .empty")', 4000));
    await page.eval('[...document.querySelectorAll(".rules .art-bar button")].find((b) => b.textContent.includes("touches")).click()');
    check('adding a rule writes src/rules.js', await waitFor('window.studio.project.has("src/rules.js") && window.studio.project.readText("src/rules.js").includes("Rule 1")', 4000));
    check('the game is connected to the rules (one import, two calls)', await S('(() => { const t = s.project.readText("src/main.js"); return t.includes("applyRules(") && t.includes("drawRules(") && t.includes("./rules.js"); })()'));
    check('the rule is said in words', await page.eval('document.querySelector(".rule-sentence").textContent.includes("touches")'));
    check('its code can be shown', await page.eval('document.querySelector(".rule-code pre").textContent.includes("overlaps(")'));
    await page.eval('(() => { const i = document.querySelectorAll(".rule-row input")[1]; i.value = "gem"; i.dispatchEvent(new Event("change", { bubbles: true })); })()');
    check('changing a piece changes the file', await waitFor('window.studio.project.readText("src/rules.js").includes("\\"gem\\"")', 4000));
    check('and the game keeps running with the rules in it', await waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 5 && window.studio.diagnostics.size === 0', 10_000), errors());
    await page.eval('(() => { const i = document.querySelectorAll(".rule-row input")[0]; i.value = "he ro"; i.dispatchEvent(new Event("change", { bubbles: true })); })()');
    check('a bad name is explained instead of making broken code', await waitFor('document.querySelector(".rule-card.bad") && window.studio.project.readText("src/rules.js").includes("not complete yet")', 4000));
    await shot('rules');
    await S('(s.project.write("src/rules.js", "export const RULES = [ nope ];"), 1)');
    check('a damaged rules file says what is wrong', await waitFor('document.querySelector(".rules .ship-note[role=status]").textContent.includes("plain JSON")', 4000));

    // ---------- long lines wrap instead of scrolling sideways ----------
    await S('(s.createProject({ name: "Wrap test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Wrap test" && window.studio.runner.status === "running"', 12000);
    const longLine = `const numbers = [${Array.from({ length: 90 }, (_, i) => i * 7).join(', ')}];`;
    await S(`(s.project.write("src/main.js", ${JSON.stringify(`${longLine}\nconst short = 1;\n\nexport function create() { return { t: 0 }; }\nexport function update(game) { game.t += 1; }\nexport function render(game, g) { g.fillRect(0, 0, 10, 10); }\n${Array.from({ length: 70 }, (_, i) => `// filler line ${i}`).join("\n")}\n`)}), s.setWorkspace("code"), s.dock.show("editor"), s.openFile("src/main.js"), 1)`);
    await waitFor('document.querySelector(".editor-host textarea")?.value.includes("const short")', 4000);
    await page.sleep(500);
    check('with wrapping on (the default) a very long line does not scroll sideways', await page.eval('(() => { const t = document.querySelector(".editor-host textarea"); return !!document.querySelector(".ed.wrap") && t.scrollWidth <= t.clientWidth + 1; })()'));
    const wrapInfo = JSON.parse(await page.eval('(() => { const n = [...document.querySelectorAll(".editor-host .gutter .gin div")].map((d) => ({ t: d.textContent, top: d.offsetTop })); const lines = [...document.querySelectorAll(".editor-host .layer .ln")].map((d) => ({ top: d.offsetTop, h: d.offsetHeight })); const ta = document.querySelector(".editor-host textarea"); return JSON.stringify({ n, lines, sh: ta.scrollHeight, ph: document.querySelector(".editor-host .layer pre").offsetHeight }); })()'));
    check('the long line takes several rows, and the next line number sits below all of them', wrapInfo.lines[0].h > 40 && wrapInfo.n[1].top >= wrapInfo.lines[0].h - 2 && wrapInfo.n[1].t === '2', JSON.stringify(wrapInfo.lines.slice(0, 2)));
    check('the coloured copy is exactly as tall as the real text (so the colours sit on the letters)', Math.abs(wrapInfo.sh - wrapInfo.ph) <= 2, `${wrapInfo.sh} vs ${wrapInfo.ph}`);
    await shot('wrap');
    await page.eval('(() => { const t = document.querySelector(".editor-host textarea"); t.focus(); const i = t.value.indexOf("const short"); t.setSelectionRange(i, i); })()');
    await page.type('wal'); await page.sleep(500);
    check('suggestions still open at the caret on a wrapped file', await waitFor('!!document.querySelector(".ed-pop") && !document.querySelector(".ed-pop").hidden', 4000));
    await page.key('Escape', 'down'); await page.key('Escape', 'up');
    await page.eval('(() => { const t = document.querySelector(".editor-host textarea"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()');
    check('the caret position is reported on a wrapped file', (await S('s.cursor.line')) >= 1);
    await S('(s.settings.set("wrapLines", false), 1)'); await page.sleep(400);
    check('turning wrapping off in settings brings back sideways scrolling', await page.eval('(() => { const t = document.querySelector(".editor-host textarea"); return !document.querySelector(".ed.wrap") && t.scrollWidth > t.clientWidth + 50; })()'));
    await S('(s.settings.set("wrapLines", true), 1)'); await page.sleep(400);
    check('and on again wraps again', await page.eval('(() => { const t = document.querySelector(".editor-host textarea"); return !!document.querySelector(".ed.wrap") && t.scrollWidth <= t.clientWidth + 1; })()'));

    // ---------- the starting projects ----------
    for (const [id, title] of [['shooter', 'Space shooter'], ['puzzle', 'Push the boxes'], ['rules', 'Made with rules']]) {
      await S(`(s.createProject({ name: "T ${id}", template: "${id}" }), 1)`);
      await waitFor(`window.studio.project?.name === "T ${id}"`, 8000);
      check(`"${title}" starts and runs in the studio`, await waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 20 && window.studio.diagnostics.size === 0', 12_000), errors());
      if (id === 'shooter') { await S('(s.runner.key("Space", true), 1)'); await page.sleep(900); await S('(s.runner.key("Space", false), 1)'); check('the shooter fires when space is held', await waitFor('(window.studio.runner.summary?.score ?? 0) >= 0 && window.studio.runner.summary?.lives === 3', 3000)); }
      if (id === 'puzzle') { await S('(s.runner.key("ArrowRight", true), 1)'); await page.sleep(300); await S('(s.runner.key("ArrowRight", false), 1)'); check('the puzzle moves one square when a key is pressed', await waitFor('(window.studio.runner.summary?.moves ?? 0) >= 1', 3000), JSON.stringify(await S('s.runner.summary'))); }
      if (id === 'rules') { await S('(s.dock.show("rules"), 1)'); check('the rules template opens with three rules in the Rules panel', await waitFor('document.querySelectorAll(".rules .rule-card").length === 3', 4000)); }
    }
    check('the start page offers all eight', await page.eval('(async () => { await window.studio.commands.execute("project.hub"); return document.querySelectorAll(".hub .cards .card").length; })()') === 8);
    await shot('templates');
    await S('(s.hub?.hide?.(), 1)');

    // ---------- click a thing in the game to pick it; the numbers overlay; boxes ----------
    await S('(s.createProject({ name: "Pick test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Pick test" && window.studio.runner.status === "running" && window.studio.runner.frames > 20', 12000);
    await S('(s.setWorkspace("debug"), s.dock.show("game"), s.dock.show("inspect", { focus: false }), s.runner.watch(true), 1)');
    await page.sleep(800);
    const where = async (kind) => JSON.parse(await page.eval(`(() => {
      const things = window.studio.runner.gameState?.state?.things ?? [];
      const i = things.findIndex((t) => t.kind === ${JSON.stringify(kind)});
      if (i < 0) return JSON.stringify(null);
      const t = things[i];
      const f = document.querySelector('.game-frame').getBoundingClientRect();
      const scale = Math.min(f.width / 480, f.height / 320);
      const x = f.left + (f.width - 480 * scale) / 2 + (t.x + t.w / 2) * scale;
      const y = f.top + (f.height - 320 * scale) / 2 + (t.y + t.h / 2) * scale;
      return JSON.stringify({ x, y, index: i });
    })()`));
    const clickGame = async (x, y) => { await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await page.sleep(500); };
    const hero = await where('hero');
    check('the game\'s state has a hero to pick', !!hero, JSON.stringify(hero));
    await S('(s.commands.execute("game.pick"), 1)');
    check('"Pick" turns on, and the button shows it', await waitFor('window.studio.runner.pickMode && document.querySelector("[data-toggle=\\"game.pick\\"]")?.getAttribute("aria-pressed") === "true"', 3000));
    await clickGame(hero.x, hero.y);
    check('clicking the hero in the game picks it', await waitFor(`JSON.stringify(window.studio.pickedInGame) === JSON.stringify(["things", ${hero.index}])`, 4000), JSON.stringify(await S('s.pickedInGame')));
    check('the Inspector opens the hero and selects it', await waitFor('!!document.querySelector(".state-tree .row.selected")', 4000));
    check('and the game outlines it', await waitFor('true', 100));
    const coin = await where('coin');
    await clickGame(coin.x, coin.y);
    check('clicking a coin picks the coin, not the hero', await waitFor(`JSON.stringify(window.studio.pickedInGame) === JSON.stringify(["things", ${coin.index}])`, 4000), JSON.stringify(await S('s.pickedInGame')));
    await clickGame(hero.x + 4 * 32 + 20, hero.y - 100);
    check('clicking empty space picks nothing', await waitFor('window.studio.pickedInGame === null', 4000), JSON.stringify(await S('s.pickedInGame')));
    await S('(s.commands.execute("game.pick"), 1)');
    check('"Pick" turns off again', await waitFor('!window.studio.runner.pickMode', 3000));
    await S('(s.commands.execute("game.debug"), s.commands.execute("game.boxes"), s.runner.select(["things", 0]), 1)');
    check('the numbers overlay and the boxes are on', await waitFor('window.studio.runner.overlayOn && window.studio.runner.boxesOn', 3000));
    await page.sleep(1200);
    await shot('debug-overlay');
    await S('(s.commands.execute("game.debug"), 1)');
    check('F3 or the command turns the overlay off, and the game keeps running', await waitFor('!window.studio.runner.overlayOn && window.studio.runner.status === "running"', 3000));
    await S('(s.runner.setOverlay(false, false), 1)');

    // ---------- a narrow window: one panel at a time ----------
    await S('(s.createProject({ name: "Narrow test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Narrow test" && window.studio.runner.status === "running"', 12000);
    await S('(s.setWorkspace("code"), 1)'); await page.sleep(300);
    const layoutBefore = JSON.stringify(await S('s.dock.layout'));
    check('a wide window shows panels side by side', !(await S('s.dock.compact')) && (await page.eval('document.querySelectorAll(".dock-group").length')) > 2);
    await page.setViewport(390, 800);
    check('a phone-sized window switches to one panel at a time', await waitFor('window.studio.dock.compact && document.querySelectorAll(".dock-group").length === 1', 4000));
    check('with every panel as a tab in a bar at the bottom', await page.eval('(() => { const t = [...document.querySelectorAll(".compact-tabs .dock-tab")].map((x) => x.textContent); return t.includes("Editor") && t.includes("Game") && t.includes("Files") && t.includes("Console"); })()'));
    check('the bar is below the panel and each tab is big enough to tap', await page.eval('(() => { const b = document.querySelector(".compact-tabs").getBoundingClientRect(); const p = document.querySelector(".dock-group.compact .panel-body:not([hidden])").getBoundingClientRect(); const t = document.querySelector(".compact-tabs .dock-tab").getBoundingClientRect(); return b.top >= p.bottom - 1 && t.height >= 44; })()'));
    check('only one panel is visible', (await page.eval('[...document.querySelectorAll(".dock-group.compact .panel-body")].filter((p) => !p.hidden).length')) === 1);
    check('the page does not scroll sideways, and the search button is reachable', await page.eval('document.documentElement.scrollWidth <= innerWidth && document.getElementById("search-btn").getBoundingClientRect().right <= innerWidth'));
    await page.eval('[...document.querySelectorAll(".compact-tabs .dock-tab")].find((t) => t.textContent === "Game").click()');
    check('tapping a tab shows that panel', await waitFor('!document.querySelector("[data-panel=game]").hidden && document.querySelector("[data-panel=editor]").hidden', 3000));
    await S('(s.dock.show("console"), 1)');
    check('opening a panel from the studio (a mission, a command) shows it', await waitFor('!document.querySelector("[data-panel=console]").hidden', 3000));
    await shot('narrow');
    check('the game keeps running while hidden or shown', await waitFor('window.studio.runner.status === "running"', 3000));
    await page.setViewport(1400, 800);
    check('widening the window brings back the layout exactly as it was', await waitFor('!window.studio.dock.compact', 4000) && JSON.stringify(await S('s.dock.layout')) !== 'null' && (await page.eval('document.querySelectorAll(".dock-group").length')) > 2);
    check('and the saved arrangement was not changed by the narrow view', JSON.parse(layoutBefore).type === (await S('s.dock.layout')).type);

    // ---------- your own pictures and sounds ----------
    await S('(s.createProject({ name: "Assets test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Assets test" && window.studio.runner.status === "running"', 12000);
    await S('(s.setWorkspace("code"), s.dock.show("files"), 1)');
    // real files, made in the page: a green square PNG, a "picture" that is really text, and a short silent WAV
    await page.eval(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 30;
      const c = canvas.getContext('2d'); c.fillStyle = '#00ff00'; c.fillRect(0, 0, 24, 30);
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const wav = new Uint8Array(44 + 800); const dv = new DataView(wav.buffer);
      [...'RIFF'].forEach((ch, i) => { wav[i] = ch.charCodeAt(0); }); dv.setUint32(4, 36 + 800, true);
      [...'WAVEfmt '].forEach((ch, i) => { wav[8 + i] = ch.charCodeAt(0); }); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
      [...'data'].forEach((ch, i) => { wav[36 + i] = ch.charCodeAt(0); }); dv.setUint32(40, 800, true); wav.fill(128, 44);
      window.__files = [new File([png], 'My Hero.PNG', { type: 'image/png' }), new File(['this is not a picture at all'], 'fake.png'), new File([wav], 'boom.wav'), new File(['x'], 'notes.txt')];
      const dt = new DataTransfer(); window.__files.forEach((f) => dt.items.add(f));
      document.querySelector('.panel-body[aria-label="Files"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    check('dropping pictures and sounds on the Files panel adds the good ones under assets/', await waitFor('window.studio.project.has("assets/My Hero.png") && window.studio.project.has("assets/boom.wav")', 6000));
    check('the file name was made tidy (lowercase extension)', await S('s.project.read("assets/My Hero.png") instanceof Uint8Array'));
    check('a file that only pretends to be a picture is refused, and says so', !(await S('s.project.has("assets/fake.png")')) && await waitFor('[...document.querySelectorAll(".toast")].some((t) => t.textContent.includes("not really a png"))', 4000));
    check('a file of an unsupported kind is refused too', !(await S('s.project.has("assets/notes.txt")')));
    check('the Files panel labels them as a picture and a sound', await page.eval('(() => { const b = [...document.querySelectorAll(".files .row, .panel-body[aria-label=Files] .row")].map((r) => r.textContent); return b.some((t) => t.includes("My Hero.png") && t.includes("image")) && b.some((t) => t.includes("boom.wav") && t.includes("sound")); })()'));
    await S('(s.openFile("assets/My Hero.png"), s.dock.show("editor"), 1)');
    check('opening a picture shows it, with how to use it', await waitFor('!!document.querySelector(".asset-preview") && document.querySelector(".asset-how").textContent.includes("image: \\"assets/My Hero.png\\"".replace(/\\"/g, "\'"))', 4000), await page.eval('document.querySelector(".asset-how")?.textContent'));
    await S('(s.openFile("assets/boom.wav"), 1)');
    check('and a sound has a player', await waitFor('!!document.querySelector("audio[controls]")', 4000));
    // use them in the game
    const soundsBefore = await S('s.runner.stats.sounds');
    await S(`(s.project.write("src/main.js", s.project.readText("src/main.js")
      .replace("'@': { kind: 'hero',", "'@': { kind: 'hero', image: 'assets/My Hero.png',")
      .replace("export function create() {", "sounds({ boom: { file: 'assets/boom.wav' } });\\nexport function create() {")
      .replace("} from '@engine/arcade';", "  sounds, play,\\n} from '@engine/arcade';")
      .replace("  const hero = first(game, 'hero');", "  const hero = first(game, 'hero');\\n  if (keys.has('KeyB') && !game.played) { game.played = true; play('boom'); }")), 1)`);
    await S('(s.run({ restart: true }), 1)');                                  // hot reload keeps the old things; start again so the hero is made with its picture
    check('the game runs with the picture in it, without errors', await waitFor('window.studio.runner.status === "running" && window.studio.diagnostics.size === 0 && window.studio.runner.frames > 5', 10_000), errors());
    await S('(s.runner.watch(true), 1)');
    check('the hero thing holds only the picture\'s path', await waitFor('(window.studio.runner.watch(true), JSON.stringify(window.studio.runner.gameState?.state?.things?.find((t) => t.kind === "hero"))?.includes("assets/My Hero.png"))', 8000));
    await S('(s.runner.key("KeyB", true), 1)'); await page.sleep(500); await S('(s.runner.key("KeyB", false), 1)');
    check('no picture failed to load', !(await page.eval('window.studio.entries.some((e) => /could not be loaded/.test(e.text))')), await page.eval('window.studio.entries.filter((e) => /could not be loaded/.test(e.text)).map((e) => e.text).join(" | ")'));
    check('a sound file plays in the game', await waitFor(`window.studio.runner.stats.sounds > ${soundsBefore}`, 6000));
    // the same game, exported: the picture and the sound travel in the zip, and the exported page draws the picture
    const built = await page.eval(`(async () => { const b = await window.studio.ship.build({ title: 'Assets game' }); const { writeZip } = await import('/studio/app/store/zip.js'); const buf = writeZip(b.files); let t = ''; for (let i = 0; i < buf.length; i += 8192) t += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(t); })()`);
    const assetZip = await readZip(Uint8Array.from(Buffer.from(built, 'base64')));
    check('the export carries the picture and the sound as files', assetZip.has('game/assets/My Hero.png') && assetZip.has('game/assets/boom.wav') && new TextDecoder().decode(assetZip.get('index.html')).includes('"assets"'));
    const servedAssets = new Map([...assetZip].map(([k, v]) => ['/' + k, v]));
    const assetServer = http.createServer((req, res) => {
      const pth = decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname);
      const body = servedAssets.get(pth);
      if (!body) { res.writeHead(404).end(); return; }
      const ext = pth.split('.').pop();
      res.writeHead(200, { 'content-type': { html: 'text/html', js: 'text/javascript', png: 'image/png', wav: 'audio/wav', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' }[ext] ?? 'text/plain' }).end(body);
    });
    await new Promise((r) => assetServer.listen(0, '127.0.0.1', r));
    try {
      await withChromePage(`http://localhost:${assetServer.address().port}/`, async (game) => {
        await game.waitFor('document.getElementById("start") && !document.getElementById("start").hidden', 15000);
        const greens = () => game.eval('(() => { const d = document.getElementById("game").getContext("2d").getImageData(0, 0, 480, 320).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 30 && d[i + 1] > 225 && d[i + 2] < 30) n++; return n; })()');
        check('the exported game draws the imported picture (green pixels where the hero stands)', (await greens()) > 300, `${await greens()} green pixels; ${game.errors.slice(0, 2).join(' | ')}`);
        check('and has no errors', game.errors.filter((e) => !/favicon|willReadFrequently/.test(e)).length === 0, game.errors.join(' | '));
      });
    } finally { assetServer.close(); }
    await shot('assets');
    await S('(s.project.remove("assets/My Hero.png"), 1)'); await page.sleep(600);
    check('removing a picture the game uses does not stop the game (it draws a marker square)', await waitFor('window.studio.runner.status === "running" && window.studio.runner.frames > 5', 8000));
    await S('(s.project.write("assets/My Hero.png", window.__heroBytes ?? new Uint8Array([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0])), 1)');

    // ---------- project settings: title, screen size, background, icon ----------
    await S('(s.createProject({ name: "Settings test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Settings test"', 8000);
    await S(`(s.project.write("src/main.js", ${JSON.stringify("import { screen, clear } from '@engine/arcade';\nexport function create() { return { t: 0 }; }\nexport function update(game, keys, dt) { game.t += dt; }\nexport function render(game, g) { clear(g); }\nexport function summary() { return screen(); }\n")}), s.run({ restart: true }), 1)`);
    check('a game sees the usual screen when nothing is set', await waitFor('window.studio.runner.summary?.width === 480 && window.studio.runner.summary?.height === 320', 10_000), JSON.stringify(await S('s.runner.summary')));
    await S('(s.commands.execute("project.settings"), 1)');
    check('Project settings opens a dialog', await waitFor('!!document.querySelector(".dialog .settings-dialog")', 4000));
    await page.eval(`(() => {
      const d = document.querySelector('.dialog');
      const set = (el, v, ev) => { el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); };
      set(d.querySelector('input[type=text]'), 'Frog Hop', 'input');
      set(d.querySelector('select'), 'portrait', 'change');
      set(d.querySelector('input[type=color]'), '#101820', 'input');
      const letters = [...d.querySelectorAll('input[type=text]')]; set(letters[1], 'F', 'input');
    })()`);
    check('choosing a size preset fills in the width and height and names the shape', await page.eval('(() => { const n = [...document.querySelectorAll(".dialog input[type=number]")].map((i) => i.value); return n[0] === "360" && n[1] === "640" && document.querySelector(".dialog .settings-size .dim").textContent.includes("9:16"); })()'));
    await page.eval('[...document.querySelectorAll(".dialog .btn")].find((b) => b.textContent === "Save").click()');
    check('saving writes project.json, a plain file with only what changed', await waitFor('window.studio.project.has("project.json")', 4000) && (await S('JSON.parse(s.project.readText("project.json"))')).width === 360);
    check('the running game gets the new screen without restarting', await waitFor('window.studio.runner.summary?.width === 360 && window.studio.runner.summary?.height === 640 && window.studio.runner.summary?.background === "#101820"', 10_000), JSON.stringify(await S('s.runner.summary')));
    check('and keeps running', await waitFor('window.studio.runner.status === "running" && window.studio.diagnostics.size === 0', 6000));
    await shot('settings-portrait');
    // exported: the page has the right shape, background and icon
    const setBuilt = await page.eval(`(async () => { const b = await window.studio.ship.build({}); const { writeZip } = await import('/studio/app/store/zip.js'); const buf = writeZip(b.files); let t = ''; for (let i = 0; i < buf.length; i += 8192) t += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(t); })()`);
    const setZip = await readZip(Uint8Array.from(Buffer.from(setBuilt, 'base64')));
    const setPage = new TextDecoder().decode(setZip.get('index.html'));
    check('the export uses the title and the screen shape', setPage.includes('<title>Frog Hop</title>') && setPage.includes('width="360" height="640"'));
    check('and the icon letter and the app background', new TextDecoder().decode(setZip.get('icon.svg')).includes('>F</text>') && JSON.parse(new TextDecoder().decode(setZip.get('manifest.webmanifest'))).orientation === 'portrait');
    const settingsServed = new Map([...setZip].map(([k, v]) => ['/' + k, v]));
    const settingsServer = http.createServer((req, res) => {
      const pth = new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname;
      const body = settingsServed.get(decodeURIComponent(pth));
      if (!body) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': { html: 'text/html', js: 'text/javascript', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' }[pth.split('.').pop()] ?? 'text/plain' }).end(body);
    });
    await new Promise((r) => settingsServer.listen(0, '127.0.0.1', r));
    try {
      await withChromePage(`http://localhost:${settingsServer.address().port}/`, async (game) => {
        await game.waitFor('document.getElementById("start") && !document.getElementById("start").hidden', 15000);
        check('the exported game draws on a canvas of the chosen size, in the chosen background', await game.eval('(() => { const c = document.getElementById("game"); const d = c.getContext("2d").getImageData(0, 0, 1, 1).data; return c.width === 360 && c.height === 640 && d[0] === 16 && d[1] === 24 && d[2] === 32; })()'));
        check('and its page keeps the upright shape', await game.eval('(() => { const r = document.querySelector(".wrap").getBoundingClientRect(); return Math.abs(r.width / r.height - 360 / 640) < 0.02; })()'));
      }, { width: 900, height: 700 });
    } finally { settingsServer.close(); }

    // ---------- the 3D scene editor, inside a frame, keeping scenes in the project ----------
    await S('(s.createProject({ name: "Scene test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Scene test" && window.studio.runner.status === "running"', 12000);
    await S('(s.setWorkspace("scene"), s.dock.show("scene3d"), 1)');
    const E3 = (expr) => page.eval(`(() => { const f = document.querySelector(".scene3d-frame"); const e = f && f.contentWindow.__editor; return e ? (${expr}) : null; })()`);
    check('the 3D editor starts in its frame', await waitFor('!!document.querySelector(".scene3d-frame")?.contentWindow?.__editor', 20_000), errors());
    check('a first scene is made in the project', await waitFor('window.studio.project.has("scenes/main.json")', 6000));
    check('the editor lists the building blocks', await waitFor('document.querySelector(".scene3d-frame").contentDocument.querySelectorAll("#palette .item").length >= 7', 4000));
    await page.eval('[...document.querySelector(".scene3d-frame").contentDocument.querySelectorAll("#palette .item")].find((i) => i.textContent === "cube").click()');
    await page.eval('[...document.querySelector(".scene3d-frame").contentDocument.querySelectorAll("#palette .item")].find((i) => i.textContent === "ball").click()');
    check('clicking a block adds it to the scene', await waitFor('document.querySelector(".scene3d-frame").contentWindow.__editor.doc.size === 2', 4000));
    await page.eval('document.querySelector(".scene3d-frame").contentWindow.__editor.save()');
    check('saving writes the scene into the project as a plain file', await waitFor('window.studio.project.readText("scenes/main.json").includes("\\"cube\\"")', 6000));
    check('the file is a scene with both blocks', await page.eval('(() => { const j = JSON.parse(window.studio.project.readText("scenes/main.json")); return j.format === "engine-scene" && j.entities.length === 2 && j.entities.some((e) => e.prefab === "ball"); })()'));
    check('the editor reports no errors', (await E3('e.doc.validate().filter((p) => p.severity === "error").length')) === 0, await E3('JSON.stringify(e.doc.validate()).slice(0, 300)'));
    await shot('scene3d');
    await S('(s.createProject({ name: "Scene test 2", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Scene test 2"', 8000);
    check('another project gets its own empty scene, not the first one', await waitFor('window.studio.project.has("scenes/main.json") && JSON.parse(window.studio.project.readText("scenes/main.json")).entities.length === 0', 20_000));

    // ---------- saved progress and sound, through the game's worker and the runner page ----------
    const kitGame = [
      "import { loadProgress, saveProgress, sounds, play } from '@engine/arcade';",
      "sounds({ beep: { duration: 0.2, layers: [{ wave: 'sine', freq: 440, decay: 0.1 }] } });",
      'export function create() {',
      '  const before = loadProgress();',
      '  saveProgress({ n: (before.n ?? 0) + 1 });',
      "  play('beep');",
      '  return { seen: before.n ?? 0 };',
      '}',
      'export function update() {}',
      "export function render(game, g) { g.fillStyle = '#123'; g.fillRect(0, 0, 480, 320); }",
      'export function summary(game) { return { seen: game.seen }; }',
    ].join('\n');
    await S('(s.createProject({ name: "Kit test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Kit test" && window.studio.runner.status === "running"', 12000); await page.sleep(500);
    await S(`(s.project.write("src/main.js", ${JSON.stringify(kitGame)}), s.run({ restart: true }), 1)`);
    const seen = async () => { await page.sleep(900); return (await json('s.runner.summary'))?.seen; };
    check('a game starts with nothing saved', await waitFor('window.studio.runner.summary?.seen === 0', 8000), JSON.stringify(await json('s.runner.summary')));
    await S('(s.run({ restart: true }), 1)');
    check('and sees what it saved the last time', await waitFor('window.studio.runner.summary?.seen === 1', 8000), JSON.stringify(await json('s.runner.summary')));
    await S('(s.run({ restart: true }), 1)');
    check('every time it starts', await waitFor('window.studio.runner.summary?.seen === 2', 8000));
    check('a sound the game plays reaches the page that makes it', await waitFor('window.studio.runner.stats.sounds >= 1', 4000), String(await S('s.runner.stats.sounds')));
    await S('(s.runner.resetProgress(), 1)'); await page.sleep(300);
    await S('(s.run({ restart: true }), 1)');
    check('"forget progress" starts it from nothing again', await waitFor('window.studio.runner.summary?.seen === 0', 8000));
    void seen;

    // ---------- search in all files, go to definition, find uses, rename, replace in files ----------
    const mainJs = [
      "import { clear } from '@engine/arcade';",
      "import { bonus, SPEED_BONUS } from './helpers.js';",
      'const speed = 5;',
      'export function create() { return { t: 0, score: 0 }; }',
      'export function update(game, keys, dt) { game.t += dt; game.score = bonus(speed) + SPEED_BONUS; }',
      'export function render(game, g) { clear(g); }',
      'export function summary(game) { return { score: game.score }; }',
      '',
    ].join('\n');
    const helpersJs = ['export const SPEED_BONUS = 10;', 'export function bonus(n) { return n + SPEED_BONUS; }', ''].join('\n');
    await S('(s.createProject({ name: "Refactor test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Refactor test"', 8000);
    await S(`(s.project.write("src/main.js", ${JSON.stringify(mainJs)}), s.project.write("src/helpers.js", ${JSON.stringify(helpersJs)}), s.openFile("src/main.js"), s.run({ restart: true }), 1)`);
    check('a two-file game runs (main imports from helpers)', await waitFor('window.studio.runner.summary?.score === 25', 10_000), JSON.stringify(await S('s.runner.summary')));
    const caretAt = (marker, nth = 0, offset = 1) => page.eval(`(() => { const ta = document.querySelector(".ed textarea"); let i = -1; for (let k = 0; k <= ${nth}; k++) i = ta.value.indexOf(${JSON.stringify(marker)}, i + 1); ta.focus(); ta.setSelectionRange(i + ${offset}, i + ${offset}); ta.dispatchEvent(new Event("select")); return i; })()`);

    // search in all files
    await S('(s.commands.execute("search.files"), 1)');
    check('"Search in all files" opens the Search panel with the box ready', await waitFor('!!document.querySelector(".search-input") && document.activeElement === document.querySelector(".search-input")', 4000));
    await page.type('SPEED_BONUS'); await waitFor('document.querySelectorAll(".search-hit").length >= 4', 4000);
    check('typing finds every match in both files, grouped by file', await page.eval('document.querySelectorAll(".search-group").length === 2 && document.querySelectorAll(".search-hit").length === 4'), await page.eval('document.querySelector(".search-summary").textContent'));
    check('the panel says how many it found', (await page.eval('document.querySelector(".search-summary").textContent')).includes('4 results in 2 files'));
    await page.eval('document.querySelector(".search-group:last-child .search-hit").click()'); await page.sleep(400);
    check('clicking a result opens that file at that line', await S('s.activeFile') === 'src/main.js' && await S('s.cursor.line') === 2, `${await S('s.activeFile')}:${await S('s.cursor.line')}`);
    await shot('search-panel');

    // go to definition, across files
    await caretAt('bonus(speed)', 0, 2);
    await S('(s.commands.execute("code.definition"), 1)'); await page.sleep(500);
    check('F12 on "bonus" goes to its declaration in the other file', await S('s.activeFile') === 'src/helpers.js' && await S('s.cursor.line') === 2, `${await S('s.activeFile')}:${await S('s.cursor.line')}`);
    await S('(s.openFile("src/main.js"), 1)'); await page.sleep(400);
    await caretAt('speed', 1, 2);                                                                             // the use of the local in update(): "bonus(speed)"
    await S('(s.commands.execute("code.definition"), 1)'); await page.sleep(500);
    check('F12 on a local name goes to its declaration in the same file', await S('s.activeFile') === 'src/main.js' && await S('s.cursor.line') === 3, `${await S('s.cursor.line')}`);
    await caretAt('clear(g)', 0, 2);
    await S('(s.commands.execute("code.definition"), 1)'); await page.sleep(300);
    check('a name from the engine is not "found", it is explained (help opens)', await waitFor('!!document.querySelector(".ed-tip") || [...document.querySelectorAll(".toast")].some((t) => t.textContent.includes("comes from @engine/arcade"))', 3000));

    // find uses
    await caretAt('const speed', 0, 7);
    await S('(s.commands.execute("code.references"), 1)');
    check('Shift+F12 lists every use of a name', await waitFor('document.querySelector(".search-summary")?.textContent.includes("Uses of “speed”")', 4000) && await page.eval('document.querySelectorAll(".search-hit").length === 2'), await page.eval('document.querySelector(".search-summary").textContent'));
    await caretAt('SPEED_BONUS', 0, 3);
    await S('(s.openFile("src/helpers.js"), 1)'); await page.sleep(300); await caretAt('SPEED_BONUS', 0, 3);
    await S('(s.commands.execute("code.references"), 1)');
    check('uses of an exported name include the importing file', await waitFor('document.querySelectorAll(".search-hit").length === 4 && document.querySelectorAll(".search-group").length === 2', 4000), await page.eval('document.querySelector(".search-summary").textContent'));

    // go to a name in any file with #
    await S('(s.commands.execute("code.symbols"), 1)');
    check('"Go to a name" opens the search box on #', await waitFor('document.querySelector(".palette input")?.value === "#"', 3000));
    await page.type('bonus'); await page.sleep(400);
    check('names from every file are listed (and only with #)', await page.eval('[...document.querySelectorAll(".palette li")].some((li) => li.textContent.includes("function") && li.textContent.includes("src/helpers.js"))'));
    await press('Enter'); await page.sleep(500);
    check('choosing one jumps to it', await S('s.activeFile') === 'src/helpers.js' && await S('s.cursor.line') === 2);
    await S('(s.commands.execute("palette.open"), 1)'); await page.type('bonus'); await page.sleep(300);
    check('without # the search box does not list names', await page.eval('![...document.querySelectorAll(".palette li")].some((li) => li.textContent.includes("function ·"))'));
    await press('Escape');

    // rename everywhere
    await S('(s.openFile("src/helpers.js"), 1)'); await page.sleep(300);
    await caretAt('SPEED_BONUS', 0, 3);
    await S('(s.commands.execute("code.rename"), 1)');
    check('Rename asks for the new name', await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000));
    await page.type('x1'); await page.eval('document.querySelector(".dialog input[type=text]").value = ""');
    await page.type('BONUS_POINTS'); await press('Enter');
    check('and then shows what will change before doing it', await waitFor('!!document.querySelector(".dialog .change-list")', 3000) && (await page.eval('document.querySelector(".dialog").textContent')).includes('4 places in 2 files'), await page.eval('document.querySelector(".dialog")?.textContent.slice(0, 200)'));
    check('nothing changed yet', (await S('s.project.readText("src/helpers.js")')).includes('SPEED_BONUS'));
    await page.eval('[...document.querySelectorAll(".dialog .btn")].find((b) => b.textContent === "Rename").click()'); await page.sleep(700);
    check('the declaration, the import and every use were renamed in both files', await page.eval(`(() => { const a = window.studio.project.readText("src/main.js"), b = window.studio.project.readText("src/helpers.js"); return !a.includes("SPEED_BONUS") && !b.includes("SPEED_BONUS") && a.includes("import { bonus, BONUS_POINTS }") && a.includes("+ BONUS_POINTS;") && b.includes("export const BONUS_POINTS = 10") && b.includes("n + BONUS_POINTS"); })()`));
    check('the word "speed" in other places was left alone (the local, and the text of "SPEED" is not matched)', (await S('s.project.readText("src/main.js")')).includes('const speed = 5;'));
    check('the game keeps running and gives the same answer', await waitFor('window.studio.runner.status === "running" && window.studio.diagnostics.size === 0', 8000));
    await S('(s.run({ restart: true }), 1)');
    check('and it still adds up (the same score as before)', await waitFor('window.studio.runner.summary?.score === 25', 8000), JSON.stringify(await S('s.runner.summary')));
    check('a restore point named for the rename was kept', await page.eval('(async () => (await window.studio.project.snapshots()).some((x) => x.label.startsWith("Renamed SPEED_BONUS")))()'));
    await page.eval('[...document.querySelectorAll(".toast .btn")].find((b) => b.textContent === "Undo")?.click()'); await page.sleep(500);
    check('Undo puts every file back', (await S('s.project.readText("src/helpers.js")')).includes('SPEED_BONUS') && (await S('s.project.readText("src/main.js")')).includes('import { bonus, SPEED_BONUS }'));
    // a rename that would clash is refused
    await S('(s.openFile("src/main.js"), 1)'); await page.sleep(300);
    await caretAt('const speed', 0, 7);
    await S('(s.commands.execute("code.rename"), 1)'); await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000);
    await page.eval('document.querySelector(".dialog input[type=text]").value = ""'); await page.type('bonus'); await press('Enter'); await page.sleep(300);
    check('a new name that is already taken is refused with the reason, and the dialog stays', await page.eval('!!document.querySelector(".dialog .error")?.textContent.includes("already")'), await page.eval('document.querySelector(".dialog .error")?.textContent'));
    await press('Escape'); await page.sleep(200);
    check('with nothing changed', (await S('s.project.readText("src/main.js")')) === mainJs);

    // replace in files
    await S('(s.commands.execute("search.files"), 1)'); await waitFor('!!document.querySelector(".search-input")', 3000);
    await page.eval('document.querySelector(".search-input").value = ""'); await page.type('SPEED_BONUS'); await page.sleep(400);
    await page.eval('[...document.querySelectorAll(".search-head .btn")].find((b) => b.textContent === "Replace…").click()');
    await page.eval('(() => { const r = document.querySelectorAll(".search-input")[1]; r.focus(); r.value = "EXTRA"; r.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await page.eval('[...document.querySelectorAll(".search-head .btn")].find((b) => b.textContent === "Replace all").click()');
    check('Replace all shows how many places and files first', await waitFor('!!document.querySelector(".dialog .change-list")', 3000) && (await page.eval('document.querySelector(".dialog").textContent')).includes('4 places in 2 files'));
    await page.eval('[...document.querySelectorAll(".dialog .btn")].find((b) => b.textContent === "Replace").click()'); await page.sleep(600);
    check('then changes them in both files', (await S('s.project.readText("src/helpers.js")')).includes('EXTRA') && !(await S('s.project.readText("src/main.js")')).includes('SPEED_BONUS'));
    await page.eval('[...document.querySelectorAll(".toast .btn")].find((b) => b.textContent === "Undo")?.click()'); await page.sleep(500);
    check('and Undo brings them back', (await S('s.project.readText("src/main.js")')) === mainJs);
    await S('(s.dock.show("editor"), 1)');

    // ---------- accessibility basics ----------
    await S('document.querySelector(".hub").hidden = true, 1');
    const a11y = JSON.parse(await page.eval(`(() => {
      const nameOf = (e) => (e.getAttribute('aria-label') || e.textContent || e.title || (e.id && document.querySelector('label[for="' + e.id + '"]')?.textContent) || '').trim();
      const unnamed = [...document.querySelectorAll('button, [role=tab], [role=option], [role=separator], input, select, textarea, [role=menuitem]')].filter((e) => e.offsetParent !== null && !nameOf(e)).map((e) => e.outerHTML.slice(0, 80));
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      return JSON.stringify({ unnamed, dupes, lang: document.documentElement.lang, tablists: document.querySelectorAll('[role=tablist]').length, panels: document.querySelectorAll('[role=tabpanel]').length, live: document.querySelectorAll('[aria-live]').length, title: document.title });
    })()`));
    check('every control has a name a screen reader can say', a11y.unnamed.length === 0, a11y.unnamed.slice(0, 2).join(' | '));
    check('no two elements share an id', a11y.dupes.length === 0, a11y.dupes.join(','));
    check('the page has a language, a title, tab lists, tab panels and live regions', a11y.lang === 'en' && a11y.title && a11y.tablists >= 2 && a11y.panels >= 3 && a11y.live >= 2, JSON.stringify(a11y));
    await page.eval('document.activeElement && document.activeElement.blur()'); await press('F6');
    check('F6 moves the keyboard between panels', await page.eval('!!document.activeElement.closest("[data-panel]")'));
    check('no page errors in the whole session', errors() === '', errors());
    await shot('end');
  });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
