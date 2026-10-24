import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveGame, MemoryStorage, HttpStorage, CloudSync, valueSection, decode } from '../src/index.js';
import { FileStorage, createSaveHandler } from '../src/node.js';

// a device: a game with a score, saving to its own storage with a clock the test controls
let now = 1_700_000_000_000;
function device(storage = new MemoryStorage()) {
  const state = { score: 0 };
  const saves = new SaveGame({ game: 'tiny', version: 1, storage, clock: () => (now += 1000) });
  saves.section('score', valueSection(() => state.score, (v) => { state.score = v; }));
  return { state, saves, storage };
}
const scoreIn = async (storage, slot) => (await decode(await storage.get(`slot.${slot}`))).sections.score.data;

test('a new save on the device goes up to the server, and a new one on the server comes down', async () => {
  const phone = device(), remote = new MemoryStorage();
  phone.state.score = 10; await phone.saves.save('one', { title: 'Level 1' });
  const sync = new CloudSync({ local: phone.storage, remote });
  const r = await sync.sync();
  assert.deepEqual([r.uploaded, r.downloaded, r.same, r.conflicts, r.failed], [1, 0, 0, 0, 0]);
  assert.equal(await scoreIn(remote, 'one'), 10);
  assert.equal(JSON.parse(await remote.get('slot.one.meta')).title, 'Level 1', 'the load-screen header goes too, so the server can list its saves');
  // a second device downloads it, and can load it
  const laptop = device();
  const s2 = new CloudSync({ local: laptop.storage, remote });
  assert.equal((await s2.sync()).downloaded, 1);
  await laptop.saves.load('one'); assert.equal(laptop.state.score, 10);
  assert.deepEqual((await laptop.saves.list()).map((s) => [s.slot, s.title]), [['one', 'Level 1']]);
});

test('nothing changed: nothing is written; one side changed: that side wins, whichever it is', async () => {
  const phone = device(), remote = new MemoryStorage(), sync = new CloudSync({ local: phone.storage, remote });
  phone.state.score = 1; await phone.saves.save('a');
  await sync.sync();
  const writes = []; const spy = (s) => new Proxy(s, { get: (t, k) => (k === 'set' ? async (key, v) => { writes.push(key); return t.set(key, v); } : t[k]?.bind?.(t) ?? t[k]) });
  const quiet = new CloudSync({ local: spy(phone.storage), remote: spy(remote) });
  const same = await quiet.sync();
  assert.equal(same.same, 1); assert.deepEqual(writes.filter((k) => !k.startsWith('sync.')), [], 'no saves were written');
  phone.state.score = 2; await phone.saves.save('a');                                     // the device moves on
  assert.equal((await sync.sync()).uploaded, 1); assert.equal(await scoreIn(remote, 'a'), 2);
  const other = device(); const s3 = new CloudSync({ local: other.storage, remote }); await s3.sync();
  other.state.score = 3; await other.saves.save('a'); await s3.sync();                    // another device moves on
  const back = await sync.sync();
  assert.equal(back.downloaded, 1); assert.equal(await scoreIn(phone.storage, 'a'), 3, 'the phone caught up');
});

test('both sides changed since they last agreed: the newest save wins and the other is kept as a backup', async () => {
  const phone = device(), laptop = device(), remote = new MemoryStorage();
  const a = new CloudSync({ local: phone.storage, remote }), b = new CloudSync({ local: laptop.storage, remote });
  phone.state.score = 1; await phone.saves.save('x'); await a.sync(); await b.sync();
  phone.state.score = 50; await phone.saves.save('x');                                    // played offline on both
  laptop.state.score = 80; await laptop.saves.save('x');                                  // later
  await b.sync();                                                                          // the laptop gets there first
  assert.equal(await scoreIn(remote, 'x'), 80);
  const r = await a.syncSlot('x');
  assert.equal(r.action, 'resolved'); assert.equal(r.chose, 'remote'); assert.ok(r.local.savedAt < r.remote.savedAt);
  assert.equal(await scoreIn(phone.storage, 'x'), 80, 'the newer save is kept');
  assert.equal(await scoreIn({ get: (k) => phone.storage.get(k) }, 'x.bak'.replace('x.bak', 'x')), 80);
  assert.equal((await decode(await phone.storage.get('slot.x.bak'))).sections.score.data, 50, 'and the replaced one is kept as .bak');
});

