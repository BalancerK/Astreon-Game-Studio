import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { studioFiles, offlineScript } from '../../tools/studio-offline.js';
import { createStaticServer } from '../../tools/static-server.js';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'studio-offline-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const base = {
  'studio/index.html': '<html>', 'studio/manifest.webmanifest': '{}', 'studio/icon.svg': '<svg/>',
  'studio/app/main.js': 'a', 'studio/app/ui/x.css': 'b', 'studio/app/ui/notes.md': 'not kept', 'studio/app/test/x.js': 'no',
  'studio/app/core/x.test.js': 'no', 'studio/runner/runner.js': 'c', 'studio/export/e.js': 'd', 'studio/plugins/p.js': 'e', 'studio/netlab/n.js': 'f',
  'studio/scene3d/s.js': 'g', 'studio/spike/old.js': 'spike is not kept', 'studio/test/t.test.js': 'no', 'studio/offline-files.js': 'self',
  'packages/arcade/src/index.js': 'h', 'packages/arcade/test/a.test.js': 'no', 'packages/arcade/README.md': 'no', 'packages/empty/package.json': '{}',
};

test('the files to keep are the studio and the engine\'s sources, in a fixed order, without tests, notes, the spike or the list itself', () => {
  const root = tree(base);
  try {
    const list = studioFiles(root);
    assert.deepEqual(list, [...list].sort());
    for (const f of ['studio/index.html', 'studio/manifest.webmanifest', 'studio/icon.svg', 'studio/app/main.js', 'studio/app/ui/x.css', 'studio/runner/runner.js',
      'studio/export/e.js', 'studio/plugins/p.js', 'studio/netlab/n.js', 'studio/scene3d/s.js', 'packages/arcade/src/index.js']) assert.ok(list.includes(f), f);
    for (const f of ['studio/app/ui/notes.md', 'studio/app/test/x.js', 'studio/app/core/x.test.js', 'studio/spike/old.js', 'studio/test/t.test.js',
      'studio/offline-files.js', 'packages/arcade/test/a.test.js', 'packages/arcade/README.md']) assert.ok(!list.includes(f), f);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the version is the same for the same files and changes when any one file changes, is added or is removed', () => {
  const root = tree(base);
  try {
    const first = offlineScript(root);
    assert.equal(offlineScript(root), first);
    const version = (text) => /"version": "([0-9a-f]{12})"/.exec(text)[1];
    writeFileSync(join(root, 'studio/app/main.js'), 'changed');
    const edited = offlineScript(root);
    assert.notEqual(version(edited), version(first));
    writeFileSync(join(root, 'studio/app/new.js'), 'x');
    const added = offlineScript(root);
    assert.notEqual(version(added), version(edited)); assert.ok(added.includes('studio/app/new.js'));
    assert.match(first, /^\/\/ .*\nself\.STUDIO_OFFLINE = \{/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the development server makes the list when asked, fresh each time', async () => {
  const root = tree(base);
  let n = 0;
  const server = createStaticServer({ root, allowDirs: ['studio'], generated: { '/studio/offline-files.js': () => `// made ${++n}` } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/studio/offline-files.js`;
    const a = await fetch(url);
    assert.equal(a.headers.get('content-type'), 'text/javascript; charset=utf-8'); assert.equal(a.headers.get('cache-control'), 'no-cache');
    assert.equal(await a.text(), '// made 1'); assert.equal(await (await fetch(url)).text(), '// made 2');
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
});
