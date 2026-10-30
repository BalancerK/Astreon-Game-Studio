import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUD_THEME, chamfer, panel, segments, bar, sweep, compassTape, screenDirection, radarProject, drawRadar, createFrameStats, watchGpuTime, statsRows, drawStatsPanel } from '../src/index.js';

/** A canvas context that writes down what is done to it: calls as [name, ...args] and property settings as ['set', name, value]. */
function recorder() {
  const log = [];
  const g = new Proxy({}, {
    get: (t, k) => {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'createRadialGradient') return (...a) => { log.push(['createRadialGradient', ...a]); return { addColorStop: (...b) => log.push(['stop', ...b]) }; };
      return (...a) => { log.push([k, ...a]); };
    },
    set: (t, k, v) => { log.push(['set', k, v]); return true; },
  });
  return { g, log, calls: (name) => log.filter((e) => e[0] === name), sets: (name) => log.filter((e) => e[0] === 'set' && e[1] === name).map((e) => e[2]) };
}

test('a chamfer is an eight-sided path and a panel fills and edges it with the theme, and takes another', () => {
  const r = recorder();
  chamfer(r.g, 10, 20, 100, 50, 6);
  assert.equal(r.calls('moveTo').length, 1); assert.equal(r.calls('lineTo').length, 7); assert.equal(r.calls('closePath').length, 1);
  assert.deepEqual(r.calls('moveTo')[0].slice(1), [16, 20]);
  const p = recorder(); panel(p.g, 0, 0, 200, 40, 2);
  assert.ok(p.sets('fillStyle').includes(HUD_THEME.panel) && p.sets('strokeStyle').includes(HUD_THEME.edge) && p.sets('strokeStyle').includes(HUD_THEME.main));
  const t = recorder(); panel(t.g, 0, 0, 200, 40, 1, { theme: { ...HUD_THEME, panel: 'red', main: 'blue' }, glow: 'green' });
  assert.ok(t.sets('fillStyle').includes('red') && t.sets('strokeStyle').includes('green') && t.sets('strokeStyle').includes('blue'));
});

test('segments: a cell for each step, lit up to the fraction, from the left or from the bottom', () => {
  const r = recorder(); segments(r.g, 0, 0, 100, 10, 0.5, 'lime', 10);
  const fills = r.calls('fillRect'), colours = r.sets('fillStyle');
  assert.equal(fills.length, 10); assert.deepEqual(colours.slice(0, 5), Array(5).fill('lime')); assert.ok(colours.slice(5).every((c) => c !== 'lime'));
  assert.ok(fills[1][1] > fills[0][1], 'left to right');
  const v = recorder(); segments(v.g, 0, 0, 10, 100, 1, 'lime', 4, true);
  const ys = v.calls('fillRect').map((c) => c[2]); assert.ok(ys[1] < ys[0], 'bottom to top');
  const over = recorder(); segments(over.g, 0, 0, 100, 10, 7, 'lime', 8); assert.deepEqual(over.sets('fillStyle'), Array(8).fill('lime'), 'more than full is full');
  const none = recorder(); segments(none.g, 0, 0, 100, 10, -3, 'lime', 8); assert.ok(none.sets('fillStyle').every((c) => c !== 'lime'));
});

test('a bar fills the fraction of its width, and a sweep shades the part still cooling from the top round', () => {
  const r = recorder(); bar(r.g, 5, 5, 100, 4, 0.25, 'amber');
  assert.deepEqual(r.calls('fillRect').map((c) => c[3]), [100, 25]);
  const s = recorder(); sweep(s.g, 0, 0, 40, 6, 0.25);
  const arc = s.calls('arc')[0]; assert.equal(arc[4], -Math.PI / 2); assert.ok(Math.abs(arc[5] - 0) < 1e-9, 'a quarter turn from the top ends at the right');
  assert.equal(s.calls('clip').length, 1); assert.equal(s.calls('save').length, 1); assert.equal(s.calls('restore').length, 1);
  const done = recorder(); sweep(done.g, 0, 0, 40, 6, 5); assert.ok(Math.abs(done.calls('arc')[0][5] - (-Math.PI / 2 + Math.PI * 2)) < 1e-9, 'more than all is all');
});

