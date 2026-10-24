import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProject, replaceProject, MAX_RESULTS } from '../app/editing/project-search.js';

const files = {
  'src/main.js': 'const speed = 1;\nlet Speed = 2;\n  go(speed);\n',
  'src/util.js': 'export const speedy = 3;\n',
  'assets/hero.png': new Uint8Array([1, 2, 3]),
  'notes.md': 'nothing here\n',
};

test('a search lists every file with a match, with the line and column of each, and skips files that are not text', () => {
  const r = searchProject(files, 'speed');
  assert.deepEqual(r.results.map((x) => x.path), ['src/main.js', 'src/util.js']);
  assert.equal(r.total, 4);
  assert.deepEqual(r.results[0].hits.map((h) => [h.line, h.column]), [[1, 7], [2, 5], [3, 6]]);
  assert.equal(r.results[0].hits[2].text, 'go(speed);');
  assert.equal(r.results[0].hits[2].text.slice(r.results[0].hits[2].start, r.results[0].hits[2].start + 5), 'speed');
});

test('case, whole word and pattern options work, and a bad pattern is a message not a crash', () => {
  assert.equal(searchProject(files, 'speed', { caseSensitive: true }).total, 3);
  assert.equal(searchProject(files, 'speed', { wholeWord: true }).total, 3);
  assert.equal(searchProject(files, String.raw`s\w+d\b`, { regex: true }).total, 3);
  const bad = searchProject(files, '(', { regex: true });
  assert.ok(bad.error && bad.total === 0);
  assert.equal(searchProject(files, '').total, 0);
});

test('a very long line is cut around the match, and the number of results is capped', () => {
  const long = { 'a.js': `${'x'.repeat(300)}NEEDLE${'y'.repeat(300)}` };
  const hit = searchProject(long, 'NEEDLE').results[0].hits[0];
  assert.ok(hit.text.length < 200 && hit.text.startsWith('…') && hit.text.slice(hit.start, hit.start + 6) === 'NEEDLE', hit.text);
  const many = { 'a.js': 'a\n'.repeat(MAX_RESULTS + 50) };
  const r = searchProject(many, 'a');
  assert.equal(r.total, MAX_RESULTS);
  assert.equal(r.capped, true);
});

test('replace changes the files that match (all, or only some) and returns new texts without touching the originals', () => {
  const all = replaceProject(files, 'speed', 'pace');
  assert.deepEqual(Object.keys(all.changes).sort(), ['src/main.js', 'src/util.js']);
  assert.equal(all.changes['src/main.js'], 'const pace = 1;\nlet pace = 2;\n  go(pace);\n');
  assert.equal(all.count, 4);
  assert.equal(files['src/main.js'].includes('speed'), true);
  const some = replaceProject(files, 'speed', 'pace', { wholeWord: true }, ['src/main.js']);
  assert.deepEqual(Object.keys(some.changes), ['src/main.js']);
  assert.equal(replaceProject(files, '(', 'x', { regex: true }).error !== undefined, true);
  assert.equal(replaceProject(files, String.raw`q(\w+)`, '$1!', { regex: true }).count, 0);
  assert.equal(replaceProject({ 'a.js': 'cat bat' }, String.raw`(\w)at`, '$1og', { regex: true }).changes['a.js'], 'cog bog');
});
