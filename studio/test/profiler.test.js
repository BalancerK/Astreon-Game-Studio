import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../app/profile/profile-model.js';
import { parseRunnerMessage, isStudioMessage } from '../app/core/runner-protocol.js';

// [update, render, other, ticks, draws, things, gap, tick, marks]
const frame = (update, render, other = 0.1, extra = {}) => [update, render, other, extra.ticks ?? 1, extra.draws ?? 50, extra.things ?? 40, extra.gap ?? 16.7, extra.tick ?? 0, extra.marks ?? []];
const buffer = (list, heap = null) => { const b = new P.FrameBuffer(); b.push(list, heap); return b; };

test('frames are read from the compact form, kept in order and numbered, and only the newest are kept', () => {
  const b = new P.FrameBuffer(5);
  b.push([frame(1, 2), frame(2, 3, 0.2, { marks: [['ai', 0.5, 3]] })]);
  assert.deepEqual(b.frames[1], { update: 2, render: 3, other: 0.2, ticks: 1, draws: 50, things: 40, gap: 16.7, tick: 0, marks: [{ name: 'ai', ms: 0.5, n: 3 }], fns: [], n: 1 });
  b.push(Array.from({ length: 10 }, (_, i) => frame(i, 0)));
  assert.equal(b.frames.length, 5);
  assert.deepEqual(b.frames.map((f) => f.n), [7, 8, 9, 10, 11], 'numbers keep counting');
  b.push([], 12.5);
  assert.equal(b.heap.at(-1).mb, 12.5);
  b.clear();
  assert.deepEqual([b.frames.length, b.count], [0, 0]);
});

test('the summary: average, percentiles, how many frames went over the budget, and the split between update, drawing and the rest', () => {
  const list = Array.from({ length: 100 }, (_, i) => frame(2, i < 95 ? 3 : 30, 0.5, { ticks: i < 10 ? 2 : 1, draws: 100 + i, things: i, gap: 17 }));
  const s = P.summarize(buffer(list).frames, 16.7);
  assert.equal(s.frames, 100);
  assert.equal(s.over, 5);
  assert.equal(s.overShare, 0.05);
  assert.equal(Math.round(s.p50 * 10) / 10, 5.5);
  assert.equal(Math.round(s.max * 10) / 10, 32.5);
  assert.equal(Math.round(s.p99), 33);
  assert.deepEqual([s.update, s.catchUp, s.drawsMax, s.thingsMax], [2, 10, 199, 99]);
  assert.equal(Math.round(s.fps), 59);
  assert.equal(P.summarize([], 16.7), null);
  assert.equal(P.summarize(buffer([frame(1, 1, 0, { things: -1 })]).frames).things, null, 'a game with no list of things reports none');
});

test('the timed sections are ranked by what they cost a frame, counting frames without them as zero', () => {
  const list = [frame(1, 1, 0.1, { marks: [['ai', 2, 4], ['path', 0.5, 1]] }), frame(1, 1), frame(1, 1, 0.1, { marks: [['ai', 4, 4]] }), frame(1, 1)];
  const m = P.markStats(buffer(list).frames);
  assert.deepEqual(m.map((x) => x.name), ['ai', 'path']);
  assert.equal(m[0].perFrame, 1.5);
  assert.equal(m[0].max, 4);
  assert.equal(m[0].callsPerFrame, 2);
  assert.equal(m[0].inFrames, 0.5);
});

test('slow frames are listed worst first, each with what made it slow', () => {
  const list = [frame(1, 1), frame(1, 25), frame(20, 1), frame(31, 1, 0.1, { marks: [['search', 30, 1]] }), frame(1, 1)];
  const slow = P.slowFrames(buffer(list).frames, 16.7);
  assert.deepEqual(slow.map((s) => s.cause.what), ['"search"', 'drawing', 'the game\'s update']);
  assert.deepEqual(slow.map((s) => Math.round(s.total)), [32, 26, 21]);
  assert.equal(P.slowFrames(buffer([frame(1, 1)]).frames).length, 0);
  assert.equal(P.causeOf(buffer([frame(1, 2, 9)]).frames[0]).what, 'everything else (the Time Machine and outlines)');
});

