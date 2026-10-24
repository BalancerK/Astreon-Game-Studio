import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureRecognizer, StrokeRecorder, penWidth, InputCore, validateBinding, describeBinding, sameControl, ACCEPTS } from '../src/index.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
/** A recognizer that collects what it says. */
const make = (o = {}) => { const got = []; const g = new GestureRecognizer({ ...o, onGesture: (x) => got.push(x) }); return { g, got, types: () => got.map((x) => x.type + (x.phase ? `:${x.phase}` : '')) }; };

test('a quick press and release is a tap; a second one close by is a double tap; a slow or far one is a new first tap', () => {
  const { g, got } = make();
  g.pointerDown(1, 100, 100, 0); g.pointerUp(1, 101, 100, 120);
  assert.deepEqual(got.map((x) => [x.type, x.count, x.x]), [['tap', 1, 101]]);
  g.pointerDown(1, 105, 102, 250); g.pointerUp(1, 105, 102, 330);
  assert.equal(got[1].count, 2, 'within 300 ms and 30 px');
  g.pointerDown(1, 105, 102, 500); g.pointerUp(1, 105, 102, 560);
  assert.equal(got[2].count, 1, 'after a double tap the next one starts again');
  g.pointerDown(1, 300, 300, 600); g.pointerUp(1, 300, 300, 660);
  assert.equal(got[3].count, 1, 'far from the last');
  g.pointerDown(1, 300, 300, 1500); g.pointerUp(1, 300, 300, 1560);
  assert.equal(got[4].count, 1, 'too late');
  g.pointerDown(1, 10, 10, 3000); g.pointerUp(1, 10, 10, 3600);
  assert.equal(got.length, 5, 'held for 600 ms is not a tap');
  assert.equal(got[0].pointerType, 'touch'); const pen = make(); pen.g.pointerDown(9, 1, 1, 0, 'pen'); pen.g.pointerUp(9, 1, 1, 50); assert.equal(pen.got[0].pointerType, 'pen');
});

test('a finger held still becomes a long press once, and then it is not a tap', () => {
  const { g, got } = make({ longPressMs: 500 });
  g.pointerDown(1, 50, 60, 1000);
  assert.equal(g.update(1200), 1500, 'asks to be called again when it will be time');
  assert.equal(got.length, 0);
  g.update(1500); assert.deepEqual(got.map((x) => [x.type, x.x, x.y]), [['longpress', 50, 60]]);
  g.update(2000); assert.equal(got.length, 1, 'only once');
  g.pointerUp(1, 50, 60, 2100); assert.equal(got.length, 1, 'and releasing is not a tap');
  const moving = make(); moving.g.pointerDown(1, 0, 0, 0); moving.g.pointerMove(1, 40, 0, 100); moving.g.update(900); assert.deepEqual(moving.types(), ['pan:start', 'pan:move'], 'a finger that moved is panning, not pressing');
});

test('a drag is a pan with its movement and velocity, and a quick flick that ends it is also a swipe', () => {
  const { g, got, types } = make();
  g.pointerDown(1, 100, 100, 0);
  g.pointerMove(1, 104, 100, 10); assert.equal(got.length, 0, 'inside the slop nothing yet');
  for (let i = 1; i <= 10; i++) g.pointerMove(1, 100 + i * 12, 100, 10 + i * 10);
  g.pointerUp(1, 220, 100, 120);
  assert.deepEqual(types().slice(0, 2), ['pan:start', 'pan:move']); assert.ok(types().includes('pan:end') && types().at(-1) === 'swipe');
  const swipe = got.at(-1); assert.equal(swipe.direction, 'right'); assert.ok(swipe.distance >= 120 && swipe.speed > 500, `${swipe.distance} px at ${swipe.speed} px/s`);
  const moves = got.filter((x) => x.type === 'pan' && x.phase === 'move'); near(moves.at(-1).totalX, 120, 1e-9); assert.equal(moves.at(-1).pointers, 1); assert.ok(moves.at(-1).velocityX > 600);
  near(moves.reduce((s, m) => s + m.dx, 0), 116, 1e-9, 'the moves add up to the distance from where it started to the last position');
  const slow = make(); slow.g.pointerDown(1, 0, 0, 0); for (let i = 1; i <= 10; i++) slow.g.pointerMove(1, i * 10, 0, i * 200); slow.g.pointerUp(1, 100, 0, 2000);
  assert.ok(!slow.types().includes('swipe'), 'a slow drag is only a pan');
  for (const [dx, dy, dir] of [[-100, 5, 'left'], [4, -100, 'up'], [6, 100, 'down']]) {
    const s = make(); s.g.pointerDown(1, 200, 200, 0); for (let i = 1; i <= 5; i++) s.g.pointerMove(1, 200 + dx * i / 5, 200 + dy * i / 5, i * 16); s.g.pointerUp(1, 200 + dx, 200 + dy, 90);
    assert.equal(s.got.at(-1).direction, dir);
  }
});

