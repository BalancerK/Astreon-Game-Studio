import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { ProcessRoom, WorkerRoom, RoomManager } from '../src/index.js';

const FIXTURE = new URL('./fixtures/echo-room.js', import.meta.url);
const FIXTURE_DIR = dirname(fileURLToPath(FIXTURE));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function waitFor(cond, ms = 8000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** A stand-in for a client socket. */
function fakeConn() {
  const c = { state: 'open', received: [], closed: null, onMessage: null, onClose: null,
    send(bytes, ch) { c.received.push([...bytes]); return true; },
    close(reason, code) { if (c.state === 'closed') return; c.state = 'closed'; c.closed = { reason, code }; c.onClose?.(reason); } };
  return c;
}

const room = (options = {}, host = {}) => new ProcessRoom({ name: 't', module: FIXTURE, options, ...host });
const stop = async (...rooms) => { for (const r of rooms) await r.stop(); };

test('a process room serves clients through the normal contract, from its own process', async () => {
  const r = room({ label: 'one' });
  try {
    await r.ready;
    assert.notEqual(r.pid, process.pid);
    assert.ok(alive(r.pid));
    const a = fakeConn(), b = fakeConn();
    r.join(a); r.join(b);
    assert.equal(r.players, 2);
    a.onMessage(new Uint8Array([1, 2, 3]), 0);
    b.onMessage(new Uint8Array([10]), 1);
    await waitFor(() => a.received.length === 1 && b.received.length === 1, 3000, 'echoes');
    assert.deepEqual(a.received[0], [2, 3, 4]);
    assert.deepEqual(b.received[0], [11], 'each client gets only its own replies');
    await waitFor(() => r.stats().connected === 2, 3000, 'stats');
    assert.equal(r.stats().pid, r.pid, 'the room really runs in the child');
    assert.equal(r.stats().label, 'one');
    assert.ok(r.stats().rssMb > 10 && r.stats().rssMb < 400, `memory is reported: ${r.stats().rssMb} MB`);
    a.close('bye'); // the gateway side closes: the room sees it
    await waitFor(() => r.stats().connected === 1, 3000, 'the room to notice the close');
    assert.equal(r.players, 1);
  } finally {
    await stop(r);
  }
});

test('big binary messages and many of them survive the IPC channel intact', async () => {
  const r = room();
  try {
    await r.ready;
    const c = fakeConn();
    r.join(c);
    const payloads = Array.from({ length: 200 }, (_, i) => Uint8Array.from({ length: 1000 + i }, (__, j) => (i * 7 + j) & 255));
    for (const p of payloads) c.onMessage(p, 0);
    await waitFor(() => c.received.length === 200, 5000, 'all echoes');
    payloads.forEach((p, i) => assert.deepEqual(c.received[i], [...p].map((x) => (x + 1) & 255), `message ${i}`));
  } finally {
    await stop(r);
  }
});

test('a crashing room ends alone: its clients get 1011 with the reason, onExit fires, the process is gone, a sibling is untouched', async () => {
  const doomed = room({}), healthy = room({});
  try {
    await Promise.all([doomed.ready, healthy.ready]);
    const victim = fakeConn(), bystander = fakeConn();
    doomed.join(victim); healthy.join(bystander);
    let exitReason = null;
    doomed.onExit = (r) => { exitReason = r; };
    const pid = doomed.pid;
    doomed.control({ crash: true });
    await waitFor(() => victim.state === 'closed', 5000, 'the victim to be disconnected');
    assert.equal(victim.closed.code, 1011);
    assert.match(victim.closed.reason, /room exited \(code 1\).*boom from room/, victim.closed.reason);
    assert.match(exitReason, /boom from room/);
    await waitFor(() => !alive(pid), 3000, 'the crashed process to be gone');
    bystander.onMessage(new Uint8Array([5]), 0);
    await waitFor(() => bystander.received.length === 1, 3000, 'the sibling to answer');
    assert.equal(bystander.state, 'open');
    const late = fakeConn();
    doomed.join(late);
    assert.equal(late.closed.code, 1011, 'joining a dead room is refused');
  } finally {
    await stop(doomed, healthy);
  }
});

test('a memory bomb is killed by its heap cap, takes only its own process, and the gateway does not balloon', async () => {
  const bomb = room({}, { memoryMb: 48, inheritStderr: false }), sibling = room({});
  try {
    await Promise.all([bomb.ready, sibling.ready]);
    const victim = fakeConn();
    bomb.join(victim);
    const rssBefore = process.memoryUsage().rss;
    const t0 = Date.now();
    bomb.control({ bomb: true });
    await waitFor(() => victim.state === 'closed', 15_000, 'the bomb room to die');
    assert.ok(Date.now() - t0 < 10_000, `died in ${Date.now() - t0} ms`);
    assert.equal(victim.closed.code, 1011);
    assert.match(victim.closed.reason, /room exited/);
    assert.ok(process.memoryUsage().rss - rssBefore < 150e6, 'the gateway process itself did not grow');
    const probe = fakeConn();
    sibling.join(probe);
    probe.onMessage(new Uint8Array([1]), 0);
    await waitFor(() => probe.received.length === 1, 3000, 'the sibling to keep answering');
  } finally {
    await stop(bomb, sibling);
  }
});

test('a hung room cannot stall its sibling, and stop() kills it after the grace period', async () => {
  const hung = room({}, { stopTimeoutMs: 300 }), sibling = room({});
  try {
    await Promise.all([hung.ready, sibling.ready]);
    const c = fakeConn();
    sibling.join(c);
    hung.control({ hang: 2500 });
    let worst = 0;
    for (let i = 0; i < 30; i++) { // 30 round trips to the sibling while the other room is frozen
      const t = performance.now();
      const n = c.received.length;
      c.onMessage(new Uint8Array([i]), 0);
      await waitFor(() => c.received.length > n, 3000, 'sibling reply');
      worst = Math.max(worst, performance.now() - t);
      await sleep(20);
    }
    assert.ok(worst < 100, `worst sibling round trip ${worst.toFixed(1)} ms`);
    const pid = hung.pid;
    const t0 = Date.now();
    await hung.stop(); // the room cannot answer 'stop' while blocked: it is killed after 300 ms
    assert.ok(Date.now() - t0 < 2000, `stop took ${Date.now() - t0} ms`);
    assert.ok(!alive(pid));
  } finally {
    await stop(hung, sibling);
  }
});

test('confinement: with the permission model a room cannot read elsewhere, write, or spawn; env is scrubbed either way', async () => {
  process.env.ENGINE_TEST_SECRET = 'do-not-leak';
  const dir = mkdtempSync(join(tmpdir(), 'engine-room-'));
  const other = join(dir, 'secret.txt');
  writeFileSync(other, 'secret');
  const probeArgs = { probe: true, other, writeTo: join(dir, 'out.txt') };
  const open = room({}), locked = room({}, { confine: { fsRead: [FIXTURE_DIR] } });
  try {
    await Promise.all([open.ready, locked.ready]);
    open.control(probeArgs); locked.control(probeArgs);
    await waitFor(() => open.stats().probe && locked.stats().probe, 5000, 'probe results');
    const o = open.stats().probe, l = locked.stats().probe;
    assert.deepEqual([o.readOther, o.write, o.spawn], ['ALLOWED', 'ALLOWED', 'ALLOWED'], 'control: an unconfined room can do all of it (so the test can detect confinement)');
    assert.equal(l.readOwnDir, 'ALLOWED', 'it can read what it was given');
    assert.equal(l.readOther, 'blocked:ERR_ACCESS_DENIED');
    assert.equal(l.write, 'blocked:ERR_ACCESS_DENIED');
    assert.equal(l.spawn, 'blocked:ERR_ACCESS_DENIED');
    for (const r of [open, locked]) {
      assert.equal(r.stats().secret, null, 'the gateway\'s secret never reaches a room');
      assert.ok(r.stats().env <= 15, `${r.stats().env} environment variables`);
    }
    // and confinement does not break normal work
    const c = fakeConn();
    locked.join(c);
    c.onMessage(new Uint8Array([9]), 0);
    await waitFor(() => c.received.length === 1, 3000, 'confined room to answer');
  } finally {
    delete process.env.ENGINE_TEST_SECRET;
    await stop(open, locked);
  }
});

test('startup problems are reported, not hung: missing export, a throwing room, a slow start', async () => {
  const bad = new ProcessRoom({ name: 'x', module: new URL('./fixtures/echo-room.js', import.meta.url), options: { failToStart: true } });
  await assert.rejects(bad.ready, /refusing to start/);
  const none = new ProcessRoom({ name: 'y', module: new URL('./fixtures/not-a-room.js', import.meta.url) });
  await assert.rejects(none.ready, /Cannot find module|ERR_MODULE_NOT_FOUND|failed to start/);
  const slow = new ProcessRoom({ name: 'z', module: FIXTURE, options: { slowStart: 5000 }, startTimeoutMs: 400 });
  const pid = slow.pid;
  await assert.rejects(slow.ready, /did not start within 400 ms/);
  await waitFor(() => !alive(pid), 3000, 'the slow process to be killed');
});

test('a room process never outlives the gateway that started it', async () => {
  const pidFile = join(mkdtempSync(join(tmpdir(), 'engine-orphan-')), 'pid.txt');
  const script = `
    import { writeFileSync } from 'node:fs';
    import { ProcessRoom } from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)};
    const r = new ProcessRoom({ name: 'orphan', module: ${JSON.stringify(FIXTURE.href)} });
    await r.ready;
    writeFileSync(${JSON.stringify(pidFile)}, String(r.pid));
    process.kill(process.pid, 'SIGKILL'); // the gateway dies without any cleanup
  `;
  await new Promise((resolve) => execFile(process.execPath, ['--input-type=module', '-e', script], () => resolve()));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0 && pid !== process.pid);
  await waitFor(() => !alive(pid), 5000, 'the orphaned room process to exit on its own');
});

