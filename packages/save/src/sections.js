// Ready-made sections for the engine's own subsystems. Each takes the subsystem and returns a `SectionDef` for `SaveGame.section(...)`.
// They only use the subsystems' public save / load methods, so this package depends on none of them.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
function mergeDeep(a, b) { for (const [k, v] of Object.entries(b)) { if (isObject(v) && isObject(a[k])) mergeDeep(a[k], v); else a[k] = clone(v); } return a; }
function expandPaths(flat) {
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

/**
 * The prefab scene: every live instance as its prefab name, its id and what differs from the prefab (see `PrefabSpawner.capture`).
 * Loading destroys the instances that exist and spawns the saved ones again with the same ids, so the game's extras handlers (physics
 * bodies, meshes) run exactly as they did the first time.
 * @param {import('../../prefab/src/spawner.js').PrefabSpawner} spawner
 * @param {{filter?: (instance: any) => boolean, version?: number, migrations?: Record<number, Function>}} [o] `filter` leaves out what should not be saved (bullets, effects).
 */
export function sceneSection(spawner, { filter = () => true, version = 1, migrations = {} } = {}) {
  return {
    version, migrations,
    save() {
      return {
        next: spawner.nextInstanceId,
        instances: [...spawner.instances.values()].filter(filter).map((i) => ({ id: i.id, options: i.options ?? {}, ...spawner.capture(i) })),
      };
    },
    load(data) {
      for (const i of [...spawner.instances.values()].reverse()) if (filter(i)) i.destroy();
      for (const s of data.instances) {
        // what it was spawned with (extras, such as a body's mass, are not part of the captured changes), then what changed since on top
        const overrides = mergeDeep(expandPaths(s.options?.overrides ?? {}), expandPaths(s.overrides));
        spawner.spawn(s.prefab, { params: s.options?.params, overrides, id: s.id });
      }
      spawner.nextInstanceId = Math.max(spawner.nextInstanceId, data.next);
    },
  };
}

/** A rigid-body world (`PhysicsWorld`): poses, velocities, sleep, contact and joint impulses. Register after the scene that creates the bodies. */
export function physicsSection(world, { version = 1, migrations = {} } = {}) {
  return { version, migrations, save: () => world.getState(), load: (data) => world.setState(data) };
}

/**
 * Objects with `save()` and `load(data)` (state machines, animation graphs, behaviour trees, memories), by name. Only the names present
 * in the save are loaded; objects that have gone since are skipped. `get` may return the current map (entities come and go).
 * @param {Record<string, {save: Function, load: Function}> | (() => Record<string, {save: Function, load: Function}>)} objects
 */
export function objectsSection(objects, { version = 1, migrations = {} } = {}) {
  const now = () => (typeof objects === 'function' ? objects() : objects);
  return {
    version, migrations,
    save() { const out = {}; for (const [k, o] of Object.entries(now())) out[k] = o.save(); return out; },
    load(data) { const cur = now(); for (const [k, d] of Object.entries(data)) cur[k]?.load(d); },
  };
}

/** Plain values the game keeps itself (score, level, flags): `get()` returns them as data, `set(data)` takes them back. */
export function valueSection(get, set, { version = 1, migrations = {} } = {}) {
  return { version, migrations, save: get, load: set };
}

/** A random generator whose state is a number (or a small array) at `rng.state`: saving it means the same dice after loading as without. */
export function rngSection(rng, { version = 1 } = {}) {
  return { version, save: () => rng.state, load: (s) => { rng.state = s; } };
}

/**
 * Every entity of an ECS world with its components, for games that do not use prefabs. Entities are made again on load (their ids change),
 * so fields that hold another entity's id are listed in `refs` and fixed up to the new ids.
 * @param {import('../../core/src/index.js').World} world
 * @param {Record<string, {component: any, refs?: string[]}>} components By name. `refs`: fields that hold entity ids.
 * @param {{filter?: (id: number) => boolean}} [o] Entities to leave out.
 */
export function ecsSection(world, components, { filter = () => true, version = 1, migrations = {} } = {}) {
  const entries = Object.entries(components);
  const ids = new Uint32Array(world.capacity);
  return {
    version, migrations,
    save() {
      const out = [];
      const { alive, generations, highWater } = world.entities;
      for (let i = 0; i < highWater; i++) {
        if (alive[i] !== 1) continue;
        const id = ((generations[i] << 20) | i) >>> 0;
        if (!filter(id)) continue;
        const comps = {};
        for (const [name, { component }] of entries) {
          if (!world.has(id, component)) continue;
          const d = world.data(component), v = {};
          for (const f of component.fields) v[f] = d[f][i];
          comps[name] = v;
        }
        out.push({ id, comps });
      }
      return out;
    },
    load(saved) {
      for (const [, { component }] of entries) { const n = world.query(ids, [component]); for (let k = 0; k < n; k++) if (filter(ids[k])) world.destroy(ids[k]); }
      const map = new Map();
      for (const e of saved) map.set(e.id, world.create());
      for (const e of saved) {
        const id = map.get(e.id);
        for (const [name, values] of Object.entries(e.comps)) {
          const spec = components[name];
          if (!spec) continue;
          const v = { ...values };
          for (const f of spec.refs ?? []) if (map.has(v[f])) v[f] = map.get(v[f]);
          world.add(id, spec.component, v);
        }
      }
    },
  };
}