test('the compass tape shows the bearing under the middle and names the points near it', () => {
  const r = recorder(); compassTape(r.g, 1000, 0, 1);
  const texts = r.calls('fillText').map((c) => c[1]);
  assert.ok(texts.includes('N') && texts.includes('000'), texts.join());
  const e = recorder(); compassTape(e.g, 1000, -Math.PI / 2, 1);
  const et = e.calls('fillText').map((c) => c[1]);
  assert.ok(et.includes('E') && et.includes('090'), et.join());
  assert.equal(r.calls('save').length, r.calls('restore').length);
});

test('screen direction: ahead, right, left, behind, above and below, at any pitch', () => {
  const eye = [0, 0, 0], at = (t, yaw = 0, pitch = 0) => screenDirection(eye, t, yaw, pitch);
  const ahead = at([0, 0, -10]); assert.ok(Math.abs(ahead.front - 1) < 1e-9 && ahead.off < 1e-6);
  const right = at([10, 0, 0]); assert.ok(Math.abs(right.angle) < 1e-9 && Math.abs(right.front) < 1e-9, 'to the right is angle 0');
  const left = at([-10, 0, 0]); assert.ok(Math.abs(Math.abs(left.angle) - Math.PI) < 1e-9);
  const behind = at([0, 0, 10]); assert.ok(Math.abs(behind.front + 1) < 1e-9 && Math.abs(behind.off - Math.PI) < 1e-9);
  const above = at([0, 10, -10]); assert.ok(Math.abs(above.angle + Math.PI / 2) < 1e-9, 'above points up the screen (a negative angle)');
  const below = at([0, -10, -10]); assert.ok(Math.abs(below.angle - Math.PI / 2) < 1e-9);
  const turned = at([-10, 0, 0], Math.PI / 2); assert.ok(Math.abs(turned.front - 1) < 1e-9, 'a quarter turn: -x is ahead');
  const belowAhead = at([0, -10, -10], 0, 1.2); assert.ok(belowAhead.front < 0 && Math.abs(Math.cos(belowAhead.angle)) < 0.2 && Math.sin(belowAhead.angle) > 0.9, 'looking up at the sky, a place below and in front points down');
  const belowBehind = at([0, -10, 10], 0, 1.2); assert.ok(belowBehind.front < 0 && Math.sin(belowBehind.angle) < -0.9, 'and one behind you points up: the shortest way to face it is over the top');
  assert.equal(at([0, 0, 0]), null);
});

test('the radar puts the way the view points at the top, turns with the view, and pulls far things in to the rim', () => {
  const base = { cx: 200, cy: 100, size: 150, range: 150, center: [0, 0] };
  const north = radarProject({ ...base, yaw: 0 });
  const a = north.to(0, -75); assert.ok(Math.abs(a.x - 200) < 1e-9 && Math.abs(a.y - 62.5) < 1e-9 && !a.edge, 'ahead is up, half way to the rim');
  const b = north.to(75, 0); assert.ok(Math.abs(b.x - 237.5) < 1e-9 && Math.abs(b.y - 100) < 1e-9, '+x is to the right');
  const turned = radarProject({ ...base, yaw: Math.PI / 2 });
  const c = turned.to(-75, 0); assert.ok(Math.abs(c.x - 200) < 1e-6 && Math.abs(c.y - 62.5) < 1e-6, 'looking along -x, -x is up');
  const far = north.to(0, -5000); assert.equal(far.edge, true); assert.ok(Math.abs(Math.hypot(far.x - 200, far.y - 100) - 68) < 1e-9, 'on the rim, 7 in');
  assert.ok(Math.abs(north.to(0, -5000, 0).y - 25) < 1e-9, 'an inset of 0 is the rim itself');
  assert.equal(north.k, 0.5);
  const moved = radarProject({ ...base, center: [100, 100], yaw: 0 }).to(100, 100); assert.ok(Math.abs(moved.x - 200) < 1e-9 && Math.abs(moved.y - 100) < 1e-9, 'the player is the middle');
});

test('drawing a radar clips to the circle, calls the game for the picture and the markers with the right arguments, and draws the wedge only when asked', () => {
  const r = recorder(); let worldArgs = null, markerArgs = null;
  const p = drawRadar(r.g, { cx: 100, cy: 100, size: 150, range: 300, center: [10, 20], yaw: 0, wedge: 0.6, drawWorld: (g, a) => { worldArgs = a; }, drawMarkers: (g, to, a) => { markerArgs = { a, hit: to(10, -130) }; } });
  assert.equal(r.calls('clip').length, 1); assert.deepEqual(worldArgs, { k: 0.25, turn: p.turn });
  assert.equal(markerArgs.a.size, 150); assert.ok(Math.abs(markerArgs.hit.y - (100 - 150 * 0.25)) < 1e-9);
  assert.equal(r.calls('createRadialGradient').length, 1);
  assert.ok(r.calls('fillText').some((c) => c[1] === 'N'));
  assert.equal(r.calls('save').length, r.calls('restore').length);
  const plain = recorder(); drawRadar(plain.g, { cx: 0, cy: 0, range: 100, center: [0, 0], yaw: 1 });
  assert.equal(plain.calls('createRadialGradient').length, 0); assert.equal(plain.sets('globalAlpha').at(-1), 1, 'the alpha is put back');
});

