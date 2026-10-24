// Load test: hundreds of real clients against the arena server, over real WebSockets.
//   node tools/loadtest.js [--players 200] [--rooms n] [--mode process|worker|inline] [--duration 20] [--ramp 100] [--workers n]
//                          [--room-bots 20] [--input-hz 60] [--fire-every 2] [--json file] [--no-assert] [--smoke]
// The bots run in worker threads (about 100 each) so they do not slow the server; the arena gateway runs here with its rooms in their own
// processes. After everyone has joined, it measures for --duration seconds and reports join times, how evenly snapshots arrive, bandwidth,
// and the server's tick times against the 60 Hz budget. Exits 1 if something is out of bounds (see tools/loadtest-lib.js).
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { startArenaGateway } from '../examples/arena/server/gateway.js';
import { combine, summarize, evaluate, formatReport } from './loadtest-lib.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); if (i < 0) return dflt; const v = args[i + 1]; return v === undefined || v.startsWith('--') ? true : (Number.isNaN(Number(v)) ? v : Number(v)); };
const smoke = opt('smoke', false);
const players = opt('players', smoke ? 48 : 200);
const perRoom = opt('players-per-room', 30);
const rooms = opt('rooms', Math.ceil(players / perRoom));
const mode = opt('mode', 'process');
const duration = opt('duration', smoke ? 6 : 20);
const ramp = opt('ramp', 100);
// gentle on the machine: at most a quarter of the cores for bot threads, everything at below-normal priority, and no huge runs without --force
const workers = opt('workers', Math.max(1, Math.min(Math.ceil(players / 100), Math.floor(os.cpus().length / 4))));
const roomBots = opt('room-bots', smoke ? 5 : 20);
const inputHz = opt('input-hz', 60), fireEvery = opt('fire-every', 2);
const MAX_PLAYERS_WITHOUT_FORCE = 300;
if (players > MAX_PLAYERS_WITHOUT_FORCE && !opt('force', false)) { console.error(`${players} players is a heavy test for one machine (it also slows everything else you are running). ${MAX_PLAYERS_WITHOUT_FORCE} and under run as they are; add --force for more.`); process.exit(2); }
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on at normal priority */ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`load test: ${players} players in ${rooms} rooms (${mode} mode, ${roomBots} server bots per room), ${workers} bot threads, ramp ${ramp}/s, measuring ${duration} s`);
console.log(`machine: ${os.cpus().length} logical CPUs, Node ${process.version}\n`);

const gateway = await startArenaGateway({
  port: 0, serveStatic: false, mode, maxRooms: rooms + 2, maxPlayers: Math.max(perRoom + 4, 32), idleCloseMs: 0, defaultRoom: 'load0',
  roomOptions: { bots: roomBots }, limits: { maxConnectionsPerIp: 100_000 },
  roomHost: { priority: os.constants.priority.PRIORITY_BELOW_NORMAL, memoryMb: 512 },
});
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();

// bot threads: split the players between them
const threads = [];
const per = Math.ceil(players / workers);
for (let w = 0; w < workers; w++) {
  const first = w * per, count = Math.min(per, players - first);
  if (count <= 0) break;
  const worker = new Worker(new URL('./loadtest-worker.js', import.meta.url), { workerData: { host: '127.0.0.1', port: gateway.port, rooms, first, count, rampPerSecond: ramp / workers, inputHz, fireEverySeconds: fireEvery, seed: 12345 } });
  const t = { worker, status: { playing: 0, spawned: 0, failed: 0, dropped: 0 }, final: null, error: null };
  worker.on('message', (m) => { if (m.t === 'status') t.status = m; else if (m.t === 'final') t.final = m.report; });
  worker.on('error', (e) => { t.error = e; console.error(`bot thread ${w} crashed: ${e.stack ?? e}`); });
  threads.push(t);
}
const ask = () => threads.forEach((t) => t.worker.postMessage({ t: 'status' }));

let exitCode = 0;
try {
  // everyone joins
  const joinDeadline = Date.now() + (players / ramp) * 1000 + 30_000;
  for (;;) {
    ask(); await sleep(250);
    const done = threads.reduce((a, t) => a + t.status.playing + t.status.failed + t.status.dropped, 0);
    if (process.stdout.isTTY) process.stdout.write(`\rjoining: ${threads.reduce((a, t) => a + t.status.playing, 0)} playing, ${threads.reduce((a, t) => a + t.status.failed, 0)} failed   `);
    if (done >= players || Date.now() > joinDeadline || threads.some((t) => t.error)) break;
  }
  if (process.stdout.isTTY) console.log('');
  await sleep(1500); // let the rooms settle

  // measure
  threads.forEach((t) => t.worker.postMessage({ t: 'measure' })); loop.reset();
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < duration * 1000) {
    await sleep(500);
    samples.push(gateway.manager.list().map((r) => ({ name: r.name, players: r.players, tickMsAvg: r.tickMsAvg ?? 0, tickMsMax: r.tickMsMax ?? 0 })));
    if (process.stdout.isTTY) process.stdout.write(`\rmeasuring: ${((Date.now() - t0) / 1000).toFixed(0)} / ${duration} s   `);
  }
  if (process.stdout.isTTY) console.log('');
  const seconds = (Date.now() - t0) / 1000;
  const roomsNow = gateway.manager.list();
  const loopLag = loop.percentile(99) / 1e6, mem = process.memoryUsage(), heap = (mem.heapUsed + mem.arrayBuffers) / 1048576; // this thread only: the gateway, not the bot threads
  threads.forEach((t) => t.worker.postMessage({ t: 'stop' }));
  for (let i = 0; i < 100 && threads.some((t) => !t.final && !t.error); i++) await sleep(100);

  const totals = combine(threads.filter((t) => t.final).map((t) => t.final));
  totals.bots = players;
  const report = summarize(totals, { seconds, rooms: roomsNow.map((r) => ({ players: r.players, tickMsAvg: r.tickMsAvg ?? 0, tickMsMax: r.tickMsMax ?? 0 })), serverLoopLagP99: loopLag, serverHeapMb: heap });
  // the worst single tick over the whole measurement, not only the last stats window
  report.server.worstTickMs = Math.max(report.server.worstTickMs, ...samples.flat().map((r) => r.tickMsMax));
  const limits = {};
  for (const [flag, key] of [['max-gap', 'maxSnapshotGapP99Ms'], ['max-tick', 'maxWorstRoomTickMsAvg'], ['max-failed', 'maxFailedFraction'], ['max-dropped', 'maxDropped']]) { const v = opt(flag, undefined); if (v !== undefined) limits[key] = v; }
  const problems = threads.some((t) => t.error) ? ['a bot thread crashed'] : evaluate(report, limits);
  console.log(`\n${formatReport(report, problems)}`);
  if (totals.rejected.length) console.log(`\nwhy some could not join: ${totals.rejected.join('; ')}`);
  const json = opt('json', null);
  if (typeof json === 'string') writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  if (problems.length && !opt('no-assert', false)) exitCode = 1;
  else console.log(problems.length ? '\n(problems ignored: --no-assert)' : '\nPASS');
} catch (e) {
  console.error(e.stack ?? e); exitCode = 1;
} finally {
  for (const t of threads) t.worker.terminate();
  await gateway.close().catch(() => {});
}
process.exit(exitCode);
