// The S0 feasibility spike for the studio (docs/STUDIO.md), measured in a real browser. It answers, with numbers:
//   1. do edits reach a running game fast, keeping its state?        (service worker + import map + hot reload)
//   2. does a hung game leave the studio responsive, and recover?    (cross-origin frame + heartbeat watchdog)
//   3. do errors show real file names and line numbers?
//   4. do projects survive reloading the page?                       (IndexedDB)
//   5. is a code editor with no dependencies fast enough?            (1,000 and 10,000 lines)
// Usage: node tools/studio-spike-test.js [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/spike/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const note = (name, value) => console.log(`     ${name}: ${value}`);
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

try {
  // the studio is on "localhost", the game runs in a frame on "127.0.0.1": two different sites, like two real domains
  await withChromePage(`http://localhost:${port}/studio/spike/index.html`, async (page) => {
    const errors = () => page.errors.filter((e) => !/willReadFrequently/.test(e)).slice(0, 2).join(' | ');
    const t0 = Date.now();
    check('the studio loads and the game starts in the frame on the other origin', await page.waitFor('window.__studio && window.__studio.report.applied >= 1 && window.__studio.report.frames > 5', 15_000), errors());
    note('time to a running game', `${Date.now() - t0} ms`);
    const S = (expr) => page.eval(`(() => { const s = window.__studio; return ${expr}; })()`);
    const json = async (expr) => JSON.parse(await S(`JSON.stringify(${expr})`));
    if (outDir) writeFileSync(join(outDir, 'studio-spike-1.png'), await page.screenshot());

    // 1. edits keep their place
    await page.sleep(600);
    const before = await json('s.report.summary');
    const main = await S('s.files["src/main.js"]');
    const applied0 = await S('s.report.applied');
    await S(`s.setFile('src/main.js', ${JSON.stringify(main.replace('const SPEED = 120', 'const SPEED = 240'))})`);
    check('an edit reaches the running game', await page.waitFor(`window.__studio.report.applied > ${applied0}`, 5000));
    const lat = await json('s.report.latencies');
    const after = await json('s.report.summary');
    note('edit-to-running latency (includes the 120 ms typing pause)', `${lat[lat.length - 1]} ms`);
    check('the update takes under a second', lat[lat.length - 1] < 1000, `${lat[lat.length - 1]} ms`);
    check('the game kept its place (time and score not reset)', after.t >= before.t && after.score >= before.score, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    check('and it really runs the new code (it scores faster)', await page.waitFor(`window.__studio.report.summary.score > ${after.score}`, 6000), `from ${after.score}`);

    // an edit to the helper file changes behaviour too (imports between project files work)
    const applied1 = await S('s.report.applied');
    await S("s.setFile('src/util.js', 'export function clamp(value, low, high) { return Math.max(low, Math.min(high, value)) * 0 + 100; }')");
    check('editing an imported file reloads it too', await page.waitFor(`window.__studio.report.applied > ${applied1}`, 5000));
    await page.sleep(300);
    check('and the new helper is in use (x is now stuck at 100)', (await json('s.report.summary')).x === 100);
    await S(`s.setFile('src/util.js', ${JSON.stringify('/** Keep a number between a lowest and a highest value. */\nexport function clamp(value, low, high) {\n  return Math.max(low, Math.min(high, value));\n}\n')})`);
    await page.sleep(500);

    // 3. errors with real locations; the old code keeps running
    const errorsBefore = await S('s.report.errors.length');
    const framesBefore = await S('s.report.frames');
    await S(`s.setFile('src/main.js', ${JSON.stringify(main.replace('const SPEED = 120', 'const SPEED = ;'))})`);
    check('a syntax error is reported', await page.waitFor(`window.__studio.report.errors.length > ${errorsBefore}`, 5000));
    const syntax = await json('s.report.errors[s.report.errors.length - 1]');
    note('syntax error as the studio sees it', JSON.stringify({ message: syntax.message, file: syntax.file, line: syntax.line, column: syntax.column }));
    check('it names the file and line', syntax.file === 'src/main.js' && syntax.line === 4, `file ${syntax.file}, line ${syntax.line}`);
    await page.sleep(400);
    check('the game keeps running the last good version meanwhile', (await S('s.report.frames')) > framesBefore + 10);

    const errorsMid = await S('s.report.errors.length');
    await S(`s.setFile('src/main.js', ${JSON.stringify(main.replace('game.t += dt;', 'game.t += dt;\n  const oops = null;\n  game.score += oops.value;'))})`);
    check('a mistake while the game runs is reported', await page.waitFor(`window.__studio.report.errors.length > ${errorsMid}`, 5000));
    const runtime = await json('s.report.errors[s.report.errors.length - 1]');
    note('runtime error as the studio sees it', JSON.stringify({ message: runtime.message, file: runtime.file, line: runtime.line, column: runtime.column }));
    check('it names the file and line', runtime.file === 'src/main.js' && runtime.line === 15, `file ${runtime.file}, line ${runtime.line}`);

    // a mistake in the imported helper file is reported against THAT file
    const errorsHelper = await S('s.report.errors.length');
    await S(`s.setFile('src/util.js', 'export function clamp(value, low, high) {\\n  return Math.max(low, ;\\n}\\n')`);
    check('a syntax error in another file names that file', await page.waitFor(`window.__studio.report.errors.length > ${errorsHelper}`, 5000));
    const helper = await json('s.report.errors[s.report.errors.length - 1]');
    note('helper-file syntax error', JSON.stringify({ message: helper.message, file: helper.file, line: helper.line, column: helper.column }));
    check('file src/util.js, line 2', helper.file === 'src/util.js' && helper.line === 2, `file ${helper.file}, line ${helper.line}`);
    await S(`s.setFile('src/util.js', ${JSON.stringify('export function clamp(value, low, high) {\n  return Math.max(low, Math.min(high, value));\n}\n')})`);
    await S(`s.setFile('src/main.js', ${JSON.stringify(main)})`);
    await page.sleep(800);

    // 2. a hung game: the runner kills the worker and starts another from the last copy of the state
    await S('s.resetGap()');
    const stuck0 = await S('s.report.stuck');
    const placeBefore = await json('s.report.summary');
    await S(`s.setFile('src/main.js', ${JSON.stringify(main.replace('game.t += dt;', 'game.t += dt;\n  while (true) {}'))})`);
    check('the studio is told about a game stuck in an endless loop', await page.waitFor(`window.__studio.report.stuck > ${stuck0}`, 8000));
    const gap = await S('s.report.maxGap');
    note('longest freeze of the studio itself while the game hung', `${Math.round(gap)} ms`);
    check('the studio stayed responsive while the game hung (longest freeze under 300 ms)', gap < 300, `${Math.round(gap)} ms`);
    if (outDir) writeFileSync(join(outDir, 'studio-spike-hang.png'), await page.screenshot());
    check('the runner recovered by itself', await page.waitFor('(window.__studio.report.recovered ?? 0) >= 1', 8000));
    check('from a copy of the state, not from scratch', await S('s.report.recoveredFromSnapshot'));
    await page.sleep(2000);
    const placeAfter = await json('s.report.summary');
    check('the game carried on where it was (time kept counting from the copy)', placeAfter.t > placeBefore.t + 0.5, `${JSON.stringify(placeBefore)} -> ${JSON.stringify(placeAfter)}`);
    check('the version that hung was NOT run again (one hang, not a loop of hangs)', (await S('s.report.stuck')) === stuck0 + 1, `${await S('s.report.stuck')} hangs`);
    const framesNow = await S('s.report.frames');
    await page.sleep(500);
    check('and the new worker is running', (await S('s.report.frames')) !== framesNow);
    const appliedFix = await S('s.report.applied');
    await S(`s.setFile('src/main.js', ${JSON.stringify(main.replace('const SPEED = 120', 'const SPEED = 333'))})`);
    check('editing the code again works as before', await page.waitFor(`window.__studio.report.applied > ${appliedFix}`, 8000));
    await page.sleep(800);
    check('the studio was never frozen for long during all of that', (await S('s.report.maxGap')) < 400, `${Math.round(await S('s.report.maxGap'))} ms`);

    // 4. persistence
    await page.sleep(500);                                           // the autosave pause
    await page.eval('location.reload()');
    check('after reloading the page the project is back, with the last edit', await page.waitFor('window.__studio && window.__studio.files["src/main.js"].includes("const SPEED = 333")', 10_000));
    check('and the game runs it', await page.waitFor('window.__studio.report.applied >= 1 && window.__studio.report.frames > 5', 15_000));
    check('no page errors in the studio', errors() === '', errors());
  });

  // 5. the editor
  for (const lines of [1000, 10_000]) {
    await withChromePage(`http://localhost:${port}/studio/spike/editor-bench.html?lines=${lines}`, async (page) => {
      check(`the editor opens a ${lines}-line file`, await page.waitFor('window.__bench && document.querySelector(".ed pre").textContent.length > 100', 10_000));
      const result = JSON.parse(await page.eval(`(async () => {
        const ed = window.__bench.editor, ta = ed.textarea;
        ed.goto(${Math.floor(lines / 2)}, 4); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        ed.stats.inputMs.length = 0;
        const sync = [], toFrame = [];
        for (let i = 0; i < 200; i++) {
          const t0 = performance.now();
          document.execCommand('insertText', false, i % 20 === 19 ? '\\n' : 'x');       // a real keystroke's effect: the browser edits, our handler runs
          const t1 = performance.now();
          await new Promise((r) => requestAnimationFrame(r));
          sync.push(t1 - t0); toFrame.push(performance.now() - t0);
        }
        const scrolls = [];
        for (let i = 0; i < 100; i++) {
          const t0 = performance.now();
          ta.scrollTop = (i * 997) % (ta.scrollHeight - ta.clientHeight);
          await new Promise((r) => requestAnimationFrame(r));
          scrolls.push(performance.now() - t0);
        }
        return JSON.stringify({ handler: ed.stats.inputMs, sync, toFrame, scrolls, lines: ta.value.split('\\n').length });
      })()`));
      const h = result.handler, s = result.sync, f = result.toFrame, sc = result.scrolls;
      note(`${lines} lines: our handler p50 / p95`, `${pct(h, 0.5).toFixed(2)} / ${pct(h, 0.95).toFixed(2)} ms`);
      note(`${lines} lines: whole keystroke (browser edit + handler) p50 / p95`, `${pct(s, 0.5).toFixed(2)} / ${pct(s, 0.95).toFixed(2)} ms`);
      note(`${lines} lines: keystroke to next frame p50 / p95`, `${pct(f, 0.5).toFixed(1)} / ${pct(f, 0.95).toFixed(1)} ms`);
      note(`${lines} lines: a big scroll jump to next frame p50 / p95`, `${pct(sc, 0.5).toFixed(1)} / ${pct(sc, 0.95).toFixed(1)} ms`);
      // our own work is about 1.5 ms; the rest of the handler's time is the browser laying the whole textarea out again, which grows with the file
      check(`${lines} lines: our handler p95 under ${lines > 5000 ? 16 : 8} ms`, pct(h, 0.95) < (lines > 5000 ? 16 : 8), `${pct(h, 0.95).toFixed(2)} ms`);
      check(`${lines} lines: a keystroke reaches the screen within 50 ms (p95)`, pct(f, 0.95) < 50, `${pct(f, 0.95).toFixed(1)} ms`);
      check(`${lines} lines: scrolling keeps up (p95 under 50 ms)`, pct(sc, 0.95) < 50, `${pct(sc, 0.95).toFixed(1)} ms`);
      if (outDir && lines === 10_000) writeFileSync(join(outDir, 'studio-spike-editor.png'), await page.screenshot());
    });
  }
} finally { server.close(); }
process.exit(failed ? 1 : 0);