test('two fingers pinch, rotate and pan together; putting the second finger down cancels a tap', () => {
  const { g, got, types } = make();
  g.pointerDown(1, 100, 200, 0); g.pointerDown(2, 200, 200, 5);
  assert.equal(got.length, 0, 'nothing until they move');
  for (let i = 1; i <= 10; i++) { g.pointerMove(1, 100 - i * 5, 200, 10 + i * 10); g.pointerMove(2, 200 + i * 5, 200, 10 + i * 10); }
  g.pointerUp(2, 250, 200, 200); g.pointerUp(1, 50, 200, 210);
  const pinch = got.filter((x) => x.type === 'pinch');
  assert.equal(pinch[0].phase, 'start'); assert.equal(pinch.at(-1).phase, 'end'); near(pinch.at(-1).scale, 2, 0.01, 'the fingers moved from 100 apart to 200 apart');
  const moves = pinch.filter((x) => x.phase === 'move'); assert.ok(moves.length > 5); near(moves.reduce((p, m) => p * m.delta, 1), 2, 0.02, 'the per-event factors multiply to the total');
  assert.ok(!types().includes('rotate:start'), 'no rotation'); assert.ok(!types().includes('tap'), 'no tap');
  const r = make(); r.g.pointerDown(1, 100, 200, 0); r.g.pointerDown(2, 200, 200, 0);
  for (let i = 1; i <= 20; i++) { const a = (i / 20) * Math.PI / 2, cx = 150, cy = 200; r.g.pointerMove(1, cx - 50 * Math.cos(a), cy - 50 * Math.sin(a), i * 10); r.g.pointerMove(2, cx + 50 * Math.cos(a), cy + 50 * Math.sin(a), i * 10); }
  r.g.pointerUp(2, 150, 250, 300);
  const rot = r.got.filter((x) => x.type === 'rotate'); assert.equal(rot[0].phase, 'start'); near(rot.at(-1).angle, Math.PI / 2, 0.05, 'a quarter turn'); assert.equal(rot.at(-1).phase, 'end');
  assert.ok(!r.types().includes('pinch:start'), 'a pure rotation does not pinch');
  const p = make(); p.g.pointerDown(1, 100, 100, 0); p.g.pointerDown(2, 160, 100, 0);
  for (let i = 1; i <= 8; i++) { p.g.pointerMove(1, 100 + i * 10, 100 + i * 5, i * 20); p.g.pointerMove(2, 160 + i * 10, 100 + i * 5, i * 20); }
  const pans = p.got.filter((x) => x.type === 'pan'); assert.equal(pans[0].phase, 'start'); assert.equal(pans.at(-1).pointers, 2); near(pans.at(-1).totalX, 80, 1e-9); near(pans.at(-1).totalY, 40, 1e-9);
  const tap = make(); tap.g.pointerDown(1, 10, 10, 0); tap.g.pointerDown(2, 80, 10, 20); tap.g.pointerUp(2, 80, 10, 60); tap.g.pointerUp(1, 10, 10, 90);
  assert.equal(tap.got.length, 0, 'a two-finger touch that never moves says nothing');
});

