import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAiSuite } from '../browser-test/suite.js';

const golden = JSON.parse(readFileSync(new URL('./determinism.golden.json', import.meta.url), 'utf8'));

test('the AI (navigation grid, paths, steering, behaviour trees) is repeatable and matches the golden hashes that Chrome and Firefox also reproduce', () => {
  const a = runAiSuite().exact, b = runAiSuite().exact;
  assert.deepEqual(a, b, 'two runs in one process agree');
  assert.deepEqual(a, golden, 'results changed: if intended, run `node tools/determinism.js --update` and review the diff');
});