test('frame stats: marks are the time since the last note, smoothed; readings come once a window with the frame rate, the slowest frame and the marks as they were', () => {
  let t = 0; const readings = [];
  const s = createFrameStats({ window: 500, smoothing: 0.5, now: () => t, onWindow: (x) => readings.push(x.fps) });
  s.begin(0);
  let made = 0;
  for (let i = 0; i < 90; i++) {
    t += 10; s.mark('sim', t - 4); s.mark('draw', t);
    t += (i === 20 ? 30 : 0);
    if (s.frame(t)) made++;
  }
  assert.ok(made >= 1 && readings.length === made);
  assert.ok(s.fps > 50 && s.fps < 110, `${s.fps}`);
  assert.ok(s.worst >= 40, `the slow frame is the worst (${s.worst})`);
  assert.ok(Math.abs(s.marks.sim - 6) < 1 && Math.abs(s.marks.draw - 4) < 1, JSON.stringify(s.marks));
  assert.equal(s.shown.worst, s.worst); assert.ok(Math.abs(s.total(['sim', 'draw']) - 10) < 1.5);
  assert.equal(s.frame(t + 1), false, 'between readings, nothing');
});

test('the overlay rows: the frame rate, the worst frame and the cpu share, a line for each part, the card\'s time, and a note when the rest is the card', () => {
  let t = 0; const s = createFrameStats({ window: 100, smoothing: 1, now: () => t });
  s.begin(0); t = 2; s.mark('sim'); t = 5; s.mark('render'); for (let i = 0; i < 12; i++) { t += 20; s.frame(t); }
  const rows = statsRows(s, { parts: ['sim', 'render'], head: 'WebGPU', extra: ['6 mechas'] });
  assert.match(rows[0], /^\d+ FPS +\d+\.\d ms +WebGPU$/); assert.match(rows[1], /worst frame .* ms +cpu 5\.0 ms +\(rest: waiting for the graphics card\)/);
  assert.match(rows[2], /sim +2\.00 ms/); assert.match(rows[3], /render +3\.00 ms/); assert.equal(rows.at(-1), '6 mechas');
  s.gpu = 4.5; assert.ok(statsRows(s, { parts: ['sim'] }).some((r) => /gpu +4\.50 ms/.test(r)));
  assert.deepEqual(statsRows(s).slice(2, 4).map((r) => r.trim().split(' ')[0]), ['sim', 'render'], 'every marked part by default');
  const r = recorder(); drawStatsPanel(r.g, rows, 60, 10, 100, 1);
  assert.equal(r.calls('fillText').length, rows.length); assert.ok(r.sets('fillStyle').includes('#6fcf97'), 'green at 60');
  const slow = recorder(); drawStatsPanel(slow.g, rows, 20, 0, 0, 1); assert.ok(slow.sets('fillStyle').includes('#e0594f'), 'red at 20');
  const mid = recorder(); drawStatsPanel(mid.g, rows, 40, 0, 0, 1); assert.ok(mid.sets('fillStyle').includes('#e0b84a'));
});

test('watching the card: the time between handing a frame over and being told it is done is smoothed into gpu, one frame at a time; a renderer with no device is left alone', async () => {
  const stats = createFrameStats(); let resolve; let calls = 0;
  const renderer = { device: { queue: { onSubmittedWorkDone: () => { calls++; return new Promise((r) => { resolve = r; }); } } } };
  const state = watchGpuTime(renderer, stats);
  watchGpuTime(renderer, stats, state); assert.equal(calls, 1, 'one in flight at a time');
  resolve(); await new Promise((r) => setTimeout(r, 5));
  assert.ok(stats.gpu > 0 && state.busy === false);
  watchGpuTime(renderer, stats, state); assert.equal(calls, 2);
  const plain = createFrameStats(); watchGpuTime({}, plain); assert.equal(plain.gpu, undefined);
});