test('cancelling ends what was going on without a tap or a swipe; listeners can be added and removed', () => {
  const { g, got, types } = make();
  g.pointerDown(1, 0, 0, 0); g.pointerMove(1, 50, 0, 30); g.pointerCancel(1);
  assert.deepEqual(types(), ['pan:start', 'pan:move', 'pan:end']); assert.equal(g.pointers.size, 0);
  g.pointerDown(1, 5, 5, 100); g.pointerCancel(1); g.pointerUp(1, 5, 5, 130); assert.equal(got.length, 3, 'no tap after a cancel');
  g.pointerMove(77, 1, 1, 1); g.pointerUp(77, 1, 1, 2); g.pointerCancel(77);              // a pointer it has never heard of
  const taps = [], all = []; const off = g.on('tap', (t) => taps.push(t)); g.on('*', (x) => all.push(x.type));
  g.pointerDown(2, 0, 0, 1000); g.pointerUp(2, 0, 0, 1040); off(); g.pointerDown(2, 400, 400, 5000); g.pointerUp(2, 400, 400, 5040);
  assert.equal(taps.length, 1); assert.deepEqual(all, ['tap', 'tap']);
});

// ------------------------------------------------------------------ pen

test('strokes: dots, lines, thinning, smoothing and the samples between frames', () => {
  const kept = [], r = new StrokeRecorder({ onEnd: (s) => kept.push(s.id) });
  r.down(1, 10, 10, { pressure: 0.3, t: 0 }); const dot = r.up(1, 10, 10, { t: 20 });
  assert.equal(dot.samples.length, 1, 'a tap is a dot'); assert.equal(dot.length, 0);
  r.down(1, 0, 0, { pressure: 0.2, tiltX: 10, t: 0 });
  assert.deepEqual(r.move(1, 0.3, 0, { pressure: 0.2, t: 5 }), [], 'a hair of movement is thinned out');
  const more = [{ x: 3, y: 0, pressure: 0.4, t: 10 }, { x: 6, y: 0, pressure: 0.5, t: 12 }];
  const added = r.move(1, 9, 0, { pressure: 0.6, tiltX: 20, t: 14 }, more);
  assert.equal(added.length, 3, 'the in-between samples a pen reports are kept'); assert.deepEqual(added.map((s) => s.x), [3, 6, 9]);
  const stroke = r.up(1, 12, 0, { pressure: 0.1, t: 20 });
  assert.equal(stroke.samples.length, 5); near(stroke.length, 12, 1e-9); assert.equal(stroke.samples.at(-1).x, 12); assert.equal(stroke.samples[3].tiltX, 20);
  assert.deepEqual(kept, [1, 2]); assert.equal(r.strokes.length, 2); assert.equal(r.up(1, 0, 0), null, 'a stroke ends once');
  const smooth = new StrokeRecorder({ smoothing: 0.5, minDistance: 0 });
  smooth.down(1, 0, 0, { pressure: 0 }); const [s1] = smooth.move(1, 10, 20, { pressure: 1 }); near(s1.x, 5, 1e-9); near(s1.y, 10, 1e-9); near(s1.pressure, 0.5, 1e-9);
  const eraser = new StrokeRecorder(); eraser.down(1, 0, 0, { eraser: true }); assert.equal(eraser.up(1, 0, 0).eraser, true);
  const events = []; const watched = new StrokeRecorder({ onStart: () => events.push('start'), onPoints: (s, p) => events.push(`pts${p.length}`), onEnd: () => events.push('end') });
  watched.down(1, 0, 0); watched.move(1, 5, 0); watched.cancel(1); assert.deepEqual(events, ['start', 'pts1', 'pts1']); assert.equal(watched.strokes.length, 0, 'a cancelled stroke is dropped');
  const few = new StrokeRecorder({ maxStrokes: 3 }); for (let i = 0; i < 6; i++) { few.down(1, i, 0, {}); few.up(1, i, 0); } assert.deepEqual(few.strokes.map((s) => s.id), [4, 5, 6]);
  few.clear(); assert.equal(few.strokes.length, 0);
});

