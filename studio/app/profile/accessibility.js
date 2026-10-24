// What a game does and does not offer players, found by reading its code (nothing is run). It follows the Game Accessibility Guidelines' basic list: remappable keys, text a
// person can read, separate volumes, captions for sounds that matter, no forced screen shake. What can be checked by reading is checked; the rest is listed as "check by
// eye", because a tool that pretends to know whether colour is the only clue would be wrong. Pure functions, tested in Node.

const EXPLAIN = {
  remap: 'Players with a different keyboard, one hand or a different habit need to choose their own keys. '
    + 'It is the most often missed item on the list.',
  hardKeys: 'A key written straight into the code cannot be changed by the player. `held(keys, \'jump\')` follows whatever the player picked.',
  volume: 'Some players need the music off to hear the sounds, or everything quieter. The settings menu has master, effects and music volume.',
  motion: 'Screen shake makes some players ill. With the settings in place `shake()` stops when the player asks for less movement.',
  captions: 'A player who cannot hear needs the important sounds as words: `caption(game, \'[door creaks]\')`.',
  smallText: 'Text under 12 pixels is hard to read for many people. The player can scale text up, but a good starting size helps everyone.',
  handText: 'Text drawn straight on the canvas does not follow the player\'s text size; `label()` and the UI screens do.',
};

const MANUAL = [
  ['colour', 'Colour alone',
    'Is anything only told by colour (red enemy, green pickup)? Add a shape, an icon or a word as well, or offer other colours.'],
  ['flash', 'Flashing', 'Nothing should flash more than three times a second, and large bright flashes are best avoided.'],
  ['timing', 'Timing and holding',
    'Can a player who is slower, or who cannot hold a key down, still play? Offer a slower speed, or toggle instead of hold.'],
  ['onehand', 'One hand', 'Can the game be played with one hand, or with a few keys? Check the keys you chose for each action.'],
  ['tutorial', 'Telling the player what to do', 'Controls and goals should be said in words in the game, and again from the pause menu.'],
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function find(files, regex, only = (p) => /^src\/.*\.js$/.test(p)) {
  const found = [];
  const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string' || !only(path)) continue;
    for (const m of text.matchAll(global)) found.push({ path, line: lineOf(text, m.index), text: m[0].slice(0, 60) });
  }
  return found;
}

/**
 * Look over a project.
 * @param {Record<string, string>} files the project's text files
 * @returns {{id: string, state: 'ok' | 'todo' | 'check' | 'na', title: string, detail: string, where: {path: string, line: number, text: string}[]}[]}
 */
export function accessibilityReport(files) {
  const code = (p) => /^src\/.*\.js$/.test(p) && !/^src\/(art|controls|sounds|music|text|ui|states|clips|particles|behaviors)(\/|\.js$)/.test(p);
  const only = (p) => code(p) && !/\.test\.js$/.test(p);
  const anyCode = Object.entries(files).filter(([p, t]) => only(p) && typeof t === 'string');
  const uses = (re) => anyCode.some(([, t]) => re.test(t));
  const out = [];
  const add = (id, state, title, detail, where = []) => out.push({ id, state, title, detail, where });

  const usesKeys = uses(/\b(held|walk|steer|jump)\s*\(|keys\.has\s*\(/);
  const remappable = uses(/\bcontrols\s*\(|\bopenSettingsMenu\s*\(|\bsetBinding\s*\(/);
  if (!usesKeys) add('remap', 'na', 'Players can choose their keys', 'The game does not read the keyboard yet.');
  else if (remappable) add('remap', 'ok', 'Players can choose their keys',
    'The game uses the kit\'s actions and its settings menu offers a Controls page.');
  else add('remap', 'todo', 'Players can choose their keys',
    `${EXPLAIN.remap} Open the settings menu from your pause or title screen: openSettingsMenu(game).`);

  const hard = find(files, /keys\.has\s*\(\s*['"`][A-Za-z0-9]+['"`]\s*\)/, only);
  if (hard.length) add('hardKeys', 'todo', 'Keys written into the code', `${hard.length} place${hard.length === 1 ? '' : 's'}. ${EXPLAIN.hardKeys}`,
    hard.slice(0, 8));
  else if (usesKeys) add('hardKeys', 'ok', 'Keys written into the code', 'Every key is read by an action name.');

  const usesSound = uses(/\bplay\s*\(|\bplayMusic\s*\(/);
  const usesSettings = uses(/\bsettings\s*\(|\bopenSettingsMenu\s*\(/);
  if (!usesSound) add('volume', 'na', 'Separate volumes', 'The game makes no sound yet.');
  else add('volume', usesSettings ? 'ok' : 'todo', 'Separate volumes',
    usesSettings ? 'Sounds and music follow the master, effects and music volumes.' : `${EXPLAIN.volume} Call settings() once and open the menu.`);

  const shakes = find(files, /\bshake\s*\(/, only);
  if (!shakes.length) add('motion', 'na', 'Screen shake can be turned off', 'The game does not shake the screen.');
  else add('motion', usesSettings ? 'ok' : 'todo', 'Screen shake can be turned off',
    usesSettings ? 'The menu has "Reduce screen shake", and shake() obeys it.' : EXPLAIN.motion, shakes.slice(0, 4));

  if (usesSound) {
    const captioned = uses(/\bcaption\s*\(/);
    add('captions', captioned ? 'ok' : 'check', 'Captions for sounds that matter',
      captioned ? 'The game shows captions (and the player can turn them off).' : EXPLAIN.captions);
  }

  const small = [
    ...find(files, /\bsize\s*:\s*([1-9]|1[01])\b(?!\d)/, only).filter((f) => !/(?:w|h|width|height)\s*:\s*\d/.test(f.text)),
    ...(typeof files['src/ui.js'] === 'string' ? find({ 'src/ui.js': files['src/ui.js'] }, /"size":\s*([1-9]|1[01])\b(?!\d)/, () => true) : []),
  ];
  if (small.length) add('smallText', 'todo', 'Small text',
    `${small.length} place${small.length === 1 ? '' : 's'} under 12 pixels. ${EXPLAIN.smallText}`, small.slice(0, 8));
  else add('smallText', 'ok', 'Small text', 'No text under 12 pixels was found.');

  const byHand = find(files, /\.font\s*=/, only);
  if (byHand.length) add('handText', 'check', 'Text drawn by hand', `${byHand.length} place${byHand.length === 1 ? '' : 's'}. ${EXPLAIN.handText}`,
    byHand.slice(0, 6));

  for (const [id, title, detail] of MANUAL) add(id, 'check', title, detail);
  return out;
}

/** How many of the checks that can be decided by reading are done, out of those that apply. */
export function accessibilityScore(report) {
  const decided = report.filter((r) => r.state === 'ok' || r.state === 'todo');
  return { done: decided.filter((r) => r.state === 'ok').length, of: decided.length };
}
