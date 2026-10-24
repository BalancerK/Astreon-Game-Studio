// Stage 3 of the pathway: "Enemies and feel". The student adds an enemy that patrols, makes touching it matter, and gives events some feel with sparks, a shake
// and a sound made in the sound maker. It teaches loops over things, `patrol`, the stomp rule, and that feel is a few lines in the right place.
import { allOf, matches, calls, running, afterRestart } from './checks.js';

const MAIN = 'src/main.js';
const LEVELS = 'src/levels.js';

const enemyInLegend = matches(MAIN, /'E'\s*:\s*\{[^}]*kind\s*:\s*'enemy'/, "Add a legend line for 'E' with kind: 'enemy'.");
const enemyInLevel = (ctx) => (/E/.test((ctx.files[LEVELS] ?? '').split('\n').filter((l) => /^\s*'[#.@o^E]+',?$/.test(l)).join('')) ? { done: true }
  : { done: false, note: 'Put an E on the ground in src/levels.js.' });
const coinSoundMade = (ctx) => (/^ {2}"coin":\s*\{/m.test(ctx.files['src/sounds.js'] ?? '') ? { done: true }
  : { done: false, note: 'Make a sound called coin in the Sounds panel.' });

/** @type {import('./session.js').Stage} */
export const STAGE_3 = {
  id: 'feel',
  title: 'Enemies and feel',
  intro: 'Your level has nothing that fights back. You will add an enemy that patrols, make touching it matter, and give every event some feel: sparks, a shake and a sound.',
  done: 'The game fights back and feels alive. Sparks, shakes and sounds are the same few lines in every game; the difference is where you put them. '
    + 'Next you will turn it into a whole game with a title screen, two levels and a best score that is remembered.',
  missions: [
    {
      id: 'enemy',
      title: 'Add an enemy that patrols',
      watch: [MAIN, LEVELS],
      focus: { file: MAIN, pattern: 'export function update' },
      task: [
        'Make an enemy. In `main.js`, add a line to the legend: `\'E\': { kind: \'enemy\', color: \'#ff5d5d\', w: 24, h: 24 },`. In `src/levels.js`, put an **E** on the ground, a few tiles from the start.',
        'Then, in `update`, make every enemy walk back and forth: `for (const enemy of all(game, \'enemy\')) patrol(game, enemy, dt);` Add `patrol` to the import list. Press the **Run** button above the game to start over.',
      ],
      check: afterRestart(allOf(enemyInLegend, enemyInLevel, calls(MAIN, 'patrol', "In update, call patrol(game, enemy, dt) for each enemy."), running)),
      hints: [
        'Three small steps: the legend line, the letter in the level, and the loop in update.',
        'The loop is: `for (const enemy of all(game, \'enemy\')) {` then `patrol(game, enemy, dt);` then `}`. `all` is already imported.',
        'If the editor says patrol is not defined, type `patr` and press Enter on the suggestion: it adds the import.',
      ],
      answer: "Legend (in create):\n\n'E': { kind: 'enemy', color: '#ff5d5d', w: 24, h: 24 },\n\nIn update:\n\nfor (const enemy of all(game, 'enemy')) {\n  patrol(game, enemy, dt);\n}\n\nand put an E on the ground in levels.js.",
      why: 'all(game, "enemy") gives every enemy in a list, and a for loop does the same thing to each. patrol walks an enemy along the ground and turns it round at a wall or at the end of a ledge, so you did not have to write any of that.',
    },
    {
      id: 'hit',
      title: 'Touching an enemy hurts',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'export function update' },
      task: [
        'Right now the hero walks straight through the enemy. Make touching an enemy send the hero back to the start, like a spike does.',
        'In `update`, ask what the hero is touching: `const hit = touches(game, hero, \'enemy\');` and then use the answer: `if (hit) { hero.x = 32; hero.y = 256; }`.',
      ],
      check: allOf(
        matches(MAIN, /touches\(\s*game\s*,\s*hero\s*,\s*'enemy'\s*\)/, "In update, check touches(game, hero, 'enemy')."),
        matches(MAIN, /if\s*\(\s*hit\s*\)/, 'Use the answer in an if: if (hit) { ... }'),
        running,
      ),
      hints: [
        'First ask the question and keep the answer in a name: `const hit = touches(game, hero, \'enemy\');`',
        'Then put the "go back to the start" lines inside an if: `if (hit) {` ... `}`. The if runs its lines only when the hero really is touching an enemy.',
      ],
      answer: "const hit = touches(game, hero, 'enemy');\nif (hit) {\n  hero.x = 32;\n  hero.y = 256;\n}",
      why: 'touches gives back the thing the hero is touching, or nothing at all. An if runs its lines only when there is an answer. That is how a game reacts to one thing touching another.',
    },
    {
      id: 'stomp',
      title: 'Stomp or be stomped',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'if \\(hit' },
      task: [
        'Make it fair: if the hero is **falling** onto the enemy (`hero.vy > 0`), the enemy is squashed: remove it, score a point and bounce the hero up. Otherwise the hero still goes back to the start.',
        'Inside your `if (hit)`, put an `if (hero.vy > 0)` for the stomp, and an `else` for the part you already wrote. Use `despawn(game, hit)` to remove the enemy.',
      ],
      check: allOf(
        matches(MAIN, /touches\(\s*game\s*,\s*hero\s*,\s*'enemy'\s*\)/, "In update, check touches(game, hero, 'enemy')."),
        matches(MAIN, /hero\.vy\s*>\s*0/, 'Check hero.vy > 0 to tell a stomp from a bump.'),
        running,
      ),
      hints: [
        'Inside `if (hit) {`, write `if (hero.vy > 0) {` ... `} else {` ... `}`. `hero.vy` is the hero\'s speed downwards, so more than 0 means falling.',
        'The stomp part is: `despawn(game, hit); game.score++; hero.vy = -300;`',
        'The else part is what you already wrote: `hero.x = 32; hero.y = 256;`',
      ],
      answer: "const hit = touches(game, hero, 'enemy');\nif (hit) {\n  if (hero.vy > 0) {\n    despawn(game, hit);\n    game.score++;\n    hero.vy = -300;\n  } else {\n    hero.x = 32;\n    hero.y = 256;\n  }\n}",
      why: 'vy is the hero\'s speed downwards, so a positive vy means falling. Comparing it is how a game tells landing on top of something from walking into its side. The same idea makes the difference between a stomp and a hit in many famous games.',
    },
    {
      id: 'sparks',
      title: 'Throw sparks',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'despawn\\(game, coin\\)' },
      task: [
        'Feel is what makes a game satisfying. When a coin is taken, throw a handful of sparks from it: `burst(game, coin.x, coin.y);` right after `despawn(game, coin);`.',
        'The sparks need to be moved and faded every tick, so also call `effects(game, dt);` once in `update`. Add `burst` and `effects` to the import list.',
      ],
      check: allOf(calls(MAIN, 'burst', 'Call burst(game, coin.x, coin.y) where the coin is taken.'), matches(MAIN, /\beffects\(\s*game\s*,\s*dt\s*\)/, 'Call effects(game, dt) once in update.'), running),
      hints: ['burst goes next to despawn(game, coin).', 'effects(game, dt) can go anywhere in update, for example at the end.', 'Try burst(game, coin.x, coin.y, { color: \'#ffd23c\', count: 20 }) for more sparks.'],
      answer: 'Where the coin is taken:\n\nburst(game, coin.x, coin.y);\n\nOnce in update:\n\neffects(game, dt);\n\nand add burst and effects to the import.',
      why: 'The sparks are ordinary things in the same list as your coins, with a life that counts down. effects moves them and removes the ones that are done. Because they are plain data, a Time Machine recording of your game replays the same sparks every time.',
    },
    {
      id: 'shake',
      title: 'Shake the screen when hurt',
      watch: [MAIN],
      task: [
        'A hit should be felt. Wherever the hero is sent back to the start (the spikes, the enemy), also call `shake(game, 8);`. Add `shake` to the import list.',
        'The shake fades by itself, and `drawThings` already knows how to draw it. Run the game and touch a spike.',
      ],
      check: allOf(calls(MAIN, 'shake', 'Call shake(game, 8) when the hero is hurt.'), running),
      hints: ['Find the lines that set hero.x = 32 and put shake(game, 8); next to them.', 'There may be two places: the spike and the enemy. Do both if you like.'],
      answer: 'Next to hero.x = 32; hero.y = 256;\n\nshake(game, 8);\n\nand add shake to the import.',
      why: 'shake stores a number in the game that counts down; drawThings moves the whole picture a little by it. Short, small and fading is the secret: a long shake feels like a bug.',
    },
    {
      id: 'sound',
      title: 'Make it sound',
      watch: [MAIN, 'src/sounds.js'],
      task: [
        'Open the **Sounds** panel (the Art workspace shows it). Choose **New sound from… coin**, name it **coin**, and press Play. Move a slider or press **Surprise me** until you like it.',
        'Then use it: in `main.js` add `import soundList from \'./sounds.js\';` and, near the top, `sounds(soundList);`. Where a coin is taken, call `play(\'coin\');`. Add `sounds` and `play` to the import. Click the game first: a page may only make noise after you have clicked in it.',
      ],
      check: allOf(coinSoundMade, matches(MAIN, /\bsounds\(\s*\w+\s*\)/, 'Call sounds(soundList) once, near the top.'), matches(MAIN, /\bplay\(\s*['"]coin['"]/, "Call play('coin') where a coin is taken."), running),
      hints: [
        'The Sounds panel makes the file src/sounds.js. You can read it in the Files panel.',
        'In main.js: the import line, sounds(soundList); under the other constants, and play(\'coin\'); next to burst(...).',
        'No sound? Click on the game, check the Sound button above it says "Sound on", and check your volume.',
      ],
      answer: "import soundList from './sounds.js';\n\nsounds(soundList);        // once, near the top\n\nplay('coin');             // where a coin is taken\n\nand add sounds and play to the import.",
      why: 'A sound is a small recipe: layers of waves with a pitch and a fade. The game sends the recipe to the page, which makes the noise, because a game running in a worker has no speakers. That is also why the recipe can be shown as sliders and saved as text.',
    },
  ],
};
