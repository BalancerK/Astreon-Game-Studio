import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveGame, AutoSaver, SaveError, MemoryStorage, LocalStorageStorage, HttpStorage, encode, decode, checksum, valueSection, objectsSection, rngSection } from '../src/index.js';
import { FileStorage, createSaveHandler } from '../src/node.js';

/** A tiny "game": a score, a position, and a counter, each its own section. */
function game(storage = new MemoryStorage(), o = {}) {
  const state = { score: 0, pos: [0, 0], lives: 3 };
  let now = 1_700_000_000_000;
  const saves = new SaveGame({ game: 'tiny', version: 1, storage, clock: () => (now += 1000), ...o });
  saves.section('score', valueSection(() => state.score, (v) => { state.score = v; }));
  saves.section('player', valueSection(() => ({ pos: state.pos, lives: state.lives }), (v) => { state.pos = v.pos; state.lives = v.lives; }));
  return { state, saves, storage };
}
const fails = async (p, code) => { try { await p; } catch (e) { assert.ok(e instanceof SaveError, `a SaveError, got ${e}`); assert.equal(e.code, code, e.message); return e; } assert.fail(`expected a ${code} error`); };

test('save and load round trip every section, plus play time, and the file is a verified JSON envelope', async () => {
  const { state, saves, storage } = game();
  state.score = 120; state.pos = [3, 4]; state.lives = 2; saves.tick(61.5);
  const { bytes, file } = await saves.save('one', { title: 'Level 3', level: 3 });
  assert.ok(bytes > 50);
  assert.equal(file.game, 'tiny'); assert.equal(file.sections.score.v, 1); assert.equal(file.meta.title, 'Level 3');
  const text = await storage.get('slot.one');
  assert.equal(JSON.parse(text).sum, checksum(JSON.stringify({ ...file })), 'the checksum covers the whole file');
  state.score = 0; state.pos = [9, 9]; state.lives = 0; saves.playtime = 0;
  const r = await saves.load('one');
  assert.deepEqual([state.score, state.pos, state.lives], [120, [3, 4], 2]);
  assert.equal(r.playtime, 61.5); assert.equal(saves.playtime, 61.5); assert.equal(r.meta.level, 3);
  state.pos.push(1); // the loaded state does not share objects with the file
  assert.deepEqual(JSON.parse(await storage.get('slot.one')).sections.player.data.pos, [3, 4]);
});

test('list shows slots newest first from small headers, without reading the saves', async () => {
  const { saves, state } = game();
  state.score = 1; await saves.save('a', { title: 'First' });
  state.score = 2; await saves.save('b', { title: 'Second', thumbnail: 'data:image/png;base64,AAA' });
  const list = await saves.list();
  assert.deepEqual(list.map((s) => s.slot), ['b', 'a']);
  assert.equal(list[0].title, 'Second'); assert.equal(list[0].thumbnail.slice(0, 5), 'data:'); assert.ok(list[0].savedAt > list[1].savedAt); assert.ok(list[0].bytes > 0);
  await saves.delete('a');
  assert.deepEqual((await saves.list()).map((s) => s.slot), ['b']);
  assert.equal(await saves.has('a'), false);
  await saves.storage.set('slot.broken.meta', '{nope');
  assert.equal((await saves.list()).find((s) => s.slot === 'broken').error, 'unreadable header');
});

test('a damaged or cut-off file is noticed; the backup of the previous save takes over; a game that cannot recover changes nothing', async () => {
  const { state, saves, storage } = game();
  state.score = 10; await saves.save('s');
  state.score = 20; await saves.save('s');                     // the first save is now the backup
  assert.equal(JSON.parse(await storage.get('slot.s.bak')).sections.score.data, 10);
  const good = await storage.get('slot.s');
  await storage.set('slot.s', good.slice(0, good.length - 25)); // cut short, as a crash would leave it
  state.score = 99;
  const r = await saves.load('s');
  assert.equal(r.recovered, true); assert.equal(state.score, 10, 'the previous save');
  await storage.set('slot.s', good.replace('"data":20', '"data":2000')); // altered: the checksum no longer matches
  await saves.load('s'); assert.equal(state.score, 10);
  await storage.delete('slot.s.bak');
  state.score = 5;
  await fails(saves.load('s'), 'corrupt'); assert.equal(state.score, 5, 'nothing was touched');
  await fails(saves.load('nothing'), 'missing');
  await storage.set('slot.junk', 'hello'); await fails(saves.load('junk'), 'corrupt');
  await storage.set('slot.json', '{"a":1}'); await fails(saves.load('json'), 'corrupt');
});

