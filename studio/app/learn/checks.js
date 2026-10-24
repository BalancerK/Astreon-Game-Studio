// What a mission can look at to decide whether the student did it: the text of the project's files, the numbers the running game reports, and a few things
// the studio saw happen. These helpers read code the way a person would ("the number after SPEED", "the rows of the level") without a full parser, and
// build the checks that missions use. A check is a function of a context and answers `{ done, note? }`: `note` is a short, kind explanation of what is still
// missing, shown when the student is close.
//
// The context:  { files: {path: text}, start: {files, summary}, summary, ok, events }
//   files    the project's text files now          start.files   the same when the mission began
//   summary  what the game reports (status bar)    start.summary the same when the mission began
//   ok       the game is running with no error     events        names of things that happened (a Set), for example 'restore-point'

/** The number a line like `const SPEED = 160;` gives to a name, or null when there is no such line. */
export function numberOf(text, name) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?(?:e\\d+)?)`).exec(text ?? '');
  return m ? Number(m[1]) : null;
}

/** The rows of a level written as `const NAME = ['...', '...']` (or `export const`), as a list of strings; null when there is no such list. */
export function rowsOf(text, name = 'LEVEL') {
  const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(text ?? '');
  if (!m) return null;
  const rows = [...m[1].matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((r) => r[2]);
  return rows.length ? rows : null;
}

/** How many times a letter appears in the rows of a level. */
export const countIn = (rows, letter) => (rows ?? []).reduce((n, row) => n + [...row].filter((c) => c === letter).length, 0);

/** The text of one function: from `export function name` to the next `export function` (or the end). */
export function functionBody(text, name) {
  const start = new RegExp(`export\\s+function\\s+${name}\\b`).exec(text ?? '');
  if (!start) return '';
  const rest = text.slice(start.index + start[0].length);
  const next = rest.search(/\nexport\s+function\b/);
  return next < 0 ? rest : rest.slice(0, next);
}

const read = (ctx, file) => ctx.files?.[file] ?? '';
const startRead = (ctx, file) => ctx.start?.files?.[file] ?? '';

/** Done when the game runs and the check passes, so unfinished or broken code never counts. */
const needsRunning = (check) => (ctx) => {
  const r = check(ctx);
  if (!r.done) return r;
  return ctx.ok ? r : { done: false, note: 'Almost: the game has a problem to fix first (see the Console).' };
};

/** The number named `name` in `file` must be at least `min` (and differ from where it started). */
export function numberAtLeast(file, name, min) {
  return needsRunning((ctx) => {
    const now = numberOf(read(ctx, file), name);
    if (now === null) return { done: false, note: `Keep the line that says ${name} = a number.` };
    if (now >= min) return { done: true };
    return { done: false, note: now === numberOf(startRead(ctx, file), name) ? '' : `${name} is ${now}: try ${min} or more.` };
  });
}

/** The number named `name` in `file` must be something other than what it was, and a sensible one (above `min`). */
export function numberChanged(file, name, min = 1) {
  return needsRunning((ctx) => {
    const now = numberOf(read(ctx, file), name);
    const before = numberOf(startRead(ctx, file), name);
    if (now === null) return { done: false, note: `Keep the line that says ${name} = a number.` };
    if (now === before) return { done: false };
    return now > min ? { done: true } : { done: false, note: `${name} is ${now}: try a number above ${min}.` };
  });
}

/** A number the game reports must have moved by at least `by` since the mission began. */
export function summaryMoved(key, by) {
  return (ctx) => {
    const now = ctx.summary?.[key];
    const before = ctx.start?.summary?.[key];
    if (typeof now !== 'number' || typeof before !== 'number') return { done: false };
    return { done: Math.abs(now - before) >= by };
  };
}

/** The game must be running without an error. */
export const running = (ctx) => ({ done: !!ctx.ok, note: ctx.ok ? '' : 'Almost: the game has a problem to fix first (see the Console).' });

/** A number the game reports must satisfy a test. */
export const summaryIs = (key, test) => (ctx) => ({ done: test(ctx.summary?.[key], ctx.summary) });

/** Something the studio saw happen (an event name, for example 'restore-point'). */
export const happened = (event) => (ctx) => ({ done: !!ctx.events?.has(event) });

/** The file must match a pattern. */
export const matches = (file, pattern, note = '') => needsRunning((ctx) => ({ done: pattern.test(read(ctx, file)), note }));

/** All of the checks must pass; the first note of a failing one is the note shown. */
export function allOf(...checks) {
  return (ctx) => {
    let note = '';
    for (const c of checks) {
      const r = c(ctx);
      if (!r.done) return { done: false, note: r.note || note };
      note = r.note || note;
    }
    return { done: true };
  };
}

/** The level rows in a file must be a valid level: one start, every row the same length, at least `columns` wide. */
export function levelIsValid(file, { name = 'LEVEL', columns = 1, minRows = 4 } = {}) {
  return (ctx) => {
    const rows = rowsOf(read(ctx, file), name);
    if (!rows || rows.length < minRows) return { done: false, note: `The level needs to stay a list of rows called ${name}.` };
    if (rows.some((r) => r.length !== rows[0].length)) return { done: false, note: 'Every row of the level must be the same length.' };
    if (countIn(rows, '@') !== 1) return { done: false, note: 'The level needs exactly one @, where the hero starts.' };
    if (rows[0].length >= columns) return { done: true };
    return { done: false, note: `The level is ${rows[0].length} tiles wide: make it at least ${columns}.` };
  };
}

/**
 * The check passes only once the game has been started again (the Run button) after the last edit. For changes that are made when the game starts, like a level
 * or the legend: until then the running game is still the old one and the change cannot be seen.
 */
export function afterRestart(check) {
  return (ctx) => {
    const r = check(ctx);
    if (!r.done) return r;
    if (ctx.events?.has('restarted')) return r;
    return { done: false, note: 'Nearly there. Now press the purple Run button above the game, so the game starts again with your change.' };
  };
}

/** One of several checks must pass. */
export function anyOf(...checks) {
  return (ctx) => {
    let note = '';
    for (const c of checks) {
      const r = c(ctx);
      if (r.done) return { done: true };
      note = note || r.note || '';
    }
    return { done: false, note };
  };
}

/** A function is called somewhere in the file, for example `patrol(`. */
export const calls = (file, name, note = '') => needsRunning((ctx) => ({ done: new RegExp(`\\b${name}\\s*\\(`).test(read(ctx, file)), note }));

/** How many characters differ between two texts (what is left when the shared start and shared end are taken away). */
export function changeSize(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let end = 0;
  while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  return Math.max(x.length, y.length) - start - end;
}

/** The levels in these files must differ from how they were when the mission began by at least `tiles` tiles in total. */
export function levelsChangedBy(specs, tiles) {
  return needsRunning((ctx) => {
    let changed = 0;
    for (const { file, name } of specs) {
      const now = rowsOf(read(ctx, file), name);
      const before = rowsOf(startRead(ctx, file), name);
      if (!now || !before) continue;
      for (let y = 0; y < Math.max(now.length, before.length); y++) {
        const a = now[y] ?? '';
        const b = before[y] ?? '';
        for (let x = 0; x < Math.max(a.length, b.length); x++) if (a[x] !== b[x]) changed++;
      }
    }
    return { done: changed >= tiles, note: changed ? `${changed} tiles changed so far: change at least ${tiles}.` : '' };
  });
}

/** The file must differ from how it was when the mission began by at least `chars` characters (anything that is still a running game). */
export function fileChanged(file, chars) {
  return needsRunning((ctx) => ({ done: changeSize(read(ctx, file), startRead(ctx, file)) >= chars }));
}

/** A function's text must differ from how it was when the mission began by at least `chars` characters. */
export function functionChanged(file, name, chars) {
  return needsRunning((ctx) => ({ done: changeSize(functionBody(read(ctx, file), name), functionBody(startRead(ctx, file), name)) >= chars }));
}

/** How many sounds a sounds file holds (the names at the first level of its object). */
export const soundNames = (text) => [...String(text ?? '').matchAll(/^ {2}"([\w-]+)":\s*\{/gm)].map((m) => m[1]);

/** How many pixels are painted in a sprite file (letters that are not dots). */
const SPRITE_ROW = /^\s+"([^"]{2,})",?$/gm;
export const paintedPixels = (text) => [...String(text ?? '').matchAll(SPRITE_ROW)]
  .reduce((n, m) => n + [...m[1]].filter((c) => c !== '.' && c !== ' ').length, 0);

const countCalls = (text, name) => (String(text ?? '').match(new RegExp(`\\b${name}\\(`, 'g')) ?? []).length;

/** A function is written more times than when the mission began (for example another `block(` line in a list of blocks). */
export function moreCalls(file, name, note = '') {
  return needsRunning((ctx) => ({ done: countCalls(read(ctx, file), name) > countCalls(startRead(ctx, file), name), note }));
}

const colours = (text) => new Set((String(text ?? '').match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []).map((c) => c.toLowerCase()));

/** A colour (written like #b04a4a) is in the file that was not in it when the mission began. */
export function newColour(file, note = '') {
  return needsRunning((ctx) => {
    const before = colours(startRead(ctx, file));
    return { done: [...colours(read(ctx, file))].some((c) => !before.has(c)), note };
  });
}
