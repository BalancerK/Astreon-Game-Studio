import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskText, indexFile, definitionAt, referencesAt, symbolsOf, planRename, applyEdits, resolveImport, nameAt } from '../app/editing/code-index.js';

const at = (text, marker, nth = 0) => { let i = -1; for (let k = 0; k <= nth; k++) i = text.indexOf(marker, i + 1); return i; };
const rename = (files, path, marker, to, nth = 0) => {
  const plan = planRename(files, path, at(files[path], marker, nth), to);
  return plan.error ? plan : { plan, files: applyEdits(files, plan.edits) };
};

test('masking: strings and comments go blank (same length), code inside a template placeholder stays', () => {
  const src = "const a = 'x'; // note\nconst b = `hi ${a + 1} there`; /* c\nd */ const e = \"q\\\"z\";";
  const m = maskText(src);
  assert.equal(m.length, src.length);
  assert.equal(m.split('\n').length, src.split('\n').length);
  assert.ok(!m.includes('note') && !m.includes('hi ') && !m.includes('there') && !m.includes('"'));
  assert.ok(m.includes('${') === false && m.includes('a + 1'));
});

test('declarations: functions, classes, const/let/var with patterns and several names, parameters, imports', () => {
  const src = [
    "import { a, b as c } from './x.js';", 'import d from "./y.js";', 'export function run(p, { q, r: s = 2 }, ...rest) {}',
    'class Foo {}', 'const [m, [n]] = [1, [2]], k = 3, { u, v: w } = o;', 'let z;', 'const f = (e1, e2) => e1 + e2;', 'try {} catch (err) {}',
    'for (const item of list) {}',
  ].join('\n');
  const ix = indexFile(src);
  const names = (kind) => ix.decls.filter((x) => x.kind === kind).map((x) => x.name).sort();
  assert.deepEqual(names('import'), ['a', 'c', 'd']);
  assert.deepEqual(names('function'), ['run']);
  assert.deepEqual(names('class'), ['Foo']);
  assert.deepEqual(names('variable'), ['f', 'item', 'k', 'm', 'n', 'u', 'w', 'z']);
  assert.deepEqual(names('parameter'), ['e1', 'e2', 'err', 'p', 'q', 'rest', 's']);
  assert.equal(ix.decls.find((x) => x.name === 'run').exported, true);
});

test('what a name means depends on the scope: a parameter or local is not the top-level name', () => {
  const src = 'const speed = 1;\nfunction f(speed) { return speed * 2; }\nfunction g() { const speed = 5; return speed; }\nfunction h() { return speed; }\n';
  const files = { 'a.js': src };
  const refs = referencesAt(files, 'a.js', at(src, 'speed'));
  assert.deepEqual(refs.uses.map((u) => u.line), [1, 4]);                           // the top-level one and the use in h
  const inF = referencesAt(files, 'a.js', at(src, 'speed', 1));
  assert.deepEqual(inF.uses.map((u) => u.line), [2, 2]);                            // the parameter and its use
  const inG = referencesAt(files, 'a.js', at(src, 'speed', 3));
  assert.deepEqual(inG.uses.map((u) => u.line), [3, 3]);
  assert.equal(definitionAt(files, 'a.js', at(src, 'speed', 4)).line, 3);
});

test('member names and object keys are not uses of the variable; shorthand is', () => {
  const src = 'const x = 1;\nconst o = { x: 2, y: x };\nconst p = { x };\nconsole.log(o.x, p.x, x);\nconst t = `${x} and x`;\n';
  const files = { 'a.js': src };
  const refs = referencesAt(files, 'a.js', 6);
  assert.deepEqual(refs.uses.map((u) => `${u.line}${u.shorthand ? 's' : ''}`), ['1', '2', '3s', '4', '5']);
  const done = rename(files, 'a.js', 'x', 'size');
  assert.equal(done.files['a.js'], 'const size = 1;\nconst o = { x: 2, y: size };\nconst p = { x: size };\nconsole.log(o.x, p.x, size);\nconst t = `${size} and x`;\n');
});

