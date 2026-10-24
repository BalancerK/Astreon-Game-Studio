// Text in more than one language. The words of a game live in a table: one list of `key: words` for each language. The game asks for a key, `t('start')`, and gets the
// words in the language that is chosen. A missing word falls back to the first language (and then to the key itself in brackets, so a gap shows up on screen instead of
// crashing). Words may hold `{name}` places that `t('hello', { name: 'Sam' })` fills, and a count picks the right form for the language: with a table that has
// `"coins.one": "{n} coin"` and `"coins.other": "{n} coins"`, `t('coins', { n: 3 })` says "3 coins" (other languages have more forms: zero, two, few, many).
// Nothing here touches the page, so it works in the game's worker and in tests. The table is plain data and is made in the studio's Text panel.

/** @typedef {Object<string, Object<string, string>>} Tables language code -> (key -> words) */

const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
export const TEXT_LIMITS = { languages: 40, keys: 5000, length: 2000 };

let tables = {};
let current = '';
let base = '';
let pseudoOn = false;
let rules = new Intl.PluralRules('en');

/** The language codes in a table, the first one being the one every other falls back to. */
export const languages = () => Object.keys(tables);

/** The language now chosen ('' before `text()` is called). */
export const language = () => current;

/**
 * Give the game its words. `choice` is a language code ('fr'), or `'auto'` (the default) for the language of the player's device when the table has it, else the first
 * language. Call it once at the top of the game's file with the table you made in the Text panel.
 * @param {Tables} words
 * @param {string} [choice]
 */
export function text(words, choice = 'auto') {
  tables = {};
  for (const [code, list] of Object.entries(words ?? {})) if (list && typeof list === 'object') tables[code] = list;
  base = Object.keys(tables)[0] ?? '';
  return setLanguage(choice);
}

/** Choose the language: 'fr', 'pt-BR' (falls back to 'pt' when only that is in the table), or 'auto'. Returns the language that was chosen. */
export function setLanguage(choice = 'auto') {
  const nav = globalThis.navigator;
  const wanted = choice === 'auto' ? (nav?.languages ?? [nav?.language]).filter(Boolean) : [choice];
  current = base;
  for (const w of wanted) {
    const code = String(w).toLowerCase();
    const hit = Object.keys(tables).find((c) => c.toLowerCase() === code) ?? Object.keys(tables).find((c) => c.toLowerCase() === code.split('-')[0]);
    if (hit) { current = hit; break; }
  }
  try { rules = new Intl.PluralRules(current || 'en'); } catch { rules = new Intl.PluralRules('en'); }
  return current;
}

/** Is there a word for this key (in the chosen language or the first one)? */
export const hasWord = (key) => Boolean(tables[current]?.[key] !== undefined || tables[base]?.[key] !== undefined);

/** Turn on (or off) the stretched, accented test text that shows which words are not in the table and which are too long for their space. */
export function setPseudo(on = true) { pseudoOn = Boolean(on); }

const fill = (words, params) => String(words).replace(/\{(\w+)\}/g, (all, name) => (params && name in params ? String(params[name]) : all));

function find(key, count) {
  for (const code of [current, base]) {
    const list = tables[code];
    if (!list) continue;
    if (count !== undefined) {
      const n = Number(count);
      const forms = [...(n === 0 ? [`${key}.zero`] : []), `${key}.${rules.select(n)}`, `${key}.other`];
      const hit = forms.find((k) => k in list);
      if (hit) return list[hit];
    }
    if (key in list) return list[key];
  }
  return null;
}

/**
 * The words for a key in the chosen language. `params` fills `{name}` places; a number in `params.n` (or `params.count`) picks the plural form.
 * @param {string} key
 * @param {Object<string, string | number>} [params]
 */
export function t(key, params) {
  const count = params?.n ?? params?.count;
  const found = find(key, count);
  if (found === null) return `⟦${key}⟧`;
  return fill(pseudoOn ? pseudo(found) : found, count !== undefined && !('n' in params) ? { ...params, n: count } : params);
}

const FROM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TO = 'áƀçðéƒĝĥíĵķļṁñöƥɋŕšŧüṽŵẋýžÁƁÇÐÉƑĜĤÍĴĶĻṀÑÖƤɊŔŠŦÜṼŴẊÝŽ';

/**
 * Test text: every letter becomes an accented one, the words grow by about a third (other languages are often longer) and sit in brackets, so a word that does not fit
 * its space, or a font that lacks accents, is seen at once. `{name}` places are left alone.
 * @param {string} words
 */
export function pseudo(words) {
  let out = '';
  let place = false;
  for (const ch of String(words)) {
    if (ch === '{') place = true;
    const at = FROM.indexOf(ch);
    out += place || at < 0 ? ch : TO[at];
    if (ch === '}') place = false;
  }
  const letters = [...String(words).replace(/\{\w+\}/g, '')].filter((c) => /\w/.test(c)).length;
  return `[${out}${'~'.repeat(Math.ceil(letters / 3))}]`;
}

/** The key a plural form belongs to: 'coins.one' and 'coins.other' are both 'coins'. */
export const baseKey = (key) => key.replace(new RegExp(`\\.(${FORMS.join('|')})$`), '');

/**
 * Look over a table and say what is wrong or missing, in plain words. For every language after the first: keys it lacks, keys it has that the first does not, `{places}`
 * that differ from the first language's, and words identical to the first language's (probably not translated yet); for any language, words that are empty or too long.
 * @param {Tables} words
 * @returns {{language: string, key: string, kind: 'missing' | 'extra' | 'places' | 'empty' | 'same' | 'long', message: string}[]}
 */
export function textProblems(words) {
  const out = [];
  const add = (language, key, kind, message) => out.push({ language, key, kind, message });
  const codes = Object.keys(words ?? {});
  const places = (list) => [...new Set(list.flatMap((v) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');
  /** key group -> its words (the plural forms of one key are one group, since languages differ in how many forms they have) */
  const groups = (list) => {
    const g = new Map();
    for (const [key, value] of Object.entries(list ?? {})) g.set(baseKey(key), [...(g.get(baseKey(key)) ?? []), value]);
    return g;
  };
  const first = groups(words[codes[0]]);
  for (const code of codes) {
    for (const [key, value] of Object.entries(words[code] ?? {})) {
      if (typeof value !== 'string' || value.length > TEXT_LIMITS.length) add(code, key, 'long', `"${key}" in ${code} is not text, or is over ${TEXT_LIMITS.length} letters.`);
      else if (!value.trim()) add(code, key, 'empty', `"${key}" in ${code} is empty.`);
    }
    if (code === codes[0]) continue;
    const mine = groups(words[code]);
    for (const [key, values] of first) {
      const own = mine.get(key);
      if (!own) { add(code, key, 'missing', `${code} has no words for "${key}".`); continue; }
      if (own.length === 1 && values.length === 1 && own[0] === values[0] && /[a-z]{3}/i.test(String(values[0]))) {
        add(code, key, 'same', `"${key}" in ${code} is the same as in ${codes[0]}. Not translated yet?`);
      } else if (places(own) !== places(values)) {
        add(code, key, 'places', `"${key}" in ${code} has different {places} from ${codes[0]}: it must keep ${places(values) || 'none'}.`);
      }
    }
    for (const key of mine.keys()) if (!first.has(key)) add(code, key, 'extra', `${code} has "${key}", which ${codes[0]} does not.`);
  }
  return out;
}
