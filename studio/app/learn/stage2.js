// Stage 2 of the pathway: "A real level". The student turns the one-screen game into a scrolling level with spikes, a goal and a win message. It teaches
// importing from another file, the camera, `touches`, and checking whether the game is won. Same shape as stage 1: checks, three hints, the answer last.
import { allOf, matches, levelIsValid, summaryIs, functionBody, running, afterRestart } from './checks.js';

const MAIN = 'src/main.js';
const LEVELS = 'src/levels.js';

const BIG_ROWS = [
  '################################################',
  '#..............................................#',
  '#..............................................#',
  '#......................................o.......#',
  '#.....................o..............#####.....#',
  '#...............o.............o......#####.....#',
  '#........o....#####...........o....####........#',
  '#.......####...........#####...................#',
  '#@...o.............o.....o......o.........o....#',
  '################################################',
];

/** The text of `src/levels.js` that the studio adds in the "bigger world" mission. */
export const LEVELS_FILE = `// Levels are pictures made of letters:  # ground   o coin   @ where the hero starts   . empty air
// Every row must be the same length.
export const BIG_LEVEL = [
${BIG_ROWS.map((r) => `  '${r}',`).join('\n')}
];
`;

const usesBigLevel = matches(MAIN, /from\s*['"]\.\/levels\.js['"]/, 'Import it at the top: import { BIG_LEVEL } from \'./levels.js\';');

const hasSpikes = (ctx) => (/'\^'\s*:\s*\{[^}]*kind\s*:\s*'spike'/.test(ctx.files[MAIN] ?? '')
  ? { done: true } : { done: false, note: "Add a legend line for '^' with kind: 'spike'." });
const levelHasSpikes = (ctx) => (((ctx.files[LEVELS] ?? '').match(/\^/g) ?? []).length >= 2
  ? { done: true } : { done: false, note: 'Put at least two ^ in the level, on the ground.' });

const winMessage = (ctx) => {
  const body = functionBody(ctx.files[MAIN], 'render');
  return /win/i.test(body) && /coin/.test(body) ? { done: true } : { done: false, note: 'Draw a message in render when there are no coins left.' };
};

/** @type {import('./session.js').Stage} */
export const STAGE_2 = {
  id: 'level',
  title: 'A real level',
  intro: 'Your game fits on one screen. Now you will make a level that scrolls, add spikes that send the hero back, and show a message when every coin is collected.',
  done: 'You built a scrolling level, danger and a goal. That is a complete little game. Next it gets enemies that fight back, and the feel that makes a game satisfying.',
  missions: [
    {
      id: 'bigger',
      title: 'Load a bigger world',
      watch: [MAIN, LEVELS],
      prepare: 'add-levels-file',
      focus: { file: MAIN, pattern: 'loadMap' },
      task: [
        'The studio just added a new file, `src/levels.js`, with a much bigger level in it (it is in the Files list; you can open it to look, but do not change it). Games are made of several files that share things with `import` and `export`.',
        'In `src/main.js`, add `import { BIG_LEVEL } from \'./levels.js\';` at the top, and give `loadMap` **BIG_LEVEL** instead of LEVEL. Press the **Run** button above the game to start the game again: the hero will run off the screen, and that is the next mission.',
      ],
      check: afterRestart(allOf(
        usesBigLevel,
        matches(MAIN, /loadMap\(\s*game\s*,\s*BIG_LEVEL/, 'Give loadMap BIG_LEVEL: loadMap(game, BIG_LEVEL, ...)'),
        levelIsValid(LEVELS, { name: 'BIG_LEVEL', columns: 40 }),
        running,
      )),
      hints: [
        'Open `src/main.js`. The first line is an import; add another import line under it.',
        'The new line is: `import { BIG_LEVEL } from \'./levels.js\';`',
        'In `create`, change `loadMap(game, LEVEL, {` to `loadMap(game, BIG_LEVEL, {`.',
      ],
      answer: "At the top of main.js add:\n\nimport { BIG_LEVEL } from './levels.js';\n\nand in create change LEVEL to BIG_LEVEL:\n\nloadMap(game, BIG_LEVEL, {",
      why: 'export makes a name available to other files and import brings it in. The file name starts with ./ because it is next to this file. Splitting a game into files keeps each one short.',
      deeper: { label: 'Files and imports', href: 'guide/start-here.html' },
    },
    {
      id: 'camera',
      title: 'Make the camera follow the hero',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'loadMap\\(' },
      task: [
        'The screen only shows 480 pixels but the level is much wider. A **camera** decides which part you see.',
        'Keep the size of the level by writing `game.map = ` in front of `loadMap(...)`. Then, at the end of `update`, call **follow(game, hero, game.map)**. Add `follow` to the import list at the top.',
        'The map is made when the game starts, so press the **Run** button above the game afterwards to start over. If you see an error before that, it is only the game asking for the map: Run fixes it.',
      ],
      check: afterRestart(allOf(
        matches(MAIN, /game\.map\s*=\s*loadMap\(/, 'Write game.map = in front of loadMap(...)'),
        matches(MAIN, /\bfollow\(\s*game\s*,\s*hero\s*,\s*game\.map\s*\)/, 'Call follow(game, hero, game.map) in update.'),
      )),
      hints: [
        'In `create`, the line should start `game.map = loadMap(game, BIG_LEVEL, {`.',
        'At the end of `update`, after the coin code, add `follow(game, hero, game.map);`',
        'If the editor says follow is not defined, type `fol` and press Enter on the suggestion: it adds the import for you.',
      ],
      answer: 'In create:\n\ngame.map = loadMap(game, BIG_LEVEL, {\n\nAt the end of update:\n\nfollow(game, hero, game.map);\n\nand add follow to the import at the top.',
      why: 'follow moves the camera to keep the hero in the middle, and stops it at the edges of the level. drawThings then draws everything shifted by the camera, so you did not have to change how anything is drawn.',
    },
    {
      id: 'spikes',
      title: 'Add spikes',
      watch: [MAIN, LEVELS],
      focus: { file: MAIN, pattern: 'export function update' },
      task: [
        'Make danger. In `src/levels.js` put a few **^** on the ground (replace dots on the row just above the bottom). In `main.js` add a line to the legend: `\'^\': { kind: \'spike\', color: \'#ff5d5d\' },`.',
        'Then, in `update`, send the hero back to the start when it touches a spike: `if (touches(game, hero, \'spike\')) { hero.x = 32; hero.y = 256; }` Press the **Run** button above the game to see the spikes.',
      ],
      check: afterRestart(allOf(
        hasSpikes,
        levelHasSpikes,
        matches(MAIN, /touches\(\s*game\s*,\s*hero\s*,\s*'spike'\s*\)/, "In update, check touches(game, hero, 'spike')."),
        running,
      )),
      hints: [
        'Three small steps: the letters in the level, the legend line, and the check in update.',
        'In the level, change two or three dots on the row above the floor to ^. In the legend add `\'^\': { kind: \'spike\', color: \'#ff5d5d\' },` next to the other letters.',
        "In update, after the coin code: `if (touches(game, hero, 'spike')) { hero.x = 32; hero.y = 256; }`",
      ],
      answer: "Legend (in create):\n\n'^': { kind: 'spike', color: '#ff5d5d' },\n\nIn update:\n\nif (touches(game, hero, 'spike')) {\n  hero.x = 32;\n  hero.y = 256;\n}\n\nAnd put a few ^ on the row above the floor in levels.js.",
      why: 'touches(game, hero, "spike") finds a spike that overlaps the hero, or nothing. Putting the hero back at the start position is the simplest way to make something dangerous. Later you can take a life away instead.',
    },
    {
      id: 'collect',
      title: 'Collect every coin',
      watch: [MAIN],
      task: [
        'Play the level and collect **all** the coins. The status bar under the game shows how many are left (`coinsLeft`). Watch out for spikes!',
        'This one is a game, not code. When the last coin is gone, the step is done.',
      ],
      check: summaryIs('coinsLeft', (n) => n === 0),
      hints: ['Some coins are on high platforms: jump from one to the next.', 'If you cannot reach one, make JUMP bigger or ask the hero to be faster.'],
      answer: 'Collect them all. If a coin is out of reach, increase JUMP or SPEED at the top of main.js and try again.',
      why: 'The game keeps coins as things in a list. When the hero touches one it is removed with despawn, so the number left goes down. A game is won when the list is empty.',
    },
    {
      id: 'win',
      title: 'Say "You win!"',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'export function render' },
      task: [
        'A game should tell you when you have won. In `render`, if there are no coins left, write a message in the middle of the screen.',
        'Use **all(game, \'coin\').length === 0** to ask, and **label(g, \'You win!\', 240, 160, { size: 32, align: \'center\' })** to write. (`all` is already in the import at the top, so there is nothing to add there.)',
      ],
      check: allOf(winMessage, running),
      hints: [
        "Inside `render`, add an `if` that checks `all(game, 'coin').length === 0`.",
        "Inside the if, call `label(g, 'You win!', 240, 160, { size: 32, align: 'center' });`",
        'The editor can add imports: type `all` and press Enter on the suggestion from @engine/arcade.',
      ],
      answer: "In render, after drawThings:\n\nif (all(game, 'coin').length === 0) {\n  label(g, 'You win!', 240, 160, { size: 32, align: 'center' });\n}",
      why: 'render only draws; it must not change the game. Asking how many coins are left is safe there, because it only reads. Deciding what to show from the state of the game is the heart of every game screen.',
    },
  ],
};
