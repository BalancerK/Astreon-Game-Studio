// A little markup for words on the screen, so a line of dialogue can have a coloured or bold or leaning word in it:
//
//     "The [color=#ff6b6b]red key[/color] is [b]very[/b] old, said the [i]ghost[/i]."
//
// Tags are [b], [i] and [color=#rrggbb], each closed with [/b], [/i] and [/color]. Anything else in square brackets is just text, and a tag left open ends with the line.
// The tags are not counted as letters, so the typewriter in the dialogue box does not stop on them.

const TAG = /^\[(\/)?(b|i|color)(?:=(#[0-9a-f]{6}))?\]/i;

/**
 * Read marked-up words into one entry per visible letter.
 * @param {string} source the words with tags in them
 * @returns {Array<{c: string, color: string | null, bold: boolean, italic: boolean}>}
 */
export function parseMarkup(source) {
  const out = [];
  const colors = [];
  let bold = 0, italic = 0;
  const text = String(source ?? '');
  for (let i = 0; i < text.length;) {
    if (text[i] === '[') {
      const m = TAG.exec(text.slice(i, i + 20));
      if (m) {
        const [whole, closing, name, color] = m, tag = name.toLowerCase();
        const valid = closing ? tag === 'color' ? colors.length > 0 : (tag === 'b' ? bold : italic) > 0 : tag !== 'color' || Boolean(color);
        if (valid) {
          if (tag === 'b') bold += closing ? -1 : 1;
          else if (tag === 'i') italic += closing ? -1 : 1;
          else if (closing) colors.pop();
          else colors.push(color.toLowerCase());
          i += whole.length;
          continue;
        }
      }
    }
    out.push({ c: text[i], color: colors.length ? colors[colors.length - 1] : null, bold: bold > 0, italic: italic > 0 });
    i++;
  }
  return out;
}

/** The words with the tags taken out. @param {string} source @returns {string} */
export const stripMarkup = (source) => parseMarkup(source).map((x) => x.c).join('');

/**
 * Break marked-up words into lines that fit a width, as runs of letters that share a look.
 * @param {CanvasRenderingContext2D} g
 * @param {string} source the words, with tags
 * @param {number} width the most a line may be, in pixels
 * @param {string} font the plain font, like "16px system-ui" (bold and italic are put in front of it)
 * @returns {Array<Array<{text: string, color: string | null, bold: boolean, italic: boolean}>>} lines of runs
 */
export function layoutMarkup(g, source, width, font) {
  const chars = parseMarkup(source);
  const fontOf = (x) => `${x.italic ? 'italic ' : ''}${x.bold ? 'bold ' : ''}${font}`;
  const measure = (list) => {
    let w = 0;
    for (const run of runsOf(list)) { g.font = fontOf(run); w += g.measureText(run.text).width; }
    return w;
  };
  const lines = [];
  let line = [];
  const words = [];
  let word = [];
  for (const x of chars) {
    if (x.c === '\n') { words.push(word, null); word = []; } else if (x.c === ' ') { words.push(word); word = []; } else word.push(x);
  }
  words.push(word);
  const space = (like) => ({ ...like, c: ' ' });
  for (const w of words) {
    if (w === null) { lines.push(line); line = []; continue; }
    const joined = line.length ? [...line, space(line[line.length - 1]), ...w] : w;
    if (line.length && measure(joined) > width) { lines.push(line); line = [...w]; } else line = joined;
  }
  lines.push(line);
  return lines.map(runsOf);
}

/** Letters that share a look, joined into runs. */
function runsOf(list) {
  const runs = [];
  for (const x of list) {
    const last = runs[runs.length - 1];
    if (last && last.color === x.color && last.bold === x.bold && last.italic === x.italic) last.text += x.c;
    else runs.push({ text: x.c, color: x.color, bold: x.bold, italic: x.italic });
  }
  return runs;
}

/**
 * Draw lines made by `layoutMarkup`, showing only the first `shown` letters (all of them when left out).
 * @param {CanvasRenderingContext2D} g
 * @param {ReturnType<typeof layoutMarkup>} lines
 * @param {number} x left edge @param {number} y top of the first line @param {number} lineHeight
 * @param {{font: string, color?: string, shown?: number}} look
 * @returns {number} how many letters were drawn
 */
export function drawMarkup(g, lines, x, y, lineHeight, { font, color = '#ffffff', shown = Infinity }) {
  let left = Math.floor(shown), drawn = 0;
  for (const runs of lines) {
    let cx = x;
    for (const run of runs) {
      if (left <= 0) return drawn;
      const part = run.text.slice(0, left);
      g.font = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${font}`;
      g.fillStyle = run.color ?? color;
      g.fillText(part, cx, y);
      cx += g.measureText(part).width;
      left -= part.length;
      drawn += part.length;
    }
    left -= 1;                                                  // the space (or line break) the line ended at
    y += lineHeight;
  }
  return drawn;
}
