import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, StoreConflictError, updateRecord, Profiles, Leaderboard } from '../src/index.js';
import { FileStore, GuestAccounts, AppendLog } from '../src/node.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'persist-'));

// ---------- the store contract, run against every store ----------
for (const [label, make] of [['memory', () => ({ store: new MemoryStore(), done() {} })], ['files', () => { const dir = tmp(); return { store: new FileStore(dir), dir, done() { rmSync(dir, { recursive: true, force: true }); } }; }]]) {
  test(`${label} store: records have versions, writes can say which version they expect, a missing record is null`, async () => {
    const { store, done } = make();
    try {
      assert.equal(await store.get('players', 'ann'), null);
      assert.deepEqual(await store.put('players', 'ann', { coins: 1 }), { version: 1 });
      assert.deepEqual(await store.get('players', 'ann'), { value: { coins: 1 }, version: 1 });
      assert.deepEqual(await store.put('players', 'ann', { coins: 2 }, { ifVersion: 1 }), { version: 2 });
      await assert.rejects(store.put('players', 'ann', { coins: 9 }, { ifVersion: 1 }), (e) => e instanceof StoreConflictError && e.expected === 1 && e.actual === 2 && /changed since it was read/.test(e.message));
      await assert.rejects(store.put('players', 'ann', {}, { ifVersion: 0 }), StoreConflictError, 'create-only fails on an existing record');
      assert.equal((await store.put('players', 'bob', { coins: 5 }, { ifVersion: 0 })).version, 1);
      assert.equal((await store.get('players', 'ann')).value.coins, 2, 'the failed writes changed nothing');
      assert.equal((await store.put('players', 'ann', { coins: 3 })).version, 3, 'no ifVersion: always writes');
      const v = { nested: { list: [1, 2, { a: 'é\n"' }] } };
      await store.put('misc', 'k', v); const back = (await store.get('misc', 'k')).value; assert.deepEqual(back, v); back.nested.list.push(9); assert.deepEqual((await store.get('misc', 'k')).value, v, 'values are copied');
    } finally { done(); }
  });

  test(`${label} store: delete, list with prefix and paging, namespaces are separate, unsafe names are refused`, async () => {
    const { store, done } = make();
    try {
      for (const k of ['a:1', 'a:2', 'a:3', 'b:1', 'c']) await store.put('ns', k, { k });
      await store.put('other', 'a:1', { other: true });
      assert.deepEqual((await store.list('ns')).map((r) => r.key), ['a:1', 'a:2', 'a:3', 'b:1', 'c']);
      assert.deepEqual((await store.list('ns', { prefix: 'a:' })).map((r) => r.key), ['a:1', 'a:2', 'a:3']);
      const page1 = await store.list('ns', { limit: 2 }), page2 = await store.list('ns', { limit: 2, after: page1.at(-1).key });
      assert.deepEqual([...page1, ...page2].map((r) => r.key), ['a:1', 'a:2', 'a:3', 'b:1']);
      assert.deepEqual(await store.list('nothing'), []);
      assert.equal((await store.get('other', 'a:1')).value.other, true);
      assert.equal(await store.delete('ns', 'a:1'), true); assert.equal(await store.delete('ns', 'a:1'), false);
      await assert.rejects(store.delete('ns', 'a:2', { ifVersion: 7 }), StoreConflictError); assert.ok(await store.get('ns', 'a:2'));
      for (const bad of ['../x', 'a/b', '', 'x'.repeat(200), '.', '..', 'a b', 'a\\b']) await assert.rejects(store.get('ns', bad), /not allowed/, JSON.stringify(bad));
      await assert.rejects(store.get('../ns', 'k'), /not allowed/);
    } finally { done(); }
  });

  test(`${label} store: update retries until it wins, so 100 simultaneous changes are all counted`, async () => {
    const { store, done } = make();
    try {
      await Promise.all(Array.from({ length: 100 }, () => store.update('c', 'counter', (v) => { v.n++; }, { create: () => ({ n: 0 }), retries: 200 })));
      assert.equal((await store.get('c', 'counter')).value.n, 100);
      await assert.rejects(store.update('c', 'missing', (v) => v), /does not exist/);
      const r = await updateRecord(store, 'c', 'counter', (v) => ({ n: v.n * 2 })); assert.equal(r.value.n, 200); assert.ok(r.version > 100);
    } finally { done(); }
  });
}

