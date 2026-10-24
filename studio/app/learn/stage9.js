// The pathway "Make a 3D game": two stages on the Gem hall template. The first is about walking round a 3D world and changing it (speed, how wide you see,
// walls, colours); the second makes it a game (more gems, collecting them, a jump, a sky) and ends with the Profiler, because a 3D game is where you first
// need to know what is slow. Like every pathway: each mission has a check, hints that grow, and the full answer last.
import {
  numberChanged, numberAtLeast, summaryMoved, summaryIs, matches, allOf, anyOf, calls, afterRestart, happened, moreCalls, newColour,
} from './checks.js';

const MAIN = 'src/main.js';
const swap = (text, from, to) => (text.includes(from) ? text.replace(from, to) : text);

/** @type {import('./session.js').Stage} */
export const STAGE_WALK = {
  id: 'walk3d',
  title: 'Walk around a 3D world',
  intro: 'You will walk round a hall that is drawn in 3D, then change how fast you move, how wide you see, and the walls themselves.',
  done: 'You moved through a 3D world, changed how it feels and built a wall of your own. A 3D world is only a list of blocks and a camera: next you will make it a game.',
  missions: [
    {
      id: 'look',
      title: 'Walk into the hall',
      watch: [MAIN],
      task: [
        'The game on the right is a hall seen from the inside. **Click the game**, then **turn** with the left and right arrow keys and **walk** with the up and down arrows (or **W** and **S**). **A** and **D** sidestep.',
        'Walk round the pillars and into the next part of the hall. When you have walked a few steps, this step is done.',
      ],
      check: summaryMoved('walked', 4),
      hints: ['Click on the game first, so it can hear your keys.', 'Turn with the left arrow, then hold the up arrow.'],
      answer: 'Click the game, then hold the up arrow (or W) for a few seconds.',
      why: 'Every tick the game moves a camera a little in the way it faces. The walls are blocks the camera cannot walk into. Nothing you see is a picture: the game works out where each block is on the screen, sixty times a second.',
      deeper: { label: 'How the 3D is drawn', href: 'guide/3d-games.html' },
    },
    {
      id: 'mouse3d',
      title: 'Look with the mouse',
      watch: [],
      manual: true,
      task: [
        '**Click the game.** The pointer disappears and moving the mouse turns your head: left and right turn you, up and down tilt your view. Walk with **W**, **A**, **S**, **D** at the same time, as in most 3D games.',
        'Press **Esc** to let go of the mouse. To see the whole game, press the **Full screen** button above it (Esc leaves full screen too). If you have no mouse, press the button below to carry on.',
      ],
      check: anyOf(happened('mouse-locked'), happened('manual')),
      hints: ['Click once on the picture of the game, not on the code.', 'If the pointer does not vanish, click the game again: some browsers want a second click.'],
      answer: 'Click the game, move the mouse, then press Esc to let go.',
      why: 'The game page takes hold of the mouse (the browser calls it pointer lock) and sends how far it moved. To the game that is one more key that is held, so the Time Machine records your looking too, and a replay turns the same way. The code that uses it is one line: `mouseLook3d(game.cam, keys)`.',
    },
    {
      id: 'speed3d',
      title: 'Walk faster',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const SPEED' },
      task: [
        'Near the top of the code, `const SPEED = 4;` is how fast you walk, in metres a second.',
        'Change **4** to **8** or more, then walk across the hall again.',
      ],
      check: numberAtLeast(MAIN, 'SPEED', 8),
      hints: ['Click on the number 4, delete it and type a bigger one.', 'Try 10. Keep the semicolon.'],
      answer: 'Change the line to:\n\nconst SPEED = 10;',
      apply: (files) => ({ [MAIN]: files[MAIN].replace(/(const SPEED\s*=\s*)[\d.]+/, '$110') }),
      why: 'SPEED is just a number the walking code reads. In 3D, as in 2D, you change what a game does by changing a number and looking.',
    },
    {
      id: 'fov',
      title: 'See wider',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const FOV' },
      task: [
        '`const FOV = 70;` is how wide you see, in degrees (FOV is short for field of view). Your eyes see about 120.',
        'Change it to **100** and look at the hall: more fits on the screen, and the walls bend away from you. Then try **40** for a telescope.',
      ],
      check: numberChanged(MAIN, 'FOV', 20),
      hints: ['It is the number on the line that says FOV.', 'Any number from 30 to 120 works.'],
      answer: 'Change the line to:\n\nconst FOV = 100;',
      apply: (files) => ({ [MAIN]: files[MAIN].replace(/(const FOV\s*=\s*)[\d.]+/, '$1100') }),
      why: 'A camera shows a slice of the world, as wide as the field of view. A wide slice squeezes everything in (things at the edge look stretched); a narrow one zooms in. Games often change it for effect: a wider view when you run.',
    },
    {
      id: 'wall3d',
      title: 'Build a wall',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'block\\(0, -8' },
      task: [
        'The hall is a list of blocks: `block(x, z, width, depth, height, colour)`. `x` is left and right, `z` is towards you, and the numbers after are the size. Look at the line `block(0, -8, 4, 1, 3, WALL)`: a wall in the middle of the room.',
        'Add a new line to the list, for example `block(0, 0, 3, 1, 3, STONE),` and walk to it: you cannot walk through it.',
      ],
      check: moreCalls(MAIN, 'block'),
      hints: ['Copy the line `block(0, -8, 4, 1, 3, WALL),` and paste it just under itself.', 'Change the first two numbers so it stands somewhere else, like `block(0, 2, 4, 1, 3, WALL),`. Keep the comma at the end.'],
      answer: 'Add this line inside the BLOCKS list:\n\nblock(0, 2, 4, 1, 3, STONE),',
      apply: (files) => ({ [MAIN]: files[MAIN].replace('  block(0, -8, 4, 1, 3, WALL),', '  block(0, -8, 4, 1, 3, WALL),\n  block(0, 2, 4, 1, 3, STONE),') }),
      why: 'The world is a list, and the game draws and bumps into everything in the list. To change the world you change the list: no pictures to draw, no files to load. A level editor would only be a nicer way to write these lines.',
    },
    {
      id: 'colour3d',
      title: 'Paint the walls',
      watch: [MAIN],
      focus: { file: MAIN, pattern: "const WALL" },
      task: [
        '`const WALL = \'#5b6b8c\';` is the colour of the walls, written as a code: **#** and six letters or digits for red, green and blue.',
        'Change it to another colour, such as **\'#b04a4a\'** (brick red) or **\'#4a9b6b\'** (green), and look at the hall.',
      ],
      check: newColour(MAIN),
      hints: ['Keep the quote marks and the # at the start.', 'Try \'#b04a4a\'.'],
      answer: 'Change the line to:\n\nconst WALL = \'#b04a4a\';',
      apply: (files) => ({ [MAIN]: files[MAIN].replace(/(const WALL\s*=\s*)'#[0-9a-fA-F]{3,6}'/, "$1'#b04a4a'") }),
      why: 'A colour is three numbers (red, green, blue) written in base sixteen. The game also darkens each side of a block a different amount, so a flat colour still looks solid.',
    },
  ],
};

