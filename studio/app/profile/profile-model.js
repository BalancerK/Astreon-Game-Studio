// Reading the profiler's frames: what a frame cost, how the cost is split, which frames were slow and why, and plain advice in words. The runner measures; this
// only reads numbers, so it is tested in Node. A frame is `{update, render, other, ticks, draws, things, gap, tick, marks}`: milliseconds in the game's update
// (all the ticks of the frame), in its drawing, and in everything else (the Time Machine, outlines); how many ticks were run to catch up; how many draw calls;
// how many things; how long since the last frame; the game's tick; and the times given with the kit's `timed`.

export const BUDGETS = [
  { ms: 16.7, label: '16.7 ms: 60 frames a second' },
  { ms: 8, label: '8 ms: room to spare on a slower device' },
  { ms: 4, label: '4 ms: a lot of room' },
];
export const KEEP = 900;                  // frames kept: fifteen seconds at sixty a second

/** A frame from the compact form the runner sends. */
export function parseFrame(a) {
  return {
    update: a[0], render: a[1], other: a[2], ticks: a[3], draws: a[4], things: a[5], gap: a[6], tick: a[7],
    marks: (a[8] ?? []).map(([name, ms, n]) => ({ name, ms, n })),
    fns: (a[9] ?? []).map(([name, self, total, n]) => ({ name, self, total, n })),
  };
}

export const totalOf = (f) => f.update + f.render + f.other;

/** The most recent frames, as many as `KEEP`. */
export class FrameBuffer {
  constructor(limit = KEEP) { this.limit = limit; this.frames = []; this.heap = []; this.count = 0; }

  /** @param {number[][]} frames compact frames @param {number | null} [heapMB] the memory in use now */
  push(frames, heapMB = null) {
    for (const a of frames) { this.frames.push({ ...parseFrame(a), n: this.count++ }); }
    if (this.frames.length > this.limit) this.frames.splice(0, this.frames.length - this.limit);
    if (Number.isFinite(heapMB)) { this.heap.push({ n: this.count, mb: heapMB }); if (this.heap.length > 200) this.heap.shift(); }
  }

  clear() { this.frames = []; this.heap = []; this.count = 0; }
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const avg = (list) => (list.length ? list.reduce((n, v) => n + v, 0) / list.length : 0);

/**
 * The numbers for a set of frames.
 * @param {ReturnType<typeof parseFrame>[]} frames
 * @param {number} budget milliseconds a frame should fit in
 */
export function summarize(frames, budget = 16.7) {
  if (!frames.length) return null;
  const totals = frames.map(totalOf);
  const sorted = [...totals].sort((a, b) => a - b);
  const gaps = frames.map((f) => f.gap).filter((g) => g > 0);
  const over = totals.filter((t) => t > budget).length;
  const things = frames.map((f) => f.things).filter((n) => n >= 0);
  return {
    frames: frames.length, budget,
    avg: avg(totals), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1),
    over, overShare: over / frames.length,
    update: avg(frames.map((f) => f.update)), render: avg(frames.map((f) => f.render)), other: avg(frames.map((f) => f.other)),
    ticks: avg(frames.map((f) => f.ticks)), catchUp: frames.filter((f) => f.ticks > 1).length,
    draws: avg(frames.map((f) => f.draws)), drawsMax: Math.max(...frames.map((f) => f.draws)),
    things: things.length ? avg(things) : null, thingsMax: things.length ? Math.max(...things) : null,
    fps: gaps.length ? 1000 / avg(gaps) : null, longGaps: gaps.filter((g) => g > 25).length,
  };
}

/** The `timed` sections: for each name, the time it takes in a frame on average (frames without it count as zero), its worst frame, and how often it runs. */
export function markStats(frames) {
  const by = new Map();
  for (const f of frames) {
    for (const m of f.marks) {
      const s = by.get(m.name) ?? { name: m.name, total: 0, max: 0, calls: 0, frames: 0 };
      s.total += m.ms;
      s.max = Math.max(s.max, m.ms);
      s.calls += m.n;
      s.frames++;
      by.set(m.name, s);
    }
  }
  return [...by.values()].map((s) => ({
    name: s.name, perFrame: s.total / frames.length, max: s.max, callsPerFrame: s.calls / frames.length, inFrames: s.frames / frames.length,
  }))
    .sort((a, b) => b.perFrame - a.perFrame);
}