test('the file store: one file per record, nothing half written, damaged files are reported not ignored, records survive a new store on the same folder', async () => {
  const dir = tmp();
  try {
    const a = new FileStore(dir);
    await a.put('players', 'ann:1', { hi: 1 });
    const files = readdirSync(join(dir, 'players'), { recursive: true }).map(String).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1); assert.ok(files[0].includes('ann%3A1.json'), files[0]);
    assert.deepEqual(readdirSync(join(dir, 'players'), { recursive: true }).map(String).filter((f) => f.includes('tmp')), []);
    assert.deepEqual((await new FileStore(dir).get('players', 'ann:1')).value, { hi: 1 });
    const path = join(dir, 'players', files[0]);
    writeFileSync(`${path}.tmp-999-abc`, '{"v":9,'); // a leftover from a crash
    assert.deepEqual((await a.list('players')).map((r) => r.key), ['ann:1']);
    writeFileSync(path, '{"v":1,"value":');
    await assert.rejects(a.get('players', 'ann:1'), /is damaged/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- profiles ----------
const spec = (o = {}) => ({ version: 1, create: (id) => ({ name: id, coins: 0 }), ...o });

test('profiles: made the first time, kept in memory while open, written in the background, on close and on shutdown', async () => {
  const store = new MemoryStore(); let t = 1000;
  const profiles = new Profiles({ store, spec: spec(), flushMs: 0, now: () => t });
  const p = await profiles.openProfile('ann');
  assert.deepEqual(p.data, { name: 'ann', coins: 0 }); assert.equal(profiles.stats.creates, 1); assert.equal(await profiles.openProfile('ann'), p, 'the same object');
  assert.equal((await store.get('profiles', 'ann')).value.data.coins, 0);
  p.change((d) => { d.coins += 5; }); assert.equal(p.dirty, true);
  assert.equal((await store.get('profiles', 'ann')).value.data.coins, 0, 'not written yet');
  assert.equal(await profiles.flush(), 1); assert.equal((await store.get('profiles', 'ann')).value.data.coins, 5); assert.equal(p.dirty, false); assert.equal(await profiles.flush(), 0, 'nothing changed: nothing written');
  p.data.coins = 7; p.touch(); await profiles.close('ann');
  assert.equal((await store.get('profiles', 'ann')).value.data.coins, 7); assert.equal(profiles.open.size, 0);
  const again = await profiles.openProfile('ann'); assert.equal(again.data.coins, 7); assert.equal(profiles.stats.loads, 1);
  const [x, y] = await Promise.all([profiles.openProfile('zed'), profiles.openProfile('zed')]); assert.equal(x, y, 'opening at the same moment shares one profile'); assert.equal(profiles.stats.creates, 2);
  x.change((d) => { d.coins = 1; }); again.change((d) => { d.coins = 8; });
  await profiles.closeAll(); assert.equal((await store.get('profiles', 'zed')).value.data.coins, 1); assert.equal((await store.get('profiles', 'ann')).value.data.coins, 8);
  assert.deepEqual(await profiles.peek('ann'), { name: 'ann', coins: 8 }); assert.equal(await profiles.peek('nobody'), null);
});

test('profiles: a timer writes changes in the background', async () => {
  const store = new MemoryStore();
  const profiles = new Profiles({ store, spec: spec(), flushMs: 20 });
  try {
    const p = await profiles.openProfile('ann'); p.change((d) => { d.coins = 3; });
    for (let i = 0; i < 100 && p.dirty; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await store.get('profiles', 'ann')).value.data.coins, 3);
  } finally { await profiles.closeAll(); }
});

test('profiles: older ones are upgraded step by step when read, newer ones are refused, a missing step is an error', async () => {
  const store = new MemoryStore();
  await store.put('profiles', 'old', { v: 1, data: { name: 'Old', gold: 40 } });
  const migrations = { 1: (d) => ({ name: d.name, coins: d.gold }), 2: (d) => ({ ...d, unlocked: [] }) };
  const profiles = new Profiles({ store, spec: { version: 3, create: () => ({}), migrations }, flushMs: 0 });
  const p = await profiles.openProfile('old');
  assert.deepEqual(p.data, { name: 'Old', coins: 40, unlocked: [] }); assert.equal(p.dirty, true, 'saved in the new layout at the next flush');
  await profiles.flush(); assert.equal((await store.get('profiles', 'old')).value.v, 3);
  await store.put('profiles', 'future', { v: 9, data: {} });
  await assert.rejects(profiles.openProfile('future'), /newer version of the game/);
  await store.put('profiles', 'gap', { v: 0, data: {} });
  await assert.rejects(profiles.openProfile('gap'), /no way to upgrade a profile from layout 0 to 1/);
});

test('profiles: when another server changed the profile in between, the two are merged (or ours is kept) instead of one silently winning', async () => {
  const store = new MemoryStore();
  const merge = (mine, theirs, base) => ({ ...mine, coins: theirs.coins + (mine.coins - base.coins) }); // add up both sides' earnings
  const a = new Profiles({ store, spec: spec({ merge }), flushMs: 0 }), b = new Profiles({ store, spec: spec(), flushMs: 0 });
  const mine = await a.openProfile('ann'), theirs = await b.openProfile('ann');
  mine.change((d) => { d.coins += 10; }); theirs.change((d) => { d.coins += 3; });
  await b.flush(); await a.flush();
  assert.equal((await store.get('profiles', 'ann')).value.data.coins, 13, 'both earnings counted'); assert.equal(a.stats.conflicts, 1); assert.equal(a.stats.merged, 1);
  const c = new Profiles({ store, spec: spec(), flushMs: 0, log: () => {} }), d = new Profiles({ store, spec: spec(), flushMs: 0 });
  const c1 = await c.openProfile('ann'), d1 = await d.openProfile('ann');
  c1.change((x) => { x.coins = 100; }); d1.change((x) => { x.coins = 50; }); await d.flush(); await c.flush();
  assert.equal((await store.get('profiles', 'ann')).value.data.coins, 100, 'no merge function: the later write wins, but it was noticed');
});

// ---------- leaderboards ----------
test('a leaderboard ranks players, keeps the best score, breaks ties by who was first, and shows who is around you', () => {
  let t = 0; const lb = new Leaderboard({ now: () => ++t });
  assert.deepEqual(lb.submit('ann', 100), { rank: 1, score: 100, improved: true }); lb.submit('bob', 300); lb.submit('cat', 200); lb.submit('dan', 200);
  assert.deepEqual(lb.top(10).map((e) => [e.rank, e.id, e.score]), [[1, 'bob', 300], [2, 'cat', 200], [3, 'dan', 200], [4, 'ann', 100]], 'cat reached 200 before dan');
  assert.equal(lb.rank('dan'), 3); assert.equal(lb.rank('nobody'), 0); assert.equal(lb.score('ann'), 100); assert.equal(lb.size, 4);
  assert.deepEqual(lb.submit('ann', 50), { rank: 4, score: 100, improved: false }, 'a worse score changes nothing');
  assert.deepEqual(lb.submit('ann', 250), { rank: 2, score: 250, improved: true });
  assert.deepEqual(lb.submit('bob', 10, { mode: 'replace' }), { rank: 4, score: 10, improved: true }); assert.deepEqual(lb.submit('bob', 40, { mode: 'add' }), { rank: 4, score: 50, improved: true });
  assert.deepEqual(lb.around('cat', 1).map((e) => e.id), ['ann', 'cat', 'dan']); assert.deepEqual(lb.around('ann', 2).map((e) => e.rank), [1, 2, 3]); assert.deepEqual(lb.around('zed'), []);
  assert.deepEqual(lb.top(2, 1).map((e) => e.rank), [2, 3]);
  assert.equal(lb.remove('cat'), true); assert.equal(lb.remove('cat'), false); assert.equal(lb.rank('dan'), 2);
  assert.throws(() => lb.submit('x', NaN), /must be a number/);
  const times = new Leaderboard({ order: 'asc', now: () => ++t }); times.submit('fast', 61.2); times.submit('slow', 90); times.submit('fast', 70); times.submit('fast', 59.9);
  assert.deepEqual(times.top(5).map((e) => e.id), ['fast', 'slow']); assert.equal(times.score('fast'), 59.9, 'lower is better and the best is kept');
  const capped = new Leaderboard({ maxEntries: 2 }); capped.submit('a', 1); capped.submit('b', 2); assert.equal(capped.submit('c', 3).rank, 1); assert.equal(capped.size, 2); assert.equal(capped.submit('d', 0).rank, 0, 'too low to make the board');
  assert.equal(lb.reset().length, 3); assert.equal(lb.size, 0);
});

test('a leaderboard survives a restart, and stays fast and correct with 100 000 players', async () => {
  const lb = new Leaderboard();
  let seed = 3; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const t0 = performance.now();
  for (let i = 0; i < 100_000; i++) lb.submit(`p${i}`, Math.floor(rnd() * 1e6));
  const took = performance.now() - t0;
  assert.ok(took < 10000, `100 000 submits took ${took.toFixed(0)} ms`);
  const top = lb.top(100); for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].score >= top[i].score);
  const id = top[50].id; assert.equal(lb.rank(id), 51); assert.equal(lb.around(id, 2)[2].id, id);
  const store = new MemoryStore(); await lb.save(store, 'boards', 'season1');
  const loaded = await Leaderboard.load(store, 'boards', 'season1');
  assert.equal(loaded.size, 100_000); assert.deepEqual(loaded.top(5), lb.top(5)); assert.equal(loaded.rank(id), 51);
  assert.equal((await Leaderboard.load(store, 'boards', 'none')).size, 0);
});

