// Making entities from prefabs and taking them apart again; capturing what changed since (for saves).
import { Transform, Parent, LocalTransform, Tags, IDENTITY } from './components.js';
import { mergeDeep, expandPaths } from './library.js';
import { composeTransform } from './transform.js';
import { sin, cos } from '../../math/src/index.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** One spawned prefab: its entities by path, and whatever the game attached to it (physics bodies, meshes) to clean up with it. */
export class Instance {
  constructor(spawner, name, spec, id) {
    this.spawner = spawner; this.prefab = name; this.spec = spec;
    /** A number that identifies this instance (unique in its spawner; kept in saves, so saved things can refer to each other). */
    this.id = id;
    /** @type {number} the entity of the prefab itself */ this.root = -1;
    /** @type {number[]} every entity, parents before children */ this.entities = [];
    /** @type {Map<string, number>} path -> entity: '' is the root, 'lamp' a child, 'lamp/bulb' a grandchild */ this.byPath = new Map();
    this.cleanups = [];
    this.alive = true;
    /** Free-form place for the game to keep things (set by extras handlers). */
    this.data = {};
  }
  /** The entity at a path ('' = the root). */
  get(path = '') { const e = this.byPath.get(path); if (e === undefined) throw new Error(`prefab "${this.prefab}" has no part "${path}" (it has ${[...this.byPath.keys()].map((p) => `"${p}"`).join(', ')})`); return e; }
  /** Register something to undo when this instance is destroyed (runs in reverse order). */
  own(fn) { this.cleanups.push(fn); return this; }
  /** Remove every entity and run the cleanups. Safe to call twice. */
  destroy() { this.spawner.destroy(this); }
}

/**
 * Makes entities from prefabs and takes them apart again. `spawn(name, { at, params, overrides, parent, local, id })` returns an
 * `Instance`; `extra(key, handler)` teaches it what the game's own data (physics bodies, meshes) means; `capture(instance)` gives
 * just what changed since the spawn, for saves.
 */
export class PrefabSpawner {
  /**
   * @param {import('../../core/src/index.js').World} world
   * @param {import('./library.js').PrefabLibrary} library
   * @param {{strictExtras?: boolean}} [o] With `strictExtras`, an extras key nobody handles is an error (default: ignored, so data may carry things only some games use).
   */
  constructor(world, library, { strictExtras = false } = {}) {
    this.world = world; this.library = library; this.strictExtras = strictExtras;
    this.handlers = new Map();
    /** Extras keys whose handler runs after the part's children exist (to wire things between parts). */
    this.lateKeys = new Set();
    this.listeners = new Map();
    for (const { component } of library.registry.items.values()) world.register(component);
    // components added to the registry later are registered on first use
    this.live = new Set();
    /** Every instance alive, in the order they were spawned. */
    this.instances = new Map();
    this.nextInstanceId = 1;
  }

  /**
   * Teach the spawner what an `extras` key means: `fn(value, { entity, instance, world, spec, path })` is called for every part that
   * has it, after its components exist (or, with `{ after: true }`, after its children have been made too). Return a function to be run when the instance is destroyed.
   * @example spawner.extra('body', (cfg, ctx) => { const b = physics.add(new RigidBody({...cfg})); return () => physics.remove(b); });
   */
  extra(key, fn, { after = false } = {}) { this.handlers.set(key, fn); if (after) this.lateKeys.add(key); else this.lateKeys.delete(key); return this; }

  /** Call `fn(instance)` after every spawn (`'spawn'`) or before every destroy (`'destroy'`). */
  on(event, fn) { let l = this.listeners.get(event); if (!l) this.listeners.set(event, l = []); l.push(fn); return this; }
  #emit(event, instance) { for (const fn of this.listeners.get(event) ?? []) fn(instance); }

