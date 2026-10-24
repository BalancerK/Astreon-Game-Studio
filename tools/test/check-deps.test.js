import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeps, toMermaid } from '../check-deps.js';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'deps-'));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, 'packages', path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

test('the real repository satisfies its own dependency rules', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { errors } = checkDeps(root);
  assert.deepEqual(errors, []);
});

test('flags forbidden edges, deep imports, external deps, unknown packages; ignores comments', () => {
  const root = fixture({
    'core/src/index.js': `import { x } from '../../protocol/src/index.js';\n// import y from 'lodash';\nimport fs from 'node:fs';`,
    'protocol/src/index.js': `export * from './a.js';`,
    'protocol/src/a.js': `import left from 'left-pad'; import { z } from '@engine/transport/src/memory.js';`,
    'physics/src/index.js': `import { c } from '../../core/src/internal/secret.js'; import ok from '@engine/core';`,
    'mystery/src/index.js': `export {};`,
  });
  try {
    const { errors } = checkDeps(root);
    const has = (s) => assert.ok(errors.some((e) => e.includes(s)), `expected an error containing "${s}" in:\n${errors.join('\n')}`);
    has('package "core" may not depend on "protocol"');
    has('external dependency "left-pad"');
    has('deep import "@engine/transport/src/memory.js"');
    has('deep import "../../core/src/internal/secret.js" into core');
    has('packages/mystery: no entry in ALLOWED');
    assert.ok(!errors.some((e) => e.includes('lodash')), 'commented-out import ignored');
    assert.ok(!errors.some((e) => e.includes('node:fs')), 'node built-ins allowed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mermaid output lists actual edges', () => {
  const root = fixture({
    'core/src/index.js': `export {};`,
    'physics/src/index.js': `import '@engine/core';`,
  });
  try {
    const { edges } = checkDeps(root);
    assert.equal(toMermaid(edges), 'graph LR\n  core\n  physics --> core');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
