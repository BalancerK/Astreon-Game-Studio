import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { scan, codeTest, minifyJs, minifyJson, minifyCss, bundle, build, globToRegExp, serve, BundleError } from '../src/index.js';

/** A project in a temporary folder: `files` maps relative paths to text (or Buffers). */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'build-'));
  const put = (rel, data) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
  for (const [rel, data] of Object.entries(files)) put(rel, data);
  return { root, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
/** Run bundled code in an empty context and return what it put on `out`. */
function run(code, extra = {}) { const out = {}; const ctx = { out, console, ...extra }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx); return out; }

// ---- lexer and minifier ----
test('the lexer tells code from comments, strings, templates and regular expressions', () => {
  const src = "const a = 1; // import x from 'y'\nconst s = 'export const z'; /* export default */ const t = `import ${a} from ${`x`}`; const r = /\\/\\/ import/g; const d = a / 2 / 3;";
  const isCode = codeTest(scan(src));
  assert.equal(isCode(src.indexOf('const a')), true);
  assert.equal(isCode(src.indexOf("import x")), false);
  assert.equal(isCode(src.indexOf('export const z')), false);
  assert.equal(isCode(src.indexOf('export default')), false);
  assert.equal(isCode(src.indexOf('import ${')), false);
  assert.equal(isCode(src.indexOf('${a}') + 2), true, 'an expression inside a template is code');
  assert.equal(isCode(src.indexOf('/g') - 3), false, 'regex body');
  assert.equal(isCode(src.indexOf('a / 2')), true); assert.equal(isCode(src.indexOf('/ 3')), true, 'division is not a regex');
  const props = 'const s = e.in / 60, t = o?.of / 2, u = a.new / 3; const r = x in /y/;';
  const segs = scan(props), kinds = segs.map((q) => q.type);
  assert.deepEqual(kinds, ['regex'], 'only the real regex after the keyword `in` is a regex; a property called in, of or new is followed by division');
  assert.throws(() => scan('const a = "oops\nnext'), /unterminated string/);
  assert.throws(() => scan('/* never closed'), /unterminated comment/);
});

test('minifying JavaScript drops comments and indentation but never changes strings, templates, regexes or line structure', () => {
  const src = [
    '/*! keep this licence */',
    '// a comment',
    'function f(a,   b) {',
    '    /* block',
    '       comment */',
    '    const s = "  keep   spaces // not a comment";',
    '    const t = `line one  ',
    '      line two ${a +   b}  `;',
    '    const r = /  a\\/\\/b  /g; // trailing',
    '    return a /* inline */ + b',
    '}',
    '',
    '',
    'export default f   ',
  ].join('\n');
  const min = minifyJs(src);
  assert.ok(min.length < src.length * 0.8, `${min.length} vs ${src.length}`);
  assert.ok(min.startsWith('/*! keep this licence */'));
  assert.ok(!/block|inline|trailing/.test(min) && !min.includes('// a comment\n'));
  assert.ok(min.includes('"  keep   spaces // not a comment"')); assert.ok(min.includes('`line one  \n      line two ${a + b}  `'));
  assert.ok(min.includes('/  a\\/\\/b  /g'));
  const strip = (s) => new Function(`${s.replace('export default f', 'return f')}`)();
  assert.equal(strip(src)(2, 3), strip(min)(2, 3));
  assert.equal(minifyJs('return\nx'), 'return\nx\n', 'line breaks stay, so automatic semicolon rules are unchanged');
});

test('JSON and CSS minify', () => {
  assert.equal(minifyJson('{ "a": [1, 2,\n 3], "b": { } }'), '{"a":[1,2,3],"b":{}}');
  assert.throws(() => minifyJson('{ nope'), /invalid JSON/);
  assert.equal(minifyCss('/* c */ a  >  b {\n  color : red ;\n  margin: 0 auto;\n}\n.x::after { content: "  a  /* no */ "; }'), 'a>b{color:red;margin:0 auto}.x::after{content:"  a  /* no */ "}');
});

test('globs: * stays in a folder, ** crosses folders, {a,b} and ? work', () => {
  const m = (g, p) => globToRegExp(g).test(p);
  assert.ok(m('assets/**', 'assets/a/b/c.png')); assert.ok(m('assets/*.png', 'assets/a.png')); assert.ok(!m('assets/*.png', 'assets/x/a.png'));
  assert.ok(m('**/*.json', 'a.json')); assert.ok(m('**/*.json', 'x/y/a.json')); assert.ok(m('a/*.{png,jpg}', 'a/b.jpg')); assert.ok(!m('a/*.{png,jpg}', 'a/b.gif')); assert.ok(m('a?.js', 'ab.js'));
});

