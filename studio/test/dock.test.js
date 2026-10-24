import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, addPanel, removePanel, movePanel, resize, activate, reorderTabs, dropZone, repair, ensurePanels, panelIds, groupOf, walk } from '../app/ui/dock-model.js';

const tabs = (id, panels, active = panels[0]) => ({ type: 'tabs', id, panels, active });
const split = (id, dir, sizes, ...children) => ({ type: 'split', id, dir, sizes, children });
const sum = (a) => a.reduce((x, y) => x + y, 0);
const ok = (tree) => { // a tree must always be tidy: no empty groups, no one-child splits, no split inside a split of the same direction, shares add up to 1
  for (const n of walk(tree)) {
    if (n.type === 'tabs') { assert.ok(n.panels.length > 0, `group ${n.id} is empty`); assert.ok(n.panels.includes(n.active), `group ${n.id} shows a panel it does not have`); }
    else { assert.ok(n.children.length >= 2, `split ${n.id} has one child`); assert.ok(Math.abs(sum(n.sizes) - 1) < 1e-9, `split ${n.id} shares do not add up`); n.children.forEach((c) => assert.ok(!(c.type === 'split' && c.dir === n.dir), 'a split inside a split of the same direction')); }
  }
  assert.equal(new Set(panelIds(tree)).size, panelIds(tree).length, 'a panel appears twice');
  return tree;
};
const base = () => split('s1', 'row', [0.25, 0.75], tabs('t1', ['files']), split('s2', 'column', [0.7, 0.3], tabs('t2', ['editor', 'game']), tabs('t3', ['console', 'history'])));

test('normalize: empty groups go, a split of one becomes that one, same-direction splits merge, shares add up, the visible tab is valid', () => {
  assert.equal(normalize(null), null); assert.equal(normalize(tabs('t', [])), null);
  assert.deepEqual(normalize(split('s', 'row', [0.5, 0.5], tabs('a', []), tabs('b', ['x']))), tabs('b', ['x']));
  const merged = normalize(split('s', 'row', [0.5, 0.5], split('u', 'row', [0.4, 0.6], tabs('a', ['a']), tabs('b', ['b'])), tabs('c', ['c'])));
  assert.deepEqual(merged.children.map((c) => c.id), ['a', 'b', 'c']); assert.deepEqual(merged.sizes.map((s) => +s.toFixed(3)), [0.2, 0.3, 0.5]);
  assert.equal(normalize(tabs('t', ['a', 'b'], 'zzz')).active, 'a');
  assert.deepEqual(normalize(split('s', 'row', [3, 1], tabs('a', ['a']), tabs('b', ['b']))).sizes, [0.75, 0.25], 'shares are scaled to add up to 1');
  ok(normalize(split('s', 'column', [0, 0], tabs('a', ['a']), tabs('b', ['b']))));
});

test('add, remove and activate: panels join a group, an empty layout starts one, a layout stays tidy', () => {
  assert.deepEqual(addPanel(null, 'files'), tabs('t1', ['files']));
  let t = addPanel(null, 'files'); t = addPanel(t, 'editor', { near: 'files' }); assert.deepEqual(t, tabs('t1', ['files', 'editor'], 'editor'));
  t = addPanel(t, 'game', { near: 'files', activate: false }); assert.equal(t.active, 'editor'); assert.deepEqual(t.panels, ['files', 'editor', 'game']);
  const b = base(); const t2 = ok(addPanel(b, 'search', { near: 't3' })); assert.deepEqual(groupOf(t2, 'search').id, 't3');
  assert.deepEqual(panelIds(b), ['files', 'editor', 'game', 'console', 'history'], 'the input is not changed');
  const t3 = ok(removePanel(b, 'files')); assert.equal(t3.type, 'split', 'the left group is gone and the split of one collapsed'); assert.equal(t3.dir, 'column');
  assert.equal(removePanel(tabs('t', ['only']), 'only'), null); assert.deepEqual(removePanel(b, 'nope'), b);
  assert.equal(activate(b, 'game').children[1].children[0].active, 'game'); assert.equal(activate(b, 'nope').children[0].active, 'files');
  const again = ok(addPanel(b, 'game', { near: 't1' })); assert.equal(groupOf(again, 'game').id, 't1', 'adding a panel that is already there moves it');
  const edge = ok(addPanel(tabs('t1', ['a']), 'b', { near: 'zzz' })); assert.deepEqual(edge.panels, ['a', 'b'], 'an unknown neighbour: the first group');
});

