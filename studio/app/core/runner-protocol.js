// The messages the game's frame sends to the studio. The code running in that frame may be somebody else's (a project that was shared), so the studio never
// trusts a message: every one is checked here, strings are shortened, numbers must be numbers, and anything unknown is dropped.

import { validPath, checkReplay } from '../../runner/timeline.js';

const MAX_TEXT = 2000;
const MAX_STATE_JSON = 200_000;
const TIME_OPS = new Set(['pause', 'play', 'seek', 'step', 'replay', 'export']);
const KINDS = new Set(['load', 'run', 'worker']);
const LEVELS = new Set(['log', 'info', 'warn', 'error']);

const ints = (list) => (Array.isArray(list) ? list.slice(0, 5000).map(int).filter((n) => n !== undefined) : []);
const replayOrNull = (r) => { try { return checkReplay(r); } catch { return null; } };
const num = (v) => (Number.isFinite(v) && v >= 0 && v < 1e9 ? v : null);
const cleanPerf = (p) => {
  if (!p || typeof p !== 'object') return undefined;
  const f = p.frame && typeof p.frame === 'object' ? { avg: num(p.frame.avg), p95: num(p.frame.p95), max: num(p.frame.max),
    samples: int(p.frame.samples) ?? 0 } : null;
  return { frame: f, heapMB: num(p.heapMB), firstFrameMs: num(p.firstFrameMs) };
};
/** Frames from the profiler: [update, render, other, ticks, draws, things, gap, tick, marks, functions], times in milliseconds, at most 120 a message. */
const cleanProfile = (p) => {
  if (!p || typeof p !== 'object' || !Array.isArray(p.frames)) return undefined;
  const ms = (v) => (Number.isFinite(v) && v >= 0 && v < 1e6 ? Math.round(v * 100) / 100 : 0);
  const frames = p.frames.slice(0, 120).filter((f) => Array.isArray(f) && f.length >= 8).map((f) => [
    ms(f[0]), ms(f[1]), ms(f[2]), int(f[3]) ?? 0, int(f[4]) ?? 0,
    Number.isFinite(f[5]) ? Math.max(-1, Math.min(1e7, Math.trunc(f[5]))) : -1, ms(f[6]), int(f[7]) ?? 0,
    Array.isArray(f[8]) ? f[8].slice(0, 16).filter((m) => Array.isArray(m)).map((m) => [text(m[0], 24), ms(m[1]), int(m[2]) ?? 0]) : [],
    Array.isArray(f[9]) ? f[9].slice(0, 40).filter((m) => Array.isArray(m)).map((m) => [text(m[0], 40), ms(m[1]), ms(m[2]), int(m[3]) ?? 0]) : [],
  ]);
  return { frames, heapMB: num(p.heapMB) };
};
const text = (v, max = MAX_TEXT) => String(v ?? '').slice(0, max);
const int = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1e9, Math.trunc(v))) : undefined);
const small = (v) => {
  try { const s = JSON.stringify(v); return s !== undefined && s.length <= MAX_STATE_JSON ? JSON.parse(s) : undefined; } catch { return undefined; }
};

/** A lockstep message (the keys held on a tick, or a fingerprint of the game), checked and copied; anything else is dropped. Also used on what a friend sends. */
export function cleanNetMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const keys = (k) => Array.isArray(k) && k.length <= 24 && k.every((c) => typeof c === 'string' && c.length <= 40);
  if (m.t === 'in' && Number.isInteger(m.f) && m.f >= 0 && keys(m.k)) return { t: 'in', f: m.f, k: [...m.k] };
  if (m.t === 'sum' && Number.isInteger(m.f) && m.f >= 0 && typeof m.h === 'string' && m.h.length <= 40) return { t: 'sum', f: m.f, h: m.h };
  return null;
}

/**
 * Check a message from the runner.
 * @param {unknown} data what arrived
 * @returns {null | {t: string, [key: string]: any}} a clean copy, or null if it is not a message the studio understands
 */
