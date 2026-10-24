// Stage 4 of the pathway: "A whole game". A title screen, two levels in order, and a best score that is remembered. It teaches keeping which part of the game you
// are in as plain state, loading levels from a list, and saved progress.
import { allOf, matches, calls, running, afterRestart } from './checks.js';

const MAIN = 'src/main.js';

const LEVEL_TWO_ROWS = [
  '################################################',
  '#..............................................#',
  '#........................................o.....#',
  '#..................o................o...#####..#',
  '#............o....####........o....###.........#',
  '#......o....####.........o...####..............#',
  '#.....####..............###..................o.#',
  '#...........................................####',
  '#@..o.....E...^^o....E....o....E..o...^.....o..#',
  '################################################',
];

/** The text of `src/level2.js` that the studio adds in the "second level" mission. */
export const LEVEL_TWO_FILE = `// A second level. The same letters as the first: # ground  o coin  @ start  ^ spikes  E enemy  . empty air
export const LEVEL_TWO = [
${LEVEL_TWO_ROWS.map((r) => `  '${r}',`).join('\n')}
];
`;

/** @type {import('./session.js').Stage} */
export const STAGE_4 = {
  id: 'whole',
  title: 'A whole game',
  intro: 'A game is more than a level: it has a title, more than one level, and it remembers you. You will add a title screen, a second level and a best score that is saved.',
  done: 'You have a whole game: a title, two levels that follow each other, danger, sound and a best score that is still there tomorrow. '
    + 'The last stage is about making it yours: your own pictures, levels and sounds.',
  missions: [
    {
      id: 'title',
      title: 'A title screen',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'export function create' },
      task: [
        'Keep which part of the game you are in as plain data. In `create`, after the level is loaded, add `game.scene = \'title\';`.',
        'At the very top of `update`: `if (game.scene === \'title\') { if (held(keys, \'space\')) game.scene = \'play\'; return; }`. In `render`, when `game.scene === \'title\'`, write **Press Space** in the middle with `label`. Add `held` to the import, then press **Run**.',
      ],
      check: allOf(
        matches(MAIN, /game\.scene\s*=\s*'title'/, "In create, write game.scene = 'title';"),
        matches(MAIN, /game\.scene\s*=\s*'play'/, "In update, switch to game.scene = 'play' when space is pressed."),
        matches(MAIN, /\bheld\(\s*keys/, 'Use held(keys, \'space\') to see the space key.'),
        running,
      ),
      hints: [
        'Three places: create sets the scene, update changes it, render shows the title.',
        'At the top of update: `if (game.scene === \'title\') {` then `if (held(keys, \'space\')) game.scene = \'play\';` then `return;` then `}`.',
        'In render, after drawThings: `if (game.scene === \'title\') label(g, \'Press Space\', 240, 160, { size: 28, align: \'center\' });`',
      ],
      answer: "In create:  game.scene = 'title';\n\nTop of update:\nif (game.scene === 'title') {\n  if (held(keys, 'space')) game.scene = 'play';\n  return;\n}\n\nIn render:\nif (game.scene === 'title') label(g, 'Press Space', 240, 160, { size: 28, align: 'center' });",
      why: 'A scene is just a word kept in the game state. update and render look at it and do different things. A title, a pause screen and a game over screen are all the same trick.',
    },
    {
      id: 'levellist',
      title: 'Keep the levels in a list',
      watch: [MAIN],
      prepare: 'add-level-two',
      focus: { file: MAIN, pattern: 'loadMap' },
      task: [
        'The studio added `src/level2.js` with a second level, `LEVEL_TWO` (it is in the Files list; leave it as it is). To move from one level to the next, the game needs its levels in a list it can pick from by number.',
        'Under your `import { BIG_LEVEL }` line add `import { LEVEL_TWO } from \'./level2.js\';`, and under the imports add `const LEVELS = [BIG_LEVEL, LEVEL_TWO];`. Then in `create`, give `loadMap` **LEVELS[0]** instead of BIG_LEVEL. The game looks exactly the same, and that is the point: nothing broke.',
      ],
      check: allOf(
        matches(MAIN, /from\s*['"]\.\/level2\.js['"]/, "Import it: import { LEVEL_TWO } from './level2.js';"),
        matches(MAIN, /const\s+LEVELS\s*=\s*\[/, 'Make the list: const LEVELS = [BIG_LEVEL, LEVEL_TWO];'),
        matches(MAIN, /loadMap\(\s*game\s*,\s*LEVELS\s*\[\s*0\s*\]/, 'Load the first level from the list: loadMap(game, LEVELS[0], ...)'),
        running,
      ),
      hints: [
        'Step 1: add `import { LEVEL_TWO } from \'./level2.js\';` right under the import of BIG_LEVEL.',
        'Step 2: under all the imports write `const LEVELS = [BIG_LEVEL, LEVEL_TWO];`',
        'Step 3: in `create`, change `loadMap(game, BIG_LEVEL, {` to `loadMap(game, LEVELS[0], {`. The number in the square brackets says which level of the list: 0 is the first.',
      ],
      answer: "import { LEVEL_TWO } from './level2.js';\n\nconst LEVELS = [BIG_LEVEL, LEVEL_TWO];\n\nIn create:\nloadMap(game, LEVELS[0], {",
      why: 'A list keeps things in order, and a number picks one of them (counting from 0). Putting the levels in a list is the first step to a game that has as many levels as you like.',
    },
    {
      id: 'startlevel',
      title: 'A function that starts a level',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'export function create' },
      task: [
        'A **function** is a named set of instructions you can use again. Write one called `startLevel(game, number)` that empties the game with `clearThings(game)`, remembers which level you are on with `game.levelIndex = number`, and loads `LEVELS[number]`.',
        'The legend (what each letter makes) must move out of `loadMap` into its own constant, `const LEGEND = { ... };`, so the function can use it. In `create`, replace the whole `loadMap` call with `startLevel(game, 0);`. Add `clearThings` to the import list. Press the **Run** button above the game: it looks the same.',
      ],
      check: afterRestart(allOf(
        calls(MAIN, 'clearThings', 'Start a level with clearThings(game).'),
        matches(MAIN, /levelIndex/, 'Remember which level you are on in game.levelIndex.'),
        matches(MAIN, /function\s+startLevel\s*\(/, 'Write the function: function startLevel(game, number) { ... }'),
        matches(MAIN, /loadMap\(\s*game\s*,\s*LEVELS\s*\[\s*number\s*\]/, 'Inside it, load LEVELS[number].'),
        matches(MAIN, /startLevel\(\s*game\s*,\s*0\s*\)/, 'Call it from create: startLevel(game, 0);'),
        running,
      )),
      hints: [
        'Step 1, the legend: cut everything between the braces after `loadMap(game, LEVELS[0],` in `create` and keep it as `const LEGEND = { ... };` above `create`. Add `clearThings` to the import list.',
        'Step 2, the function, above `create`: `function startLevel(game, number) { clearThings(game); game.levelIndex = number; game.map = loadMap(game, LEVELS[number], LEGEND); }`',
        'Step 3: in `create`, delete the old `game.map = loadMap(...)` and write `startLevel(game, 0);` in its place.',
      ],
      answer: "const LEGEND = { ...everything that was between the braces of your loadMap call... };\n\nfunction startLevel(game, number) {\n  clearThings(game);\n  game.levelIndex = number;\n  game.map = loadMap(game, LEVELS[number], LEGEND);\n}\n\nIn create:\nstartLevel(game, 0);\n\nAdd clearThings to the import list.",
      why: 'A function packs several steps under one name, so starting a level is one short line wherever you need it. Keeping the level number in the game state means a recording of your game, or a saved game, knows which level it was on.',
    },
    {
      id: 'second',
      title: 'On to the second level',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'export function update' },
      task: [
        'Now the payoff: when every coin is taken, go to the next level. In `update`, if there are no coins left and there is another level, call `startLevel(game, game.levelIndex + 1);`.',
        'Ask with `all(game, \'coin\').length === 0`, and check there is a next level with `game.levelIndex < LEVELS.length - 1`, so the game does not run off the end of the list.',
      ],
      check: allOf(
        matches(MAIN, /startLevel\(\s*game\s*,\s*game\.levelIndex\s*\+\s*1/, 'Go on with startLevel(game, game.levelIndex + 1).'),
        matches(MAIN, /LEVELS\.length/, 'Check there is a next level: game.levelIndex < LEVELS.length - 1.'),
        running,
      ),
      hints: [
        'Put it in `update`, near the top. It is one `if` with two questions joined by `&&`.',
        'The questions are `all(game, \'coin\').length === 0` and `game.levelIndex < LEVELS.length - 1`.',
        'If both are true, `startLevel(game, game.levelIndex + 1);`',
      ],
      answer: "In update:\nif (all(game, 'coin').length === 0 && game.levelIndex < LEVELS.length - 1) {\n  startLevel(game, game.levelIndex + 1);\n}",
      why: 'The same function that started level 0 starts level 1: that is why you wrote it as a function. A game with ten levels needs no new code, only a longer list.',
    },
    {
      id: 'best',
      title: 'Remember the best score',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'export function create' },
      task: [
        'Make the game remember your best score between visits. In `create`, read what was saved: `game.best = loadProgress().best ?? 0;`.',
        'When the score beats it, save it: `if (game.score > game.best) { game.best = game.score; saveProgress({ best: game.best }); }` (a good place is where the hero collects a coin). Show it with `label(g, \'Best \' + game.best, 12, 44);`. Add `loadProgress` and `saveProgress` to the import, then press **Run**.',
      ],
      check: allOf(calls(MAIN, 'loadProgress', 'Read the saved best score with loadProgress().'),
        calls(MAIN, 'saveProgress', 'Save it with saveProgress({ best: ... }).'), running),
      hints: [
        'loadProgress() gives back an object; `.best ?? 0` means "use 0 if nothing was saved yet".',
        'saveProgress takes a plain object: `saveProgress({ best: game.best })`.',
        'Close the game page, open the studio again, and press Run: the best score is still there. The studio keeps it for this project.',
      ],
      answer: "In create:\ngame.best = loadProgress().best ?? 0;\n\nWhere a coin is taken:\nif (game.score > game.best) {\n  game.best = game.score;\n  saveProgress({ best: game.best });\n}\n\nIn render:\nlabel(g, 'Best ' + game.best, 12, 44);",
      why: 'A game cannot touch storage itself, because it runs in a worker. loadProgress and saveProgress hand a small piece of plain data to the studio, which keeps it for this project. A game you publish later keeps it the same way, in the player\'s browser.',
    },
  ],
};
