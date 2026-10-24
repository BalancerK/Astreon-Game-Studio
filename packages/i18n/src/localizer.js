// The words of a game in more than one language. A `Localizer` holds a table per language, picks the right plural form for a count, tells apart the same word
// used in two ways (a context), reads translators' `.po` and `.csv` files, falls back from `pt-BR` to `pt` to the default language, and can mark every string
// so a missing translation or a layout that cannot take longer words shows up while you play. It is an object, not a global, so a server can hold one per player.
import { parsePo, parseCsv, toCsv } from './formats.js';
import { parsePluralForms, cldrRules } from './plural.js';

/** The separator gettext puts between a context and a word (the "end of transmission" character). */
export const CONTEXT_SEPARATOR = '\u0004';

/** The stored name of a word in a context. */
export const entryKey = (key, context) => (context ? `${context}${CONTEXT_SEPARATOR}${key}` : key);

const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const FORM_SUFFIX = new RegExp(`\\.(${FORMS.join('|')})$`);

// letters that look like themselves with a mark on, so pseudo-text stays readable
const ACCENTS = { a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ĺ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ĺ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ü', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž' };

/**
 * Make text look foreign but readable ("Start game" becomes "[Šţáŕţ ĝáɱé ~~~]"): letters get accents, the text grows by about a third (German and Finnish do),
 * and the whole is bracketed so cut-off text shows. `{placeholders}` are left alone.
 * @param {string} text
 */
export function pseudoLocalize(text) {
  let out = '', letters = 0, depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    if (depth === 0) { const a = ACCENTS[ch]; if (a) { out += a; letters++; continue; } }
    out += ch;
    if (ch === '}' && depth > 0) depth--;
  }
  return `[${out}${letters > 2 ? ` ${'~'.repeat(Math.ceil(letters / 3))}` : ''}]`;
}

/**
 * What a word can be in a table: plain text, a list of forms in the language's plural order (what gettext files give), or the forms by name.
 * @typedef {string | string[] | Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>>} Entry
 */

/** @typedef {{ language?: string, fallback?: string, pseudo?: boolean, missing?: 'key' | 'brackets', onMissing?: (language: string, key: string, context: string | null) => void }} LocalizerOptions */

/**
 * The words of a game in several languages: `add` tables (or `addPo` / `addCsv` files), `setLanguage`, then `t`, `tn` (with a count), `tc` and `tcn` (in a context).
 * Falls back from `pt-BR` to `pt` to the default language, reports missing words, and can pseudo-localise.
 */
export class Localizer {
  /**
   * @param {LocalizerOptions} [o]
   * @param {string} [o.language] The language to show ('' until `setLanguage`). @param {string} [o.fallback] The language to use for words the chosen one lacks (the first one added).
   * @param {boolean} [o.pseudo] Show every string as pseudo-text. @param {'key' | 'brackets'} [o.missing] What a word that is nowhere shows: the key itself (default, like gettext) or `[key]`.
   * @param {Function} [o.onMissing] Called once for each word that could not be found (language, key, context): log it or collect it.
   */
  constructor({ language = '', fallback = '', pseudo = false, missing = 'key', onMissing = null } = {}) {
    /** @type {Map<string, Map<string, Entry>>} */ this.tables = new Map();
    /** @type {Map<string, { count: number, index: (n: number) => number }>} */ this.plurals = new Map();
    this.fallback = fallback;
    this.language = '';
    this.pseudo = pseudo;
    this.missingStyle = missing;
    this.onMissing = onMissing;
    /** Called with the new language code after `setLanguage`. */
    this.onChange = null;
    this._reported = new Set();
    this._cldr = new Map();
    if (language) this.language = language;
  }

  /** The language codes that have words. */
  get languages() { return [...this.tables.keys()]; }

  /**
   * Add words for a language. Keys may carry a context after `\u0004` (see `entryKey`); `thing.one` / `thing.other` keys are joined into one word with forms
   * (so a table written for the arcade kit works). Later calls replace earlier words.
   * @param {string} language @param {Record<string, Entry>} entries @returns {this}
   */
  add(language, entries) {
    if (!language) throw new Error('add(language, entries): say which language the words are for');
    let table = this.tables.get(language);
    if (!table) { table = new Map(); this.tables.set(language, table); if (!this.fallback) this.fallback = language; }
    for (const [key, value] of Object.entries(entries ?? {})) {
      const m = FORM_SUFFIX.exec(key);
      if (m && typeof value === 'string') {
        const base = key.slice(0, m.index);
        const cur = table.get(base);
        const forms = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
        forms[m[1]] = value;
        table.set(base, forms);
      } else table.set(key, value);
    }
    return this;
  }

