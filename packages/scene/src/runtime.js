// Putting a scene into a running game, and taking it out again.
import { normalizeScene, validateScene, SceneError, clone } from './format.js';

/** A scene that has been spawned. */
export class LoadedScene {
  constructor(spawner, name, settings) {
    this.spawner = spawner; this.name = name; this.settings = settings;
    /** @type {Map<string, import('../../prefab/src/spawner.js').Instance>} scene entity id -> prefab instance */ this.instances = new Map();
    this.assets = [];
    this.alive = true;
  }
  /** The instance of a scene entity (throws if the scene has no such entity). */
  get(id) { const i = this.instances.get(id); if (!i) throw new Error(`scene "${this.name}" has no entity "${id}" (it has ${[...this.instances.keys()].slice(0, 8).map((k) => `"${k}"`).join(', ')}${this.instances.size > 8 ? ', …' : ''})`); return i; }
  /** The scene entity id of a prefab instance, or null if it did not come from this scene. */
  idOf(instance) { for (const [id, i] of this.instances) if (i === instance) return id; return null; }
  /** Destroy everything the scene spawned (children before parents) and release its assets. */
  unload() {
    if (!this.alive) return;
    this.alive = false;
    for (const i of [...this.instances.values()].reverse()) i.destroy();
    this.instances.clear();
    for (const h of this.assets) h.manager.release(h);
    this.assets = [];
  }
}

/**
 * Load a scene's assets, then spawn its entities. Parents are spawned before their children; a child's `at` is relative to its parent.
 * @param {any} data The scene file (parsed JSON; older versions are upgraded).
 * @param {import('../../prefab/src/spawner.js').PrefabSpawner} spawner
 * @param {object} [o]
 * @param {import('../../assets/src/manager.js').AssetManager} [o.assets] Loads the scene's `assets` first (and holds them until the scene is unloaded).
 * @param {{x?: number, y?: number, z?: number}} [o.offset] Move the whole scene (streaming levels side by side). Only applies to entities without a parent.
 * @param {(p: {loaded: number, total: number, path: string}) => void} [o.onProgress]
 * @param {boolean} [o.validate] Check the scene against the prefab library first (default true): every problem is reported together, before anything spawns.
 * @param {(entity: any) => boolean} [o.filter] Skip entities (and their children) for which this returns false.
 * @returns {Promise<LoadedScene>}
 */
export async function loadScene(data, spawner, { assets, offset, onProgress, validate = true, filter } = {}) {
  const scene = normalizeScene(data);
  scene.prefabs.forEach((p) => spawner.library.define(p));
  if (validate) {
    const problems = validateScene(scene, { library: spawner.library }).filter((p) => p.severity === 'error');
    if (problems.length) throw new SceneError(`scene "${scene.name}" has ${problems.length} problem${problems.length === 1 ? '' : 's'}`, problems);
  }
  const loaded = new LoadedScene(spawner, scene.name, scene.settings);
  try {
    if (assets && scene.assets.length) loaded.assets = await assets.loadAll(scene.assets.map((a) => ({ type: a.type, path: a.path })), { onProgress });
    spawnEntities(scene, spawner, loaded, { offset, filter });
  } catch (e) { loaded.unload(); throw e; }
  return loaded;
}

/** Spawn the entities of an already-normalized scene into `loaded` (shared by `loadScene` and the editor's play mode). */
export function spawnEntities(scene, spawner, loaded, { offset, filter } = {}) {
  const byId = new Map(scene.entities.map((e) => [e.id, e]));
  const skipped = new Set();
  const done = new Set();
  const spawn = (e) => {
    if (done.has(e.id) || skipped.has(e.id)) return;
    const parent = e.parent ? byId.get(e.parent) : null;
    if (parent) spawn(parent);
    if ((parent && skipped.has(parent.id)) || e.disabled || (filter && !filter(e))) { skipped.add(e.id); return; }
    const o = { params: clone(e.params), overrides: clone(e.overrides) };
    const at = e.at ? { ...e.at } : {};
    if (parent) {
      const local = { ...at }; delete local.rotation; delete local.scale;
      if (at.rotation) [local.qx, local.qy, local.qz, local.qw] = at.rotation;
      if (at.scale !== undefined) local.sx = local.sy = local.sz = at.scale;
      o.parent = loaded.instances.get(parent.id).root; o.local = local;
    } else {
      if (offset) { at.x = (at.x ?? 0) + (offset.x ?? 0); at.y = (at.y ?? 0) + (offset.y ?? 0); at.z = (at.z ?? 0) + (offset.z ?? 0); }
      o.at = at;
    }
    const inst = spawner.spawn(e.prefab, o);
    inst.sceneId = e.id;
    loaded.instances.set(e.id, inst);
    done.add(e.id);
  };
  for (const e of scene.entities) spawn(e);
}
