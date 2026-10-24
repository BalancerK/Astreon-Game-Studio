import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPhysics3dSuite } from '../browser-test/suite.js';

const golden = JSON.parse(readFileSync(new URL('./determinism.golden.json', import.meta.url), 'utf8'));

test('3D physics is repeatable and matches the recorded golden hashes (which Chrome and Firefox also reproduce)', () => {
  const a = runPhysics3dSuite().exact, b = runPhysics3dSuite().exact;
  assert.deepEqual(a, b, 'two runs in one process agree');
  assert.deepEqual(a, golden, 'results changed: if intended, run `node tools/determinism.js --update` and review the diff');
});
