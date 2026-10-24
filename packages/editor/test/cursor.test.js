import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIVOTS, medianOf, pivotFor, offsetToCursor, cursorText } from '../src/index.js';

test('the middle of some points, and nothing when there are none', () => {
  assert.deepEqual(medianOf([[0, 0, 0], [2, 4, 6]]), [1, 2, 3]);
  assert.deepEqual(medianOf([[5, 5, 5]]), [5, 5, 5]);
  assert.equal(medianOf([]), null);
});

test('the pivot of a turn or a stretch: the middle of the selection, the 3D cursor, or each object\'s own origin', () => {
  const median = [1, 1, 1];
  const cursor = [9, 0, 0];
  const own = [3, 3, 3];
  assert.deepEqual(pivotFor('median', median, cursor, own), median);
  assert.deepEqual(pivotFor('cursor', median, cursor, own), cursor);
  assert.deepEqual(pivotFor('individual', median, cursor, own), own);
  assert.deepEqual(pivotFor('anything else', median, cursor, own), median, 'an unknown mode is the middle');
  assert.deepEqual(PIVOTS.map((p) => p.id), ['median', 'cursor', 'individual']);
  assert.ok(PIVOTS.every((p) => p.label.length > 3));
});

test('how far the selection must move to reach the cursor keeps the things where they are to each other', () => {
  assert.deepEqual(offsetToCursor([[0, 0, 0], [2, 0, 0]], [5, 1, 0]), [4, 1, 0], 'the middle (1, 0, 0) goes to (5, 1, 0)');
  assert.deepEqual(offsetToCursor([], [5, 1, 0]), [0, 0, 0]);
  assert.equal(cursorText([1.2345, 0, -0.0049]), '1.23, 0, 0');
});

test('the cursor is kept in the scene as a short note: only what is not the usual, nothing at all when everything is', async () => {
  const { cursorNote, readCursorNote, NO_TURN, axesOf, ORIENTATIONS } = await import('../src/index.js');
  assert.equal(cursorNote({ position: [0, 0, 0], rotation: [...NO_TURN], pivot: 'median', orientation: 'global' }), null);
  assert.deepEqual(cursorNote({ position: [1.23456, 0, 2], rotation: [...NO_TURN], pivot: 'median', orientation: 'global' }), { position: [1.235, 0, 2] });
  const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const full = cursorNote({ position: [1, 2, 3], rotation: q, pivot: 'cursor', orientation: 'cursor' });
  assert.deepEqual(Object.keys(full).sort(), ['orientation', 'pivot', 'position', 'rotation']);
  const back = readCursorNote(JSON.parse(JSON.stringify(full)));
  assert.deepEqual(back.position, [1, 2, 3]);
  assert.ok(back.rotation.every((v, i) => Math.abs(v - q[i]) < 1e-6));
  assert.equal(back.pivot, 'cursor');
  assert.equal(back.orientation, 'cursor');
  assert.ok(ORIENTATIONS.length === 2);
  const bad = readCursorNote({ position: [1, 'x', 3], rotation: [0, 0, 0, 0], pivot: 'sideways', orientation: 5 });
  assert.deepEqual(bad, { position: [0, 0, 0], rotation: [0, 0, 0, 1], pivot: 'median', orientation: 'global', align: 'world' }, 'a damaged note is the usual cursor, not an error');
  assert.deepEqual(readCursorNote(undefined).position, [0, 0, 0]);
  assert.equal(readCursorNote({ position: [1e12, 0, -1e12] }).position[0], 1e6, 'a wild place is held in range');
  const axes = axesOf(q);                                    // a quarter turn about y: x now points along -z
  assert.ok(Math.abs(axes[0][2] + 1) < 1e-9 && Math.abs(axes[2][0] - 1) < 1e-9 && Math.abs(axes[1][1] - 1) < 1e-9);
});

test('X Y Z can lock to other directions than the world\'s: the cursor\'s own', async () => {
  const { Modal, axesOf } = await import('../src/index.js');
  const view = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], unitsPerPixel: 0.01 };
  const world = axesOf([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  const m = new Modal({ kind: 'grab', start: { x: 0, y: 0 }, view, world });
  assert.equal(m.turnedWorld, true);
  m.key('x');
  assert.ok(Math.abs(m.axisVector()[2] + 1) < 1e-9, 'X is now the cursor\'s x: along -z');
  m.key('2');
  assert.ok(Math.abs(m.result().vector[2] + 2) < 1e-9 && Math.abs(m.result().vector[0]) < 1e-9, 'two metres along it');
  assert.equal(new Modal({ kind: 'grab', start: { x: 0, y: 0 }, view }).turnedWorld, false);
});

test('how new blocks are turned is part of the note too: only when it is not the usual', async () => {
  const { cursorNote, readCursorNote, ALIGNS, NO_TURN } = await import('../src/index.js');
  const base = { position: [0, 0, 0], rotation: [...NO_TURN], pivot: 'median', orientation: 'global' };
  assert.equal(cursorNote({ ...base, align: 'world' }), null);
  assert.equal(cursorNote(base), null, 'left out means the usual');
  assert.deepEqual(cursorNote({ ...base, align: 'cursor' }), { align: 'cursor' });
  assert.equal(readCursorNote({ align: 'cursor' }).align, 'cursor');
  assert.equal(readCursorNote({ align: 'sideways' }).align, 'world');
  assert.deepEqual(ALIGNS.map((a) => a.id), ['world', 'cursor']);
});