// ---- the bundler ----
test('bundling handles every import / export form and keeps live getters', () => {
  const p = project({
    'main.js': [
      "import def, { a, b as bee, fn } from './lib.js';",
      "import * as ns from './lib.js';",
      "import { re1, re2 as re3 } from './reexport.js';",
      "import './side.js';",
      "import Klass, { Other } from './klass.js';",
      "import { shared } from './shared.js';",
      'out.values = [def, a, bee, fn(2), Object.keys(ns).sort().join(), re1, re3, new Klass().hi(), new Other().hi(), shared];',
      "out.side = globalThis.sideRan;",
      "import('./lazy.js').then((m) => { out.lazy = m.lazy; });",
    ].join('\n'),
    'lib.js': "export const a = 1;\nconst b = 2;\nexport { b };\nexport function fn(x) { return x * a; }\nexport default 'dflt';\nexport * from './shared.js';\nexport { re1 } from './reexport.js';",
    'reexport.js': "export const re1 = 're1';\nexport const re2 = 're2';",
    'side.js': 'globalThis.sideRan = true;',
    'klass.js': 'export default class K { hi() { return "k"; } }\nexport class Other { hi() { return "o"; } }',
    'shared.js': "export const shared = ['s'];",
    'lazy.js': "export const lazy = 'later';",
    'unused.js': "throw new Error('should not be bundled');",
  });
  try {
    for (const minify of [false, true]) {
      const r = bundle(join(p.root, 'main.js'), { minify });
      assert.ok(!r.modules.some((m) => m.id === 'unused.js'), 'only reachable modules');
      const out = run(r.code);
      assert.equal(JSON.stringify(out.values), JSON.stringify(['dflt', 1, 2, 2, 'a,b,default,fn,re1,shared', 're1', 're2', 'k', 'o', ['s']]));
      assert.equal(out.side, true);
    }
    const sharedOnce = run(bundle(join(p.root, 'main.js')).code, {});
    assert.equal(sharedOnce.values[9][0], 's');
  } finally { p.cleanup(); }
});

test('import-looking text in comments, strings and templates is left alone', () => {
  const p = project({
    'main.js': "// import nothing from './nope.js'\nconst s = \"import x from './nope.js'\";\nconst t = `\nimport y from './nope.js'\nexport const q = 1;\n`;\n/*\nexport default 5;\n*/\nout.s = [s, t.trim().split('\\n').length];",
  });
  try { const out = run(bundle(join(p.root, 'main.js')).code); assert.equal(out.s[1], 2); assert.match(out.s[0], /^import x/); } finally { p.cleanup(); }
});

test('mistakes are reported with the file: cycles, export let, missing files, destructured exports, top-level await outside the entry', () => {
  const p = project({
    'cycle-a.js': "import './cycle-b.js';\nexport const a = 1;", 'cycle-b.js': "import './cycle-a.js';\nexport const b = 1;",
    'let.js': 'export let counter = 0;', 'missing.js': "import './nowhere.js';", 'destructure.js': 'export const { x, y } = { x: 1, y: 2 };',
    'tla-dep.js': 'await Promise.resolve();\nexport const t = 1;', 'tla-main.js': "import './tla-dep.js';",
    'tla-entry.js': "const v = await Promise.resolve(7);\nout.v = v;\nexport const unused = 1;",
    'bare.js': "import 'no-such-package';",
  });
  try {
    const err = (f, re) => assert.throws(() => bundle(join(p.root, f)), (e) => e instanceof BundleError && re.test(e.message), f);
    err('cycle-a.js', /circular import: cycle-a\.js -> cycle-b\.js -> cycle-a\.js/);
    err('let.js', /export let counter.*stale/); err('missing.js', /cannot find "\.\/nowhere\.js"/); err('destructure.js', /not supported; export each name/);
    err('tla-main.js', /only supported in the entry module/); err('bare.js', /cannot find the package "no-such-package"/);
    // the entry module may await
    const code = bundle(join(p.root, 'tla-entry.js')).code;
    const out = {}; const ctx = { out, Promise }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
    return Promise.resolve().then(() => Promise.resolve()).then(() => assert.equal(out.v, 7));
  } finally { p.cleanup(); }
});

