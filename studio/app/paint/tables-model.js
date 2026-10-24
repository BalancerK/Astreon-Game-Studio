// The Tables panel's logic: a game's rules kept as tables of records (weapons, frames, enemies, items...) in a plain data file, edited as a grid with the right kind of box for every column.
// The data lives in a file of the form `export default { "weapons": [ {...}, {...} ], "frames": [...] };` so the game can import it directly and so the studio can read and write it with no
// tools. What the columns are (their names, kinds and limits) is described by a schema file next to it, `name.schema.json`:
//
//   { "file": "data/parts.js", "title": "Parts",
//     "tables": [ { "key": "weapons", "title": "Weapons", "idKey": "id",
//       "columns": [ { "key": "id", "label": "Name", "type": "text" },
//                    { "key": "damage", "label": "Damage", "type": "number", "min": 0, "max": 500, "step": 1, "help": "Hit points before armour" },
//                    { "key": "slot", "label": "Slot", "type": "enum", "options": ["main", "melee", "sub"] },
//                    { "key": "color", "label": "Colour", "type": "color" }, { "key": "twoHanded", "label": "Two-handed", "type": "bool" } ] } ] }
//
// Pure functions, tested in Node. Nothing here touches the page.

export const SCHEMA_SUFFIX = '.schema.json';
const HEX = /^#[0-9a-f]{6}$/i;
const TYPES = new Set(['text', 'number', 'bool', 'enum', 'color']);

/** The schema files in a project. @param {string[]} paths */
export const findSchemas = (paths) => paths.filter((p) => p.endsWith(SCHEMA_SUFFIX)).sort();

/**
 * Read a schema file and say what is wrong with it.
 * @param {string} text
 * @returns {{schema: any | null, problems: string[]}}
 */
export function readSchema(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { schema: null, problems: ['The schema file is not valid JSON.'] }; }
  const problems = [];
  if (!raw || typeof raw !== 'object' || typeof raw.file !== 'string') problems.push('The schema needs a "file": the data file it describes.');
  if (!Array.isArray(raw?.tables) || raw.tables.length === 0) problems.push('The schema needs a list of "tables".');
  const tables = [];
  for (const t of Array.isArray(raw?.tables) ? raw.tables : []) {
    if (!t || typeof t.key !== 'string' || !Array.isArray(t.columns) || t.columns.length === 0) {
      problems.push('Every table needs a "key" and some "columns".');
      continue;
    }
    const columns = [];
    for (const c of t.columns) {
      if (!c || typeof c.key !== 'string' || !TYPES.has(c.type)) {
        problems.push(`In "${t.key}", a column needs a "key" and a "type" (${[...TYPES].join(', ')}).`);
        continue;
      }
      if (c.type === 'enum' && (!Array.isArray(c.options) || c.options.length === 0)) {
        problems.push(`The column "${c.key}" is an enum and needs "options".`);
        continue;
      }
      columns.push({ label: c.key, ...c });
    }
    tables.push({ title: t.key, idKey: columns.some((c) => c.key === 'id') ? 'id' : null, ...t, columns });
  }
  return { schema: problems.length && !tables.length ? null : { title: raw.title ?? raw.file, ...raw, tables }, problems };
}

// ---------- the data file ----------

/**
 * Read a data file: `export default {...};` with comments in front.
 * @param {string} text
 * @returns {any} @throws {Error} with a plain message when it cannot be read
 */
export function parseData(text) {
  const body = String(text).replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*/, '').trim();
  const m = /^export\s+default\s+([\s\S]*?);?\s*$/.exec(body);
  if (!m) throw new Error('The data file should be `export default { ... };`, with plain JSON after "export default".');
  try { return JSON.parse(m[1]); } catch (error) { throw new Error(`The part after "export default" is not plain JSON: ${error.message}`); }
}

/**
 * Write data as a file: a comment, then `export default`, with every table's records one to a line.
 * @param {Record<string, any[]>} data @param {string} [header] the comment to put first
 */
export function serializeData(data, header = 'Data kept by the studio\'s Tables panel; keep the part after "export default" as plain JSON.') {
  const parts = Object.entries(data).map(([key, value]) => {
    if (!Array.isArray(value)) return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    return `  ${JSON.stringify(key)}: [\n${value.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`;
  });
  return `// ${header}\nexport default {\n${parts.join(',\n')}\n};\n`;
}

// ---------- looking, checking, changing ----------

/** The rows of a table (an empty list if the data has none yet). */
export const rowsOf = (data, table) => (Array.isArray(data?.[table.key]) ? data[table.key] : []);

/**
 * Everything wrong with the data, as sentences that name the table, the row and the column.
 * @param {any} data @param {any} schema
 * @returns {string[]}
 */
