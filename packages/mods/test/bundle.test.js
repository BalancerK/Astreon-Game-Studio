import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  canonicalJson, sha256Bytes, sha256Hex, sha256HexSync, validateManifest, validateBundle, hashBundle, hashClientView,
  clientView, verifyClientView, BUNDLE_LIMITS,
} from '../src/index.js';
import { validateCommand, mergeRuleSets, generateSigningKey, signHash, verifySignature } from '../src/node.js';

const dataMod = (extra = {}) => ({ manifest: { id: 'fast-weapons', version: '1.0.0', tier: 'data', rules: { weapon: { cooldownTicks: 5 } }, ...extra }, files: {} });
const scriptMod = (src = 'engine.register({});', extra = {}) => ({ manifest: { id: 'healer', version: '1.2.3', tier: 'script', entry: 'main.js', ...extra }, files: { 'main.js': src } });

test('canonicalJson is deterministic and rejects what JSON cannot represent faithfully', () => {
  assert.equal(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }], z: null }), '{"a":[3,{"c":2,"d":1}],"b":1,"z":null}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.equal(canonicalJson('é"\n'), JSON.stringify('é"\n'));
  for (const bad of [NaN, Infinity, undefined, () => 1, 10n, Symbol('x')]) assert.throws(() => canonicalJson({ v: bad }), TypeError);
});

test('the pure-JS SHA-256 matches Node\'s native one at every block boundary and for UTF-8', async () => {
  assert.equal(sha256HexSync(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256HexSync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256HexSync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65537]) {
    const bytes = randomBytes(n);
    assert.equal(sha256Bytes(bytes), createHash('sha256').update(bytes).digest('hex'), `${n} bytes`);
  }
  const text = 'ünïcödé ✓ 日本語 😀'.repeat(50);
  assert.equal(sha256HexSync(text), createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.equal(await sha256Hex(text), sha256HexSync(text), 'native subtle crypto and the fallback agree');
  // without crypto.subtle (an insecure browser context) the fallback is used
  const subtle = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  try { assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); } finally { Object.defineProperty(globalThis, 'crypto', subtle); }
});

test('manifest validation accepts good manifests and explains every problem', () => {
  assert.ok(validateManifest(dataMod().manifest).ok);
  assert.ok(validateManifest(scriptMod().manifest).ok);
  const bad = (patch, expected, base = dataMod().manifest) => {
    const r = validateManifest({ ...base, ...patch });
    assert.equal(r.ok, false, `accepted ${JSON.stringify(patch)}`);
    assert.ok(r.errors.some((e) => e.includes(expected)), `${JSON.stringify(patch)} -> ${r.errors.join('; ')}`);
  };
  bad({ extra: 1 }, 'unknown field "extra"');
  bad({ id: 'Bad Id' }, 'id must be');
  bad({ id: '1abc' }, 'id must be');
  bad({ id: 'x'.repeat(33) }, 'id must be');
  bad({ version: '1.0' }, 'invalid version');
  bad({ version: undefined }, 'version is required');
  bad({ engine: 'latest' }, 'engine must be');
  bad({ tier: 'native' }, 'tier must be');
  bad({ entry: 'main.js' }, 'only allowed for tier "script"');
  bad({ dependencies: { 'a': 'bogus' } }, 'invalid range');
  bad({ dependencies: { 'Bad': '^1.0.0' } }, 'dependency id');
  bad({ dependencies: [] }, 'dependencies must be an object');
  bad({ rules: [] }, 'rules must be an object');
  bad({ rules: { x: 'y'.repeat(5000) } }, 'rules is too large');
  bad({ limits: { memoryMb: -1 } }, 'positive number');
  bad({ limits: { cpu: 1 } }, 'unknown limit');
  bad({ name: 5 }, 'name must be a string');
  for (const entry of ['../evil.js', '/etc/passwd.js', 'a\\b.js', 'main', 'sub/../x.js', '.hidden.js', 'a//b.js']) {
    bad({ entry }, 'entry must be', scriptMod().manifest);
  }
  assert.equal(validateManifest(null).ok, false);
  assert.equal(validateManifest([]).ok, false);
  assert.ok(validateManifest({ ...scriptMod().manifest, entry: 'lib/main.js' }).ok, 'nested relative entries are fine');
});

test('bundle validation enforces file rules and size limits', () => {
  assert.ok(validateBundle(dataMod()).ok);
  assert.ok(validateBundle(scriptMod()).ok);
  const errs = (b) => validateBundle(b).errors.join('; ');
  assert.match(errs({ manifest: scriptMod().manifest, files: {} }), /entry "main.js" is not among/);
  assert.match(errs({ ...dataMod(), files: { 'a.js': 'x' } }), /data mod must not contain script files/);
  assert.match(errs(scriptMod('x'.repeat(BUNDLE_LIMITS.fileBytes + 1))), /too large/);
  const many = Object.fromEntries(Array.from({ length: BUNDLE_LIMITS.files + 1 }, (_, i) => [`f${i}.json`, '{}']));
  assert.match(errs({ manifest: { ...scriptMod().manifest }, files: { 'main.js': '', ...many } }), /at most 16 files/);
  assert.match(errs({ manifest: scriptMod().manifest, files: { 'main.js': 5 } }), /must be text/);
  assert.equal(validateBundle(null).ok, false);
});