test('definitions follow imports into the project, and say when a name comes from a package', () => {
  const files = {
    'src/main.js': "import { newGame, hero as player } from '@engine/arcade';\nimport { speed, helper as h2 } from './util.js';\nimport * as u from './util.js';\nspeed + h2() + player;\n",
    'src/util.js': 'export const speed = 3;\nexport function helper() { return speed; }\n',
  };
  const m = files['src/main.js'];
  const d = definitionAt(files, 'src/main.js', at(m, 'speed', 1));
  assert.deepEqual([d.kind, d.path, d.line, d.declKind], ['local', 'src/util.js', 1, 'variable']);
  const viaAlias = definitionAt(files, 'src/main.js', at(m, 'h2', 1));
  assert.deepEqual([viaAlias.path, viaAlias.line], ['src/util.js', 2]);
  const fromSpecifier = definitionAt(files, 'src/main.js', at(m, 'speed'));
  assert.equal(fromSpecifier.path, 'src/util.js');
  const ext = definitionAt(files, 'src/main.js', at(m, 'player', 1));
  assert.deepEqual([ext.kind, ext.source, ext.name], ['external', '@engine/arcade', 'hero']);
  assert.equal(definitionAt(files, 'src/main.js', at(m, 'nowhere') + 1), null);
  assert.equal(resolveImport(files, 'src/main.js', './util'), 'src/util.js');
  assert.equal(resolveImport(files, 'src/main.js', '../src/util.js'), 'src/util.js');
  assert.equal(resolveImport(files, 'src/main.js', '@engine/arcade'), null);
});

test('renaming an exported name changes its declaration, its importers and their uses, but not an alias\'s uses', () => {
  const files = {
    'src/main.js': "import { speed, helper as h2 } from './util.js';\nspeed + h2();\n",
    'src/other.js': "import { speed as s } from './util.js';\nexport const t = s;\n",
    'src/util.js': 'export const speed = 3;\nexport function helper() { return speed; }\n',
  };
  const done = rename(files, 'src/util.js', 'speed', 'pace');
  assert.deepEqual(done.plan.clashes, []);
  assert.equal(done.plan.files, 3);
  assert.equal(done.files['src/main.js'], "import { pace, helper as h2 } from './util.js';\npace + h2();\n");
  assert.equal(done.files['src/other.js'], "import { pace as s } from './util.js';\nexport const t = s;\n");
  assert.equal(done.files['src/util.js'], 'export const pace = 3;\nexport function helper() { return pace; }\n');
  // starting from a use in another file works too
  const again = rename(files, 'src/main.js', 'speed', 'pace', 1);
  assert.equal(again.files['src/util.js'], done.files['src/util.js']);
  // a name listed with `export { }`
  const list = { 'a.js': 'function go() {}\ngo();\nexport { go };\n', 'b.js': "import { go } from './a.js';\ngo();\n" };
  const r = rename(list, 'a.js', 'go', 'start');
  assert.equal(r.files['a.js'], 'function start() {}\nstart();\nexport { start };\n');
  assert.equal(r.files['b.js'], "import { start } from './a.js';\nstart();\n");
  const alias = rename({ 'a.js': 'function go() {}\nexport { go as run };\n', 'b.js': "import { run } from './a.js';\nrun();\n" }, 'a.js', 'go', 'start');
  assert.equal(alias.files['a.js'], 'function start() {}\nexport { start as run };\n');
  assert.equal(alias.plan.files, 1);
});

test('a rename that would clash is reported, and bad names are refused', () => {
  const files = { 'a.js': 'const a = 1;\nconst b = 2;\nfunction f() { const c = 3; return a + c; }\n' };
  assert.ok(rename(files, 'a.js', 'a', 'b').plan.clashes.length > 0);
  assert.ok(rename(files, 'a.js', 'a', 'c').plan.clashes.length > 0);                        // the use inside f would turn into the local c
  assert.deepEqual(rename(files, 'a.js', 'a', 'fine').plan.clashes, []);
  assert.match(rename(files, 'a.js', 'a', '1x').error, /starts with a letter/);
  assert.match(rename(files, 'a.js', 'a', 'class').error, /keeps for itself/);
  assert.match(rename(files, 'a.js', 'a', 'a').error, /already has/);
  assert.match(planRename({ 'a.js': "import { hero } from '@engine/arcade';\nhero;" }, 'a.js', 39, 'x').error, /comes from @engine\/arcade/);
  assert.match(planRename(files, 'a.js', files['a.js'].indexOf('1'), 'x').error, /Nothing here/);
});

