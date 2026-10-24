import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetManager, AssetError, basicLoaders, gltfLoader, watchManifest } from '../src/index.js';
import { fileFetch } from '../src/node.js';

/** A fetch over an in-memory "server" that counts requests. */
function server(files) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const f = files[url];
    if (f === undefined) return new Response('no', { status: 404 });
    if (f instanceof Error) throw f;
    if (typeof f === 'function') return f();
    return new Response(typeof f === 'string' ? f : JSON.stringify(f), { status: 200 });
  };
  return { fetch, calls, files };
}
const mgr = (files, o = {}) => { const s = server(files); const m = new AssetManager({ fetch: s.fetch, sleep: async () => {}, ...o }).registerAll(basicLoaders()); return { m, s }; };

test('assets load once however many ask at the same time, and come from the cache afterwards', async () => {
  const { m, s } = mgr({ 'a.json': { n: 1 } });
  const [x, y, z] = await Promise.all([m.load('json', 'a.json'), m.load('json', 'a.json'), m.load(undefined, 'a.json')]);
  assert.equal(x, y); assert.equal(y, z); assert.deepEqual(x, { n: 1 });
  await m.load('json', 'a.json');
  assert.equal(s.calls.length, 1);
  assert.equal(m.get('json', 'a.json'), x);
  assert.equal(m.peek('json', 'a.json').refs, 4);
  assert.throws(() => m.get('json', 'nope.json'), /was never loaded/);
});

test('the type is guessed from the extension; an unknown type or file type is a clear error', async () => {
  const { m } = mgr({});
  assert.equal(m.typeOf('x/y/level.JSON'), 'json'); assert.equal(m.typeOf('a.wgsl'), 'text'); assert.equal(m.typeOf('a.xyz'), null);
  assert.throws(() => m.acquire(undefined, 'a.xyz'), /no loader claims/);
  assert.throws(() => m.acquire('mesh', 'a.obj'), /unknown asset type \(registered: json, text, binary\)/);
});

test('the manifest maps logical paths to hashed files under a base URL', async () => {
  const { m, s } = mgr({ '/cdn/tex.3f2a.json': { ok: true }, 'https://other.example/x.json': { far: 1 } }, { base: '/cdn/', manifest: { assets: { 'tex.json': { url: 'tex.3f2a.json', hash: '3f2a' } } } });
  assert.deepEqual(await m.load('json', 'tex.json'), { ok: true });
  assert.equal(m.urlOf('https://other.example/x.json'), 'https://other.example/x.json');
  assert.deepEqual(s.calls, ['/cdn/tex.3f2a.json']);
});

test('failures: 404 is not retried, server errors and network failures are, and asking again after a failure tries again', async () => {
  let n = 0;
  const { m, s } = mgr({ 'flaky.json': () => (++n < 3 ? new Response('busy', { status: 503 }) : new Response('{"ok":1}')), 'down.json': new TypeError('network'), 'bad.json': 'not json {' });
  assert.deepEqual(await m.load('json', 'flaky.json'), { ok: 1 }); assert.equal(n, 3);
  await assert.rejects(m.load('json', 'missing.json'), (e) => e instanceof AssetError && /HTTP 404/.test(e.message) && e.path === 'missing.json');
  assert.equal(s.calls.filter((c) => c === 'missing.json').length, 1, '404: one try');
  await assert.rejects(m.load('json', 'down.json'), /network/);
  assert.equal(s.calls.filter((c) => c === 'down.json').length, 3, 'two retries');
  await assert.rejects(m.load('json', 'bad.json'), /not valid JSON/);
  assert.equal(m.peek('json', 'bad.json').status, 'failed');
  s.files['bad.json'] = '{"fixed":true}';
  assert.deepEqual(await m.load('json', 'bad.json'), { fixed: true });
});

test('loadAll reports progress, and collects every failure into one error', async () => {
  const { m } = mgr({ 'a.json': {}, 'b.json': {}, 'c.txt': 'hi' });
  const seen = [];
  const hs = await m.loadAll(['a.json', { path: 'b.json' }, 'c.txt'], { onProgress: (p) => seen.push(`${p.loaded}/${p.total}`) });
  assert.deepEqual(seen, ['1/3', '2/3', '3/3']); assert.equal(hs.length, 3); assert.equal(hs[2].value, 'hi');
  const fail = await m.loadAll(['a.json', 'gone.json', 'also-gone.json', 'weird.xyz']).catch((e) => e);
  assert.ok(fail instanceof AggregateError); assert.equal(fail.errors.length, 3); assert.match(fail.message, /3 of 4 assets failed/);
});