/** What made a frame slow: its biggest part, or a `timed` section inside that part when that section is most of it. */
export function causeOf(f) {
  const parts = [["the game's update", f.update], ['drawing', f.render], ['everything else (the Time Machine and outlines)', f.other]]
    .sort((a, b) => b[1] - a[1]);
  const [what, ms] = parts[0];
  const mark = [...f.marks].sort((a, b) => b.ms - a.ms)[0];
  const fn = [...(f.fns ?? [])].sort((a, b) => b.self - a.self)[0];
  if (fn && fn.self >= ms * 0.5 && (!mark || fn.self > mark.ms)) return { what: `the function ${fn.name}`, ms: fn.self };
  return mark && mark.ms >= ms * 0.5 ? { what: `"${mark.name}"`, ms: mark.ms } : { what, ms };
}

/** The slowest frames over the budget, worst first, each with its cause. */
export function slowFrames(frames, budget = 16.7, limit = 8) {
  return frames.filter((f) => totalOf(f) > budget).sort((a, b) => totalOf(b) - totalOf(a)).slice(0, limit)
    .map((f) => ({ frame: f, total: totalOf(f), cause: causeOf(f) }));
}

/** Times the heap dropped by at least a megabyte between two readings: the browser tidying up (garbage collection). */
export function memoryDrops(heap, mb = 1) {
  let drops = 0;
  for (let i = 1; i < heap.length; i++) if (heap[i - 1].mb - heap[i].mb >= mb) drops++;
  return drops;
}

/** Do the slow frames come at regular spacing (every so many frames)? Returns the spacing, or null. */
export function rhythm(frames, budget) {
  const at = frames.filter((f) => totalOf(f) > budget).map((f) => f.n);
  if (at.length < 4) return null;
  const gaps = at.slice(1).map((n, i) => n - at[i]).filter((g) => g > 1);
  if (gaps.length < 3) return null;
  const mean = avg(gaps);
  const spread = Math.sqrt(avg(gaps.map((g) => (g - mean) ** 2)));
  return spread <= mean * 0.2 && mean >= 3 ? Math.round(mean) : null;
}

const fixed = (n, d = 1) => n.toFixed(d);

/**
 * Advice, in words, from what was measured. Each is `{level: 'good' | 'info' | 'warn', text}`; the first is the most important.
 * @param {NonNullable<ReturnType<typeof summarize>>} s
 */
