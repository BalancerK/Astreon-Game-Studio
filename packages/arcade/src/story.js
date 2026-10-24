// Stories and dialogue, written as plain text, the way a writer would:
//
//   == start ==
//   Sam: Hello there! Have you seen my key?
//   -> Yes, here it is.
//       Sam: Thank you!
//       <<set trust += 1>>
//       <<goto thanks>>
//   -> No.
//       Sam: Oh dear.
//   -> I will not say. <<if trust > 2>>
//       Sam: You are a good friend.
//   <<do open-door>>
//   Sam: Come in, then.
//
//   == thanks ==
//   Sam: I will remember this. #line:thanks-1
//   <<end>>
//
// A node starts with `== name ==`. A line is `Speaker: words` (or just words). `->` makes a choice, and what is indented under it happens when the player picks it. Commands are
// `<<set name = value>>` (also `+=` `-=` `*=`), `<<if a > 3 and b>>` ... `<<elseif>>` ... `<<else>>` ... `<<endif>>`, `<<goto node>>`, `<<do name args>>` (something for the game to do:
// open a door) and `<<end>>`. A line can have a tag `#name` at the end: that is its id, used to translate it (the text table's key `story.name`); a line without one gets an id from its
// node and its place. `{name}` in words shows a number of the story. Nothing is evaluated as code: conditions are a small safe language of their own.
//
//   story(text);                              // once: reads the story and tells you what is wrong with it
//   startStory(game, 'start');                // when the talk begins
//   stepStory(game, keys, mouse, dt);         // every tick while it is on: Enter or a click goes on, arrows and numbers choose
//   drawStory(g, game);                       // every frame, over the game
//   for (const c of takeStoryCommands(game)) if (c.name === 'open-door') ...        // what the story asked the game to do
//
// The state of the story is plain data in the game (`game.story`), so saving, rewinding and recordings work.
import { t as word, hasWord } from './text.js';
import { getSetting } from './settings.js';
import { screen } from './screen.js';

export const STORY_LIMITS = { nodes: 200, lines: 5000, steps: 10_000, name: 32, text: 400 };
const NODE_NAME = /^[A-Za-z][\w-]{0,31}$/;
const TAG = /\s#([A-Za-z0-9_:.-]{1,40})\s*$/;
const SPEAKER = /^([A-Za-z][\w ]{0,23}):\s+(\S.*)$/;

// ---------- conditions: a tiny safe language ----------

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$.]*)|(==|!=|<=|>=|&&|\|\||[<>()!+\-*/]))/gy;
  let m;
  let at = 0;
  while (at < src.length && (m = re.exec(src)) !== null) {
    at = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) out.push({ t: 'id', v: m[3] });
    else out.push({ t: 'op', v: m[4] });
  }
  if (src.slice(at).trim() !== '') throw new Error(`I do not understand "${src.slice(at).trim().slice(0, 20)}" in "${src.trim().slice(0, 40)}".`);
  return out;
}

/** Read an expression (`coins > 2 and not met`) into a tree. Throws an Error that says what is wrong. */
export function parseExpression(src) {
  const toks = tokenize(src.replace(/\bnot\b/g, '!').replace(/\band\b/g, '&&').replace(/\bor\b/g, '||'));
  let i = 0;
  const peek = () => toks[i];
  const eat = (v) => { if (peek()?.t === 'op' && peek().v === v) { i++; return true; } return false; };
  const level = (ops, next) => () => {
    let left = next();
    while (peek()?.t === 'op' && ops.includes(peek().v)) { const op = toks[i++].v; left = { t: 'bin', op, a: left, b: next() }; }
    return left;
  };
  function primary() {
    const k = toks[i++];
    if (!k) throw new Error(`The condition "${src.trim().slice(0, 40)}" ends too soon.`);
    if (k.t === 'num' || k.t === 'str') return { t: 'lit', v: k.v };
    if (k.t === 'id') return k.v === 'true' ? { t: 'lit', v: true } : k.v === 'false' ? { t: 'lit', v: false } : { t: 'var', name: k.v };
    if (k.t === 'op' && k.v === '(') { const e = or(); if (!eat(')')) throw new Error(`A bracket is not closed in "${src.trim().slice(0, 40)}".`); return e; }
    if (k.t === 'op' && (k.v === '!' || k.v === '-')) return { t: 'un', op: k.v, a: primary() };
    throw new Error(`I did not expect "${k.v}" in "${src.trim().slice(0, 40)}".`);
  }
  const mul = level(['*', '/'], primary);
  const add = level(['+', '-'], mul);
  const cmp = level(['<', '<=', '>', '>='], add);
  const eq = level(['==', '!='], cmp);
  const and = level(['&&'], eq);
  const or = level(['||'], and);
  const tree = or();
  if (i < toks.length) throw new Error(`I did not expect "${toks[i].v}" in "${src.trim().slice(0, 40)}".`);
  return tree;
}