test('a save is written to a backup first: when the new write fails the old save is still there', async () => {
  const { state, saves, storage } = game();
  state.score = 1; await saves.save('s');
  const real = storage.set.bind(storage);
  storage.set = async (k, v) => { if (k === 'slot.s') throw new Error('disk full'); return real(k, v); };
  state.score = 2;
  await fails(saves.save('s'), 'storage');
  storage.set = real;
  state.score = 0; await saves.load('s');
  assert.equal(state.score, 1, 'the earlier save still loads (from the file or the backup)');
});

test('a save from another game, or from a newer one, is refused with a clear reason', async () => {
  const a = game(); a.state.score = 5; await a.saves.save('x');
  const other = new SaveGame({ game: 'other', storage: a.storage }); other.section('score', valueSection(() => 0, () => {}));
  const e = await fails(other.load('x'), 'game'); assert.match(e.message, /belongs to "tiny", not "other"/);
  const newer = new SaveGame({ game: 'tiny', version: 5, storage: a.storage }); newer.section('score', valueSection(() => 0, () => {}));
  await newer.save('future');
  await fails(a.saves.load('future'), 'newer');
  const sec = new SaveGame({ game: 'tiny', version: 1, storage: a.storage }); sec.section('score', valueSection(() => 7, () => {}, { version: 4 }));
  await sec.save('sec');
  const strictOld = new SaveGame({ game: 'tiny', version: 1, storage: a.storage }); strictOld.section('score', valueSection(() => 0, () => {}, { version: 2 }));
  const err = await fails(strictOld.load('sec'), 'newer'); assert.match(err.message, /"score" part of this save is newer/);
});

test('migrations upgrade old data one version at a time, per section and for the whole file, before anything is loaded', async () => {
  const storage = new MemoryStorage();
  // version 1 of the game saved the score as a plain number and the player as [x, y]
  const v1 = new SaveGame({ game: 'tiny', version: 1, storage });
  v1.section('score', valueSection(() => 40, () => {})); v1.section('player', valueSection(() => [7, 8], () => {}));
  await v1.save('old');
  const loaded = {};
  const v3 = new SaveGame({
    game: 'tiny', version: 3, storage,
    migrations: { 1: (f) => { f.meta.upgraded = (f.meta.upgraded ?? 0) + 1; return f; }, 2: (f) => { f.meta.upgraded += 1; return f; } },
  });
  v3.section('score', { version: 3, save: () => 0, load: (d) => { loaded.score = d; }, migrations: { 1: (n) => ({ points: n }), 2: (o) => ({ points: o.points, bonus: 0 }) } });
  v3.section('player', { version: 2, save: () => 0, load: (d) => { loaded.player = d; }, migrations: { 1: ([x, y]) => ({ x, y }) } });
  const r = await v3.load('old');
  assert.deepEqual(loaded, { score: { points: 40, bonus: 0 }, player: { x: 7, y: 8 } });
  assert.equal(r.meta.upgraded, 2, 'both file-level steps ran');
  const noPath = new SaveGame({ game: 'tiny', version: 1, storage });
  noPath.section('score', { version: 3, save: () => 0, load: () => { throw new Error('should not load'); }, migrations: { 1: (n) => n } });
  noPath.section('player', valueSection(() => 0, () => assert.fail('nothing may load when an upgrade is impossible')));
  const e = await fails(noPath.load('old'), 'migration'); assert.match(e.message, /from version 2 to 3/);
  const bad = new SaveGame({ game: 'tiny', version: 2, storage }); bad.section('score', { version: 2, save: () => 0, load: () => {}, migrations: { 1: () => { throw new Error('boom'); } } });
  bad.section('player', valueSection(() => 0, () => {}));
  await fails(bad.load('old'), 'migration');
});

test('a section that fails while applying a save puts everything back as it was', async () => {
  const { state, saves } = game();
  state.score = 50; state.pos = [1, 1]; await saves.save('ok');
  let boom = false;
  saves.section('fragile', { save: () => 'x', load: () => { if (boom) throw new Error('cannot place the monster'); } });
  await saves.save('ok');
  state.score = 7; state.pos = [2, 2]; boom = true;
  const e = await fails(saves.load('ok'), 'apply');
  assert.match(e.message, /put back as it was \(cannot place the monster\)/);
  assert.deepEqual([state.score, state.pos], [7, [2, 2]], 'back to what it was before the failed load');
});

