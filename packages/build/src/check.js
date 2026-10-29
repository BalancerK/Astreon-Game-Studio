// Does a bundle behave like the modules it was made from? A game's tests run the real modules in Node, but its players run the bundle, and a bundler's mistake (a name that was not exported, a value that
// reads differently, a module that cannot start) shows only there: a game once passed two thousand tests while one multiplier was `undefined` in every browser. `checkBundle` loads every module both ways
// and compares what they export, so such a mistake is found by a test instead of by a player.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { bundle } from './bundle.js';

/** What a value is, shortly, for comparing: its type, and for plain data its content. */
function describe(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean' || t === 'bigint' || t === 'undefined') return `${t}:${String(v)}`;
  if (t === 'function') return v.prototype && /^class\b/.test(Function.prototype.toString.call(v)) ? 'class' : 'function';
  if (Array.isArray(v)) return `array:${v.length}`;
  if (t === 'symbol') return 'symbol';
  return `object:${Object.keys(v).sort().join(',')}`;
}

/**
 * Load every module of a bundle both through the bundle and as the real module in Node, and compare the names each exports and what they are.
 * Modules run twice (once each way), so give `only` to leave out the ones that touch the page.
 * @param {string} entry the bundle's entry file
 * @param {object} [o] `root`, `alias`, `define`, `minify` as for `bundle`; `only(id)` limits which modules are compared (default all); `load(file)` loads the real module (default: `import()`)
 * @returns {Promise<{checked: number, skipped: Array<{id: string, why: string}>, problems: Array<{id: string, why: string}>}>}
 * `skipped` modules cannot be loaded in Node (they need a page); `problems` are real differences: a module that loads unbundled but not bundled, a name that is missing or extra, or a value that differs.
 */
export async function checkBundle(entry, { root, alias, define, minify = false, only = () => true, load = (file) => import(pathToFileURL(file).href) } = {}) {
  const r = bundle(entry, { root, alias, define, minify, expose: true });
  const runtime = new Function(`return ${r.code}`)();
  const checked = [], skipped = [], problems = [];
  for (const m of r.modules) {
    if (!only(m.id)) continue;
    let real;
    try { real = await load(join(m.file)); } catch (e) { skipped.push({ id: m.id, why: `does not load in Node: ${String(e.message ?? e).split('\n')[0]}` }); continue; }
    let got;
    try { got = runtime.require(m.id); } catch (e) { problems.push({ id: m.id, why: `loads as it is but not in the bundle: ${String(e.message ?? e).split('\n')[0]}` }); continue; }
    checked.push(m.id);
    const a = Object.keys(real).sort(), b = Object.keys(got).sort();
    for (const k of a) if (!b.includes(k)) problems.push({ id: m.id, why: `\`${k}\` is exported but missing from the bundle` });
    for (const k of b) if (!a.includes(k)) problems.push({ id: m.id, why: `\`${k}\` is in the bundle but the module does not export it` });
    for (const k of a) if (b.includes(k)) {
      let x, y;
      try { x = describe(real[k]); y = describe(got[k]); } catch (e) { problems.push({ id: m.id, why: `\`${k}\` cannot be read in the bundle: ${e.message}` }); continue; }
      if (x !== y) problems.push({ id: m.id, why: `\`${k}\` is ${x} as the module and ${y} in the bundle` });
    }
  }
  return { checked: checked.length, skipped, problems };
}