export function parseRunnerMessage(data) {
  if (!data || typeof data !== 'object' || typeof data.t !== 'string') return null;
  switch (data.t) {
    case 'ready': return { t: 'ready' };
    case 'beat': {
      const beat = {
        t: 'beat', frame: int(data.frame) ?? 0,
        summary: data.summary === undefined ? undefined : small(data.summary),
        stateProblem: data.stateProblem ? text(data.stateProblem, 300) : undefined,
      };
      const perf = cleanPerf(data.perf);
      if (perf) beat.perf = perf;
      const profile = cleanProfile(data.profile);
      if (profile) beat.profile = profile;
      if (data.net && typeof data.net === 'object') {
        const n = data.net;
        beat.net = { waiting: !!n.waiting, tick: int(n.tick) ?? 0, stalls: int(n.stalls) ?? 0, desync: int(n.desync) ?? null };
      }
      return beat;
    }
    case 'applied': return {
      t: 'applied', run: int(data.run) ?? 0, ms: int(data.ms) ?? 0, restarted: !!data.restarted,
      summary: data.summary === undefined ? undefined : small(data.summary),
    };
    case 'error': return {
      t: 'error', kind: KINDS.has(data.kind) ? data.kind : 'run', message: text(data.message),
      file: data.file === undefined ? undefined : text(data.file, 200), line: int(data.line), column: int(data.column),
    };
    case 'timeline': return {
      t: 'timeline', tick: int(data.tick) ?? 0, from: int(data.from) ?? 0, to: int(data.to) ?? 0, paused: !!data.paused,
      mode: data.mode === 'replay' ? 'replay' : 'live', replayEnded: !!data.replayEnded, bytes: int(data.bytes) ?? 0,
      snapshots: ints(data.snapshots), edits: ints(data.edits),
      diverged: data.diverged && int(data.diverged.tick) !== undefined ? { tick: int(data.diverged.tick) } : null,
    };
    case 'state': return {
      t: 'state', tick: int(data.tick) ?? 0, tooBig: !!data.tooBig, bytes: int(data.bytes) ?? 0,
      state: data.state === undefined ? undefined : small(data.state),
    };
    case 'replay': return { t: 'replay', replay: data.replay ? replayOrNull(data.replay) : null };
    case 'verified': return {
      t: 'verified', ok: !!data.ok, ticks: int(data.ticks) ?? 0, checked: int(data.checked) ?? 0,
      divergedAt: data.divergedAt === null || data.divergedAt === undefined ? null : int(data.divergedAt) ?? null,
      error: data.error ? text(data.error, 300) : undefined,
    };
    case 'played': return { t: 'played' };
    case 'picked': return { t: 'picked', path: data.path === null ? null : validPath(data.path) ? data.path : null };
    case 'overlay-key': return { t: 'overlay-key' };
    case 'fullscreen-key': return { t: 'fullscreen-key' };
    case 'mouse': return { t: 'mouse', locked: !!data.locked, problem: data.problem === undefined ? undefined : text(data.problem, 120) };
    case 'engine-offline': return { t: 'engine-offline', complete: !!data.complete, done: int(data.done) ?? 0, total: int(data.total) ?? 0 };
    case 'testResults': return {
      t: 'testResults', id: int(data.id) ?? 0, message: data.message ? text(data.message, 300) : undefined,
      results: (Array.isArray(data.results) ? data.results : []).slice(0, 500).filter((r) => r && typeof r === 'object').map((r) => ({
        file: text(r.file, 120), name: text(r.name, 200), ok: !!r.ok, ms: int(r.ms) ?? 0,
        error: r.error && typeof r.error === 'object'
          ? { message: text(r.error.message, 300), expected: r.error.expected === undefined ? undefined : text(r.error.expected, 150),
            actual: r.error.actual === undefined ? undefined : text(r.error.actual, 150) } : undefined,
      })),
    };
    case 'netOut': {
      const m = cleanNetMessage(data.message);
      return m ? { t: 'netOut', message: m } : null;
    }
    case 'hang': return { t: 'hang' };
    case 'recovered': return { t: 'recovered', run: int(data.run) ?? 0, fromSnapshot: !!data.fromSnapshot };
    case 'log': return { t: 'log', level: LEVELS.has(data.level) ? data.level : 'log', text: text(data.text, 1000) };
    default: return null;
  }
}

/** Messages the studio sends to the runner, checked the same way on the other side. @returns {boolean} */
export function isStudioMessage(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.t === 'run') return Number.isInteger(data.run) && data.files && typeof data.files === 'object';
  if (data.t === 'resetProgress') return true;
  if (data.t === 'tests') return Number.isInteger(data.id) && data.files && typeof data.files === 'object' && Array.isArray(data.paths);
  if (data.t === 'key') return typeof data.code === 'string' && data.code.length < 40;
  if (data.t === 'visible') return typeof data.value === 'boolean';
  if (data.t === 'time') {
    const optionalInt = (v) => v === undefined || Number.isInteger(v);
    return TIME_OPS.has(data.op) && optionalInt(data.tick) && optionalInt(data.n);
  }
  if (data.t === 'watch') return typeof data.on === 'boolean';
  if (data.t === 'profile') return typeof data.on === 'boolean';
  if (data.t === 'mute') return typeof data.value === 'boolean';
  if (data.t === 'select') return data.path === null || validPath(data.path);
  if (data.t === 'edit') return validPath(data.path) && (data.value === null || ['number', 'string', 'boolean'].includes(typeof data.value));
  if (data.t === 'net') {
    if (data.op === 'stop') return true;
    const within = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    if (data.op === 'start') return within(data.players, 2, 8) && within(data.me, 0, data.players - 1) && within(data.delay, 0, 30);
    return data.op === 'msg' && Number.isInteger(data.from) && data.from >= 0 && data.from < 8 && cleanNetMessage(data.message) !== null;
  }
  if (data.t === 'loadReplay') return !!data.replay && typeof data.replay === 'object';
  return data.t === 'stop';
}
