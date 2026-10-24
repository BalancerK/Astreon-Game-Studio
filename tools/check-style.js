// A small style gate for the code people read first: the tutorial games, the starter templates and the studio must stay readable.
// A line of code may be at most 150 characters (long lines usually mean several statements crammed together); a line that is only a comment may run
// to 200, because prose reads better unbroken.
// Run: node tools/check-style.js   (npm test runs it)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINE = 150;
export const MAX_COMMENT = 200;
/** Files made of prose (a lesson's text in strings) or of tables (a sound or a song to a line): a line is a sentence or an item there, so it may run longer. */
const PROSE = /studio[\\/]app[\\/](learn[\\/]stage\d+\.js|panels[\\/](ship|netlab)-panel\.js|pack[\\/](sounds|songs)\.js)$/;
export const MAX_PROSE = 560;
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Folders whose JavaScript must stay readable (tests are left out: a table of cases may run long). */
const WATCHED = [
  'examples/platformer/src', 'examples/shooter/src', 'examples/crazy-eights/src', 'examples/crazy-eights/server',
  'packages/create-game/templates/2d/files/src', 'packages/create-game/templates/3d/files/src',
  'packages/create-game/templates/multiplayer/files/src', 'packages/create-game/templates/multiplayer/files/server',
  'studio/app', 'studio/runner',
];

const walk = (dir) => (existsSync(dir)
  ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
  : []);

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** Every line over the limit in the watched folders, as `file:line (length)`. */
export function longLines(base = root) {
  const found = [];
  for (const folder of WATCHED) {
    for (const file of walk(join(base, folder)).filter((f) => f.endsWith('.js') && !/[\\/]data[\\/]/.test(f))) {   // data/ is generated
      readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
        const line = raw.replace(/\r$/, '');
        const limit = isComment(line) ? MAX_COMMENT : PROSE.test(file) ? MAX_PROSE : MAX_LINE;
        if (line.length > limit) found.push(`${relative(base, file).replace(/\\/g, '/')}:${i + 1} (${line.length})`);
      });
    }
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bad = longLines();
  if (bad.length) {
    const more = bad.length > 30 ? `\n  ... and ${bad.length - 30} more` : '';
    console.error(`Lines too long (code over ${MAX_LINE}, comments over ${MAX_COMMENT}; break them up, one statement per line):\n  ${bad.slice(0, 30).join('\n  ')}${more}`);
    process.exit(1);
  }
  console.log(`Style check passed (no code line over ${MAX_LINE} characters in the tutorial games, templates and studio).`);
}
