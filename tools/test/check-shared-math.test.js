import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSharedMath } from '../check-shared-math.js';

test('the real shared simulation code follows the rule', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assert.deepEqual(checkSharedMath(root), []);
});

test('flags banned APIs, honours determinism-ok, ignores comments', () => {
  const root = mkdtempSync(join(tmpdir(), 'math-'));
  try {
    mkdirSync(join(root, 'shared'), { recursive: true });
    writeFileSync(join(root, 'shared', 'a.js'), [
      'const a = Math.sin(1);',
      'const b = Math.sqrt(4) + Math.floor(2.5) + Math.round(1.5) + Math.abs(-1) + Math.fround(1.1);',
      '// Math.cos(1) in a comment is fine',
      '/** Math.pow(2, 3) in a doc comment is fine, and so is ** */',
      'const c = x ** 2;',
      'const d = Math.hypot(3, 4);',
      'const e = Date.now() + Math.random();',
      'const f = 0.5 ** t; // determinism-ok: visual only',
      'const url = "http://example.com";',
    ].join('\n'));
    const problems = checkSharedMath(root, ['shared']);
    const lines = problems.map((p) => Number(p.split(':')[1]));
    assert.deepEqual(lines, [1, 5, 6, 7, 7], problems.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
