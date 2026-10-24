// Cross-engine determinism check: runs the shared-simulation suite in Node (V8), Chrome (V8) and
// Firefox (SpiderMonkey) and compares bit-for-bit hashes.
// Usage: node tools/determinism.js [--update]   (--update rewrites the golden hashes from Node)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeterminismSuite } from '../examples/arena/shared/determinism.js';
import { runMathSuite } from '../packages/math/browser-test/suite.js';
import { runArena3dSuite } from '../examples/arena3d/shared/determinism.js';
import { runPhysics3dSuite } from '../packages/physics/browser-test/suite.js';
import { runAiSuite } from '../packages/ai/browser-test/suite.js';
import { runTweenSuite } from '../packages/tween/browser-test/suite.js';
import { runBrowserPage, findBrowser } from './browser-test.js';

const GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'arena', 'test', 'determinism.golden.json');
const MATH_GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'math', 'test', 'determinism.golden.json');
// Each suite is a page that reports `{exact, probe}`; results from all of them are merged (their keys never collide).
const PHYSICS_GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'physics', 'test', 'determinism.golden.json');
const AI_GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'ai', 'test', 'determinism.golden.json');
const TWEEN_GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'tween', 'test', 'determinism.golden.json');
const ARENA3D_GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'arena3d', 'test', 'determinism.golden.json');
const PAGES = ['/examples/arena3d/browser-test/determinism.html', '/examples/arena/browser-test/determinism.html', '/packages/math/browser-test/determinism.html', '/packages/physics/browser-test/determinism.html', '/packages/ai/browser-test/determinism.html', '/packages/tween/browser-test/determinism.html'];

const arena = runDeterminismSuite(), math = runMathSuite(), physics3d = runPhysics3dSuite(), arena3d = runArena3dSuite(), ai = runAiSuite(), tween = runTweenSuite();
const node = { exact: { ...arena.exact, ...math.exact, ...physics3d.exact, ...arena3d.exact, ...ai.exact, ...tween.exact }, probe: { ...arena.probe, ...math.probe, ...physics3d.probe, ...arena3d.probe, ...ai.probe, ...tween.probe } };
if (process.argv.includes('--update')) {
  writeFileSync(GOLDEN, JSON.stringify(arena.exact, null, 2) + '\n');
  writeFileSync(MATH_GOLDEN, JSON.stringify(math.exact, null, 2) + '\n');
  writeFileSync(PHYSICS_GOLDEN, JSON.stringify(physics3d.exact, null, 2) + '\n');
  writeFileSync(ARENA3D_GOLDEN, JSON.stringify(arena3d.exact, null, 2) + '\n');
  writeFileSync(AI_GOLDEN, JSON.stringify(ai.exact, null, 2) + '\n');
  writeFileSync(TWEEN_GOLDEN, JSON.stringify(tween.exact, null, 2) + '\n');
  console.log('golden hashes updated:', GOLDEN, MATH_GOLDEN, PHYSICS_GOLDEN, ARENA3D_GOLDEN);
}

const engines = [{ name: `Node ${process.version} (V8)`, ...node }];
for (const [browser, label] of [['chrome', 'Chrome'], ['firefox', 'Firefox']]) {
  if (!findBrowser(browser)) { console.log(`(${label} not found, skipped)`); continue; }
  try {
    const merged = { exact: {}, probe: {} };
    for (const page of PAGES) {
      let r;
      for (let attempt = 1; ; attempt++) { // a browser occasionally fails to start (Firefox, rarely): one retry
        try { r = await runBrowserPage(page, { browser, timeoutMs: 60_000 }); break; } catch (e) { if (attempt >= 2) throw e; console.log(`${label}: ${e.message}; retrying once`); }
      }
      if (r.error) throw new Error(`${page}: ${r.error}`);
      Object.assign(merged.exact, r.exact);
      Object.assign(merged.probe, r.probe);
      merged.userAgent = r.userAgent;
    }
    const version = /(Chrome|Firefox)\/([\d.]+)/.exec(merged.userAgent)?.[0] ?? label;
    engines.push({ name: `${version} (${browser === 'firefox' ? 'SpiderMonkey' : 'V8'})`, ...merged });
  } catch (e) {
    console.log(`${label}: FAILED to run: ${e.message}`);
    process.exitCode = 1;
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\nEXACT (must match everywhere):');
console.log(pad('suite', 20) + engines.map((e) => pad(e.name, 30)).join(''));
let mismatches = 0;
for (const key of Object.keys(node.exact)) {
  const hashes = engines.map((e) => e.exact[key]);
  const same = hashes.every((h) => h === hashes[0]);
  if (!same) mismatches++;
  console.log(pad(key, 20) + hashes.map((h) => pad(h, 30)).join('') + (same ? 'ok' : 'MISMATCH'));
}
console.log('\nPROBE (Math functions the language does not specify exactly; informational):');
const differing = [];
for (const key of Object.keys(node.probe)) {
  const groups = new Map();
  engines.forEach((e) => groups.set(e.probe[key], [...(groups.get(e.probe[key]) ?? []), e.name.split(' ')[0]]));
  if (groups.size > 1) {
    differing.push(key);
    console.log(`  ${pad(key, 7)} differs: ${[...groups.values()].map((g) => `[${g.join(', ')}]`).join(' vs ')}`);
  }
}
console.log(`  agreed on: ${Object.keys(node.probe).filter((k) => !differing.includes(k)).join(', ') || '(none)'}`);

if (mismatches > 0) { console.log(`\nFAIL: ${mismatches} exact suite(s) differ between engines.`); process.exit(1); }
console.log(`\nPASS: all exact suites are bit-identical across ${engines.length} engine run(s).`);
void join;
