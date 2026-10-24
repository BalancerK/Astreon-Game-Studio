// Readers (and one writer) for the files translators work with: gettext `.po` and spreadsheet `.csv`. Both are plain text parsers with no dependencies.

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', 0: '\0' };
const unquote = (s, line) => {
  const m = /^"(.*)"$/.exec(s.trim());
  if (!m) throw new Error(`.po line ${line}: expected a quoted string, got ${s.trim().slice(0, 30)}`);
  return m[1].replace(/\\(.)/g, (_, c) => ESCAPES[c] ?? c);
};

/**
 * @typedef {{ context: string | null, id: string, plural: string | null, forms: string[], fuzzy: boolean, comments: string[] }} PoEntry
 * @typedef {{ header: Record<string, string>, entries: PoEntry[] }} PoFile
 */

/**
 * Read a gettext `.po` file: `msgctxt` (context), `msgid`, `msgid_plural`, `msgstr` or `msgstr[0..n]`, strings continued over several lines, `#,` flags
 * (fuzzy entries are marked) and the header (`Plural-Forms`, `Language`, ...). The entry with an empty `msgid` is the header and is not in `entries`.
 * @param {string} source @returns {PoFile}
 */
export function parsePo(source) {
  const lines = String(source).replace(/^﻿/, '').split(/\r?\n/);
  /** @type {PoEntry[]} */ const entries = [];
  let cur = null, field = null, comments = [], fuzzy = false;
  const start = () => ({ context: null, id: '', plural: null, forms: [], fuzzy, comments, hasId: false });
  const finish = () => { if (cur && cur.hasId) { delete cur.hasId; entries.push(cur); } cur = null; field = null; comments = []; fuzzy = false; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim(), no = i + 1;
    if (!line) { finish(); continue; }
    if (line.startsWith('#')) {
      if (cur && cur.hasId && field !== null) finish();           // a comment after the strings begins the next entry
      if (line.startsWith('#,')) { if (/\bfuzzy\b/.test(line)) fuzzy = true; }
      else if (line.startsWith('#~')) { /* an obsolete entry: skipped */ }
      else comments.push(line.slice(1).trim());
      continue;
    }
    let m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")\s*$/.exec(line);
    if (m) {
      const kind = m[1].startsWith('msgstr') ? 'msgstr' : m[1], value = unquote(m[3], no);
      if (cur && (kind === 'msgctxt' || (kind === 'msgid' && cur.hasId))) finish();           // these always begin a new entry
      if (!cur) cur = start();
      if (kind === 'msgctxt') { cur.context = value; field = 'ctx'; }
      else if (kind === 'msgid') { cur.id = value; cur.hasId = true; field = 'id'; }
      else if (kind === 'msgid_plural') { cur.plural = value; field = 'plural'; }
      else { const idx = m[2] === undefined ? 0 : Number(m[2]); cur.forms[idx] = value; field = idx; }
      continue;
    }
    if (line.startsWith('"') && cur) {                              // a continuation of the last string
      const value = unquote(line, no);
      if (field === 'ctx') cur.context += value;
      else if (field === 'id') cur.id += value;
      else if (field === 'plural') cur.plural += value;
      else if (typeof field === 'number') cur.forms[field] += value;
      continue;
    }
    throw new Error(`.po line ${no}: cannot read "${line.slice(0, 40)}"`);
  }
  finish();
  const header = {};
  const hi = entries.findIndex((e) => e.id === '' && e.context === null);
  if (hi >= 0) {
    for (const row of (entries[hi].forms[0] ?? '').split('\n')) {
      const k = row.indexOf(':');
      if (k > 0) header[row.slice(0, k).trim()] = row.slice(k + 1).trim();
    }
    entries.splice(hi, 1);
  }
  for (const e of entries) for (let k = 0; k < e.forms.length; k++) e.forms[k] ??= '';
  return { header, entries };
}

/**
 * Read comma-separated values (also tab-separated with `delimiter: '\t'`): quoted cells, doubled quotes, line breaks inside quotes, a byte-order mark, CRLF.
 * @param {string} source @param {{ delimiter?: string }} [o] @returns {string[][]} rows of cells
 */
export function parseCsv(source, { delimiter = ',' } = {}) {
  const text = String(source).replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === delimiter) { row.push(cell); cell = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; i++;
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    cell += c; i++;
  }
  if (quoted) throw new Error('csv: a quoted cell is never closed');
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Write rows as CSV (quoting only what needs it). */
export function toCsv(rows, { delimiter = ',' } = {}) {
  const q = (v) => { const s = String(v ?? ''); return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(q).join(delimiter)).join('\n') + '\n';
}