export function validateData(data, schema) {
  const out = [];
  for (const t of schema.tables) {
    const rows = rowsOf(data, t), seen = new Set();
    rows.forEach((row, i) => {
      const name = t.idKey ? String(row?.[t.idKey] ?? '') : '';
      const where = `${t.title}, ${name ? `"${name}"` : `row ${i + 1}`}`;
      if (t.idKey) {
        if (!name) out.push(`${where}: needs a ${t.columns.find((c) => c.key === t.idKey)?.label ?? t.idKey}.`);
        else if (seen.has(name)) out.push(`${where}: another row has the same ${t.idKey}.`);
        seen.add(name);
      }
      for (const c of t.columns) {
        const v = row?.[c.key];
        if (v === undefined || v === null) {
          if (!c.nullable && c.type !== 'number' && c.key !== t.idKey) out.push(`${where}: "${c.label}" is empty.`);
          continue;
        }
        if (c.type === 'number') {
          if (!Number.isFinite(v)) out.push(`${where}: "${c.label}" is not a number.`);
          else if ((c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max)) {
            out.push(`${where}: "${c.label}" is ${v}, outside ${c.min ?? '-'} to ${c.max ?? '-'}.`);
          }
        } else if (c.type === 'enum' && !c.options.includes(v)) {
          out.push(`${where}: "${c.label}" is "${v}", which is not one of ${c.options.join(', ')}.`);
        }
        else if (c.type === 'color' && !HEX.test(String(v))) out.push(`${where}: "${c.label}" is not a colour like #ff8800.`);
        else if (c.type === 'bool' && typeof v !== 'boolean') out.push(`${where}: "${c.label}" should be yes or no.`);
      }
    });
  }
  return out;
}

/** Turn what a box holds into the value for its column. @param {any} column @param {string | boolean} raw */
export function coerce(column, raw) {
  if (column.type === 'bool') return Boolean(raw);
  if (column.type === 'number') {
    if (raw === '' || raw === null) return column.nullable ? null : column.min ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : column.nullable ? null : column.min ?? 0;
  }
  if (column.type === 'color') return HEX.test(String(raw)) ? String(raw).toLowerCase() : '#000000';
  return String(raw);
}

const clone = (data) => JSON.parse(JSON.stringify(data));

/** Change one cell. Returns new data; the old is left alone. @param {any} data @param {any} table @param {number} index @param {string} key @param {string | boolean} raw */
export function setCell(data, table, index, key, raw) {
  const column = table.columns.find((c) => c.key === key);
  if (!column) throw new Error(`There is no column "${key}".`);
  const next = clone(data);
  const rows = next[table.key];
  if (!rows?.[index]) throw new Error('There is no such row.');
  rows[index][key] = coerce(column, raw);
  return next;
}

const BLANKS = {
  bool: () => false, number: (c) => (c.nullable ? null : c.min ?? 0), enum: (c) => c.options[0], color: () => '#808080', text: () => '',
};
const blankFor = (c) => BLANKS[c.type](c);

/** A name for a new row that no other row has. */
function freeId(rows, idKey, base) {
  const used = new Set(rows.map((r) => String(r[idKey])));
  let n = 1;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Add a row (a copy of the last one's values, so it starts out sensible, with a new name). @returns {{data: any, index: number}} */
export function addRow(data, table) {
  const next = clone(data);
  const rows = (next[table.key] ??= []);
  const row = {};
  const last = rows[rows.length - 1];
  for (const c of table.columns) row[c.key] = last && last[c.key] !== undefined ? last[c.key] : blankFor(c);
  if (table.idKey) row[table.idKey] = freeId(rows, table.idKey, 'new');
  rows.push(row);
  return { data: next, index: rows.length - 1 };
}

/** Copy a row, right after it, with a new name. @returns {{data: any, index: number}} */
export function duplicateRow(data, table, index) {
  const next = clone(data);
  const rows = next[table.key];
  if (!rows?.[index]) throw new Error('There is no such row.');
  const copy = clone(rows[index]);
  if (table.idKey) copy[table.idKey] = freeId(rows, table.idKey, String(rows[index][table.idKey] ?? 'copy'));
  rows.splice(index + 1, 0, copy);
  return { data: next, index: index + 1 };
}

/** Take a row out. @returns {any} */
export function removeRow(data, table, index) {
  const next = clone(data);
  const rows = next[table.key];
  if (!rows?.[index]) throw new Error('There is no such row.');
  rows.splice(index, 1);
  return next;
}

/** Move a row up (-1) or down (1). @returns {any} */
export function moveRow(data, table, index, by) {
  const next = clone(data);
  const rows = next[table.key];
  const to = index + by;
  if (!rows?.[index] || to < 0 || to >= rows.length) return next;
  [rows[index], rows[to]] = [rows[to], rows[index]];
  return next;
}
