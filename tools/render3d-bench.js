// WebGPU vs WebGL2 throughput for the 3D renderer (instanced meshes, lighting, depth buffer, with and without MSAA).
// Usage: node tools/render3d-bench.js [--runs 3] [--quick] [--visible] [--out results.json]
import { writeFileSync } from 'node:fs';
import { runBrowserPage } from './browser-test.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(opt('runs', 3));
const ORDERS = ['webgpu,webgl2', 'webgl2,webgpu'];
const runs = [];
for (let i = 0; i < RUNS; i++) {
  console.error(`run ${i + 1}/${RUNS} (order ${ORDERS[i % 2]}) ...`);
  runs.push(await runBrowserPage(`/packages/render/browser-test/bench3d.html?kinds=${ORDERS[i % 2]}${flag('quick') ? '&quick=1' : ''}`, { visible: flag('visible'), timeoutMs: 900_000 }));
}
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const r = structuredClone(runs[0]);
for (const row of r.results) {
  if (row.unavailable) continue;
  const same = runs.map((run) => run.results.find((y) => y.kind === row.kind && y.aa === row.aa && y.scenario === row.scenario && y.n === row.n)).filter(Boolean);
  row.pipelinedMs = med(same.map((x) => x.pipelinedMs));
  row.spread = [Math.min(...same.map((x) => x.pipelinedMs)), Math.max(...same.map((x) => x.pipelinedMs))];
  row.submit = { median: med(same.map((x) => x.submit.median)) };
}
for (const k of Object.keys(r.init)) r.init[k] = med(runs.map((run) => run.init[k]));

console.log(r.env.userAgent);
console.log(`canvas ${r.width}x${r.height}, WebGPU adapter ${JSON.stringify(r.env.webgpu)}, median of ${RUNS} runs`);
console.log(`startup ms: ${Object.entries(r.init).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}\n`);
const cols = [['webgpu', false], ['webgl2', false], ['webgpu', true], ['webgl2', true]];
const label = ([k, aa]) => `${k}${aa ? ' +MSAA' : ''}`.padStart(16);
const scenarios = [...new Set(r.results.filter((x) => x.scenario).map((x) => `${x.scenario}|${x.n}`))];
function table(title, cell) {
  console.log(title);
  console.log('scenario'.padEnd(52), ...cols.map(label));
  for (const key of scenarios) {
    const [name, n] = key.split('|');
    const cells = cols.map(([k, aa]) => { const x = r.results.find((y) => y.kind === k && y.aa === aa && y.scenario === name && String(y.n) === n); return (x ? cell(x) : '-').padStart(16); });
    const tri = r.results.find((y) => y.scenario === name && String(y.n) === n)?.triangles ?? 0;
    console.log(`${n.padStart(7)} ${name} (${(tri / 1e6).toFixed(2)}M tris)`.padEnd(52).slice(0, 52), ...cells);
  }
  console.log('');
}
table('GPU time per frame, ms (frames submitted back to back; fps in brackets)', (x) => `${x.pipelinedMs.toFixed(2)} (${(1000 / x.pipelinedMs).toFixed(0)})`);
table('CPU time inside render(), ms', (x) => x.submit.median.toFixed(2));
if (opt('out')) { writeFileSync(opt('out'), JSON.stringify(r, null, 2)); console.log(`wrote ${opt('out')}`); }
process.exit(0);
