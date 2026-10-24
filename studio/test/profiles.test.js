import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../export/profiles.js';
import { buildWebExport, indexHtml } from '../export/export.js';

test('with no file there are two usual profiles, release and debug, and a project that changes nothing has no file', () => {
  const b = B.buildOf({});
  assert.deepEqual(Object.keys(b.profiles), ['release', 'debug']);
  assert.equal(b.selected, 'release');
  assert.equal(b.profiles.release.debug, false);
  assert.equal(b.profiles.debug.debug, true);
  assert.equal(b.profiles.debug.offline, false);
  assert.equal(B.serializeBuild(b), null);
  assert.equal(B.buildOf({ 'build.json': 'not json' }).problems.length, 1);
  assert.deepEqual(Object.keys(B.buildOf({ 'build.json': '{' }).profiles), ['release', 'debug']);
});

test('a profile file is read back exactly, with bad parts put right and explained', () => {
  let b = B.buildOf({});
  b = B.addProfile(b, 'itch', 'release');
  b = B.updateProfile(b, 'itch', { title: 'My Game (itch)', exclude: ['tests/**', 'docs'] });
  const text = B.serializeBuild(b);
  assert.ok(text);
  const back = B.buildOf({ 'build.json': text });
  assert.deepEqual(back.profiles, b.profiles);
  assert.equal(back.selected, 'itch');
  const odd = B.cleanBuild({ selected: 'nope', profiles: { 'bad name!': {}, ok: { title: 'x'.repeat(500), debug: 1, offline: 0, exclude: ['../secret', '', 5, './a.js', 'a.js'] } } });
  assert.equal(odd.problems.length, 1);
  assert.equal(odd.selected, 'ok');
  assert.equal(odd.profiles.ok.title.length, 60);
  assert.equal(odd.profiles.ok.debug, true);
  assert.equal(odd.profiles.ok.offline, false);
  assert.deepEqual(odd.profiles.ok.exclude, ['a.js'], 'no ..; ./ is dropped; duplicates removed');
});

test('patterns: * stays in a folder, ** goes through folders, ? is one letter, a folder name leaves out everything in it', () => {
  const x = (path, ...patterns) => B.isExcluded(path, patterns);
  assert.ok(x('tests/a.js', 'tests/**') && x('tests/deep/a.js', 'tests/**'));
  assert.ok(x('src/a.test.js', '**/*.test.js') && x('a.test.js', '**/*.test.js'));
  assert.ok(!x('src/a.js', '**/*.test.js'));
  assert.ok(x('src/a.js', 'src/*.js') && !x('src/deep/a.js', 'src/*.js'));
  assert.ok(x('src/a1.js', 'src/a?.js') && !x('src/a12.js', 'src/a?.js'));
  assert.ok(x('docs/readme.md', 'docs') && x('docs/a/b.md', 'docs/'));
  assert.ok(!x('docsx/a.md', 'docs'));
  assert.ok(x('a.b', 'a.b') && !x('aXb', 'a.b'), 'a dot is a dot');
  assert.ok(x('build.json'), 'the profiles file is never in a build');
});

test('a profile keeps and leaves out files and assets, with sizes, and warns when a kept file needs one that was left out', () => {
  const files = {
    'src/main.js': "import { dbg } from './debug/overlay.js';\nimport x from './art/hero.js';",
    'src/debug/overlay.js': 'export const dbg = 1;',
    'src/art/hero.js': 'export default 1;',
    'tests/a.test.js': "import '../src/main.js';",
    'build.json': '{}',
  };
  const assets = [{ path: 'assets/a.png', bytes: new Uint8Array(100) }, { path: 'assets/drafts/b.png', bytes: new Uint8Array(40) }];
  const r = B.applyProfile(files, assets, B.cleanProfile({ exclude: ['tests/**', 'src/debug', 'assets/drafts'] }));
  assert.deepEqual(Object.keys(r.files).sort(), ['src/art/hero.js', 'src/main.js']);
  assert.deepEqual(r.assets.map((a) => a.path), ['assets/a.png']);
  assert.deepEqual(r.left.map((l) => l.path).sort(), ['assets/drafts/b.png', 'build.json', 'src/debug/overlay.js', 'tests/a.test.js']);
  assert.equal(r.left.find((l) => l.path === 'assets/drafts/b.png').bytes, 40);
  assert.deepEqual(r.problems, [{ from: 'src/main.js', path: 'src/debug/overlay.js' }]);
  const clean = B.applyProfile(files, assets, B.cleanProfile({ exclude: ['tests/**'] }));
  assert.deepEqual(clean.problems, []);
});

test('profiles are added as copies, selected, changed and removed (one always stays)', () => {
  let b = B.buildOf({});
  assert.match(B.nameProblem(b, '1x'), /Use letters/);
  assert.match(B.nameProblem(b, 'release'), /already/);
  assert.equal(B.nameProblem(b, 'phone'), null);
  b = B.addProfile(b, 'phone', 'debug');
  assert.equal(b.selected, 'phone');
  assert.equal(b.profiles.phone.debug, true, 'a copy of debug');
  b = B.updateProfile(b, 'phone', { offline: false, title: 'Phone' });
  assert.equal(b.profiles.phone.title, 'Phone');
  assert.equal(B.selectProfile(b, 'release').selected, 'release');
  assert.equal(B.selectProfile(b, 'nope'), b);
  b = B.removeProfile(b, 'phone');
  assert.equal(b.selected, 'release');
  b = B.removeProfile(b, 'debug');
  assert.deepEqual(Object.keys(b.profiles), ['release']);
  assert.throws(() => B.removeProfile({ selected: 'a', profiles: { a: B.cleanProfile({}) } }, 'a'), /at least one/);
  let many = B.buildOf({});
  for (let i = 0; i < 10; i++) many = B.addProfile(many, `p${i}`);
  assert.match(B.nameProblem(many, 'extra'), /At most 12/);
});

test('the export tells the page which build it is, and the build note says debug or not', async () => {
  assert.deepEqual(B.buildNote('release', B.DEFAULT_PROFILES.release), { name: 'release', debug: false });
  assert.deepEqual(B.buildNote('debug', B.DEFAULT_PROFILES.debug), { name: 'debug', debug: true });
  const page = indexHtml({ title: 't', id: 'x', hasKit: false, hasSound: false, offline: false, build: { name: 'itch', debug: false } });
  assert.match(page, /"build":\{"name":"itch","debug":false\}/);
  assert.ok(!indexHtml({ title: 't', id: 'x', hasKit: false, hasSound: false, offline: false }).includes('"build"'), 'no build note when there is no profile');
  const out = await buildWebExport({
    files: { 'src/main.js': 'export function create() { return {}; }\nexport function update() {}\nexport function render() {}' }, title: 'T',
    readEngine: async () => null, runtime: '// runtime', offline: false, build: { name: 'debug', debug: true },
  });
  assert.match(out.files['index.html'], /"build":\{"name":"debug","debug":true\}/);
});
