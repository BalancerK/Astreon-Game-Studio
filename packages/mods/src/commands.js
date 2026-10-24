/**
 * Mods act on the game only through *commands*: small JSON objects the game defines and validates. The mod
 * proposes, the game decides (and can refuse). A command spec lists exactly the allowed fields and their types.
 *
 * @typedef {{type: 'int' | 'number', min?: number, max?: number} | {type: 'string', maxLength?: number} | {type: 'bool'}} FieldSpec
 * @typedef {Record<string, Record<string, FieldSpec>>} CommandSpecs  op name -> field name -> spec
 */

/**
 * Check a command a mod sent against the allowed commands (`op` names and the types and ranges of their fields). Never throws:
 * returns `{ ok: true }` or `{ ok: false, error }`.
 *
 * @param {any} cmd
 * @param {CommandSpecs} specs
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateCommand(cmd, specs) {
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) return { ok: false, error: 'command must be an object' };
  const spec = typeof cmd.op === 'string' && Object.hasOwn(specs, cmd.op) ? specs[cmd.op] : null;
  if (!spec) return { ok: false, error: `unknown op "${String(cmd.op).slice(0, 40)}"` };
  for (const key of Object.keys(cmd)) {
    if (key !== 'op' && !Object.hasOwn(spec, key)) return { ok: false, error: `${cmd.op}: unexpected field "${key.slice(0, 40)}"` };
  }
  for (const [field, f] of Object.entries(spec)) {
    const v = cmd[field];
    if (v === undefined) return { ok: false, error: `${cmd.op}: missing "${field}"` };
    switch (f.type) {
      case 'int':
        if (!Number.isInteger(v)) return { ok: false, error: `${cmd.op}.${field} must be an integer` };
        // fallthrough to range check
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${cmd.op}.${field} must be a finite number` };
        if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) return { ok: false, error: `${cmd.op}.${field} out of range [${f.min ?? '-inf'}, ${f.max ?? 'inf'}]` };
        break;
      case 'string':
        if (typeof v !== 'string' || v.length > (f.maxLength ?? 200)) return { ok: false, error: `${cmd.op}.${field} must be a string of at most ${f.maxLength ?? 200} characters` };
        break;
      case 'bool':
        if (typeof v !== 'boolean') return { ok: false, error: `${cmd.op}.${field} must be a boolean` };
        break;
      default:
        return { ok: false, error: `${cmd.op}.${field}: bad spec` };
    }
  }
  return { ok: true };
}

/**
 * Merge rule sets from several mods (in load order; later wins) and report every key more than one mod sets.
 * Keys are dotted paths, so `weapon.damage` and `weapon.cooldownTicks` from different mods do not conflict.
 * @param {{mod: string, rules: Record<string, any>}[]} sets
 * @returns {{merged: Record<string, any>, conflicts: {key: string, mods: string[], winner: string}[]}} `merged` uses dotted keys.
 */
export function mergeRuleSets(sets) {
  const merged = {};
  const setBy = new Map();
  const flatten = (obj, prefix, out) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = v;
    }
    return out;
  };
  for (const { mod, rules } of sets) {
    for (const [key, value] of Object.entries(flatten(rules, '', {}))) {
      merged[key] = value;
      if (!setBy.has(key)) setBy.set(key, []);
      setBy.get(key).push(mod);
    }
  }
  const conflicts = [...setBy].filter(([, mods]) => mods.length > 1).map(([key, mods]) => ({ key, mods, winner: mods[mods.length - 1] }));
  return { merged, conflicts };
}
