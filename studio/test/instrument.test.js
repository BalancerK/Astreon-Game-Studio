import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentSource, instrumentFiles, findFunctions } from '../app/profile/instrument.js';

const names = (src) => findFunctions(src).map((f) => f.name);

let calls = [];
globalThis.__pf = (name, fn) => { calls.push(name); return fn(); };

/** Run source (which defines `api`) and return it. */
function run(src) {
  calls = [];
  return { api: new Function(`${src}
return api;`)(), get calls() { return calls; } };
}

const SAMPLE = `
function add(a, b) { return a + b; }
const twice = (x) => { return x * 2; };
const obj = {
  scale: 3,
  grow(n) { return n * this.scale; },
  shrink: (n) => { return n / 2; },
  later: async () => { return 1; },
  *gen() { yield 1; },
  get half() { return 0.5; },
};
class Counter {
  constructor() { this.n = 0; }
  bump(by = 1) { this.n += by; return this; }
  static make() { return new Counter(); }
  async slow() { return 2; }
}
function outer(x) { function inner(y) { return y + 1; } return inner(x) * 2; }
function usesArgs() { return arguments.length; }
function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
const text = "function fake() { return 1; }"; // function alsoFake() { }
const tpl = \`\${twice(2)} function nope() { }\`;
const api = { add, twice, obj, Counter, outer, usesArgs, fact, tpl };
`;

test('finds the functions worth timing and leaves the rest alone', () => {
  assert.deepEqual(names(SAMPLE).sort(), ['add', 'bump', 'fact', 'grow', 'inner', 'make', 'outer', 'shrink', 'twice', 'usesArgs'].sort());
});

test('the rewritten code behaves exactly the same: results, this, arguments, recursion, nesting, classes', () => {
  const plain = run(SAMPLE).api;
  const timed = run(instrumentSource(SAMPLE, 'src/main.js').text);
  assert.equal(timed.api.add(2, 3), plain.add(2, 3));
  assert.equal(timed.api.twice(4), 8);
  assert.equal(timed.api.obj.grow(5), 15, 'this is kept');
  assert.equal(timed.api.obj.shrink(8), 4);
  assert.equal(new timed.api.Counter().bump(2).bump().n, 3);
  assert.equal(timed.api.Counter.make().n, 0);
  assert.equal(timed.api.outer(4), 10);
  assert.equal(timed.api.usesArgs(1, 2, 3), 3, 'arguments is kept');
  assert.equal(timed.api.fact(5), 120);
  assert.equal(timed.api.tpl, plain.tpl);
});

test('every timed call is reported under a readable name, recursion included', () => {
  const r = run(instrumentSource(SAMPLE, 'src/enemies.js').text);
  r.calls.length = 0;
  r.api.fact(3);
  r.api.outer(1);
  assert.deepEqual(r.calls, ['enemies:fact', 'enemies:fact', 'enemies:fact', 'enemies:outer', 'enemies:inner']);
});

test('nothing moves: the same number of lines, and every line keeps its own text before the added part', () => {
  const out = instrumentSource(SAMPLE, 'src/main.js').text;
  const a = SAMPLE.split('\n');
  const b = out.split('\n');
  assert.equal(b.length, a.length);
  for (let i = 0; i < a.length; i++) assert.ok(b[i].startsWith(a[i].slice(0, a[i].search(/[{}]/) < 0 ? a[i].length : a[i].search(/[{}]/))), `line ${i + 1}`);
});

test('strings, comments and templates that look like functions are not touched', () => {
  const src = 'const a = "function f() { }";\n// function g() { }\n/* const h = () => { } */\nconst t = `${1} function k() { }`;\nconst api = 1;';
  assert.equal(instrumentSource(src).count, 0);
  assert.equal(instrumentSource(src).text, src);
});

test('only the project\'s own code files under src/ are rewritten', () => {
  const r = instrumentFiles({ 'src/main.js': 'function f() { return 1; }', 'scenes/a.json': '{"a": 1}', 'src/data.js': 'export default { a: 1 };', 'notes.md': 'function g() {}', 'assets/x.png': new Uint8Array(3) });
  assert.equal(r.count, 1);
  assert.match(r.files['src/main.js'], /__pf/);
  assert.equal(r.files['scenes/a.json'], '{"a": 1}');
  assert.equal(r.files['notes.md'], 'function g() {}');
  assert.ok(r.files['assets/x.png'] instanceof Uint8Array);
});

test('a real game file is rewritten into code that still parses', () => {
  const out = instrumentSource('export function update(state, keys, dt) {\n  for (const t of state.things) { if (t.x > 1) { t.x -= dt; } }\n}\nexport const draw = (g, s) => {\n  g.fillRect(0, 0, 1, 1);\n};\n', 'src/main.js').text;
  assert.ok(out.includes('__pf("main:update"') && out.includes('__pf("main:draw"'));
  assert.doesNotThrow(() => new Function(out.replace(/^export /gm, '')));
});
