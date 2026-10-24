// The Story panel's logic: a story is plain text (see the kit's story.js for the language) kept in `src/dialogue.js` as one block of text the game reads with `story(...)`:
//
//   export default `
//   == start ==
//   Sam: Hello!
//   `;
//
// This splits the text into nodes for the panel (and puts it back together exactly), changes them, finds where to draw each node in the graph, and turns the story's lines into
// keys for the Text panel so they can be translated. Reading the story, and judging it, is the kit's own `parseStory` and `storyProblems`, so the panel and the game agree.
import { parseStory, storyProblems } from '../../../packages/arcade/src/story.js';
import { parseText, serializeText } from './text-model.js';

export { parseStory, storyProblems };
export const NODE = /^[A-Za-z][\w-]{0,31}$/;
const HEADER = /^==\s*(\S.*?)\s*==\s*$/;

export const STARTER = `// A story is nodes. Each starts with == name ==, and the first one is "start".
// Speaker: words      a line (Speaker: is optional)
// -> words            a choice; what is indented under it happens when it is picked
// <<set trust += 1>>  <<if trust > 2>> ... <<else>> ... <<endif>>  <<goto node>>  <<do open-door>>  <<end>>
// A line can end with #name: that is the key the Text panel uses to translate it.

== start ==
Sam: Hello there! Have you seen my key?
-> Yes, here it is.
    Sam: Thank you!
    <<set trust += 1>>
    <<goto thanks>>
-> No.
    Sam: Oh dear. I will look again.
Sam: Come back if you find it.

== thanks ==
Sam: I will remember this. You have {trust} trust.
<<end>>
`;

// ---------- the file ----------

/** The story as the text of a file (a template string: backslashes, backticks and `${` are escaped so any story text is safe). */
export function serializeStoryFile(text) {
  const body = String(text).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const note = '// Made with the studio\'s Story panel. Read it with story(text), then startStory(game, \'start\') from @engine/arcade.';
  return `${note}\nexport default \`${body}\`;\n`;
}