test('missing and extra sections: optional ones may be absent, unknown ones are reported, required ones are an error', async () => {
  const { state, saves, storage } = game();
  state.score = 3; await saves.save('s');
  saves.section('extra', { optional: true, save: () => 1, load: () => assert.fail('absent: not loaded') });
  const r = await saves.load('s'); assert.deepEqual(r.ignored, []);
  const fewer = new SaveGame({ game: 'tiny', storage }); fewer.section('score', valueSection(() => 0, (v) => { state.score = v; }));
  const r2 = await fewer.load('s'); assert.deepEqual(r2.ignored, ['player'], 'a section in the file that this game does not have');
  const more = new SaveGame({ game: 'tiny', storage }); more.section('score', valueSection(() => 0, () => {})); more.section('boss', valueSection(() => 0, () => {}));
  const e = await fails(more.load('s'), 'section'); assert.match(e.message, /no "boss" section/);
});

test('compressed saves are smaller, round trip, and a plain reader still understands both', async () => {
  const { state, saves, storage } = game(new MemoryStorage(), { compress: true });
  state.score = 5; state.pos = Array.from({ length: 4000 }, (_, i) => i % 7);
  await saves.save('big');
  const text = await storage.get('slot.big');
  assert.ok(text.startsWith('gz:'), 'gzip + base64');
  const plain = JSON.stringify(saves.capture());
  assert.ok(text.length < plain.length / 2, `${text.length} vs ${plain.length}`);
  state.pos = []; await saves.load('big'); assert.equal(state.pos.length, 4000);
  const file = await decode(await encode({ format: 'engine-save', formatVersion: 1, x: 1 }));
  assert.equal(file.x, 1);
  const flipped = text.slice(0, 40) + (text[40] === 'A' ? 'B' : 'A') + text.slice(41);
  await storage.set('slot.big', flipped); await storage.delete('slot.big.bak');
  await fails(saves.load('big'), 'corrupt');
});

test('quicksave and rolling autosaves; the autosaver respects canSave and reports failures instead of throwing', async () => {
  const { state, saves, storage } = game(new MemoryStorage(), { autosaveSlots: 3 });
  for (let i = 1; i <= 5; i++) { state.score = i; await saves.autosave({ level: i }); }
  const slots = (await saves.list()).map((s) => s.slot).sort();
  assert.deepEqual(slots, ['auto-1', 'auto-2', 'auto-3']);
  const score = async (slot) => { await saves.load(slot); return state.score; };
  assert.deepEqual([await score('auto-1'), await score('auto-2'), await score('auto-3')], [5, 4, 3], 'newest first, the oldest two dropped');
  state.score = 42; await saves.quicksave(); state.score = 0; await saves.quickload(); assert.equal(state.score, 42);
  let allowed = false, errors = [];
  const auto = new AutoSaver(saves, { every: 10, canSave: () => allowed, onError: (e) => errors.push(e.message) });
  for (let i = 0; i < 30; i++) auto.tick(1);
  assert.equal((await saves.list()).length, 4, 'nothing saved while canSave said no');
  allowed = true; state.score = 77; auto.tick(1); await auto.pending;
  state.score = 0; await saves.load('auto-1'); assert.equal(state.score, 77);
  storage.set = async () => { throw new Error('quota'); };
  auto.tick(11); await auto.pending;
  assert.equal(errors.length, 1); assert.match(errors[0], /could not write/);
});

test('slot names are checked', async () => {
  const { saves } = game();
  for (const bad of ['', '../x', 'a/b', 'a.b', 'x'.repeat(60)]) await fails(saves.save(bad), 'storage');
});

test('objectsSection saves things with save() and load(), by name, as they come and go; rngSection keeps the dice', async () => {
  const thing = (v) => ({ v, save() { return this.v; }, load(d) { this.v = d; } });
  const objects = { a: thing(1), b: thing(2) };
  const rng = { state: 12345 };
  const saves = new SaveGame({ game: 'g', storage: new MemoryStorage() });
  saves.section('things', objectsSection(() => objects)); saves.section('rng', rngSection(rng));
  await saves.save('s');
  objects.a.v = 100; delete objects.b; objects.c = thing(3); rng.state = 1;
  await saves.load('s');
  assert.equal(objects.a.v, 1); assert.equal(rng.state, 12345); assert.equal(objects.c.v, 3, 'new things are left alone, vanished ones skipped');
});

