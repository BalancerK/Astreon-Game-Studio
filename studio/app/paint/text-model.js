// The Text panel's logic: a game's words in every language, kept in `src/text.js` as plain JSON:
//
//   export default { "en": { "start": "Start", "coins.one": "{n} coin", "coins.other": "{n} coins" }, "fr": { "start": "Commencer" } };
//
// The first language is the one every other falls back to. This builds and changes that table, finds what is missing (using the kit's own checker), and moves it to
// and from a spreadsheet (CSV: one row per key, one column per language) so words can be sent to a translator and back.
import { baseKey, textProblems, TEXT_LIMITS } from '../../../packages/arcade/src/text.js';

export { baseKey, textProblems, TEXT_LIMITS };

const clone = (x) => JSON.parse(JSON.stringify(x));
export const KEY = /^[\w][\w.-]{0,63}$/;
export const CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Names for the language codes people use most (the panel shows these beside the code). */
export const LANGUAGE_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', 'pt-BR': 'Portuguese (Brazil)', nl: 'Dutch',
  sv: 'Swedish', pl: 'Polish', ru: 'Russian',
  uk: 'Ukrainian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay',
  ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)', ta: 'Tamil', cs: 'Czech', el: 'Greek', fi: 'Finnish', da: 'Danish', no: 'Norwegian',
  hu: 'Hungarian', ro: 'Romanian',
};

/** A starter table: English with a few words to show how it works. */
export function newTable() {
  return { en: { title: 'My game', start: 'Start', 'coins.one': '{n} coin', 'coins.other': '{n} coins' } };
}

// ---------- the file ----------

/** The table as the text of a file. */
export function serializeText(tables) {
  const body = Object.entries(tables).map(([code, list]) => {
    const rows = Object.entries(list).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    return `  ${JSON.stringify(code)}: {${rows ? `\n${rows}\n  ` : ''}}`;
  }).join(',\n');
  const note = '// Made with the studio\'s Text panel. The first language is the one the others fall back to.';
  return `${note}\n// Use it with text(...) and t('key') from @engine/arcade.\nexport default {\n${body}\n};\n`;
}

/** Read a text file. Throws an Error that says what is wrong. */
export function parseText(text) {
  const m = /export\s+default\s+([\s\S]*?);?\s*$/.exec(String(text ?? ''));
  if (!m) throw new Error('This file is not a table of words: it should say "export default { ... }".');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error('This text file has been edited into something the Text panel cannot read. Keep the part after "export default" as plain JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The text file should hold an object with one list of words for each language.');
  }
  const out = {};
  for (const [code, list] of Object.entries(data)) {
    if (!CODE.test(code)) throw new Error(`"${code.slice(0, 20)}" is not a language code (use letters like en, fr, pt-BR).`);
    if (!list || typeof list !== 'object' || Array.isArray(list)) throw new Error(`The words for "${code}" should be an object of key: words.`);
    out[code] = {};
    for (const [key, value] of Object.entries(list)) {
      if (!KEY.test(key)) throw new Error(`"${key.slice(0, 30)}" is not a usable key (letters, numbers, dots, dashes and underscores).`);
      out[code][key] = String(value);
    }
  }
  return out;
}

// ---------- changing the table ----------

/** Why a key cannot be used, or null. */
export function keyProblem(tables, key) {
  if (!KEY.test(key)) return 'Use letters, numbers, dots, dashes and underscores (up to 64)';
  if (allKeys(tables).includes(key)) return 'There is already a key with that name';
  if (allKeys(tables).length >= TEXT_LIMITS.keys) return `At most ${TEXT_LIMITS.keys} keys`;
  return null;
}

/** Why a language code cannot be added, or null. */
export function languageProblem(tables, code) {
  if (!CODE.test(code)) return 'Use a language code such as fr, de or pt-BR';
  if (Object.keys(tables).some((c) => c.toLowerCase() === code.toLowerCase())) return 'That language is already in the table';
  if (Object.keys(tables).length >= TEXT_LIMITS.languages) return `At most ${TEXT_LIMITS.languages} languages`;
  return null;
}

/** Every key used by any language, the first language's keys first and in its order. */
export function allKeys(tables) {
  const seen = new Set();
  for (const list of Object.values(tables)) for (const key of Object.keys(list)) seen.add(key);
  return [...seen];
}

/** A language added (empty: every word shows as missing until it is written). */
export function addLanguage(tables, code) {
  const out = clone(tables);
  out[code] = {};
  return out;
}

