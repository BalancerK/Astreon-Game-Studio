import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, readFolder, writeFile, removeFile, isDirectoryHandle, LIMITS, hashOf, without } from '../app/store/folder-sync.js';
import { MemoryFolder } from '../app/store/memory-folder.js';

/** Do what a plan says to two plain objects (the studio does the same to the project and to the folder), and return the new baseline. */
function apply(p, project, folder) {
  for (const op of p.ops) {
    const side = op.side === 'project' ? project : folder;
    if (op.text === null) delete side[op.path]; else side[op.path] = op.text;
  }
  return p.baseline;
}

test('the first time: files only on one side are copied, a file on both that differs is a conflict where the project wins and nothing is lost', () => {
  const project = { 'src/main.js': 'mine', 'only-project.js': 'p' };
  const folder = { 'src/main.js': 'theirs', 'only-folder.md': 'f' };
  const p = plan(project, folder, {});
  assert.deepEqual(p.conflicts, ['src/main.js']);
  const base = apply(p, project, folder);
  assert.equal(project['only-folder.md'], 'f'); assert.equal(folder['only-project.js'], 'p');
  assert.equal(project['src/main.js'], 'mine'); assert.equal(folder['src/main.js'], 'mine');
  assert.equal(project['conflicts/src/main.js'], 'theirs'); assert.equal(folder['conflicts/src/main.js'], 'theirs');
  assert.deepEqual(project, folder);
  assert.deepEqual(plan(project, folder, base).ops, [], 'and a second look finds nothing left to do');
});

test('choosing the folder as the truth replaces the project with it, including removing what the folder lacks', () => {
  const project = { 'a.js': '1', 'b.js': '2' };
  const folder = { 'a.js': '9', 'c.js': '3' };
  const p = plan(project, folder, {}, { mode: 'folder' });
  apply(p, project, folder);
  assert.deepEqual(project, { 'a.js': '9', 'c.js': '3' }); assert.deepEqual(folder, { 'a.js': '9', 'c.js': '3' }); assert.deepEqual(p.conflicts, []);
});

test('afterwards only what changed on one side is copied, in whichever direction', () => {
  const project = { 'a.js': '1', 'b.js': '2', 'c.js': '3' };
  const folder = { ...project };
  const base = apply(plan(project, folder, {}), project, folder);
  project['a.js'] = 'edited in the studio';
  folder['b.js'] = 'edited in git';
  project['new.js'] = 'new here';
  folder['other.md'] = 'new there';
  const p = plan(project, folder, base);
  assert.deepEqual(p.ops.map((o) => `${o.side}:${o.path}`).sort(), ['folder:a.js', 'folder:new.js', 'project:b.js', 'project:other.md']);
  assert.deepEqual(p.conflicts, []);
  const next = apply(p, project, folder);
  assert.deepEqual(project, folder); assert.deepEqual(plan(project, folder, next).ops, []);
});

test('a deletion on one side is followed on the other, unless that file also changed there', () => {
  const project = { 'a.js': '1', 'b.js': '2', 'c.js': '3', 'd.js': '4', 'e.js': '5' };
  const folder = { ...project };
  const base = apply(plan(project, folder, {}), project, folder);
  delete project['a.js'];
  delete folder['b.js'];
  folder['c.js'] = 'changed in the folder';
  delete project['c.js'];
  project['d.js'] = 'changed in the studio';
  delete folder['d.js'];
  const p = plan(project, folder, base);
  apply(p, project, folder);
  assert.ok(!('a.js' in project) && !('a.js' in folder), 'deleted in the studio: gone from the folder');
  assert.ok(!('b.js' in project) && !('b.js' in folder), 'deleted in the folder: gone from the project');
  assert.equal(project['c.js'], 'changed in the folder'); assert.equal(folder['c.js'], 'changed in the folder');
  assert.equal(project['d.js'], 'changed in the studio'); assert.equal(folder['d.js'], 'changed in the studio');
  assert.deepEqual(p.conflicts.sort(), ['c.js', 'd.js']);
  assert.deepEqual(project, folder);
});

