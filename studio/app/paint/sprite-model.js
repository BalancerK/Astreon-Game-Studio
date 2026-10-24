// The sprite painter's logic, with no page in it: a sprite as text, and everything you can do to one (paint, fill, draw a line, add frames, change the
// palette, resize, flip, move) as plain functions that return a new sprite. Undo is a list of earlier sprites. The file format is a JavaScript module that
// holds a JSON object, so a game imports it like any other file and a person can still read and edit it:
//
//   export default { "w": 4, "h": 4, "palette": { "a": "#5ac8ff" }, "frames": [ [ ".aa.", "aaaa", "aaaa", ".aa." ] ], "animations": {} };

export const MAX_SIZE = 128;
export const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const DEFAULT_COLORS = ['#1b1f2e', '#f5f0e6', '#e84a5f', '#ff9f43', '#ffd23c', '#4ade80', '#5ac8ff', '#8b8bff'];
export const ANIMATION_MODES = ['loop', 'once', 'reverse', 'pingpong'];
const EMPTY = '.';
const clone = (s) => JSON.parse(JSON.stringify(s));

/** What is wrong with a sprite, or null (the same rules the game's kit applies when it draws one). */
export function problemWith(sprite) {
  if (!sprite || typeof sprite !== 'object') return 'a sprite is an object';
  const { w, h, palette, frames, animations } = sprite;
  const size = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE;
  if (!size(w) || !size(h)) return `w and h must be whole numbers from 1 to ${MAX_SIZE}`;
  if (!palette || typeof palette !== 'object') return 'palette must be an object of letters and colours';
  for (const [k, v] of Object.entries(palette)) {
    if (k.length !== 1 || typeof v !== 'string') return `palette entry "${k}" must be one letter and a colour`;
  }
  if (!Array.isArray(frames) || !frames.length || frames.length > 256) return 'frames must be a list of at least one frame';
  for (const [i, frame] of frames.entries()) {
    if (!Array.isArray(frame) || frame.length !== h) return `frame ${i + 1} must have ${h} rows`;
    for (const [y, row] of frame.entries()) {
      if (typeof row !== 'string' || row.length !== w) return `row ${y + 1} of frame ${i + 1} must be ${w} letters long`;
      for (const ch of row) {
        if (ch !== EMPTY && ch !== ' ' && !(ch in palette)) return `frame ${i + 1}, row ${y + 1}: the letter "${ch}" is not in the palette`;
      }
    }
  }
  for (const [name, a] of Object.entries(animations ?? {})) {
    if (!a || !Array.isArray(a.frames) || !a.frames.length || a.frames.some((n) => !Number.isInteger(n) || n < 0 || n >= frames.length)) {
      return `animation "${name}" must list frame numbers that exist`;
    }
    if (!(a.fps > 0 && a.fps <= 60)) return `animation "${name}" needs fps from 1 to 60`;
    if (a.mode !== undefined && !ANIMATION_MODES.includes(a.mode)) {
      return `animation "${name}" has a mode that is not one of ${ANIMATION_MODES.join(', ')}`;
    }
  }
  return null;
}

/** A new empty sprite with a starter palette. */
export function newSprite(w = 16, h = 16, colors = DEFAULT_COLORS) {
  const palette = {};
  colors.forEach((c, i) => { palette[LETTERS[i]] = c; });
  return { w, h, palette, frames: [Array.from({ length: h }, () => EMPTY.repeat(w))], animations: {} };
}

/** The sprite as the text of a file. */
const NOTE = 'Made with the studio\'s sprite painter. Each frame is a list of rows; each letter is a colour from "palette"; a dot is see-through.';
export function serializeSprite(sprite, note = NOTE) {
  const frames = sprite.frames.map((f) => `    [\n${f.map((r) => `      ${JSON.stringify(r)}`).join(',\n')}\n    ]`).join(',\n');
  const palette = Object.entries(sprite.palette).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  const anims = Object.entries(sprite.animations ?? {}).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return `// ${note}\nexport default {\n  "w": ${sprite.w},\n  "h": ${sprite.h},\n  "palette": {\n${palette}\n  },\n  "frames": [\n${frames}\n  ],\n`
    + `  "animations": {${anims ? `\n${anims}\n  ` : ''}}\n};\n`;
}

