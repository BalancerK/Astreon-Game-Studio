// Stage 7 of the pathway: "Ship it". Measure the game, hold it to limits, export it as a web page. It teaches that size and speed are things you can measure and
// set a limit on, and that a finished game is a folder of plain files on a web host. Two steps happen outside the studio, so the student says when they are done.
import { happened, allOf } from './checks.js';

/** @type {import('./session.js').Stage} */
export const STAGE_7 = {
  id: 'ship',
  title: 'Ship it',
  intro: 'A game is finished when other people can play it. You will measure yours, give it limits it must stay inside, export it as a web page and put it where anyone can open it.',
  done: 'You shipped a game: measured, held to limits, exported as plain files that work on any web host, and played by someone who is not you. '
    + 'From here you can keep improving it, build something new, or learn the engine underneath the studio.',
  missions: [
    {
      id: 'measure',
      title: 'Measure your game',
      open: 'ship',
      watch: [],
      task: [
        'Open the **Ship** panel and press **Measure my game**. It starts the game fresh, lets it run for a few seconds, and reads three things: how much a player downloads, how long until the first picture, and how much of every frame the game uses.',
        'Look at the numbers. The frame time is shown for a slower device too (a phone is often four times slower than a laptop).',
      ],
      check: happened('health-run'),
      hints: ['The Ship panel is in the Ship workspace, or in the View menu.', 'The game must be open and running: use the Run button if it is stopped.'],
      answer: 'Open the Ship panel and press "Measure my game".',
      why: 'You cannot improve what you have not measured. Download size decides who waits, frame time decides who stutters, and memory decides whose phone closes the page. All three are numbers you can see.',
    },
    {
      id: 'budget',
      title: 'Set a limit',
      open: 'ship',
      watch: [],
      task: [
        'A **budget** is a limit your game must stay inside. Change one of the limits in the table, for example make the time per frame **6 ms**.',
        'A budget is a promise to yourself: when the game goes over it, the panel says so, and the export asks whether you really want to go on.',
      ],
      check: happened('budget-set'),
      hints: ['Type a new number in the box beside a measurement.', 'You can also tick "off" for a limit you do not care about.'],
      answer: 'Change any limit in the table.',
      why: 'Games get heavier a little at a time and nobody notices. A written limit turns "it feels slow" into a number that either passes or fails, so a slow change is caught the day it is made.',
    },
    {
      id: 'fail',
      title: 'Break a limit, then fix it',
      open: 'ship',
      watch: [],
      task: [
        'Set the **Download size** limit to **1 KB**, which no game can meet, and see the panel say it is over. Then set it to something sensible (say 500) and see it pass.',
        'Failing on purpose is how you check that a limit really would catch a problem.',
      ],
      check: allOf(happened('budgets-fail'), happened('budgets-pass')),
      hints: ['The download limit is the first row. Type 1, then press Tab.', 'The red cross turns into a green tick when the game is inside its limits.'],
      answer: 'Set the download limit to 1, look at the red cross, then set it back to 500.',
      why: 'A check that has never failed might not be checking anything. Watching it fail, and then pass when you fix the cause, is how you learn to trust it.',
    },
    {
      id: 'export',
      title: 'Export your game',
      open: 'ship',
      watch: [],
      task: [
        'Give the game a title and press **Export as a web game (.zip)**. You get a zip of plain files: a page, your code, and just the parts of the engine your game uses.',
        'Leave "Installable and works offline" ticked: the export then carries what a browser needs to install it like an app.',
      ],
      check: happened('exported'),
      hints: ['If a limit is failing the panel asks first; you can export anyway.', 'The file lands in your downloads folder.'],
      answer: 'Type a title and press the Export button.',
      why: 'There is no server to run: your game is a folder of files, and any web host can serve a folder. The engine files are included only if your game imports them, which keeps the download small.',
    },
    {
      id: 'host',
      title: 'Play it where anyone can',
      open: 'ship',
      watch: [],
      manual: true,
      task: [
        'Unzip the file and put the folder on a web host: itch.io (an HTML5 game), GitHub Pages, Netlify, or any server you can reach. Open the address and play.',
        'Opening `index.html` straight from your disk will not work, because browsers only let games like this load over a web address. If you just want to test, a local web server on your computer works as well. Press the button below when you have played it.',
      ],
      check: happened('manual'),
      hints: ['On a computer with Node, `npx serve` in the unzipped folder gives you a local address.', 'itch.io lets you upload the zip as it is and choose "this file will be played in the browser".'],
      answer: 'Host the unzipped folder somewhere, open its address, play, then press "I have done this".',
      why: 'A game nobody can open is not shipped. The first time you play your own game from a web address, on a different device, is the moment the whole thing becomes real.',
    },
  ],
};
