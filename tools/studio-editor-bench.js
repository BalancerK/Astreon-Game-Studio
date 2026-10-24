// How smooth is editing? In a real Chrome, with a long file open: the time from typing a letter to the next picture, from a scroll to the next picture, the cost of
// switching between tabs, of opening a split, of resizing the window and of dragging a splitter. Prints the numbers (milliseconds; the slowest 5% are the "p95"),
// and fails if typing or scrolling is not smooth. Usage: node tools/studio-editor-bench.js [lines]
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const LINES = Number(process.argv[2]) || 4000;
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000);
    await S('(s.createProject({ name: "Bench", template: "blank" }), 1)');
    await page.waitFor('window.studio.project?.name === "Bench"', 10_000);
    const big = Array.from({ length: LINES }, (_, i) => (i % 7 === 0 ? `function f${i}(a, b) { return a + b * ${i}; }` : `const value${i} = [${i}, "text ${i}", { x: ${i}, y: ${i * 2} }]; // line ${i}`)).join('\n');
    await S(`(s.project.write("src/big.js", ${JSON.stringify(big)}), s.project.write("src/small.js", "export const small = 1;\\n"), s.commands.execute("workspace.code"), s.openFile("src/big.js"), 1)`);
    await page.sleep(1500);
    const numbers = JSON.parse(await page.eval(`(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const pct = (list, p) => [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))];
      const sum = (list) => ({ avg: list.reduce((n, v) => n + v, 0) / list.length, p95: pct(list, 0.95), max: Math.max(...list) });
      const ta = document.querySelector('.editor-group .ed textarea');
      ta.focus();
      const out = {};
      // typing in the middle of the file
      ta.setSelectionRange(Math.floor(ta.value.length / 2), Math.floor(ta.value.length / 2));
      const typing = [];
      for (let i = 0; i < 80; i++) { const t = performance.now(); document.execCommand('insertText', false, 'x'); await frame(); typing.push(performance.now() - t); }
      out.typing = sum(typing);
      // a new line in the middle (the lines below move down)
      const enter = [];
      for (let i = 0; i < 30; i++) { const t = performance.now(); document.execCommand('insertText', false, '\\n'); await frame(); enter.push(performance.now() - t); }
      out.enter = sum(enter);
      // scrolling
      const scroll = [];
      for (let i = 0; i < 80; i++) { const t = performance.now(); ta.scrollTop = i * 400; await frame(); scroll.push(performance.now() - t); }
      out.scroll = sum(scroll);
      // switching tabs
      const tabs = [];
      for (let i = 0; i < 12; i++) { const t = performance.now(); window.studio.openFile(i % 2 ? 'src/big.js' : 'src/small.js'); await frame(); tabs.push(performance.now() - t); }
      out.tabs = sum(tabs);
      // opening a split with the big file, and closing it
      let t0 = performance.now();
      window.studio.splitFile('src/big.js', 'right');
      await frame();
      out.split = performance.now() - t0;
      // resizing the window (the panel) with two editors open
      const resize = [];
      const dock = document.getElementById('dock');
      for (let i = 0; i < 30; i++) { const t = performance.now(); dock.style.width = (1200 - i * 10) + 'px'; await frame(); resize.push(performance.now() - t); }
      dock.style.width = '';
      out.resize = sum(resize);
      // dragging the bar between the editors
      const sizes = [];
      const panes = [...document.querySelectorAll('.editor-group')];
      document.querySelector('.editor-groups').classList.add('resizing');            // what a drag does to a long file
      for (let i = 0; i < 30; i++) { const t = performance.now(); panes[0].style.flex = (0.3 + i * 0.01) + ' 1 0'; panes[1].style.flex = (0.7 - i * 0.01) + ' 1 0'; await frame(); sizes.push(performance.now() - t); }
      out.splitter = sum(sizes);
      document.querySelector('.editor-groups').classList.remove('resizing');
      const commit = performance.now();
      window.studio.groups.sizes = [0.5, 0.5]; window.studio.groupsChanged(); await frame();
      out.commit = performance.now() - commit;
      return JSON.stringify(out);
    })()`));
    const f = (n) => `${n.toFixed(1)} ms`;
    for (const [name, label] of [['typing', 'a letter typed'], ['enter', 'a new line typed'], ['scroll', 'a scroll'], ['tabs', 'switching tabs'], ['resize', 'a window resize step'], ['splitter', 'a splitter step']]) {
      const n = numbers[name];
      console.log(`     ${label} (${LINES} lines): average ${f(n.avg)}, slowest 5% ${f(n.p95)}, worst ${f(n.max)}`);
    }
    console.log(`     opening a split with the big file: ${f(numbers.split)}; letting go of a splitter: ${f(numbers.commit)}`);
    check('typing a letter is on the screen within two frames (35 ms) for 95% of letters', numbers.typing.p95 < 35, f(numbers.typing.p95));
    check('a new line is too', numbers.enter.p95 < 50, f(numbers.enter.p95));
    check('scrolling keeps up (95% of steps under 35 ms)', numbers.scroll.p95 < 35, f(numbers.scroll.p95));
    check('switching tabs is quick (under 120 ms on average)', numbers.tabs.avg < 120, f(numbers.tabs.avg));
    check('opening a split takes under 400 ms', numbers.split < 400, f(numbers.split));
    check('resizing is smooth (95% of steps under 50 ms)', numbers.resize.p95 < 50, f(numbers.resize.p95));
    check('dragging a splitter between two long files is smooth (95% of steps under 35 ms)', numbers.splitter.p95 < 35, f(numbers.splitter.p95));
  }, { width: 1400, height: 800 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
