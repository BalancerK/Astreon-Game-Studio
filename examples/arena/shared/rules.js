// Tunable game rules. Data mods (tier 1) change these; the server and every client must end up with the SAME
// values, because client prediction runs the same movement code. Everything here is whitelisted and
// range-checked: a mod can only set what is listed, and only within the range.
// Keep this file deterministic and free of anything but plain comparisons (it is shared simulation code).

export const DEFAULT_RULES = Object.freeze({
  playerSpeed: 420,
  dashMult: 2.5,
  weapon: Object.freeze({ range: 900, damage: 25, cooldownTicks: 10, maxHp: 100 }),
});

/** A fresh, mutable copy of the defaults (each server and each client owns its own). */
export function createRules() {
  return { playerSpeed: DEFAULT_RULES.playerSpeed, dashMult: DEFAULT_RULES.dashMult, weapon: { ...DEFAULT_RULES.weapon } };
}

/** Allowed rule keys (dotted paths) and their ranges. */
export const RULE_SPEC = Object.freeze({
  playerSpeed: { min: 50, max: 2000 },
  dashMult: { min: 1, max: 5 },
  'weapon.range': { min: 100, max: 3000 },
  'weapon.damage': { min: 1, max: 100, int: true },
  'weapon.cooldownTicks': { min: 1, max: 120, int: true },
  'weapon.maxHp': { min: 1, max: 255, int: true },
});

/**
 * Apply dotted-path rule values (as produced by `mergeRuleSets`). Strict: unknown keys and out-of-range or
 * non-numeric values are rejected individually and never applied.
 *
 * @param {ReturnType<typeof createRules>} rules Mutated in place.
 * @param {Record<string, any>} dotted e.g. `{ 'weapon.damage': 30, playerSpeed: 500 }`
 * @returns {{applied: string[], rejected: {key: string, reason: string}[]}}
 */
export function applyRules(rules, dotted) {
  const applied = [], rejected = [];
  for (const [key, value] of Object.entries(dotted)) {
    const spec = Object.hasOwn(RULE_SPEC, key) ? RULE_SPEC[key] : null;
    if (!spec) { rejected.push({ key, reason: 'unknown rule' }); continue; }
    if (typeof value !== 'number' || !Number.isFinite(value)) { rejected.push({ key, reason: 'must be a finite number' }); continue; }
    if (spec.int && !Number.isInteger(value)) { rejected.push({ key, reason: 'must be an integer' }); continue; }
    if (value < spec.min || value > spec.max) { rejected.push({ key, reason: `must be between ${spec.min} and ${spec.max}` }); continue; }
    if (key.includes('.')) { const [group, name] = key.split('.'); rules[group][name] = value; } else rules[key] = value;
    applied.push(key);
  }
  return { applied, rejected };
}

const isColour = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

/**
 * Presentation data from mods: a whitelist, so clients never apply anything unexpected. Returns only valid parts.
 * @param {any} client A mod manifest's `client` section.
 * @returns {{theme: {floor?: number[], wall?: number[], dot?: number[], title?: string}}}
 */
export function sanitizeClientData(client) {
  const out = { theme: {} };
  const t = client && typeof client === 'object' ? client.theme : null;
  if (t && typeof t === 'object') {
    for (const key of ['floor', 'wall', 'dot']) if (isColour(t[key])) out.theme[key] = t[key].slice();
    if (typeof t.title === 'string' && t.title.length <= 40) out.theme.title = t.title.replace(/[^\x20-\x7e]/g, '');
  }
  return out;
}
