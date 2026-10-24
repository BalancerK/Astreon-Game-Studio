// Live check, in a real Chrome with real mouse and keyboard events, of the art and music tools: importing an SVG (and refusing an unsafe one), slicing a sprite
// sheet into a sprite and drawing a sheet in an exported game, placing things in the Scene panel (click, drag, resize, keys, undo) and loading the scene in the
// running game, and making a song in the Music panel and playing it from the game. Usage: node tools/studio-art-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { createStaticServer } from './static-server.js';
import { readZip } from '../studio/app/store/zip.js';
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
    const waitFor = (expr, ms = 8000) => page.waitFor(expr, ms);
    const press = async (code, modifiers) => { await page.key(code, 'down', modifiers); await page.key(code, 'up', modifiers); };
    const shot = async (name) => { if (outDir) writeFileSync(join(outDir, `art-${name}.png`), await page.screenshot()); };
    const clickButton = (scope, text) => page.eval(`[...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
    const mouseAt = async (type, x, y) => page.mouse(type, x, y);
    const errorsNow = () => page.errors.filter((e) => !/willReadFrequently|favicon/.test(e));

    check('the studio opens', await waitFor('!!window.studio && !!document.getElementById("dock")', 20_000));
    await S('(s.createProject({ name: "Art test", template: "blank" }), 1)');
    await waitFor('window.studio.project?.name === "Art test"', 10_000);

    // ---------- SVG ----------
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#4ade80"/><circle cx="10" cy="10" r="6" fill="#e84a5f"/></svg>';
    await page.eval(`(async () => { const m = await import('/studio/app/core/import-assets.js'); window.__imp = m.importAssets(window.studio, [new File([${JSON.stringify(SVG)}], 'My Frog.svg', { type: 'image/svg+xml' })]); })()`);
    check('importing an SVG asks how big the picture should be', await waitFor('!!document.querySelector(".dialog img.asset-preview") && document.querySelector(".dialog").textContent.includes("160 × 80")', 5000), await page.eval('document.querySelector(".dialog")?.textContent.slice(0, 160)'));
    check('a small drawing starts at four times its size, so it stays sharp', await page.eval('document.querySelector(".dialog select").value === "4"'));
    await page.eval('(() => { const s = document.querySelector(".dialog select"); s.value = "1"; s.dispatchEvent(new Event("change")); })()');
    check('and the size can be changed, with the result said in numbers', await page.eval('document.querySelector(".dialog").textContent.includes("40 × 20")'));
    await page.eval('(() => { const s = document.querySelector(".dialog select"); s.value = "4"; s.dispatchEvent(new Event("change")); })()');
    await clickButton('.dialog .btn', 'Make the picture');
    check('a PNG of that size is made in assets', await waitFor('window.studio.project.has("assets/My Frog.png")', 5000));
    const dims = JSON.parse(await page.eval('(async () => { const b = window.studio.project.read("assets/My Frog.png"); const bmp = await createImageBitmap(new Blob([b], { type: "image/png" })); return JSON.stringify({ w: bmp.width, h: bmp.height, sig: Array.from(b.slice(1, 4)).join() }); })()'));
    check('it really is a 160 × 80 PNG', dims.w === 160 && dims.h === 80 && dims.sig === '80,78,71', JSON.stringify(dims));
    check('and the drawing is kept as text in art/', (await S('s.project.readText("art/My Frog.svg")')) === SVG);
    await page.eval('window.__imp');
    await S('(s.openFile("art/My Frog.svg"), s.commands.execute("file.svg-picture"), 1)');
    check('"Make a picture from this SVG" works on the kept drawing too', await waitFor('!!document.querySelector(".dialog img.asset-preview")', 4000));
    await clickButton('.dialog .btn', 'Cancel');
    const before = await S('s.project.list().length');
    await page.eval(`(async () => { const m = await import('/studio/app/core/import-assets.js'); await m.importAssets(window.studio, [new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'evil.svg')]); })()`);
    check('an SVG with a script in it is refused, and nothing is added', await waitFor('[...document.querySelectorAll(".toast")].some((t) => t.textContent.includes("script"))', 4000) && (await S('s.project.list().length')) === before);
    await shot('svg');

    // ---------- sprite sheet ----------
    await page.eval(`(async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d');
      for (let f = 0; f < 8; f++) { if (f === 3) continue; g.fillStyle = 'rgb(' + (30 * f + 20) + ',' + (200 - 20 * f) + ',90)'; g.fillRect((f % 4) * 16 + 1, Math.floor(f / 4) * 16 + 1, 14, 14); }
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      window.studio.project.write('assets/sheet.png', new Uint8Array(await blob.arrayBuffer()));
      window.studio.emit('files');
    })()`);
    await S('(s.openFile("assets/sheet.png"), s.commands.execute("art.slice"), 1)');
    check('"Slice a sprite sheet" opens with the picture and a guess at the cell', await waitFor('!!document.querySelector(".slice-dialog .slice-canvas") && document.querySelector(".slice-dialog [role=status]")?.textContent.includes("64 × 32")', 6000));
    await page.eval(`(() => { const d = document.querySelector('.slice-dialog'); const n = [...d.querySelectorAll('input[type=number]')]; for (const i of n.slice(0, 2)) { i.value = '16'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    check('the grid says how many frames, and that one is empty', await waitFor('document.querySelector(".slice-dialog [role=status]").textContent.includes("4 across and 2 down is 8 frames, 1 of them empty")', 4000), await page.eval('document.querySelector(".slice-dialog [role=status]")?.textContent'));
    await shot('slice');
    await page.eval(`(() => { const d = document.querySelector('.slice-dialog'); const t = d.querySelector('input[type=text]'); t.value = 'walker'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await clickButton('.dialog .btn', 'Make a sprite from the cells');
    check('a sprite file is made from the cells', await waitFor('window.studio.project.has("src/art/walker.js")', 5000));
    const sprite = JSON.parse(await page.eval(`(async () => { const m = await import('/studio/app/paint/sprite-model.js'); return JSON.stringify(m.parseSprite(window.studio.project.readText('src/art/walker.js'))); })()`));
    check('with 7 frames of 16 × 16 (the empty one left out), a palette, and an animation for each row', sprite.frames.length === 7 && sprite.w === 16 && sprite.h === 16 && Object.keys(sprite.palette).length === 7 && Object.keys(sprite.animations).join() === 'row1,row2', JSON.stringify({ f: sprite.frames.length, p: Object.keys(sprite.palette).length, a: Object.keys(sprite.animations) }));
    check('and the Sprites panel shows it', await waitFor('!!document.querySelector("[data-panel=sprites]") && document.querySelector("[data-panel=sprites] .art-select")?.textContent.includes("walker")', 4000));

    // a sheet kept as a picture is drawn by an exported game, from the right cell
    const GAME = [
      "import { clear, drawImage } from '@engine/arcade';",
      'export function create() { return {}; }', 'export function update() {}',
      "export function render(game, g) { clear(g); drawImage(g, 'assets/sheet.png', 0, 0, 32, 32, { cols: 4, rows: 2, frame: 5 }); }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(GAME)}), s.project.write("src/music.js", "export default {};"), 1)`);
    const zipB64 = await page.eval(`(async () => { const built = await window.studio.ship.build({ offline: false }); const { writeZip } = await import('/studio/app/store/zip.js'); const buf = writeZip(built.files); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s); })()`);
    const exported = await readZip(Uint8Array.from(Buffer.from(zipB64, 'base64')));
    check('the export carries the sheet picture and the music code', exported.has('game/assets/sheet.png') && exported.has('engine/arcade/src/music.js'));
    const served = new Map([...exported].map(([k, v]) => [`/${k}`, v]));
    const types = { html: 'text/html', js: 'text/javascript', png: 'image/png', svg: 'image/svg+xml' };
    const exportServer = http.createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname);
      const body = served.get(path);
      if (!body) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': `${types[path.split('.').pop()] ?? 'text/plain'}; charset=utf-8` }).end(body);
    });
    await new Promise((r) => exportServer.listen(0, '127.0.0.1', r));
    try {
      await withChromePage(`http://localhost:${exportServer.address().port}/`, async (game) => {
        await game.waitFor('document.getElementById("start") && !document.getElementById("start").hidden', 15_000);
        const px = JSON.parse(await game.eval('JSON.stringify(Array.from(document.getElementById("game").getContext("2d").getImageData(16, 16, 1, 1).data))'));
        check('the exported game draws cell 5 of the sheet (row 2, column 2)', px[0] === 30 * 5 + 20 && px[1] === 200 - 20 * 5 && px[2] === 90, px.join(','));
        check('and has no errors', game.errors.filter((e) => !/favicon|willReadFrequently/.test(e)).length === 0, game.errors.join(' | '));
      });
    } finally { exportServer.close(); }

    // ---------- the Scene panel ----------
    await S('(s.project.write("src/main.js", "export function create() { return {}; }\\nexport function update() {}\\nexport function render() {}\\n"), s.project.remove("src/music.js"), s.commands.execute("workspace.art"), s.dock.show("scene2d"), 1)');
    check('the Scene panel starts with an invitation', await waitFor('document.querySelector(".scene-stage").hidden && [...document.querySelectorAll(".empty .btn")].some((b) => b.textContent.includes("first scene"))', 4000));
    await clickButton('.empty .btn', 'Make my first scene');
    check('making a scene asks for a name', await waitFor('!!document.querySelector(".dialog input[type=text]")', 3000));
    await clickButton('.dialog .btn', 'Make it');
    check('and writes scenes/level1.js at the size of the game screen', await waitFor('window.studio.project.has("scenes/level1.js") && !!document.querySelector(".scene-canvas")', 4000) && (await S('s.project.readText("scenes/level1.js")')).includes('"w": 480'));
    const view = async () => JSON.parse(await page.eval('(() => { const c = document.querySelector(".scene-canvas"); const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, z: r.width / 480 }); })()'));
    const toScreen = async (sx, sy) => { const v = await view(); return { x: v.x + sx * v.z, y: v.y + sy * v.z, z: v.z }; };
    const sceneThings = async () => JSON.parse(await S('JSON.stringify(window.__scene = (() => { const t = s.project.readText("scenes/level1.js"); return JSON.parse(t.slice(t.indexOf("export default") + 14).replace(/;\\s*$/, "")).things; })())'));
    await clickButton('.scene-kinds .btn', 'coin');
    check('choosing a kind to place presses its button', await page.eval('[...document.querySelectorAll(".scene-kinds .btn")].find((b) => b.textContent === "coin").getAttribute("aria-pressed") === "true"'));
    let p = await toScreen(100, 100);
    await mouseAt('mouseMoved', p.x, p.y); await mouseAt('mousePressed', p.x, p.y); await mouseAt('mouseReleased', p.x, p.y);
    let things = await sceneThings();
    check('clicking in the scene places a thing on the grid, and it is selected', things.length === 1 && things[0].kind === 'coin' && things[0].x === 96 && things[0].y === 96 && await page.eval('document.querySelectorAll(".scene-item.on").length === 1'), JSON.stringify(things));
    // drag it by 48, 32
    p = await toScreen(96 + 16, 96 + 16);
    const q = await toScreen(96 + 16 + 48, 96 + 16 + 32);
    await mouseAt('mouseMoved', p.x, p.y); await mouseAt('mousePressed', p.x, p.y); await mouseAt('mouseMoved', (p.x + q.x) / 2, (p.y + q.y) / 2); await mouseAt('mouseMoved', q.x, q.y); await mouseAt('mouseReleased', q.x, q.y);
    things = await sceneThings();
    check('dragging moves it, onto the grid', things[0].x === 144 && things[0].y === 128, JSON.stringify(things[0]));
    // resize with the south-east handle: it is at (144 + 32, 128 + 32)
    const h1 = await toScreen(176, 160);
    const h2 = await toScreen(192, 176);
    await mouseAt('mouseMoved', h1.x, h1.y); await mouseAt('mousePressed', h1.x, h1.y); await mouseAt('mouseMoved', h2.x, h2.y); await mouseAt('mouseReleased', h2.x, h2.y);
    things = await sceneThings();
    check('dragging a corner handle resizes it', things[0].w === 48 && things[0].h === 48 && things[0].x === 144, JSON.stringify(things[0]));
    await page.eval('document.querySelector(".scene-canvas").focus()');
    await press('ArrowRight');
    check('the arrow keys nudge the selected thing by the grid', (await sceneThings())[0].x === 160);
    await press('KeyD', { ctrl: true });
    check('Ctrl+D copies it', (await sceneThings()).length === 2);
    await press('Delete');
    check('Delete removes the selected thing', (await sceneThings()).length === 1);
    await press('KeyZ', { ctrl: true });
    check('Ctrl+Z brings it back', (await sceneThings()).length === 2);
    // properties
    await page.eval('[...document.querySelectorAll(".scene-item")].at(-1).click()');
    check('the list on the right selects a thing', await page.eval('document.querySelectorAll(".scene-item.on").length === 1 && !!document.querySelector(".scene-props [aria-label=Kind]")'));
    await page.eval(`(() => { const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }; const f = (l) => document.querySelector('.scene-props [aria-label="' + l + '"]'); set(f('Kind'), 'gem'); set(f('Colour'), '#e84a5f'); })()`);
    things = await sceneThings();
    check('the properties form changes the selected thing', things[1].kind === 'gem' && things[1].color === '#e84a5f', JSON.stringify(things[1]));
    await page.eval(`(() => { const t = document.querySelector('.scene-props [aria-label="Extra fields as JSON"]'); t.value = '{"value": 5}'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    check('extra fields are kept as JSON', (await sceneThings())[1].extra?.value === 5);
    await page.eval(`(() => { const t = document.querySelector('.scene-props [aria-label="Extra fields as JSON"]'); t.value = '{nope'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    check('and a mistake in them is explained, not saved', await page.eval('document.querySelector(".scene-props .error").textContent.includes("JSON")') && (await sceneThings())[1].extra?.value === 5);
    await shot('scene');
    // the game loads it
    const sceneGame = [
      "import { newGame, loadScene, all, clear, drawThings } from '@engine/arcade';", "import level1 from '../scenes/level1.js';",
      'export function create() { const game = newGame(); loadScene(game, level1); return game; }', 'export function update() {}',
      'export function render(game, g) { clear(g); drawThings(g, game); }',
      "export function summary(game) { return { coins: all(game, 'coin').length, gems: all(game, 'gem').length, value: all(game, 'gem')[0]?.value }; }", '',
    ].join('\n');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(sceneGame)}), 1)`);
    await clickButton('.scene-stage ~ *, .art-bar .btn', 'Run again');
    check('the running game has the things that were placed (a coin and a gem with its extra field)', await waitFor('window.studio.runner.summary?.coins === 1 && window.studio.runner.summary?.gems === 1 && window.studio.runner.summary?.value === 5', 10_000), JSON.stringify(await S('s.runner.summary')));
    check('and no errors in the game', (await S('s.diagnostics.size')) === 0 && (await S('s.runner.status')) === 'running');

    // ---------- the Music panel ----------
    await S('(s.dock.show("music"), 1)');
    check('the Music panel starts with an invitation', await waitFor('[...document.querySelectorAll(".empty .btn")].some((b) => b.textContent.includes("first song"))', 4000));
    await clickButton('.empty .btn', 'Make my first song');
    check('a new song asks for a name and what to start from', await waitFor('!!document.querySelector(".dialog input[type=text]") && !!document.querySelector(".dialog select")', 3000));
    await clickButton('.dialog .btn', 'Make it');
    check('the song is written to src/music.js', await waitFor('window.studio.project.has("src/music.js") && !!document.querySelector(".music-canvas")', 4000));
    const songs = async () => JSON.parse(await page.eval(`(async () => { const m = await import('/studio/app/paint/music-model.js'); const out = m.parseSongs(window.studio.project.readText('src/music.js')); return JSON.stringify(out.songs); })()`));
    let calm = (await songs()).calm;
    check('it starts as the calm loop: two tracks, four bars, plenty of notes', calm.tracks.length === 2 && calm.bars === 4 && calm.tracks[0].notes.length === 8 && calm.tracks[1].notes.length === 32, JSON.stringify({ t: calm.tracks.length, b: calm.bars }));
    await clickButton('.music .btn', 'Clear');
    check('"Clear" takes every note off the selected track', (await songs()).calm.tracks[0].notes.length === 0 && (await songs()).calm.tracks[1].notes.length === 32);
    const cell = async (step, pitch, high = 84) => JSON.parse(await page.eval(`(() => { const c = document.querySelector('.music-canvas'); const r = c.getBoundingClientRect(); const k = r.width / c.width; return JSON.stringify({ x: r.left + (38 + ${step} * 14 + 7) * k, y: r.top + ((${high} - ${pitch}) * 12 + 6) * k }); })()`));
    let c1 = await cell(4, 60);
    await mouseAt('mouseMoved', c1.x, c1.y); await mouseAt('mousePressed', c1.x, c1.y); await mouseAt('mouseReleased', c1.x, c1.y);
    calm = (await songs()).calm;
    check('clicking a cell adds a note there (C4, one beat from step 4)', JSON.stringify(calm.tracks[0].notes) === JSON.stringify([{ step: 4, pitch: 60, len: 4 }]), JSON.stringify(calm.tracks[0].notes));
    c1 = await cell(5, 60);
    await mouseAt('mouseMoved', c1.x, c1.y); await mouseAt('mousePressed', c1.x, c1.y); await mouseAt('mouseReleased', c1.x, c1.y);
    check('clicking on a note takes it away', (await songs()).calm.tracks[0].notes.length === 0);
    await page.eval('document.querySelector(".music-canvas").focus()');
    await press('ArrowRight'); await press('ArrowUp'); await press('Space');
    calm = (await songs()).calm;
    check('from the keyboard, arrows move a cursor and Space adds a note', calm.tracks[0].notes.length === 1 && calm.tracks[0].notes[0].step === 6 && calm.tracks[0].notes[0].pitch === 61, JSON.stringify(calm.tracks[0].notes));
    await press('KeyZ', { ctrl: true });
    check('Ctrl+Z takes it back', (await songs()).calm.tracks[0].notes.length === 0);
    await clickButton('.music .btn', 'Surprise me');
    check('"Surprise me" writes a new tune that is a song the kit accepts', await waitFor('window.studio.project.readText("src/music.js").length > 400', 3000));
    await clickButton('.music .btn', 'Play');
    check('Play starts the loop and shows a moving playhead', await waitFor('!document.querySelector(".music-playhead").hidden', 4000));
    await page.sleep(500);
    check('the playhead moves', await page.eval('document.querySelector(".music-playhead").style.transform.startsWith("translateX(") && document.querySelector(".music-playhead").style.transform !== "translateX(38px)"'));
    await clickButton('.music .btn', 'Stop');
    check('Stop hides it', await waitFor('document.querySelector(".music-playhead").hidden', 3000));
    await shot('music');
    // a game plays it
    const musicGame = [
      "import { clear, music, playMusic } from '@engine/arcade';", "import songs from './music.js';", 'music(songs);',
      "export function create() { playMusic('calm'); return {}; }", 'export function update() {}', 'export function render(game, g) { clear(g); }', '',
    ].join('\n');
    const soundsBefore = await S('s.runner.stats.sounds');
    await S(`(s.project.write("src/main.js", ${JSON.stringify(musicGame)}), s.run({ restart: true }), 1)`);
    await page.sleep(1200);
    await S('(s.runner.key("Space", true), 1)'); await page.sleep(200); await S('(s.runner.key("Space", false), 1)');
    check('a game that calls playMusic starts the song in the page that has the speakers', await waitFor(`window.studio.runner.stats.sounds > ${soundsBefore}`, 12_000), String(await S('s.runner.stats.sounds')));
    check('and nothing went wrong', (await S('s.diagnostics.size')) === 0 && errorsNow().length === 0, errorsNow().slice(0, 2).join(' | '));

    // ---------- the level painter and the sound maker, from the keyboard alone ----------
    await S('(s.createProject({ name: "Keys", template: "hero" }), 1)');
    await waitFor('window.studio.project?.name === "Keys"', 10_000);
    await S('(s.commands.execute("workspace.art"), s.dock.show("levels"), 1)');
    await page.sleep(600);
    const levelBefore = await S('s.project.readText("src/main.js")');
    await page.eval('document.querySelector("[data-panel=levels] .art-canvas").focus()');
    await press('ArrowRight'); await press('ArrowDown'); await press('Space');
    check('the level painter: arrows move a cursor and Space paints a tile', await waitFor(`window.studio.project.readText("src/main.js") !== ${JSON.stringify(levelBefore)}`, 4000));
    await press('KeyZ', { ctrl: true });
    check('and Control Z undoes it', await waitFor(`window.studio.project.readText("src/main.js") === ${JSON.stringify(levelBefore)}`, 4000));
    await S('(s.project.write("src/sounds.js", "export default " + JSON.stringify({ coin: { duration: 0.3, seed: 1, layers: [{ wave: \"square\", freq: 800, gain: 0.5, decay: 0.1 }] } }) + ";"), s.emit("files"), s.dock.show("sounds"), 1)');
    await page.sleep(700);
    const soundBefore = await S('s.project.readText("src/sounds.js")');
    await page.eval('document.querySelector("[data-panel=sounds] input[type=range]").focus()');
    await press('ArrowRight'); await press('ArrowRight'); await press('ArrowRight');
    check('the sound maker: a slider moves with the arrow keys and the sound file changes', await waitFor(`window.studio.project.readText("src/sounds.js") !== ${JSON.stringify(soundBefore)}`, 4000));
    check('every slider says what it is for', await page.eval('[...document.querySelectorAll("[data-panel=sounds] input[type=range]")].every((r) => (r.getAttribute("aria-label") || r.closest("label")?.textContent || "").trim().length > 2)'));
  }, { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
