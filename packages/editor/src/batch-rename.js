// Renaming many things at once (Ctrl+F2): give the selection names from a pattern ("Crate {n}": Crate 1, Crate 2...), or find and replace a piece of the names they already have.
// The same for the entities' ids (the unique handle) when asked. This is the maths with no page in it: it works out what every name would become (and what is wrong with it),
// so the dialog can show the result before anything changes.

/** The longest a name may be. */
export const NAME_MAX = 80;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pad = (n, digits) => String(Math.max(0, Math.trunc(n))).padStart(digits, '0');

/**
 * What each of the selected entities would be renamed to.
 * @param {{id: string, name?: string, prefab?: string}[]} items the selection, in the order that matters for numbering
 * @param {object} o
 * @param {'name' | 'id'} [o.target] what to rename: the name people see (default), or the unique id
 * @param {'pattern' | 'replace'} [o.mode] a pattern with numbers, or find and replace
 * @param {string} [o.pattern] with `{n}` (a number), `{name}` (what it shows now), `{id}` and `{prefab}`
 * @param {number} [o.start] the first number (default 1)
 * @param {number} [o.step] how much each next number grows (default 1)
 * @param {number} [o.digits] pad numbers with zeros to this many digits (default 1: none)
 * @param {string} [o.find] the text to find (find and replace)
 * @param {string} [o.replace] what to put instead
 * @param {boolean} [o.matchCase] whether capitals matter when finding (default no)
 * @param {Iterable<string>} [taken] every id in the scene (to say which new ids would clash)
 * @returns {{id: string, from: string, to: string, changed: boolean, error: string | null}[]}
 */
export function previewRename(items, o = {}, taken = []) {
  const target = o.target ?? 'name';
  const mode = o.mode ?? 'pattern';
  const start = Number.isFinite(o.start) ? o.start : 1;
  const step = Number.isFinite(o.step) ? o.step : 1;
  const digits = Math.max(1, Math.min(8, Math.trunc(o.digits ?? 1)));
  const finder = mode === 'replace' && o.find ? new RegExp(escape(o.find), o.matchCase ? 'g' : 'gi') : null;
  const rows = items.map((e, i) => {
    const label = e.name || e.id;
    const from = target === 'id' ? e.id : (e.name ?? '');
    let to = from;
    if (mode === 'pattern') {
      to = String(o.pattern ?? '{name} {n}')
        .replace(/\{n\}/g, pad(start + i * step, digits)).replace(/\{name\}/g, label).replace(/\{id\}/g, e.id).replace(/\{prefab\}/g, e.prefab ?? '');
    } else if (finder) {
      const shown = target === 'id' ? e.id : label;
      const replaced = shown.replace(finder, () => o.replace ?? '');
      to = replaced === shown ? from : replaced;                                  // nothing found: left as it is (an unnamed entity stays unnamed)
    }
    to = target === 'id' ? to.trim() : to.trim().slice(0, NAME_MAX);
    if (mode === 'replace' && !finder) to = from;
    const changed = to !== from;
    return { id: e.id, from, to, changed, error: null };
  });
  if (target === 'id') {
    const moving = new Set(items.map((e) => e.id));
    const others = new Set([...taken].filter((id) => !moving.has(id)));
    const seen = new Map();
    for (const r of rows) seen.set(r.to, (seen.get(r.to) ?? 0) + 1);
    for (const r of rows) {
      if (!r.changed) continue;
      if (!ID.test(r.to)) r.error = r.to === '' ? 'an id cannot be empty' : 'ids use letters, digits and - _ . : (up to 64)';
      else if (others.has(r.to)) r.error = 'another entity already has this id';
      else if (seen.get(r.to) > 1) r.error = 'two of these would get the same id';
    }
  }
  return rows;
}

/** Are there changes to make, and none of them wrong? */
export function canApply(rows) {
  return rows.some((r) => r.changed) && rows.every((r) => !r.error);
}