/** Read a sprite file. Throws an Error that says what is wrong. */
export function parseSprite(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a sprite: it should say "export default { ... }".');
  let sprite;
  try {
    sprite = JSON.parse(m[1]);
  } catch {
    throw new Error('This sprite file has been edited into something the painter cannot read. Keep the part after "export default" as plain JSON.');
  }
  sprite.animations ??= {};
  const problem = problemWith(sprite);
  if (problem) throw new Error(`This sprite has a problem: ${problem}.`);
  return sprite;
}

const inside = (s, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.w && y < s.h;
const withFrame = (sprite, f, change) => {
  const next = clone(sprite);
  const rows = next.frames[f].map((r) => [...r]);
  change(rows);
  next.frames[f] = rows.map((r) => r.join(''));
  return next;
};

/** Paint one pixel with a letter ('.' erases). Returns the same sprite if nothing changes. */
export function setPixel(sprite, f, x, y, ch) {
  if (!inside(sprite, x, y) || sprite.frames[f][y][x] === ch) return sprite;
  return withFrame(sprite, f, (rows) => { rows[y][x] = ch; });
}

/** Fill the connected area of the same colour with a letter. */
export function floodFill(sprite, f, x, y, ch) {
  if (!inside(sprite, x, y)) return sprite;
  const target = sprite.frames[f][y][x];
  if (target === ch) return sprite;
  return withFrame(sprite, f, (rows) => {
    const stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop();
      if (!inside(sprite, px, py) || rows[py][px] !== target) continue;
      rows[py][px] = ch;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  });
}

/** The pixels on a straight line (Bresenham), for drawing by dragging. */
export function linePoints(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (let n = 0; n < 1000; n++) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return points;
}

/** Paint a list of pixels at once (a stroke). */
export function paintPoints(sprite, f, points, ch) {
  const live = points.filter(([x, y]) => inside(sprite, x, y) && sprite.frames[f][y][x] !== ch);
  if (!live.length) return sprite;
  return withFrame(sprite, f, (rows) => { for (const [x, y] of live) rows[y][x] = ch; });
}

/** The pixels of an outlined or filled rectangle between two corners. */
export function rectPoints(x0, y0, x1, y1, filled = false) {
  const points = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (filled || x === Math.min(x0, x1) || x === Math.max(x0, x1) || y === Math.min(y0, y1) || y === Math.max(y0, y1)) points.push([x, y]);
    }
  }
  return points;
}

/** Add a frame (a copy of frame `from`, or empty). It goes after `from`. */
export function addFrame(sprite, from = null) {
  if (sprite.frames.length >= 256) return sprite;
  const next = clone(sprite);
  const copy = from === null ? Array.from({ length: sprite.h }, () => EMPTY.repeat(sprite.w)) : [...sprite.frames[from]];
  const at = from === null ? next.frames.length : from + 1;
  next.frames.splice(at, 0, copy);
  for (const a of Object.values(next.animations)) a.frames = a.frames.map((n) => (n >= at ? n + 1 : n));
  return next;
}

/** Remove a frame (never the last one); animations lose it from their lists. */
export function deleteFrame(sprite, f) {
  if (sprite.frames.length <= 1 || f < 0 || f >= sprite.frames.length) return sprite;
  const next = clone(sprite);
  next.frames.splice(f, 1);
  for (const [name, a] of Object.entries(next.animations)) {
    a.frames = a.frames.filter((n) => n !== f).map((n) => (n > f ? n - 1 : n));
    if (!a.frames.length) delete next.animations[name];
  }
  return next;
}

/** Make the sprite a different size, keeping what fits (anchored at the top left) and filling the rest with see-through. */
export function resize(sprite, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIZE || h > MAX_SIZE) return sprite;
  const next = clone(sprite);
  next.w = w;
  next.h = h;
  next.frames = sprite.frames.map((frame) => Array.from({ length: h }, (_, y) => (frame[y] ?? '').slice(0, w).padEnd(w, EMPTY)));
  return next;
}