test('strategies: always local, always remote, ask, and a function that can merge', async () => {
  const setup = async () => {
    const phone = device(), laptop = device(), remote = new MemoryStorage();
    const mk = (d, strategy) => new CloudSync({ local: d.storage, remote, strategy });
    phone.state.score = 1; await phone.saves.save('x'); await mk(phone, 'newest').sync(); await mk(laptop, 'newest').sync();
    phone.state.score = 20; await phone.saves.save('x'); laptop.state.score = 30; await laptop.saves.save('x'); await mk(laptop, 'newest').sync();
    return { phone, laptop, remote, mk };
  };
  let t = await setup();
  assert.equal((await t.mk(t.phone, 'local').syncSlot('x')).chose, 'local'); assert.equal(await scoreIn(t.remote, 'x'), 20, 'local always wins: the server takes the phone\'s save');
  t = await setup();
  assert.equal((await t.mk(t.phone, 'remote').syncSlot('x')).chose, 'remote'); assert.equal(await scoreIn(t.phone.storage, 'x'), 30);
  t = await setup();
  const asked = await t.mk(t.phone, 'ask').syncSlot('x');
  assert.equal(asked.action, 'conflict'); assert.equal(asked.local.title, null); assert.ok(asked.local.sum !== asked.remote.sum);
  assert.equal(await scoreIn(t.phone.storage, 'x'), 20); assert.equal(await scoreIn(t.remote, 'x'), 30);          // nothing was written
  assert.equal((await t.mk(t.phone, 'ask').sync()).conflicts, 1, 'and it stays a conflict until settled');
  const settled = await t.mk(t.phone, 'ask').resolve('x', 'remote'); assert.equal(settled.chose, 'remote');
  assert.equal((await t.mk(t.phone, 'ask').sync()).same, 1, 'after settling, both agree');
  t = await setup();
  const merge = (l, r) => ({ ...r, savedAt: Math.max(l.savedAt, r.savedAt) + 1, sections: { score: { v: 1, data: l.sections.score.data + r.sections.score.data } } });
  const merged = await t.mk(t.phone, merge).syncSlot('x');
  assert.equal(merged.chose, 'merged'); assert.equal(await scoreIn(t.remote, 'x'), 50); assert.equal(await scoreIn(t.phone.storage, 'x'), 50);
  await t.phone.saves.load('x'); assert.equal(t.phone.state.score, 50, 'the merged save is a real save file');
  t = await setup();
  assert.equal((await t.mk(t.phone, () => undefined).syncSlot('x')).action, 'conflict', 'a function that declines leaves the conflict');
  assert.throws(() => new CloudSync({ local: new MemoryStorage() }), /local and a remote/);
  assert.equal((await new CloudSync({ local: t.phone.storage, remote: t.remote, strategy: 'bogus' }).syncSlot('x')).action, 'failed');
});

test('two devices that have never synced and hold different saves are a conflict, not an overwrite', async () => {
  const phone = device(), laptop = device(), remote = new MemoryStorage();
  phone.state.score = 5; await phone.saves.save('x'); laptop.state.score = 6; await laptop.saves.save('x');
  await new CloudSync({ local: laptop.storage, remote }).sync();                           // the laptop uploads
  const r = await new CloudSync({ local: phone.storage, remote, strategy: 'ask' }).syncSlot('x');
  assert.equal(r.action, 'conflict');
  assert.equal(await scoreIn(remote, 'x'), 6);
});

