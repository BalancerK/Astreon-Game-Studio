/** Minimal semver: `x.y.z` versions; ranges `*`, `x.y.z`, `^x.y.z`, `>=x.y.z`. */

/**
 * Read a version string `x.y.z` as `[x, y, z]`; anything else throws.
 *
 * @param {string} v
 */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`invalid version "${v}" (expected x.y.z)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** @returns {number} negative, 0 or positive like a comparator. */
function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Does a version fit a range? Ranges are `*`, `x.y.z` (exactly), `^x.y.z` (same major, at least this) and `>=x.y.z`.
 *
 * @param {string} version
 * @param {string} range
 */
export function satisfies(version, range) {
  if (range === '*') return true;
  const v = parseVersion(version);
  if (range.startsWith('>=')) return compare(v, parseVersion(range.slice(2))) >= 0;
  if (range.startsWith('^')) {
    const base = parseVersion(range.slice(1));
    if (compare(v, base) < 0) return false;
    if (base[0] > 0) return v[0] === base[0];
    return v[0] === 0 && v[1] === base[1]; // 0.x: minor is the breaking boundary
  }
  return compare(v, parseVersion(range)) === 0;
}
