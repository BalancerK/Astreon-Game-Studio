import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTweenSuite } from '../browser-test/suite.js';

const golden = JSON.parse(readFileSync(new URL('./determinism.golden.json', import.meta.url), 'utf8'));

test('the easings and a timeline of tweens is repeatable and matches the golden hashes that Chrome and Firefox also reproduce', () => {
  const a = runTweenSuite().exact, b = runTweenSuite().exact;
  assert.deepEqual(a, b, 'two runs in one process agree');
  assert.deepEqual(a, golden, 'results changed: if intended, run `node tools/determinism.js --update` and review the diff');
});