test('memory drops (the browser tidying up) and a regular rhythm of slow frames are found', () => {
  const heap = [10, 11, 12, 8, 9, 10, 6, 7].map((mb, n) => ({ n, mb }));
  assert.equal(P.memoryDrops(heap), 2);
  assert.equal(P.memoryDrops(heap, 5), 0);
  const regular = Array.from({ length: 200 }, (_, i) => frame(1, i % 25 === 0 ? 30 : 1));
  assert.equal(P.rhythm(buffer(regular).frames, 16.7), 25);
  const random = Array.from({ length: 200 }, (_, i) => frame(1, [3, 17, 18, 60, 61, 100, 140, 190].includes(i) ? 30 : 1));
  assert.equal(P.rhythm(buffer(random).frames, 16.7), null);
  assert.equal(P.rhythm(buffer([frame(1, 30), frame(1, 1)]).frames, 16.7), null, 'too few to say');
});

test('advice in words: little data, all well, a heavy drawing, catching up, a timed section, a rhythm', () => {
  const said = (list, extra = {}) => P.hints(P.summarize(buffer(list).frames, 16.7), extra);
  assert.match(said(Array.from({ length: 10 }, () => frame(1, 1)))[0].text, /not enough frames/);
  const fine = said(Array.from({ length: 100 }, () => frame(1, 1)));
  assert.equal(fine[0].level, 'good');
  assert.match(fine[0].text, /room to spare/);
  const heavy = said(Array.from({ length: 100 }, () => frame(1, 12, 0.1, { draws: 900 })));
  assert.ok(heavy.some((h) => h.level === 'warn' && /900 draw calls/.test(h.text)));
  assert.ok(heavy.some((h) => /goes on drawing/.test(h.text)));
  const behind = said(Array.from({ length: 100 }, (_, i) => frame(5, 5, 0.1, { ticks: i % 4 ? 1 : 3 })));
  assert.ok(behind.some((h) => /catch up/.test(h.text)));
  const marked = Array.from({ length: 100 }, () => frame(5, 1, 0.1, { marks: [['pathfinding', 4, 1]] }));
  assert.ok(said(marked, { marks: P.markStats(buffer(marked).frames) }).some((h) => /"pathfinding" takes 4\.00 ms/.test(h.text)));
  const spiky = Array.from({ length: 200 }, (_, i) => frame(1, i % 20 === 0 ? 30 : 1));
  const withRhythm = said(spiky, { drops: 4, rhythmEvery: 20 });
  assert.ok(withRhythm.some((h) => /every 20 frames/.test(h.text) && /garbage collection/.test(h.text)));
  assert.ok(withRhythm[0].level === 'info' || withRhythm[0].level === 'warn');
});

test('the studio checks what the profiler sends: numbers only, lengths limited, unknown things dropped', () => {
  const beat = parseRunnerMessage({
    t: 'beat', frame: 5,
    profile: {
      frames: [[1.234, 2, 0.1, 1, 50, 40, 16.7, 12, [['ai', 0.5, 3], 'junk']], [1, 2], 'nope', [NaN, -4, 'x', 1e9, 1e9, -9, Infinity, 1, [['x'.repeat(100), 1, 1]]]],
      heapMB: 12.5,
    },
  });
  assert.equal(beat.profile.frames.length, 2, 'a frame that is too short or not a list is dropped');
  assert.deepEqual(beat.profile.frames[0], [1.23, 2, 0.1, 1, 50, 40, 16.7, 12, [['ai', 0.5, 3]], []]);
  assert.deepEqual(beat.profile.frames[1].slice(0, 8), [0, 0, 0, 1e9, 1e9, -1, 0, 1]);
  assert.equal(beat.profile.frames[1][8][0][0].length, 24);
  assert.equal(beat.profile.heapMB, 12.5);
  assert.equal(parseRunnerMessage({ t: 'beat', frame: 1, profile: 'x' }).profile, undefined);
  assert.equal(parseRunnerMessage({ t: 'beat', frame: 1, profile: { frames: Array.from({ length: 500 }, () => [1, 1, 1, 1, 1, 1, 1, 1]) } }).profile.frames.length, 120);
  assert.equal(isStudioMessage({ t: 'profile', on: true }), true);
  assert.equal(isStudioMessage({ t: 'profile', on: 'yes' }), false);
});

