// The scene file: a level as data. Entities are prefab instances with a name, a place, parameters and overrides, and an optional parent.
//
// { "format": "engine-scene", "version": 1, "name": "Warehouse",
//   "settings": { ... anything the game wants: sky, gravity, music },
//   "assets": [ { "type": "texture", "path": "tex/brick.png" } ],        // loaded before the scene starts
//   "prefabs": [ ... ],                                                  // prefabs only this scene uses
//   "editor": { ... optional: where an editor left its 3D cursor and so on; games ignore it },
//   "entities": [ { "id": "door-1", "prefab": "sliding_door", "at": { "x": 0, "z": 22, "yaw": 1.57 },
//                   "params": { }, "overrides": { }, "parent": null } ] }

/** The `format` field of every scene file (`"engine-scene"`). */
export const SCENE_FORMAT = 'engine-scene';
/** The version of the scene file format this code writes and reads. */
export const SCENE_VERSION = 1;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const AT_KEYS = new Set(['x', 'y', 'z', 'yaw', 'rotation', 'scale']);
const ENTITY_KEYS = new Set(['id', 'prefab', 'name', 'at', 'params', 'overrides', 'parent', 'tags', 'disabled', 'notes']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** An empty scene. */
export function emptyScene(name = 'Untitled') {
  return { format: SCENE_FORMAT, version: SCENE_VERSION, name, settings: {}, assets: [], prefabs: [], entities: [] };
}

/** A failure to read a scene, with every problem found. */
export class SceneError extends Error {
  constructor(message, problems = []) { super(problems.length ? `${message}:\n  ${problems.map((p) => `${p.path}: ${p.message}`).join('\n  ')}` : message); this.name = 'SceneError'; this.problems = problems; }
}

/**
 * Bring an older scene up to the current version, one step at a time.
 * @param {any} data
 * @param {Record<number, (scene: any) => any>} [migrations] `{ 1: (scene) => sceneAtVersion2 }`
 */
export function migrateScene(data, migrations = {}) {
  if (!isObject(data) || data.format !== SCENE_FORMAT) throw new SceneError('this is not a scene file', [{ path: 'format', message: `expected "${SCENE_FORMAT}"` }]);
  if (data.version > SCENE_VERSION) throw new SceneError(`this scene was saved by a newer editor (format ${data.version}; this reads up to ${SCENE_VERSION})`);
  let s = clone(data);
  for (let v = s.version ?? 1; v < SCENE_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new SceneError(`no way to upgrade a scene from format ${v} to ${v + 1}`);
    s = step(s) ?? s; s.version = v + 1;
  }
  return s;
}

/** Fill in the optional parts so code can rely on them. @returns {any} a new object */
export function normalizeScene(data) {
  const s = migrateScene(data);
  return {
    format: SCENE_FORMAT, version: SCENE_VERSION, name: s.name ?? 'Untitled', settings: s.settings ?? {}, assets: s.assets ?? [], prefabs: s.prefabs ?? [],
    entities: (s.entities ?? []).map((e) => ({ ...e, parent: e.parent ?? null })),
    ...(s.editor === undefined ? {} : { editor: s.editor }),
  };
}

/**
 * Every problem in a scene, without loading anything. Problems are `{path, message, severity}` with paths like `entities[3].prefab`.
 * @param {any} data
 * @param {{library?: import('../../prefab/src/library.js').PrefabLibrary, assetTypes?: string[]}} [o] With a library, prefab names and parameters are checked too.
 * @returns {Array<{path: string, message: string, severity: 'error' | 'warning'}>}
 */
export function validateScene(data, { library, assetTypes } = {}) {
  const out = [];
  const err = (path, message) => out.push({ path, message, severity: 'error' });
  const warn = (path, message) => out.push({ path, message, severity: 'warning' });
  if (!isObject(data) || data.format !== SCENE_FORMAT) { err('format', `expected "${SCENE_FORMAT}"`); return out; }
  if (!Number.isInteger(data.version) || data.version < 1) err('version', 'must be a whole number from 1');
  else if (data.version > SCENE_VERSION) err('version', `format ${data.version} is newer than this reads (${SCENE_VERSION})`);
  if (data.settings !== undefined && !isObject(data.settings)) err('settings', 'must be an object');
  if (data.editor !== undefined && !isObject(data.editor)) err('editor', 'must be an object');
  const local = new Set();
  if (data.prefabs !== undefined) {
    if (!Array.isArray(data.prefabs)) err('prefabs', 'must be a list');
    else data.prefabs.forEach((p, i) => { if (!isObject(p) || typeof p.name !== 'string' || p.name === '') err(`prefabs[${i}]`, 'needs a name'); else local.add(p.name); });
  }
  if (data.assets !== undefined) {
    if (!Array.isArray(data.assets)) err('assets', 'must be a list');
    else data.assets.forEach((a, i) => {
      if (!isObject(a) || typeof a.path !== 'string' || a.path === '') err(`assets[${i}]`, 'needs a path');
      else if (assetTypes && a.type !== undefined && !assetTypes.includes(a.type)) err(`assets[${i}].type`, `unknown asset type "${a.type}" (known: ${assetTypes.join(', ')})`);
    });
  }
  if (!Array.isArray(data.entities ?? [])) { err('entities', 'must be a list'); return out; }
  const ents = data.entities ?? [], ids = new Map();
  ents.forEach((e, i) => {
    const p = `entities[${i}]`;
    if (!isObject(e)) { err(p, 'must be an object'); return; }
    if (typeof e.id !== 'string' || !ID.test(e.id)) err(`${p}.id`, `needs an id of letters, digits and - _ . : (up to 64), got ${JSON.stringify(e.id)}`);
    else if (ids.has(e.id)) err(`${p}.id`, `"${e.id}" is used twice (also entities[${ids.get(e.id)}])`);
    else ids.set(e.id, i);
    if (typeof e.prefab !== 'string' || e.prefab === '') err(`${p}.prefab`, 'needs the name of a prefab');
    else if (library && !library.has(e.prefab) && !local.has(e.prefab)) {
      const near = [...library.names, ...local].filter((n) => n.includes(e.prefab) || e.prefab.includes(n)).slice(0, 3);
      err(`${p}.prefab`, `no prefab called "${e.prefab}"${near.length ? ` (did you mean ${near.map((n) => `"${n}"`).join(', ')}?)` : ''}`);
    } else if (library && library.has(e.prefab) && isObject(e.params)) {
      try { const spec = library.resolve(e.prefab); for (const k of Object.keys(e.params)) if (!spec.params[k]) err(`${p}.params.${k}`, `prefab "${e.prefab}" has no parameter "${k}" (it has ${Object.keys(spec.params).join(', ') || 'none'})`); } catch (x) { err(`${p}.prefab`, x.message); }
    }
    if (e.at !== undefined) {
      if (!isObject(e.at)) err(`${p}.at`, 'must be an object like { "x": 0, "y": 0, "z": 0 }');
      else for (const [k, v] of Object.entries(e.at)) {
        if (!AT_KEYS.has(k)) warn(`${p}.at.${k}`, `unknown placement field (known: ${[...AT_KEYS].join(', ')})`);
        else if (k === 'rotation' ? !(Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) : !Number.isFinite(v)) err(`${p}.at.${k}`, k === 'rotation' ? 'must be four numbers [x, y, z, w]' : 'must be a finite number');
      }
    }
    for (const k of ['params', 'overrides']) if (e[k] !== undefined && !isObject(e[k])) err(`${p}.${k}`, 'must be an object');
    for (const k of Object.keys(e)) if (!ENTITY_KEYS.has(k)) warn(`${p}.${k}`, 'unknown field (ignored)');
  });
  ents.forEach((e, i) => {
    if (!isObject(e) || e.parent === undefined || e.parent === null) return;
    if (!ids.has(e.parent)) err(`entities[${i}].parent`, `no entity called "${e.parent}"`);
    else {
      const seen = new Set([e.id]); let cur = e.parent;
      while (cur !== null && cur !== undefined) { if (seen.has(cur)) { err(`entities[${i}].parent`, `"${e.id}" is its own ancestor (cycle through "${cur}")`); break; } seen.add(cur); cur = ents[ids.get(cur)]?.parent; }
    }
  });
  return out;
}