test('a damaged save is reported, not uploaded, and the other slots still sync', async () => {
  const phone = device(), remote = new MemoryStorage();
  phone.state.score = 1; await phone.saves.save('good'); await phone.saves.save('bad');
  await phone.storage.set('slot.bad', (await phone.storage.get('slot.bad')).slice(0, 40));
  const r = await new CloudSync({ local: phone.storage, remote }).sync();
  const by = Object.fromEntries(r.results.map((x) => [x.slot, x]));
  assert.equal(by.good.action, 'uploaded'); assert.equal(by.bad.action, 'failed'); assert.match(by.bad.error, /damaged/); assert.equal(r.failed, 1);
  assert.equal(await remote.get('slot.bad'), null);
  // a remote that cannot be reached fails every slot without throwing
  const down = { get: async () => { throw new Error('offline'); }, set: async () => { throw new Error('offline'); }, delete: async () => {}, keys: async () => { throw new Error('offline'); } };
  const off = await new CloudSync({ local: phone.storage, remote: down }).sync();
  assert.equal(off.failed, 1); assert.match(off.results[0].error, /could not list/);
  const seen = []; const cs = new CloudSync({ local: phone.storage, remote }); cs.onResult = (x) => seen.push(x.slot); await cs.sync(); assert.deepEqual(seen, ['bad', 'good']);
});

test('deletions travel only when asked for', async () => {
  const phone = device(), laptop = device(), remote = new MemoryStorage();
  const mk = (d, deletions) => new CloudSync({ local: d.storage, remote, deletions });
  phone.state.score = 1; await phone.saves.save('x'); await mk(phone, true).sync(); await mk(laptop, true).sync();
  await phone.saves.delete('x');
  const brought = await mk(phone, false).sync();                                          // without `deletions` the save comes back
  assert.equal(brought.downloaded, 1); assert.equal(await phone.saves.has('x'), true);
  await phone.saves.delete('x');
  const gone = await mk(phone, true).sync();
  assert.equal(gone.deleted, 1); assert.equal(await remote.get('slot.x'), null, 'deleted on the server');
  assert.equal((await mk(laptop, true).sync()).deleted, 1); assert.equal(await laptop.saves.has('x'), false, 'and on the other device');
});

test('over HTTP against the save server: a sync between two devices of one user, and a write that races another device is reported and retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-'));
  const handler = createSaveHandler({ storageFor: (u) => new FileStorage(join(dir, u)), userOf: (req) => req.headers['x-user'] ?? null });
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname.replace(/^\/saves/, '') || '/'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/saves`;
  try {
    const phone = device(), laptop = device();
    const remoteOf = () => new HttpStorage(base, { headers: { 'x-user': 'ann' } });
    const a = new CloudSync({ local: phone.storage, remote: remoteOf() }), b = new CloudSync({ local: laptop.storage, remote: remoteOf() });
    phone.state.score = 7; await phone.saves.save('cloud', { title: 'On the phone' });
    assert.equal((await a.sync()).uploaded, 1);
    assert.equal((await b.sync()).downloaded, 1); await laptop.saves.load('cloud'); assert.equal(laptop.state.score, 7);
    // the laptop saves; before it syncs, the phone saves and syncs: the laptop's upload would overwrite the phone's, and the server refuses
    laptop.state.score = 8; await laptop.saves.save('cloud');
    const racing = remoteOf(); const slowB = new CloudSync({ local: laptop.storage, remote: racing });
    const realGet = racing.get.bind(racing);
    racing.get = async (key) => { const text = await realGet(key); if (key === 'slot.cloud') { phone.state.score = 9; await phone.saves.save('cloud'); await a.sync(); } return text; };
    const lost = await slowB.syncSlot('cloud');
    assert.equal(lost.action, 'failed'); assert.match(lost.error, /changed on the server/);
    racing.get = realGet;
    const again = await new CloudSync({ local: laptop.storage, remote: remoteOf(), strategy: 'ask' }).syncSlot('cloud');
    assert.equal(again.action, 'conflict', 'next time round both changes are seen, and the player settles it');
    assert.equal(await scoreIn(laptop.storage, 'cloud'), 8, 'nothing was lost on either side');
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});
