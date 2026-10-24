import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDeterminismSuite } from '../shared/determinism.js';

const golden = JSON.parse(readFileSync(new URL('./determinism.golden.json', import.meta.url), 'utf8'));

test('shared simulation is repeatable and matches the recorded golden hashes', () => {
  const a = runDeterminismSuite().exact;
  const b = runDeterminismSuite().exact;
  assert.deepEqual(a, b, 'two runs in one process agree');
  assert.deepEqual(a, golden, 'results changed: if intended, run `node tools/determinism.js --update` and review the diff');
});
