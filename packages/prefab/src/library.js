// Prefabs as data: named templates for entities (their components, tags, free-form extras for the game's own systems, and children,
// possibly other prefabs), with inheritance (`extends`), named parameters, and overrides. Plain JSON in, plain JSON out.
import { Transform, Parent, LocalTransform, Tags, IDENTITY } from './components.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Deep merge: objects merge key by key, everything else (numbers, strings, arrays) is replaced. Returns `a`. */
export function mergeDeep(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (isObject(v) && isObject(a[k])) mergeDeep(a[k], v);
    else a[k] = clone(v);
  }
  return a;
}

/** `{ 'components.health.hp': 5 }` -> `{ components: { health: { hp: 5 } } }` (keys without dots are kept; a dotted key is split at dots). */
export function expandPaths(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let o = out;
    for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] = isObject(o[parts[i]]) ? o[parts[i]] : {});
    const last = parts[parts.length - 1];
    if (isObject(v) && isObject(o[last])) mergeDeep(o[last], v); else o[last] = clone(v);
  }
  return out;
}

/** Which components a prefab file may name, with the fields each takes (and optional named values for a field, like `team: red`). */
export class ComponentRegistry {
  constructor() {
    /** @type {Map<string, {component: any, enums: Record<string, Record<string, number>>}>} */
    this.items = new Map();
    this.add(Transform); this.add(Parent); this.add(LocalTransform); this.add(Tags);
  }
  /** @param {import('../../core/src/index.js').Component} component @param {{enums?: Record<string, Record<string, number>>}} [o] */
  add(component, { enums = {} } = {}) {
    if (this.items.has(component.name)) throw new Error(`component "${component.name}" is already registered`);
    this.items.set(component.name, { component, enums });
    return this;
  }
  get(name) { return this.items.get(name) ?? null; }
  get names() { return [...this.items.keys()]; }
  /** Turn a spec value into the number stored: numbers as they are, booleans 1 / 0, strings through the field's named values. */
  toNumber(componentName, field, v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const e = this.items.get(componentName)?.enums[field];
    if (typeof v === 'string' && e && v in e) return e[v];
    throw new Error(`${componentName}.${field}: "${v}" is not a number${e ? ` or one of ${Object.keys(e).join(', ')}` : ''}`);
  }
}

/** A library of prefabs. */
export class PrefabLibrary {
  /** @param {ComponentRegistry} [registry] */
  constructor(registry = new ComponentRegistry()) {
    this.registry = registry;
    /** @type {Map<string, any>} */ this.specs = new Map();
    this.tagBits = new Map();
    this.resolved = new Map();
  }

  /** The bit for a tag name (assigned in order of first use, at most 32). */
  tag(name) {
    let b = this.tagBits.get(name);
    if (b === undefined) {
      if (this.tagBits.size >= 32) throw new Error(`at most 32 tags; cannot add "${name}"`);
      b = (1 << this.tagBits.size) >>> 0;
      this.tagBits.set(name, b);
    }
    return b;
  }
  /** Tag names in a bit set. */
  tagNames(bits) { const out = []; for (const [n, b] of this.tagBits) if ((bits & b) !== 0) out.push(n); return out; }

  /** Add a prefab (or a list of them). A prefab with the same name replaces the old one. @returns {this} */
  define(spec) {
    if (Array.isArray(spec)) { for (const s of spec) this.define(s); return this; }
    if (!isObject(spec) || typeof spec.name !== 'string' || spec.name === '') throw new Error('a prefab needs a name');
    const names = new Set();
    for (const c of spec.children ?? []) {
      if (typeof c.name !== 'string' || c.name === '' || c.name.includes('/')) throw new Error(`prefab "${spec.name}": every child needs a name without "/"`);
      if (names.has(c.name)) throw new Error(`prefab "${spec.name}": two children are called "${c.name}"`);
      names.add(c.name);
    }
    this.specs.set(spec.name, clone(spec));
    this.resolved.clear();
    return this;
  }

  /** Load prefabs from parsed JSON: an array of specs, or `{ prefabs: [...] }`. */
  load(data) { return this.define(Array.isArray(data) ? data : data.prefabs ?? []); }

  has(name) { return this.specs.has(name); }
  get names() { return [...this.specs.keys()]; }

