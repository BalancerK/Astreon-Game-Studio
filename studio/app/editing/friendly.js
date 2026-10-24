// Error messages a beginner can act on. The browser's wording ("Unexpected token '}'") is exact but assumes you know what a token is; this keeps the
// original message and adds, in plain words, what it usually means and what to try, plus a "did you mean" for a misspelt name. Pure, tested in Node.

/** The distance between two words: how many single-letter changes turn one into the other (capped, since only close names are useful). */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0.5 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return Math.min(prev[b.length], cap + 1);
}

/** The closest known name to a misspelt one, or null when nothing is close enough. */
export function closest(word, candidates) {
  const cap = word.length <= 4 ? 1 : 2;
  let best = null;
  let bestDistance = cap + 0.01;
  for (const c of candidates) {
    if (c === word) continue;
    const d = editDistance(word, c, cap);
    if (d < bestDistance) { best = c; bestDistance = d; }
  }
  return best;
}

// [pattern, what it means, what to try, which group is a name to look up for "did you mean"]. $1 and $2 are the pattern's groups.
const RULES = [
  [/^Unexpected end of input/, 'The code stops before it is finished.',
    'A bracket ( [ { or a quote is probably still open. Check the end of the file and the lines above.'],
  [/^Unexpected token '?(\}|\)|\])'?/, 'There is a $1 that does not belong where it is.',
    'It may be one too many, or a line before it is missing a bracket or comma.'],
  [/^Unexpected token '?([^']*)'?/, 'The code does not make sense at "$1".',
    'Look just before it: a missing comma, bracket, or operator is the usual cause.'],
  [/^Unexpected identifier/, 'A word turned up where the code did not expect one.',
    'A comma, semicolon, or operator is probably missing just before it.'],
  [/^Unexpected string/, 'A piece of text in quotes turned up where the code did not expect it.',
    'A comma or + may be missing before it, or a quote earlier is not closed.'],
  [/^Unexpected number/, 'A number turned up where the code did not expect one.', 'A comma or operator is probably missing before it.'],
  [/^Invalid or unexpected token/, 'There is a character here that JavaScript cannot read.',
    'Look for a quote that is not closed, or a curly (smart) quote pasted from a document.'],
  [/^missing \) after argument list/i, 'A function call is missing its closing bracket, or two arguments need a comma between them.',
    'Check the line above this one too.'],
  [/^Missing initializer in const declaration/, 'A "const" needs a value right away.',
    'Write const name = value, or use let if you want to set it later.'],
  [/^Identifier '([^']+)' has already been declared/, 'You made "$1" twice in the same place.',
    'Give one of them a different name, or remove the second const/let.'],
  [/^Assignment to constant variable/, 'A const cannot be changed after it is made.', 'Change that const to let if the value needs to change.'],
  [/^(.+) is not defined/, '"$1" is not known here.', 'Check the spelling, and that it is declared or imported in this file.', 1],
  [/^(.+) is not a function/, '$1 is not a function, so it cannot be called with ( ).',
    'Check the name and what it holds. A property that holds a number or text cannot be called.'],
  [/^(.+) is not a constructor/, '$1 cannot be used with "new".', 'Only classes can. Check it is imported and spelt right.'],
  [/^Cannot read propert(?:y|ies) of (undefined|null) \(reading '([^']+)'\)/, 'Something that was $1 was asked for its "$2".',
    'The thing before ".$2" has no value yet. Check it was made, and the spelling.'],
  [/^Cannot set propert(?:y|ies) of (undefined|null) \(setting '([^']+)'\)/, 'Something that was $1 was given a value for "$2".',
    'The thing before the dot has no value yet. Check it was made first.'],
  [/^Failed to resolve module specifier '([^']+)'|^Cannot find module '([^']+)'/, 'The file or package "$1$2" could not be found.',
    'Engine packages look like @engine/math. For your own files, start with ./ and include .js.'],
  [/does not provide an export named '([^']+)'/, 'That file does not export "$1".',
    'Check the spelling in the import, and that the other file has "export" in front of it.', 1],
  [/^Maximum call stack size exceeded/, 'A function keeps calling itself and never stops.',
    'Look for a function that calls itself, and make sure something makes it stop.'],
  [/^Invalid array length/, 'An array was asked to be a size that is not allowed.', 'Check the number: it must be zero or more, and not enormous.'],
  [/^await is only valid/, '"await" can only be used inside a function marked async.', 'Put the word async before the function.'],
];

/**
 * Explain an error.
 * @param {string} message the browser's message
 * @param {string[]} [known] names that exist (declared, imported, engine), for "did you mean"
 * @returns {{message: string, text: string, hint: string, suggestion: string | null}} `text` and `hint` are empty when the message is not recognised
 */
export function explain(message, known = []) {
  const clean = String(message ?? '').replace(/^(Uncaught\s+)?(SyntaxError|ReferenceError|TypeError|RangeError|Error):\s*/, '');
  for (const [re, what, tryThis, nameGroup] of RULES) {
    const m = re.exec(clean);
    if (!m) continue;
    const fill = (t) => t.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '');
    const suggestion = nameGroup ? closest(m[nameGroup] ?? '', known ?? []) : null;
    const hint = fill(tryThis);
    return { message: clean, text: fill(what), hint: suggestion ? `Did you mean "${suggestion}"? ${hint}` : hint, suggestion };
  }
  return { message: clean, text: '', hint: '', suggestion: null };
}
