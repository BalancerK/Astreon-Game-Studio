// Rules: "when the hero touches a coin, add 1 to the score and play a sound" built from pieces instead of typed, for people who prefer to start that way. Code
// is still the truth: a set of rules is turned into a plain JavaScript file (`src/rules.js`) that the game calls, and every rule shows the exact code it makes,
// so the pieces are a way into code, not a way around it. The file holds the rules as JSON too, so the editor can read it back. Pure functions, tested in Node.

export const KEY_NAMES = ['left', 'right', 'up', 'down', 'space', 'jump', 'action'];
const KIND = /^[A-Za-z][\w-]{0,30}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;

/** What a rule can be waiting for, with the pieces each one has and what it starts as. */
export const WHENS = {
  touch: { label: 'something touches something', make: () => ({ type: 'touch', a: 'hero', b: 'coin' }) },
  key: { label: 'a key is pressed', make: () => ({ type: 'key', key: 'space', mode: 'press' }) },
  every: { label: 'every few seconds', make: () => ({ type: 'every', seconds: 3 }) },
  none: { label: 'there are none of something left', make: () => ({ type: 'none', kind: 'coin' }) },
  score: { label: 'the score reaches a number', make: () => ({ type: 'score', n: 10 }) },
};

/** What a rule can do. */
export const THENS = {
  score: { label: 'change the score', make: () => ({ type: 'score', add: 1 }) },
  remove: { label: 'remove something', make: () => ({ type: 'remove', who: 'b' }) },
  play: { label: 'play a sound', make: () => ({ type: 'play', sound: 'coin' }) },
  burst: { label: 'throw sparks', make: () => ({ type: 'burst', who: 'b' }) },
  shake: { label: 'shake the screen', make: () => ({ type: 'shake', amount: 6 }) },
  add: { label: 'add to a number of the game', make: () => ({ type: 'add', field: 'lives', n: -1 }) },
  set: { label: 'set a value of the game', make: () => ({ type: 'set', field: 'lives', value: 3 }) },
  move: { label: 'move something to a place', make: () => ({ type: 'move', who: 'a', x: 32, y: 256 }) },
  spawn: { label: 'make something new', make: () => ({ type: 'spawn', kind: 'coin', x: 'random', y: 100 }) },
  say: { label: 'show a message', make: () => ({ type: 'say', text: 'Well done!', seconds: 2 }) },
};

/** A new rule of a kind, with one thing to do. */
export function newRule(whenType = 'touch', id = 1) {
  const when = (WHENS[whenType] ?? WHENS.touch).make();
  const then = whenType === 'touch' ? [{ type: 'score', add: 1 }, { type: 'remove', who: 'b' }] : [THENS.say.make()];
  return { id, when, once: false, then };
}

/** The next rule number not in use. */
export const nextId = (rules) => rules.reduce((n, r) => Math.max(n, r.id), 0) + 1;

const clean = (text, max = 80) => String(text).replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /').slice(0, max);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

/** What is wrong with a rule (so the editor can say so instead of making code that fails), or null. */
export function problemWith(rule) {
  if (!rule || typeof rule !== 'object' || !Number.isInteger(rule.id)) return 'This is not a rule.';
  const w = rule.when;
  if (!w || !(w.type in WHENS)) return 'Choose what the rule waits for.';
  if (w.type === 'touch' && !(KIND.test(w.a ?? '') && KIND.test(w.b ?? ''))) {
    return 'Name the two things that touch, with letters and numbers (like hero and coin).';
  }
  if (w.type === 'key' && !KEY_NAMES.includes(w.key)) return 'Choose a key.';
  if (w.type === 'every' && !(w.seconds >= 0.1 && w.seconds <= 3600)) return 'Choose how many seconds (0.1 or more).';
  if (w.type === 'none' && !KIND.test(w.kind ?? '')) return 'Name the thing, with letters and numbers (like coin).';
  if (w.type === 'score' && !Number.isFinite(w.n)) return 'Choose a score.';
  if (!Array.isArray(rule.then) || !rule.then.length) return 'Add something for the rule to do.';
  for (const t of rule.then) {
    if (!t || !(t.type in THENS)) return 'One of the things to do is not known.';
    if (t.type === 'score' && !Number.isFinite(t.add)) return 'Choose how much to change the score.';
    if ((t.type === 'remove' || t.type === 'burst' || t.type === 'move') && !['a', 'b'].includes(t.who)) return 'Choose which thing.';
    const aimed = t.type === 'remove' || t.type === 'burst' || t.type === 'move';
    if (aimed && t.who === 'b' && w.type !== 'touch') return 'Only a rule about touching has a second thing.';
    if (aimed && t.who === 'a' && w.type !== 'touch') return 'Only a rule about touching has a first thing to point at.';
    if (t.type === 'play' && !KIND.test(t.sound ?? '')) return 'Name the sound (the name you gave it in the Sounds panel).';
    if (t.type === 'shake' && !Number.isFinite(t.amount)) return 'Choose how hard to shake.';
    if ((t.type === 'add' || t.type === 'set') && !FIELD.test(t.field ?? '')) {
      return 'Name the value with letters, numbers and underscores (like lives).';
    }
    if (t.type === 'add' && !Number.isFinite(t.n)) return 'Choose how much to add.';
    if (t.type === 'set' && !['number', 'string',
      'boolean'].includes(typeof t.value)) return 'Choose a value: a number, some text, or true or false.';
    if (t.type === 'move' && !(Number.isFinite(t.x) && Number.isFinite(t.y))) return 'Choose where to move it to.';
    const placed = (t.x === 'random' || Number.isFinite(t.x)) && Number.isFinite(t.y);
    if (t.type === 'spawn' && !(KIND.test(t.kind ?? '') && placed)) return 'Choose what to make and where.';
    const sayable = typeof t.text === 'string' && t.text.length > 0 && t.text.length <= 80 && t.seconds > 0;
    if (t.type === 'say' && !sayable) return 'Write a short message and how long to show it.';
  }
  return null;
}

