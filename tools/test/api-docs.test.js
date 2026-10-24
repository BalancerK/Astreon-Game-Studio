import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsDoc, analyzeSource, publicApi, buildModel, coverage, packageMarkdown, indexMarkdown, renderHtml, checkAll, undocumented, headerComment } from '../api-docs-lib.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('JSDoc comments: description, parameters (types with braces, optional, defaults, nested), returns, typedefs, examples, hidden things', () => {
  const d = parseJsDoc(`/**
   * Move a box.
   * Slides along walls; see \`@engine/physics\` for more.
   *
   * @param {{x: number, y: number}} box The box.
   * @param {number} [dt=0.016] Seconds.
   * @param {object} [o]
   * @param {Record<string, {a: number}>} [o.map] A map - with a dash.
   * @param {...number} rest Extra numbers.
   * @returns {boolean} true if it moved
   * @throws {Error} when the box is NaN
   * @example
   * move({ x: 1, y: 2 });
   * @deprecated use slide()
   */`);
  assert.equal(d.description, 'Move a box.\nSlides along walls; see `@engine/physics` for more.');
  assert.deepEqual(d.params.map((p) => [p.name, p.type, p.optional, p.default]), [['box', '{x: number, y: number}', false, undefined], ['dt', 'number', true, '0.016'], ['o', 'object', true, undefined], ['o.map', 'Record<string, {a: number}>', true, undefined], ['...rest', 'number', false, undefined]]);
  assert.equal(d.params[3].description, 'A map - with a dash.'); assert.equal(d.params[0].description, 'The box.');
  assert.deepEqual(d.returns, { type: 'boolean', description: 'true if it moved' });
  assert.deepEqual(d.throws, ['when the box is NaN']); assert.deepEqual(d.examples, ['move({ x: 1, y: 2 });']); assert.equal(d.deprecated, 'use slide()');
  const t = parseJsDoc('/** @typedef {object} Hit A hit.\n * @property {number} x Where.\n * @property {boolean} [solid] Is it. */');
  assert.deepEqual(t.typedefs, [{ name: 'Hit', type: 'object', description: 'A hit.' }]); assert.equal(t.properties.length, 2); assert.equal(t.properties[1].optional, true);
  const one = parseJsDoc('/** @param {string} source @param {string} file The path @internal */');
  assert.deepEqual(one.params.map((p) => p.name), ['source', 'file']); assert.equal(one.internal, true);
  assert.equal(parseJsDoc('/** just text */').description, 'just text');
});

test('source files: functions, classes and their members, constants, groups of constants, typedefs, exports; strings and comments are not code', () => {
  const src = [
    '// header comment',
    '/** Adds. */',
    'export function add(a, b = 2) { return a + b; }',
    '/** Loads things. @param {string} url */',
    'export async function load(url) { return url; }',
    '/** A pool. */',
    'export class Pool extends Base {',
    '  /** @param {number} n How many. */',
    '  constructor(n) { super(); this.n = n; }',
    '  /** Take one. */',
    '  take(k = 1) { if (k) { return 1; } for (const x of []) {} return 0; }',
    '  static make() { return new Pool(1); }',
    '  get size() { return 1; }',
    '  _hidden() {}',
    '  #secret() {}',
    '  /** @internal */ internal() {}',
    '}',
    '/** Pi-ish and friends. */',
    'export const A = 1, B = [1, 2, 3], C = { x: 1 };',
    '/** An arrow. */',
    'export const twice = (v) => v * 2;',
    'const text = "export function notReal() {}"; // export class Fake',
    '/* export function alsoNot() {} */',
    '/** @typedef {object} Opts The options. @property {number} n How many. */',
    'export { add as plus };',
    'function local() {}',
  ].join('\n');
  const a = analyzeSource(src, 'src/x.js');
  assert.deepEqual([...a.exported.keys()].sort(), ['A', 'B', 'C', 'Pool', 'add', 'load', 'plus', 'twice']);
  assert.equal(a.decls.get('add').signature, 'function add(a, b = 2)'); assert.equal(a.decls.get('add').doc.description, 'Adds.');
  assert.equal(a.decls.get('load').signature, 'async function load(url)'); assert.equal(a.decls.get('load').doc.params[0].name, 'url');
  const pool = a.decls.get('Pool');
  assert.equal(pool.signature, 'class Pool extends Base'); assert.equal(pool.extends, 'Base');
  assert.deepEqual(pool.members.map((m) => `${m.kind}:${m.name}`), ['constructor:constructor', 'method:take', 'static method:make', 'getter:size'], 'no private, underscore or internal members, nothing from inside method bodies');
  assert.equal(pool.members[1].signature, 'take(k = 1)'); assert.equal(pool.members[0].doc.params[0].description, 'How many.');
  for (const n of ['A', 'B', 'C']) assert.equal(a.decls.get(n).doc.description, 'Pi-ish and friends.', `${n} shares the comment`);
  assert.equal(a.decls.get('twice').kind, 'function'); assert.equal(a.decls.get('twice').signature, 'function twice(v)');
  assert.ok(!a.decls.has('notReal') && !a.decls.has('Fake') && !a.decls.has('alsoNot'));
  assert.equal(a.typedefs[0].name, 'Opts'); assert.equal(a.typedefs[0].properties[0].name, 'n');
});