/** A language taken away (the first one cannot go while others remain: they fall back to it). */
export function removeLanguage(tables, code) {
  const codes = Object.keys(tables);
  if (codes[0] === code && codes.length > 1) {
    throw new Error('The first language is the one the others fall back to. Make another language the default first.');
  }
  const out = clone(tables);
  delete out[code];
  return out;
}

/** The same table with `code` moved to the front, so it becomes the language the others fall back to. */
export function makeFirst(tables, code) {
  if (!(code in tables)) return tables;
  return { [code]: clone(tables[code]), ...Object.fromEntries(Object.entries(clone(tables)).filter(([c]) => c !== code)) };
}

/** A key added with empty words in the first language (so it appears as a row), or the same table when there is no language yet. */
export function addKey(tables, key, words = '') {
  const first = Object.keys(tables)[0];
  if (!first) return tables;
  const out = clone(tables);
  out[first][key] = words;
  return out;
}

/** One word set; empty words take the key out of that language (it then shows as missing and falls back). */
export function setWord(tables, code, key, words) {
  const out = clone(tables);
  if (!out[code]) return tables;
  if (words === '' && code !== Object.keys(tables)[0]) delete out[code][key]; else out[code][key] = words;
  return out;
}

/** A key renamed in every language, in the same place. */
export function renameKey(tables, from, to) {
  const out = {};
  for (const [code, list] of Object.entries(tables)) out[code] = Object.fromEntries(Object.entries(list).map(([k, v]) => [k === from ? to : k, v]));
  return out;
}

/** A key taken out of every language. */
export function removeKey(tables, key) {
  const out = clone(tables);
  for (const list of Object.values(out)) delete list[key];
  return out;
}

/** How much of the first language each language has words for, 0 to 1 (counting plural forms of a key as one). */
export function completeness(tables) {
  const codes = Object.keys(tables);
  const need = new Set(Object.keys(tables[codes[0]] ?? {}).map(baseKey));
  return Object.fromEntries(codes.map((code) => {
    const have = new Set(Object.keys(tables[code]).map(baseKey));
    return [code, need.size ? [...need].filter((k) => have.has(k)).length / need.size : 1];
  }));
}

// ---------- spreadsheets (CSV) ----------

const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The table as CSV: a header `key,en,fr,...` and a row for each key. */
export function toCsv(tables) {
  const codes = Object.keys(tables);
  const rows = [['key', ...codes], ...allKeys(tables).map((key) => [key, ...codes.map((c) => tables[c][key] ?? '')])];
  return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Split CSV text into rows of cells (quotes, doubled quotes and line breaks inside quotes all work). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { value += '"'; i++; } else if (ch === '"') quoted = false; else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(value); value = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else value += ch;
  }
  if (value !== '' || row.length) { row.push(value); if (row.some((c) => c !== '')) rows.push(row); }
  return rows;
}

/** Read a table from CSV (the first column is the key, the others are languages). Throws an Error that says what is wrong. */
export function fromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 1 || rows[0][0]?.trim().toLowerCase() !== 'key' || rows[0].length < 2) {
    throw new Error('The first row should be "key" followed by the language codes, such as: key,en,fr');
  }
  const codes = rows[0].slice(1).map((c) => c.trim());
  for (const c of codes) {
    if (!CODE.test(c)) throw new Error(`"${c.slice(0, 20)}" in the first row is not a language code (use letters like en, fr, pt-BR).`);
  }
  if (new Set(codes.map((c) => c.toLowerCase())).size !== codes.length) throw new Error('A language appears twice in the first row.');
  const out = Object.fromEntries(codes.map((c) => [c, {}]));
  for (const [n, row] of rows.slice(1).entries()) {
    const key = row[0].trim();
    if (!KEY.test(key)) throw new Error(`Row ${n + 2}: "${key.slice(0, 30)}" is not a usable key.`);
    codes.forEach((c, i) => { if ((row[i + 1] ?? '') !== '' || i === 0) out[c][key] = row[i + 1] ?? ''; });
  }
  return out;
}

/** An imported table merged into the current one: languages and keys in the import replace the ones here, everything else stays. */
export function mergeTables(current, imported) {
  const out = clone(current);
  for (const [code, list] of Object.entries(imported)) {
    const own = Object.keys(out).find((c) => c.toLowerCase() === code.toLowerCase()) ?? code;
    out[own] = { ...(out[own] ?? {}), ...list };
  }
  return out;
}

/** The kit's check of the table, as the panel lists it. */
export const problems = (tables) => textProblems(tables);