/** A rule as a plain sentence. */
export function describeRule(rule) {
  const w = rule.when;
  const who = { a: w.a ?? 'it', b: w.b ?? 'it' };
  const when = {
    touch: () => `${w.a} touches ${w.b}`, key: () => (w.mode === 'hold' ? `the ${w.key} key is held` : `the ${w.key} key is pressed`),
    every: () => `every ${w.seconds} seconds`, none: () => `no ${w.kind} is left`, score: () => `the score reaches ${w.n}`,
  }[w.type]?.() ?? 'something happens';
  const then = rule.then.map((t) => (({
    score: () => (t.add >= 0 ? `add ${t.add} to the score` : `take ${-t.add} off the score`),
    remove: () => `remove the ${who[t.who]}`,
    play: () => `play the sound ${t.sound}`,
    burst: () => `throw sparks from the ${who[t.who]}`,
    shake: () => 'shake the screen',
    add: () => `add ${t.n} to ${t.field}`,
    set: () => `set ${t.field} to ${JSON.stringify(t.value)}`,
    move: () => `move the ${who[t.who]} to ${t.x}, ${t.y}`, spawn: () => `make a ${t.kind}`, say: () => `show "${t.text}" for ${t.seconds} seconds`,
  })[t.type]?.() ?? 'do something'));
  return `When ${when}${rule.once ? ' (the first time only)' : ''}: ${then.join(', ')}.`;
}

const q = (s) => JSON.stringify(String(s));
const centre = (v) => `${v}.x + ${v}.w / 2, ${v}.y + ${v}.h / 2`;

/** The JavaScript lines for one action (`vars` says what `a` and `b` are called in this rule). */
function actionCode(t, vars) {
  switch (t.type) {
    case 'score': return `game.score += ${num(t.add)};`;
    case 'remove': return `despawn(game, ${vars[t.who]});`;
    case 'play': return `play(${q(t.sound)});`;
    case 'burst': return `burst(game, ${centre(vars[t.who])});`;
    case 'shake': return `shake(game, ${num(t.amount)});`;
    case 'add': return `game.${t.field} = (game.${t.field} ?? 0) + ${num(t.n)};`;
    case 'set': return `game.${t.field} = ${JSON.stringify(t.value)};`;
    case 'move': return `${vars[t.who]}.x = ${num(t.x)};\n${vars[t.who]}.y = ${num(t.y)};`;
    case 'spawn': {
      const x = t.x === 'random' ? 'randomBetween(game, 32, 440)' : num(t.x);
      return `spawn(game, ${q(t.kind)}, { x: ${x}, y: ${num(t.y)}, w: 24, h: 24 });`;
    }
    case 'say': return `game.say = { text: ${q(t.text)}, left: ${num(t.seconds, 2)} };`;
    default: return '';
  }
}

const indent = (text, n) => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

/** The code for one rule: a comment saying it in words, then the statements. */
export function codeFor(rule) {
  const w = rule.when;
  const id = rule.id;
  const body = rule.then.map((t) => actionCode(t, { a: 'a', b: 'b' })).join('\n');
  const once = rule.once ? `!game.rules.done${id} && ` : '';
  const mark = rule.once ? `  game.rules.done${id} = true;\n` : '';
  const guarded = (cond) => `if (${once}${cond}) {\n${mark}${indent(body, 2)}\n}`;
  let code;
  switch (w.type) {
    case 'touch': {
      const stop = rule.once ? `    if (game.rules.done${id}) break;\n` : '';
      const done = rule.once ? `    game.rules.done${id} = true;\n` : '';
      code = `for (const a of all(game, ${q(w.a)})) {\n  for (const b of overlaps(game, a, ${q(w.b)})) {\n${stop}${indent(body, 4)}\n${done}  }\n}`;
      break;
    }
    case 'key': {
      const down = `down${id}`;
      const was = `game.rules.key${id}`;
      code = w.mode === 'hold'
        ? guarded(`held(keys, ${q(w.key)})`)
        : `const ${down} = held(keys, ${q(w.key)});\n${guarded(`${down} && !${was}`)}\n${was} = ${down};`;
      break;
    }
    case 'every': code = guarded(`every(game, ${q(`rule${id}`)}, ${num(w.seconds, 1)}, dt)`); break;
    case 'none': code = guarded(`all(game, ${q(w.kind)}).length === 0`); break;
    case 'score': code = guarded(`game.score >= ${num(w.n)}`); break;
    default: code = '// (this rule is not complete)';
  }
  return `// Rule ${id}: ${clean(describeRule(rule), 200)}\n${code}`;
}