test('bare package names resolve through node_modules (exports, main, subpaths) and aliases and defines work', () => {
  const p = project({
    'node_modules/pkg-a/package.json': JSON.stringify({ name: 'pkg-a', exports: { '.': './lib/main.js' } }),
    'node_modules/pkg-a/lib/main.js': "import { util } from './util.js';\nexport const fromA = 'A:' + util;", 'node_modules/pkg-a/lib/util.js': "export const util = 'u';",
    'node_modules/@scope/pkg-b/package.json': JSON.stringify({ name: '@scope/pkg-b', main: 'index.js' }), 'node_modules/@scope/pkg-b/index.js': "export default 'B';", 'node_modules/@scope/pkg-b/extra.js': "export const extra = 'X';",
    'src/main.js': "import { fromA } from 'pkg-a';\nimport b from '@scope/pkg-b';\nimport { extra } from '@scope/pkg-b/extra.js';\nimport { helper } from '@game/helper.js';\nout.r = [fromA, b, extra, helper, DEBUG ? 'debug' : 'release', 'DEBUG'];",
    'lib/helper.js': "export const helper = 'h';",
  });
  try {
    const out = run(bundle(join(p.root, 'src/main.js'), { root: p.root, alias: { '@game': join(p.root, 'lib') }, define: { DEBUG: 'false' } }).code);
    assert.equal(JSON.stringify(out.r), JSON.stringify(['A:u', 'B', 'X', 'h', 'release', 'DEBUG']));
  } finally { p.cleanup(); }
});

test('the engine\'s own packages bundle, minify, and export exactly what they export unbundled', async () => {
  const names = ['ai', 'save', 'fsm', 'ui', 'prefab', 'scene', 'assets', 'physics', 'math', 'core', 'protocol'];
  const p = project({ 'entry.js': `${names.map((n) => `import * as ${n} from '${fileURLToPath(new URL(`../../${n}/src/index.js`, import.meta.url)).split('\\').join('/')}';`).join('\n')}\nout.keys = [${names.join(',')}].map((m) => Object.keys(m).sort());` });
  try {
    const r = bundle(join(p.root, 'entry.js'), { root: p.root, minify: true });
    const out = run(r.code, { TextEncoder, TextDecoder, performance, URL, AbortController, setTimeout, clearTimeout, btoa, atob });
    const real = []; for (const n of names) real.push(Object.keys(await import(`../../${n}/src/index.js`)).sort());
    assert.equal(JSON.stringify(out.keys), JSON.stringify(real));
    assert.ok(r.modules.length > 50);
  } finally { p.cleanup(); }
});

// ---- the production build ----
const SITE = () => ({
  'index.html': '<!doctype html><html><head><title>t</title><link rel="stylesheet" href="style.css"><link rel="icon" href="img/icon.png"></head><body><canvas id="c"></canvas><script type="module" src="./main.js"></script></body></html>',
  'main.js': "import { greet } from './greet.js';\n// the entry\nout.greeting = greet('world');\nexport {};",
  'greet.js': "/** Says hello. */\nexport function greet(who) {\n  // build the message\n  return `hello ${who}`;\n}\nexport function neverUsed() { return 'dead code stays, modules do not'; }",
  'style.css': '/* theme */\nbody {\n  background: url(img/bg.png);\n  margin: 0;\n}\n',
  'img/icon.png': Buffer.from('ICON'.repeat(10)), 'img/bg.png': Buffer.from('BG'.repeat(10)),
  'assets/level.json': '{\n  "name": "one",\n  "walls": [ 1, 2, 3 ]\n}\n', 'assets/tex/brick.png': Buffer.from('BRICK'.repeat(200)), 'assets/notes.txt': 'hello '.repeat(300),
});

