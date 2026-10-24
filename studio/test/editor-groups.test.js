import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorGroups, MAX_GROUPS } from '../app/core/editor-groups.js';

const make = (...files) => { const g = new EditorGroups(); for (const f of files) g.open(f); return g; };
const names = (g) => g.groups.map((x) => x.files.join(','));

test('opening a file adds a tab after the chosen one, and opening it again only chooses it', () => {
  const g = make('a.js', 'b.js', 'c.js');
  assert.deepEqual(g.files, ['a.js', 'b.js', 'c.js']);
  assert.equal(g.active, 'c.js');
  g.activate('a.js');
  g.open('new.js');
  assert.deepEqual(g.files, ['a.js', 'new.js', 'b.js', 'c.js'], 'next to the tab that was chosen');
  g.open('c.js');
  assert.equal(g.files.length, 4);
  assert.equal(g.active, 'c.js');
  assert.deepEqual(g.recent.slice(0, 3), ['c.js', 'new.js', 'a.js'], 'the one used last is first');
});

test('closing a tab chooses the one after it, or the one before when it was the last; closing everything leaves one empty editor', () => {
  const g = make('a.js', 'b.js', 'c.js', 'd.js');
  g.activate('b.js');
  g.close('b.js');
  assert.equal(g.active, 'c.js');
  g.close('d.js');
  assert.equal(g.files.join(), 'a.js,c.js');
  assert.equal(g.active, 'c.js');
  g.close('c.js');
  assert.equal(g.active, 'a.js');
  g.close('a.js');
  assert.deepEqual([g.groups.length, g.active, g.files.length], [1, null, 0]);
  g.close('nothing.js');
  assert.equal(g.groups.length, 1);
});

test('close the others, close to the right, close all', () => {
  const g = make('a.js', 'b.js', 'c.js', 'd.js');
  g.closeToRight('b.js');
  assert.deepEqual(g.files, ['a.js', 'b.js']);
  assert.equal(g.active, 'b.js');
  g.open('x.js');
  g.closeOthers('x.js');
  assert.deepEqual(g.files, ['x.js']);
  g.closeAll();
  assert.deepEqual(g.files, []);
});

test('a split opens the file in a new editor beside the first; the sizes share the space and the new one is in focus', () => {
  const g = make('a.js', 'b.js');
  assert.equal(g.split('b.js', 0, 'right'), true);
  assert.deepEqual(names(g), ['a.js,b.js', 'b.js']);
  assert.deepEqual([g.focus, g.direction], [1, 'row']);
  assert.deepEqual(g.sizes, [0.5, 0.5]);
  assert.equal(g.split('a.js', 1, 'down'), true, 'a third editor');
  assert.equal(g.direction, 'column', 'they are all arranged the same way');
  assert.equal(g.groups.length, 3);
  assert.equal(g.split('a.js', 0, 'right'), true, 'a fourth editor');
  assert.equal(g.split('a.js', 0, 'right'), false, `no more than ${MAX_GROUPS}`);
  assert.equal(g.groups.length, MAX_GROUPS);
  assert.ok(Math.abs(g.sizes.reduce((n, s) => n + s, 0) - 1) < 1e-9);
  const left = make('a.js', 'b.js');
  left.split('a.js', 0, 'left');
  assert.deepEqual(names(left), ['a.js', 'a.js,b.js'], 'a split to the left goes first');
  assert.equal(left.focus, 0);
});

test('a file already open in another editor is shown there instead of being opened twice, unless asked to', () => {
  const g = make('a.js', 'b.js');
  g.split('b.js', 0, 'right');
  g.focusGroup(0);
  g.open('b.js');
  assert.equal(g.focus, 0, 'it is open here too: this one is chosen');
  g.close('b.js', 0);
  g.open('b.js');
  assert.equal(g.focus, 1, 'only open in the other editor: that one is chosen');
  assert.equal(g.groups[0].files.includes('b.js'), false);
  g.focusGroup(0);
  g.open('b.js', { duplicate: true });
  assert.deepEqual(g.groupsWith('b.js'), [0, 1]);
});

