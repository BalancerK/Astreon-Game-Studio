// The level painter's logic: finding a level in a project's code (a list of rows of letters, such as `const LEVEL = [ ... ]`), reading what each letter means from
// the legend the game gives to `loadMap`, changing tiles, resizing, and writing the rows back into the file without touching anything around them. A level
// stays what it always was: text a person can read and edit by hand.

const ARRAY = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*\[([^\]]*)\]/g;

/**
 * Find the levels in a file: lists of strings of the same length, at least three rows, that look like a level (a ground or a start letter).
 * @param {string} text
 * @returns {{name: string, rows: string[], from: number, to: number, quote: string, indent: string}[]}
 */
export function findLevels(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(ARRAY)) {
    const strings = [...m[2].matchAll(/(['"])((?:(?!\1).)*)\1/g)];
    const rows = strings.map((s) => s[2]);
    if (rows.length < 3 || rows.some((r) => r.length !== rows[0].length) || rows[0].length < 3) continue;
    if (!rows.some((r) => /[#@]/.test(r))) continue;
    const bodyStart = m.index + m[0].indexOf('[') + 1;
    const indent = /\n([ \t]*)['"]/.exec(m[2])?.[1] ?? '  ';
    found.push({ name: m[1], rows, from: bodyStart, to: bodyStart + m[2].length, quote: strings[0][1], indent });
  }
  return found;
}

/**
 * What each letter means, read from the legend given to loadMap: `{ ch, kind, color, emoji }` for every entry.
 * @param {string} text the file with the `loadMap(game, LEVEL, { ... })` call
 */
export function legendOf(text) {
  const call = /loadMap\(\s*\w+\s*,\s*[\w.]+\s*,\s*\{/.exec(text ?? '');
  if (!call) return [];
  const start = call.index + call[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return [];
  const body = text.slice(start + 1, end);
  const out = [];
  for (const m of body.matchAll(/(?:'([^'])'|"([^"])"|([A-Za-z0-9]))\s*:\s*\{([^}]*)\}/g)) {
    const props = m[4];
    const pick = (k) => new RegExp(`\\b${k}\\s*:\\s*(['"])(.*?)\\1`).exec(props)?.[2];
    const names = ['kind', 'color', 'emoji', 'sprite', 'autotile', 'terrain', 'edge'];
    const [kind, color, emoji, sprite, autotile, terrain, edge] = names.map((k) => pick(k) ?? '');
    const edgeWidth = Number(/\bedgeWidth\s*:\s*(\d+(?:\.\d+)?)/.exec(props)?.[1]) || 0;
    const openEdge = /\bopenEdge\s*:\s*true\b/.test(props);
    out.push({ ch: m[1] ?? m[2] ?? m[3], kind, color, emoji, sprite, autotile, terrain, edge, edgeWidth, openEdge });
  }
  return out;
}

/** Change one tile. Returns the same rows if nothing changes. */
export function setTile(rows, x, y, ch) {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length || rows[y][x] === ch) return rows;
  const next = [...rows];
  next[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  return next;
}

/** Fill the connected area of the same tile with a letter. */
export function fillTiles(rows, x, y, ch) {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return rows;
  const target = rows[y][x];
  if (target === ch) return rows;
  const grid = rows.map((r) => [...r]);
  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop();
    if (py < 0 || py >= grid.length || px < 0 || px >= grid[0].length || grid[py][px] !== target) continue;
    grid[py][px] = ch;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return grid.map((r) => r.join(''));
}

/** Make the level a new size, keeping what fits (from the top left) and filling the rest with `fill`. */
export function resizeRows(rows, w, h, fill = '.') {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3 || w > 300 || h > 100) return rows;
  return Array.from({ length: h }, (_, y) => (rows[y] ?? '').slice(0, w).padEnd(w, fill));
}

/** Put a letter along the edge of the level (a frame of walls). */
export function border(rows, ch) {
  return rows.map((r, y) => (y === 0 || y === rows.length - 1 ? ch.repeat(r.length) : ch + r.slice(1, -1) + ch));
}

/**
 * Write rows back into a file, in place of the list called `name`. Everything else in the file stays exactly as it was.
 * @returns {string} the new text (the same text if the level is not found)
 */
export function writeLevel(text, name, rows) {
  const level = findLevels(text).find((l) => l.name === name);
  if (!level) return text;
  const q = level.quote;
  const body = `\n${rows.map((r) => `${level.indent}${q}${r}${q},`).join('\n')}\n`;
  return text.slice(0, level.from) + body + text.slice(level.to);
}

/** Things worth telling the painter about a level before it is saved. */
export function warnings(rows) {
  const out = [];
  const count = (c) => rows.reduce((n, r) => n + [...r].filter((x) => x === c).length, 0);
  if (count('@') === 0) out.push('There is no start (@), so the hero has nowhere to begin.');
  if (count('@') > 1) out.push('There is more than one start (@).');
  if (rows.some((r) => r.length !== rows[0].length)) out.push('The rows are not all the same length.');
  return out;
}

/** Letters seen in the level that the legend does not know (loadMap would stop with a message). */
export function unknownLetters(rows, legend) {
  const known = new Set(legend.map((e) => e.ch));
  return [...new Set(rows.flatMap((r) => [...r]))].filter((c) => c !== '.' && c !== ' ' && !known.has(c));
}
