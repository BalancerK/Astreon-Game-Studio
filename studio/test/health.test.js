import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { bytesOf, kindOf, sizeReport, BUDGETS, defaultBudgets, evaluate, cleanBudgets, frameStats, human } from '../export/health.js';

const gz = async (bytes) => gzipSync(bytes).length;

test('sizes: bytes of text (not characters), the kind of each file, and compressed size', async () => {
  assert.equal(bytesOf('abc'), 3); assert.equal(bytesOf('é'), 2); assert.equal(bytesOf(new Uint8Array(5)), 5); assert.equal(bytesOf(undefined), 0);
  assert.equal(kindOf('engine/arcade/src/index.js'), 'engine'); assert.equal(kindOf('game/src/art/hero.js'), 'art'); assert.equal(kindOf('game/src/sounds.js'), 'sounds');
  assert.equal(kindOf('game/src/main.js'), 'code'); assert.equal(kindOf('index.html'), 'other');
  const files = { 'game/src/main.js': 'x'.repeat(5000), 'engine/a.js': 'y'.repeat(100), 'index.html': '<p>' };
  const r = await sizeReport(files, gz);
  assert.equal(r.files, 3); assert.equal(r.rawBytes, 5103); assert.ok(r.gzipBytes < 300, `repetitive text compresses (${r.gzipBytes})`);
  assert.deepEqual(r.byKind.code, { files: 1, rawBytes: 5000 }); assert.equal(r.byKind.engine.files, 1); assert.equal(r.largest[0].path, 'game/src/main.js');
  assert.deepEqual(await sizeReport({}, gz), { files: 0, rawBytes: 0, gzipBytes: 0, byKind: {}, largest: [] });
});

test('budgets: a value over its limit fails, a missing measurement is unknown, a limit that is off is off, and the slow-device factor multiplies the frame cost', () => {
  const m = { gzipBytes: 120_000, files: 40, frameMs: 1.5, slowdown: 4, firstFrameMs: 400, memoryMB: 30 };
  const ok = evaluate(m, defaultBudgets());
  assert.equal(ok.passed, true); assert.deepEqual(ok.failing, []); assert.equal(ok.items.length, BUDGETS.length); assert.equal(ok.items.find((i) => i.id === 'frame').value, 6);
  const tight = evaluate(m, { ...defaultBudgets(), frame: 4, download: 100 });
  assert.equal(tight.passed, false); assert.deepEqual(tight.failing, ['Download size (compressed)', 'Time per frame on a slow device']);
  assert.equal(tight.items.find((i) => i.id === 'frame').state, 'fail'); assert.equal(tight.items.find((i) => i.id === 'files').state, 'ok');
  const partial = evaluate({ gzipBytes: 1000 }, defaultBudgets()); assert.equal(partial.items.find((i) => i.id === 'frame').state, 'unknown'); assert.equal(partial.passed, true, 'unknown does not fail a game');
  assert.equal(evaluate(m, { ...defaultBudgets(), frame: null }).items.find((i) => i.id === 'frame').state, 'off');
  assert.equal(evaluate({ ...m, frameMs: 2, slowdown: 1 }, { ...defaultBudgets(), frame: 2 }).items.find((i) => i.id === 'frame').state, 'ok', 'exactly the limit is allowed');
  for (const b of BUDGETS) assert.ok(b.help.length > 20 && b.label && b.limit > 0);
});

test('limits from storage or a form are cleaned: numbers above zero, null for off, anything else back to the default', () => {
  assert.deepEqual(cleanBudgets(null), defaultBudgets());
  const c = cleanBudgets({ download: 250, frame: null, files: -5, first: 'fast', memory: Infinity, extra: 9 });
  assert.equal(c.download, 250); assert.equal(c.frame, null); assert.equal(c.files, 150); assert.equal(c.first, 1500); assert.equal(c.memory, 100); assert.ok(!('extra' in c));
});

test('frame statistics and how numbers are shown to people', () => {
  const s = frameStats([1, 2, 3, 4, 100]); assert.equal(s.avg, 22); assert.equal(s.max, 100); assert.equal(s.p95, 100); assert.equal(s.samples, 5);
  assert.deepEqual(frameStats([]).samples, 0); assert.ok(Number.isNaN(frameStats([]).avg)); assert.equal(frameStats([5]).p95, 5);
  assert.equal(human(12.345, 'ms'), '12.3 ms'); assert.equal(human(340.4, 'KB'), '340 KB'); assert.equal(human(null, 'ms'), 'not measured'); assert.equal(human(NaN), 'not measured'); assert.equal(human(3, ''), '3');
});