test('FileStorage writes whole files only, lists keys, and refuses unsafe names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'saves-'));
  try {
    const fs = new FileStorage(join(dir, 'nested'));
    await fs.set('slot.one', 'hello'); await fs.set('slot.two', 'world');
    assert.equal(await fs.get('slot.one'), 'hello'); assert.equal(await fs.get('nope'), null);
    assert.deepEqual(await fs.keys('slot.'), ['slot.one', 'slot.two']);
    await fs.delete('slot.one'); assert.equal(await fs.get('slot.one'), null); await fs.delete('slot.one');
    for (const bad of ['../x', 'a/b', '.hidden', '', 'x'.repeat(200)]) await assert.rejects(fs.get(bad), /not a usable key/);
    assert.deepEqual((await readdir(join(dir, 'nested'))).filter((f) => f.includes('tmp')), [], 'no temporary files are left');
    const { saves, state } = game(fs);
    state.score = 9; await saves.save('disk'); state.score = 0; await saves.load('disk'); assert.equal(state.score, 9);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('LocalStorageStorage namespaces keys on a localStorage-like store', async () => {
  const map = new Map();
  const store = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => [...map.keys()][i] };
  map.set('other-app', 'x');
  const ls = new LocalStorageStorage('mygame:', store);
  const { saves, state } = game(ls);
  state.score = 3; await saves.save('a');
  assert.ok([...map.keys()].includes('mygame:slot.a') && map.has('other-app'));
  assert.deepEqual((await saves.list()).map((s) => s.slot), ['a']);
  state.score = 0; await saves.load('a'); assert.equal(state.score, 3);
});

test('over HTTP: a server keeps each user\'s saves, authentication and size limits apply, and two devices cannot silently overwrite each other', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'saves-'));
  const handler = createSaveHandler({ storageFor: (u) => new FileStorage(join(dir, u)), userOf: (req) => req.headers['x-user'] ?? null, maxBytes: 20_000 });
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname.replace(/^\/saves/, '') || '/'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/saves`;
  try {
    const ann = new HttpStorage(base, { headers: { 'x-user': 'ann' } }), bob = new HttpStorage(base, { headers: { 'x-user': 'bob' } });
    const { saves: annSaves, state } = game(ann);
    state.score = 11; await annSaves.save('cloud');
    assert.deepEqual((await annSaves.list()).map((s) => s.slot), ['cloud']);
    assert.deepEqual(await bob.keys(), [], 'bob sees none of ann\'s saves');
    state.score = 0; await annSaves.load('cloud'); assert.equal(state.score, 11);
    // a second device of ann's reads the save, then both write: the second write is refused
    const phone = new HttpStorage(base, { headers: { 'x-user': 'ann' } }), laptop = new HttpStorage(base, { headers: { 'x-user': 'ann' } });
    await phone.get('slot.cloud'); await laptop.get('slot.cloud');
    await phone.set('slot.cloud', 'from the phone');
    await assert.rejects(laptop.set('slot.cloud', 'from the laptop'), (e) => e.conflict === true);
    await laptop.get('slot.cloud'); await laptop.set('slot.cloud', 'from the laptop, after reading');
    assert.equal(await phone.get('slot.cloud'), 'from the laptop, after reading');
    const nobody = await fetch(`${base}/slot.cloud`); assert.equal(nobody.status, 401);
    const huge = await fetch(`${base}/big`, { method: 'PUT', headers: { 'x-user': 'ann' }, body: 'x'.repeat(30_000) }); assert.equal(huge.status, 413);
    const bad = await fetch(`${base}/..%2Fsecret`, { headers: { 'x-user': 'ann' } }); assert.equal(bad.status, 400);
    const created = await fetch(`${base}/slot.new`, { method: 'PUT', headers: { 'x-user': 'ann', 'if-none-match': '*' }, body: 'one' }); assert.equal(created.status, 204);
    const again = await fetch(`${base}/slot.new`, { method: 'PUT', headers: { 'x-user': 'ann', 'if-none-match': '*' }, body: 'two' }); assert.equal(again.status, 412);
    const gone = await fetch(`${base}/slot.new`, { method: 'DELETE', headers: { 'x-user': 'ann' } }); assert.equal(gone.status, 204);
    assert.equal(await ann.get('slot.new'), null);
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});