/** Read the story out of a file. Throws an Error that says what is wrong. */
export function parseStoryFile(file) {
  const m = /export\s+default\s+`([\s\S]*)`\s*;?\s*$/.exec(String(file ?? ''));
  if (!m) throw new Error('This file is not a story: it should say export default `...` with the story between the backticks.');
  return m[1].replace(/\\(\\|`|\$\{)/g, '$1');
}

// ---------- nodes ----------

/**
 * Split a story into its nodes. What comes before the first node (comments) is kept as the preamble, so putting it together again gives back the same text.
 * @returns {{preamble: string, nodes: {name: string, body: string}[]}}
 */
export function splitNodes(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const nodes = [];
  const pre = [];
  let current = null;
  for (const line of lines) {
    const h = HEADER.exec(line.trim());
    if (h) { current = { name: h[1], body: [] }; nodes.push(current); } else if (current) current.body.push(line); else pre.push(line);
  }
  return { preamble: pre.join('\n').replace(/\n+$/, ''), nodes: nodes.map((n) => ({ name: n.name, body: n.body.join('\n').replace(/^\n+|\n+$/g,
    '') })) };
}

/** Put nodes back together as text. */
export function joinNodes({ preamble, nodes }) {
  const parts = nodes.map((n) => `== ${n.name} ==\n${n.body}`.replace(/\n+$/, ''));
  return `${preamble ? `${preamble}\n\n` : ''}${parts.join('\n\n')}\n`;
}

/** Why a node name cannot be used, or null. */
export function nameProblem(model, name) {
  if (!NODE.test(name)) return 'Use letters and numbers (and - or _), starting with a letter';
  if (model.nodes.some((n) => n.name === name)) return 'There is already a node with that name';
  return null;
}

/** A node added at the end, with a first line to change. */
export function addNode(model, name) {
  return { ...model, nodes: [...model.nodes, { name, body: 'Speaker: Something to say.' }] };
}

/** A node taken away (the `<<goto>>`s that pointed at it stay, and the panel will say so). */
export function removeNode(model, name) {
  return { ...model, nodes: model.nodes.filter((n) => n.name !== name) };
}

/** A node renamed, and every `<<goto name>>` that pointed at it follows. */
export function renameNode(model, from, to) {
  const re = new RegExp(`(<<\\s*goto\\s+)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*>>)`, 'g');
  return { ...model, nodes: model.nodes.map((n) => ({ name: n.name === from ? to : n.name, body: n.body.replace(re, `$1${to}$2`) })) };
}

/** The words of a node changed. */
export function setBody(model, name, body) {
  return { ...model, nodes: model.nodes.map((n) => (n.name === name ? { ...n, body } : n)) };
}

// ---------- the picture ----------

export const BOX = { w: 132, h: 48, gapX: 70, gapY: 22 };

/**
 * Where each node goes in the graph: columns by how many steps from "start", the ones nothing leads to in a last column. Returns the places and the arrows between them.
 */
export function layoutGraph(parsed, start = 'start') {
  const depth = {};
  if (start in parsed.nodes) {
    depth[start] = 0;
    const queue = [start];
    while (queue.length) {
      const from = queue.shift();
      for (const e of parsed.edges) if (e.from === from && !(e.to in depth)) { depth[e.to] = depth[from] + 1; queue.push(e.to); }
    }
  }
  const last = Math.max(0, ...Object.values(depth)) + 1;
  const columns = new Map();
  for (const name of parsed.order) {
    const d = name in depth ? depth[name] : last;
    columns.set(d, [...(columns.get(d) ?? []), name]);
  }
  const at = {};
  for (const [d, names] of columns) names.forEach((name, row) => { at[name] = [20 + d * (BOX.w + BOX.gapX), 20 + row * (BOX.h + BOX.gapY)]; });
  const arrows = parsed.edges.map((e) => ({ ...e, from: at[e.from], to: at[e.to] }));
  const width = 40 + (columns.size ? Math.max(...columns.keys()) + 1 : 1) * (BOX.w + BOX.gapX);
  const height = 40 + Math.max(1, ...[...columns.values()].map((c) => c.length)) * (BOX.h + BOX.gapY);
  return { at, arrows, width, height };
}

/** How many lines, choices and commands a node has (for the label on its box). */
export function summarizeNode(parsed, name) {
  const code = parsed.nodes[name]?.code ?? [];
  return { lines: code.filter((c) => c.op === 'line').length, choices: code.filter((c) => c.op === 'choice').length,
    commands: code.filter((c) => c.op === 'do').length };
}

// ---------- translating the lines ----------

/** The words of the story for the Text panel: a key (`story.<line id>`) and the words, for every line and choice. */
export function linesForTable(parsed) {
  const out = [];
  for (const name of parsed.order) {
    for (const op of parsed.nodes[name].code) {
      if (op.op === 'line') out.push({ key: `story.${op.id}`, text: op.text, node: name, speaker: op.speaker });
      if (op.op === 'choice') for (const o of op.options) out.push({ key: `story.${o.id}`, text: o.text, node: name, speaker: '' });
    }
  }
  return out;
}

/**
 * Put the story's lines into a text file's first language, under `story.<id>`, without touching a key that is already there. Returns the new file text and how many were added.
 * @param {string | null} fileText the contents of src/text.js, or null when there is none
 */
export function addLinesToTextFile(fileText, parsed) {
  let table;
  try { table = fileText ? parseText(fileText) : { en: {} }; } catch { throw new Error('src/text.js needs fixing before lines can be added to it.'); }
  const first = Object.keys(table)[0] ?? 'en';
  table[first] ??= {};
  let added = 0;
  for (const l of linesForTable(parsed)) {
    if (!(l.key in table[first])) { table[first][l.key] = l.text; added++; }
  }
  return { text: serializeText(table), added, language: first };
}