/** @type {import('./session.js').Stage} */
export const STAGE_GAME = {
  id: 'gems3d',
  title: 'Make it a game',
  intro: 'A world to walk round is not a game yet. You will add gems, collect every one, add a jump and a sky, and then look at what the game costs.',
  done: 'You have a finished little 3D game: a world, something to find, a jump, a sky of your own, and a way to see what it costs. The same pieces make bigger worlds.',
  missions: [
    {
      id: 'gem3d',
      title: 'Hide another gem',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const GEMS' },
      task: [
        'The gems are a list too: `gem(x, z, height, colour)`. Add another to `GEMS`, somewhere you can reach, for example `gem(-3, 0, 1, \'#ffffff\'),`.',
        'The list is read when the game **starts**, so press the purple **Run** button above the game, and look for your gem.',
      ],
      check: afterRestart(moreCalls(MAIN, 'gem')),
      hints: ['Add the new line inside the square brackets of GEMS, with a comma at the end.', 'Pick a place without a wall: x between -9 and 9, z between -11 and 11.'],
      answer: 'Add this line inside GEMS:\n\ngem(-3, 0, 1, \'#ffffff\'),\n\nThen press Run.',
      apply: (files) => ({ [MAIN]: files[MAIN].replace("  gem(-8, 10, 1, '#6bb6ff')", "  gem(-3, 0, 1, '#ffffff'), gem(-8, 10, 1, '#6bb6ff')") }),
      why: 'The gems are copied into the game when it starts (the line `game.gems = GEMS.map(...)`), and picked up gems are taken out of that copy. That is why the list only changes when the game restarts, while the walls change as you type.',
    },
    {
      id: 'guardian3d',
      title: 'Tame the guardian',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const GUARDIAN' },
      task: [
        'After three seconds a red guardian starts walking towards you, and if it catches you it costs a life. `const GUARDIAN = 2.2;` is how fast it walks, in metres a second. You walk at `SPEED`, so you can always outrun it.',
        'Change **GUARDIAN** to make the game easier or harder: **1** is slow, **3.5** is nearly as fast as you. Then see what it does.',
      ],
      check: numberChanged(MAIN, 'GUARDIAN', 0.3),
      hints: ['It is the number on the line that says GUARDIAN.', 'Try 1.2 for a gentle game or 3.5 for a hard one.'],
      answer: 'Change the line to:\n\nconst GUARDIAN = 1.2;',
      apply: (files) => ({ [MAIN]: files[MAIN].replace(/(const GUARDIAN\s*=\s*)[\d.]+/, '$11.2') }),
      why: 'The guardian is a thing that walks a little towards you each tick (`chase3d`), sliding along walls. Making a game fair is mostly choosing numbers like this one, then playing it again and again.',
    },
    {
      id: 'collect3d',
      title: 'Find every gem',
      watch: [MAIN],
      task: [
        'Walk into each gem to pick it up. The top of the screen counts them. Find **all** of them.',
      ],
      check: summaryIs('gemsLeft', (v) => v === 0),
      hints: ['Gems float and turn: look for the small bright diamonds.', 'Walk close to one: you pick it up when you are within about a step.', 'There are gems in every corner and one in the middle.'],
      answer: 'Walk into every gem until the counter at the top says all of them.',
      why: 'Collecting is a distance check: each tick the game asks how far you are from each gem, and takes out those that are close. This is the same idea as touching a coin in the 2D game.',
    },
    {
      id: 'jump3d',
      title: 'Add a jump',
      watch: [MAIN],
      task: [
        'The kit can make you jump. In the first line, add **jump3d** to the names in the curly brackets after `import`, then add this line inside `update`, under the `move3d` line:',
        '`jump3d(game.cam, keys, dt);`',
        'Press **Space** in the game: you jump, and you can hop onto a crate.',
      ],
      check: allOf(calls(MAIN, 'jump3d'), matches(MAIN, /import\s*\{[^}]*\bjump3d\b[^}]*\}/, 'jump3d must be in the import line at the top.')),
      hints: ['The import line starts `import { newGame, camera3d, move3d,`: add `jump3d,` after move3d.', 'Put the new line right under the line that starts `game.walked += move3d(`.'],
      answer: 'Change the first line to include jump3d:\n\nimport { newGame, camera3d, move3d, mouseLook3d, chase3d, jump3d, drawWorld3d, block, gem, label, screen } from \'@engine/arcade\';\n\nand add inside update, under the move3d line:\n\njump3d(game.cam, keys, dt);',
      apply: (files) => ({ [MAIN]: swap(swap(files[MAIN], 'chase3d, drawWorld3d', 'chase3d, jump3d, drawWorld3d'), '  const near = ', '  jump3d(game.cam, keys, dt);\n  const near = ') }),
      why: 'A jump is a speed upwards that gravity slowly takes away. The kit keeps that speed on the camera (`cam.vy`) and moves your eyes by it each tick. Blocks lower than your feet do not stop you: that is how you can climb onto a crate.',
    },
    {
      id: 'sky3d',
      title: 'Make a sky',
      watch: [MAIN],
      task: [
        'In `render`, the line that starts `drawWorld3d(` draws the world. Give it a sky: change `{ time: game.time }` to `{ time: game.time, sky: \'#3a1c5c\', horizon: \'#ff9966\' }` for a sunset.',
        '`sky` is the colour overhead, `horizon` the colour at the horizon, and `ground` the floor. Try your own.',
      ],
      check: matches(MAIN, /\bsky:\s*['"]#[0-9a-fA-F]{3,6}['"]/, 'Write the colour as a code in quotes, like \'#3a1c5c\'.'),
      hints: ['It goes inside the curly brackets after `time: game.time`, with a comma between.', 'Colours start with # and have six letters or digits.'],
      answer: 'Change the options to:\n\n{ time: game.time, sky: \'#3a1c5c\', horizon: \'#ff9966\' }',
      apply: (files) => ({ [MAIN]: swap(files[MAIN], '{ time: game.time }', "{ time: game.time, sky: '#3a1c5c', horizon: '#ff9966' }") }),
      why: 'The last argument of drawWorld3d is a list of options, and each one has a good default. Games are mostly built like this: sensible defaults, and a few options to make it yours.',
    },
    {
      id: 'profile3d',
      title: 'See what it costs',
      watch: [],
      manual: true,
      open: 'profiler',
      task: [
        'A 3D game draws many shapes every tick, so it is where speed starts to matter. The **Profiler** is open: click **Time every function** and look at the table.',
        'The functions at the top are where the time goes. Press the button below when you have looked.',
      ],
      check: anyOf(happened('profile-functions'), happened('manual')),
      hints: ['Click the game first, so it is running while you look.', 'Walk round while the table fills in: the drawing function should be the busy one.'],
      answer: 'Open the Profiler, press Time every function, and read the table.',
      why: 'The Profiler puts a stopwatch round each of your functions (only for the copy that runs, your code is not changed) and shows which one takes the most time. Knowing where the time goes beats guessing, and it is how you decide what to make cheaper.',
    },
  ],
};