/** The value of an expression with the story's variables. */
export function evaluate(node, vars) {
  switch (node.t) {
    case 'lit': return node.v;
    case 'var': return vars[node.name];
    case 'un': return node.op === '!' ? !evaluate(node.a, vars) : -evaluate(node.a, vars);
    default: {
      const a = evaluate(node.a, vars);
      if (node.op === '&&') return a && evaluate(node.b, vars);
      if (node.op === '||') return a || evaluate(node.b, vars);
      const b = evaluate(node.b, vars);
      switch (node.op) {
        case '==': return a === b || (a === undefined && b === 0) || (a === undefined && b === false);
        case '!=': return !(a === b || (a === undefined && b === 0) || (a === undefined && b === false));
        case '<': return (a ?? 0) < (b ?? 0);
        case '<=': return (a ?? 0) <= (b ?? 0);
        case '>': return (a ?? 0) > (b ?? 0);
        case '>=': return (a ?? 0) >= (b ?? 0);
        case '+': return typeof a === 'string' || typeof b === 'string' ? `${a ?? ''}${b ?? ''}` : (a ?? 0) + (b ?? 0);
        case '-': return (a ?? 0) - (b ?? 0);
        case '*': return (a ?? 0) * (b ?? 0);
        case '/': return b ? (a ?? 0) / b : 0;
        default: return undefined;
      }
    }
  }
}

const varsIn = (node, into = new Set()) => {
  if (node.t === 'var') into.add(node.name);
  else if (node.a) { varsIn(node.a, into); if (node.b) varsIn(node.b, into); }
  return into;
};

// ---------- reading the text ----------

/**
 * Read a story into instructions for each node, with everything wrong with it.
 * @param {string} text
 * @returns {{nodes: Object<string, {code: object[], ids: string[]}>, order: string[], problems: {line: number, node: string, kind: string, message: string}[], edges: {from: string, to: string, label: string}[], sets: string[], reads: string[]}}
 */
