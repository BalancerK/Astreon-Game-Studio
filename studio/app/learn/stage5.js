// Stage 5 of the pathway: "Make it yours". The three painters, and one rule changed on purpose. By now the student has the whole loop (write, run, look, fix), so
// these missions give less and ask for more: they say what to make, not what to type.
import { allOf, running, levelsChangedBy, fileChanged, soundNames, paintedPixels } from './checks.js';

const MAIN = 'src/main.js';

const artFiles = (ctx) => Object.keys(ctx.files).filter((p) => /^src\/art\/[\w-]+\.js$/.test(p));

const ownSprite = (ctx) => {
  const painted = artFiles(ctx).filter((p) => paintedPixels(ctx.files[p]) >= 8);
  if (!painted.length) return { done: false, note: 'Paint a sprite in the Sprites panel: at least a few pixels.' };
  const used = [...(ctx.files[MAIN] ?? '').matchAll(/sprite\s*:\s*'([\w-]+)'/g)].map((m) => m[1]);
  if (!used.some((name) => painted.includes(`src/art/${name}.js`))) return { done: false, note: "Use it: give a thing sprite: 'yourname' in the legend." };
  return /drawThings\(\s*g\s*,\s*game\s*,\s*\w+\s*\)/.test(ctx.files[MAIN]) ? { done: true } : { done: false, note: 'Draw with the art: drawThings(g, game, art).' };
};

const ownSound = (ctx) => {
  const names = soundNames(ctx.files['src/sounds.js']);
  const played = [...(ctx.files[MAIN] ?? '').matchAll(/\bplay\(\s*['"]([\w-]+)['"]/g)].map((m) => m[1]);
  if (names.length < 2) return { done: false, note: 'Make a second sound in the Sounds panel.' };
  return played.some((n) => n !== 'coin' && names.includes(n)) ? { done: true } : { done: false, note: "Play it with play('its name') somewhere in update." };
};

/** @type {import('./session.js').Stage} */
export const STAGE_5 = {
  id: 'mine',
  title: 'Make it yours',
  intro: 'The game works. Now it should look, sound and play like something you made. You will paint a hero, change the levels, make a sound of your own and change one rule.',
  done: 'You made a game, and it is yours: your pictures, your levels, your sounds, your rules. You know how a game is built, so you can read any other. '
    + 'Export it as a zip to keep it or send it to a friend. There is more to learn (multiplayer, publishing, 3D), and the studio and the documentation are there when you want it.',
  missions: [
    {
      id: 'hero',
      title: 'Paint your hero',
      watch: [MAIN],
      task: [
        'Open the **Sprites** panel and draw a hero of your own: 16 by 16 is a good size. Name the sprite **hero**. Make a second frame and a `run` animation if you like.',
        'Then use it. In `main.js`: `import hero from \'./art/hero.js\';`, `const art = { hero };`, give the `\'@\'` legend line `sprite: \'hero\'`, and draw with `drawThings(g, game, art)`. Press **Run**.',
      ],
      check: allOf(ownSprite, running),
      hints: [
        'The painter shows how to import your sprite under "How do I use this in my game?".',
        'In the legend: `\'@\': { kind: \'hero\', w: 24, h: 30, sprite: \'hero\' },`.',
        'The picture is stretched to the thing\'s size, so a 16 by 16 sprite on a 24 by 30 hero will look tall. Change w and h to suit.',
      ],
      answer: "import hero from './art/hero.js';\nconst art = { hero };\n\nLegend: '@': { kind: 'hero', w: 32, h: 32, sprite: 'hero' },\n\nIn render: drawThings(g, game, art);",
      why: 'A sprite is a small file of letters and colours, so it is code like everything else: you can read it, edit it, keep it in a project and share it. The painter is just a nicer way to write that file.',
    },
    {
      id: 'levels',
      title: 'Paint your own levels',
      watch: ['src/levels.js', 'src/level2.js'],
      task: [
        'Open the **Level** panel. Choose a level and change it: add platforms, move coins, put enemies and spikes where they will hurt most. Change at least 15 tiles.',
        'Play it. If it is too hard, make it easier; if you can finish it in ten seconds, make it harder. This is what level designers do all day.',
      ],
      check: levelsChangedBy([{ file: 'src/levels.js', name: 'BIG_LEVEL' }, { file: 'src/level2.js', name: 'LEVEL_TWO' }], 15),
      hints: ['Pick a tile on the left, then click or drag on the grid. Fill fills a whole area.', 'Ctrl+Z undoes. Everything you paint is saved in the code as you go.'],
      answer: 'Open the Level panel, choose BIG_LEVEL or LEVEL_TWO, and paint at least 15 tiles. There is no single right answer.',
      why: 'The painter changes the same list of rows that is in your code. Nothing is hidden: you can edit the letters by hand or paint them, and the game cannot tell the difference.',
    },
    {
      id: 'mysound',
      title: 'Make a sound of your own',
      watch: ['src/sounds.js', MAIN],
      task: [
        'Make a second sound in the **Sounds** panel: a jump, a hit, a laser, whatever the game needs. Give it a name you will remember.',
        'Play it from the code, for example when the hero jumps: `if (jump(hero, keys, JUMP)) play(\'jump\');` (`jump` tells you whether the hero jumped).',
      ],
      check: allOf(ownSound, running),
      hints: ['Start from a preset (jump, hit, laser) and change it until it is yours.', '`jump(hero, keys, JUMP)` is already in update: wrap it in an if, as in the task.'],
      answer: "In the Sounds panel make a sound called jump.\n\nIn update, change the jump line to:\nif (jump(hero, keys, JUMP)) play('jump');",
      why: 'jump returns true on the tick the hero leaves the ground, so you can play a sound exactly then. Many functions in the kit tell you whether something happened for exactly this reason.',
    },
    {
      id: 'rule',
      title: 'Change a rule',
      watch: [MAIN],
      task: [
        'Change one thing about how the game plays, something you can feel when you play it. A few ideas: coins worth 5 points, enemies twice as fast, a double jump, a time limit, three lives, a bigger bounce when you stomp.',
        'There is no single answer. Make one change, run the game, and see if it is better. If it is not, go back (the History panel and Ctrl+Z are there) and try another.',
      ],
      check: allOf(fileChanged(MAIN, 5), running),
      hints: ['Small changes first: a number in `patrol(game, enemy, dt, 120)` makes enemies faster.', 'For lives: `game.lives = 3;` in create, `game.lives--` when hurt, and a message when it reaches 0.'],
      answer: 'For example, make enemies faster:\n\npatrol(game, enemy, dt, 120);\n\nor make a coin worth five points:\n\ngame.score += 5;',
      why: 'The rules of a game are the code in update, and a rule is just a line you can change. Game design is changing a rule, playing, and feeling whether it is better, again and again.',
    },
  ],
};
