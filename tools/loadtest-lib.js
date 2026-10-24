// The numbers side of the load test: histograms that can be added together across worker threads, and the pass / fail rules.

/** A histogram with equal-width buckets (the last one catches everything above). Cheap to record into and to merge. */
export class Histogram {
  /** @param {number} width Bucket width (e.g. 1 for milliseconds) @param {number} buckets */
  constructor(width = 1, buckets = 1000) { this.width = width; this.counts = new Uint32Array(buckets); this.n = 0; this.max = 0; this.sum = 0; }
  record(v) { const i = Math.min(this.counts.length - 1, Math.max(0, Math.floor(v / this.width))); this.counts[i]++; this.n++; this.sum += v; if (v > this.max) this.max = v; }
  merge(other) { for (let i = 0; i < this.counts.length; i++) this.counts[i] += other.counts[i]; this.n += other.n; this.sum += other.sum; this.max = Math.max(this.max, other.max); return this; }
  get mean() { return this.n ? this.sum / this.n : 0; }
  /** The value below which a fraction `q` (0..1) of the samples fall (to bucket resolution; the top bucket reports the real maximum). */
  percentile(q) {
    if (!this.n) return 0;
    const target = Math.ceil(q * this.n);
    let seen = 0;
    for (let i = 0; i < this.counts.length; i++) { seen += this.counts[i]; if (seen >= target) return i === this.counts.length - 1 ? this.max : (i + 1) * this.width; }
    return this.max;
  }
  toJSON() { return { width: this.width, counts: [...this.counts], n: this.n, max: this.max, sum: this.sum }; }
  static from(json) { const h = new Histogram(json.width, json.counts.length); h.counts.set(json.counts); h.n = json.n; h.max = json.max; h.sum = json.sum; return h; }
}

/** Add up the final reports of the worker threads. @param {any[]} reports */
export function combine(reports) {
  const total = { bots: 0, started: 0, playing: 0, failedToJoin: 0, dropped: 0, snapshots: 0, bytesDown: 0, bytesUp: 0, loopLagP99: 0, handshake: new Histogram(10, 3000), gap: new Histogram(1, 1000), rejected: [] };
  for (const r of reports) {
    for (const k of ['bots', 'started', 'playing', 'failedToJoin', 'dropped', 'snapshots', 'bytesDown', 'bytesUp']) total[k] += r[k];
    total.loopLagP99 = Math.max(total.loopLagP99, r.loopLagP99);
    total.handshake.merge(Histogram.from(r.handshake)); total.gap.merge(Histogram.from(r.gap));
    total.rejected.push(...r.rejected);
  }
  return total;
}

/**
 * Turn the raw totals and the server samples into the report.
 * @param {ReturnType<typeof combine>} t
 * @param {{seconds: number, rooms: Array<{players: number, tickMsAvg: number, tickMsMax: number}>, serverLoopLagP99: number, serverHeapMb: number, tickRate?: number}} s
 */
export function summarize(t, s) {
  const per = Math.max(1, t.playing);
  const avgTick = s.rooms.length ? s.rooms.reduce((a, r) => a + r.tickMsAvg, 0) / s.rooms.length : 0;
  return {
    players: { requested: t.bots, started: t.started, playing: t.playing, failedToJoin: t.failedToJoin, dropped: t.dropped },
    handshakeMs: { p50: t.handshake.percentile(0.5), p95: t.handshake.percentile(0.95), p99: t.handshake.percentile(0.99), max: t.handshake.max },
    snapshotGapMs: { p50: t.gap.percentile(0.5), p95: t.gap.percentile(0.95), p99: t.gap.percentile(0.99), p999: t.gap.percentile(0.999), max: t.gap.max },
    snapshotsPerSecondPerPlayer: t.snapshots / per / s.seconds,
    downKBpsPerPlayer: t.bytesDown / per / s.seconds / 1024, upKBpsPerPlayer: t.bytesUp / per / s.seconds / 1024,
    server: { rooms: s.rooms.length, playersInRooms: s.rooms.reduce((a, r) => a + r.players, 0), tickMsAvg: avgTick, worstRoomTickMsAvg: Math.max(0, ...s.rooms.map((r) => r.tickMsAvg)), worstTickMs: Math.max(0, ...s.rooms.map((r) => r.tickMsMax)), tickBudgetMs: 1000 / (s.tickRate ?? 60), gatewayLoopLagP99Ms: s.serverLoopLagP99, gatewayHeapMb: s.serverHeapMb },
    clientLoopLagP99Ms: t.loopLagP99, measuredSeconds: s.seconds,
  };
}

