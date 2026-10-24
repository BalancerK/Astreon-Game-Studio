import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewRename, canApply, NAME_MAX } from '../src/batch-rename.js';

const items = [{ id: 'cube-1', prefab: 'cube' }, { id: 'cube-2', prefab: 'cube', name: 'Old crate' }, { id: 'wall-1', prefab: 'wall' }];
const to = (rows) => rows.map((r) => r.to);

test('a pattern with a number gives every one its own name, in the order of the selection', () => {
  assert.deepEqual(to(previewRename(items, { pattern: 'Crate {n}' })), ['Crate 1', 'Crate 2', 'Crate 3']);
  assert.deepEqual(to(previewRename(items, { pattern: 'Crate {n}', start: 10, step: 5, digits: 3 })), ['Crate 010', 'Crate 015', 'Crate 020']);
  assert.deepEqual(to(previewRename(items, { pattern: '{prefab}-{n}' })), ['cube-1', 'cube-2', 'wall-3']);
  assert.deepEqual(to(previewRename(items, { pattern: '{name}!' })), ['cube-1!', 'Old crate!', 'wall-1!'], 'what it shows now: the name, or the id when there is none');
  assert.deepEqual(to(previewRename(items, { pattern: '[{id}]' })), ['[cube-1]', '[cube-2]', '[wall-1]']);
  assert.deepEqual(to(previewRename(items, {})), ['cube-1 1', 'Old crate 2', 'wall-1 3'], 'the usual pattern adds a number');
});

test('what changes is marked, and a name is cut to its length', () => {
  const rows = previewRename([{ id: 'a', name: 'Same 1' }, { id: 'b' }], { pattern: 'Same {n}' });
  assert.deepEqual(rows.map((r) => r.changed), [false, true], 'a name that is already so is not a change');
  assert.equal(previewRename([{ id: 'a' }], { pattern: 'x'.repeat(200) })[0].to.length, NAME_MAX);
  assert.equal(previewRename([{ id: 'a' }], { pattern: '   padded   ' })[0].to, 'padded', 'spaces at the ends go');
});

test('find and replace works on the names, letters of any case unless asked, and special characters mean themselves', () => {
  const rows = previewRename(items, { mode: 'replace', find: 'CRATE', replace: 'Box' });
  assert.deepEqual(to(rows), ['', 'Old Box', ''], 'unnamed ones with nothing to find stay unnamed');
  assert.deepEqual(rows.map((r) => r.changed), [false, true, false]);
  assert.ok(previewRename(items, { mode: 'replace', find: 'CRATE', replace: 'Box', matchCase: true }).every((r) => !r.changed), 'with capitals counted nothing matches');
  assert.deepEqual(to(previewRename([{ id: 'a', name: 'a.b (1)' }], { mode: 'replace', find: '.b (', replace: '-' })), ['a-1)'], 'a dot or a bracket is just a character');
  assert.deepEqual(to(previewRename([{ id: 'a', name: 'x' }], { mode: 'replace', find: 'x', replace: '' })), [''], 'an empty result gives the label back to the id');
  assert.deepEqual(previewRename(items, { mode: 'replace', find: '', replace: 'x' }).map((r) => r.changed), [false, false, false], 'nothing to find: nothing to do');
  assert.deepEqual(to(previewRename([{ id: 'a', name: '$& x' }], { mode: 'replace', find: 'x', replace: '$&$&' })), ['$& $&$&'], 'the replacement is text, not a pattern');
});

test('ids must be usable and unique: a bad one, one that is taken, and two that collide are each refused', () => {
  const taken = ['cube-1', 'cube-2', 'wall-1', 'floor'];
  const rows = previewRename(items, { target: 'id', pattern: 'block-{n}' }, taken);
  assert.deepEqual(to(rows), ['block-1', 'block-2', 'block-3']);
  assert.ok(canApply(rows));
  assert.ok(previewRename(items, { target: 'id', pattern: 'floor' }, taken).every((r) => r.error), 'taken by something else, and the same for all three');
  assert.match(previewRename(items, { target: 'id', pattern: 'a b' }, taken)[0].error, /letters, digits/);
  assert.match(previewRename(items, { target: 'id', pattern: '' }, taken)[0].error, /empty/);
  assert.match(previewRename(items, { target: 'id', pattern: 'same' }, taken)[0].error, /two of these/);
  const swap = previewRename([{ id: 'a' }, { id: 'b' }], { target: 'id', mode: 'replace', find: 'a', replace: 'b' }, ['a', 'b']);
  assert.ok(swap[0].changed && swap[0].error, 'a goes to b, which is not moving: refused');
  const shift = previewRename([{ id: 'a' }, { id: 'b' }], { target: 'id', pattern: '{id}2' }, ['a', 'b', 'a2']);
  assert.match(shift[0].error, /already/, 'a2 is taken by something outside the selection');
  assert.equal(canApply(previewRename(items, { target: 'id', pattern: '{id}' }, taken)), false, 'nothing changes: nothing to apply');
  const within = previewRename([{ id: 'a' }, { id: 'b' }], { target: 'id', pattern: 'x{n}' }, ['a', 'b', 'x2']);
  assert.ok(within[1].error && !within[0].error);
});