  /**
   * Make an entity (and its children) from a prefab.
   * @param {string} name
   * @param {object} [o]
   * @param {{x?: number, y?: number, z?: number, yaw?: number, rotation?: number[], scale?: number}} [o.at] Where to put the root (position, a yaw in radians or a quaternion `rotation`, a uniform scale).
   * @param {Record<string, any>} [o.params] The prefab's named knobs, e.g. `{ hp: 80 }`.
   * @param {Record<string, any>} [o.overrides] Changes to any part of the resolved prefab: `{ components: { health: { hp: 5 } } }` or dotted `{ 'components.health.hp': 5, 'children.lamp.components.light.intensity': 2 }`; `null` removes a component or a child.
   * @param {number} [o.parent] Attach the root to this entity.
   * @param {Record<string, any>} [o.local] The root's pose relative to `parent`.
   * @param {number} [o.id] Give the instance this id (loading a save); otherwise the next free one.
   * @returns {Instance}
   */
  spawn(name, { at, params, overrides, parent, local, id } = {}) {
    const spec = this.library.resolve(name);
    for (const [pn, value] of Object.entries(params ?? {})) {
      const target = spec.params[pn];
      if (!target) throw new Error(`prefab "${name}" has no parameter "${pn}" (it has ${Object.keys(spec.params).join(', ') || 'none'})`);
      this.#applyOverrides(spec, expandPaths({ [target]: value }));
    }
    if (overrides) this.#applyOverrides(spec, isObject(overrides) && Object.keys(overrides).some((k) => k.includes('.')) ? expandPaths(overrides) : overrides);
    const instanceId = id ?? this.nextInstanceId;
    if (this.instances.has(instanceId)) throw new Error(`prefab instance ${instanceId} already exists`);
    if (instanceId >= this.nextInstanceId) this.nextInstanceId = instanceId + 1;
    const instance = new Instance(this, name, spec, instanceId);
    /** What this instance was spawned with (parameters and overrides), as plain data: extras are not captured, so a save keeps these to spawn the same thing again. */
    instance.options = clone({ params: params ?? {}, overrides: overrides ?? {} });
    this.instances.set(instanceId, instance);
    try {
      this.#build(instance, spec, '', parent, local ?? spec.local, at);
    } catch (e) { this.destroy(instance); throw e; }
    this.#emit('spawn', instance);
    return instance;
  }

  /** Destroy an instance's entities (children first) and run its cleanups. */
  destroy(instance) {
    if (!instance.alive) return;
    this.#emit('destroy', instance);
    instance.alive = false;
    this.instances.delete(instance.id);
    for (let i = instance.cleanups.length - 1; i >= 0; i--) { try { instance.cleanups[i](); } catch (e) { console.error(`prefab "${instance.prefab}" cleanup failed:`, e); } }
    for (let i = instance.entities.length - 1; i >= 0; i--) this.world.destroy(instance.entities[i]);
    instance.entities.length = 0; instance.cleanups.length = 0; instance.byPath.clear();
  }