export function hints(s, { marks = [], drops = 0, rhythmEvery = null } = {}) {
  const out = [];
  const say = (level, ...parts) => out.push({ level, text: parts.join('') });
  if (s.frames < 30) return [{ level: 'info', text: 'Let the game run a moment: there are not enough frames yet to say anything useful.' }];
  const share = (v) => Math.round((v / Math.max(0.0001, s.avg)) * 100);
  const budget = `${fixed(s.budget)} ms`;
  if (s.over === 0 && s.p99 < s.budget * 0.6) {
    say('good', `Every frame fits with room to spare: the slowest took ${fixed(s.max)} ms and the budget is ${budget}.`);
  } else if (s.overShare > 0.02) {
    say('warn', `${Math.round(s.overShare * 100)}% of frames (${s.over} of ${s.frames}) took longer than ${budget}, `,
      `and the slowest took ${fixed(s.max)} ms.`);
  } else if (s.over > 0) {
    say('info', `A few frames (${s.over} of ${s.frames}) went over ${budget}, the worst at ${fixed(s.max)} ms. `, 'Look at them in the list below.');
  }
  if (s.avg > 0.3) {
    const big = [['drawing', s.render], ["the game's update", s.update], ['everything else', s.other]].sort((a, b) => b[1] - a[1])[0];
    if (share(big[1]) >= 60 && s.avg > s.budget * 0.15) {
      say('info', `${share(big[1])}% of a frame goes on ${big[0]} (${fixed(big[1], 2)} ms of ${fixed(s.avg, 2)} ms).`);
    }
  }
  if (s.render > s.budget * 0.25 && s.draws > 400) {
    say('warn', `The game makes about ${Math.round(s.draws)} draw calls a frame. `,
      'Skip things that are off the screen, or draw big groups as one picture.');
  }
  if (s.catchUp > s.frames * 0.05) {
    say('warn', `The game had to run several updates to catch up in ${s.catchUp} frames: `,
      'it could not keep up at sixty updates a second, so it looks like it slows or jumps.');
  }
  if (s.longGaps > s.frames * 0.05) {
    say('info', `${s.longGaps} frames arrived more than 25 ms apart. If the game's own times are small, `,
      'the delay is outside the game (the browser or a busy computer).');
  }
  const worst = marks[0];
  if (worst && worst.perFrame > Math.max(0.3, s.avg * 0.25)) {
    say('info', `"${worst.name}" takes ${fixed(worst.perFrame, 2)} ms a frame (${share(worst.perFrame)}% of the frame). `,
      'It is the best place to look.');
  }
  if (rhythmEvery) {
    say('warn', `Slow frames come about every ${rhythmEvery} frames: something happens on a timer. `, drops
      ? 'The memory also drops at times, which points at garbage collection: avoid making new lists and objects every frame.'
      : 'Look for work done every so often (a spawn, a save, a search).');
  } else if (drops >= 3 && s.over > 0) {
    say('info', `The memory dropped ${drops} times while the game ran, which is the browser tidying up and can cause a slow frame now and then. `,
      'Avoid making new lists and objects every frame.');
  }
  if (s.things !== null && s.thingsMax > 1500) {
    say('info', `There are up to ${s.thingsMax} things at once. `, 'Removing the ones nobody can see keeps both the update and the drawing short.');
  }
  return out;
}

/**
 * The functions (from "time every function"): for each name, its own time a frame on average (frames without it count as zero), its worst frame, its time with
 * everything it calls, and how often it runs. Sorted by own time.
 */
export function functionStats(frames) {
  const by = new Map();
  for (const f of frames) {
    for (const x of f.fns ?? []) {
      const s = by.get(x.name) ?? { name: x.name, self: 0, total: 0, max: 0, calls: 0 };
      s.self += x.self;
      s.total += x.total;
      s.max = Math.max(s.max, x.self);
      s.calls += x.n;
      by.set(x.name, s);
    }
  }
  const n = Math.max(1, frames.length);
  return [...by.values()].map((s) => ({ name: s.name, self: s.self / n, total: s.total / n, max: s.max, callsPerFrame: s.calls / n }))
    .sort((a, b) => b.self - a.self);
}

/** What changed since a saved reading: each number's difference (positive is worse for times and draw calls), for the cards to show. */
export function compare(s, base) {
  if (!base) return null;
  const d = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? a - b : null);
  return {
    avg: d(s.avg, base.avg), p95: d(s.p95, base.p95), max: d(s.max, base.max), overShare: d(s.overShare, base.overShare),
    fps: d(s.fps, base.fps), draws: d(s.draws, base.draws), update: d(s.update, base.update), render: d(s.render, base.render),
  };
}

/** Words for a difference: `+1.2 ms`, `-3`, or `same`. */
export function delta(v, unit = '', digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (Math.abs(v) < Math.pow(10, -digits) / 2) return 'same as the saved reading';
  return `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}${unit} against the saved reading`;
}

/** A recording as plain data to keep (a file): the numbers, the worst frames and the busiest functions, not every frame. */
export function reportOf(frames, budget, { name = '', when = new Date().toISOString() } = {}) {
  const s = summarize(frames, budget);
  return {
    format: 'engine-profile', version: 1, name, when, budgetMs: budget, frames: frames.length, summary: s,
    parts: markStats(frames).slice(0, 20), functions: functionStats(frames).slice(0, 40),
    slow: slowFrames(frames, budget, 8).map((x) => ({ frame: x.frame.n, total: x.total, cause: x.cause.what, ms: x.cause.ms })),
  };
}