test('moving a tab to another editor, to a place in its row; an editor with no tabs left goes away', () => {
  const g = make('a.js', 'b.js', 'c.js');
  g.split('a.js', 0, 'right');
  g.move('c.js', 0, 1, 0);
  assert.deepEqual(names(g), ['a.js,b.js', 'c.js,a.js']);
  assert.equal(g.focus, 1);
  assert.equal(g.active, 'c.js');
  g.move('a.js', 1, 0);
  assert.deepEqual(names(g), ['a.js,b.js', 'c.js'], 'it was already open in the first, so it is chosen there');
  g.move('c.js', 1, 0, 1);
  assert.deepEqual(names(g), ['a.js,c.js,b.js']);
  assert.equal(g.groups.length, 1, 'the empty editor went away');
  assert.deepEqual(g.sizes, [1]);
});

test('dragging a tab to an edge moves it into a new editor; the last tab of the only editor cannot leave', () => {
  const g = make('a.js', 'b.js');
  assert.equal(g.split('b.js', 0, 'right', { move: true }), true);
  assert.deepEqual(names(g), ['a.js', 'b.js']);
  const single = make('a.js');
  assert.equal(single.split('a.js', 0, 'right', { move: true }), false);
  assert.equal(single.groups.length, 1);
});

test('reordering tabs, and joining the editors again', () => {
  const g = make('a.js', 'b.js', 'c.js');
  g.reorder(0, 0, 2);
  assert.deepEqual(g.files, ['b.js', 'c.js', 'a.js']);
  g.reorder(0, 2, 0);
  assert.deepEqual(g.files, ['a.js', 'b.js', 'c.js']);
  g.reorder(0, 9, 0);
  assert.deepEqual(g.files, ['a.js', 'b.js', 'c.js'], 'nothing there');
  g.split('c.js', 0, 'right');
  g.unsplit();
  assert.deepEqual(names(g), ['a.js,b.js,c.js']);
  assert.equal(g.active, 'c.js');
});

test('a removed file closes everywhere; a renamed one keeps its tabs; files that are gone are pruned', () => {
  const g = make('a.js', 'b.js');
  g.split('b.js', 0, 'right');
  g.rename('b.js', 'z.js');
  assert.deepEqual(names(g), ['a.js,z.js', 'z.js']);
  assert.equal(g.active, 'z.js');
  g.remove('z.js');
  assert.deepEqual(names(g), ['a.js'], 'the second editor had nothing left and went away');
  g.open('b.js');
  g.prune((p) => p === 'a.js');
  assert.deepEqual(g.files, ['a.js']);
  assert.deepEqual(g.recent, ['a.js']);
});

test('sizes: dragging keeps each editor at least 15% and the total at one', () => {
  const g = make('a.js', 'b.js');
  g.split('b.js', 0, 'right');
  g.resize([0.9, 0.1]);
  assert.ok(g.sizes.every((s) => s >= 0.13));
  assert.ok(Math.abs(g.sizes.reduce((n, s) => n + s, 0) - 1) < 1e-9);
  const before = [...g.sizes];
  g.resize([1]);
  g.resize([NaN, 1]);
  assert.deepEqual(g.sizes, before, 'a wrong list is ignored');
});

test('what is saved is restored, minus files that no longer exist, and the old single-list form still loads', () => {
  const g = make('a.js', 'b.js', 'c.js');
  g.split('c.js', 0, 'down');
  g.resize([0.3, 0.7]);
  const saved = JSON.parse(JSON.stringify(g.serialize()));
  const back = new EditorGroups();
  back.load(saved, (p) => p !== 'b.js');
  assert.deepEqual(names(back), ['a.js,c.js', 'c.js']);
  assert.equal(back.direction, 'column');
  assert.ok(Math.abs(back.sizes[0] - 0.3) < 1e-9);
  assert.equal(back.focus, 1);
  const old = new EditorGroups();
  old.load({ openFiles: ['a.js', 'x.js', 'b.js'], activeFile: 'b.js' }, (p) => p !== 'x.js');
  assert.deepEqual(old.files, ['a.js', 'b.js']);
  assert.equal(old.active, 'b.js');
  const nothing = new EditorGroups();
  nothing.load(null, () => true);
  nothing.load({ groups: [{ files: ['gone.js'] }, { files: [] }] }, () => false);
  assert.deepEqual([nothing.groups.length, nothing.active], [1, null]);
  const bad = new EditorGroups();
  bad.load({ groups: 'no', openFiles: 5 }, () => true);
  assert.equal(bad.groups.length, 1);
});
