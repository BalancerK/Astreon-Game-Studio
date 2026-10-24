#!/usr/bin/env node
// Run a recording from the studio's Time Machine again, in Node, and check that every checkpoint matches. A recording is a file saved with "Save a recording": the
// game's code, the state it started from, every key press and edit, and a checksum of the state every second. This is the "re-run it in CI" half of sharing a
// bug: if the game has changed (or uses Math.random, or the clock) the checksums stop matching and this says at which tick.
//
//   node tools/replay-run.js my-bug.replay.json        exit code 0 if the recording reproduces exactly, 1 if not, 2 if the file is unusable
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkReplay, verifyReplay } from '../studio/runner/timeline.js';
import { resolveImports } from '../studio/runner/resolve-imports.js';
import { withSceneModules } from '../studio/export/scene-modules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = pathToFileURL(join(root, 'packages')).href;

/**
 * Put a project's files in a temporary folder (engine imports pointed at this repository's packages) and load its main module.
 * @param {Record<string, string>} files
 * @returns {Promise<{mod: any, cleanup: () => void}>}
 */
export async function loadGame(files) {
  const dir = mkdtempSync(join(tmpdir(), 'replay-'));
  writeFileSync(join(dir, 'package.json'), '{"type": "module"}');
  for (const [path, text] of Object.entries(withSceneModules(files))) {                  // a scene file gets its module, as in the studio
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, resolveImports(text, packages));
  }
  const mod = await import(pathToFileURL(join(dir, 'src/main.js')).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Check a recording that includes the game's code.
 * @param {unknown} data the parsed file
 * @returns {Promise<{ok: boolean, ticks: number, divergedAt: number | null, checked: number}>}
 */
export async function verifyRecording(data) {
  const replay = checkReplay(data);
  if (!replay.files?.['src/main.js']) throw new Error('This recording does not include the game\'s code (src/main.js).');
  const { mod, cleanup } = await loadGame(replay.files);
  try {
    if (typeof mod.update !== 'function') throw new Error('src/main.js must export an update function.');
    return verifyReplay(replay, mod.update);
  } finally {
    cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node tools/replay-run.js recording.replay.json'); process.exit(2); }
  try {
    const result = await verifyRecording(JSON.parse(readFileSync(file, 'utf8')));
    if (result.ok) console.log(`Reproduced exactly: ${result.ticks} ticks, ${result.checked} checkpoints match.`);
    else console.log(`Did NOT reproduce: the state differs from the recording at tick ${result.divergedAt} (after ${result.checked} matching checkpoints).`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exit(2);
  }
}