export function parseStory(text) {
  const problems = [];
  const nodes = {};
  const order = [];
  const edges = [];
  const sets = new Set();
  const reads = new Set();
  const problem = (line, node, kind, message) => problems.push({ line, node, kind, message });
  const rows = String(text ?? '').replace(/\r/g, '').split('\n');
  const groups = [];
  let current = null;
  rows.forEach((raw, index) => {
    const n = index + 1;
    const clean = raw.replace(/\s+$/, '');
    const body = clean.trim();
    if (!body || body.startsWith('//')) return;
    const header = /^==\s*(\S.*?)\s*==$/.exec(body);
    if (header) {
      const name = header[1];
      if (!NODE_NAME.test(name)) { problem(n, name, 'name', `"${name.slice(0, 32)}" is not a usable node name (letters, numbers, - and _, starting with a letter).`); current = null; return; }
      if (name in nodes) { problem(n, name, 'duplicate', `There are two nodes called "${name}".`); current = null; return; }
      current = { name, rows: [] };
      nodes[name] = { code: [], ids: [] };
      order.push(name);
      groups.push(current);
      return;
    }
    if (!current) { problem(n, '', 'outside', 'This line is not inside a node. Start with == start ==.'); return; }
    const indent = clean.length - clean.trimStart().length;
    current.rows.push({ n, indent: raw.startsWith('\t') ? indent * 4 : indent, text: body });
  });
  if (order.length > STORY_LIMITS.nodes) problem(1, '', 'size', `At most ${STORY_LIMITS.nodes} nodes.`);

  for (const group of groups) {
    const { name } = group;
    const code = nodes[name].code;
    const ids = nodes[name].ids;
    const lines = group.rows;
    let at = 0;
    let counter = 0;
    const used = new Set();
    const idFor = (tagged) => {
      counter++;
      const id = tagged ? tagged.replace(/^line:/, '') : `${name}.${counter}`;
      if (used.has(id)) problem(0, name, 'id', `The line id "${id}" is used twice.`);
      used.add(id);
      ids.push(id);
      return id;
    };
    const cond = (src, n) => {
      try { const tree = parseExpression(src); for (const v of varsIn(tree)) reads.add(v); return tree; } catch (error) { problem(n, name, 'condition', error.message); return { t: 'lit', v: true }; }
    };
    const isMarker = (t) => /^<<\s*(else|elseif\b.*|endif)\s*>>$/.test(t);

    function block(minIndent) {
      while (at < lines.length) {
        const L = lines[at];
        if (isMarker(L.text)) return;
        if (L.indent < minIndent) return;
        if (L.text.startsWith('->')) { choices(L.indent); continue; }
        at++;
        const cmd = /^<<\s*(\w+)\s*(.*?)\s*>>$/.exec(L.text);
        if (!cmd) { plain(L); continue; }
        const [, kind, rest] = cmd;
        if (kind === 'set') {
          const m = /^([A-Za-z_$][\w$]*)\s*(=|\+=|-=|\*=)\s*(.+)$/.exec(rest);
          if (!m) { problem(L.n, name, 'command', `<<set>> needs a name, an = and a value: <<set coins = 0>>.`); continue; }
          sets.add(m[1]);
          if (m[2] !== '=') reads.add(m[1]);
          code.push({ op: 'set', name: m[1], how: m[2], expr: cond(m[3], L.n), line: L.n });
        } else if (kind === 'goto') {
          if (!rest) { problem(L.n, name, 'command', '<<goto>> needs the name of a node.'); continue; }
          code.push({ op: 'goto', node: rest, line: L.n });
          edges.push({ from: name, to: rest, label: currentOption });
        } else if (kind === 'do') {
          const [cmdName, ...args] = rest.split(/\s+/).filter(Boolean);
          if (!cmdName) { problem(L.n, name, 'command', '<<do>> needs a name: <<do open-door>>.'); continue; }
          code.push({ op: 'do', name: cmdName, args, line: L.n });
        } else if (kind === 'end') code.push({ op: 'end', line: L.n });
        else if (kind === 'if') conditional(L, rest);
        else problem(L.n, name, 'command', `<<${kind}>> is not a command (they are: set, if, elseif, else, endif, goto, do, end).`);
      }
    }

    function plain(L) {
      const tag = TAG.exec(L.text);
      const body = tag ? L.text.slice(0, tag.index) : L.text;
      const sp = SPEAKER.exec(body);
      for (const m of body.matchAll(/\{([A-Za-z_$][\w$.]*)\}/g)) reads.add(m[1]);
      if ((sp ? sp[2] : body).length > STORY_LIMITS.text) problem(L.n, name, 'long', `This line is longer than ${STORY_LIMITS.text} letters.`);
      code.push({ op: 'line', speaker: sp ? sp[1] : '', text: sp ? sp[2] : body, id: idFor(tag?.[1]), line: L.n });
    }

    function conditional(first, firstCond) {
      const jumps = [];
      let pendingFalse = null;
      let test = cond(firstCond, first.n);
      for (;;) {
        pendingFalse = { op: 'ifnot', expr: test, to: -1, line: first.n };
        code.push(pendingFalse);
        block(0);
        const marker = lines[at];
        if (!marker || !isMarker(marker.text)) { problem(first.n, name, 'endif', '<<if>> is never closed with <<endif>>.'); pendingFalse.to = code.length; break; }
        at++;
        if (/^<<\s*endif/.test(marker.text)) { pendingFalse.to = code.length; break; }
        jumps.push({ op: 'jump', to: -1 });
        code.push(jumps[jumps.length - 1]);
        pendingFalse.to = code.length;
        if (/^<<\s*else\s*>>/.test(marker.text)) {
          block(0);
          const end = lines[at];
          if (!end || !/^<<\s*endif/.test(end.text)) problem(marker.n, name, 'endif', '<<else>> is never closed with <<endif>>.'); else at++;
          break;
        }
        test = cond(/^<<\s*elseif\s+(.*?)\s*>>$/.exec(marker.text)?.[1] ?? 'false', marker.n);
      }
      for (const j of jumps) j.to = code.length;
    }

    let currentOption = '';
    function choices(indent) {
      const options = [];
      const choice = { op: 'choice', options, after: -1, line: lines[at].n };
      code.push(choice);
      const joins = [];
      while (at < lines.length && lines[at].indent === indent && lines[at].text.startsWith('->')) {
        const L = lines[at++];
        let body = L.text.slice(2).trim();
        const guard = /\s*<<\s*if\s+(.*?)\s*>>\s*$/.exec(body);
        if (guard) body = body.slice(0, guard.index);
        const tag = TAG.exec(body);
        if (tag) body = body.slice(0, tag.index);
        if (!body) problem(L.n, name, 'choice', 'This choice has no words.');
        for (const m of body.matchAll(/\{([A-Za-z_$][\w$.]*)\}/g)) reads.add(m[1]);
        const option = { text: body, id: idFor(tag?.[1]), if: guard ? cond(guard[1], L.n) : null, to: code.length };
        options.push(option);
        const outer = currentOption;
        currentOption = body;
        block(indent + 1);
        currentOption = outer;
        joins.push({ op: 'jump', to: -1 });
        code.push(joins[joins.length - 1]);
      }
      choice.after = code.length;
      for (const j of joins) j.to = code.length;
    }

    block(0);
    while (at < lines.length) {                                  // a stray <<else>> or <<endif>>
      problem(lines[at].n, name, 'endif', `${lines[at].text} has no <<if>> before it.`);
      at++;
      block(0);
    }
  }

  for (const e of edges) if (!(e.to in nodes)) problem(0, e.from, 'goto', `A <<goto ${e.to}>> in "${e.from}" points at a node that is not there.`);
  return { nodes, order, problems, edges: edges.filter((e) => e.to in nodes), sets: [...sets], reads: [...reads] };
}

