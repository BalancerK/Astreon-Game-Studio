import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame, verifyRecording } from '../replay-run.js';
import { Timeline } from '../../studio/runner/timeline.js';
import { TEMPLATES } from '../../studio/app/store/templates.js';

const hero = TEMPLATES.hero.files;
const tool = fileURLToPath(new URL('../replay-run.js', import.meta.url));

/** Play the Run and jump template for a few seconds with some key presses, the way the studio would record it, and return the recording with its code. */
async function record(files = hero) {
  const { mod, cleanup } = await loadGame(files);
  try {
    const state = mod.create();
    const t = new Timeline();
    t.reset(state);
    const script = { 10: ['ArrowRight', true], 70: ['Space', true], 80: ['Space', false], 140: ['ArrowRight', false], 150: ['ArrowLeft', true], 230: ['ArrowLeft', false] };
    for (let i = 0; i < 400; i++) {
      if (script[i]) t.key(script[i][1], script[i][0]);
      t.step(state, mod.update);
    }
    return { ...t.exportReplay(), files, name: 'hero run' };
  } finally { cleanup(); }
}

test('a recording of a real game reproduces exactly when it is run again from the file', async () => {
  const rec = JSON.parse(JSON.stringify(await record()));
  const result = await verifyRecording(rec);
  assert.deepEqual({ ok: result.ok, ticks: result.ticks, divergedAt: result.divergedAt }, { ok: true, ticks: 400, divergedAt: null });
  assert.ok(result.checked >= 5, `${result.checked} checkpoints checked`);
});

test('if the code is different the recording stops matching and says where', async () => {
  const rec = JSON.parse(JSON.stringify(await record()));
  rec.files = { ...rec.files, 'src/main.js': rec.files['src/main.js'].replace('const SPEED = 160', 'const SPEED = 300') };
  const result = await verifyRecording(rec);
  assert.equal(result.ok, false); assert.ok(result.divergedAt > 0 && result.divergedAt <= 120, `diverged at ${result.divergedAt}`);
});

test('a game that uses chance or the clock cannot be reproduced, and the check says so', async () => {
  const noisy = { 'src/main.js': 'export function create() { return { n: 0 }; }\nexport function update(game) { game.n += Math.random(); }\nexport function render() {}\n' };
  const { mod, cleanup } = await loadGame(noisy);
  const state = mod.create(); const t = new Timeline(); t.reset(state);
  for (let i = 0; i < 200; i++) t.step(state, mod.update);
  const rec = JSON.parse(JSON.stringify({ ...t.exportReplay(), files: noisy })); cleanup();
  assert.equal((await verifyRecording(rec)).ok, false);
});

test('a recording without code, or a damaged one, is refused with a reason', async () => {
  const rec = JSON.parse(JSON.stringify(await record()));
  await assert.rejects(verifyRecording({ ...rec, files: undefined }), /does not include the game's code/);
  await assert.rejects(verifyRecording({ ...rec, files: { 'src/main.js': 'export const nothing = 1;' } }), /update function/);
  await assert.rejects(verifyRecording({ ...rec, format: 'x' }), /not a replay file/);
  await assert.rejects(verifyRecording({ ...rec, files: { '../evil.js': 'x', 'src/main.js': '' } }), /not allowed/);
});

test('the command line tool: 0 when it reproduces, 1 when it does not, 2 for a file it cannot use', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-cli-'));
  try {
    const rec = await record();
    const good = join(dir, 'good.replay.json'); writeFileSync(good, JSON.stringify(rec));
    const bad = join(dir, 'bad.replay.json'); writeFileSync(bad, JSON.stringify({ ...rec, files: { ...rec.files, 'src/main.js': rec.files['src/main.js'].replace('JUMP = 620', 'JUMP = 900') } }));
    const junk = join(dir, 'junk.json'); writeFileSync(junk, '{"nope":1}');
    const run = (file) => spawnSync(process.execPath, [tool, file], { encoding: 'utf8' });
    const a = run(good); assert.equal(a.status, 0, a.stdout + a.stderr); assert.match(a.stdout, /Reproduced exactly: 400 ticks/);
    const b = run(bad); assert.equal(b.status, 1, b.stdout + b.stderr); assert.match(b.stdout, /Did NOT reproduce.*tick \d+/);
    const c = run(junk); assert.equal(c.status, 2); assert.match(c.stderr, /not a replay file/);
    assert.equal(spawnSync(process.execPath, [tool], { encoding: 'utf8' }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