/** Mirror a frame left to right. */
export function flipHorizontal(sprite, f) {
  const next = clone(sprite);
  next.frames[f] = next.frames[f].map((r) => [...r].reverse().join(''));
  return next;
}

/** Slide a frame by whole pixels (what falls off one side comes back on the other). */
export function shift(sprite, f, dx, dy) {
  const next = clone(sprite);
  const rows = sprite.frames[f];
  next.frames[f] = rows.map((_, y) => {
    const src = rows[(((y - dy) % sprite.h) + sprite.h) % sprite.h];
    return [...src].map((_, x) => src[(((x - dx) % sprite.w) + sprite.w) % sprite.w]).join('');
  });
  return next;
}

/** A letter not yet in the palette, or null when all 62 are used. */
export function freeLetter(sprite) {
  return [...LETTERS].find((c) => !(c in sprite.palette)) ?? null;
}

/** Add a colour; returns the sprite and the letter it was given. */
export function addColor(sprite, color) {
  const letter = freeLetter(sprite);
  if (!letter) return { sprite, letter: null };
  const next = clone(sprite);
  next.palette[letter] = color;
  return { sprite: next, letter };
}

/** Change a colour (every pixel using the letter changes with it). */
export function setColor(sprite, letter, color) {
  if (!(letter in sprite.palette)) return sprite;
  const next = clone(sprite);
  next.palette[letter] = color;
  return next;
}

/** Remove a colour; pixels that used it become see-through. */
export function removeColor(sprite, letter) {
  if (!(letter in sprite.palette)) return sprite;
  const next = clone(sprite);
  delete next.palette[letter];
  next.frames = next.frames.map((f) => f.map((r) => [...r].map((c) => (c === letter ? EMPTY : c)).join('')));
  return next;
}

/** Which letters are used in any frame. */
export function usedLetters(sprite) {
  return new Set(sprite.frames.flatMap((f) => f.flatMap((r) => [...r])).filter((c) => c !== EMPTY && c !== ' '));
}

/** Name or replace an animation (a loop through some frames). */
export function setAnimation(sprite, name, frames, fps, mode) {
  const badFrame = (n) => !Number.isInteger(n) || n < 0 || n >= sprite.frames.length;
  if (!/^[a-z][\w-]{0,23}$/i.test(name) || !frames.length || frames.some(badFrame)) return sprite;
  if (mode !== undefined && !ANIMATION_MODES.includes(mode)) return sprite;
  const next = clone(sprite);
  const keep = mode ?? sprite.animations[name]?.mode;
  next.animations[name] = { frames: [...frames], fps: Math.max(1, Math.min(60, Math.round(fps))),
    ...(keep && keep !== 'loop' ? { mode: keep } : {}) };
  return next;
}

/** How an animation plays: `loop` (round and round), `once`, `reverse` or `pingpong`. */
export function setAnimationMode(sprite, name, mode) {
  const a = sprite.animations[name];
  if (!a || !ANIMATION_MODES.includes(mode)) return sprite;
  return setAnimation(sprite, name, a.frames, a.fps, mode);
}

/** Take an animation away. */
export function removeAnimation(sprite, name) {
  if (!(name in sprite.animations)) return sprite;
  const next = clone(sprite);
  delete next.animations[name];
  return next;
}

/** The earlier versions of a sprite, for undo and redo. */
export class History {
  /** @param {object} first @param {number} [limit] */
  constructor(first, limit = 100) {
    this.limit = limit;
    this.items = [JSON.stringify(first)];
    this.at = 0;
  }

  get current() { return JSON.parse(this.items[this.at]); }

  get canUndo() { return this.at > 0; }

  get canRedo() { return this.at < this.items.length - 1; }

  /** Record a new version (nothing is recorded if it is the same as now). */
  push(sprite) {
    const text = JSON.stringify(sprite);
    if (text === this.items[this.at]) return false;
    this.items.length = this.at + 1;
    this.items.push(text);
    if (this.items.length > this.limit) this.items.shift();
    this.at = this.items.length - 1;
    return true;
  }

  undo() { if (this.canUndo) this.at--; return this.current; }

  redo() { if (this.canRedo) this.at++; return this.current; }
}

// ---------- the palette ----------