/**
 * Look a parsed story over: what could not be read, nodes nothing leads to, variables that are asked about but never set (probably a typo), nodes with nothing in them, and a
 * node that only sends you to itself.
 */
export function storyProblems(parsed, start = 'start') {
  const out = [...parsed.problems];
  const add = (node, kind, message) => out.push({ line: 0, node, kind, message });
  if (parsed.order.length && !(start in parsed.nodes)) add('', 'start', `There is no node called "${start}", which is where a story begins.`);
  const reach = new Set(start in parsed.nodes ? [start] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of parsed.edges) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); grew = true; }
  }
  for (const name of parsed.order) {
    if (!reach.has(name) && name !== start) add(name, 'unreachable', `Nothing leads to "${name}".`);
    const code = parsed.nodes[name].code;
    if (!code.length) add(name, 'empty', `"${name}" has nothing in it.`);
    else if (code.every((c) => c.op === 'goto' && c.node === name)) add(name, 'loop', `"${name}" only sends you back to itself.`);
  }
  const set = new Set(parsed.sets);
  for (const v of parsed.reads) if (!set.has(v) && !v.includes('.')) add('', 'variable', `"${v}" is asked about but never set in the story. A typo, or set by the game?`);
  return out;
}

// ---------- running it ----------

let story_ = { nodes: {}, order: [], problems: [], edges: [], sets: [], reads: [] };

/** Read a story and keep it for `startStory`. Returns what is wrong with it (an empty list when it is fine). */
export function story(text) {
  story_ = parseStory(text);
  return storyProblems(story_);
}