test('a build writes hashed files, a manifest that matches them, rewritten pages, headers and compressed copies', () => {
  const p = project(SITE());
  try {
    const r = build({ root: p.root, outDir: 'dist', pages: ['index.html'], assets: ['assets/**'] });
    const out = (f) => readFileSync(join(p.root, 'dist', f));
    const m = JSON.parse(out('manifest.json').toString());
    assert.deepEqual(Object.keys(m.assets), ['assets/level.json', 'assets/notes.txt', 'assets/tex/brick.png']);
    for (const [logical, e] of Object.entries(m.assets)) {
      assert.match(e.url, new RegExp(`^${logical.replace(/\.[^.]+$/, '').replace(/[/.]/g, '\\$&')}\\.[0-9a-f]{8}\\.${logical.split('.').pop()}$`), logical);
      assert.equal(out(e.url).length, e.bytes); assert.ok(e.url.includes(e.hash));
    }
    assert.equal(out(m.assets['assets/level.json'].url).toString(), '{"name":"one","walls":[1,2,3]}', 'json is minified');
    const html = out('index.html').toString();
    const bundleFile = Object.values(m.bundles)[0];
    assert.match(bundleFile, /^main\.[0-9a-f]{8}\.js$/);
    assert.ok(html.includes(`<script defer src="${bundleFile}"></script>`) && !html.includes('type="module"'));
    assert.ok(html.includes('id="asset-manifest"') && html.includes('"assets/level.json"'), 'manifest inlined');
    const css = html.match(/href="(style\.[0-9a-f]{8}\.css)"/)?.[1]; assert.ok(css, 'stylesheet hashed');
    assert.match(html, /href="img\/icon\.[0-9a-f]{8}\.png"/);
    const cssText = out(css).toString(); assert.match(cssText, /url\(img\/bg\.[0-9a-f]{8}\.png\)/); assert.ok(!cssText.includes('theme'));
    assert.deepEqual(run(out(bundleFile).toString()).greeting, 'hello world');
    assert.ok(!out(bundleFile).toString().includes('build the message'), 'comments gone');
    // compression
    const notes = m.assets['assets/notes.txt'].url;
    assert.equal(gunzipSync(out(`${notes}.gz`)).toString(), out(notes).toString()); assert.equal(brotliDecompressSync(out(`${notes}.br`)).toString(), out(notes).toString());
    assert.ok(!existsSync(join(p.root, 'dist', `${m.assets['assets/level.json'].url}.gz`)), 'tiny files are not compressed');
    assert.match(out('_headers').toString(), /\/manifest\.json\n  Cache-Control: no-cache[\s\S]*immutable/);
    assert.equal(r.bundles[0].modules, 2); assert.ok(r.bundles[0].gzip < r.bundles[0].minified);
    assert.deepEqual(r.warnings, []);
  } finally { p.cleanup(); }
});

test('builds are reproducible, names change only when content changes, and a new build replaces the old output', () => {
  const p = project(SITE());
  try {
    const snapshot = () => Object.fromEntries(readdirSync(join(p.root, 'dist'), { recursive: true }).filter((f) => !readdirSync(join(p.root, 'dist')).includes(f) || true).map((f) => [f, existsSync(join(p.root, 'dist', f)) ? f : null]));
    const a = build({ root: p.root, assets: ['assets/**'] });
    const aBytes = new Map(a.files.map((f) => [f.path, readFileSync(join(p.root, 'dist', f.path)).toString('base64')]));
    const b = build({ root: p.root, assets: ['assets/**'] });
    assert.deepEqual([...aBytes.keys()], b.files.map((f) => f.path), 'same file names');
    for (const f of b.files) assert.equal(readFileSync(join(p.root, 'dist', f.path)).toString('base64'), aBytes.get(f.path), `${f.path} is identical`);
    p.put('assets/level.json', '{"name":"two"}');
    p.put('greet.js', 'export function greet(w) { return `hi ${w}`; }');
    p.put('stale.txt', 'x'); writeFileSync(join(p.root, 'dist', 'stale-output.txt'), 'old');
    const c = build({ root: p.root, assets: ['assets/**'] });
    assert.notEqual(c.manifest.assets['assets/level.json'].url, a.manifest.assets['assets/level.json'].url);
    assert.equal(c.manifest.assets['assets/tex/brick.png'].url, a.manifest.assets['assets/tex/brick.png'].url, 'unchanged files keep their names');
    assert.notEqual(Object.values(c.manifest.bundles)[0], Object.values(a.manifest.bundles)[0]);
    assert.ok(!existsSync(join(p.root, 'dist', 'stale-output.txt')));
    assert.equal(snapshot !== undefined, true);
  } finally { p.cleanup(); }
});