test('a package\'s public API follows re-exports to where things are defined, including aliases, export * and namespaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apidocs-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), "export { alpha, beta as b } from './a.js';\nexport * from './b.js';\nexport * as vec from './vec.js';\nexport const direct = 1;\nexport { hidden } from './a.js';\n");
    writeFileSync(join(dir, 'src', 'a.js'), '/** The first. */\nexport function alpha() {}\nexport const beta = () => 1;\n/** @internal */\nexport function hidden() {}\n');
    writeFileSync(join(dir, 'src', 'b.js'), '/** A class. */\nexport class Thing {\n  /** Do it. */\n  go() {}\n}\n/** @typedef {object} Cfg The config. */\n');
    writeFileSync(join(dir, 'src', 'vec.js'), '// Vectors as arrays.\n/** out = a + b */\nexport const add = (out, a, b) => out;\n');
    const api = publicApi(dir);
    assert.deepEqual(api.map((e) => `${e.kind}:${e.name}`), ['class:Thing', 'function:alpha', 'function:b', 'constant:direct', 'namespace:vec', 'types:(types)']);
    assert.equal(api[1].doc.description, 'The first.'); assert.equal(api[2].signature, 'function b()', 'the alias is the exported name');
    assert.equal(api.find((e) => e.name === 'vec').entries[0].doc.description, 'out = a + b');
    assert.equal(api.find((e) => e.name === 'vec').doc.description, 'Vectors as arrays.');
    assert.equal(api.find((e) => e.name === 'Thing').members[0].doc.description, 'Do it.');
    assert.equal(api.at(-1).types[0].name, 'Cfg');
    assert.equal(headerComment('#!/usr/bin/env node\n// one\n// two\n\nconst x = 1;'.replace('#!/usr/bin/env node\n', '')), 'one two');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the Markdown and HTML pages: contents, signatures in code blocks, tables escaped, no markup injected', () => {
  const pkg = { name: 'demo', title: '@engine/demo', version: '1.2.3', description: 'A demo', bin: null, api: [
    { name: 'run', kind: 'function', signature: 'function run(a, b)', members: [], file: 'src/x.js', line: 3, doc: { description: 'Runs <b>things</b> | fast.\n\nSecond paragraph.', params: [{ name: 'a', type: 'number | string', optional: false, description: 'the | pipe' }], returns: { type: 'void', description: 'nothing' }, properties: [], examples: ['run(1, 2);'], throws: [], deprecated: null, internal: false } },
    { name: 'Gadget', kind: 'class', signature: 'class Gadget', members: [{ name: 'spin', kind: 'method', signature: 'spin(speed)', doc: { description: 'Spin it.', params: [], returns: null }, file: 'src/x.js', line: 9 }], file: 'src/x.js', line: 8, doc: { description: 'A gadget.', params: [], returns: null, properties: [], examples: [], throws: [], deprecated: 'use Widget', internal: false } },
  ] };
  const md = packageMarkdown(pkg);
  assert.match(md, /^# @engine\/demo\n\nA demo\./); assert.match(md, /npm install @engine\/demo/); assert.match(md, /## Contents \(2 of 2 documented\)/);
  assert.match(md, /\| \[`Gadget`\]\(#class-gadget\) \| class \| A gadget\. \|/); assert.match(md, /### `run`\n\n```js\nfunction run\(a, b\)\n```/);
  assert.match(md, /`a` \| `number \\\| string` \| the \\\| pipe/, 'pipes inside table cells are escaped');
  assert.match(md, /#### `Gadget.spin`/); assert.match(md, /> \*\*Deprecated:\*\* use Widget/); assert.match(md, /\*\*Example\*\*\n\n```js\nrun\(1, 2\);\n```/);
  const html = renderHtml({ packages: [pkg] });
  assert.ok(!html.includes('<b>things</b>'), 'markup in comments is escaped'); assert.match(html, /Runs &lt;b&gt;things&lt;\/b&gt;/);
  assert.match(html, /<input id="q"/); assert.match(html, /id="demo\.run"/);
  assert.match(indexMarkdown({ packages: [pkg] }), /\| \[`@engine\/demo`\]\(demo\.md\) \| A demo \| 2 \| 100% \|/);
});

test('the real reference: every package has a page, every export is documented, and docs/api is up to date', () => {
  const model = buildModel(ROOT);
  assert.ok(model.packages.length >= 23);
  assert.deepEqual(undocumented(ROOT), [], 'add a /** description */ above each of these exports');
  assert.deepEqual(checkAll(ROOT), [], 'docs/api is out of date: run npm run docs');
  const core = model.packages.find((p) => p.name === 'core');
  assert.ok(core.api.some((e) => e.name === 'FixedLoop' && e.kind === 'class' && e.members.some((m) => m.name === 'advance')));
  const math = model.packages.find((p) => p.name === 'math');
  assert.ok(math.api.some((e) => e.kind === 'namespace' && e.name === 'vec3' && e.entries.length > 10));
  assert.equal(coverage(core).missing.length, 0);
});
