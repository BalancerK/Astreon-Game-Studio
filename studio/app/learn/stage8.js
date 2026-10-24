// Stage 8 of the pathway: "Go deeper". Three ways to make the studio and the game your own: rules (pieces that write code), a plugin of your own (a panel
// nobody else wrote), and a folder on your computer (so git and other tools see your project). The 3D scene editor is not part of this stage yet.
import { happened, allOf, anyOf, soundNames, running } from './checks.js';
import { parseRules, problemWith } from '../rules/rules-model.js';

const rulesOf = (ctx) => {
  try { return parseRules(ctx.files?.['src/rules.js']); } catch { return null; }
};
const connected = (ctx) => /applyRules\(/.test(ctx.files?.['src/main.js'] ?? '') && /drawRules\(/.test(ctx.files?.['src/main.js'] ?? '');

/** The game has at least one finished rule, and it is connected to the game. */
const hasRule = (test, note) => (ctx) => {
  const rules = rulesOf(ctx);
  if (!rules) return { done: false, note: '' };
  const good = rules.filter((r) => !problemWith(r));
  if (!good.length) return { done: false, note: rules.length ? 'A rule is not finished yet: the panel says what is missing.' : '' };
  if (!connected(ctx)) return { done: false, note: 'The game does not call the rules yet: add a rule in the panel and it connects them.' };
  const r = allOf(running)(ctx);
  if (!r.done) return r;
  return good.some((rule) => test(rule, ctx)) ? { done: true } : { done: false, note };
};

/** @type {import('./session.js').Stage} */
export const STAGE_8 = {
  id: 'deeper',
  title: 'Go deeper',
  intro: 'You have made and shipped a game. Here are three ways to go further: describe behaviour as rules, add a part to the studio itself, and keep your project in a folder on your computer.',
  done: 'You wrote behaviour as rules and read the code they make, built a plugin that adds its own panel, and linked your project to a folder. '
    + 'That is the whole studio: everything in it is a plain file, and everything in it can be extended.',
  missions: [
    {
      id: 'rules-first',
      title: 'Write a rule',
      open: 'rules',
      watch: [],
      task: [
        'Open the **Rules** panel and add a rule: press **something touches something**. Change it to say **when hero touches enemy, shake the screen**.',
        'Press **Show the code** under the rule. That is the JavaScript the rule made: you could have typed it yourself. The panel wrote it into `src/rules.js` and connected it to your game.',
      ],
      check: hasRule((r) => r.when.type === 'touch' && r.then.some((t) => t.type === 'shake'),
        'Make the rule shake the screen when the hero touches the enemy.'),
      hints: ['Use the drop-down under "Then" to choose "shake the screen".', 'The first box after When is the hero; the second is what it touches.'],
      answer: 'Add the touch rule, set the second thing to enemy and the action to "shake the screen".',
      why: 'A rule is a sentence the computer can follow. Writing it in pieces is quicker for small things, and because the code is right there you can see how each piece becomes a line.',
    },
    {
      id: 'rules-sound',
      title: 'Give a rule a sound',
      open: 'rules',
      watch: [],
      task: [
        'Add a second step to the rule with **Add a step**, and choose **play a sound**. Type the name of one of your sounds from the Sounds panel (for example `coin`).',
        'Touch the enemy in the game and listen.',
      ],
      check: hasRule((r, ctx) => r.then.some((t) => t.type === 'play' && soundNames(ctx.files?.['src/sounds.js']).includes(t.sound)),
        'Use the name of a sound you made in the Sounds panel.'),
      hints: ['The names are listed in the Sounds panel.', 'Sound names are small words with no spaces, like coin or jump.'],
      answer: 'Add a step, choose "play a sound" and type the name of one of your sounds.',
      why: 'A rule can do several things at once. Sound, shaking and score together are what make a hit feel like a hit.',
    },
    {
      id: 'plugin-make',
      title: 'Add a part to the studio',
      open: 'plugins',
      watch: [],
      task: [
        'Open the **Plugins** panel, press **Start a new plugin**, then press **Install from this project**. The studio lists what the plugin is allowed to do and asks you first.',
        'A plugin is one small file. It adds a panel that did not exist, and it runs in a closed box: it can only use what it asked for.',
      ],
      check: happened('installed'),
      hints: ['"Start a new plugin" makes the file; "Install from this project" turns it on.',
        'Read the permissions in the dialog: a plugin that asks for nothing cannot see your project.'],
      answer: 'Press "Start a new plugin", then "Install from this project", and confirm.',
      why: 'The studio is built the same way you build a game: small parts with clear edges. A plugin is a part you add, and the closed box is why you can try other people\'s without worrying.',
    },
    {
      id: 'folder-link',
      title: 'Keep it in a folder',
      watch: [],
      manual: true,
      task: [
        'Use **File > Link this project to a folder…** and choose an empty folder on your computer. Your files appear there, and changes go both ways, so git, another editor or a backup can see them. (Chrome and Edge can do this.)',
        'If your browser cannot, or you would rather not, press the button to carry on.',
      ],
      check: anyOf(happened('folder-linked'), happened('manual')),
      hints: ['The folder you choose should be empty, or a folder you want the project saved into.', 'If both have files, "Merge" keeps everything.'],
      answer: 'Choose File > Link this project to a folder…, pick a folder, and allow it.',
      why: 'Your project is plain text files, so it fits every tool made for text: version control, backups, other editors. The studio is one window onto it, not a cage.',
    },
  ],
};
