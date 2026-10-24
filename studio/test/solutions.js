// Reference solutions for the pathway: what a student who follows every mission would do to the project, as plain text edits. The pathway test applies them in
// order and checks that each one completes its mission (and that no mission is complete before it is done).
import { newSprite, paintPoints, serializeSprite } from '../app/paint/sprite-model.js';
import { PRESETS, serializeSounds } from '../app/paint/sound-model.js';
import { newRule, generateModule, addToGame } from '../app/rules/rules-model.js';

const MAIN = 'src/main.js';
const LEVELS = 'src/levels.js';
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`reference solution: "${from.slice(0, 50)}" is not in the file`);
  return text.replace(from, to);
};
const edit = (f, file, pairs) => ({ ...f, [file]: pairs.reduce((t, [a, b]) => swap(t, a, b), f[file]) });

const ruled = (f, rules) => ({ files: { ...f, 'src/rules.js': generateModule(rules), [MAIN]: addToGame(f[MAIN]).text } });

const RESTARTED = new Set(['coin', 'paint', 'bigger', 'camera', 'spikes', 'enemy', 'startlevel']);

export const solutions = {
  play: (f) => ({ files: f, summary: { x: 300 } }),
  speed: (f, m) => ({ files: { ...f, ...m.apply(f) } }),
  jump: (f, m) => ({ files: { ...f, ...m.apply(f) } }),
  coin: (f) => ({ files: { ...f, [MAIN]: f[MAIN].replace("'#...o.....o...#'", "'#...o...o.o...#'") } }),
  paint: (f) => ({ files: { ...f, [MAIN]: f[MAIN].replace("w: 24, h: 30 }", "w: 24, h: 30, color: '#ff6b6b' }") } }),
  save: (f) => ({ files: f, events: new Set(['restore-point']) }),
  bigger: (f) => ({
    files: { ...f, [MAIN]: `import { BIG_LEVEL } from './levels.js';\n${f[MAIN].replace('loadMap(game, LEVEL,', 'loadMap(game, BIG_LEVEL,')}` },
  }),
  camera: (f) => ({
    files: { ...f, [MAIN]: f[MAIN].replace('loadMap(game, BIG_LEVEL,', 'game.map = loadMap(game, BIG_LEVEL,').replace('walk, jump,', 'follow, walk, jump,').replace('  const coin = touches', '  follow(game, hero, game.map);\n  const coin = touches') },
  }),
  spikes: (f) => ({
    files: {
      ...f,
      [MAIN]: f[MAIN].replace("o: { kind: 'coin'",
        "'^': { kind: 'spike', color: '#ff5d5d' },\n    o: { kind: 'coin'").replace('  const coin = touches',
        "  if (touches(game, hero, 'spike')) { hero.x = 32; hero.y = 256; }\n  const coin = touches"),
      'src/levels.js': f['src/levels.js'].replace("'#@...o.............o.", "'#@...o...^^........o."),
    },
  }),
  collect: (f) => ({ files: f, summary: { coinsLeft: 0 } }),
  win: (f) => ({ files: { ...f, [MAIN]: f[MAIN].replace("label(g, 'Coins '", "if (all(game, 'coin').length === 0) label(g, 'You win!', 240, 160, { size: 32, align: 'center' });\n  label(g, 'Coins '") } }),

  // ---- stage 3
  enemy: (f) => ({
    files: edit(edit(f, MAIN, [
      ["    o: { kind: 'coin'", "    'E': { kind: 'enemy', color: '#ff5d5d', w: 24, h: 24 },\n    o: { kind: 'coin'"],
      ['newGame, loadMap, first, all,', 'newGame, loadMap, first, all, patrol,'],
      ['  const coin = touches', "  for (const enemy of all(game, 'enemy')) patrol(game, enemy, dt);\n  const coin = touches"],
    ]), LEVELS, [["'#@...o...^^........o.", "'#@..Eo...^^........o."]]),
  }),
  hit: (f) => ({
    files: edit(f, MAIN, [[
      '  const coin = touches',
      "  const hit = touches(game, hero, 'enemy');\n  if (hit) {\n    hero.x = 32;\n    hero.y = 256;\n  }\n  const coin = touches",
    ]]),
  }),
  stomp: (f) => ({
    files: edit(f, MAIN, [[
      '  if (hit) {\n    hero.x = 32;\n    hero.y = 256;\n  }',
      '  if (hit) {\n    if (hero.vy > 0) {\n      despawn(game, hit);\n      game.score++;\n      hero.vy = -300;\n    } else {\n      hero.x = 32;\n      hero.y = 256;\n    }\n  }',
    ]]),
  }),
  sparks: (f) => ({
    files: edit(f, MAIN, [
      ['walk, jump,', 'burst, effects, walk, jump,'],
      ['    despawn(game, coin);', '    despawn(game, coin);\n    burst(game, coin.x, coin.y);'],
      ['  const hit = touches', '  effects(game, dt);\n  const hit = touches'],
    ]),
  }),
  shake: (f) => ({ files: edit(f, MAIN, [['walk, jump,', 'shake, walk, jump,'], ['hero.y = 256; }', 'hero.y = 256; shake(game, 8); }']]) }),
  sound: (f) => ({
    files: {
      ...edit(f, MAIN, [
        ["import { BIG_LEVEL } from './levels.js';", "import { BIG_LEVEL } from './levels.js';\nimport soundList from './sounds.js';"],
        ['walk, jump,', 'sounds, play, walk, jump,'],
        ['const SPEED', 'sounds(soundList);\nconst SPEED'],
        ['    burst(game, coin.x, coin.y);', "    burst(game, coin.x, coin.y);\n    play('coin');"],
      ]),
      'src/sounds.js': serializeSounds({ coin: PRESETS.coin }),
    },
  }),
  // ---- stage 4
  title: (f) => ({
    files: edit(f, MAIN, [
      ['walk, jump,', 'held, walk, jump,'],
      ["  return game;\n}", "  game.scene = 'title';\n  return game;\n}"],
      ['export function update(game, keys, dt) {\n', "export function update(game, keys, dt) {\n  if (game.scene === 'title') {\n    if (held(keys, 'space')) game.scene = 'play';\n    return;\n  }\n"],
      ["  label(g, 'Coins '", "  if (game.scene === 'title') label(g, 'Press Space', 240, 160, { size: 28, align: 'center' });\n  label(g, 'Coins '"],
    ]),
  }),
  levellist: (f) => ({
    files: edit(f, MAIN, [
      ["import { BIG_LEVEL } from './levels.js';", "import { BIG_LEVEL } from './levels.js';\nimport { LEVEL_TWO } from './level2.js';"],
      ['/** A new game:', 'const LEVELS = [BIG_LEVEL, LEVEL_TWO];\n\n/** A new game:'],
      ['loadMap(game, BIG_LEVEL,', 'loadMap(game, LEVELS[0],'],
    ]),
  }),
  startlevel: (f) => {
    const text = f[MAIN];
    const start = text.indexOf('  game.map = loadMap(game, LEVELS[0], {');
    const end = text.indexOf('  });', start) + 5;
    const legend = text.slice(start, end).replace('  game.map = loadMap(game, LEVELS[0], {', 'const LEGEND = {').replace('  });', '};');
    const legendText = legend.split('\n').map((l) => l.replace(/^  /, '')).join('\n');
    const fn = 'function startLevel(game, number) {\n  clearThings(game);\n  game.levelIndex = number;\n  game.map = loadMap(game, LEVELS[number], LEGEND);\n}';
    let next = `${text.slice(0, start)}  startLevel(game, 0);${text.slice(end)}`;
    next = swap(next, 'walk, jump,', 'clearThings, walk, jump,');
    next = swap(next, '/** A new game:', `${legendText}\n\n${fn}\n\n/** A new game:`);
    return { files: { ...f, [MAIN]: next } };
  },
  second: (f) => ({
    files: edit(f, MAIN, [[
      '  const coin = touches',
      "  if (all(game, 'coin').length === 0 && game.levelIndex < LEVELS.length - 1) startLevel(game, game.levelIndex + 1);\n  const coin = touches",
    ]]),
  }),
  best: (f) => ({
    files: edit(f, MAIN, [
      ['walk, jump,', 'loadProgress, saveProgress, walk, jump,'],
      ['  startLevel(game, 0);', '  startLevel(game, 0);\n  game.best = loadProgress().best ?? 0;'],
      ['    game.score++;\n  }\n}', '    game.score++;\n    if (game.score > game.best) {\n      game.best = game.score;\n      saveProgress({ best: game.best });\n    }\n  }\n}'],
      ["  label(g, 'Coins '", "  label(g, 'Best ' + game.best, 12, 44);\n  label(g, 'Coins '"],
    ]),
  }),
  // ---- stage 5
  hero: (f) => {
    let sprite = newSprite(16, 16);
    sprite = paintPoints(sprite, 0, [...Array(12).keys()].map((i) => [2 + i, 8]), 'c');
    return {
      files: {
        ...edit(f, MAIN, [
          ["import { BIG_LEVEL } from './levels.js';", "import hero from './art/hero.js';\nimport { BIG_LEVEL } from './levels.js';"],
          ['const SPEED', 'const art = { hero };\nconst SPEED'],
          ["'@': { kind: 'hero', w: 24, h: 30, color: '#ff6b6b' }", "'@': { kind: 'hero', w: 24, h: 30, sprite: 'hero' }"],
          ['drawThings(g, game)', 'drawThings(g, game, art)'],
        ]),
        'src/art/hero.js': serializeSprite(sprite),
      },
    };
  },
  levels: (f) => ({
    files: edit(f, LEVELS, [["'#..............................................#',", `'#${'.#'.repeat(22)}..#',`]]),
  }),
  mysound: (f) => ({
    files: {
      ...edit(f, MAIN, [['  jump(hero, keys, JUMP);', "  if (jump(hero, keys, JUMP)) play('jump');"]]),
      'src/sounds.js': serializeSounds({ coin: PRESETS.coin, jump: PRESETS.jump }),
    },
  }),
  rule: (f) => ({ files: edit(f, MAIN, [['patrol(game, enemy, dt)', 'patrol(game, enemy, dt, 120)']]) }),
  // ---- stages 6 and 7: things done in the network lab and the Ship panel (events), and outside the studio (a button)
  lab: (f) => ({ files: f, events: new Set(['lab-start']) }),
  lag: (f) => ({ files: f, events: new Set(['lab-lag']) }),
  predict: (f) => ({ files: f, events: new Set(['lab-predict-off', 'lab-predict-on']) }),
  gust: (f) => ({ files: f, events: new Set(['lab-gust']) }),
  loss: (f) => ({ files: f, events: new Set(['lab-loss']) }),
  packets: (f) => ({ files: f, events: new Set(['lab-packets']) }),
  measure: (f) => ({ files: f, events: new Set(['health-run']) }),
  budget: (f) => ({ files: f, events: new Set(['budget-set']) }),
  fail: (f) => ({ files: f, events: new Set(['budgets-fail', 'budgets-pass']) }),
  export: (f) => ({ files: f, events: new Set(['exported']) }),
  host: (f) => ({ files: f, events: new Set(['manual']) }),
  // ---- stage 8: rules write a file and connect it to the game; the plugin and the folder are things done in panels
  'rules-first': (f) => ruled(f, [{ ...newRule('touch', 1), when: { type: 'touch', a: 'hero', b: 'enemy' }, then: [{ type: 'shake', amount: 6 }] }]),
  'rules-sound': (f) => ruled(f, [{ ...newRule('touch', 1), when: { type: 'touch', a: 'hero', b: 'enemy' }, then: [{ type: 'shake', amount: 6 }, { type: 'play', sound: 'coin' }] }]),
  'plugin-make': (f) => ({ files: f, events: new Set(['installed']) }),
  'folder-link': (f) => ({ files: f, events: new Set(['folder-linked']) }),
};

// a step that is made when the game starts is only done once the student has pressed Run
for (const id of RESTARTED) {
  const make = solutions[id];
  solutions[id] = (f, m) => ({ ...make(f, m), events: new Set(['restarted']) });
}
