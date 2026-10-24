import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseManifest, checkManifest, parseRequest, permissionFor, checkFiles, safePath, describePermissions, PERMISSIONS, METHODS, LIMITS } from '../plugins/protocol.js';
import { sandboxDocument, THEME_VARIABLES } from '../plugins/sandbox.js';
import { TEMPLATE } from '../plugins/template.js';

const example = readFileSync(new URL('../plugins/examples/statistics.plugin.js', import.meta.url), 'utf8');
const manifestOf = (obj) => `export const manifest = ${JSON.stringify(obj)};\nexport default function activate() {}`;

test('the manifest is read out of the source without running it, and badly formed ones say what is wrong', () => {
  assert.equal(parseManifest(manifestOf({ id: 'a-b' })).id, 'a-b');
  assert.equal(parseManifest('export const manifest = { "a": "} not the end", "b": { "c": 1 } };\nthrow new Error("never runs");').b.c, 1);
  assert.throws(() => parseManifest('export default function () {}'), /not a plugin/);
  assert.throws(() => parseManifest('export const manifest = 5;'), /plain object/);
  assert.throws(() => parseManifest('export const manifest = { "a": 1'), /not closed/);
  assert.throws(() => parseManifest('export const manifest = { a: 1 };'), /plain JSON/);
  assert.throws(() => parseManifest(undefined), /not a plugin/);
});

test('a manifest is checked and cleaned: ids, names, permissions and what a plugin adds', () => {
  const m = checkManifest({
    id: 'my-plugin', name: ' My plugin ', permissions: ['files.read', 'files.read'], panels: [{ id: 'p', title: 'P', evil: 1 }],
    importers: [{ id: 'i', title: 'I', accept: '.txt,.md' }, { id: 'j', title: 'J', accept: '*/*' }], extra: 'dropped',
  });
  assert.deepEqual(m.permissions, ['files.read']);
  assert.equal(m.name, 'My plugin');
  assert.deepEqual(m.panels, [{ id: 'p', title: 'P' }]);
  assert.equal(m.importers[0].accept, '.txt,.md');
  assert.equal(m.importers[1].accept, '');
  assert.ok(!('extra' in m));
  assert.equal(m.version, '0.0.0');
  const refuses = (raw, re) => assert.throws(() => checkManifest(raw), re);
  refuses(null, /not an object/);
  refuses({ name: 'x' }, /"id"/);
  refuses({ id: 'A', name: 'x' }, /"id"/);
  refuses({ id: 'ok', name: '  ' }, /"name"/);
  refuses({ id: 'ok', name: 'x', permissions: 'files.read' }, /list/);
  refuses({ id: 'ok', name: 'x', permissions: ['network'] }, /not a permission/);
  refuses({ id: 'ok', name: 'x', panels: [{ id: 'a', title: 'a' }, { id: 'a', title: 'b' }] }, /own "id"/);
  refuses({ id: 'ok', name: 'x', panels: [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, title: 'p' })) }, /more than 4/);
  refuses({ id: 'ok', name: 'x', commands: [{ id: 'c' }] }, /"title"/);
  const real = checkManifest(parseManifest(example));
  assert.equal(real.id, 'statistics');
  assert.deepEqual(real.permissions, ['files.read']);
  assert.equal(real.panels.length, 1);
  assert.equal(checkManifest(parseManifest(TEMPLATE)).id, 'my-panel');
  assert.deepEqual(checkManifest(parseManifest(TEMPLATE)).permissions, []);
});

test('every call a plugin makes is checked: only known calls, small arguments, and each call names the permission it needs', () => {
  assert.deepEqual(parseRequest({ v: 1, t: 'call', id: 3, method: 'files.read', args: ['src/main.js'] }), { id: 3, method: 'files.read', args: ['src/main.js'] });
  const call = (extra) => ({ v: 1, t: 'call', id: 1, method: 'log', args: [], ...extra });
  const bad = [
    null, 'x', call({ v: 2 }), call({ t: 'hack' }), call({ id: -1 }), call({ id: 1.5 }), call({ method: 'constructor' }), call({ method: '__proto__' }), call({ method: 'eval' }),
    call({ args: 'x' }), call({ args: [1, 2, 3, 4, 5] }), call({ method: 'files.write', args: ['a', 'x'.repeat(LIMITS.args + 1)] }),
  ];
  for (const b of bad) assert.equal(parseRequest(b), null, JSON.stringify(b)?.slice(0, 60));
  const circular = call({ args: [{}] });
  circular.args[0].self = circular.args[0];
  assert.equal(parseRequest(circular), null, 'something that cannot be sent is refused');
  assert.equal(permissionFor('files.read'), 'files.read');
  assert.equal(permissionFor('files.write'), 'files.write');
  assert.equal(permissionFor('game.summary'), 'game.read');
  assert.equal(permissionFor('log'), null);
  assert.equal(permissionFor('nope'), undefined);
  assert.equal(permissionFor('toString'), undefined);
  for (const need of Object.values(METHODS)) assert.ok(need === null || need in PERMISSIONS, 'every permission a call needs exists');
});

test('what a plugin hands back as files is checked: safe names, text only, bounded', () => {
  assert.deepEqual(checkFiles({ 'a/b.txt': 'x', 'c.md': '' }), { 'a/b.txt': 'x', 'c.md': '' });
  const bad = [null, [], {}, { '../x': 'a' }, { '/abs': 'a' }, { 'a\\b': 'a' }, { 'a//b': 'a' }, { '': 'a' }, { 'a.txt': 5 }, { 'a b!.txt': 'x' }, { ['x'.repeat(201)]: 'a' }, { 'big.txt': 'x'.repeat(LIMITS.fileBytes + 1) }];
  for (const b of bad) assert.throws(() => checkFiles(b));
  assert.throws(() => checkFiles(Object.fromEntries(Array.from({ length: LIMITS.files + 1 }, (_, i) => [`f${i}.txt`, '']))), /more than/);
  assert.equal(safePath('src/main.js'), true);
  assert.equal(safePath('a/../b'), false);
  assert.equal(safePath('.hidden'), true);
  assert.equal(safePath('a/./b'), false);
  assert.equal(safePath(5), false);
});

test('the install question says in plain words what a plugin may do', () => {
  assert.deepEqual(describePermissions({ permissions: [] }), ['nothing: it only shows its own panels and cannot see your project']);
  assert.deepEqual(describePermissions({ permissions: ['files.read', 'files.write'] }), [PERMISSIONS['files.read'], PERMISSIONS['files.write']]);
});

test('the page a plugin runs in forbids every network request, forms and base changes, and holds the library the plugin is given', () => {
  const page = sandboxDocument();
  assert.match(page, /Content-Security-Policy/);
  assert.match(page, /default-src 'none'/);
  assert.match(page, /script-src 'unsafe-inline' blob:/);
  assert.doesNotMatch(page, /connect-src/);
  assert.match(page, /form-action 'none'/);
  assert.match(page, /base-uri 'none'/);
  assert.match(page, /parent\.postMessage/);
  assert.match(page, /event\.source !== parent/);
  assert.match(page, /id="root"/);
  assert.equal((page.match(/<\/script>/g) ?? []).length, 1, 'only the library script, and it cannot end early');
  assert.ok(THEME_VARIABLES.includes('--accent'));
});
