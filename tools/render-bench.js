// WebGPU vs WebGL2 vs Canvas2D sprite throughput, in a real browser.
// Usage: node tools/render-bench.js [--visible] [--quick] [--firefox] [--size 1280x720] [--out results.json]
//   headless (default) may use a software GPU (SwiftShader): the report says which adapter was actually used.
//   --visible opens a real window, so the real GPU and display refresh are used. Run this one for numbers that matter.
import { writeFileSync } from 'node:fs';
import { runBrowserPage } from './browser-test.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt('size', '1280x720').split('x').map(Number);
const browser = flag('firefox') ? 'firefox' : 'chrome';
const query = `?w=${w}&h=${h}${flag('quick') ? '&quick=1' : ''}`;

// Several runs, each in a fresh browser, with the backend order alternating so neither one always benefits from being second
// (warm GPU clocks, caches). Every number below is the median across runs.
const RUNS = Number(opt('runs', 3));
const ORDERS = ['webgl2,webgpu,canvas2d', 'webgpu,webgl2,canvas2d', 'canvas2d,webgpu,webgl2'];
const runs = [];
for (let i = 0; i < RUNS; i++) {
  console.error(`run ${i + 1}/${RUNS} (order ${ORDERS[i % ORDERS.length]}) ...`);
  runs.push(await runBrowserPage(`/packages/render/browser-test/bench.html${query}&kinds=${ORDERS[i % ORDERS.length]}`, { browser, visible: flag('visible'), timeoutMs: 900_000 }));
}
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const r = structuredClone(runs[0]);
for (const row of r.results) {
  if (row.unavailable) continue;
  const same = runs.map((run) => run.results.find((y) => y.kind === row.kind && y.scenario === row.scenario && y.n === row.n)).filter(Boolean);
  row.pipelinedMs = med(same.map((x) => x.pipelinedMs));
  row.pipelinedSpread = [Math.min(...same.map((x) => x.pipelinedMs)), Math.max(...same.map((x) => x.pipelinedMs))];
  row.submit = { median: med(same.map((x) => x.submit.median)), p95: med(same.map((x) => x.submit.p95)) };
  row.total = { median: med(same.map((x) => x.total.median)), p95: med(same.map((x) => x.total.p95)) };
  if (row.raf) { const rs = same.map((x) => x.raf).filter(Boolean); row.raf = { fps: med(rs.map((x) => x.fps)), worstGap: Math.max(...rs.map((x) => x.worstGap)), p99Gap: med(rs.map((x) => x.p99Gap)) }; }
}
for (const k of Object.keys(r.init)) r.init[k] = med(runs.map((run) => run.init?.[k]));
for (const c of r.cpu) { const same = runs.map((run) => run.cpu.find((y) => y.n === c.n)); c.fillMs = med(same.map((x) => x.fillMs)); c.sortMs = med(same.map((x) => x.sortMs)); }
r.runs = runs.length;

console.log(r.env.userAgent);
console.log(`canvas ${r.width}x${r.height}, ${r.env.cores} logical CPUs, ${flag('visible') ? 'visible window' : 'headless'}`);
console.log(`WebGPU adapter: ${JSON.stringify(r.env.webgpu)}`);
console.log(`WebGL2 renderer: ${JSON.stringify(r.env.webgl2)}\n`);

console.log('CPU (any backend): fill the batch / sort it, median ms');
for (const c of r.cpu) console.log(`  ${String(c.n).padStart(7)} sprites: fill ${c.fillMs.toFixed(2).padStart(7)}   sort ${c.sortMs.toFixed(2).padStart(7)}`);

const fmt = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)).padStart(7);
const kindsRun = [...new Set(r.results.map((x) => x.kind))];
const scenarios = [...new Set(r.results.filter((x) => x.scenario).map((x) => `${x.scenario}|${x.n}`))];
function table(title, cell) {
  console.log(title);
  console.log('scenario'.padEnd(34), ...kindsRun.map((k) => k.padStart(30)));
  for (const key of scenarios) {
    const [name, n] = key.split('|');
    const cells = kindsRun.map((kind) => {
      const x = r.results.find((y) => y.kind === kind && y.scenario === name && String(y.n) === n);
      return (x ? cell(x) : '-').padStart(30);
    });
    console.log(`${n.padStart(7)} ${name}`.padEnd(34), ...cells);
  }
}
console.log(`startup (create the renderer and show the first frame), median ms: ${Object.entries(r.init).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`);
console.log('');
table(`GPU throughput: ms per frame with frames submitted back to back (fps); median of ${r.runs} runs, [min-max] across runs`, (x) => `${fmt(x.pipelinedMs)} ${(1000 / x.pipelinedMs).toFixed(0).padStart(5)} fps${x.pipelinedSpread ? ` [${x.pipelinedSpread[0].toFixed(1)}-${x.pipelinedSpread[1].toFixed(1)}]` : ''}`);
table('CPU time inside render(), median ms (p95): what the main thread pays', (x) => `${fmt(x.submit.median)} (${fmt(x.submit.p95).trim()})`);
table('Synchronised frame, median ms: render and wait for the GPU every frame (includes each API own wait latency, so not comparable at small counts)', (x) => fmt(x.total.median));
for (const x of r.results.filter((y) => y.unavailable)) console.log(`${x.kind}: unavailable (${x.unavailable})`);

const rafRows = r.results.filter((x) => x.raf && Number.isFinite(x.raf.fps));
if (!rafRows.length) console.log('(requestAnimationFrame does not run in a headless page: use --visible for the player-visible frame rate)');
if (rafRows.length) {
  console.log('\nrequestAnimationFrame while rendering (what a player sees): fps / worst frame gap ms');
  for (const x of rafRows) console.log(`  ${x.kind.padEnd(9)} ${String(x.n).padStart(6)} ${x.scenario.padEnd(18)} ${x.raf.fps.toFixed(0).padStart(4)} fps   worst gap ${x.raf.worstGap.toFixed(1)} ms   p99 gap ${x.raf.p99Gap.toFixed(1)} ms`);
}
if (opt('out')) { writeFileSync(opt('out'), JSON.stringify(r, null, 2)); console.log(`\nwrote ${opt('out')}`); }
process.exit(0);