  #applyOverrides(spec, o) {
    const { children, ...rest } = o;
    // a null component or tags removes them; null children are removed after merging
    for (const [k, v] of Object.entries(rest.components ?? {})) if (v === null) { delete spec.components[k]; delete rest.components[k]; }
    mergeDeep(spec, rest);
    if (children !== undefined) {
      if (Array.isArray(children)) throw new Error('overrides.children must be an object keyed by child name');
      for (const [cn, co] of Object.entries(children)) {
        const i = spec.children.findIndex((c) => c.name === cn);
        if (i < 0) throw new Error(`prefab "${spec.name}" has no child "${cn}" (it has ${spec.children.map((c) => c.name).join(', ') || 'none'})`);
        if (co === null) { spec.children.splice(i, 1); continue; }
        const c = spec.children[i], { components, extras, local, tags, ...more } = co;
        c.overrides = c.overrides ?? {}; // applied when the child's own prefab has been resolved
        mergeDeep(c.overrides, { components: components ?? {}, extras: extras ?? {}, ...(more.children ? { children: more.children } : {}), ...(local ? { local } : {}) });
        if (tags) c.tags = [...new Set([...(c.tags ?? []), ...tags])];
        if (local) c.local = { ...(c.local ?? {}), ...local };
        if (components) { c.components ??= {}; for (const [k, v] of Object.entries(components)) { if (v === null) delete c.components[k]; else mergeDeep(c.components, { [k]: v }); } }
        if (extras) mergeDeep(c.extras ??= {}, extras);
      }
    }
  }

  #setComponent(entity, name, values, where) {
    const entry = this.library.registry.get(name);
    if (!entry) throw new Error(`${where}: unknown component "${name}" (registered: ${this.library.registry.names.join(', ')})`);
    const { component } = entry;
    if (!this.live.has(component)) { this.world.register(component); this.live.add(component); }
    const out = {};
    for (const [f, v] of Object.entries(values ?? {})) {
      if (!component.fields.includes(f)) throw new Error(`${where}: component "${name}" has no field "${f}" (it has ${component.fields.join(', ')})`);
      out[f] = this.library.registry.toNumber(name, f, v);
    }
    this.world.add(entity, component, out);
  }

  #build(instance, spec, path, parent, local, at) {
    const world = this.world, where = `prefab "${instance.prefab}"${path ? `/${path}` : ''}`;
    const e = world.create();
    instance.entities.push(e);
    instance.byPath.set(path, e);
    if (path === '') instance.root = e;
    const comps = spec.components ?? {};
    for (const [cn, values] of Object.entries(comps)) if (cn !== 'transform') this.#setComponent(e, cn, values, where);
    if (spec.tags?.length) { let bits = 0; for (const t of spec.tags) bits |= this.library.tag(t); this.#setComponent(e, 'tags', { bits: bits >>> 0 }, where); }
    // placement: a world transform, from the spec and `at` (roots), or composed from the parent and the local pose (children)
    const t = { ...IDENTITY, ...(comps.transform ?? {}) };
    if (at) this.#applyAt(t, at);
    if (parent !== undefined) {
      const l = { ...IDENTITY, ...(local ?? {}) };
      if (local?.yaw !== undefined) this.#yaw(l, local.yaw);
      this.#setComponent(e, 'parent', { id: parent }, where);
      this.#setComponent(e, 'local', l, where);
      if (world.has(parent, Transform)) { const pw = world.data(Transform), pi = parent & 0xfffff; composeTransform(t, pw, pi, l); }
      this.#setComponent(e, 'transform', t, where);
    } else if (comps.transform || at) this.#setComponent(e, 'transform', t, where);

    const runExtras = (late) => {
      for (const [key, value] of Object.entries(spec.extras ?? {})) {
        const h = this.handlers.get(key);
        if (!h) { if (!late && this.strictExtras) throw new Error(`${where}: nobody handles extras "${key}" (handled: ${[...this.handlers.keys()].join(', ') || 'none'})`); continue; }
        if (this.lateKeys.has(key) !== late) continue;
        const cleanup = h(value, { entity: e, instance, world, spec, path });
        if (typeof cleanup === 'function') instance.own(cleanup);
      }
    };
    runExtras(false);
    for (const c of spec.children ?? []) {
      let child;
      if (c.prefab !== undefined) {
        child = this.library.resolve(c.prefab);
        mergeDeep(child.components, c.components ?? {}); mergeDeep(child.extras, c.extras ?? {});
        child.tags = [...new Set([...child.tags, ...(c.tags ?? [])])];
        if (c.overrides) this.#applyOverrides(child, c.overrides);
        child.name = c.prefab;
      } else child = { ...clone(c), tags: c.tags ?? [], components: clone(c.components ?? {}), extras: clone(c.extras ?? {}), children: clone(c.children ?? []) };
      this.#build(instance, child, path ? `${path}/${c.name}` : c.name, e, c.local ?? child.local ?? {}, undefined);
    }
    runExtras(true);
  }

  #yaw(t, yaw) { t.qx = 0; t.qy = sin(yaw / 2); t.qz = 0; t.qw = cos(yaw / 2); }
  #applyAt(t, at) {
    if (at.x !== undefined) t.x = at.x; if (at.y !== undefined) t.y = at.y; if (at.z !== undefined) t.z = at.z;
    if (at.yaw !== undefined) this.#yaw(t, at.yaw);
    if (at.rotation) { t.qx = at.rotation[0]; t.qy = at.rotation[1]; t.qz = at.rotation[2]; t.qw = at.rotation[3]; }
    if (at.scale !== undefined) t.sx = t.sy = t.sz = at.scale;
  }

  /**
   * What differs now from what the prefab says, as overrides: spawn the prefab again with these and you get the same thing back.
   * Includes changed component values (relative to the prefab's own, not counting this instance's parameters and overrides), components
   * added or removed since, changed tags, children's local poses, and children that were destroyed. Extras are not captured: they are
   * the game's own business.
   * @returns {{prefab: string, overrides: Record<string, any>}}
   */
  capture(instance) {
    const base = this.library.resolve(instance.prefab), world = this.world, reg = this.library.registry;
    const overrides = {};
    const walk = (spec, path, prefix) => {
      const e = instance.byPath.get(path);
      const isChild = path !== '';
      if (e === undefined || !world.isAlive(e)) { if (isChild) overrides[prefix.slice(0, -1)] = null; return; }
      for (const [cn, { component }] of reg.items) {
        if (cn === 'parent' || cn === 'tags') continue;
        const present = world.has(e, component), inSpec = cn in (spec.components ?? {});
        if (cn === 'transform' && isChild) continue; // a child's world transform follows from its parent; its local pose is captured below
        if (cn === 'local') {
          if (!present) continue;
          const d = world.data(component), i = e & 0xfffff, now = {}, was = { ...IDENTITY, ...(spec.local ?? {}) };
          for (const f of component.fields) { const a = d[f][i], b = component.schema[f] === 'f32' ? Math.fround(was[f]) : was[f]; if (a !== b) now[f] = a; }
          if (Object.keys(now).length) overrides[`${prefix}local`] = now;
          continue;
        }
        if (present !== inSpec) {
          if (present) { const d = world.data(component), i = e & 0xfffff, all = {}; for (const f of component.fields) all[f] = d[f][i]; overrides[`${prefix}components.${cn}`] = all; }
          else overrides[`${prefix}components.${cn}`] = null;
          continue;
        }
        if (!present) continue;
        const d = world.data(component), i = e & 0xfffff, now = {};
        for (const f of component.fields) {
          const want = spec.components?.[cn]?.[f];
          const wantNum = want === undefined ? (cn === 'transform' ? IDENTITY[f] : 0) : reg.toNumber(cn, f, want);
          const expected = component.schema[f] === 'f32' ? Math.fround(wantNum) : wantNum;
          if (d[f][i] !== expected) now[f] = d[f][i];
        }
        if (Object.keys(now).length) overrides[`${prefix}components.${cn}`] = Object.assign(overrides[`${prefix}components.${cn}`] ?? {}, now);
      }
      if (world.has(e, Tags)) {
        const bits = world.data(Tags).bits[e & 0xfffff] >>> 0;
        let want = 0; for (const t of spec.tags ?? []) want |= this.library.tag(t);
        if (bits !== want >>> 0) overrides[`${prefix}tags`] = this.library.tagNames(bits);
      }
      for (const c of spec.children ?? []) {
        const childSpec = c.prefab !== undefined ? mergeChildSpec(this.library, c) : { ...c, components: c.components ?? {}, children: c.children ?? [] };
        walk(childSpec, path ? `${path}/${c.name}` : c.name, `${prefix}children.${c.name}.`);
      }
    };
    walk(base, '', '');
    return { prefab: instance.prefab, overrides };
  }
}

function mergeChildSpec(library, c) {
  const child = library.resolve(c.prefab);
  mergeDeep(child.components, c.components ?? {});
  child.local = { ...(child.local ?? {}), ...(c.local ?? {}) };
  return child;
}
