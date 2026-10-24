import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { writeZip, readZip, crc32, safeEntryName } from '../app/store/zip.js';
import { MemoryBackend } from '../app/store/backends.js';
import { ProjectStore, Project, pathProblem, LIMITS, StoreError } from '../app/store/project-store.js';
import { TEMPLATES } from '../app/store/templates.js';
import { resolveImports } from '../runner/resolve-imports.js';

const bytes = (s) => new TextEncoder().encode(s);
const text = (b) => new TextDecoder().decode(b);
/** A store whose clock moves one minute with every look, and whose ids count up, so tests are exact. */
function fresh() {
  let t = Date.UTC(2026, 0, 1); let n = 0;
  const backend = new MemoryBackend();
  return { backend, store: new ProjectStore(backend, { now: () => (t += 60_000), newId: () => `id${String(++n).padStart(4, '0')}` }), tick: (ms) => { t += ms; } };
}

// ---------- zip ----------
test('zip: files written and read back are the same, the checksum is the standard one, and the same files always give the same bytes', async () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  const files = { 'src/main.js': 'export const a = 1;\n', 'data/ü ñ.json': '{"é":1}', 'bin/blob': new Uint8Array([0, 255, 1, 2, 3]) };
  const zip = writeZip(files);
  const back = await readZip(zip);
  assert.deepEqual([...back.keys()].sort(), Object.keys(files).sort());
  assert.equal(text(back.get('src/main.js')), files['src/main.js']); assert.equal(text(back.get('data/ü ñ.json')), '{"é":1}'); assert.deepEqual([...back.get('bin/blob')], [0, 255, 1, 2, 3]);
  assert.deepEqual(writeZip(files), zip, 'deterministic'); assert.deepEqual([...await readZip(writeZip({}))], []);
  assert.throws(() => writeZip({ '../x': 'no' }), /not a safe file name/);
});

test('zip: compressed (deflate) archives made by other tools are read, and each entry is checked against its size and checksum', async () => {
  // build a zip by hand with a deflated entry, as another program would
  const data = bytes('hello hello hello hello hello'); const comp = deflateRawSync(data); const name = bytes('a.txt');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); const cdOffset = 30 + name.length + comp.length; end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
  const zip = new Uint8Array(Buffer.concat([local, name, comp, central, name, end]));
  assert.equal(text((await readZip(zip)).get('a.txt')), 'hello hello hello hello hello');
  const bad = new Uint8Array(zip); bad[30 + name.length + 3] ^= 0xff;                    // damage the compressed data
  await assert.rejects(readZip(bad), /damaged|expands|corrupt|invalid|unexpected|incorrect/i);
});

test('zip: unsafe or damaged archives are refused with a plain reason', async () => {
  await assert.rejects(readZip(new Uint8Array(5)), /not a zip/); await assert.rejects(readZip(bytes('x'.repeat(100))), /not a zip/);
  const good = writeZip({ 'a.txt': 'abc' });
  const cut = good.slice(0, good.length - 30); await assert.rejects(readZip(cut), /not a zip|damaged/);
  const flipped = new Uint8Array(good); flipped[30 + 5] ^= 1; await assert.rejects(readZip(flipped), /checksum/, 'a changed byte is caught');
  const sneaky = writeZip({ 'safe.txt': 'x' }); const evil = Buffer.from(sneaky); evil.write('../evil', evil.indexOf('safe.txt'), 'utf8'); evil.write('../evil', evil.lastIndexOf('safe.txt'), 'utf8');
  await assert.rejects(readZip(new Uint8Array(evil)), /unsafe path/, 'a path that climbs out is refused');
  assert.ok(!safeEntryName('../a') && !safeEntryName('/a') && !safeEntryName('a\\b') && !safeEntryName('C:/a') && !safeEntryName('a/../b') && !safeEntryName('') && safeEntryName('a/b.js') && safeEntryName('dir/'));
  const many = writeZip(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, 'x']))); await assert.rejects(readZip(many, { maxEntries: 10 }), /at most 10/);
  await assert.rejects(readZip(writeZip({ 'big.txt': 'x'.repeat(1000) }), { maxEntryBytes: 500 }), /larger than 500/); await assert.rejects(readZip(writeZip({ 'a': 'x'.repeat(400), 'b': 'x'.repeat(400) }), { maxTotalBytes: 500 }), /total size/);
});

