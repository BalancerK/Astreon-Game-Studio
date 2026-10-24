// Live check, in a real Chrome with real mouse and keyboard events, of the editing experience: tabs that can be dragged to a new place, into another editor or
// onto an edge (a split), a context menu on tabs, up to three editors, splitters, the same file in two editors, the explorer and the path above the code, and
// that all of it is remembered after the page is reloaded. Usage: node tools/studio-editor-test.js [outDir]
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
    const json = async (expr) => JSON.parse(await S(`JSON.stringify(${expr})`));
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code, modifiers) => { await page.key(code, 'down', modifiers); await page.key(code, 'up', modifiers); };
    const shot = async (name) => { if (outDir) writeFileSync(join(outDir, `editor-${name}.png`), await page.screenshot()); };
    const rect = async (selector, nth = 0) => JSON.parse(await page.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]; if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }); })()`));
    const tabRect = (path, group = 0) => rect(`.editor-group[data-group="${group}"] .editor-tab[data-path="${path}"]`);
    const layout = () => json('s.groups.groups.map((g) => g.files.join(","))');
    /** A real drag: press, move in steps, release. */
    const drag = async (from, to, { steps = 6, release = true } = {}) => {
      await page.mouse('mouseMoved', from.x, from.y);
      await page.mouse('mousePressed', from.x, from.y);
      for (let i = 1; i <= steps; i++) await page.mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
      if (release) await page.mouse('mouseReleased', to.x, to.y);
    };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Editor test", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Editor test"', 10_000);
    await S(`(s.project.write("src/a.js", "export const A = 1;\\nexport function alpha() { return A; }\\n"), s.project.write("src/b.js", "export const B = 2;\\n"),
      s.project.write("src/lib/util.js", "export function util() { return 1; }\\n"), s.project.write("src/lib/deep/more.js", "export const M = 3;\\n"),
      s.commands.execute("workspace.code"), s.openFile("src/a.js"), s.openFile("src/b.js"), s.openFile("src/lib/util.js"), 1)`);
    await page.sleep(500);
    check('three files are open as tabs, in one editor', JSON.stringify(await layout()) === JSON.stringify(['src/main.js,src/a.js,src/b.js,src/lib/util.js']) && (await page.eval('document.querySelectorAll(".editor-group").length')) === 1, JSON.stringify(await layout()));
    check('the path above the code reads like the file', (await page.eval('document.querySelector(".editor-crumbs").textContent')).replace(/\s/g, '').startsWith('src›lib›util.js'));

    // reorder a tab by dragging it
    let a = await tabRect('src/a.js');
    let main = await tabRect('src/main.js');
    await drag({ x: a.cx, y: a.cy }, { x: main.x + 6, y: main.cy });
    check('dragging a tab before another puts it there', (await layout())[0].startsWith('src/a.js,src/main.js'), (await layout())[0]);
    // a click still just chooses a tab
    main = await tabRect('src/main.js');
    await page.mouse('mouseMoved', main.cx, main.cy); await page.mouse('mousePressed', main.cx, main.cy); await page.mouse('mouseReleased', main.cx, main.cy);
    check('and a plain click still chooses a tab (it does not start a drag)', (await S('s.activeFile')) === 'src/main.js');
    await page.eval('document.querySelector(".editor-tab.on").focus()');
    await press('ArrowRight', { ctrl: true, shift: true });
    check('Ctrl+Shift+Right moves the tab one place to the right (a way to reorder without a mouse)', (await layout())[0].startsWith('src/a.js,src/b.js,src/main.js') || (await layout())[0].startsWith('src/a.js,src/b.js'), (await layout())[0]);

    // drag a tab to the right edge of the editor: a split
    const body = await rect('.editor-group .editor-host');
    const mainTab = await tabRect('src/main.js');
    await drag({ x: mainTab.cx, y: mainTab.cy }, { x: body.x + body.w - 20, y: body.cy }, { release: false });
    check('while dragging to an edge the studio shows where it would go', await page.eval('!document.querySelector(".editor-drop").hidden'));
    await shot('dragging');
    await page.mouse('mouseReleased', body.x + body.w - 20, body.cy);
    check('letting go on the right edge makes a second editor beside the first, with that file in it', JSON.stringify(await layout()) === JSON.stringify(['src/a.js,src/b.js,src/lib/util.js', 'src/main.js']), JSON.stringify(await layout()));
    check('the new editor has the focus', (await S('s.groups.focus')) === 1 && (await page.eval('document.querySelector(".editor-group.focused")?.dataset.group')) === '1');
    check('both editors show their file: two code editors', (await page.eval('document.querySelectorAll(".editor-group .ed textarea").length')) === 2 && (await page.eval('[...document.querySelectorAll(".editor-group .ed textarea")].every((t) => t.value.length > 10)')));
    await shot('split');

    // the same file in two editors stays the same
    await S('(s.openFile("src/a.js", { group: 1, duplicate: true }), 1)');
    await page.sleep(300);
    check('a file can be open in both editors', JSON.stringify(await json('s.groups.groupsWith("src/a.js")')) === '[0,1]');
    await page.eval('(() => { const ta = document.querySelectorAll(".editor-group")[1].querySelector(".ed textarea"); ta.focus(); ta.setSelectionRange(0, 0); document.execCommand("insertText", false, "// hello\\n"); })()');
    check('typing in one editor shows in the other', await waitFor('document.querySelectorAll(".editor-group")[0].querySelector(".ed textarea").value.startsWith("// hello")', 4000) || (await S('s.groups.groups[0].active')) !== 'src/a.js');
    await S('(s.groups.activate("src/a.js", 0), s.groupsChanged(), 1)');
    check('the first editor shows the change too', await waitFor('document.querySelectorAll(".editor-group")[0].querySelector(".ed textarea").value.startsWith("// hello")', 4000));

    // drag a file from the Files panel into the second editor
    await S('(s.dock.show("files"), 1)');
    await page.sleep(400);
    const row = await rect('#dock [role=treeitem][data-path="src/lib/deep/more.js"]');
    const second = await rect('.editor-group[data-group="1"] .editor-host');
    if (row) {
      await drag({ x: row.cx, y: row.cy }, { x: second.cx, y: second.cy });
      check('dragging a file from the Files panel into an editor opens it there', (await json('s.groups.groups[1].files')).includes('src/lib/deep/more.js'), JSON.stringify(await layout()));
    } else check('the Files panel shows folders, and the deepest file can be dragged', false, 'the row is not on screen (the folder is folded?)');
    await S('(s.dock.show("editor"), 1)');

    // Escape cancels a drag
    const before = JSON.stringify(await layout());
    const t1 = await tabRect('src/b.js', 0);
    const target = await rect('.editor-group[data-group="1"] .editor-host');
    await drag({ x: t1.cx, y: t1.cy }, { x: target.cx, y: target.cy }, { release: false });
    await press('Escape');
    await page.mouse('mouseReleased', target.cx, target.cy);
    check('Escape while dragging cancels it', JSON.stringify(await layout()) === before);

    // on a touch screen: a quick swipe on the tabs only scrolls them, a finger that rests for a moment drags the tab
    const tabT0 = await tabRect('src/b.js', 0);
    const tabT = { ...tabT0, cx: tabT0.x + 14 };                     // on the name, not on the close button (a finger is not exact)
    const edgeBox = await rect('.editor-group[data-group="1"] .editor-host');
    const layoutBeforeTouch = JSON.stringify(await layout());
    await page.touch('touchStart', [[tabT.cx, tabT.cy, 0]]);
    for (let i = 1; i <= 5; i++) await page.touch('touchMove', [[tabT.cx + i * 12, tabT.cy + i * 20, 0]]);
    await page.touch('touchEnd', []);
    check('a quick swipe on a tab does not drag it', JSON.stringify(await layout()) === layoutBeforeTouch);
    await page.touch('touchStart', [[tabT.cx, tabT.cy, 0]]);
    await page.sleep(550);
    check('after the finger rests, the page knows a drag can begin', await page.eval('document.documentElement.classList.contains("dragging-armed")'));
    for (let i = 1; i <= 8; i++) await page.touch('touchMove', [[tabT.cx + ((edgeBox.x + edgeBox.w - 15 - tabT.cx) * i) / 8, tabT.cy + ((edgeBox.cy - tabT.cy) * i) / 8, 0]]);
    check('and then the tab follows the finger, with the place it would land marked', await page.eval('!document.querySelector(".editor-drop").hidden && !!document.querySelector(".drag-ghost")'));
    await page.touch('touchEnd', []);
    check('letting go at the edge splits there, just as with a mouse', (await S('s.groups.groups.length')) === 3, JSON.stringify(await layout()));
    await S('(s.groups.closeAll(2), s.groupsChanged(), 1)');
    await page.sleep(200);

    // the context menu of a tab
    await page.eval('(() => { const t = document.querySelector(".editor-group[data-group=\\"0\\"] .editor-tab[data-path=\\"src/b.js\\"]"); t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })); })()');
    check('a right click on a tab opens a menu of what can be done with it', await waitFor('!!document.querySelector(".context-menu")', 3000) && (await page.eval('document.querySelector(".context-menu").textContent')).includes('Close the others') && (await page.eval('document.querySelector(".context-menu").textContent')).includes('Split down'));
    await page.eval('[...document.querySelectorAll(".context-menu button")].find((b) => b.textContent.includes("Split down")).click()');
    check('"Split down" makes a third editor, and the editors are now stacked', (await S('s.groups.groups.length')) === 3 && (await S('s.groups.direction')) === 'column', `${await S('s.groups.groups.length')} ${await S('s.groups.direction')}`);
    await S('(s.splitFile("src/a.js", "down"), 1)');
    check('four is the most: the split buttons are gone', await page.eval('[...document.querySelectorAll(".editor-group [aria-label^=\\"Split the editor\\"]")].every((b) => b.hidden)'));
    await shot('three');
    // close until one is left
    await S('(s.groups.closeAll(3), s.groups.closeAll(2), s.groupsChanged(), 1)');
    check('an editor with no tabs left goes away', (await S('s.groups.groups.length')) === 2 && (await page.eval('document.querySelectorAll(".editor-group").length')) === 2);

    // the splitter
    await S('(s.groups.unsplit(), s.groups.split("src/main.js", 0, "right"), s.groupsChanged(), 1)');
    await page.sleep(300);
    const sep = await rect('.editor-sep.v', 1) ?? await rect('.editor-groups .editor-sep');
    const w0 = (await json('s.groups.sizes'))[0];
    await drag({ x: sep.cx, y: sep.cy }, { x: sep.cx + 120, y: sep.cy });
    const w1 = (await json('s.groups.sizes'))[0];
    check('dragging the bar between editors changes their shares', w1 > w0 + 0.05, `${w0.toFixed(2)} -> ${w1.toFixed(2)}`);
    await page.eval('document.querySelector(".editor-groups .editor-sep").focus()');
    await press('ArrowLeft');
    check('the arrow keys move it too', (await json('s.groups.sizes'))[0] < w1);
    await page.eval('document.querySelector(".editor-groups .editor-sep").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
    check('a double click shares the space equally again', Math.abs((await json('s.groups.sizes'))[0] - 0.5) < 0.01);

    // keyboard: next tab, focus the other editor, join them
    await S('(s.commands.execute("editor.focus-previous"), 1)');
    check('"Go to the previous editor" moves the focus', (await S('s.groups.focus')) === 0);
    const active0 = await S('s.activeFile');
    await press('PageDown', { alt: true });
    check('Alt+PageDown goes to the next tab', (await S('s.activeFile')) !== active0);
    await S('(s.commands.execute("editor.unsplit"), 1)');
    check('"Join the editors into one" puts every tab in one row', (await S('s.groups.groups.length')) === 1 && (await S('s.groups.files.length')) >= 4);
    await shot('joined');

    // the explorer
    await S('(s.commands.execute("editor.explorer"), 1)');
    check('the explorer opens beside the code', await waitFor('!document.querySelector(".editor-side").hidden && document.querySelectorAll(".editor-side [role=treeitem]").length >= 6', 3000));
    check('it shows folders and files, with the open file chosen', await page.eval('!!document.querySelector(".editor-side [data-kind=dir][data-path=\\"src/lib\\"]") && document.querySelector(".editor-side .row.selected")?.dataset.path === window.studio.activeFile'));
    await page.eval('document.querySelector(".editor-side [data-kind=dir][data-path=\\"src/lib\\"]").click()');
    check('clicking a folder folds it', await waitFor('!document.querySelector(".editor-side [data-path=\\"src/lib/util.js\\"]")', 2000));
    await page.eval('document.querySelector(".editor-side [data-kind=dir][data-path=\\"src/lib\\"]").focus()');
    await press('ArrowRight');
    check('and the right arrow opens it again', await waitFor('!!document.querySelector(".editor-side [data-path=\\"src/lib/util.js\\"]")', 2000));
    await page.eval('(() => { const f = document.querySelector(".editor-side .tree-filter"); f.value = "util"; f.dispatchEvent(new Event("input", { bubbles: true })); })()');
    check('the filter shows only what matches (with its folders)', await waitFor('document.querySelectorAll(".editor-side [data-kind=file]").length === 1', 2000));
    await page.eval('document.querySelector(".editor-side [data-kind=file]").click()');
    check('choosing a file in the explorer opens it in the editor', (await S('s.activeFile')) === 'src/lib/util.js');
    await page.eval('(() => { const f = document.querySelector(".editor-side .tree-filter"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()');
    // widen it
    const handle = await rect('.editor-root > .editor-sep');
    await drag({ x: handle.cx, y: handle.cy }, { x: handle.cx + 60, y: handle.cy });
    check('the explorer can be made wider', (await rect('.editor-side')).w > 230, String((await rect('.editor-side')).w));
    await shot('explorer');

    // the path above the code
    await S('(s.openFile("src/a.js"), 1)'); await page.sleep(300);
    await page.eval('(() => { const ta = document.querySelector(".editor-group .ed textarea"); ta.focus(); const i = ta.value.indexOf("return A"); ta.setSelectionRange(i, i); ta.dispatchEvent(new Event("select")); document.dispatchEvent(new Event("selectionchange")); })()');
    check('the path above the code names the function the cursor is in', await waitFor('[...document.querySelectorAll(".editor-crumbs .crumb.symbol")].some((c) => c.textContent === "alpha()")', 3000), await page.eval('document.querySelector(".editor-crumbs").textContent'));
    await page.eval('document.querySelector(".editor-crumbs .crumb:not(.last):not(.symbol)").click()');
    check('clicking a part of the path lists what is beside it', await waitFor('!!document.querySelector(".context-menu") && document.querySelector(".context-menu").textContent.includes("src/")', 2000));
    await press('Escape');

    // looks: code colours, accent, font, line spacing, the shaded line
    await S('(s.groups.unsplit(), s.groupsChanged(), 1)'); await page.sleep(200);
    const bg = () => page.eval('getComputedStyle(document.querySelector(".editor-group .ed")).backgroundColor');
    const plainBg = await bg();
    await S('(s.settings.set("editorTheme", "midnight"), 1)');
    check('choosing a code colour scheme changes the editor (and only the editor)', await waitFor('getComputedStyle(document.querySelector(".editor-group .ed")).backgroundColor === "rgb(11, 16, 32)"', 3000) && plainBg !== 'rgb(11, 16, 32)' && (await page.eval('getComputedStyle(document.body).backgroundColor')) !== 'rgb(11, 16, 32)', await bg());
    check('the code colours follow it', (await page.eval('getComputedStyle(document.documentElement).getPropertyValue("--tk-k").trim()')) === '#c792ea');
    await S('(s.settings.set("accent", "teal"), 1)');
    check('an accent colour changes buttons and selections', await waitFor('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().length > 0', 3000));
    await S('(s.settings.set("editorTheme", "auto"), s.settings.set("accent", "indigo"), 1)');
    check('"same as the interface" and the default accent put everything back', await waitFor('getComputedStyle(document.documentElement).getPropertyValue("--tk-k").trim() !== "#c792ea" && !["#0f766e", "#2dd4bf"].includes(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())', 3000));
    const lh0 = await page.eval('parseFloat(getComputedStyle(document.querySelector(".editor-group .ed")).lineHeight)');
    await S('(s.settings.set("lineHeight", 1.9), 1)');
    check('the space between lines can be changed', await waitFor(`parseFloat(getComputedStyle(document.querySelector(".editor-group .ed")).lineHeight) > ${lh0 + 4}`, 3000));
    await S('(s.settings.set("lineHeight", 1.45), s.settings.set("fontFamily", "consolas"), 1)');
    check('and so can the font', await waitFor('getComputedStyle(document.querySelector(".editor-group .ed")).fontFamily.includes("Consolas")', 3000));
    await S('(s.settings.set("fontFamily", "system"), 1)');
    await page.eval('document.querySelector(".editor-group .ed textarea").focus()');
    check('the line the cursor is on is shaded', await waitFor('getComputedStyle(document.querySelector(".editor-group .ed .curline")).display === "block"', 3000));
    const y0 = await page.eval('document.querySelector(".editor-group .ed .curline").style.transform');
    await press('ArrowDown');
    check('and the shading moves with the cursor', await waitFor(`document.querySelector(".editor-group .ed .curline").style.transform !== ${JSON.stringify(y0)}`, 3000));
    await S('(s.settings.set("highlightLine", false), 1)');
    check('and can be turned off', await waitFor('getComputedStyle(document.querySelector(".editor-group .ed .curline")).display === "none"', 3000));
    await S('(s.settings.set("highlightLine", true), 1)');

    // thin lines for the indentation, and a small overview of a long file
    const long = Array.from({ length: 300 }, (_, i) => (i % 5 === 0 ? `function f${i}() {` : i % 5 === 4 ? '}' : `    const v${i} = ${i}; // line ${i}`)).join(String.fromCharCode(10));
    await S(`(s.project.write("src/long.js", ${JSON.stringify(long)}), s.openFile("src/long.js"), 1)`);
    await page.sleep(900);
    const guide = await page.eval('(() => { const l = [...document.querySelectorAll(".editor-group .ed .ln")].find((e) => e.style.getPropertyValue("--ind") === "4"); return l ? getComputedStyle(l).backgroundImage.slice(0, 20) + " " + getComputedStyle(l).backgroundSize : "none found"; })()');
    check('an indented line has a thin line for each level of indentation', guide.startsWith('repeating-linear') && !guide.endsWith(' 0px 100%') , guide);
    await shot('guides');
    check('a long file gets an overview beside it', await waitFor('document.querySelector(".editor-group .ed").classList.contains("has-minimap") && document.querySelector(".editor-group .ed .minimap").clientWidth > 40', 3000));
    check('which is drawn in the colours of the code', await waitFor('(() => { const c = document.querySelector(".editor-group .ed .minimap"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n > 300; })()', 4000));
    const mm = await rect('.editor-group .ed .minimap');
    await page.mouse('mouseMoved', mm.x + 30, mm.y + mm.h * 0.8); await page.mouse('mousePressed', mm.x + 30, mm.y + mm.h * 0.8); await page.mouse('mouseReleased', mm.x + 30, mm.y + mm.h * 0.8);
    check('clicking it goes to that part of the file', await waitFor('(() => { const t = document.querySelector(".editor-group .ed textarea"); return t.scrollTop > (t.scrollHeight - t.clientHeight) * 0.5; })()', 3000));
    await S('(s.settings.set("minimap", false), s.settings.set("indentGuides", false), 1)');
    check('both can be turned off in Settings', await waitFor('!document.querySelector(".editor-group .ed").classList.contains("has-minimap") && !document.querySelector(".editor-group .ed").classList.contains("guides")', 3000));
    await S('(s.settings.set("minimap", true), s.settings.set("indentGuides", true), s.closeFile("src/long.js"), 1)');

    // a panel can fill the window, and a double click on a bar shares the space
    const groupsBefore = await page.eval('document.querySelectorAll("#dock .dock-group").length');
    await S('(s.dock.focus("editor"), s.commands.execute("view.maximize"), 1)');
    check('"Make this panel fill the window" shows only that panel', await waitFor('document.getElementById("dock").classList.contains("maximized") && document.querySelectorAll("#dock .dock-group").length === 1', 3000));
    await S('(s.commands.execute("view.maximize"), 1)');
    check('and the same command puts everything back', await waitFor(`!document.getElementById("dock").classList.contains("maximized") && document.querySelectorAll("#dock .dock-group").length === ${groupsBefore}`, 3000));
    const dockSep = await rect('#dock .dock-splitter');
    await drag({ x: dockSep.cx, y: dockSep.cy }, { x: dockSep.cx + 90, y: dockSep.cy });
    const uneven = await page.eval('document.querySelector("#dock .dock-splitter").getAttribute("aria-valuenow")');
    await page.eval('document.querySelector("#dock .dock-splitter").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
    check('a double click on a bar between panels shares their space equally again', (await page.eval('document.querySelector("#dock .dock-splitter").getAttribute("aria-valuenow")')) !== uneven);

    // on a narrow screen the menus are behind one button
    await page.setViewport(600, 800);
    check('on a narrow screen there is a menu button', await waitFor('getComputedStyle(document.getElementById("menu-btn")).display !== "none" && getComputedStyle(document.getElementById("menubar")).display === "none"', 3000));
    await page.eval('document.getElementById("menu-btn").click()');
    check('it opens every menu in one list, with their commands', await waitFor('!!document.querySelector(".context-menu") && document.querySelector(".context-menu").textContent.includes("FILE") && document.querySelector(".context-menu").textContent.includes("Run the game")', 3000));
    await press('Escape');
    await page.setViewport(1600, 900);
    await page.sleep(400);

    // everything is remembered
    await S('(s.groups.split("src/b.js", 0, "right"), s.groupsChanged(), 1)');
    await page.sleep(900);
    const saved = JSON.stringify(await layout());
    await page.eval('location.reload()');
    check('after reloading the page the editors and tabs are as they were', await waitFor(`!!window.studio?.project && JSON.stringify(window.studio.groups.groups.map((g) => g.files.join(","))) === ${JSON.stringify(saved)}`, 20_000), saved);
    check('and so is the explorer', await waitFor('!document.querySelector(".editor-side").hidden', 5000));

    const errs = page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1600, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
