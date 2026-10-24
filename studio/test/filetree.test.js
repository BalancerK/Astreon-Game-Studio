import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows } from '../app/ui/file-tree.js';

const paths = ['src/main.js', 'src/art/hero.js', 'src/art/coin.js', 'src/lib/deep/more.js', 'assets/hero.png', 'project.json', 'src/zed.js'];
const text = (rows) => rows.map((r) => `${'  '.repeat(r.depth)}${r.name}${r.kind === 'dir' ? '/' : ''}`);

test('the tree shows folders first, then files, each level in order, indented by depth', () => {
  assert.deepEqual(text(buildRows(paths)), [
    'assets/', '  hero.png',
    'src/', '  art/', '    coin.js', '    hero.js', '  lib/', '    deep/', '      more.js', '  main.js', '  zed.js',
    'project.json',
  ]);
});

test('a folded folder hides what is inside it, and says how many files are in it', () => {
  const rows = buildRows(paths, new Set(['src/art', 'assets']));
  assert.deepEqual(text(rows), ['assets/', 'src/', '  art/', '  lib/', '    deep/', '      more.js', '  main.js', '  zed.js', 'project.json']);
  assert.equal(rows.find((r) => r.path === 'src').count, 5);
  assert.equal(rows.find((r) => r.path === 'src/art').open, false);
  assert.equal(rows.find((r) => r.path === 'src').open, true);
});

test('a filter keeps the files that match (the text, or its letters in order), opens the folders they are in, and ignores folding', () => {
  const rows = buildRows(paths, new Set(['src', 'src/art']), 'hero');
  assert.deepEqual(text(rows), ['assets/', '  hero.png', 'src/', '  art/', '    hero.js']);
  assert.ok(buildRows(paths, new Set(), 'smjs').some((r) => r.path === 'src/main.js'), 's, m, j, s: the letters of src/main.js in order');
  assert.ok(!buildRows(paths, new Set(), 'smjs').some((r) => r.path === 'project.json'));
  assert.deepEqual(buildRows(paths, new Set(), 'zzz'), []);
  assert.deepEqual(buildRows([], new Set()), []);
});
