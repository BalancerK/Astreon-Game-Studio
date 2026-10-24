import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionsAt, acceptEdit, addImport, importedNames, declaredNames, callContext, describe } from '../app/editing/complete.js';
import { findAll, replaceAll, nextIndex, toLineRanges, compile, MAX_MATCHES } from '../app/editing/find.js';
import { explain, editDistance, closest } from '../app/editing/friendly.js';
import { API } from '../app/data/api-index.js';

const at = (source, opts) => { const pos = source.indexOf('|'); const text = source.replace('|', ''); return { text, pos, r: completionsAt(text, pos, API, opts) }; };
const labels = (r) => r?.items.map((i) => i.label) ?? [];
const apply = (text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to);

test('the API index covers the engine, and describes names from it', () => {
  assert.ok(Object.keys(API.packages).length >= 20); assert.ok(API.packages.math.exports.some((e) => e.n === 'PI'));
  const d = describe("import { PI } from '@engine/math';", 'PI', API); assert.equal(d.pkg, 'math'); assert.equal(d.kind, 'constant'); assert.match(d.doc, /π/); assert.equal(describe('', 'NoSuchThing', API), null);
});

test('imports: read, add to an existing line, add a new line after the others, never twice', () => {
  const src = "import { sin } from '@engine/math';\nimport { x as y } from '@engine/ecs';\nlet a;";
  assert.deepEqual([...importedNames(src)], [['sin', { pkg: 'math', name: 'sin' }], ['y', { pkg: 'ecs', name: 'x' }]]);
  assert.equal(apply(src, addImport(src, 'cos', 'math')), "import { sin, cos } from '@engine/math';\nimport { x as y } from '@engine/ecs';\nlet a;");
  assert.equal(apply(src, addImport(src, 'Foo', 'input')), "import { sin } from '@engine/math';\nimport { x as y } from '@engine/ecs';\nimport { Foo } from '@engine/input';\nlet a;");
  assert.equal(apply('let a;', addImport('let a;', 'PI', 'math')), "import { PI } from '@engine/math';\n\nlet a;"); assert.equal(apply('', addImport('', 'PI', 'math')), "import { PI } from '@engine/math';\n");
  assert.equal(apply(src, addImport(src, 'sin', 'math')), src, 'already imported: no change'); assert.equal(apply('import {sin} from "@engine/math"', addImport('import {sin} from "@engine/math"', 'cos', 'math')), 'import {sin, cos} from "@engine/math"');
  assert.deepEqual(declaredNames('const a = 1; let b; function c() {} class D {} const a = 2;'), ['a', 'b', 'c', 'D']);
});

test('completions: your own names first, then imported, then the whole engine (which brings its import along)', () => {
  const t1 = at("import { sin } from '@engine/math';\nconst speed = 3;\nsp|"); assert.equal(labels(t1.r)[0], 'speed');
  const t2 = at("import { sin } from '@engine/math';\nsi|"); assert.equal(labels(t2.r)[0], 'sin'); assert.equal(t2.r.items[0].source, 'imported');
  const t3 = at('const w = new Wor|'); const vec = t3.r.items.find((i) => i.label === 'World'); assert.ok(vec, 'World from the engine'); assert.equal(vec.source, 'engine'); assert.equal(vec.pkg, 'core');
  const e = acceptEdit(t3.text, t3.r, vec); assert.equal(apply(t3.text, e), "import { World } from '@engine/core';\n\nconst w = new World"); assert.equal(e.head, apply(t3.text, e).length, 'the caret ends after the name');
  assert.equal(at('|').r, null, 'nothing typed: nothing offered'); assert.equal(at('const x = 12|').r, null, 'not after a number');
  assert.equal(at('zzzqqq|').r, null, 'nothing close: no list');
});

test('completions: a function gets its bracket, an exact match is not offered back, and the list is short', () => {
  const t = at('co|'); assert.ok(t.r.items.length <= 12); assert.ok(!labels(t.r).includes('co'));
  const fn = t.r.items.find((i) => i.kind === 'function' && i.source === 'engine'); if (fn) assert.ok(acceptEdit(t.text, t.r, fn).insert.endsWith('('));
  const already = at("import { sin } from '@engine/math';\nsi|(1)"); const sin = already.r.items.find((i) => i.label === 'sin'); assert.ok(!acceptEdit(already.text, already.r, sin).insert.endsWith('(('), 'no second bracket');
});

test('completions after a dot come from the thing the variable was made from', () => {
  const t = at("import { World } from '@engine/core';\nconst w = new World();\nw.|"); assert.ok(t.r, 'members of World'); assert.ok(t.r.items.every((i) => i.source === 'member'));
  assert.ok(t.r.items.every((i) => ['method', 'property'].includes(i.kind)));
  const u = at('const o = {};\no.alpha = 1;\no.al|'); assert.deepEqual(labels(u.r), ['alpha'], 'unknown things fall back to names used after a dot in this file');
});

test('completions inside import lines: package names after @engine/, exports inside the braces', () => {
  const p = at("import { x } from '@engine/ma|"); assert.ok(labels(p.r).includes('math')); assert.equal(apply(p.text, acceptEdit(p.text, p.r, p.r.items.find((i) => i.label === 'math'))), "import { x } from '@engine/math");
  const b = at("import { si| } from '@engine/math';"); assert.ok(labels(b.r).includes('sin')); assert.ok(b.r.items.every((i) => i.pkg === 'math'), 'only that package');
  assert.equal(apply(b.text, acceptEdit(b.text, b.r, b.r.items.find((i) => i.label === 'sin'))), "import { sin } from '@engine/math';", 'no second import line inside an import');
  const any = at('import { Worl| }'); assert.ok(any.r.items.some((i) => i.label === 'World'), 'package unknown: search them all');
});