// ---------- accounts ----------
test('guest accounts: an id and a secret, only a hash is kept, wrong secrets fail, secrets can be replaced, outside logins link to one player, deleting cleans up', async () => {
  const store = new MemoryStore();
  const accounts = new GuestAccounts({ store, now: () => 5 });
  const a = await accounts.create({ name: 'Ann' }), b = await accounts.create();
  assert.match(a.playerId, /^p_[a-z2-9]{12}$/); assert.notEqual(a.playerId, b.playerId); assert.ok(a.secret.length >= 30);
  assert.ok(!JSON.stringify(store.dump()).includes(a.secret), 'the secret itself is not stored');
  assert.equal(await accounts.authenticate(a.playerId, a.secret), true);
  for (const [id, s] of [[a.playerId, b.secret], [a.playerId, ''], ['p_nobody', a.secret], [undefined, a.secret], [a.playerId, 'x'.repeat(500)], [a.playerId, null]]) assert.equal(await accounts.authenticate(id, s), false);
  assert.deepEqual(await accounts.get(a.playerId), { playerId: a.playerId, name: 'Ann', createdAt: 5, links: {} });
  await accounts.setName(a.playerId, 'Annie'); assert.equal((await accounts.get(a.playerId)).name, 'Annie');
  const fresh = await accounts.rotateSecret(a.playerId); assert.equal(await accounts.authenticate(a.playerId, a.secret), false); assert.equal(await accounts.authenticate(a.playerId, fresh), true);
  assert.equal(await accounts.link(a.playerId, 'google', '1234'), true); assert.equal(await accounts.link(a.playerId, 'google', '1234'), true, 'linking again is fine');
  assert.equal(await accounts.link(b.playerId, 'google', '1234'), false, 'it belongs to someone else'); assert.equal(await accounts.findByLink('google', '1234'), a.playerId); assert.equal(await accounts.findByLink('google', 'zzz'), null);
  assert.deepEqual((await accounts.get(a.playerId)).links, { google: '1234' });
  assert.equal(await accounts.delete(a.playerId), true); assert.equal(await accounts.get(a.playerId), null); assert.equal(await accounts.findByLink('google', '1234'), null); assert.equal(await accounts.delete(a.playerId), false);
});

// ---------- the append-only log ----------
test('the log: lines in order even when appended at once, rotated by size with the newest read back first, a torn last line is skipped', async () => {
  const dir = tmp();
  try {
    const log = new AppendLog(join(dir, 'matches.log'), { maxBytes: 130, keep: 2 });
    await Promise.all(Array.from({ length: 30 }, (_, i) => log.append({ match: i, winner: `p${i % 3}` })));
    await log.flush();
    const files = readdirSync(dir).sort(); assert.deepEqual(files, ['matches.log', 'matches.log.1', 'matches.log.2']);
    const last = await log.tail(5); assert.deepEqual(last.map((r) => r.match), [25, 26, 27, 28, 29]);
    const more = await log.tail(1000); assert.ok(more.length > 5 && more.length < 30, 'old files beyond `keep` are gone'); assert.deepEqual(more.map((r) => r.match), more.map((r) => r.match).slice().sort((a, b) => a - b), 'oldest first');
    writeFileSync(join(dir, 'torn.log'), `${JSON.stringify({ ok: 1 })}\n{"torn":`);
    assert.deepEqual(await new AppendLog(join(dir, 'torn.log')).tail(10), [{ ok: 1 }]);
    assert.ok(existsSync(join(dir, 'matches.log')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