test('build refuses to clean the project folder, reports missing pages, warns about inline modules, and supports transforms and a public path', () => {
  const p = project({ ...SITE(), 'inline.html': '<script type="module">import "./main.js"</script><img src="img/icon.png"><a href="index.html">x</a>' });
  try {
    assert.throws(() => build({ root: p.root, outDir: '.' }), /would delete the project folder/);
    assert.throws(() => build({ root: p.root, pages: ['nope.html'] }), /page "nope\.html" does not exist/);
    const r = build({ root: p.root, pages: ['index.html', 'inline.html'], assets: ['assets/**'], publicPath: '/game/', transforms: { '.png': (b) => Buffer.concat([Buffer.from('X'), b]) } });
    assert.ok(r.warnings.some((w) => /inline module script/.test(w)));
    const html = readFileSync(join(p.root, 'dist', 'index.html'), 'utf8');
    assert.match(html, /src="\/game\/main\.[0-9a-f]{8}\.js"/); assert.match(html, /href="\/game\/style\.[0-9a-f]{8}\.css"/);
    assert.match(readFileSync(join(p.root, 'dist', 'inline.html'), 'utf8'), /href="index\.html"/, 'links between pages are left alone');
    const brick = r.manifest.assets['assets/tex/brick.png'];
    assert.equal(readFileSync(join(p.root, 'dist', brick.url))[0], 'X'.charCodeAt(0));
    assert.equal(r.manifest.publicPath, '/game/');
  } finally { p.cleanup(); }
});