test('a mass deletion is held back: an empty folder, or a git checkout half done, does not empty the project', () => {
  const project = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.js`, `${i}`]));
  const folder = { ...project };
  const base = apply(plan(project, folder, {}), project, folder);
  const emptied = {};
  const p = plan(project, emptied, base);
  assert.equal(p.heldBack.length, 10); assert.deepEqual(p.ops, [], 'nothing is deleted');
  assert.deepEqual(Object.keys(p.baseline).sort(), Object.keys(base).sort(), 'and the project is not forgotten');
  const fewer = { ...folder }; delete fewer['f0.js']; delete fewer['f1.js'];
  assert.equal(plan(project, fewer, base).ops.length, 2, 'a couple of deletions are normal');
  const projectEmptied = {};
  assert.equal(plan(projectEmptied, folder, base).heldBack.length, 10, 'the other way round too');
});

test('reading a folder: only text files, no hidden or dependency folders, nested paths, and a file that has not changed is not read again', async () => {
  const dir = new MemoryFolder({
    'src/main.js': 'code', 'src/deep/a.json': '{}', 'README.md': '# hi', 'image.bin': 'binary', '.git/config': 'x', 'node_modules/x/index.js': 'x', '.hidden.js': 'x', 'notes.txt': 'n',
  });
  const { files, skipped } = await readFolder(dir);
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'notes.txt', 'src/deep/a.json', 'src/main.js']); assert.deepEqual(skipped, []);
  assert.equal(files.get('src/main.js').text, 'code');
  let reads = 0;
  const counted = { entries: dir.entries.bind(dir) };
  const watch = new MemoryFolder({ 'a.js': 'aa', 'b.js': 'bb' });
  const original = watch.getFileHandle.bind(watch);
  const first = await readFolder(watch);
  const wrapped = { kind: 'directory', async *entries() { for await (const [n, h] of watch.entries()) yield [n, { kind: h.kind, getFile: async () => { const f = await h.getFile(); return { ...f, text: async () => { reads++; return f.text(); } }; } }]; } };
  await readFolder(wrapped, first.files); assert.equal(reads, 0, 'unchanged: not read');
  watch.edit('a.js', 'changed');
  const again = await readFolder(wrapped, first.files); assert.equal(reads, 1); assert.equal(again.files.get('a.js').text, 'changed');
  void counted; void original;
});

test('limits: a huge file, too many files and too deep a tree are skipped and reported, not loaded', async () => {
  const files = { 'ok.js': 'x', 'huge.js': 'x'.repeat(LIMITS.fileBytes + 1) };
  assert.deepEqual((await readFolder(new MemoryFolder(files))).skipped, ['huge.js (too big)']);
  const deepPath = `${Array.from({ length: LIMITS.depth + 2 }, (_, i) => `d${i}`).join('/')}/x.js`;
  const deep = await readFolder(new MemoryFolder({ [deepPath]: 'x', 'a.js': 'a' }));
  assert.ok(deep.skipped.some((s) => s.includes('too deep'))); assert.ok(deep.files.has('a.js'));
  const many = Object.fromEntries(Array.from({ length: LIMITS.files + 5 }, (_, i) => [`f${i}.js`, 'x']));
  const r = await readFolder(new MemoryFolder(many)); assert.equal(r.files.size, LIMITS.files); assert.equal(r.skipped.length, 5);
});

test('writing and removing: folders are made on the way, removing a missing file is fine, and handles are recognised', async () => {
  const dir = new MemoryFolder();
  await writeFile(dir, 'a/b/c.js', 'deep'); await writeFile(dir, 'top.md', 'hi'); await writeFile(dir, 'top.md', 'again');
  assert.deepEqual(dir.snapshot(), { 'a/b/c.js': 'deep', 'top.md': 'again' });
  await removeFile(dir, 'a/b/c.js'); await removeFile(dir, 'a/b/c.js'); await removeFile(dir, 'nothing/here.js');
  assert.deepEqual(dir.snapshot(), { 'top.md': 'again' });
  assert.equal(isDirectoryHandle(dir), true); assert.equal(isDirectoryHandle({}), false); assert.equal(isDirectoryHandle(null), false);
});

// ---- pictures and sounds travel with the text files ----
const png = (...rest) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...rest]);
const wav = (...rest) => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, ...rest]);

test('reading a folder brings pictures and sounds in as bytes, and leaves out a file that is not what its name says', async () => {
  const folder = new MemoryFolder({ 'main.js': 'x', 'assets/hero.png': png(1), 'assets/boom.wav': wav(2), 'assets/fake.png': new Uint8Array(40), 'notes.bin': new Uint8Array(5) });
  const { files, skipped, skippedPaths } = await readFolder(folder);
  assert.deepEqual([...files.keys()].sort(), ['assets/boom.wav', 'assets/hero.png', 'main.js']);
  assert.ok(files.get('assets/hero.png').text instanceof Uint8Array);
  assert.deepEqual([...files.get('assets/hero.png').text], [...png(1)]);
  assert.ok(skipped.some((s) => s.includes('fake.png') && s.includes('not really')));
  assert.ok(skippedPaths.has('assets/fake.png'));
});

test('a picture too big for a project is left out and not taken for deleted', async () => {
  const big = new Uint8Array(2_100_000); big.set(png());
  const folder = new MemoryFolder({ 'assets/huge.png': big });
  const { files, skippedPaths } = await readFolder(folder);
  assert.equal(files.size, 0);
  assert.ok(skippedPaths.has('assets/huge.png'));
  const project = { 'assets/huge.png': png(7) };
  const base = { 'assets/huge.png': hashOf(project['assets/huge.png']) };
  assert.deepEqual(plan(without(project, skippedPaths), files, without(base, skippedPaths)).ops, []);
  assert.ok(plan(project, files, base).ops.length > 0, 'without the guard the project\'s picture would be deleted');
});

test('pictures sync like text: copied both ways, changes found by their bytes, conflicts keep both', async () => {
  const project = { 'src/main.js': 'm', 'assets/a.png': png(1) };
  const folder = { 'src/main.js': 'm', 'assets/b.wav': wav(5) };
  const base = (() => { const p = plan(project, folder, {}); for (const op of p.ops) (op.side === 'project' ? project : folder)[op.path] = op.text; return p.baseline; })();
  assert.deepEqual([...folder['assets/a.png']], [...png(1)]);
  assert.deepEqual([...project['assets/b.wav']], [...wav(5)]);
  assert.deepEqual(plan(project, folder, base).ops, [], 'bytes that did not change are not copied again');
  project['assets/a.png'] = png(1, 2);                                    // painted in the studio
  folder['assets/b.wav'] = wav(9);                                        // replaced by another program
  const p = plan(project, folder, base);
  assert.deepEqual(p.ops.map((o) => `${o.side}:${o.path}`).sort(), ['folder:assets/a.png', 'project:assets/b.wav']);
  assert.ok(p.ops.every((o) => o.text instanceof Uint8Array));
  for (const op of p.ops) (op.side === 'project' ? project : folder)[op.path] = op.text;
  const next = p.baseline;
  project['assets/a.png'] = png(3); folder['assets/a.png'] = png(4);       // both changed the same picture
  const c = plan(project, folder, next);
  assert.deepEqual(c.conflicts, ['assets/a.png']);
  assert.ok(c.ops.some((o) => o.path === 'conflicts/assets/a.png' && o.side === 'project' && [...o.text][12] === 4));
  assert.notEqual(hashOf(png(1)), hashOf(png(2)));
  assert.notEqual(hashOf('abc'), hashOf(new Uint8Array([97, 98, 99])), 'text and bytes never look the same');
});

test('writing a picture into a folder and reading it back gives the same bytes', async () => {
  const folder = new MemoryFolder();
  await writeFile(folder, 'assets/deep/hero.png', png(1, 2, 3));
  await writeFile(folder, 'main.js', 'text');
  const back = await readFolder(folder);
  assert.deepEqual([...back.files.get('assets/deep/hero.png').text], [...png(1, 2, 3)]);
  assert.equal(back.files.get('main.js').text, 'text');
  assert.equal(folder.snapshot()['main.js'], 'text');
});

test('a picture or sound outside assets/ is reported with what to do, and is not taken for deleted; conflict copies are found', async () => {
  const { conflictCopies } = await import('../app/store/folder-sync.js');
  const dir = new MemoryFolder({ 'src/main.js': 'x', 'art/hero.png': png(1), 'sounds/hit.wav': wav(2) });
  const { files, skipped, skippedPaths } = await readFolder(dir);
  assert.deepEqual([...files.keys()], ['src/main.js']);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.every((s) => /outside assets\//.test(s)));
  assert.ok(skippedPaths.has('art/hero.png') && skippedPaths.has('sounds/hit.wav'));
  assert.deepEqual(conflictCopies(['a.js', 'conflicts/src/a.js']), [{ copy: 'conflicts/src/a.js', original: 'src/a.js' }]);
});

test('ignore patterns: a name anywhere, a path from the top, a whole folder, and ** across folders', async () => {
  const { ignoreMatcher } = await import('../app/store/folder-sync.js');
  const ignored = ignoreMatcher(['*.psd', 'drafts/', 'src/old/*.js', '# a comment', '', '**/tmp']);
  for (const p of ['a.psd', 'x/y.psd', 'drafts', 'drafts/a.js', 'src/old/a.js', 'deep/x/tmp']) assert.ok(ignored(p), p);
  for (const p of ['src/new/a.js', 'mydrafts/a.js', 'a.psd.txt', 'notes.md']) assert.ok(!ignored(p), p);
});

test('pictures in a chosen folder come in as assets/<folder>/… and go back where they came from; the folder\'s own assets/ wins a clash', async () => {
  const { toProjectPath, toFolderPath, cleanAssetDirs } = await import('../app/store/folder-sync.js');
  assert.deepEqual(cleanAssetDirs(['art', '/art/', 'assets', 'sounds/fx', '..', '.git', 'conflicts']), ['art', 'sounds/fx']);
  assert.equal(toProjectPath('art/hero.png', ['art']), 'assets/art/hero.png');
  assert.equal(toFolderPath('assets/art/hero.png', ['art']), 'art/hero.png');
  assert.equal(toFolderPath('assets/other.png', ['art']), 'assets/other.png');
  const folder = new MemoryFolder({ 'art/hero.png': png(1), 'art/cool.psd': 'x', 'sounds/hit.wav': wav(2), 'assets/art/hero.png': png(5), 'drafts/a.js': 'x', 'src/a.js': 'y' });
  const { files, skipped } = await readFolder(folder, new Map(), { assetDirs: ['art', 'sounds'], ignore: (p) => p.startsWith('drafts') });
  assert.deepEqual([...files.keys()].sort(), ['assets/art/hero.png', 'assets/sounds/hit.wav', 'src/a.js']);
  assert.deepEqual([...files.get('assets/art/hero.png').text], [...png(5)], 'the folder\'s own assets/ copy won');
  assert.ok(skipped.some((s) => s.startsWith('art/hero.png') && /same name/.test(s)));
  assert.ok(!skipped.some((s) => s.includes('drafts')), 'ignored files are not even mentioned');
});