test('methods and arrow functions have their own parameters', () => {
  const src = 'const dt = 1;\nclass A { update(dt) { return dt; } }\nconst f = (dt) => dt + 1;\nconst g = dt => dt;\nuse(dt);\n';
  const refs = referencesAt({ 'a.js': src }, 'a.js', 6);
  assert.deepEqual(refs.uses.map((u) => u.line), [1, 5]);
});

test('symbols: the top-level things of a file, in order, and the word under the cursor', () => {
  const files = { 'a.js': "import { x } from './b.js';\nexport function run() {}\nconst LIMIT = 3, other = 4;\nclass Boss {}\nfunction inner() { const hidden = 1; }\n" };
  assert.deepEqual(symbolsOf(files, 'a.js').map((s) => `${s.kind}:${s.name}:${s.line}`), ['function:run:2', 'variable:LIMIT:3', 'variable:other:3', 'class:Boss:4', 'function:inner:5']);
  assert.deepEqual(nameAt('let speed = 1;', 6), { name: 'speed', from: 4, to: 9 });
  assert.equal(nameAt('a + 1', 2), null);
});

test('it never throws on broken or odd text', () => {
  for (const src of ['', 'function (', 'const {', 'class', '`unclosed ${', '/* open', "'str", 'a => ', 'for (', 'import {', 'export { a', '}}}{{{', 'const x = ;;; = =']) {
    assert.doesNotThrow(() => { const ix = indexFile(src); definitionAt({ 'a.js': src }, 'a.js', 1); referencesAt({ 'a.js': src }, 'a.js', 1); void ix; });
  }
});

test('the studio\'s own starting games can be read: every declared name has a definition, and renaming the first constant is clean', async () => {
  const { TEMPLATES } = await import('../app/store/templates.js');
  for (const [name, t] of Object.entries(TEMPLATES)) {
    const files = Object.fromEntries(Object.entries(t.files).filter(([, v]) => typeof v === 'string'));
    for (const path of Object.keys(files)) {
      if (!path.endsWith('.js')) continue;
      for (const s of symbolsOf(files, path)) {
        const d = definitionAt(files, path, s.index);
        assert.equal(d?.index, s.index, `${name}/${path}: ${s.name}`);
        const r = referencesAt(files, path, s.index);
        assert.ok(r.uses.length >= 1, `${name}/${path}: ${s.name} has a use`);
      }
    }
  }
});

const NL = String.fromCharCode(10);
const lines = (...l) => l.join(NL) + NL;

test('names used through a namespace import (import * as ns) are found, defined and renamed with the export', () => {
  const files = {
    'src/util.js': lines('export const speed = 3;', 'export function helper() { return speed; }'),
    'src/main.js': lines("import * as u from './util.js';", 'const a = u.speed + u.helper();', 'const speed = 9;', 'u.speed + speed;'),
  };
  const m = files['src/main.js'];
  const def = definitionAt(files, 'src/main.js', at(m, 'u.speed') + 3);
  assert.deepEqual([def.kind, def.path, def.line], ['local', 'src/util.js', 1]);
  const refs = referencesAt(files, 'src/util.js', at(files['src/util.js'], 'speed') + 1);
  assert.deepEqual(refs.uses.map((u) => `${u.path}:${u.line}:${u.role}`), ['src/main.js:2:member', 'src/main.js:4:member', 'src/util.js:1:declaration', 'src/util.js:2:use']);
  const done = rename(files, 'src/util.js', 'speed', 'pace');
  assert.equal(done.files['src/main.js'], lines("import * as u from './util.js';", 'const a = u.pace + u.helper();', 'const speed = 9;', 'u.pace + speed;'));
  assert.equal(done.files['src/util.js'], lines('export const pace = 3;', 'export function helper() { return pace; }'));
  const fromUse = rename(files, 'src/main.js', 'u.speed', 'pace', 0);
  assert.equal(fromUse.plan.name, 'u', 'the cursor on the namespace itself renames the namespace, not the export');
  const clash = planRename(files, 'src/util.js', at(files['src/util.js'], 'speed') + 1, 'helper');
  assert.ok(clash.clashes.length > 0);
});