test('pressure becomes brush width', () => {
  assert.equal(penWidth(0, 2, 12), 2); assert.equal(penWidth(1, 2, 12), 12); assert.equal(penWidth(0.5, 2, 12), 7);
  assert.ok(penWidth(0.5, 2, 12, 2) < 7 && penWidth(0.5, 2, 12, 0.5) > 7);
  assert.equal(penWidth(-3, 2, 12), 2); assert.equal(penWidth(9, 2, 12), 12);
});

test('a pen drives pressure, tilt, contact and button bindings of the action system', () => {
  const input = new InputCore({ actions: {
    ink: { type: 'axis', bindings: [{ type: 'penPressure' }] }, lean: { type: 'vector2', bindings: [{ type: 'penTilt' }] },
    draw: { type: 'button', bindings: [{ type: 'penContact' }] }, menu: { type: 'button', bindings: [{ type: 'penBarrel' }] }, rub: { type: 'button', bindings: [{ type: 'penEraser' }] },
  } });
  const read = (n) => input.actions.get(n).state;
  input.penUpdate({ x: 10, y: 20, hovering: true, tiltX: 45, tiltY: -45, pressure: 0 }); input.update();
  assert.equal(read('draw').held, false); assert.equal(read('ink').value, 0); near(read('lean').x, 0.5, 1e-9, 'hovering pens report their lean'); near(read('lean').y, 0.5, 1e-9);
  input.penUpdate({ pressure: 0.6, inContact: true, hovering: false }); input.update();
  assert.equal(read('draw').pressed, true); near(read('ink').value, 0.6, 1e-9); input.update(); assert.equal(read('draw').pressed, false); assert.equal(read('draw').held, true);
  input.penUpdate({ barrel: true, eraser: false, pressure: 0.2 }); input.update(); assert.equal(read('menu').pressed, true); assert.equal(read('rub').held, false);
  input.penUpdate({ barrel: false, eraser: true }); input.update(); assert.equal(read('rub').pressed, true); assert.equal(read('menu').released, true);
  input.penUpdate({ inContact: false, hovering: true, barrel: false, eraser: false }); input.update(); assert.equal(read('draw').released, true); assert.equal(read('ink').value, 0, 'lifting resets the pressure');
  assert.equal(input.pen.x, 10);
  input.penUpdate({ inContact: false, hovering: false }); input.update(); assert.equal(read('lean').x, 0, 'out of range: no lean');
  assert.equal(input.lastDevice, 'touch');
});

test('pen bindings are validated, labelled and compared like the others', () => {
  assert.equal(validateBinding('axis', { type: 'penPressure' }), null); assert.equal(validateBinding('vector2', { type: 'penTilt' }), null);
  for (const t of ['penContact', 'penBarrel', 'penEraser']) assert.equal(validateBinding('button', { type: t }), null);
  assert.match(validateBinding('button', { type: 'penPressure' }), /cannot use/); assert.match(validateBinding('axis', { type: 'penContact' }), /cannot use/);
  assert.ok(ACCEPTS.axis.includes('penPressure'));
  assert.deepEqual(['penPressure', 'penTilt', 'penContact', 'penBarrel', 'penEraser'].map((t) => describeBinding({ type: t })), ['Pen pressure', 'Pen tilt', 'Pen tip', 'Pen side button', 'Pen eraser']);
  assert.equal(sameControl({ type: 'penBarrel' }, { type: 'penBarrel' }), true); assert.equal(sameControl({ type: 'penBarrel' }, { type: 'penEraser' }), false);
  assert.doesNotThrow(() => new InputCore({ actions: { p: { type: 'axis', bindings: [{ type: 'penPressure' }] } } }));
});