test('move: into another group at a place, reorder within a group, or split a group by dropping on an edge', () => {
  const b = base();
  let t = ok(movePanel(b, 'game', 't1', 'center')); assert.deepEqual(groupOf(t, 'game').panels, ['files', 'game']); assert.equal(groupOf(t, 'game').active, 'game');
  t = ok(movePanel(b, 'game', 't1', 'center', 0)); assert.deepEqual(groupOf(t, 'game').panels, ['game', 'files']);
  t = ok(movePanel(base(), 'history', 't3', 'center', 0)); assert.deepEqual(groupOf(t, 'history').panels, ['history', 'console'], 'reorder inside a group');
  t = ok(movePanel(base(), 'console', 't3', 'center', 2)); assert.deepEqual(groupOf(t, 'console').panels, ['history', 'console'], 'moved to the end');
  t = ok(movePanel(base(), 'game', 't1', 'bottom')); const g = groupOf(t, 'game'); assert.deepEqual(g.panels, ['game']); assert.deepEqual(groupOf(t, 'files').panels, ['files']);
  const parent = [...walk(t)].find((n) => n.type === 'split' && n.children.includes(groupOf(t, 'files')) ); assert.equal(parent.dir, 'column'); assert.deepEqual(parent.sizes, [0.5, 0.5]);
  t = ok(movePanel(base(), 'files', 't2', 'left')); const s = [...walk(t)].find((n) => n.type === 'split' && n.children.some((c) => c.panels?.includes('files')));
  assert.equal(s.dir, 'row'); assert.equal(s.children[0].panels[0], 'files', 'dropped on the left: the new group is first');
  t = ok(movePanel(base(), 'editor', 't2', 'right')); assert.deepEqual(groupOf(t, 'game').panels, ['game'], 'a panel split off its own group');
  assert.deepEqual(movePanel(tabs('t', ['a']), 'a', 't', 'left'), tabs('t', ['a']), 'a group of one cannot be split from itself');
  const emptied = ok(movePanel(base(), 'files', 't2', 'center')); assert.equal(emptied.type, 'split', 'the group that lost its last panel is gone'); assert.equal(emptied.dir, 'column');
  const rooted = ok(movePanel(tabs('t', ['a', 'b']), 'b', 't', 'right')); assert.equal(rooted.type, 'split'); assert.deepEqual(panelIds(rooted), ['a', 'b']);
  assert.deepEqual(movePanel(base(), 'zzz', 't1', 'center'), base(), 'unknown panel: unchanged'); assert.deepEqual(movePanel(base(), 'files', 'nope', 'center'), base());
  // many random moves never break the rules
  let rnd = 7; const next = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let tree = base(); const zones = ['center', 'left', 'right', 'top', 'bottom'];
  for (let i = 0; i < 400; i++) {
    const panels = panelIds(tree); const groups = [...walk(tree)].filter((n) => n.type === 'tabs');
    tree = ok(movePanel(tree, panels[Math.floor(next() * panels.length)], groups[Math.floor(next() * groups.length)].id, zones[Math.floor(next() * 5)], Math.floor(next() * 4)));
    assert.equal(panelIds(tree).length, 5, 'no panel is ever lost');
  }
});