const hexOf = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c.toLowerCase() : null);
const rgbOf = (c) => {
  const h = hexOf(c);
  return h ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : null;
};

/** How many pixels use each colour letter, over every frame. */
export function countLetters(sprite) {
  const counts = {};
  for (const f of sprite.frames) for (const r of f) for (const ch of r) if (ch !== EMPTY && ch !== ' ') counts[ch] = (counts[ch] ?? 0) + 1;
  return counts;
}

/** Every pixel of a letter becomes another letter, in every frame. */
const replaceLetter = (sprite, from, to) => sprite.frames.map((f) => f.map((r) => [...r].map((c) => (c === from ? to : c)).join('')));

/** Swap two colours: every pixel of one becomes the other and the other way round (the palette's own order stays). */
export function swapColors(sprite, a, b) {
  if (a === b || !(a in sprite.palette) || !(b in sprite.palette)) return sprite;
  const next = clone(sprite);
  next.palette[a] = sprite.palette[b];
  next.palette[b] = sprite.palette[a];
  return next;
}

/** Fold one colour into another: its pixels now use the other colour, and the colour leaves the palette. */
export function mergeColors(sprite, from, into) {
  if (from === into || !(from in sprite.palette) || !(into in sprite.palette)) return sprite;
  const next = clone(sprite);
  next.frames = replaceLetter(next, from, into);
  delete next.palette[from];
  return next;
}

/** Groups of letters whose colours are the same (the same colour written twice). Each group lists the letters, the first one is kept by `mergeDuplicates`. */
export function duplicateColors(sprite) {
  const byColor = new Map();
  for (const [k, c] of Object.entries(sprite.palette)) {
    const key = String(c).trim().toLowerCase();
    byColor.set(key, [...(byColor.get(key) ?? []), k]);
  }
  return [...byColor.values()].filter((g) => g.length > 1);
}

/** Merge every colour that is the same as an earlier one. */
export function mergeDuplicates(sprite) {
  let next = sprite;
  for (const group of duplicateColors(sprite)) for (const extra of group.slice(1)) next = mergeColors(next, extra, group[0]);
  return next;
}

/** The letters in the palette that no pixel uses. */
export function unusedColors(sprite) {
  const used = countLetters(sprite);
  return Object.keys(sprite.palette).filter((k) => !used[k]);
}

/** Take away the colours nothing uses. */
export function removeUnused(sprite) {
  const next = clone(sprite);
  for (const k of unusedColors(sprite)) delete next.palette[k];
  return next;
}

/**
 * Cut a sprite down to at most `limit` colours (counting only the ones pixels use): again and again the colour that is least used is folded into the colour nearest to it.
 * Colours that are not written as #rrggbb count as far from everything, so they are folded last.
 */
export function reduceColors(sprite, limit) {
  let next = removeUnused(sprite);
  const dist = (a, b) => {
    const x = rgbOf(next.palette[a]);
    const y = rgbOf(next.palette[b]);
    return x && y ? (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2 : 1e9;
  };
  while (Object.keys(next.palette).length > Math.max(1, limit)) {
    const counts = countLetters(next);
    const letters = Object.keys(next.palette).sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
    const from = letters[0];
    const into = letters.slice(1).reduce((best, k) => (dist(from, k) < dist(from, best) ? k : best), letters[1]);
    next = mergeColors(next, from, into);
  }
  return next;
}

/** What could be tidier about the palette, in plain words: colours written twice, colours nothing uses, and more colours than a limit (0 for no limit). */
export function paletteProblems(sprite, limit = 0) {
  const out = [];
  const dup = duplicateColors(sprite);
  const extra = dup.reduce((n, g) => n + g.length - 1, 0);
  if (dup.length) out.push(`${extra} colour${extra === 1 ? ' is' : 's are'} the same as another one.`);
  const unused = unusedColors(sprite);
  if (unused.length) out.push(`${unused.length} colour${unused.length === 1 ? ' is' : 's are'} not used by any pixel.`);
  const used = Object.keys(countLetters(sprite)).length;
  if (limit > 0 && used > limit) out.push(`The sprite uses ${used} colours; the limit is ${limit}.`);
  return out;
}
