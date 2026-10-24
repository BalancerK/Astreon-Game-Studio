// Enforces the shared-simulation rule: code that the server and client both run to produce game state
// may only use + - * / and sqrt (plus exactly specified helpers like Math.floor/round/abs/fround), never
// Math functions the language leaves implementation-defined, wall-clock time or randomness.
// Evidence: tools/determinism.js shows Node, Chrome and Firefox disagree on sin, cos, tan, pow, hypot, ...
// Opt out a line with a comment containing `determinism-ok: <reason>` (rendering-only code).
// Usage: node tools/check-shared-math.js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE = [
  'packages/core/src', 'packages/math/src', 'packages/physics/src', 'packages/ai/src', 'packages/prefab/src', 'packages/fsm/src/machine.js', 'packages/tween/src', 'packages/protocol/src', 'packages/client/src',
  'examples/arena/shared', 'examples/arena/client/predict.js', 'examples/arena/server/input-queue.js',
  'examples/arena3d/shared', 'examples/arena3d/client/predict.js', 'examples/arena3d/server/input-queue.js',
];

const BANNED = [
  [/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/, 'implementation-defined Math function'],
  [/\bMath\.random\b/, 'Math.random (not deterministic)'],
  [/\b(Date\.now|performance\.now|new Date)\b/, 'wall-clock time (use tick numbers)'],
  [/\*\*/, 'exponent operator (same as Math.pow)'],
];

function* files(path) {
  if (statSync(path).isFile()) { if (path.endsWith('.js')) yield path; return; }
  for (const name of readdirSync(path)) yield* files(join(path, name));
}

/** Blank out comments and string contents but keep line structure. */
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));

/** @returns {string[]} violations as `file:line: message` */
export function checkSharedMath(root, scope = SCOPE) {
  const problems = [];
  for (const entry of scope) {
    const path = join(root, entry);
    try { statSync(path); } catch { continue; }
    for (const file of files(path)) {
      const original = readFileSync(file, 'utf8').split('\n');
      const cleaned = blank(readFileSync(file, 'utf8')).split('\n');
      cleaned.forEach((line, i) => {
        if (original[i].includes('determinism-ok')) return;
        for (const [re, why] of BANNED) {
          if (re.test(line)) problems.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${why}: ${line.trim()}`);
        }
      });
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkSharedMath(root);
  if (problems.length > 0) {
    console.error(`Shared-math check failed (${problems.length}):\n` + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('Shared-math check passed.');
}
