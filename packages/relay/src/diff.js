// Where two copies of a game's state (as plain data) differ: for whoever is looking into a desync.

/**
 * The first few paths where `mine` and `theirs` differ, and the two values.
 * @param {any} mine @param {any} theirs @param {number} [limit] @returns {string[]}
 */
export function describeDifferences(mine, theirs, limit = 8) {
  const out = [];
  const walk = (a, b, path) => {
    if (out.length >= limit) return;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { if (!Object.is(a, b) && JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); return; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`);
  };
  walk(JSON.parse(JSON.stringify(mine)), JSON.parse(JSON.stringify(theirs)), '');
  return out;
}
