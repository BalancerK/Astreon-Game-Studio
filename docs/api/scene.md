# @engine/scene

Levels as data (scene files, validation, migrations, loading and unloading) and the undoable SceneDocument the editor uses.

```
npm install @engine/scene
```

Version 0.1.0. The package's own README ([packages/scene](../../packages/scene/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (11 of 11 documented)

| Name | Kind | Summary |
|---|---|---|
| [`LoadedScene`](#class-loadedscene) | class | A scene that has been spawned. |
| [`SCENE_FORMAT`](#scene_format) | constant | The `format` field of every scene file (`"engine-scene"`). |
| [`SCENE_VERSION`](#scene_version) | constant | The version of the scene file format this code writes and reads. |
| [`SceneDocument`](#class-scenedocument) | class | A scene being edited: add, remove, reparent, rename, duplicate and patch entities, with undo and redo (one step per operation, `batch` to group, `merge` to fold a drag into one step), change events and dirty tracking. |
| [`SceneError`](#class-sceneerror) | class | A failure to read a scene, with every problem found. |
| [`emptyScene`](#emptyscene) | function | An empty scene. |
| [`loadScene`](#loadscene) | function | Load a scene's assets, then spawn its entities. |
| [`migrateScene`](#migratescene) | function | Bring an older scene up to the current version, one step at a time. |
| [`normalizeScene`](#normalizescene) | function | Fill in the optional parts so code can rely on them. |
| [`spawnEntities`](#spawnentities) | function | Spawn the entities of an already-normalized scene into `loaded` (shared by `loadScene` and the editor's play mode). |
| [`validateScene`](#validatescene) | function | Every problem in a scene, without loading anything. |

## Functions

### `emptyScene`

```js
function emptyScene(name = 'Untitled')
```

An empty scene.

<sub>src/format.js:23</sub>

### `loadScene`

```js
async function loadScene(data, spawner, { assets, offset, onProgress, validate = true, filter } = {})
```

Load a scene's assets, then spawn its entities. Parents are spawned before their children; a child's `at` is relative to its parent.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `any` | The scene file (parsed JSON; older versions are upgraded). |
| `spawner` | `import('../../prefab/src/spawner.js').PrefabSpawner` |  |
| `o` (optional) | `object` |  |
| `o.assets` (optional) | `import('../../assets/src/manager.js').AssetManager` | Loads the scene's `assets` first (and holds them until the scene is unloaded). |
| `o.offset` (optional) | `{x?: number, y?: number, z?: number}` | Move the whole scene (streaming levels side by side). Only applies to entities without a parent. |
| `o.onProgress` (optional) | `(p: {loaded: number, total: number, path: string}) => void` |  |
| `o.validate` (optional) | `boolean` | Check the scene against the prefab library first (default true): every problem is reported together, before anything spawns. |
| `o.filter` (optional) | `(entity: any) => boolean` | Skip entities (and their children) for which this returns false. |

**Returns** `Promise<LoadedScene>`

<sub>src/runtime.js:39</sub>

### `migrateScene`

```js
function migrateScene(data, migrations = {})
```

Bring an older scene up to the current version, one step at a time.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `any` |  |
| `migrations` (optional) | `Record<number, (scene: any) => any>` | `{ 1: (scene) => sceneAtVersion2 }` |

<sub>src/format.js:37</sub>

### `normalizeScene`

```js
function normalizeScene(data)
```

Fill in the optional parts so code can rely on them.

**Returns** `any` — a new object

<sub>src/format.js:50</sub>

### `spawnEntities`

```js
function spawnEntities(scene, spawner, loaded, { offset, filter } = {})
```

Spawn the entities of an already-normalized scene into `loaded` (shared by `loadScene` and the editor's play mode).

<sub>src/runtime.js:55</sub>

### `validateScene`

```js
function validateScene(data, { library, assetTypes } = {})
```

Every problem in a scene, without loading anything. Problems are `{path, message, severity}` with paths like `entities[3].prefab`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `any` |  |
| `o` (optional) | `{library?: import('../../prefab/src/library.js').PrefabLibrary, assetTypes?: string[]}` | With a library, prefab names and parameters are checked too. |

**Returns** `Array<{path: string, message: string, severity: 'error' \| 'warning'}>`

<sub>src/format.js:65</sub>

## Classes

### `class LoadedScene`

```js
class LoadedScene
```

A scene that has been spawned.

#### `LoadedScene.constructor`

```js
constructor(spawner, name, settings)
```

#### `LoadedScene.get`

```js
get(id)
```

The instance of a scene entity (throws if the scene has no such entity).

#### `LoadedScene.idOf`

```js
idOf(instance)
```

The scene entity id of a prefab instance, or null if it did not come from this scene.

#### `LoadedScene.unload`

```js
unload()
```

Destroy everything the scene spawned (children before parents) and release its assets.

<sub>src/runtime.js:5</sub>

### `class SceneDocument`

```js
class SceneDocument
```

A scene being edited: add, remove, reparent, rename, duplicate and patch entities, with undo and redo (one step per operation,
`batch` to group, `merge` to fold a drag into one step), change events and dirty tracking. Always stays a valid scene file
(`toJSON()`).

#### `SceneDocument.constructor`

```js
constructor(data, { library, maxHistory = 200 } = {})
```

| Name | Type | Description |
|---|---|---|
| `data` (optional) | `any` | A scene file (or nothing for an empty one). |
| `o` (optional) | `{library?: import('../../prefab/src/library.js').PrefabLibrary, maxHistory?: number}` | With a `library`, new entities must name a known prefab. |

#### `SceneDocument.get`

```js
get(id)
```

#### `SceneDocument.has`

```js
has(id)
```

#### `SceneDocument.size`

```js
get size
```

#### `SceneDocument.entities`

```js
get entities
```

Entities in order.

#### `SceneDocument.children`

```js
children(id = null)
```

Children of an entity (or the roots, for null), in order.

#### `SceneDocument.subtree`

```js
subtree(id)
```

An entity and everything below it, parents first.

#### `SceneDocument.ancestors`

```js
ancestors(id)
```

#### `SceneDocument.toJSON`

```js
toJSON()
```

The scene as a file (a copy).

#### `SceneDocument.setEditor`

```js
setEditor(key, value)
```

Keep a note with the scene for the editor (a key and its value; `null` forgets it). It is saved with the scene but is not an edit: it cannot be undone and does not
make the scene "changed", so moving a 3D cursor does not ask to be saved.

#### `SceneDocument.validate`

```js
validate(o = {})
```

#### `SceneDocument.dirty`

```js
get dirty
```

#### `SceneDocument.markSaved`

```js
markSaved()
```

#### `SceneDocument.canUndo`

```js
get canUndo
```

#### `SceneDocument.canRedo`

```js
get canRedo
```

#### `SceneDocument.onChange`

```js
onChange(fn)
```

Call `fn(event)` after every change: `{kind: 'edit'|'undo'|'redo'|'load', label, ids}`.

**Returns** `() => void` — unsubscribe

#### `SceneDocument.batch`

```js
batch(label, fn, { merge } = {})
```

Run `fn` as one undo step. Everything it changes (even through several operations) is undone together; if it throws, nothing changed.

#### `SceneDocument.undo`

```js
undo()
```

#### `SceneDocument.redo`

```js
redo()
```

#### `SceneDocument.load`

```js
load(data)
```

Replace everything with another scene file; this cannot be undone and clears the history.

#### `SceneDocument.freeId`

```js
freeId(base)
```

A free id based on a name: 'crate' -> 'crate-1', 'crate-2'.

#### `SceneDocument.add`

```js
add(spec, { index } = {})
```

Add an entity.

| Name | Type | Description |
|---|---|---|
| `spec` | `{prefab: string, id?: string, name?: string, at?: object, params?: object, overrides?: object, parent?: string \| null}` |  |
| `o` (optional) | `{index?: number}` | Position among all entities (default: after its parent's last descendant, or at the end). |

**Returns** `string` — the id

#### `SceneDocument.remove`

```js
remove(id, { keepChildren = false } = {})
```

Remove an entity and everything below it (or, with `keepChildren`, lift its children to its parent).

#### `SceneDocument.update`

```js
update(id, patch, { merge, label } = {})
```

Change an entity: `patch` merges into it (`{ at: { x: 3 }, params: { hp: null } }`; null removes a key). `id` and `parent` cannot be patched here.
Pass `merge` (any string, e.g. 'drag') so a series of small changes while dragging is one undo step.

#### `SceneDocument.set`

```js
set(id, path, value, o)
```

Change one value by a path like 'at.x' or 'overrides.components.health.hp'.

#### `SceneDocument.reparent`

```js
reparent(id, parent, { before } = {})
```

Move an entity (and what is below it) under another entity, or to the top level (`null`), optionally before `beforeId`.

#### `SceneDocument.rename`

```js
rename(id, newId)
```

Give an entity another id; its children and any other reference follow.

#### `SceneDocument.duplicate`

```js
duplicate(id, { offset } = {})
```

Copy an entity with everything below it, placed right after the original.

**Returns** `string` — the id of the copy

#### `SceneDocument.setName`

```js
setName(name)
```

#### `SceneDocument.setSettings`

```js
setSettings(patch, o)
```

Merge into the scene's settings (null removes a key).

#### `SceneDocument.addAsset`

```js
addAsset(type, path)
```

#### `SceneDocument.removeAsset`

```js
removeAsset(path)
```

#### `SceneDocument.setPrefab`

```js
setPrefab(spec)
```

Define (or replace) a prefab that only this scene uses.

<sub>src/document.js:23</sub>

### `class SceneError`

```js
class SceneError extends Error
```

A failure to read a scene, with every problem found.

#### `SceneError.constructor`

```js
constructor(message, problems = [])
```

<sub>src/format.js:28</sub>

## Constants

### `SCENE_FORMAT`

```js
const SCENE_FORMAT
```

The `format` field of every scene file (`"engine-scene"`).

Value: `'engine-scene'`

<sub>src/format.js:12</sub>

### `SCENE_VERSION`

```js
const SCENE_VERSION
```

The version of the scene file format this code writes and reads.

Value: `1`

<sub>src/format.js:14</sub>