test('use counting: collect() frees only what nobody uses, calling dispose; dependencies go with their owner', async () => {
  const disposed = [];
  const { m } = mgr({ 'model.json': { buffer: 'model.bin' }, 'model.bin': 'BINARY', 'solo.json': {} });
  m.register('model', { async load(ctx) { const j = await ctx.json(); return { j, buf: await ctx.load('binary', j.buffer) }; }, dispose: (v) => disposed.push(v.j.buffer) });
  m.loaders.get('json').dispose = () => disposed.push('json');
  const model = m.acquire('model', 'model.json'); await model.promise;
  const solo = m.acquire('json', 'solo.json'); await solo.promise;
  assert.equal(m.collect(), 0, 'everything is in use');
  m.release(solo);
  assert.equal(m.collect(), 1); assert.deepEqual(disposed, ['json']); assert.equal(m.peek('json', 'solo.json'), null);
  m.release(model);
  assert.equal(m.collect(), 2, 'the model and the buffer it needed'); assert.ok(disposed.includes('model.bin'));
  assert.equal(m.handles.size, 0);
});

test('hot reload: a changed hash reloads the asset, holders of the handle see the new value, a broken new file keeps the old one', async () => {
  const files = { 'cfg.v1.json': { speed: 1 }, 'cfg.v2.json': { speed: 2 }, 'cfg.v3.json': '{broken' };
  const { m } = mgr(files, { manifest: { assets: { 'cfg.json': { url: 'cfg.v1.json', hash: 'v1' }, 'other.json': { url: 'other.json', hash: 'o' } } } });
  files['other.json'] = { o: 1 };
  const h = m.acquire('json', 'cfg.json'); await h.promise; await m.load('json', 'other.json');
  const events = []; m.on('reload', (x) => events.push(x.path));
  const changed = await m.update({ assets: { 'cfg.json': { url: 'cfg.v2.json', hash: 'v2' }, 'other.json': { url: 'other.json', hash: 'o' } } });
  assert.deepEqual(changed, ['cfg.json']); assert.deepEqual(events, ['cfg.json']);
  assert.equal(h.value.speed, 2); assert.equal(h.version, 2);
  assert.deepEqual(await m.update({ assets: { 'cfg.json': { url: 'cfg.v3.json', hash: 'v3' }, 'other.json': { url: 'other.json', hash: 'o' } } }), []);
  assert.equal(h.value.speed, 2, 'the old value stays'); assert.equal(h.status, 'ready'); assert.equal(h.version, 2);
});

test('watchManifest polls, only reloads on change, and survives a server that is down', async () => {
  const files = { 'a.v1': 'one', 'a.v2': 'two' };
  let manifest = { assets: { 'a.txt': { url: 'a.v1', hash: '1' } } }, down = false, etag = '"1"';
  const s = server(files);
  const f = async (url, opts = {}) => {
    if (url !== '/manifest.json') return s.fetch(url);
    if (down) throw new Error('offline');
    if (opts.headers?.['if-none-match'] === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(manifest), { headers: { etag } });
  };
  const m = new AssetManager({ fetch: f, manifest }).registerAll(basicLoaders());
  const h = m.acquire('text', 'a.txt'); await h.promise;
  const reloaded = [];
  const w = watchManifest(m, { url: '/manifest.json', every: 1e9, onReload: (p) => reloaded.push(...p) });
  assert.deepEqual(await w.check(), [], 'same as loaded');
  manifest = { assets: { 'a.txt': { url: 'a.v2', hash: '2' } } }; etag = '"2"';
  assert.deepEqual(await w.check(), ['a.txt']); assert.equal(h.value, 'two'); assert.deepEqual(reloaded, ['a.txt']);
  assert.deepEqual(await w.check(), [], 'not modified');
  down = true; assert.deepEqual(await w.check(), []);
  w.stop();
});

test('gltfLoader fetches external buffers through the manager, so they are cached with the model', async () => {
  const { m, s } = mgr({ 'models/tree.gltf': { buffers: [{ uri: 'tree.bin' }, { uri: 'data:abc' }] }, 'models/tree.bin': 'BIN' });
  m.register('gltf', gltfLoader((json, { buffers }) => ({ json, buffers })));
  const model = await m.load('gltf', 'models/tree.gltf');
  assert.deepEqual(Object.keys(model.buffers), ['tree.bin']);
  assert.equal(new TextDecoder().decode(model.buffers['tree.bin']), 'BIN');
  assert.ok(m.peek('binary', 'models/tree.bin'));
  assert.equal(s.calls.length, 2);
});

test('fileFetch serves a directory and refuses to leave it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assets-'));
  try {
    await mkdir(join(dir, 'sub')); await writeFile(join(dir, 'sub', 'a.json'), '{"disk":1}'); await writeFile(join(tmpdir(), 'outside-assets.txt'), 'secret');
    const m = new AssetManager({ fetch: fileFetch(dir), retries: 0 }).registerAll(basicLoaders());
    assert.deepEqual(await m.load('json', 'sub/a.json'), { disk: 1 });
    await assert.rejects(m.load('text', '../outside-assets.txt'), /HTTP 403/);
    await assert.rejects(m.load('json', 'sub/none.json'), /HTTP 404/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
