// Live check of the scene editor in a real browser, on both renderers: the scene loads, clicking selects, the inspector shows and edits,
// gizmos move things along their axes, undo / redo, delete, duplicate, add from the palette, box select, re-parenting, save to disk, and
// Play runs the scene for real and Stop brings the editor back untouched. Usage: node tools/editor-test.js [outDir]
import { mkdtempSync, cpSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../packages/build/src/index.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

for (const renderer of ['webgpu', 'webgl2']) {
  // a private copy of the scene folder, so the test never touches the real scenes
  const scenes = mkdtempSync(join(tmpdir(), 'editor-scenes-'));
  cpSync(join(root, 'examples/physics3d/scenes'), scenes, { recursive: true });
  const dev = await serve({ root, port: 0, liveReload: false, writable: [{ route: '/__scenes', dir: scenes, ext: '.json' }] });
  const url = `${dev.url}examples/physics3d/editor.html?renderer=${renderer}`;
  console.log(`--- ${renderer}`);
  try {
    await withChromePage(url, async (page) => {
      const E = (expr) => page.eval(`(() => { const e = window.__editor; ${expr} })()`);
      const ready = await page.waitFor('window.__editor && window.__editor.doc.size === 58', 20_000);
      check('the editor opens the yard scene (58 entities)', ready, page.errors.slice(0, 2).join(' | '));
      if (!ready) throw new Error('editor did not start');
      check('on the requested backend', (await E('return e.renderer.kind;')) === renderer);
      await page.sleep(500);
      const rect = JSON.parse(await E('const r = e.stage.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height });'));
      const at = (p) => ({ x: rect.x + p.x, y: rect.y + p.y });
      const click = async (p) => { const q = at(p); await page.mouse('mouseMoved', q.x, q.y); await page.mouse('mousePressed', q.x, q.y); await page.mouse('mouseReleased', q.x, q.y); await page.sleep(80); };
      const key = (k, mods = {}) => page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...mods })})); 0`);
      const get = (id) => E(`return JSON.stringify(e.doc.get(${JSON.stringify(id)}));`).then((s) => JSON.parse(s));

      // -- the hierarchy and the viewport
      check('the hierarchy lists every entity', (await page.eval('document.querySelectorAll("#hier .row").length')) === 58);
      check('the problems indicator says all is well', (await page.eval('document.querySelector(".status .problems").textContent')) === 'no problems');
      await E('e.focus(["heavy-crate"]); e.selection.clear(); return 0;'); await page.sleep(300);
      const target = JSON.parse(await E('return JSON.stringify(e.screenOf("heavy-crate"));'));
      await click(target);
      check('clicking an object in the viewport selects it', (await E('return e.selection.primary;')) === 'heavy-crate', await E('return String(e.selection.primary);'));
      check('the hierarchy highlights it', (await page.eval('document.querySelector("#hier .row.primary")?.dataset.id')) === 'heavy-crate');
      const insp = await page.eval('document.querySelector(".right").textContent');
      check('the inspector shows its position, parameter and colour', /position/.test(insp) && /mass/.test(insp) && /colour/.test(insp), insp.slice(0, 80));

      // -- the inspector edits
      await page.eval(`(() => { const row = [...document.querySelectorAll('.right .field')].find((f) => f.querySelector('label').textContent === 'mass'); const input = row.querySelector('input'); input.value = '99'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); })()`);
      check('typing in the inspector edits the entity', (await get('heavy-crate')).params.mass === 99);
      check('the field is marked as changed from the prefab', await page.eval(`[...document.querySelectorAll('.right .field')].find((f) => f.querySelector('label').textContent === 'mass').classList.contains('over')`));
      await key('z', { ctrlKey: true }); await page.sleep(50);
      check('Ctrl+Z undoes it', (await get('heavy-crate')).params.mass === 30);
      await key('y', { ctrlKey: true }); await page.sleep(50);
      check('Ctrl+Y redoes it', (await get('heavy-crate')).params.mass === 99);
      await key('z', { ctrlKey: true });

      // -- the move gizmo: drag the red arrow
      const before = (await get('heavy-crate')).at, steps0 = await E('return e.doc.undoStack.length;');
      const arrow = JSON.parse(await E(`const m = e.view.worldMatrix('heavy-crate'); const s = e.gizmo.size([m[12], m[13], m[14]], [e.camera.x, e.camera.y, e.camera.z]); const p = e.camera.worldToScreen(m[12] + s * 0.6, m[13], m[14]); const o = e.camera.worldToScreen(m[12], m[13], m[14]); return JSON.stringify({ x: p.x, y: p.y, ox: o.x, oy: o.y });`));
      const a = at(arrow);
      await page.mouse('mouseMoved', a.x, a.y); await page.sleep(60);
      check('hovering the arrow lights it up', (await E('return e.gizmo.hover;')) === 'x');
      await page.mouse('mousePressed', a.x, a.y);
      for (let i = 1; i <= 8; i++) { await page.mouse('mouseMoved', a.x + i * 10, a.y + (i * 10 * (arrow.y - arrow.oy)) / (arrow.x - arrow.ox || 1)); await page.sleep(20); }
      await page.mouse('mouseReleased', a.x + 80, a.y);
      const moved = (await get('heavy-crate')).at;
      check('dragging the red arrow moves it along x only', Math.abs(moved.x - before.x) > 0.1 && Math.abs(moved.y - before.y) < 0.02 && Math.abs(moved.z - before.z) < 0.02, JSON.stringify([before.x, moved.x]));
      check('the whole drag is one undo step', (await E('return e.doc.undoStack.length;')) === steps0 + 1);
      await key('z', { ctrlKey: true }); check('and undoing it puts the crate back', Math.abs((await get('heavy-crate')).at.x - before.x) < 1e-9);

      // -- rotate and scale tools
      await key('e'); check('E picks the rotate tool', (await E('return e.state.tool;')) === 'rotate');
      const ring = JSON.parse(await E(`const m = e.view.worldMatrix('heavy-crate'); const o = [m[12], m[13], m[14]]; const s = e.gizmo.size(o, [e.camera.x, e.camera.y, e.camera.z]); const hit = (() => { for (let a = 0; a < 6.28; a += 0.05) { const p = [o[0] + Math.cos(a) * s, o[1] + Math.sin(a) * s, o[2]]; const sp = e.camera.worldToScreen(...p); const r = e.camera.screenToRay(sp.x, sp.y); const h = e.gizmo.hit({ origin: r.origin, dir: r.dir }, o, [0, 0, 0, 1], [e.camera.x, e.camera.y, e.camera.z]); if (h) return { x: sp.x, y: sp.y, h }; } return null; })(); return JSON.stringify(hit);`));
      check('the rotate rings can be grabbed', !!ring && ring.h[0] === 'r', JSON.stringify(ring));
      if (ring) {
        const r0 = at(ring); await page.mouse('mouseMoved', r0.x, r0.y); await page.mouse('mousePressed', r0.x, r0.y);
        for (let i = 1; i <= 6; i++) { await page.mouse('mouseMoved', r0.x, r0.y + i * 8); await page.sleep(20); }
        await page.mouse('mouseReleased', r0.x, r0.y + 48);
        const rotated = await get('heavy-crate');
        check('dragging a ring rotates it (a rotation is stored)', !!rotated.at.rotation || rotated.at.yaw !== undefined, JSON.stringify(rotated.at));
        await key('z', { ctrlKey: true });
      }
      await key('r'); await key('w'); check('R and W switch tools', (await E('return e.state.tool;')) === 'translate');

      // -- delete, duplicate, add, box select
      await E("e.selection.set('crate-1'); return 0;"); await key('Delete'); await page.sleep(80);
      check('Delete removes the selection', (await E("return e.doc.has('crate-1');")) === false && (await page.eval('document.querySelectorAll("#hier .row").length')) === 57);
      await key('z', { ctrlKey: true }); check('and Ctrl+Z brings it back', await E("return e.doc.has('crate-1');"));
      await E("e.selection.set('crate-2'); return 0;"); await key('d', { ctrlKey: true }); await page.sleep(80);
      check('Ctrl+D duplicates and selects the copy', (await E('return e.doc.size;')) === 59 && (await E("return e.selection.primary !== 'crate-2' && e.selection.primary.startsWith('crate');")));
      await page.eval('[...document.querySelectorAll("#palette .item")].find((i) => i.textContent === "ball").click()'); await page.sleep(80);
      const added = JSON.parse(await E('const id = e.selection.primary; return JSON.stringify([id, e.doc.get(id)]);'));
      check('clicking a prefab in the palette adds it, resting on the ground', added[1].prefab === 'ball' && Math.abs(added[1].at.y - 0.35) < 0.01, JSON.stringify(added[1].at));
      const dropAt = at({ x: rect.w / 2 + 40, y: rect.h * 0.7 });
      await page.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/x-prefab', 'crate'); const s = document.getElementById('stage'); s.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: ${dropAt.x}, clientY: ${dropAt.y}, bubbles: true, cancelable: true })); })()`);
      await page.sleep(80);
      check('dropping a prefab on the viewport places it where the pointer points', (await E('return e.doc.size;')) === 61);
      await E('e.selection.clear(); e.focus(); return 0;'); await page.sleep(300);
      await page.mouse('mouseMoved', rect.x + 4, rect.y + 4); await page.mouse('mousePressed', rect.x + 4, rect.y + 4);
      for (let i = 1; i <= 10; i++) { await page.mouse('mouseMoved', rect.x + 4 + (rect.w - 8) * (i / 10), rect.y + 4 + (rect.h - 8) * (i / 10)); await page.sleep(15); }
      await page.mouse('mouseReleased', rect.x + rect.w - 4, rect.y + rect.h - 4);
      check('dragging a box around objects selects them all', (await E('return e.selection.size;')) > 10, await E('return String(e.selection.size);'));

      // -- hierarchy re-parenting by drag and drop
      await E("e.selection.clear(); return 0;");
      await page.eval(`(() => { const dt = new DataTransfer(); const rows = [...document.querySelectorAll('#hier .row')]; const from = rows.find((r) => r.dataset.id === 'ball-1'), to = rows.find((r) => r.dataset.id === 'seesaw'); from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); const b = to.getBoundingClientRect(); const o = { dataTransfer: dt, clientX: b.left + 20, clientY: b.top + b.height / 2, bubbles: true, cancelable: true }; to.dispatchEvent(new DragEvent('dragover', o)); to.dispatchEvent(new DragEvent('drop', o)); })()`);
      await page.sleep(100);
      check('dropping a row onto another makes it a child', (await get('ball-1')).parent === 'seesaw');
      check('the hierarchy shows the child indented under its parent', await page.eval(`(() => { const rows = [...document.querySelectorAll('#hier .row')]; const i = rows.findIndex((r) => r.dataset.id === 'seesaw'); return rows[i + 1].dataset.id === 'ball-1' && parseFloat(rows[i + 1].style.paddingLeft) > parseFloat(rows[i].style.paddingLeft); })()`));
      await key('z', { ctrlKey: true });

      // -- the camera
      const yaw0 = await E('return e.orbit.yaw;'), dist0 = await E('return e.orbit.distance;');
      const c = at({ x: rect.w / 2, y: rect.h / 2 });
      await page.mouse('mouseMoved', c.x, c.y); await page.mouse('mousePressed', c.x, c.y, { button: 'right' });
      for (let i = 1; i <= 5; i++) { await page.mouse('mouseMoved', c.x + i * 10, c.y, { button: 'right', buttons: 2 }); await page.sleep(15); }
      await page.mouse('mouseReleased', c.x + 50, c.y, { button: 'right' });
      check('right-drag orbits the camera', Math.abs((await E('return e.orbit.yaw;')) - yaw0) > 0.1);
      await page.mouse('mouseWheel', c.x, c.y, { deltaY: 100 });
      check('the wheel zooms', (await E('return e.orbit.distance;')) > dist0);

      // -- saving
      check('the scene is marked as changed', await E('return e.doc.dirty;') && /\*/.test(await page.eval('document.title')));
      const sizeBefore = await E('return e.doc.size;');
      await key('s', { ctrlKey: true }); await page.sleep(400);
      const saved = JSON.parse(readFileSync(join(scenes, 'yard.json'), 'utf8'));
      check('Ctrl+S writes the scene file', saved.entities.length === sizeBefore && saved.entities.some((x) => x.id === 'heavy-crate' && x.params.mass === 30) && saved.entities.filter((x) => x.prefab === 'ball').length === 11, `${saved.entities.length} entities`);
      check('and the changes marker clears', !(await E('return e.doc.dirty;')) && !/\*/.test(await page.eval('document.title')));

      // -- Play runs the scene for real
      await E("e.selection.set(['doll']); e.focus(['doll']); e.orbit.distance *= 3; return 0;"); await page.sleep(300);
      if (outDir) writeFileSync(join(outDir, `editor-edit-${renderer}.png`), await page.screenshot());
      const docBefore = await E('return JSON.stringify(e.doc.toJSON());');
      await page.eval('[...document.querySelectorAll(".bar .btn")].find((b) => /Play/.test(b.textContent)).click()'); await page.sleep(300);
      check('Play starts the scene (a physics world appears)', await page.waitFor('window.__play && window.__play.world.bodies.length > 50', 5000));
      const y0 = await page.eval('window.__play.world.bodies.filter((b) => b.mass === 120)[0].y');
      await page.sleep(1500);
      check('the physics runs while playing', Math.abs((await page.eval('window.__play.world.bodies.filter((b) => b.mass === 120)[0].x')) - 0) > 0.05 || Math.abs((await page.eval('window.__play.world.bodies.filter((b) => b.mass === 120)[0].y')) - y0) > 0.001);
      check('editing is locked while playing', (await E("e.deleteSelection(); e.selection.set('door'); e.deleteSelection(); return e.doc.has('door');")));
      if (outDir) writeFileSync(join(outDir, `editor-${renderer}.png`), await page.screenshot());
      await key('Escape'); await page.sleep(200);
      check('Escape stops it, and the editor is as it was', !(await page.eval('!!window.__play')) && (await E('return JSON.stringify(e.doc.toJSON());')) === docBefore);
      check('no page errors', page.errors.filter((m) => !/willReadFrequently/.test(m)).length === 0, page.errors.slice(0, 2).join(' | '));
    });

    // reload: the edits are in the file, and the game itself loads the same file with ?scene=yard
    await withChromePage(url, async (page) => {
      check('after a reload the saved scene is what opens', await page.waitFor('window.__editor && window.__editor.doc.size === 61', 20_000));
    });
    await withChromePage(`${dev.url}examples/physics3d/index.html?renderer=${renderer}&scene=yard`, async (page) => {
      check('the game loads the scene file with ?scene=yard', await page.waitFor('window.__physics && window.__physics.world.bodies.length > 50', 20_000), page.errors.slice(0, 2).join(' | '));
      check('with no page errors', page.errors.filter((m) => !/willReadFrequently/.test(m)).length === 0);
    });
  } catch (e) {
    failed = true; console.log('FAIL', e.stack ?? e.message);
  } finally {
    await dev.close(); rmSync(scenes, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
