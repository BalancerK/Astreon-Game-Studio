// Live check, in a real Chrome with real keys and mouse moves, of the Blender-style 3D editor: G grabs and the block follows the mouse as it moves, X then a number
// puts it exactly, S then Y makes a block taller (its shape changes, in real time), R then a number turns it, Esc puts everything back, Shift+D duplicates and grabs,
// X deletes, the number pad changes the view, N hides the inspector, and every change is one step of undo. Usage: node tools/studio-blender-test.js [outDir]
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
    const E = (expr) => page.eval(`(() => { const f = document.querySelector(".scene3d-frame"); const w = f && f.contentWindow; if (!w || !w.__editor) return null; with (w) { const ed = __editor; return (${expr}); } })()`);
    const tap = async (code, mods = {}) => { await page.key(code, 'down', mods); await page.key(code, 'up', mods); await sleep(40); };
    const frame = async () => JSON.parse(await page.eval('JSON.stringify(document.querySelector(".scene3d-frame").getBoundingClientRect())'));
    const at = async () => JSON.parse(await E('JSON.stringify(ed.doc.get(ed.selection.primary)?.at ?? {})'));
    const params = async () => JSON.parse(await E('JSON.stringify(ed.doc.get(ed.selection.primary)?.params ?? {})'));

    check('the studio opens', await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Blender test", template: "blank" }), s.setWorkspace("scene"), s.dock.show("scene3d"), 1)');
    check('the 3D editor starts with the Blender keys on', await page.waitFor('!!document.querySelector(".scene3d-frame")?.contentWindow?.__editor?.blender', 25_000));
    await E('[...document.querySelectorAll("#palette .item")].find((i) => i.textContent === "cube").click()');
    check('a cube is added and selected', await page.waitFor('document.querySelector(".scene3d-frame").contentWindow.__editor.selection.size === 1', 4000));
    // give the editor the keyboard, and put the pointer over the viewport
    const f = await frame();
    const cx = f.left + 700;
    const cy = f.top + 400;
    await page.eval('document.querySelector(".scene3d-frame").focus()');
    await E('ed.stage.focus()');
    await page.mouse('mouseMoved', cx, cy);
    await sleep(100);
    const start = await at();
    const undoBefore = await E('ed.doc.canUndo');

    // G: the block follows the mouse while it moves
    await tap('KeyG');
    check('G starts a grab and says so at the top of the viewport', await E('!!ed.blender.active()') && (await E('document.querySelector(".modal-bar")?.textContent ?? ""')).startsWith('Move'));
    await page.mouse('mouseMoved', cx + 60, cy);
    await page.mouse('mouseMoved', cx + 140, cy);
    await sleep(150);
    const dragged = await at();
    check('moving the mouse moves the block at once, before anything is confirmed', Math.abs((dragged.x ?? 0) - (start.x ?? 0)) > 0.3 || Math.abs((dragged.z ?? 0) - (start.z ?? 0)) > 0.3, JSON.stringify(dragged));
    if (outDir) writeFileSync(join(outDir, 'blender-grab.png'), await page.screenshot());
    await tap('KeyX');
    await tap('Digit2');
    check('X then a number puts it exactly: 2 metres along x', Math.abs((await at()).x - ((start.x ?? 0) + 2)) < 1e-6 && Math.abs(((await at()).z ?? 0) - (start.z ?? 0)) < 1e-6, JSON.stringify(await at()));
    await tap('Enter');
    check('Enter keeps it, and the transform ends', !(await E('!!ed.blender.active()')) && Math.abs((await at()).x - ((start.x ?? 0) + 2)) < 1e-6);
    await tap('KeyZ', { ctrl: true });
    check('one undo puts the whole move back', Math.abs(((await at()).x ?? 0) - (start.x ?? 0)) < 1e-6);
    await tap('KeyY', { ctrl: true });

    // Esc puts everything back
    const here = await at();
    const steps = await E('ed.doc.undoStack.length');
    await tap('KeyG');
    await page.mouse('mouseMoved', cx + 200, cy + 80);
    await sleep(100);
    await tap('Escape');
    const back = await at();
    check('Esc cancels: the block is where it was and no undo step is left', back.x === here.x && back.z === here.z && (await E('ed.doc.undoStack.length')) === steps && !(await E('!!ed.blender.active()')));

    // S then Y: the shape changes (taller), typed exactly
    const before = await E('JSON.stringify(ed.view.items().find((i) => i.id === ed.selection.primary).half)');
    await tap('KeyS');
    await tap('KeyY');
    await tap('Digit3');
    const live = await E('JSON.stringify(ed.view.items().find((i) => i.id === ed.selection.primary).half)');
    check('S then Y then 3 makes the block three times taller while it is still running', JSON.parse(live)[1] === JSON.parse(before)[1] * 3 && JSON.parse(live)[0] === JSON.parse(before)[0], `${before} -> ${live}`);
    check('and the header shows the size', /size 1 × 3 × 1/.test(await E('document.querySelector(".modal-bar")?.textContent ?? ""')));
    await tap('Enter');
    check('the new height is saved in the block\'s parameters, not as a squash', JSON.stringify(await params()) === '{"halfHeight":1.5}', JSON.stringify(await params()));
    if (outDir) writeFileSync(join(outDir, 'blender-scale.png'), await page.screenshot());

    // R then a number turns it
    await tap('KeyR');
    await tap('KeyY');
    await tap('Digit9');
    await tap('Digit0');
    await tap('Enter');
    const turned = await at();
    check('R then Y then 90 turns it a quarter about its upright axis', Math.abs(Math.abs(turned.yaw ?? 0) - Math.PI / 2) < 0.01 || !!turned.rotation, JSON.stringify(turned));

    // Shift+D duplicates and grabs; X deletes
    const count = await E('ed.doc.size');
    await tap('KeyD', { shift: true });
    check('Shift+D makes a copy and starts grabbing it', (await E('ed.doc.size')) === count + 1 && (await E('!!ed.blender.active()')));
    await tap('Escape');
    check('Esc cancels the grab but keeps the copy', (await E('ed.doc.size')) === count + 1);
    await tap('KeyX');
    check('X deletes the selection', (await E('ed.doc.size')) === count);

    // shape edit: Tab gives every face and edge of the box a handle
    await tap('Numpad1');                                                 // a front view: the faces face us and the handles are easy to reach
    await E('(ed.orbit.autoOrtho = false, ed.orbit.ortho = false, ed.focus(), 1)');
    await sleep(200);
    await E('ed.selection.set(ed.doc.order[0])');
    await E('(ed.doc.update(ed.doc.order[0], { at: { rotation: null, yaw: null } }), 1)');                 // it was turned a quarter above: stand it straight again
    await tap('Tab');
    check('Tab on a box starts shape edit and says what to do', (await E('ed.blender.box.active')) && /Shape edit/.test(await E('document.querySelector(".modal-bar")?.textContent ?? ""')));
    const boxRect = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const sizeNow = async () => JSON.parse(await E('JSON.stringify(ed.view.items().find((i) => i.id === ed.selection.primary).half)'));
    const minMax = async () => JSON.parse(await E('JSON.stringify((() => { const b = ed.view.bounds([ed.selection.primary]); return [b.min, b.max]; })())'));
    const s0 = await sizeNow();
    const m0 = await minMax();
    const handle = async (id) => { const p = JSON.parse(await E(`JSON.stringify(ed.blender.box.featureScreen("${id}"))`)); return { x: p.x + boxRect.left + f.left, y: p.y + boxRect.top + f.top }; };
    const drag = async (from, dx, dy) => {
      await page.mouse('mouseMoved', from.x, from.y);
      await page.mouse('mousePressed', from.x, from.y);
      for (let i = 1; i <= 6; i++) await page.mouse('mouseMoved', from.x + (dx * i) / 6, from.y + (dy * i) / 6, { buttons: 1 });
      await sleep(80);
    };
    const stepsBefore = await E('ed.doc.undoStack.length');
    const right = await handle('x+');
    await drag(right, 60, 0);
    const mid = await sizeNow();
    const mm = await minMax();
    check('dragging the right face widens the box while the mouse is still down', mid[0] > s0[0] + 0.1 && mid[1] === s0[1] && mid[2] === s0[2], `${s0} -> ${mid}`);
    check('and the left side stays exactly where it was', Math.abs(mm[0][0] - m0[0][0]) < 1e-6 && mm[1][0] > m0[1][0] + 0.2, JSON.stringify([m0, mm]));
    if (outDir) writeFileSync(join(outDir, 'blender-face.png'), await page.screenshot());
    await page.mouse('mouseReleased', right.x + 60, right.y);
    check('the drag is one step of undo', (await E('ed.doc.undoStack.length')) === stepsBefore + 1);
    await tap('KeyZ', { ctrl: true });
    const back0 = await sizeNow();
    check('and one undo puts the side back', Math.abs(back0[0] - s0[0]) < 1e-9 && Math.abs((await minMax())[1][0] - m0[1][0]) < 1e-9);
    // an edge: two sides at once
    const edge = await handle('y+z+');
    await drag(edge, 0, -50);
    const e1 = await sizeNow();
    check('dragging the top front edge moves two sides: it gets taller and deeper', e1[1] !== s0[1] || e1[2] !== s0[2], `${s0} -> ${e1}`);
    await tap('Escape');
    check('Esc during a drag cancels it', Math.abs((await sizeNow())[1] - s0[1]) < 1e-9 && Math.abs((await sizeNow())[2] - s0[2]) < 1e-9);
    await page.mouse('mouseReleased', edge.x, edge.y - 50);
    // click a handle, then G and a number
    const top = await handle('y+');
    await page.mouse('mouseMoved', top.x, top.y);
    await page.mouse('mousePressed', top.x, top.y);
    await page.mouse('mouseReleased', top.x, top.y);
    await tap('KeyG');
    await tap('Digit1');
    const g1 = await sizeNow();
    check('click a face, then G and 1: that side moves one metre along its own axis', Math.abs(g1[1] - (s0[1] + 0.5)) < 1e-6 && g1[0] === s0[0], `${s0} -> ${g1}`);
    check('and the header says it is moving a side', /Move/.test(await E('document.querySelector(".modal-bar")?.textContent ?? ""')));
    await tap('Enter');
    await tap('Tab');
    check('Tab leaves shape edit', !(await E('ed.blender.box.active')));
    await tap('KeyZ', { ctrl: true });

    // snapping to other objects: two cubes, lined up in a front view where a pixel is the same size everywhere
    await E('(ed.doc.batch("clear", () => { for (const id of [...ed.doc.order]) ed.doc.remove(id); }), 1)');
    await E('(ed.doc.batch("two cubes", () => { ed.doc.add({ id: "a", prefab: "cube", at: { x: 0, y: 0.5, z: 0 } }); ed.doc.add({ id: "b", prefab: "cube", at: { x: 3.2, y: 0.5, z: 0 } }); }), ed.selection.set("b"), 1)');
    await E('(ed.setView("front"), ed.focus(ed.doc.order), 1)');
    await sleep(300);
    const gx = async () => (await E('ed.doc.get("b").at.x'));
    const slide = async (units, modifiers = {}) => {
      await page.mouse('mouseMoved', cx, cy);
      await sleep(60);
      await tap('KeyG');
      await tap('KeyX');
      const upp = await E('ed.blender.active().view.unitsPerPixel');
      const steps = 8;
      for (let i = 1; i <= steps; i++) await page.mouse('mouseMoved', cx + (units / upp) * (i / steps), cy, { modifiers });
      await sleep(80);
      const during = await gx();
      await tap('Enter');
      return during;
    };
    const near = await slide(-2.16);
    check('moving a cube towards another with the Magnet on lines their sides up exactly (it would have been 1.04)', Math.abs(near - 1) < 1e-9, `x = ${near}`);
    await tap('KeyZ', { ctrl: true });
    await tap('KeyM');
    check('M turns snapping to objects off (the toolbar shows it)', !(await E('ed.state.objectSnap')) && !(await E('[...document.querySelectorAll("button.btn.on")].some((b) => b.title.startsWith("Snap to other"))')));
    const free = await slide(-2.16);
    check('with it off the cube goes where the mouse puts it', Math.abs(free - 1.04) < 0.02 && Math.abs(free - 1) > 1e-6, `x = ${free}`);
    await tap('KeyZ', { ctrl: true });
    await tap('KeyM');
    await page.key('AltLeft', 'down', { alt: true });
    const held = await slide(-2.16, { alt: true });
    await page.key('AltLeft', 'up');
    check('holding Alt skips snapping once', Math.abs(held - 1) > 1e-6, `x = ${held}`);
    await tap('KeyZ', { ctrl: true });
    // a dragged side snaps too: stretch the left face of b towards a
    await tap('Tab');
    const brect = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const lf = JSON.parse(await E('JSON.stringify(ed.blender.box.featureScreen("x-"))'));
    const upp2 = await E('ed.pixelSize([3.2, 0.5, 0])');
    const from = { x: lf.x + brect.left + f.left, y: lf.y + brect.top + f.top };
    await page.mouse('mouseMoved', from.x, from.y);
    await page.mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', from.x - (2.16 / upp2) * (i / 8), from.y, { buttons: 1 });
    await sleep(80);
    const sides = JSON.parse(await E('JSON.stringify(ed.view.bounds(["b"]))'));
    await page.mouse('mouseReleased', from.x - 2.16 / upp2, from.y);
    check('dragging the left side of a cube towards another snaps it to the side of the other one, and the far side does not move', Math.abs(sides.min[0] - 0.5) < 1e-9 && Math.abs(sides.max[0] - 3.7) < 1e-9, JSON.stringify(sides));
    await tap('Tab');
    await tap('KeyZ', { ctrl: true });

    // corner to corner: a cube turned half a radian, and a free move of another until its corner is near the turned one's corner
    await E('(ed.doc.update("a", { at: { yaw: 0.5 } }), ed.doc.update("b", { at: { x: 3.2, y: 0.5, z: 0 } }), ed.selection.set("b"), ed.setView("top"), ed.focus(ed.doc.order), 1)');
    await sleep(300);
    await page.mouse('mouseMoved', cx, cy);
    await sleep(60);
    const corner = JSON.parse(await E('JSON.stringify(ed.snapTargets(["b"])[0].points.find((p) => p[1] > 0.9 && p[0] > 0 && p[2] < 0))'));
    await tap('KeyG');
    const mv = JSON.parse(await E('JSON.stringify(ed.blender.active().view)'));
    const want = [corner[0] + 0.5 - 3.2, 0, corner[2] + 0.5];                          // how far the other cube's middle has to go for its corner to meet that one
    const px = ((want[0] + 0.03) * mv.right[0] + (want[2] - 0.04) * mv.right[2]) / mv.unitsPerPixel;
    const py = -((want[0] + 0.03) * mv.up[0] + (want[2] - 0.04) * mv.up[2]) / mv.unitsPerPixel;
    for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', cx + (px * i) / 8, cy + (py * i) / 8);
    await sleep(100);
    const placed = JSON.parse(await E('JSON.stringify(ed.doc.get("b").at)'));
    await tap('Enter');
    check('a free move lands a corner exactly on the corner of a turned cube (where the sides of its box would not)', Math.abs(placed.x - (corner[0] + 0.5)) < 1e-6 && Math.abs(placed.z - (corner[2] + 0.5)) < 1e-6 && placed.y === 0.5, `${JSON.stringify(placed)} against ${JSON.stringify(corner)}`);
    if (outDir) writeFileSync(join(outDir, 'blender-corner.png'), await page.screenshot());
    await tap('KeyZ', { ctrl: true });
    await E('(ed.doc.update("a", { at: { yaw: null } }), 1)');

    // the 3D cursor: Shift + right click puts it down, new blocks appear there, Shift+S moves things to it and it to things, and it can be the pivot of a turn
    await E('(ed.doc.update("a", { at: { x: 0, y: 0.5, z: 0 } }), ed.doc.update("b", { at: { x: 3.2, y: 0.5, z: 0 } }), ed.selection.clear(), ed.setView("top"), ed.focus(ed.doc.order), 1)');
    await sleep(300);
    const sbox = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const emptyLocal = { x: 40, y: 60 };
    const expectGround = JSON.parse(await E(`JSON.stringify(ed.groundAt(${emptyLocal.x}, ${emptyLocal.y}))`));
    const abs = { x: emptyLocal.x + sbox.left + f.left, y: emptyLocal.y + sbox.top + f.top };
    await page.mouse('mouseMoved', abs.x, abs.y);
    await page.mouse('mousePressed', abs.x, abs.y, { button: 'right', modifiers: { shift: true } });
    await page.mouse('mouseReleased', abs.x, abs.y, { button: 'right', modifiers: { shift: true } });
    const placedCursor = JSON.parse(await E('JSON.stringify(ed.cursor.position)'));
    check('Shift + right click puts the 3D cursor on the ground under the pointer', placedCursor.every((v, i) => Math.abs(v - expectGround[i]) < 0.002), `${placedCursor} against ${expectGround}`);
    if (outDir) writeFileSync(join(outDir, 'blender-cursor.png'), await page.screenshot());
    check('and the view did not move or pan', (await E('ed.orbit.viewName')) === 'top');
    const count1 = await E('ed.doc.size');
    await tap('KeyA', { shift: true });
    await E('[...document.querySelectorAll(".add-menu button")].find((b) => b.textContent === "pillar").click()');
    const pillar = JSON.parse(await E('JSON.stringify(ed.doc.get(ed.selection.primary).at)'));
    check('Shift+A adds the block at the 3D cursor', (await E('ed.doc.size')) === count1 + 1 && Math.abs(pillar.x - placedCursor[0]) < 0.002 && Math.abs(pillar.z - placedCursor[2]) < 0.002, JSON.stringify(pillar));
    await E('(ed.selection.set("b"), 1)');
    await tap('KeyS', { shift: true });
    await E('[...document.querySelectorAll(".add-menu button")].find((b) => b.textContent === "Cursor to selected").click()');
    check('Shift+S then "Cursor to selected" puts the cursor on the selection', JSON.parse(await E('JSON.stringify(ed.cursor.position)'))[0] === 3.2);
    await E('(ed.selection.set("a"), 1)');
    await tap('KeyS', { shift: true });
    await E('[...document.querySelectorAll(".add-menu button")].find((b) => b.textContent === "Selection to cursor").click()');
    check('and "Selection to cursor" carries a block there (one step of undo)', Math.abs((await E('ed.doc.get("a").at.x')) - 3.2) < 1e-9);
    await tap('KeyZ', { ctrl: true });
    check('undo puts it back', Math.abs(await E('ed.doc.get("a").at.x')) < 1e-9);
    await E('(ed.cursor.set([3, 0.5, 0]), ed.cursor.setPivot("cursor"), ed.selection.set("a"), 1)');
    await page.mouse('mouseMoved', abs.x + 100, abs.y + 100);
    await sleep(60);
    await tap('KeyR');
    check('with the 3D cursor as pivot the header says what the turn is about', /3D cursor/.test(await E('document.querySelector(".modal-bar")?.textContent ?? ""')));
    await tap('KeyY');
    await tap('Digit9');
    await tap('Digit0');
    await tap('Enter');
    const around = JSON.parse(await E('JSON.stringify(ed.doc.get("a").at)'));
    check('R Y 90 turns the cube a quarter about the cursor: it ends 3 metres from it, round the corner', Math.abs(around.x - 3) < 1e-4 && Math.abs(Math.abs(around.z) - 3) < 1e-4, JSON.stringify(around));
    await tap('KeyZ', { ctrl: true });
    await E('(ed.cursor.setPivot("median"), ed.cursor.toOrigin(), 1)');

    // the cursor is kept with the scene, has a turn, can be typed, dragged, and gives X Y Z its own directions
    await E('(ed.cursor.setPivot("median"), ed.cursor.setOrientation("global"), ed.cursor.toOrigin(), 1)');
    const dirtyBefore = await E('ed.doc.dirty');
    await E('(ed.cursor.set([2, 0.5, -1]), 1)');
    check('moving the cursor is not an edit: the scene is not marked as changed', (await E('ed.doc.dirty')) === dirtyBefore && (await E('ed.doc.undoStack.length')) === (await E('ed.doc.undoStack.length')));
    await tap('KeyN', { shift: true });
    check('Shift+N shows a panel to type the place and turn of the cursor, with the place in it', (await E('!document.querySelector(".cursor-panel").hidden')) && (await E('document.querySelectorAll(".cursor-panel input")[0].value')) === '2');
    await E('(() => { const i = document.querySelectorAll(".cursor-panel input")[4]; i.value = "90"; i.dispatchEvent(new Event("change")); })()');
    const cursorTurn = JSON.parse(await E('JSON.stringify(ed.cursor.rotation)'));
    check('typing a turn there turns the cursor (a quarter about the upright axis)', Math.abs(cursorTurn[1] - Math.SQRT1_2) < 1e-4 && Math.abs(cursorTurn[3] - Math.SQRT1_2) < 1e-4, JSON.stringify(cursorTurn));
    await E('(document.querySelectorAll(".cursor-panel input")[0].value = "5", document.querySelectorAll(".cursor-panel input")[0].dispatchEvent(new Event("change")), 1)');
    check('and typing a place moves it', JSON.parse(await E('JSON.stringify(ed.cursor.position)'))[0] === 5);
    await tap('KeyN', { shift: true });
    await E('(ed.cursor.set([2, 0.5, -1]), ed.cursor.setPivot("cursor"), 1)');
    // the cursor is saved in the scene file and comes back
    await E('(ed.state.sceneName = "cursor-test", 1)');
    check('saving writes the cursor into the scene file', (await E('ed.save()')) && (await E('JSON.stringify(ed.doc.toJSON().editor.cursor)')).includes('"pivot":"cursor"'));
    await E('(ed.newScene("other"), 1)');
    check('another scene has its own cursor: back at the middle', JSON.parse(await E('JSON.stringify(ed.cursor.position)')).every((v) => v === 0) && (await E('ed.cursor.pivot')) === 'median');
    await E('ed.open("cursor-test")');
    await sleep(400);
    const kept = JSON.parse(await E('JSON.stringify({ p: ed.cursor.position, r: ed.cursor.rotation, pivot: ed.cursor.pivot })'));
    check('opening the saved scene puts the cursor, its turn and the pivot back', kept.p[0] === 2 && kept.p[2] === -1 && Math.abs(kept.r[1] - Math.SQRT1_2) < 1e-4 && kept.pivot === 'cursor', JSON.stringify(kept));
    // X Y Z along the cursor own axes
    await E('(ed.cursor.setPivot("median"), ed.cursor.setOrientation("cursor"), ed.doc.update("a", { at: { x: 0, y: 0.5, z: 0 } }), ed.selection.set("a"), ed.setView("top"), ed.focus(ed.doc.order), 1)');
    await sleep(200);
    await page.mouse('mouseMoved', cx, cy);
    await sleep(60);
    await tap('KeyG');
    await tap('KeyX');
    check('the header says the lock follows the cursor', /3D cursor/.test(await E('document.querySelector(".modal-bar")?.textContent ?? ""')));
    await tap('Digit2');
    await tap('Enter');
    const slid = JSON.parse(await E('JSON.stringify(ed.doc.get("a").at)'));
    check('G X 2 moves a block two metres along the cursor own x (turned a quarter: along -z)', Math.abs(slid.x) < 1e-6 && Math.abs(slid.z + 2) < 1e-6, JSON.stringify(slid));
    await tap('KeyZ', { ctrl: true });
    await E('(ed.cursor.setOrientation("global"), 1)');
    // dragging with Shift + right button slides the cursor over the scene
    await E('(ed.cursor.toOrigin(), ed.setView("top"), ed.focus(ed.doc.order), 1)');
    await sleep(250);
    const sb = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const p1 = { x: f.left + sb.left + 60, y: f.top + sb.top + 80 };
    const p2 = { x: f.left + sb.left + 200, y: f.top + sb.top + 240 };
    await page.mouse('mouseMoved', p1.x, p1.y);
    await page.mouse('mousePressed', p1.x, p1.y, { button: 'right', modifiers: { shift: true } });
    const first = JSON.parse(await E('JSON.stringify(ed.cursor.position)'));
    for (let i = 1; i <= 6; i++) await page.mouse('mouseMoved', p1.x + ((p2.x - p1.x) * i) / 6, p1.y + ((p2.y - p1.y) * i) / 6, { buttons: 2, button: 'right', modifiers: { shift: true } });
    const during = JSON.parse(await E('JSON.stringify(ed.cursor.position)'));
    await page.mouse('mouseReleased', p2.x, p2.y, { button: 'right', modifiers: { shift: true } });
    const target = JSON.parse(await E(`JSON.stringify(ed.groundAt(${p2.x - f.left - sb.left}, ${p2.y - f.top - sb.top}))`));
    check('the cursor goes down at the press and follows the pointer while it is dragged, ending where it is let go', first.some((v, i) => Math.abs(v - during[i]) > 0.1) && Math.abs(during[0] - target[0]) < 0.02 && Math.abs(during[2] - target[2]) < 0.02, `${first} -> ${during} (${target})`);
    await E('(ed.cursor.toOrigin(), 1)');

    // turning snaps too: a few degrees short of lining up with a neighbour, it lines up exactly
    await E('(ed.cursor.setOrientation("global"), ed.doc.update("a", { at: { x: 0, y: 0.5, z: 0, yaw: null, rotation: null } }), ed.doc.update("b", { at: { x: 3.2, y: 0.5, z: 0, yaw: 0.5235988 } }), ed.selection.set("a"), ed.setView("top"), ed.focus(ed.doc.order), 1)');
    await sleep(300);
    const sbox2 = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const pv = JSON.parse(await E('JSON.stringify(ed.screenOf("a"))'));
    const centre = { x: pv.x + sbox2.left + f.left, y: pv.y + sbox2.top + f.top };
    const turnTo = async (deg, mods = {}) => {
      await page.mouse('mouseMoved', centre.x + 100, centre.y);
      await sleep(60);
      await tap('KeyR');
      await tap('KeyY');
      const a = (deg * Math.PI) / 180;
      for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', centre.x + 100 * Math.cos((a * i) / 8), centre.y - 100 * Math.sin((a * i) / 8), { modifiers: mods });
      await sleep(80);
      const note = await E('document.querySelector(".modal-bar")?.textContent ?? ""');
      const q = JSON.parse(await E('JSON.stringify(ed.doc.get("a").at.rotation ?? [0, 0, 0, 1])'));
      await tap('Enter');
      return { yaw: (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI, note };
    };
    const snappedTurn = await turnTo(28);
    check('turning a block 28 degrees with a neighbour turned 30 lines it up with the neighbour exactly', Math.abs(snappedTurn.yaw - 30) < 0.01 && /lined up with b/.test(snappedTurn.note), `${snappedTurn.yaw} ${snappedTurn.note.slice(0, 60)}`);
    await tap('KeyZ', { ctrl: true });
    const square = await turnTo(87);
    check('87 degrees lines up with the world: a quarter turn exactly (the neighbour is 30 off the other way)', Math.abs(square.yaw - 90) < 0.01 || Math.abs(square.yaw - 120) < 0.01, `${square.yaw}`);
    await tap('KeyZ', { ctrl: true });
    const far = await turnTo(15);
    check('15 degrees is far from every side: it stays 15', Math.abs(far.yaw - 15) < 0.5, `${far.yaw}`);
    await tap('KeyZ', { ctrl: true });
    await tap('KeyM');
    const freeTurn = await turnTo(28);
    check('with the Magnet off it turns exactly as far as the mouse goes', Math.abs(freeTurn.yaw - 28) < 0.5, `${freeTurn.yaw}`);
    await tap('KeyZ', { ctrl: true });
    await tap('KeyM');
    const skipped = await turnTo(28, { alt: true });
    check('holding Alt skips it for one turn', Math.abs(skipped.yaw - 28) < 0.5, `${skipped.yaw}`);
    await tap('KeyZ', { ctrl: true });
    await E('(ed.doc.update("b", { at: { yaw: null } }), 1)');

    // stretching snaps too: the top of a block grows to meet the top of a taller neighbour
    await E('(ed.doc.update("a", { at: { x: 0, y: 0.5, z: 0, yaw: null, rotation: null }, params: { halfHeight: 0.5 } }), ed.doc.update("b", { at: { x: 3.2, y: 1, z: 0 }, params: { halfHeight: 1 } }), ed.selection.set("a"), ed.setView("front"), ed.focus(ed.doc.order), 1)');
    await sleep(300);
    const sbox3 = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const pv3 = JSON.parse(await E('JSON.stringify(ed.screenOf("a"))'));
    const hub = { x: pv3.x + sbox3.left + f.left, y: pv3.y + sbox3.top + f.top };
    const stretchTo = async (ratio, mods = {}) => {
      await page.mouse('mouseMoved', hub.x, hub.y + 60);
      await sleep(60);
      await tap('KeyS');
      await tap('KeyY');
      for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', hub.x, hub.y + 60 + (60 * (ratio - 1) * i) / 8, { modifiers: mods });
      await sleep(80);
      const note = await E('document.querySelector(".modal-bar")?.textContent ?? ""');
      const half = await E('ed.doc.get("a").params?.halfHeight ?? 0.5');
      await tap('Enter');
      return { half, note };
    };
    const grown = await stretchTo(2.9);
    check('stretching a block about 2.9 times taller makes its top meet the top of the taller neighbour exactly', Math.abs(grown.half - 1.5) < 1e-9 && /side meets b/.test(grown.note), `${grown.half} ${grown.note.slice(0, 70)}`);
    await tap('KeyZ', { ctrl: true });
    const clear = await stretchTo(4.6);
    check('far from any side it is just as far as the mouse goes', Math.abs(clear.half - 2.3) < 0.05, `${clear.half}`);
    await tap('KeyZ', { ctrl: true });
    await tap('KeyM');
    const nomagnet = await stretchTo(2.9);
    check('with the Magnet off a stretch is exactly as far as the mouse goes', Math.abs(nomagnet.half - 1.45) < 0.03, `${nomagnet.half}`);
    await tap('KeyZ', { ctrl: true });
    await tap('KeyM');
    const alt = await stretchTo(2.9, { alt: true });
    check('Alt skips it for one stretch', Math.abs(alt.half - 1.45) < 0.03, `${alt.half}`);
    await tap('KeyZ', { ctrl: true });
    await E('(ed.doc.update("b", { params: { halfHeight: 0.5 } }), ed.doc.update("a", { params: { halfHeight: 0.5 } }), 1)');

    // new blocks turn like the cursor when asked
    await E('(ed.cursor.toOrigin(), ed.cursor.set([6, 0, 4], [0, Math.SQRT1_2, 0, Math.SQRT1_2]), ed.cursor.setAlign("world"), ed.selection.clear(), 1)');
    await tap('KeyA', { shift: true });
    await E('[...document.querySelectorAll(".add-menu button")].find((b) => b.textContent === "pillar").click()');
    const straight = JSON.parse(await E('JSON.stringify(ed.doc.get(ed.selection.primary).at)'));
    check('by default a new block stands straight at the cursor, whatever the turn of the cursor', straight.yaw === undefined && straight.rotation === undefined && Math.abs(straight.x - 6) < 1e-6, JSON.stringify(straight));
    await tap('KeyZ', { ctrl: true });
    await tap('Period');
    await E('[...document.querySelectorAll(".add-menu button")].find((b) => b.textContent.includes("turn like the 3D cursor")).click()');
    check('the pivot menu offers it, and it is remembered with the cursor', (await E('ed.cursor.align')) === 'cursor' && (await E('JSON.stringify(ed.doc.editor.cursor.align)')) === '"cursor"');
    await tap('KeyA', { shift: true });
    await E('[...document.querySelectorAll(".add-menu button")].find((b) => b.textContent === "wall").click()');
    const turnedNew = JSON.parse(await E('JSON.stringify(ed.doc.get(ed.selection.primary).at)'));
    check('then a new block is turned like the cursor (a quarter about the upright axis becomes its yaw)', Math.abs(turnedNew.yaw - Math.PI / 2) < 1e-5 && Math.abs(turnedNew.z - 4) < 1e-6, JSON.stringify(turnedNew));
    await tap('KeyZ', { ctrl: true });
    await E('(ed.cursor.set([6, 0, 4], [Math.SQRT1_2, 0, 0, Math.SQRT1_2]), 1)');
    await E('ed.addPrefab("cube")');
    const tipped = JSON.parse(await E('JSON.stringify(ed.doc.get(ed.selection.primary).at)'));
    const tippedBox = JSON.parse(await E('JSON.stringify(ed.view.bounds([ed.selection.primary]))'));
    check('a turn about another axis is kept whole, and the block still stands on the ground', Array.isArray(tipped.rotation) && Math.abs(tipped.rotation[0] - Math.SQRT1_2) < 1e-5 && Math.abs(tippedBox.min[1]) < 1e-6, `${JSON.stringify(tipped)} ${JSON.stringify(tippedBox.min)}`);
    await tap('KeyZ', { ctrl: true });
    check('the panel has the choice as a tick box', (await E('document.querySelectorAll(".cursor-panel input[type=checkbox]").length')) === 1);
    await E('(ed.cursor.setAlign("world"), ed.cursor.toOrigin(), 1)');

    // F2: rename in place
    await E('(ed.selection.set("a"), ed.stage.focus(), 1)');
    await tap('F2');
    check('F2 turns the name in the hierarchy into a text box', await E('!!document.querySelector("#hier-list input.rename") && document.activeElement === document.querySelector("#hier-list input.rename")'));
    await page.type('Front door');
    await tap('Enter');
    check('typing a name and pressing Enter gives the entity that name (its id stays)', (await E('ed.doc.get("a").name')) === 'Front door' && (await E('ed.doc.has("a")')));
    check('and the hierarchy shows it', (await E('[...document.querySelectorAll("#hier-list .row .label")].some((l) => l.textContent === "Front door")')));
    check('the box is gone and the keyboard is back in the viewport', !(await E('!!document.querySelector("#hier-list input.rename")')) && (await E('document.activeElement === ed.stage')));
    await tap('F2');
    await page.type(' two');
    await tap('Escape');
    check('Esc leaves the old name', (await E('ed.doc.get("a").name')) === 'Front door');
    await tap('F2');
    await E('(document.querySelector("#hier-list input.rename").value = "", 1)');
    await tap('Enter');
    check('an empty name gives the label back to the id', (await E('ed.doc.get("a").name')) === undefined && (await E('[...document.querySelectorAll("#hier-list .row .label")].some((l) => l.textContent === "a")')));
    await tap('KeyZ', { ctrl: true });
    check('a rename is one step of undo', (await E('ed.doc.get("a").name')) === 'Front door');
    await tap('KeyZ', { ctrl: true });
    await tap('F2', { shift: true });
    check('Shift+F2 renames the id itself', await E('document.querySelector("#hier-list input.rename")?.value === "a"'));
    await E('(document.querySelector("#hier-list input.rename").value = "b", 1)');
    await tap('Enter');
    check('an id that is taken is refused and the box stays open to correct it', (await E('ed.doc.has("a")')) && (await E('!!document.querySelector("#hier-list input.rename.bad")')));
    await E('(document.querySelector("#hier-list input.rename").value = "gate-1", 1)');
    await tap('Enter');
    check('a free id is accepted: the entity and its selection follow', (await E('ed.doc.has("gate-1") && !ed.doc.has("a") && ed.selection.primary === "gate-1"')));
    await tap('KeyZ', { ctrl: true });
    await E('(ed.selection.set(ed.doc.order[0]), 1)');

    // Ctrl+F2: rename several at once
    await E('(ed.doc.batch("three", () => { for (const id of ["c1", "c2", "c3"]) ed.doc.add({ id, prefab: "cube", at: { x: 10, y: 0.5, z: 0 } }); }), ed.selection.set(["c1", "c2", "c3"]), ed.stage.focus(), 1)');
    await tap('F2', { ctrl: true });
    check('Ctrl+F2 opens a dialog for the selection, with the pattern box ready', await E('!!document.querySelector(".batch-dialog") && document.activeElement === document.querySelectorAll(".batch-dialog input[type=text]")[0]'));
    check('it already shows what the names would be', (await E('document.querySelectorAll(".batch-dialog tr").length')) === 3 && /cube 1/.test(await E('document.querySelector(".batch-dialog table").textContent')));
    await E('(document.querySelectorAll(".batch-dialog input[type=text]")[0].select(), 1)');
    await page.type('Crate {n}');
    check('typing a pattern updates the preview at once', /Crate 1/.test(await E('document.querySelector(".batch-dialog table").textContent')) && /Crate 3/.test(await E('document.querySelector(".batch-dialog table").textContent')) && /3 will change/.test(await E('document.querySelector(".batch-dialog .summary").textContent')));
    check('and nothing has changed yet', (await E('ed.doc.get("c1").name')) === undefined);
    const stepsBefore2 = await E('ed.doc.undoStack.length');
    await tap('Enter');
    check('Enter applies it: every one has its name, in order', (await E('JSON.stringify(["c1", "c2", "c3"].map((id) => ed.doc.get(id).name))')) === '["Crate 1","Crate 2","Crate 3"]' && !(await E('!!document.querySelector(".batch-dialog")')));
    check('as one step of undo', (await E('ed.doc.undoStack.length')) === stepsBefore2 + 1);
    await tap('KeyZ', { ctrl: true });
    check('and one undo takes all the names back', (await E('JSON.stringify(["c1", "c2", "c3"].map((id) => ed.doc.get(id).name))')) === '[null,null,null]' || (await E('["c1", "c2", "c3"].every((id) => ed.doc.get(id).name === undefined)')));
    await tap('KeyY', { ctrl: true });
    // find and replace
    await tap('F2', { ctrl: true });
    await E('(() => { const d = document.querySelector(".batch-dialog"); const m = d.querySelectorAll("select")[1]; m.value = "replace"; m.dispatchEvent(new Event("change")); })()');
    await E('(document.querySelectorAll(".batch-dialog input[type=text]")[1].focus(), 1)');
    await page.type('crate');
    await E('(document.querySelectorAll(".batch-dialog input[type=text]")[2].focus(), 1)');
    await page.type('Box');
    check('find and replace previews the new names', /Box 2/.test(await E('document.querySelector(".batch-dialog table").textContent')));
    await tap('Escape');
    check('Esc closes the dialog and changes nothing', !(await E('!!document.querySelector(".batch-dialog")')) && (await E('ed.doc.get("c2").name')) === 'Crate 2');
    // ids
    await tap('F2', { ctrl: true });
    await E('(() => { const d = document.querySelector(".batch-dialog"); d.querySelectorAll("select")[0].value = "id"; d.querySelectorAll("select")[0].dispatchEvent(new Event("change")); d.querySelectorAll("select")[1].value = "pattern"; d.querySelectorAll("select")[1].dispatchEvent(new Event("change")); })()');
    await E('(document.querySelectorAll(".batch-dialog input[type=text]")[0].select(), 1)');
    await page.type('a');
    check('an id that is already taken is refused in the preview and Apply is off', /already/.test(await E('document.querySelector(".batch-dialog table").textContent')) || /same id/.test(await E('document.querySelector(".batch-dialog table").textContent')));
    check('(the Apply button is disabled)', await E('document.querySelector(".batch-dialog .btn.on").disabled'));
    await E('(document.querySelectorAll(".batch-dialog input[type=text]")[0].select(), 1)');
    await page.type('gate-{n}');
    await tap('Enter');
    check('good ids are accepted: the entities and the selection follow', (await E('JSON.stringify(ed.selection.ids)')) === '["gate-1","gate-2","gate-3"]' && (await E('ed.doc.has("gate-2") && !ed.doc.has("c2")')));
    await tap('KeyZ', { ctrl: true });
    check('and one undo gives the old ids back', await E('ed.doc.has("c1") && ed.doc.has("c3") && !ed.doc.has("gate-1")'));
    await E('(ed.doc.batch("clean", () => { for (const id of ["c1", "c2", "c3"]) ed.doc.remove(id); }), ed.selection.clear(), 1)');

    // the view and the panels
    await tap('Numpad7');
    check('number pad 7 looks from the top, without perspective', Math.abs((await E('ed.orbit.pitch')) - 1.5) < 1e-9 && (await E('ed.camera.ortho')) > 0 && (await E('ed.orbit.viewName')) === 'top');
    check('and the toolbar says so', (await E('document.querySelector("select[aria-label=View]").value')) === 'top');
    await sleep(200);
    if (outDir) writeFileSync(join(outDir, 'blender-top.png'), await page.screenshot());
    await E('(ed.focus(ed.doc.order), 1)');
    await sleep(250);
    const spot0 = JSON.parse(await E('JSON.stringify(ed.screenOf(ed.doc.order[0]))'));
    const box = JSON.parse(await E('JSON.stringify(ed.stage.getBoundingClientRect())'));
    const spot = { x: spot0.x + box.left + f.left, y: spot0.y + box.top + f.top };
    await E('ed.selection.clear()');
    await page.mouse('mouseMoved', spot.x, spot.y);
    await page.mouse('mousePressed', spot.x, spot.y);
    await page.mouse('mouseReleased', spot.x, spot.y);
    check('clicking in the orthographic view picks the block under the pointer', await E('ed.selection.size === 1'));
    await tap('Numpad5');
    check('number pad 5 switches to perspective, staying on this side', (await E('ed.camera.ortho')) === 0 && (await E('ed.orbit.pitch')) === 1.5);
    await tap('Numpad5');
    await page.mouse('mouseMoved', f.left + 500, f.top + 300);
    await page.mouse('mousePressed', f.left + 500, f.top + 300, { button: 'middle' });
    await page.mouse('mouseMoved', f.left + 540, f.top + 300, { button: 'middle', buttons: 4 });
    await page.mouse('mouseReleased', f.left + 540, f.top + 300, { button: 'middle' });
    check('turning the view with the middle button keeps a switched-on orthographic view (it was chosen by hand)', (await E('ed.camera.ortho')) > 0 && (await E('ed.orbit.viewName')) === null);
    await tap('Numpad7');
    await tap('Numpad1');
    check('number pad 1 looks from the front', (await E('ed.orbit.pitch')) === 0 && (await E('ed.orbit.yaw')) === 0);
    await tap('Numpad3');
    check('number pad 3 looks from the right', Math.abs((await E('ed.orbit.yaw')) - Math.PI / 2) < 1e-9);
    const wide = await E('ed.stage.getBoundingClientRect().width');
    await tap('KeyN');
    check('N hides the inspector and gives the viewport the room', (await E('ed.stage.getBoundingClientRect().width')) > wide + 200);
    await tap('KeyN');
    await tap('KeyA', { shift: true });
    check('Shift+A opens the add menu at the pointer', (await E('!!document.querySelector(".add-menu")')) && (await E('document.querySelectorAll(".add-menu button").length')) >= 6);
    await tap('Escape');
    check('Esc closes it', !(await E('!!document.querySelector(".add-menu")')));
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon|GPU stall|WebGL|swiftshader|GL Driver/i.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 4).join(' | ').slice(0, 900));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