test('resize: moves the edge between two neighbours, never below the smallest share', () => {
  const b = base();
  let t = resize(b, 's1', 0, 0.1); assert.deepEqual(t.sizes.map((s) => +s.toFixed(3)), [0.35, 0.65]);
  t = resize(b, 's1', 0, 5); assert.ok(t.sizes[1] >= 0.06 - 1e-9 && Math.abs(sum(t.sizes) - 1) < 1e-9, 'the right side keeps its minimum');
  t = resize(b, 's1', 0, -5); assert.ok(t.sizes[0] >= 0.06 - 1e-9);
  assert.deepEqual(resize(b, 's1', 1, 0.1), b, 'there is no edge after the last child'); assert.deepEqual(resize(b, 'nope', 0, 0.1), b);
  assert.deepEqual(base().sizes, [0.25, 0.75], 'the input is not changed');
});

test('reorderTabs: puts tabs in the given order, ignores strangers, keeps the ones left out', () => {
  const t = reorderTabs(base(), 't2', ['game', 'x', 'editor']); assert.deepEqual(groupOf(t, 'game').panels, ['game', 'editor']);
  assert.deepEqual(groupOf(reorderTabs(base(), 't3', ['history']), 'history').panels, ['history', 'console']);
});

test('dropZone: the middle joins the tabs, a band along each edge splits that side', () => {
  const size = { width: 400, height: 300 };
  assert.equal(dropZone(size, 200, 150), 'center'); assert.equal(dropZone(size, 10, 150), 'left'); assert.equal(dropZone(size, 390, 150), 'right');
  assert.equal(dropZone(size, 200, 5), 'top'); assert.equal(dropZone(size, 200, 295), 'bottom');
  assert.equal(dropZone(size, 20, 20), 'left', 'a corner goes to the nearer edge (left is 5%, top is 7%)'); assert.equal(dropZone(size, 380, 292), 'bottom');
});

test('repair: a layout saved by another version or damaged by hand becomes valid; unknown panels go; duplicates keep their first place', () => {
  const known = ['files', 'editor', 'game', 'console'];
  assert.equal(repair(null, known), null); assert.equal(repair('nonsense', known), null); assert.equal(repair({ type: 'weird' }, known), null);
  const messy = { type: 'split', id: 's1', dir: 'row', sizes: [1, 'x', -3], children: [
    tabs('t1', ['files', 'ghost', 'editor']), { type: 'banana' }, { type: 'tabs', id: 't1', panels: ['editor', 'game', 'game'], active: 'nope' }] };
  const fixed = ok(repair(messy, known));
  assert.deepEqual(panelIds(fixed), ['files', 'editor', 'game'], 'the ghost is gone and the second editor too'); assert.equal(new Set([...walk(fixed)].map((n) => n.id)).size, [...walk(fixed)].length, 'ids are unique');
  assert.equal(repair({ type: 'split', dir: 'diagonal', children: [tabs('a', ['files'])] }, known), null);
  let deep = tabs('t', ['files']); for (let i = 0; i < 12; i++) deep = split(`s${i}`, i % 2 ? 'row' : 'column', [0.5, 0.5], deep, tabs(`x${i}`, ['editor']));
  assert.equal(repair(deep, known), null, 'nested far deeper than any real layout: refused');
  assert.deepEqual(repair(structuredClone(base()), ['files', 'editor', 'game', 'console', 'history']), base(), 'a good layout is unchanged');
  assert.equal(repair(tabs('t', ['ghost']), known), null, 'nothing left to show');
});

test('ensurePanels: a panel the studio needs is put back next to a friendly neighbour, else in the first group', () => {
  const t = ensurePanels(base(), { game: 'editor', problems: 'console', lone: undefined });
  assert.deepEqual(panelIds(t).sort(), ['console', 'editor', 'files', 'game', 'history', 'lone', 'problems']); assert.equal(groupOf(t, 'problems').id, 't3'); assert.equal(groupOf(t, 'lone').id, 't1');
  assert.equal(groupOf(t, 'game').id, 't2', 'one that is there already stays');
  assert.deepEqual(ensurePanels(null, { a: undefined, b: 'a' }), tabs('t1', ['a', 'b'], 'a'));
});