// ---- the dev server ----
test('the dev server serves files, keeps the manifest current as files change, and refuses to leave the project', async () => {
  const p = project({ 'index.html': '<html><body>hi</body></html>', 'main.js': 'export const x = 1;', 'assets/a.json': '{"v":1}', '.secret': 'no', 'node_modules/x/index.js': 'no' });
  const dev = await serve({ root: p.root, assets: ['assets/**'], port: 0, liveReload: true });
  try {
    const get = (path, init) => fetch(dev.url + path.replace(/^\//, ''), init);
    const page = await (await get('/')).text();
    assert.ok(page.includes('hi') && page.includes('EventSource'), 'live reload client injected');
    assert.equal((await get('main.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    for (const bad of ['.secret', 'node_modules/x/index.js', '..%2Fx', 'nope.js']) assert.ok([403, 404].includes((await get(bad)).status), bad);
    const m1res = await get('manifest.json'); const m1 = await m1res.json(); const etag1 = m1res.headers.get('etag');
    assert.equal(m1.assets['assets/a.json'].url, 'assets/a.json'); assert.ok(m1.assets['assets/a.json'].hash);
    assert.equal((await get('manifest.json', { headers: { 'if-none-match': etag1 } })).status, 304);
    writeFileSync(join(p.root, 'assets', 'a.json'), '{"v":2,"more":true}'); dev.changed('assets/a.json');
    const m2res = await get('manifest.json'); const m2 = await m2res.json();
    assert.notEqual(m2.assets['assets/a.json'].hash, m1.assets['assets/a.json'].hash); assert.notEqual(m2res.headers.get('etag'), etag1);
    // the asset manager's hot reload works against it
    const { AssetManager, basicLoaders, watchManifest } = await import('../../assets/src/index.js');
    const mgr = new AssetManager({ base: dev.url, manifest: m1 }).registerAll(basicLoaders());
    writeFileSync(join(p.root, 'assets', 'a.json'), '{"v":1}'); dev.changed('assets/a.json');
    const h = mgr.acquire('json', 'assets/a.json'); await h.promise; assert.equal(h.value.v, 1);
    writeFileSync(join(p.root, 'assets', 'a.json'), '{"v":3}'); dev.changed('assets/a.json');
    const w = watchManifest(mgr, { url: `${dev.url}manifest.json`, every: 1e9 });
    assert.deepEqual(await w.check(), ['assets/a.json']); assert.equal(h.value.v, 3); w.stop();
    // a code change tells connected pages to reload
    const events = await fetch(`${dev.url}__dev`);
    const reader = events.body.getReader(); await reader.read();
    dev.changed('main.js');
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /data: reload/);
    await reader.cancel();
  } finally { await dev.close(); p.cleanup(); }
});

test('writable folders: list, read, write (validated, atomic, capped), delete; bad names and other origins are refused', async () => {
  const p = project({ 'index.html': '<html></html>', 'scenes/a.json': '{"n":1}', 'scenes/notes.txt': 'not a scene', 'secret.json': '{}' });
  const dev = await serve({ root: p.root, port: 0, liveReload: false, writable: [{ route: '/__scenes', dir: 'scenes', ext: '.json', maxBytes: 100 }] });
  try {
    const url = (path) => `${dev.url}__scenes${path}`;
    assert.deepEqual((await (await fetch(url('/'))).json()).map((x) => x.name), ['a']);
    assert.deepEqual(await (await fetch(url('/a'))).json(), { n: 1 });
    assert.equal((await fetch(url('/missing'))).status, 404);
    assert.equal((await fetch(url('/b'), { method: 'PUT', body: '{"n":2}' })).status, 204);
    assert.deepEqual(JSON.parse(readFileSync(join(p.root, 'scenes', 'b.json'), 'utf8')), { n: 2 });
    assert.deepEqual(readdirSync(join(p.root, 'scenes')).filter((f) => f.includes('tmp')), [], 'no temporary files are left');
    assert.equal((await fetch(url('/b'), { method: 'PUT', body: '{nope' })).status, 400);
    assert.equal((await fetch(url('/b'), { method: 'PUT', body: JSON.stringify({ big: 'x'.repeat(200) }) })).status, 413);
    for (const bad of ['/..%2Fsecret', '/a.b', '/' + 'x'.repeat(80), '/a%2Fb']) assert.equal((await fetch(url(bad))).status, 400, bad);
    assert.equal((await fetch(url('/a'), { method: 'PUT', body: '{}', headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await fetch(url('/b'), { method: 'DELETE' })).status, 204); assert.ok(!existsSync(join(p.root, 'scenes', 'b.json')));
    assert.equal((await fetch(url('/'), { method: 'POST', body: '{}' })).status, 405);
    assert.equal(readFileSync(join(p.root, 'scenes', 'notes.txt'), 'utf8'), 'not a scene');
  } finally { await dev.close(); p.cleanup(); }
});

test('the dev server tells browsers where @engine/* packages are, and serves them (and only them) from node_modules', async () => {
  const p = project({
    'index.html': '<html><head><title>x</title></head><body></body></html>',
    'node_modules/@engine/alpha/package.json': '{"name":"@engine/alpha"}', 'node_modules/@engine/alpha/src/index.js': "export { b } from '@engine/beta';", 'node_modules/@engine/alpha/src/deep/x.js': 'export const x = 1;',
    'node_modules/@engine/beta/src/index.js': 'export const b = 2;', 'node_modules/leftpad/index.js': 'secret', 'secret.txt': 'no',
  });
  const dev = await serve({ root: p.root, port: 0, liveReload: false });
  try {
    const page = await (await fetch(dev.url)).text();
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(page)[1]);
    assert.deepEqual(map.imports, { '@engine/alpha': '/@modules/@engine/alpha/src/index.js', '@engine/alpha/': '/@modules/@engine/alpha/', '@engine/beta': '/@modules/@engine/beta/src/index.js', '@engine/beta/': '/@modules/@engine/beta/' });
    assert.ok(page.indexOf('importmap') < page.indexOf('<title>'), 'before any script can run');
    const get = (path) => fetch(`${dev.url}${path}`);
    assert.equal(await (await get('@modules/@engine/alpha/src/index.js')).text(), "export { b } from '@engine/beta';");
    assert.equal((await get('@modules/@engine/alpha/src/index.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await get('@modules/@engine/alpha/src/deep/x.js')).status, 200);
    for (const bad of ['@modules/@engine/alpha/../../leftpad/index.js', '@modules/@engine/alpha/%2e%2e/%2e%2e/leftpad/index.js', '@modules/@engine/gamma/src/index.js', '@modules/leftpad/index.js', '@modules/@engine/alpha/src/nothing.js']) assert.ok([403, 404].includes((await get(bad)).status), bad);
    assert.equal((await get('node_modules/leftpad/index.js')).status, 403);
  } finally { await dev.close(); p.cleanup(); }
  const bare = project({ 'index.html': '<html><head></head><body></body></html>' });
  const dev2 = await serve({ root: bare.root, port: 0, liveReload: false });
  try { assert.ok(!(await (await fetch(dev2.url)).text()).includes('importmap'), 'no @engine packages, no import map'); } finally { await dev2.close(); bare.cleanup(); }
});

test('the dev server lets your own handler answer first (an API next to the pages) and can share its HTTP server with a WebSocket listener', async () => {
  const p = project({ 'index.html': '<html><body>page</body></html>' });
  const dev = await serve({ root: p.root, port: 0, liveReload: false, handle: (req, res) => { if (req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"mine":true}'); return true; } return false; } });
  try {
    assert.deepEqual(await (await fetch(`${dev.url}api/x`)).json(), { mine: true });
    assert.ok((await (await fetch(dev.url)).text()).includes('page'));
    assert.equal(typeof dev.server.listen, 'function', 'the http.Server is exposed for upgrades');
  } finally { await dev.close(); p.cleanup(); }
});