test('zip: a "zip bomb" (a tiny archive that claims to be small but expands hugely) is stopped while expanding', async () => {
  const data = Buffer.alloc(5_000_000, 97); const comp = deflateRawSync(data); const name = bytes('bomb.txt');
  const claimed = 100;                                                                   // the archive lies about the size
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(0, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(claimed, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(claimed, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
  assert.ok(comp.length < 10_000, 'a small archive');
  await assert.rejects(readZip(new Uint8Array(Buffer.concat([local, name, comp, central, name, end]))), /expands to more than it should/);
});

// ---------- paths ----------
test('file names: what is allowed, and a plain reason for what is not', () => {
  for (const ok of ['main.js', 'src/main.js', 'a/b/c.json', 'my game/notes.txt', 'ü.js', '.hidden']) assert.equal(pathProblem(ok), null, ok);
  for (const [bad, why] of [['', /needs a name/], ['/abs.js', /slash/], ['dir/', /slash/], ['../x.js', /empty parts|\.\./], ['a//b.js', /empty parts/], ['a\\b.js', /cannot contain/], ['a:b.js', /cannot contain/], ['x'.repeat(130), /at most 120/],
    ['a/b/c/d/e/f/g/h/i.js', /levels deep/], ['name .js', null], ['trail. ', /spaces and dots/], ['a/./b', /empty parts|\./]]) {
    const problem = pathProblem(bad); if (why === null) assert.equal(problem, null, bad); else assert.match(problem ?? 'none', why, bad);
  }
  assert.equal(pathProblem(5), 'a file needs a name');
});

// ---------- projects ----------
test('a project: files are created, changed, renamed and deleted, visible at once and saved in the background, and reopening finds them', async () => {
  const { store, backend } = fresh();
  const p = await store.create({ name: '  My   Game ', template: 'bounce', files: { 'src/main.js': 'one', 'notes.md': 'hi' } });
  assert.equal(p.name, 'My Game', 'tidied'); assert.deepEqual(p.list(), ['notes.md', 'src/main.js']);
  const events = []; p.on('change', (e) => events.push(`${e.kind}:${e.path}`));
  const saving = p.write('src/main.js', 'two'); assert.equal(p.readText('src/main.js'), 'two', 'visible before it is saved'); assert.equal(p.saveState, 'saving'); await saving; assert.equal(p.saveState, 'saved');
  await p.write('src/new.js', 'x'); await p.rename('notes.md', 'docs/notes.md'); await p.remove('src/new.js');
  assert.deepEqual(events, ['write:src/main.js', 'create:src/new.js', 'rename:docs/notes.md', 'remove:src/new.js']);
  const again = await store.open(p.id); assert.deepEqual(again.list(), ['docs/notes.md', 'src/main.js']); assert.equal(again.readText('src/main.js'), 'two'); assert.equal(again.readText('docs/notes.md'), 'hi');
  assert.deepEqual((await backend.keys('files', `${p.id}/`)).sort(), [`${p.id}/docs/notes.md`, `${p.id}/src/main.js`]);
  assert.ok(p.updatedAt > p.createdAt); assert.deepEqual((await store.list()).map((x) => [x.name, x.fileCount]), [['My Game', 2]]);
  await p.setName('Renamed'); assert.equal((await store.list())[0].name, 'Renamed');
  assert.equal(p.read('docs/notes.md'), 'hi'); assert.equal(p.readText('nope'), '');
});

test('a project: bad requests are refused with a reason, and nothing changes', async () => {
  const { store } = fresh(); const p = await store.create({ files: { 'a.js': 'a', 'b.js': 'b' } });
  assert.throws(() => p.write('../x.js', 'x'), (e) => e instanceof StoreError && e.code === 'bad-path'); assert.throws(() => p.write('c.js', 5), /text or bytes/);
  assert.throws(() => p.write('big.js', 'x'.repeat(LIMITS.fileBytes + 1)), (e) => e.code === 'too-big'); assert.throws(() => p.remove('zzz.js'), (e) => e.code === 'missing');
  assert.throws(() => p.rename('a.js', 'b.js'), (e) => e.code === 'exists'); assert.throws(() => p.rename('zzz.js', 'c.js'), (e) => e.code === 'missing'); assert.throws(() => p.rename('a.js', '../c'), (e) => e.code === 'bad-path');
  assert.deepEqual(p.list(), ['a.js', 'b.js']);
  const lots = await store.create({}); for (let i = 0; i < LIMITS.files; i++) lots.write(`f${i}.txt`, ''); assert.throws(() => lots.write('one-too-many.txt', ''), (e) => e.code === 'too-many');
  const heavy = await store.create({}); for (let i = 0; i < 10; i++) heavy.write(`h${i}.txt`, 'x'.repeat(LIMITS.fileBytes)); assert.throws(() => heavy.write('more.txt', 'x'.repeat(LIMITS.fileBytes)), /larger than 20 MB/);
  assert.equal(await p.write('a.js', 'a'), undefined, 'writing the same content again is not a change');
});

test('saving: bursts of changes to one file are merged; when saving fails the work stays in memory, the problem is announced, and a retry saves it', async () => {
  const { store, backend } = fresh(); const p = await store.create({ files: { 'a.js': '0' } });
  let puts = 0; const realPut = backend.put.bind(backend); backend.put = async (s, k, v) => { if (s === 'files') puts++; return realPut(s, k, v); };
  for (let i = 1; i <= 50; i++) p.write('a.js', String(i));
  await p.flush(); assert.equal(puts, 1, 'fifty quick edits are one save of the last one'); assert.equal((await backend.get('files', `${p.id}/a.js`)).data, '50');
  let failing = true; backend.put = async (s, k, v) => { if (failing && s === 'files') throw new Error('QuotaExceededError'); return realPut(s, k, v); };
  const states = []; const errors = []; p.on('save-state', (s) => states.push(s)); p.on('save-error', (e) => errors.push(e.message));
  const result = p.write('a.js', 'precious'); await assert.rejects(result, /QuotaExceeded/); assert.equal(p.saveState, 'error'); assert.deepEqual(errors, ['QuotaExceededError']);
  assert.equal(p.readText('a.js'), 'precious', 'still there in memory'); assert.equal((await backend.get('files', `${p.id}/a.js`)).data, '50', 'and not pretending to be saved');
  await assert.rejects(p.flush(), /QuotaExceeded/); failing = false; await p.retrySave(); assert.equal(p.saveState, 'saved'); assert.equal((await backend.get('files', `${p.id}/a.js`)).data, 'precious');
  assert.deepEqual(states, ['saving', 'error', 'saved'], 'saving, then the failure is announced, then it is saved once it works');
});

test('restore points: made by hand or automatically, unchanged ones skipped, identical contents stored once, thinned, and always undoable', async () => {
  const { store, backend, tick } = fresh(); const p = await store.create({ files: { 'a.js': 'one', 'b.js': 'same' } });
  const first = await p.snapshot({ label: 'Start' }); assert.equal(first.fileCount, 2); assert.equal(await p.snapshot(), null, 'nothing changed: no new restore point');
  await p.write('a.js', 'two'); const second = await p.snapshot({ label: 'Changed a' });
  assert.equal((await backend.keys('blobs', `${p.id}/`)).length, 3, 'b.js is kept once for both restore points: three contents, not four');
  assert.deepEqual((await p.snapshots()).map((s) => s.label), ['Changed a', 'Start']);
  await p.write('c.js', 'new'); await p.remove('b.js');
  assert.deepEqual(await p.diffAgainst(second.id), { added: ['c.js'], removed: ['b.js'], changed: [] }); assert.deepEqual((await p.diffAgainst(first.id)).changed, ['a.js']);
  await p.restore(first.id);
  assert.deepEqual(p.list(), ['a.js', 'b.js']); assert.equal(p.readText('a.js'), 'one'); assert.equal(p.readText('b.js'), 'same');
  const labels = (await p.snapshots()).map((s) => s.label); assert.ok(labels[0].startsWith('Before going back to "Start"'), `a safety copy was kept: ${labels}`);
  const safety = (await p.snapshots())[0]; await p.restore(safety.id); assert.equal(p.readText('a.js'), 'two'); assert.ok(p.has('c.js'), 'going back can itself be undone');
  await assert.rejects(p.restore('nope'), /no longer exists/); await assert.rejects(p.diffAgainst('nope'), /no longer exists/);
  // automatic ones: spaced out, skipped when nothing changed, and only the newest 30 are kept; ones made by hand are never thinned away
  const auto = await store.create({ files: { 'x.js': '0' } }); let made = 0;
  for (let i = 1; i <= 40; i++) { await auto.write('x.js', String(i)); tick(10 * 60_000); if (await auto.autoSnapshot({ minIntervalMs: 5 * 60_000 })) made++; }
  assert.equal(made, 40); const list = await auto.snapshots(); assert.equal(list.filter((s) => s.auto).length, 30);
  assert.equal(await auto.autoSnapshot({ minIntervalMs: 24 * 60 * 60_000 }), null, 'too soon');
  await auto.snapshot({ label: 'Keep me' }); await auto.write('x.js', 'z'); for (let i = 0; i < 35; i++) { await auto.write('x.js', `n${i}`); tick(10 * 60_000); await auto.autoSnapshot({ minIntervalMs: 0 }); }
  assert.ok((await auto.snapshots()).some((s) => s.label === 'Keep me'), 'a restore point made by hand survives thinning');
  assert.ok((await backend.keys('blobs', `${auto.id}/`)).length <= 33, 'contents no restore point refers to are forgotten');
  await auto.deleteSnapshot((await auto.snapshots()).find((s) => s.label === 'Keep me').id); assert.ok(!(await auto.snapshots()).some((s) => s.label === 'Keep me'));
});

test('projects: listed newest first, copied, hidden when deleted for 30 days then removed for good, and restored from the bin', async () => {
  const { store, backend, tick } = fresh();
  const a = await store.create({ name: 'A', files: { 'a.js': '1' } }); const b = await store.create({ name: 'B', files: { 'b.js': '2' } }); await a.write('a.js', '1b'); await a.snapshot({ label: 's' });
  assert.deepEqual((await store.list()).map((p) => p.name), ['A', 'B'], 'the one changed last comes first');
  const copy = await store.duplicate(a.id); assert.equal(copy.name, 'A copy'); assert.equal(copy.readText('a.js'), '1b'); assert.notEqual(copy.id, a.id);
  await store.remove(b.id); assert.deepEqual((await store.list()).map((p) => p.name).sort(), ['A', 'A copy']); assert.deepEqual((await store.list({ deleted: true })).map((p) => p.name), ['B']);
  await assert.rejects(store.open(b.id), /does not exist/); await store.restoreProject(b.id); assert.equal((await store.open(b.id)).readText('b.js'), '2');
  await assert.rejects(store.restoreProject(b.id), /not in the bin/); await store.remove(a.id); tick(29 * 24 * 3600_000); assert.equal(await store.purgeOld(30), 0);
  tick(2 * 24 * 3600_000); assert.equal(await store.purgeOld(30), 1);
  for (const s of ['files', 'snapshots', 'blobs']) assert.deepEqual(await backend.keys(s, `${a.id}/`), [], `${s} of the removed project are gone`);
  assert.ok((await backend.keys('files', `${b.id}/`)).length === 1, 'other projects are untouched'); await assert.rejects(store.remove('nope'), /does not exist/);
  await store.setMeta('recent', ['x']); assert.deepEqual(await store.getMeta('recent'), ['x']);
});

test('export and import: a project leaves as a zip and comes back identical; a hostile zip is refused', async () => {
  const { store } = fresh(); const p = await store.create({ name: 'Out', files: { 'src/main.js': 'export const x = 1;', 'img/a.png': new Uint8Array([137, 80, 78, 71, 0, 255]), 'data.json': '{"a":1}' } });
  const zip = p.exportZip(); const q = await store.importZip(zip, { name: 'Back' });
  assert.deepEqual(q.list(), p.list()); assert.equal(q.readText('src/main.js'), 'export const x = 1;'); assert.deepEqual([...q.read('img/a.png')], [137, 80, 78, 71, 0, 255]); assert.equal(typeof q.read('img/a.png'), 'object', 'a picture stays bytes');
  assert.equal(q.name, 'Back'); assert.equal(q.template, 'import');
  await assert.rejects(store.importZip(writeZip({ 'bad*name.js': 'x' })), /cannot use/); await assert.rejects(store.importZip(writeZip({ 'bad.js': new Uint8Array([0xff, 0xfe, 0xfd]) })), /not valid text/);
  await assert.rejects(store.importZip(bytes('not a zip at all, just text, long enough to try')), /not a zip/);
});

test('templates: every starter is a valid project that exports create, update and render, and its imports resolve inside the project or the engine', () => {
  for (const [id, t] of Object.entries(TEMPLATES)) {
    assert.ok(t.title && t.description.length > 20, id); assert.ok(t.files['src/main.js'], `${id} has src/main.js`);
    for (const [path, content] of Object.entries(t.files)) assert.equal(pathProblem(path), null, `${id}/${path}`);
    for (const name of ['create', 'update', 'render']) assert.match(t.files['src/main.js'], new RegExp(`export function ${name}\\(`), `${id} exports ${name}`);
    for (const m of t.files['src/main.js'].matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('@engine/') || t.files[`src/${m[1].replace('./', '')}`] || t.files[m[1].replace('../', '').replace(/\.js$/, '')], `${id}: ${m[1]}`);
  }
});

// ---------- rewriting engine imports for workers ----------
test('engine imports are rewritten to real addresses on the same line; project imports and everything else are left alone', () => {
  const src = "import { sin } from '@engine/math';\nimport { x } from \"@engine/server/src/node.js\";\nimport './local.js';\nexport * from '@engine/core';\nconst m = await import('@engine/physics');\nimport '@engine/audio';\nconst s = 'not an import';";
  const out = resolveImports(src);
  assert.equal(out, "import { sin } from '/packages/math/src/index.js';\nimport { x } from \"/packages/server/src/node.js\";\nimport './local.js';\nexport * from '/packages/core/src/index.js';\nconst m = await import('/packages/physics/src/index.js');\nimport '/packages/audio/src/index.js';\nconst s = 'not an import';");
  assert.equal(out.split('\n').length, src.split('\n').length, 'the same number of lines'); assert.equal(resolveImports("import a from '@engine/x';", '/engine'), "import a from '/engine/x/src/index.js';");
  assert.equal(resolveImports("import a from 'lodash';"), "import a from 'lodash';"); assert.equal(Project.name, 'Project');
});