/** The whole `src/rules.js`: the rules as JSON (so the editor can read them back) and the code they make. */
export function generateModule(rules) {
  const one = (r) => {
    const why = problemWith(r);
    return why ? `// Rule ${Number.isInteger(r?.id) ? r.id : '?'} is not complete yet: ${clean(why, 120)}` : codeFor(r);
  };
  const body = rules.length ? rules.map(one).join('\n\n') : '// (no rules yet)';
  return `// Made with the studio's rules editor. Each rule says "when ... then ..."; the code under each one is exactly what it does.
// You can read it, copy it into your own code, or change it here (the editor reads the RULES list below, so keep that part as plain JSON).
import { all, overlaps, despawn, spawn, held, every, play, burst, shake, randomBetween } from '@engine/arcade';

export const RULES = ${JSON.stringify(rules, null, 2)};

/** Call this once in update: \`applyRules(game, keys, dt);\` */
export function applyRules(game, keys, dt) {
  game.rules ??= {};
  if (game.say) {
    game.say.left -= dt;
    if (game.say.left <= 0) game.say = null;
  }
${indent(body, 2)}
}

/** Call this once in render, after drawThings: \`drawRules(game, g);\` shows the messages the rules make. */
export function drawRules(game, g) {
  if (!game.say) return;
  g.fillStyle = '#ffffff';
  g.font = '24px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(game.say.text, 240, 150);
  g.textAlign = 'left';
}
`;
}

/** Read the rules back out of a rules file. Throws an Error that says what is wrong. */
export function parseRules(text) {
  const m = /export\s+const\s+RULES\s*=\s*/.exec(String(text ?? ''));
  if (!m) throw new Error('This is not a rules file: it should say "export const RULES = [ ... ];".');
  const start = m.index + m[0].length;
  if (text[start] !== '[') throw new Error('RULES must be a list in square brackets.');
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"') quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      let rules;
      try { rules = JSON.parse(text.slice(start,
        i + 1)); } catch { throw new Error('The RULES list has been edited into something the editor cannot read. Keep it as plain JSON.'); }
      if (!Array.isArray(rules) || rules.length > 60) throw new Error('RULES must be a list of at most 60 rules.');
      return rules;
    }
  }
  throw new Error('The RULES list is not closed with a ].');
}

/**
 * Add `applyRules` and `drawRules` to a game's `src/main.js`: the import, the call at the end of `update`, the call at the end of `render`. Nothing is done twice.
 * @returns {{text: string, changed: boolean, problem?: string}}
 */
export function addToGame(main) {
  let text = main;
  let changed = false;
  if (!/\bapplyRules\b/.test(text)) {
    const update = /export\s+function\s+update\s*\(([^)]*)\)\s*\{/.exec(text);
    const params = update?.[1].split(',').map((s) => s.trim()) ?? [];
    if (!update || params.length < 3) return { text: main, changed: false,
      problem: 'The game needs "export function update(game, keys, dt)" to call the rules from.' };
    const end = closingBrace(text, update.index + update[0].length - 1);
    if (end < 0) return { text: main, changed: false, problem: 'Could not find the end of update.' };
    text = `${text.slice(0, end)}  applyRules(${params[0]}, ${params[1]}, ${params[2]});\n${text.slice(end)}`;
    changed = true;
  }
  if (!/\bdrawRules\b/.test(text)) {
    const render = /export\s+function\s+render\s*\(([^)]*)\)\s*\{/.exec(text);
    const params = render?.[1].split(',').map((s) => s.trim()) ?? [];
    if (render && params.length >= 2) {
      const end = closingBrace(text, render.index + render[0].length - 1);
      if (end >= 0) { text = `${text.slice(0, end)}  drawRules(${params[0]}, ${params[1]});\n${text.slice(end)}`; changed = true; }
    }
  }
  if (!/from\s*['"]\.\/rules\.js['"]/.test(text)) {
    const imports = [...text.matchAll(/^import[\s\S]*?;\s*$/gm)];
    const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
    const line = "import { applyRules, drawRules } from './rules.js';";
    text = at === 0 ? `${line}\n${text}` : `${text.slice(0, at)}\n${line}${text.slice(at)}`;
    changed = true;
  }
  return { text, changed };
}

/** The offset of the `}` that closes the block opened at `open` (ignoring strings, template text and comments). */
function closingBrace(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return -1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
    i++;
  }
  return -1;
}