test('which call is the caret inside, and which argument', () => {
  const ctx = (s) => { const p = s.indexOf('|'); return callContext(s.replace('|', ''), p); };
  assert.deepEqual(ctx('move(a, |'), { name: 'move', index: 1 }); assert.deepEqual(ctx('move(|'), { name: 'move', index: 0 }); assert.deepEqual(ctx('f(g(1, 2), |)'), { name: 'f', index: 1 });
  assert.deepEqual(ctx('f(g(1, |2))'), { name: 'g', index: 1 }); assert.equal(ctx('f([1, 2], {a: 1, |b: 2})'), null, 'inside braces is not an argument position');
  assert.equal(ctx('if (a|'), null, 'keywords are not calls'); assert.equal(ctx('x = 1; |'), null); assert.equal(ctx('f(a); |'), null); assert.equal(ctx('(a, |'), null);
});

test('find: plain text, whole words, case, patterns; an invalid pattern gives a message; huge match counts are capped', () => {
  const text = 'Cat cat concat CAT\ncat';
  assert.equal(findAll(text, 'cat').matches.length, 5); assert.equal(findAll(text, 'cat', { caseSensitive: true }).matches.length, 3); assert.equal(findAll(text, 'cat', { wholeWord: true }).matches.length, 4);
  assert.equal(findAll('a.b a+b', 'a.b').matches.length, 1, 'plain text is literal, not a pattern'); assert.equal(findAll('a.b axb', 'a.b', { regex: true }).matches.length, 2);
  const bad = findAll('x', '(', { regex: true }); assert.equal(bad.matches.length, 0); assert.ok(bad.error.length > 0); assert.deepEqual(findAll('x', ''), { matches: [], error: '' });
  assert.equal(findAll('abc', 'x*', { regex: true }).matches.length, 0, 'empty matches are skipped'); const big = findAll('a'.repeat(MAX_MATCHES + 50), 'a'); assert.equal(big.matches.length, MAX_MATCHES); assert.equal(big.capped, true);
  assert.ok(compile('é').re.test('É'), 'case is ignored for accented letters too'); assert.equal(findAll('a\nb', '^b', { regex: true }).matches.length, 1, '^ matches at the start of a line');
});

test('find: next and previous wrap round; replace keeps everything else; patterns can use $1', () => {
  const m = [{ from: 2, to: 4 }, { from: 10, to: 12 }];
  assert.equal(nextIndex(m, 0), 0); assert.equal(nextIndex(m, 3), 1); assert.equal(nextIndex(m, 11), 0, 'wraps'); assert.equal(nextIndex(m, 20, -1), 1); assert.equal(nextIndex(m, 2, -1), 1, 'wraps backwards'); assert.equal(nextIndex([], 0), -1);
  assert.deepEqual(replaceAll('a cat, a Cat', 'cat', 'dog'), { text: 'a dog, a dog', count: 2 }); assert.deepEqual(replaceAll('x', 'y', 'z'), { text: 'x', count: 0 });
  assert.equal(replaceAll('a1 b2', '([a-z])(\\d)', '$2$1', { regex: true }).text, '1a 2b'); assert.equal(replaceAll('a1', 'a', '$&$&').text, '$&$&1', 'plain replacements are literal');
  assert.deepEqual(toLineRanges('ab\ncd\nef', [{ from: 1, to: 4 }, { from: 6, to: 8 }]), [{ line: 0, from: 1, to: 2 }, { line: 1, from: 0, to: 1 }, { line: 2, from: 0, to: 2 }]);
});

test('friendly errors explain the browser message in plain words and suggest the likely fix', () => {
  const known = ['speed', 'position', 'Vec2', 'update'];
  assert.match(explain('SyntaxError: Unexpected end of input').text, /stops before it is finished/); assert.match(explain("Unexpected token '}'").text, /does not belong/);
  assert.match(explain('Uncaught ReferenceError: positon is not defined', known).hint, /Did you mean "position"\?/); assert.equal(explain('spede is not defined', known).suggestion, 'speed');
  assert.equal(explain('qqqqqq is not defined', known).suggestion, null); assert.match(explain("Cannot read properties of undefined (reading 'x')").text, /undefined.*"x"/);
  assert.match(explain("Identifier 'a' has already been declared").text, /twice/); assert.match(explain('Assignment to constant variable.').hint, /let/); assert.match(explain('foo.bar is not a function').text, /foo\.bar/);
  assert.match(explain("The requested module './x.js' does not provide an export named 'Foo'", known).text, /"Foo"/); assert.match(explain('Maximum call stack size exceeded').text, /calling itself/);
  const unknown = explain('Something nobody has seen'); assert.equal(unknown.text, ''); assert.equal(unknown.message, 'Something nobody has seen', 'unrecognised messages pass through unchanged');
  assert.equal(explain(undefined).message, ''); assert.equal(explain(null, null).text, '');
});

test('edit distance and the closest name', () => {
  assert.equal(editDistance('speed', 'speed'), 0); assert.equal(editDistance('speed', 'sped'), 1); assert.equal(editDistance('abc', 'xyzxyz'), 4, 'too different: over the cap'); assert.ok(editDistance('Speed', 'speed') < 1, 'case is a small difference');
  assert.equal(closest('positon', ['position', 'rotation']), 'position'); assert.equal(closest('abc', ['xyz']), null); assert.equal(closest('cat', ['cat']), null, 'the same word is not a suggestion'); assert.equal(closest('ab', ['abcdef']), null);
});