  /**
   * The prefab with everything it inherits merged in: bases first (`extends` may be a name or a list), then its own values on top.
   * Components and extras merge field by field; tags are united; children merge by name (a child of the same name changes the inherited
   * one, a new name adds one); `params` merge by name. The result is a new object you may keep.
   * @returns {any}
   */
  resolve(name, stack = []) {
    const cached = this.resolved.get(name);
    if (cached && stack.length === 0) return clone(cached);
    const spec = this.specs.get(name);
    if (!spec) throw new Error(`no prefab named "${name}"${this.#hint(name)}`);
    if (stack.includes(name)) throw new Error(`prefabs extend each other in a circle: ${[...stack, name].join(' -> ')}`);
    const out = { name, tags: [], components: {}, extras: {}, children: [], params: {} };
    const bases = spec.extends === undefined ? [] : Array.isArray(spec.extends) ? spec.extends : [spec.extends];
    for (const b of bases) this.#fold(out, this.resolve(b, [...stack, name]));
    this.#fold(out, spec);
    out.name = name;
    if (stack.length === 0) this.resolved.set(name, clone(out));
    return out;
  }

  #fold(out, spec) {
    for (const t of spec.tags ?? []) if (!out.tags.includes(t)) out.tags.push(t);
    mergeDeep(out.components, spec.components ?? {});
    mergeDeep(out.extras, spec.extras ?? {});
    mergeDeep(out.params, spec.params ?? {});
    if (spec.local) out.local = clone(spec.local);
    for (const c of spec.children ?? []) {
      const i = out.children.findIndex((x) => x.name === c.name);
      if (i < 0) out.children.push(clone(c));
      else {
        const old = out.children[i], merged = { ...old, ...clone({ ...c, components: undefined, extras: undefined, local: undefined, tags: undefined }) };
        merged.components = mergeDeep(old.components ?? {}, c.components ?? {}); merged.extras = mergeDeep(old.extras ?? {}, c.extras ?? {});
        if (c.local || old.local) merged.local = { ...(old.local ?? {}), ...(c.local ?? {}) };
        merged.tags = [...new Set([...(old.tags ?? []), ...(c.tags ?? [])])];
        out.children[i] = merged;
      }
    }
  }

  #hint(name) {
    const close = this.names.filter((n) => n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase()));
    return close.length ? ` (did you mean ${close.slice(0, 3).map((n) => `"${n}"`).join(', ')}?)` : this.specs.size ? ` (known: ${this.names.slice(0, 8).join(', ')}${this.specs.size > 8 ? ', ...' : ''})` : '';
  }

  /**
   * Check every prefab against the registry: components and fields exist, values can be numbers, child prefabs exist, no circles,
   * parameters point at something. Throws an error listing every problem found.
   */
  validate() {
    const problems = [];
    const checkComponents = (where, comps) => {
      for (const [cn, values] of Object.entries(comps ?? {})) {
        const entry = this.registry.get(cn);
        if (!entry) { problems.push(`${where}: unknown component "${cn}" (registered: ${this.registry.names.join(', ')})`); continue; }
        for (const [f, v] of Object.entries(values ?? {})) {
          if (!entry.component.fields.includes(f)) { problems.push(`${where}: component "${cn}" has no field "${f}" (it has ${entry.component.fields.join(', ')})`); continue; }
          try { this.registry.toNumber(cn, f, v); } catch (e) { problems.push(`${where}: ${e.message}`); }
        }
      }
    };
    const walk = (name, path, stack) => {
      let spec;
      try { spec = this.resolve(name); } catch (e) { problems.push(`${path}: ${e.message}`); return; }
      checkComponents(path, spec.components);
      for (const t of spec.tags) { try { this.tag(t); } catch (e) { problems.push(`${path}: ${e.message}`); } }
      for (const [pn, target] of Object.entries(spec.params)) if (typeof target !== 'string' || !target.split('.').length) problems.push(`${path}: parameter "${pn}" must be a path like "components.health.hp"`);
      for (const c of spec.children) {
        const cpath = `${path}/${c.name}`;
        checkComponents(cpath, c.components);
        if (c.prefab !== undefined) {
          if (stack.includes(c.prefab)) problems.push(`${cpath}: the prefab "${c.prefab}" contains itself`);
          else if (!this.has(c.prefab)) problems.push(`${cpath}: no prefab named "${c.prefab}"`);
          else walk(c.prefab, cpath, [...stack, c.prefab]);
        }
      }
    };
    for (const name of this.names) walk(name, name, [name]);
    if (problems.length) throw new Error(`prefab problems:\n  - ${problems.join('\n  - ')}`);
    return true;
  }

  /** All prefabs as plain JSON (the inverse of `load`). */
  toJSON() { return { prefabs: [...this.specs.values()].map(clone) }; }
}

export { Transform, Parent, LocalTransform, Tags, IDENTITY };
