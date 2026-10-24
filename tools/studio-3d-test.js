// Live check, in a real Chrome with real keys, of Play in the 3D scene panel: a scene made of a floor, a wall, a start marker and two things to collect is walked
// around with the keyboard: someone stands on the floor where the start marker is, W walks, the wall stops them, Space jumps, a marker on the way is collected,
// the words on the screen say how many, and Esc stops and gives the editor back. Usage: node tools/studio-3d-test.js [outDir]
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

const SCENE = {
  format: 'engine-scene', version: 1, name: 'main', settings: {}, assets: [], prefabs: [],
  entities: [
    { id: 'floor', prefab: 'floor', at: { y: -0.1 } },
    { id: 'wall', prefab: 'wall', at: { y: 1.5, z: -2 } },
    { id: 'start', name: 'start', prefab: 'marker', at: { y: 0.3, z: 3 } },
    { id: 'coin1', prefab: 'marker', at: { y: 0.8, z: 0 } },
    { id: 'coin2', prefab: 'marker', at: { x: 3, y: 0.8, z: 1 } },
    { id: 'ball', prefab: 'ball', at: { x: -2.5, y: 0.5, z: 1 } },
  ],
};

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    const waitFor = (expr, ms = 10_000) => page.waitFor(expr, ms);
    const F = (expr) => page.eval(`(() => { const f = document.querySelector(".scene3d-frame"); const w = f && f.contentWindow; if (!w) return null; with (w) { return (${expr}); } })()`);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const press = async (code, ms = 0) => { await page.key(code, 'down'); if (ms) await sleep(ms); await page.key(code, 'up'); };

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Walk test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Walk test"', 10_000);
    await S(`(s.project.write("scenes/main.json", ${JSON.stringify(JSON.stringify(SCENE))}), s.setWorkspace("scene"), s.dock.show("scene3d"), 1)`);
    check('the 3D editor starts with the scene', await waitFor('!!document.querySelector(".scene3d-frame")?.contentWindow?.__editor && document.querySelector(".scene3d-frame").contentWindow.__editor.doc.size === 6', 25_000), (await F('window.__editor?.doc?.size')) + '');
    check('the Play button is there', await F('[...document.querySelectorAll("button")].some((b) => /Play/.test(b.textContent))'));
    await F('window.__editor.togglePlay()');
    check('Play starts a walk: the person is made and the banner says so', await waitFor('!!document.querySelector(".scene3d-frame").contentWindow.__play', 6000) && await F('document.querySelector(".banner")?.style.display !== "none"'));
    await sleep(1200);
    const where = async () => JSON.parse(await F('JSON.stringify({ x: __play.play.player.x, y: __play.play.player.y, z: __play.play.player.z, feet: __play.play.player.feetY, ground: __play.play.player.grounded, n: __play.play.count, total: __play.play.total })'));
    let p = await where();
    check('they stand on the floor where the start marker is', Math.abs(p.z - 3) < 0.1 && Math.abs(p.feet) < 0.1 && p.ground, JSON.stringify(p));
    check('the words on the screen say what to do and what there is to collect', await F('document.querySelector(".play-hud")?.textContent.includes("Collected 0 of 2")'));
    // click in the scene so the keys go to it, then walk
    const box = JSON.parse(await page.eval('JSON.stringify(document.querySelector(".scene3d-frame").getBoundingClientRect())'));
    await page.mouse('mouseMoved', box.left + box.width / 2, box.top + box.height / 2);
    await page.mouse('mousePressed', box.left + box.width / 2, box.top + box.height / 2);
    await page.mouse('mouseReleased', box.left + box.width / 2, box.top + box.height / 2);
    await press('KeyW', 1100);
    p = await where();
    check('W walks the way they face, and the marker on the way is picked up', p.z < 1.5 && p.n === 1, JSON.stringify(p));
    check('and the words say so', await F('document.querySelector(".play-hud")?.textContent.includes("Collected 1 of 2")'));
    await press('KeyW', 2500);
    p = await where();
    check('the wall stops them', p.z > -1.75 && p.z < -1.35, `z = ${p.z}`);
    const y0 = p.y;
    await page.key('Space', 'down'); await sleep(260);
    const jumping = await where();
    await page.key('Space', 'up');
    check('Space jumps', jumping.y > y0 + 0.4 && !jumping.ground, `y ${y0.toFixed(2)} -> ${jumping.y.toFixed(2)}`);
    await sleep(1200);
    check('and they come down again', (await where()).ground);
    check('the view is theirs: the camera is at their eyes, not the editor\'s', await F('(() => { const e = __play.play.eye; return e.y > 1 && e.y < 2.5; })()'));
    if (outDir) writeFileSync(join(outDir, '3d-play.png'), await page.screenshot());
    // the mouse and keys of the editor stay out of the way: W did not change the tool
    check('the editor\'s own keys stay out of the way while playing', (await F('window.__editor.state?.tool ?? "translate"')) === 'translate');
    await press('Escape');
    check('Esc stops it: the banner goes, the person and the words are gone', await waitFor('!document.querySelector(".scene3d-frame").contentWindow.__play && document.querySelector(".scene3d-frame").contentDocument.querySelector(".banner")?.style.display === "none" && !document.querySelector(".scene3d-frame").contentDocument.querySelector(".play-hud")', 4000));
    check('and the scene is back to editing, unchanged', (await F('window.__editor.doc.size')) === 6);
    await F('window.__editor.togglePlay()');
    check('it can be played again', await waitFor('!!document.querySelector(".scene3d-frame").contentWindow.__play', 4000));
    const errs = page.errors.filter((e) => !/willReadFrequently|favicon|GPU stall|WebGL|swiftshader|GL Driver/i.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