/** Default limits: a healthy server at this load. @type {Record<string, number>} */
export const DEFAULT_LIMITS = { maxFailedFraction: 0.01, maxDropped: 0, maxSnapshotGapP99Ms: 150, maxWorstRoomTickMsAvg: 8, maxClientLoopLagP99Ms: 60, minSnapshotsPerSecond: 20 };

/** The problems with a report (an empty list means it passed). */
export function evaluate(report, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits }, out = [];
  const p = report.players;
  if (p.requested && p.failedToJoin / p.requested > L.maxFailedFraction) out.push(`${p.failedToJoin} of ${p.requested} players could not join (limit ${(L.maxFailedFraction * 100).toFixed(1)} %)`);
  if (p.dropped > L.maxDropped) out.push(`${p.dropped} players were disconnected during the test (limit ${L.maxDropped})`);
  if (report.clientLoopLagP99Ms > L.maxClientLoopLagP99Ms) out.push(`the bot threads were overloaded (event loop lag p99 ${report.clientLoopLagP99Ms.toFixed(0)} ms): the numbers below are about the bots, not the server; use more workers or fewer bots`);
  else {
    if (report.snapshotGapMs.p99 > L.maxSnapshotGapP99Ms) out.push(`snapshots arrived with gaps: p99 ${report.snapshotGapMs.p99} ms (limit ${L.maxSnapshotGapP99Ms})`);
    if (report.snapshotsPerSecondPerPlayer < L.minSnapshotsPerSecond) out.push(`players got only ${report.snapshotsPerSecondPerPlayer.toFixed(1)} snapshots a second (limit ${L.minSnapshotsPerSecond})`);
  }
  if (report.server.worstRoomTickMsAvg > L.maxWorstRoomTickMsAvg) out.push(`a room's average tick took ${report.server.worstRoomTickMsAvg.toFixed(2)} ms (limit ${L.maxWorstRoomTickMsAvg}, budget ${report.server.tickBudgetMs.toFixed(1)})`);
  return out;
}

/** The report as text. */
export function formatReport(r, problems = []) {
  const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  const lines = [
    `players        ${r.players.playing} playing of ${r.players.requested} requested   (${r.players.failedToJoin} failed to join, ${r.players.dropped} dropped)`,
    `join time      p50 ${r.handshakeMs.p50} ms   p95 ${r.handshakeMs.p95} ms   p99 ${r.handshakeMs.p99} ms   max ${f(r.handshakeMs.max, 0)} ms`,
    `snapshot gaps  p50 ${r.snapshotGapMs.p50} ms   p95 ${r.snapshotGapMs.p95} ms   p99 ${r.snapshotGapMs.p99} ms   p99.9 ${r.snapshotGapMs.p999} ms   max ${f(r.snapshotGapMs.max, 0)} ms`,
    `per player     ${f(r.snapshotsPerSecondPerPlayer)} snapshots/s   down ${f(r.downKBpsPerPlayer)} KB/s   up ${f(r.upKBpsPerPlayer)} KB/s`,
    `server         ${r.server.rooms} rooms, ${r.server.playersInRooms} players: tick avg ${f(r.server.tickMsAvg, 2)} ms (worst room ${f(r.server.worstRoomTickMsAvg, 2)} ms, worst single tick ${f(r.server.worstTickMs, 1)} ms, budget ${f(r.server.tickBudgetMs)} ms)`,
    `               gateway event loop lag p99 ${f(r.server.gatewayLoopLagP99Ms)} ms, ${f(r.server.gatewayHeapMb, 0)} MB of memory in use`,
    `bots           event loop lag p99 ${f(r.clientLoopLagP99Ms)} ms over ${f(r.measuredSeconds, 0)} s`,
  ];
  if (problems.length) lines.push('', ...problems.map((p) => `PROBLEM: ${p}`));
  return lines.join('\n');
}
