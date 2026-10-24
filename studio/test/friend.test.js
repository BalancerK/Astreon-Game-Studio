import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FriendLink, fingerprint } from '../app/net/friend.js';
import { FakePeerConnection } from '../../packages/transport/test/fake-rtc.js';

const rtc = { RTCPeerConnection: FakePeerConnection };
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 2000, what = 'condition') { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await wait(2); } }

/** Two links connected through the codes, as two people would do it. */
async function connect(a = 'same', b = 'same') {
  FakePeerConnection.reset();
  const host = new FriendLink({ fingerprint: a, rtc }), friend = new FriendLink({ fingerprint: b, rtc });
  const log = { host: [], friend: [] };
  for (const [name, link] of [['host', host], ['friend', friend]]) for (const ev of ['connected', 'mismatch', 'ready', 'closed']) link.on(ev, (x) => log[name].push([ev, x]));
  const code = await host.invite();
  const answer = await friend.join(code);
  await host.accept(answer);
  return { host, friend, log };
}

test('a fingerprint tells whether two projects are the same', () => {
  const a = { 'src/main.js': 'export const x = 1;', 'assets/a.png': new Uint8Array([1, 2, 3]) };
  assert.equal(fingerprint(a), fingerprint({ 'assets/a.png': new Uint8Array([1, 2, 3]), 'src/main.js': 'export const x = 1;' }), 'the order of the files does not matter');
  assert.notEqual(fingerprint(a), fingerprint({ ...a, 'src/main.js': 'export const x = 2;' })); assert.notEqual(fingerprint(a), fingerprint({ ...a, 'extra.txt': '' })); assert.match(fingerprint(a), /^[0-9a-f]{16}$/);
});

test('two people with the same game join with a pair of codes, and both are told to start', async () => {
  const { host, friend, log } = await connect();
  await waitFor(() => host.state === 'ready' && friend.state === 'ready', 3000, 'both ready');
  assert.deepEqual(log.host.find((e) => e[0] === 'ready')[1], { me: 0, players: 2 }); assert.deepEqual(log.friend.find((e) => e[0] === 'ready')[1], { me: 1, players: 2 });
  assert.ok(log.host.some((e) => e[0] === 'connected') && log.friend.some((e) => e[0] === 'connected')); host.close(); await waitFor(() => friend.state === 'closed');
});

test('messages sent before the other side has started are kept until it has', async () => {
  const { host, friend } = await connect();
  const got = []; friend.on('message', (m) => got.push(m)); const hostGot = []; host.on('message', (m) => hostGot.push(m));
  await waitFor(() => host.state === 'ready' && friend.state === 'ready', 3000);
  assert.equal(friend.send({ t: 'in', f: 3, k: ['ArrowLeft'] }), true); await wait(30);
  assert.deepEqual(hostGot, [], 'the host has not released yet, so it holds the message');
  host.release(); assert.deepEqual(hostGot, [{ from: 1, message: { t: 'in', f: 3, k: ['ArrowLeft'] } }]);
  friend.release(); host.send({ t: 'sum', f: 60, h: 'abc' }); await waitFor(() => got.length === 1); assert.deepEqual(got[0], { from: 0, message: { t: 'sum', f: 60, h: 'abc' } });
  assert.equal(host.send({ t: 'junk' }), false, 'only lockstep messages go out'); host.close();
});

test('people with different games are told, and the link closes', async () => {
  const { host, friend, log } = await connect('mine', 'theirs');
  await waitFor(() => host.state === 'closed' && friend.state === 'closed', 3000, 'both closed');
  assert.ok(log.host.some((e) => e[0] === 'mismatch' && e[1].theirs === 'theirs')); assert.ok(log.friend.some((e) => e[0] === 'mismatch'));
  assert.ok(!log.host.some((e) => e[0] === 'ready'), 'nobody starts');
});

test('a wrong code, a link used twice, and sending too early all say so', async () => {
  FakePeerConnection.reset();
  const a = new FriendLink({ fingerprint: 'x', rtc });
  await assert.rejects(a.join('nonsense'), /not an invitation code/); assert.equal(a.send({ t: 'in', f: 0, k: [] }), false);
  const b = new FriendLink({ fingerprint: 'x', rtc }); await b.invite(); await assert.rejects(b.invite(), /already in use/); await assert.rejects(new FriendLink({ rtc }).accept('x'), /make an invitation first/);
  b.close();
});

test('the friend leaving ends the link with a reason', async () => {
  const { host, friend, log } = await connect();
  await waitFor(() => host.state === 'ready' && friend.state === 'ready', 3000);
  friend.close('bye'); await waitFor(() => host.state === 'closed'); assert.ok(log.host.some((e) => e[0] === 'closed'));
});