test('functions: own time a frame, worst frame, calls, and the cause of a slow frame names the function', () => {
  const withFns = (u, fns) => { const f = frame(u, 1); f[8] = []; f[9] = fns; return f; };
  const b = buffer([withFns(10, [['main:update', 8, 9, 1], ['ai:think', 1, 1, 4]]), withFns(4, [['main:update', 2, 3, 1]])]);
  const fns = P.functionStats(b.frames);
  assert.deepEqual(fns.map((x) => x.name), ['main:update', 'ai:think']);
  assert.equal(fns[0].self, 5);
  assert.equal(fns[0].max, 8);
  assert.equal(fns[1].callsPerFrame, 2);
  assert.equal(P.causeOf(b.frames[0]).what, 'the function main:update');
  assert.equal(P.causeOf(b.frames[0]).ms, 8);
});

test('a saved reading: differences in words, and a report with the numbers, parts, functions and slow frames', () => {
  const a = P.summarize(buffer([frame(4, 4), frame(4, 4)]).frames, 16.7);
  const c = P.summarize(buffer([frame(6, 4), frame(6, 4)]).frames, 16.7);
  const diff = P.compare(c, a);
  assert.ok(Math.abs(diff.avg - 2) < 1e-9);
  assert.equal(P.compare(c, null), null);
  assert.equal(P.delta(diff.avg, ' ms', 2), '+2.00 ms against the saved reading');
  assert.equal(P.delta(-3, '', 0), '-3 against the saved reading');
  assert.equal(P.delta(0), 'same as the saved reading');
  assert.equal(P.delta(null), '');
  const report = P.reportOf(buffer([frame(30, 2), frame(4, 4)]).frames, 16.7, { name: 'Game', when: 'now' });
  assert.equal(report.format, 'engine-profile');
  assert.equal(report.frames, 2);
  assert.equal(report.slow.length, 1);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
});

test('function lists from the game are checked: at most 40, names cut, numbers only', () => {
  const huge = Array.from({ length: 60 }, (_, i) => [`fn${i}`.repeat(20), 1e9, -5, 'x']);
  const m = parseRunnerMessage({ t: 'beat', frame: 1, profile: { frames: [[1, 1, 1, 1, 1, 1, 1, 1, [], huge]] } });
  const list = m.profile.frames[0][9];
  assert.equal(list.length, 40);
  assert.ok(list.every(([name, self, total, n]) => name.length <= 40 && self === 0 && total === 0 && n === 0));
});

test('the page tells the studio when the mouse is held and when full screen is asked for by a key; both are plain and nothing else comes through', () => {
  assert.deepEqual(parseRunnerMessage({ t: 'mouse', locked: 1 }), { t: 'mouse', locked: true, problem: undefined });
  assert.deepEqual(parseRunnerMessage({ t: 'mouse', problem: 'x'.repeat(500) }).problem.length, 120);
  assert.equal(parseRunnerMessage({ t: 'mouse' }).locked, false);
  assert.deepEqual(parseRunnerMessage({ t: 'fullscreen-key', extra: 'ignored' }), { t: 'fullscreen-key' });
  assert.equal(isStudioMessage({ t: 'key', code: 'Mouse:12:-3' }), true, 'the movement travels as a key');
});