  /** Add one word, optionally in a context. @returns {this} */
  addEntry(language, key, value, context = null) { return this.add(language, { [entryKey(key, context)]: value }); }

  /**
   * Say how many forms a language has and which one a count uses, as a function or a gettext rule (`'nplurals=2; plural=(n != 1);'`). Without this the language's
   * built-in rules (CLDR, from `Intl.PluralRules`) are used.
   * @param {string} language @param {string | ((n: number) => number)} rule @param {number} [count] Number of forms when `rule` is a function.
   */
  setPlural(language, rule, count = 0) {
    this.plurals.set(language, typeof rule === 'function' ? { count, index: rule } : parsePluralForms(rule));
    return this;
  }

  /**
   * Add the translations of a gettext `.po` file (`msgctxt`, plurals and the `Plural-Forms` header are understood). Untranslated and fuzzy entries are skipped
   * unless `fuzzy: true`. The language is the file's `Language:` header unless you give one. Returns how many words were added.
   * @param {string} source @param {{ language?: string, fuzzy?: boolean }} [o]
   */
  addPo(source, { language, fuzzy = false } = {}) {
    const po = parsePo(source);
    const lang = language || po.header.Language;
    if (!lang) throw new Error('this .po file has no "Language:" header; say which language it is: addPo(text, { language: "de" })');
    if (po.header['Plural-Forms']) this.setPlural(lang, po.header['Plural-Forms']);
    const entries = {};
    let n = 0;
    for (const e of po.entries) {
      if ((e.fuzzy && !fuzzy) || e.forms.every((f) => !f)) continue;
      entries[entryKey(e.id, e.context)] = e.plural !== null ? e.forms : e.forms[0];
      n++;
    }
    this.add(lang, entries);
    return n;
  }