test('a class\'s methods and properties are found through this, inside the class only', () => {
  const src = lines('class Ship {', '  constructor() { this.speed = 1; this.fire(); }', '  fire() { return this.speed; }', '  go() { this.fire(); this.speed++; }', '}', 'const fire = 1;', 'fire;');
  const files = { 'a.js': src };
  const refs = referencesAt(files, 'a.js', at(src, 'fire()', 1) + 1);
  assert.deepEqual(refs.uses.map((u) => `${u.line}:${u.role}`), ['2:member', '3:declaration', '4:member'], 'the plain variable called fire is not one of them');
  assert.equal(refs.scope, 'the class Ship');
  const def = definitionAt(files, 'a.js', at(src, 'this.fire()') + 6);
  assert.deepEqual([def.line, def.declKind], [3, 'method']);
  const prop = definitionAt(files, 'a.js', at(src, 'this.speed;') + 6);
  assert.deepEqual([prop.line, prop.declKind], [2, 'property']);
  const done = rename(files, 'a.js', 'fire() {', 'shoot');
  assert.equal(done.files['a.js'], lines('class Ship {', '  constructor() { this.speed = 1; this.shoot(); }', '  shoot() { return this.speed; }', '  go() { this.shoot(); this.speed++; }', '}', 'const fire = 1;', 'fire;'));
  const speed = rename(files, 'a.js', 'speed++', 'velocity', 0);
  assert.equal(speed.plan.edits.length, 3, 'every this.speed in the class');
  const clash = planRename(files, 'a.js', at(src, 'fire() {'), 'go');
  assert.match(clash.clashes[0], /Ship already has a method called go/);
});

test('names re-exported with export * are followed to where they are declared', () => {
  const files = {
    'src/all.js': lines("export * from './a.js';", "export * from './b.js';"),
    'src/a.js': lines('export const A = 1;'), 'src/b.js': lines('export function B() {}'),
    'src/main.js': lines("import { A, B } from './all.js';", 'A; B();'),
  };
  assert.equal(definitionAt(files, 'src/main.js', at(files['src/main.js'], 'A, ') ).path, 'src/a.js');
  assert.equal(definitionAt(files, 'src/main.js', at(files['src/main.js'], 'B()')).path, 'src/b.js');
});

test('a method called on a variable made with new is found across files; a variable of unknown kind is left alone', () => {
  const files = {
    'src/ship.js': lines('export class Ship {', '  fire() { return 1; }', '  go() { return this.fire(); }', '}'),
    'src/main.js': lines("import { Ship } from './ship.js';", 'const ship = new Ship();', 'ship.fire();',
      'function f() { const other = new Ship(); return other.fire(); }', 'const x = makeShip();', 'x.fire();'),
  };
  const refs = referencesAt(files, 'src/ship.js', at(files['src/ship.js'], 'fire') + 1);
  assert.deepEqual(refs.uses.map((u) => `${u.path}:${u.line}`), ['src/main.js:3', 'src/main.js:4', 'src/ship.js:2', 'src/ship.js:3'], 'x.fire() is not one of them: nothing says what x is');
  const def = definitionAt(files, 'src/main.js', at(files['src/main.js'], 'ship.fire') + 6);
  assert.deepEqual([def.path, def.line, def.declKind], ['src/ship.js', 2, 'method']);
  const fromUse = referencesAt(files, 'src/main.js', at(files['src/main.js'], 'other.fire') + 8);
  assert.equal(fromUse.uses.length, 4);
  const plan = planRename(files, 'src/main.js', at(files['src/main.js'], 'ship.fire') + 6, 'shoot');
  assert.equal(plan.files, 2);
  const out = applyEdits(files, plan.edits);
  assert.ok(out['src/main.js'].includes('ship.shoot();') && out['src/main.js'].includes('other.shoot()') && out['src/main.js'].includes('x.fire();'));
  assert.ok(out['src/ship.js'].includes('shoot() { return 1; }') && out['src/ship.js'].includes('this.shoot()'));
  assert.equal(definitionAt(files, 'src/main.js', at(files['src/main.js'], 'x.fire') + 2), null, 'what makeShip returns is not known');
});
