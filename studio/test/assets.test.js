import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accept, safeName, sniff, assetKind, assetsOf, fingerprint, LIMITS } from '../app/store/assets.js';

const bytes = (...head) => new Uint8Array([...head, ...new Array(Math.max(0, 16 - head.length)).fill(0)]);
const text = (s) => [...s].map((c) => c.charCodeAt(0));
const PNG = bytes(0x89, ...text('PNG'));
const WAV = bytes(...text('RIFF'), 0, 0, 0, 0, ...text('WAVE'));

test('names are made safe: no folders, no odd characters, a lowercase extension, and nothing without a name', () => {
  assert.equal(safeName('Hero Sprite.PNG'), 'Hero Sprite.png');
  assert.equal(safeName('C:\\Users\\me\\pic.png'), 'pic.png'); assert.equal(safeName('../../etc/pass.png'), 'pass.png');
  assert.equal(safeName('we<ird>"na|me?.jpg'), 'weirdname.jpg'); assert.equal(safeName('.hidden.png'), 'hidden.png');
  assert.equal(safeName('noextension'), ''); assert.equal(safeName('.png'), ''); assert.equal(safeName(''), '');
  assert.ok(safeName(`${'a'.repeat(200)}.png`).length <= 65);
});

test('files are accepted by what they are: the first bytes must match the extension', () => {
  assert.equal(sniff('png', PNG), true); assert.equal(sniff('png', WAV), false); assert.equal(sniff('wav', WAV), true);
  assert.equal(sniff('jpg', bytes(0xff, 0xd8, 0xff, 0xe0)), true); assert.equal(sniff('gif', bytes(...text('GIF89a'))), true);
  assert.equal(sniff('webp', bytes(...text('RIFF'), 0, 0, 0, 0, ...text('WEBP'))), true); assert.equal(sniff('ogg', bytes(...text('OggS'))), true);
  assert.equal(sniff('mp3', bytes(...text('ID3'))), true); assert.equal(sniff('mp3', bytes(0xff, 0xfb)), true);
  assert.equal(sniff('exe', PNG), false); assert.equal(sniff('png', new Uint8Array(3)), false); assert.equal(sniff('png', 'text'), false);
});

test('accepting: where it goes, duplicates get a number, and every refusal says why', () => {
  const a = accept('Hero.png', PNG); assert.deepEqual(a, { ok: true, path: 'assets/Hero.png', kind: 'image', mime: 'image/png' });
  const taken = new Set(['assets/Hero.png', 'assets/Hero-2.png']);
  assert.equal(accept('Hero.png', PNG, (p) => taken.has(p)).path, 'assets/Hero-3.png');
  assert.equal(accept('jump.wav', WAV).kind, 'sound');
  assert.match(accept('notes.txt', PNG).reason, /pictures .* sounds/); assert.match(accept('script.js', PNG).reason, /can be imported/);
  assert.match(accept('fake.png', WAV).reason, /not really a png/); assert.match(accept('x', PNG).reason, /no usable name/);
  assert.match(accept('big.png', Object.assign(new Uint8Array(LIMITS.image + 1), PNG)).reason, /too big/);
  assert.equal(accept('big.wav', Object.assign(new Uint8Array(LIMITS.image + 1), WAV)).ok, true, 'a sound may be bigger than a picture');
  assert.match(accept('big.wav', Object.assign(new Uint8Array(LIMITS.sound + 1), WAV)).reason, /too big/);
});

test('the assets of a project are the binary files in assets/ with a known type, with a fingerprint that changes with the content', () => {
  const files = { 'src/main.js': 'x', 'assets/a.png': PNG, 'assets/b.wav': WAV, 'assets/readme.txt': 'hi', 'assets/c.png': 'a text file called png', 'other/d.png': PNG };
  const project = { list: () => Object.keys(files), read: (p) => files[p] };
  const found = assetsOf(project);
  assert.deepEqual(found.map((x) => `${x.path}:${x.kind}:${x.mime}`), ['assets/a.png:image:image/png', 'assets/b.wav:sound:audio/wav']);
  assert.equal(assetKind('assets/a.PNG'), 'image'); assert.equal(assetKind('src/a.png'), null); assert.equal(assetKind('assets/a.exe'), null);
  assert.notEqual(fingerprint(PNG), fingerprint(WAV)); assert.equal(fingerprint(PNG), fingerprint(new Uint8Array(PNG)));
});