const fresh = (node, vars) => ({
  node, pc: 0, vars: { ...vars }, line: null, choices: null, ended: false, commands: [], focus: 0, shown: 0, prev: [], armed: false, error: '',
});

function run(game) {
  const st = game.story;
  st.line = null;
  st.choices = null;
  st.shown = 0;
  st.focus = 0;
  for (let steps = 0; steps < STORY_LIMITS.steps; steps++) {
    const node = story_.nodes[st.node];
    if (!node) { st.ended = true; st.error = `There is no node called "${st.node}".`; return; }
    const op = node.code[st.pc];
    if (!op) { st.ended = true; return; }
    switch (op.op) {
      case 'line': st.line = { speaker: op.speaker, text: op.text, id: op.id }; st.pc++; return;
      case 'choice': {
        const shown = op.options.map((o, index) => ({ o, index })).filter(({ o }) => !o.if || evaluate(o.if, st.vars));
        if (!shown.length) { st.pc = op.after; break; }
        st.choices = shown.map(({ o, index }) => ({ text: o.text, id: o.id, index }));
        return;
      }
      case 'set': {
        const v = evaluate(op.expr, st.vars);
        const was = st.vars[op.name];
        st.vars[op.name] = op.how === '=' ? v : op.how === '+=' ? (typeof was === 'string' || typeof v === 'string' ? `${was ?? ''}${v}` : (was ?? 0) + v) : op.how === '-=' ? (was ?? 0) - v : (was ?? 0) * v;
        st.pc++;
        break;
      }
      case 'jump': st.pc = op.to; break;
      case 'ifnot': st.pc = evaluate(op.expr, st.vars) ? st.pc + 1 : op.to; break;
      case 'goto': st.node = op.node; st.pc = 0; break;
      case 'do': st.commands.push({ name: op.name, args: op.args }); st.pc++; break;
      case 'end': st.ended = true; return;
      default: st.pc++;
    }
  }
  st.ended = true;
  st.error = 'The story went round and round without saying anything, so it was stopped.';
}

/**
 * Begin a story at a node.
 * @param {object} game
 * @param {string} [node]
 * @param {Object<string, number | string | boolean>} [vars] starting values (a number the game knows, such as `coins`)
 */
export function startStory(game, node = 'start', vars = {}) {
  game.story = fresh(node, vars);
  run(game);
}

/** What the story is saying now: `{ line: {speaker, text, id} | null, choices: [{text, id, index}] | null, ended, node }`. The words are translated and filled in. */
export function storyState(game) {
  const st = game.story;
  if (!st) return { line: null, choices: null, ended: true, node: '' };
  const say = (id, text) => { const raw = hasWord(`story.${id}`) ? word(`story.${id}`) : text; return raw.replace(/\{([A-Za-z_$][\w$.]*)\}/g, (all, n) => (n in st.vars ? String(st.vars[n]) : n in game ? String(game[n]) : all)); };
  return {
    line: st.line ? { ...st.line, text: say(st.line.id, st.line.text) } : null,
    choices: st.choices ? st.choices.map((c) => ({ ...c, text: say(c.id, c.text) })) : null,
    ended: st.ended, node: st.node,
  };
}

/** Go on from a line (nothing happens while a choice is waiting). */
export function advanceStory(game) {
  const st = game.story;
  if (!st || st.ended || st.choices) return;
  run(game);
}

/** Pick one of the choices on offer (by its place in the list shown). */
export function chooseStory(game, index) {
  const st = game.story;
  if (!st?.choices || !st.choices[index]) return;
  const node = story_.nodes[st.node];
  const op = node.code[st.pc];
  st.pc = op.options[st.choices[index].index].to;
  run(game);
}

/** The story's own numbers and flags (`trust`, `hasKey`): read one from the game. */
export const storyVar = (game, name) => game.story?.vars[name];

/** Set one of the story's numbers or flags from the game (the story can then ask about it with `<<if hasKey>>`). */
export function setStoryVar(game, name, value) {
  if (game.story) game.story.vars[name] = value;
}