test('RoomManager runs rooms in process mode, reports them, applies host options, and rejects unknown modes', async () => {
  assert.throws(() => new RoomManager({ module: FIXTURE, mode: 'fork' }), /unknown room mode/);
  const m = new RoomManager({ module: FIXTURE, mode: 'process', hostOptions: { memoryMb: 64 }, defaultOptions: { label: 'dflt' }, idleCloseMs: 300, maxRooms: 2 });
  try {
    const a = fakeConn();
    await m.join('alpha', a);
    await waitFor(() => m.list()[0]?.connected === 1, 3000, 'listing');
    const [row] = m.list();
    assert.equal(row.mode, 'process');
    assert.equal(row.label, 'dflt', 'default options reach createRoom');
    assert.ok(row.rssMb > 0 && row.pid !== process.pid);
    const pid = m.rooms.get('alpha').handle.pid;
    a.close('leaving');
    await waitFor(() => !m.rooms.has('alpha'), 5000, 'idle room to be closed');
    await waitFor(() => !alive(pid), 3000, 'its process to end');
    // a crash is counted and the name is reusable
    const b = fakeConn();
    await m.join('beta', b);
    m.rooms.get('beta').handle.control({ crash: true });
    await waitFor(() => b.state === 'closed', 5000, 'crash disconnect');
    assert.equal(m.stats.crashed, 1);
    const c = fakeConn();
    await m.join('beta', c);
    assert.equal(c.state, 'open');
  } finally {
    await m.close();
  }
});

test('worker and process hosts behave the same through the shared base', async () => {
  for (const Host of [WorkerRoom, ProcessRoom]) {
    const r = new Host({ name: 'same', module: FIXTURE, options: {} });
    try {
      await r.ready;
      const c = fakeConn();
      r.join(c);
      c.onMessage(new Uint8Array([41]), 0);
      await waitFor(() => c.received.length === 1, 3000, `${Host.name} echo`);
      assert.deepEqual(c.received[0], [42]);
      let reason = null;
      r.onExit = (x) => { reason = x; };
      r.control({ crash: true });
      await waitFor(() => c.state === 'closed', 5000, `${Host.name} crash`);
      assert.equal(c.closed.code, 1011, Host.name);
      assert.ok(reason, `${Host.name}: onExit fired`);
    } finally {
      await stop(r);
    }
  }
});