  /**
   * Add translations from a spreadsheet saved as CSV. The first row names the columns: `key`, an optional `context`, then one column per language code.
   * Rows named `thing.one` / `thing.other` are the forms of one word. Empty cells are left untranslated. Returns the language codes found.
   * @param {string} source @param {{ delimiter?: string }} [o]
   */
  addCsv(source, { delimiter = ',' } = {}) {
    const rows = parseCsv(source, { delimiter });
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim());
    const keyAt = head.findIndex((h) => h.toLowerCase() === 'key');
    if (keyAt < 0) throw new Error('the first row of a translation csv needs a "key" column');
    const ctxAt = head.findIndex((h) => h.toLowerCase() === 'context');
    const langs = head.map((h, i) => ({ h, i })).filter(({ i }) => i !== keyAt && i !== ctxAt && head[i] !== '' && !head[i].startsWith('#'));
    const per = Object.fromEntries(langs.map(({ h }) => [h, {}]));
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r], key = row[keyAt]?.trim();
      if (!key || key.startsWith('#')) continue;
      const ctx = ctxAt >= 0 ? row[ctxAt]?.trim() || null : null;
      for (const { h, i } of langs) if (row[i]) per[h][entryKey(key, ctx)] = row[i];
    }
    for (const { h } of langs) this.add(h, per[h]);
    return langs.map(({ h }) => h);
  }

  /** Is there a word for this key (and context) in the chosen language or its fallbacks? */
  has(key, context = null) { return this._find(entryKey(key, context)) !== undefined; }

  /**
   * Choose the language: a code (`'fr'`, `'pt-BR'`), or `'auto'` for the language of the player's device when there are words for it. Returns the code chosen.
   * @param {string} [choice]
   */
  setLanguage(choice = 'auto') {
    let chosen = choice;
    if (choice === 'auto') {
      const nav = globalThis.navigator;
      const wanted = (nav?.languages ?? [nav?.language]).filter(Boolean);
      chosen = wanted.find((w) => this._chain(w, false).some((c) => this.tables.has(c))) ?? this.fallback;
    }
    this.language = chosen;
    this.onChange?.(chosen);
    return chosen;
  }

  /** The languages tried in order for a code: `pt-BR` gives `pt-BR`, `pt`, then the fallback language. */
  _chain(language, withFallback = true) {
    const out = [];
    const add = (c) => { if (c && !out.includes(c)) out.push(c); };
    for (let c = language; c; c = c.includes('-') ? c.slice(0, c.lastIndexOf('-')) : '') add(c);
    if (withFallback) add(this.fallback);
    return out;
  }

  _find(key, language = this.language) {
    for (const lang of this._chain(language)) {
      const v = this.tables.get(lang)?.get(key);
      if (v !== undefined) return { value: v, language: lang };
    }
    return undefined;
  }

  _rules(language) {
    let c = this._cldr.get(language);
    if (!c) { c = cldrRules(language); this._cldr.set(language, c); }
    return c;
  }

  /** The form to use for `n` in a language: the CLDR category name and its position in the list of forms. */
  _form(language, n, listy) {
    const custom = this.plurals.get(language) ?? this.plurals.get(language.split('-')[0]);
    if (custom && listy) return { name: null, index: custom.index(n) };
    const r = this._rules(language);
    return { name: r.select(n), index: custom ? custom.index(n) : r.index(n) };
  }

  _miss(key, context, language) {
    const id = `${language}\u0000${entryKey(key, context)}`;
    if (!this._reported.has(id)) { this._reported.add(id); this.onMissing?.(language, key, context); }
    return this.missingStyle === 'brackets' ? `[${key}]` : key;
  }

  /** Words for a key in a context and a count (`n` is undefined for a word with no count). */
  _lookup(context, key, n, params) {
    const found = this._find(entryKey(key, context));
    if (!found) return this._fill(this._miss(key, context, this.language), params, this.language, n);
    let { value } = found;
    const lang = found.language;
    if (typeof value !== 'string') {
      const listy = Array.isArray(value);
      const form = this._form(lang, n === undefined ? 1 : n, listy);
      if (listy) value = value[form.index] ?? value[value.length - 1];
      else value = value[form.name] ?? value.other ?? Object.values(value)[0];
    }
    value = String(value ?? key);
    return this._fill(this.pseudo ? pseudoLocalize(value) : value, params, lang, n);
  }

  _fill(text, params, language, n) {
    if (!text.includes('{')) return text;
    const p = n !== undefined && !(params && 'n' in params) ? { ...params, n } : params;
    return text.replace(/\{\{|\}\}|\{([^{}:]+?)(?::([a-z]+))?\}/g, (whole, name, how) => {
      if (whole === '{{') return '{';
      if (whole === '}}') return '}';
      const v = p?.[name.trim()];
      if (v === undefined) return whole;
      if (how === 'number') return typeof v === 'number' ? new Intl.NumberFormat(language || undefined).format(v) : String(v);
      if (how === 'list' && Array.isArray(v)) return new Intl.ListFormat(language || undefined).format(v.map(String));
      return String(v);
    });
  }

  /** The words for `key` in the chosen language, with `{name}` places filled from `params`. A word nowhere shows the key. */
  t(key, params) { return this._lookup(null, key, undefined, params); }
  /** The words for `key` used in a context (the same English word can need two different translations: "Open" a door, "Open" status). */
  tc(context, key, params) { return this._lookup(context, key, undefined, params); }
  /** The right plural form for a count: `tn('coins', 3)` is "3 coins"; `{n}` is the count unless `params` gives one. */
  tn(key, n, params) { return this._lookup(null, key, n, params); }
  /** Plural form of a word in a context. */
  tcn(context, key, n, params) { return this._lookup(context, key, n, params); }

  /** Keys that the fallback language has and `language` lacks: what is still to translate. @returns {string[]} */
  missing(language) {
    const base = this.tables.get(this.fallback);
    if (!base) return [];
    const chain = this._chain(language).filter((c) => c !== this.fallback);
    return [...base.keys()].filter((k) => !chain.some((c) => this.tables.get(c)?.has(k)));
  }

  /** All the words as rows for a spreadsheet: `key`, `context`, then a column per language (plural forms as `key.one`, `key.other`). */
  toCsv() {
    const langs = this.languages;
    const keys = new Set();
    for (const table of this.tables.values()) for (const k of table.keys()) keys.add(k);
    const rows = [['key', 'context', ...langs]];
    for (const full of keys) {
      const at = full.indexOf(CONTEXT_SEPARATOR), ctx = at >= 0 ? full.slice(0, at) : '', key = at >= 0 ? full.slice(at + 1) : full;
      const forms = new Set();
      let plural = false;
      for (const table of this.tables.values()) {
        const v = table.get(full);
        if (v && typeof v === 'object' && !Array.isArray(v)) { plural = true; Object.keys(v).forEach((f) => forms.add(f)); }
      }
      if (plural) for (const f of FORMS.filter((x) => forms.has(x))) rows.push([`${key}.${f}`, ctx, ...langs.map((l) => { const v = this.tables.get(l)?.get(full); return v && typeof v === 'object' ? v[f] ?? '' : ''; })]);
      else rows.push([key, ctx, ...langs.map((l) => { const v = this.tables.get(l)?.get(full); return typeof v === 'string' ? v : Array.isArray(v) ? v.join(' | ') : ''; })]);
    }
    return toCsv(rows);
  }
}