/** What the story has asked the game to do (`<<do open-door>>`), once: the list is emptied. */
export function takeStoryCommands(game) {
  const st = game.story;
  if (!st) return [];
  return st.commands.splice(0);
}

/** Is a story going? */
export const storyActive = (game) => Boolean(game.story) && !game.story.ended;

// ---------- the dialogue box ----------

const SPEED = 45;                                          // letters a second

/**
 * Handle one tick: Enter, Space or a click finishes the line being typed, then goes on; the arrow keys and the number keys choose.
 * @param {object} game
 * @param {Set<string>} keys
 * @param {{clicked?: boolean}} [mouse]
 * @param {number} [dt]
 */
export function stepStory(game, keys, mouse, dt = 1 / 60) {
  const st = game.story;
  if (!st || st.ended) return;
  const before = new Set(st.prev);
  st.prev = [...keys];
  const pressed = (c) => keys.has(c) && !before.has(c);
  const state = storyState(game);
  if (!st.armed) { st.armed = true; return; }
  if (state.choices) {
    if (pressed('ArrowUp')) st.focus = (st.focus + state.choices.length - 1) % state.choices.length;
    if (pressed('ArrowDown')) st.focus = (st.focus + 1) % state.choices.length;
    for (let n = 1; n <= Math.min(9, state.choices.length); n++) if (pressed(`Digit${n}`)) { chooseStory(game, n - 1); return; }
    if (pressed('Enter') || pressed('Space') || mouse?.clicked) chooseStory(game, st.focus);
    return;
  }
  if (!state.line) return;
  const total = state.line.text.length;
  if (st.shown < total) {
    st.shown = Math.min(total, st.shown + dt * SPEED);
    if (pressed('Enter') || pressed('Space') || mouse?.clicked) st.shown = total;
    return;
  }
  if (pressed('Enter') || pressed('Space') || mouse?.clicked) advanceStory(game);
}

function wrap(g, text, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (line && g.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Draw the dialogue box at the bottom of the screen (the speaker, the words as they are typed, and the choices), as big as the player's text size says. */
export function drawStory(g, game, { size = screen() } = {}) {
  const st = game.story;
  if (!st || st.ended) return;
  const state = storyState(game);
  const px = Math.round(16 * getSetting('textScale'));
  const contrast = getSetting('highContrast');
  g.save();
  g.font = `${px}px system-ui, sans-serif`;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  const pad = 12;
  const width = size.width - 24;
  const textLines = state.line ? wrap(g, state.line.text.slice(0, Math.floor(st.shown)), width - pad * 2) : [];
  const full = state.line ? wrap(g, state.line.text, width - pad * 2) : [];
  const options = state.choices ?? [];
  const rows = Math.max(full.length, textLines.length) + options.length;
  const height = pad * 2 + (state.line?.speaker ? px + 4 : 0) + rows * (px + 4);
  const top = size.height - height - 10;
  g.fillStyle = contrast ? '#000000' : 'rgba(18,22,31,0.94)';
  g.fillRect(12, top, width, height);
  g.strokeStyle = contrast ? '#ffffff' : '#8b8bff';
  g.lineWidth = 1.5;
  g.strokeRect(12.5, top + 0.5, width - 1, height - 1);
  let y = top + pad;
  if (state.line?.speaker) { g.fillStyle = contrast ? '#ffd23c' : '#ffd23c'; g.fillText(state.line.speaker, 12 + pad, y); y += px + 4; }
  g.fillStyle = '#ffffff';
  for (const line of textLines) { g.fillText(line, 12 + pad, y); y += px + 4; }
  if (state.line && st.shown >= state.line.text.length) { g.fillStyle = '#8b8bff'; g.textAlign = 'right'; g.fillText('▼', 12 + width - pad, top + height - pad - px); g.textAlign = 'left'; }
  options.forEach((o, i) => {
    g.fillStyle = i === st.focus ? '#ffd23c' : '#ffffff';
    g.fillText(`${i === st.focus ? '▶' : ' '} ${i + 1}. ${o.text}`, 12 + pad, y);
    y += px + 4;
  });
  g.restore();
}
