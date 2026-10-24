// Stage 1 of the pathway: "Make something move". The student works on the Run and jump template and, by the end, has changed a running game's numbers, its
// level and its look, and has saved their work. Every mission has a check that looks at the project or the running game, hints that grow in help, and
// the full answer last. The tone is plain and friendly: it explains, it does not talk down.
import { numberChanged, numberAtLeast, summaryMoved, happened, matches, allOf, running, levelIsValid, rowsOf, countIn, afterRestart } from './checks.js';

const MAIN = 'src/main.js';

const moreCoins = (ctx) => {
  const now = countIn(rowsOf(ctx.files[MAIN]), 'o');
  const before = countIn(rowsOf(ctx.start?.files?.[MAIN]), 'o');
  return now > before ? { done: true } : { done: false };
};

/** @type {import('./session.js').Stage} */
export const STAGE_1 = {
  id: 'move',
  title: 'Make something move',
  intro: 'You will change a game while it runs and watch it respond. By the end you will have a hero that runs, jumps and collects coins in a level you edited.',
  done: 'You changed numbers and the game changed with them. You edited a level made of letters, gave your hero a new look and saved your work. '
    + 'That loop (change, look, try again) is what all game making is built from. Next, you will build a bigger level.',
  missions: [
    {
      id: 'play',
      title: 'Play your game',
      watch: [MAIN],
      task: [
        'The game on the right is already running: it is made by the code in the middle. **Click the game**, then run with the arrow keys (or **A** and **D**) and jump with **Space**.',
        'Collect a coin or two. When the hero has moved, this step is done.',
      ],
      check: summaryMoved('x', 40),
      hints: ['Click on the game first, so it can hear your keys.', 'Hold the right arrow for a moment.'],
      answer: 'Click the game, then hold the right arrow key until the hero moves across the screen.',
      why: 'The game is code that runs 60 times every second. Each time, it looks at which keys you hold and moves the hero a little. Nothing here is magic: you are about to read that code and change it.',
      deeper: { label: 'How a game runs', href: 'guide/architecture.html' },
    },
    {
      id: 'speed',
      title: 'Change how fast the hero runs',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const SPEED' },
      task: [
        'Look at the highlighted line in the code: `const SPEED = 160;`. That number is how fast the hero runs, in pixels per second.',
        'Change **160** to a bigger number, like **400**. When you stop typing the game updates by itself. Then run across the screen again.',
      ],
      check: numberChanged(MAIN, 'SPEED', 40),
      hints: ['Click on the number 160, delete it and type a new one.', 'Try 400. Keep the semicolon at the end of the line.'],
      answer: 'Change the line to:\n\nconst SPEED = 400;',
      apply: (files) => ({ [MAIN]: files[MAIN].replace(/(const SPEED\s*=\s*)[\d.]+/, '$1400') }),
      why: 'SPEED is a number the code reads every time it moves the hero. Change the number and the game changes. You did not restart anything: the studio swapped your new code into the game while it kept running.',
      deeper: { label: 'The game loop', href: 'guide/architecture.html' },
    },
    {
      id: 'jump',
      title: 'Jump higher',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const JUMP' },
      task: [
        'The line below it, `const JUMP = 620;`, is how hard the hero pushes off the ground.',
        'Make the hero jump **much higher**: change it to **800 or more**, then press Space in the game.',
      ],
      check: numberAtLeast(MAIN, 'JUMP', 800),
      hints: ['Change 620 to a bigger number.', 'Try 900. Can the hero reach the coins on the high platforms now?'],
      answer: 'Change the line to:\n\nconst JUMP = 900;',
      apply: (files) => ({ [MAIN]: files[MAIN].replace(/(const JUMP\s*=\s*)[\d.]+/, '$1900') }),
      why: 'Jumping sets the hero\'s upward speed, and gravity slowly takes it away again. A bigger JUMP means a faster start upwards, so the hero rises further before gravity wins.',
    },
    {
      id: 'coin',
      title: 'Add a coin to the level',
      watch: [MAIN],
      focus: { file: MAIN, pattern: 'const LEVEL' },
      task: [
        'The level is a picture made of letters. `#` is ground, `o` is a coin, `@` is where the hero starts and `.` is empty air.',
        'Replace one `.` with an **o** to put a new coin in the level. Keep every row the same length. The level is built when the game starts, so press the **Run** button above the game to start the game again and find your coin.',
      ],
      check: afterRestart(allOf(levelIsValid(MAIN), moreCoins, running)),
      hints: ['Pick any row between the first and the last, and change one dot into the letter o.', 'Choose a place the hero can reach, such as above a platform.'],
      answer: 'Change a dot to an o in any row of LEVEL. For example the third row:\n\n\'#.....o.......#\',',
      why: 'loadMap reads each letter of each row and creates a thing for it, using the legend that says what each letter means. The level is just text, so you can edit it like text. '
        + 'It only runs in `create`, when the game starts, which is why a change to the level needs Run to show up, while a change to SPEED shows up at once.',
      deeper: { label: 'Levels made of letters', href: 'tutorials/2d-platformer.html' },
    },
    {
      id: 'paint',
      title: 'Give the hero a new look',
      watch: [MAIN],
      focus: { file: MAIN, pattern: "'@'" },
      task: [
        'Find the line that describes the hero: it starts with `\'@\'`. Each letter in the level has a description like this one.',
        'Add a colour to it, for example `color: \'#ff6b6b\'`, or a picture made from an emoji, for example `emoji: \'🐸\'`. Put a comma between the parts. Then press the **Run** button above the game to start over with the new look.',
      ],
      check: afterRestart(matches(MAIN, /'@'\s*:\s*\{[^}]*\b(color|emoji)\s*:/, 'Add color: or emoji: inside the braces of the \'@\' line, with commas between the parts.')),
      hints: ['The line looks like `\'@\': { kind: \'hero\', w: 24, h: 30 },`. Add your new part before the closing brace.', "Try: `'@': { kind: 'hero', w: 24, h: 30, color: '#ff6b6b' },`"],
      answer: "Make the line:\n\n'@': { kind: 'hero', w: 24, h: 30, color: '#ff6b6b' },",
      why: 'A description is a set of named values in curly braces. kind says what it is; w and h are its size; color or emoji says how it looks. You can add any name you like and read it later in your code.',
    },
    {
      id: 'save',
      title: 'Save your work as a restore point',
      watch: [MAIN],
      task: [
        'Your work is already saved as you type. A **restore point** is a named copy you can go back to if an experiment goes wrong.',
        'Press **Ctrl+S** (or use the Edit menu), give it a name like "My first hero", and press Save.',
      ],
      check: happened('restore-point'),
      hints: ['Press Ctrl+S while you are in the studio.', 'Type a name and press Save. You can see it in the History panel.'],
      answer: 'Press Ctrl+S, type a name such as "My first hero", then press Save.',
      why: 'Restore points are copies of the whole project. Going back to one first saves what you have now as another restore point, so you can never lose work by going back.',
    },
  ],
};