test('hashes identify exactly what runs; the client hash covers only what clients receive', async () => {
  const a = scriptMod('engine.register({ onFrame() {} });', { rules: { weapon: { damage: 40 } }, client: { theme: { floor: [1, 2, 3] } } });
  const reordered = { files: { ...a.files }, manifest: Object.fromEntries(Object.entries(a.manifest).reverse()) };
  assert.equal(hashBundle(a), hashBundle(reordered), 'key order does not matter');
  assert.match(hashBundle(a), /^[0-9a-f]{64}$/);

  const scriptChanged = { ...a, files: { 'main.js': 'engine.register({ onFrame() { /* edit */ } });' } };
  assert.notEqual(hashBundle(scriptChanged), hashBundle(a), 'any script edit changes the bundle hash');
  assert.equal(hashClientView(scriptChanged), hashClientView(a), '...but clients do not receive scripts, so their hash is unchanged');
  const rulesChanged = { ...a, manifest: { ...a.manifest, rules: { weapon: { damage: 41 } } } };
  assert.notEqual(hashClientView(rulesChanged), hashClientView(a));
  assert.notEqual(hashBundle(rulesChanged), hashBundle(a));

  const view = clientView(a);
  assert.deepEqual(Object.keys(view).sort(), ['client', 'id', 'rules', 'version']);
  assert.ok(!JSON.stringify(view).includes('onFrame'), 'no script source in the client view');
  const h = hashClientView(a);
  assert.equal(await verifyClientView(view, h), true);
  assert.equal(await verifyClientView({ ...view, rules: { weapon: { damage: 99 } } }, h), false, 'tampered rules');
  assert.equal(await verifyClientView({ ...view, extra: 1 }, h), false, 'extra field');
  assert.equal(await verifyClientView(view, h.replace(/^./, (c) => (c === '0' ? '1' : '0'))), false, 'wrong advertised hash');
  const cyclic = {}; cyclic.me = cyclic;
  assert.equal(await verifyClientView(cyclic, h), false, 'garbage');
  assert.equal(await verifyClientView({ ...view, rules: { x: NaN } }, h), false, 'non-JSON numbers');
});

test('command validation: exact fields, types and ranges; unknown ops and prototype keys refused', () => {
  const specs = {
    heal: { id: { type: 'int', min: 0 }, amount: { type: 'number', min: 0, max: 100 } },
    say: { text: { type: 'string', maxLength: 10 }, loud: { type: 'bool' } },
  };
  const ok = (c) => assert.deepEqual(validateCommand(c, specs), { ok: true }, JSON.stringify(c));
  const no = (c, re) => { const r = validateCommand(c, specs); assert.equal(r.ok, false, JSON.stringify(c)); assert.match(r.error, re, JSON.stringify(c)); };
  ok({ op: 'heal', id: 3, amount: 12.5 });
  ok({ op: 'say', text: 'hi', loud: false });
  no({ op: 'heal', id: 3.5, amount: 1 }, /integer/);
  no({ op: 'heal', id: -1, amount: 1 }, /out of range/);
  no({ op: 'heal', id: 1, amount: 101 }, /out of range/);
  no({ op: 'heal', id: 1, amount: NaN }, /finite/);
  no({ op: 'heal', id: 1, amount: Infinity }, /finite|range/);
  no({ op: 'heal', id: 1, amount: '5' }, /finite number/);
  no({ op: 'heal', id: 1 }, /missing "amount"/);
  no({ op: 'heal', id: 1, amount: 1, extra: true }, /unexpected field "extra"/);
  no({ op: 'say', text: 'x'.repeat(11), loud: true }, /at most 10/);
  no({ op: 'say', text: 'x', loud: 1 }, /boolean/);
  no({ op: 'nope' }, /unknown op/);
  no({ op: '__proto__' }, /unknown op/);
  no({ op: 'constructor' }, /unknown op/);
  no({ op: 'toString' }, /unknown op/);
  no(null, /object/);
  no([], /object/);
  no('heal', /object/);
  no({ op: 'heal', id: 1, amount: 1, __proto__x: 1 }, /unexpected field/);
});

test('rule merging: later mods win, conflicts are reported per dotted key', () => {
  const { merged, conflicts } = mergeRuleSets([
    { mod: 'a', rules: { weapon: { damage: 40, range: 500 }, playerSpeed: 300 } },
    { mod: 'b', rules: { weapon: { cooldownTicks: 4 } } },
    { mod: 'c', rules: { weapon: { damage: 10 }, playerSpeed: 500 } },
  ]);
  assert.deepEqual(merged, { 'weapon.damage': 10, 'weapon.range': 500, playerSpeed: 500, 'weapon.cooldownTicks': 4 });
  assert.deepEqual(conflicts.map((c) => [c.key, c.mods, c.winner]), [['weapon.damage', ['a', 'c'], 'c'], ['playerSpeed', ['a', 'c'], 'c']]);
  assert.deepEqual(mergeRuleSets([]), { merged: {}, conflicts: [] });
});

test('signatures: valid, wrong key, tampered hash and malformed input', () => {
  const key = generateSigningKey();
  const other = generateSigningKey();
  const hash = hashBundle(scriptMod());
  const sig = signHash(hash, key);
  assert.match(key.publicKey, /^[0-9a-f]{64}$/);
  assert.equal(verifySignature(hash, sig), true);
  assert.equal(verifySignature(hash.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), sig), false, 'different content');
  assert.equal(verifySignature(hash, { ...sig, key: other.publicKey }), false, 'someone else\'s key');
  assert.equal(verifySignature(hash, { ...sig, sig: sig.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }), false);
  for (const bad of [null, undefined, {}, { key: 'zz', sig: 'zz' }, { key: sig.key, sig: 'ab' }, { key: 5, sig: 6 }, 'str']) assert.equal(verifySignature(hash, bad), false);
});
