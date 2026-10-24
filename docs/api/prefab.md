# @engine/prefab

Entity templates as JSON: inheritance, children, parameters, overrides, parent-child transforms, capturing what changed for saves.

```
npm install @engine/prefab
```

Version 0.1.0. The package's own README ([packages/prefab](../../packages/prefab/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (13 of 13 documented)

| Name | Kind | Summary |
|---|---|---|
| [`ComponentRegistry`](#class-componentregistry) | class | Which components a prefab file may name, with the fields each takes (and optional named values for a field, like `team: red`). |
| [`IDENTITY`](#identity) | constant | Identity values for Transform / LocalTransform (a new component starts all zero, which is not a valid rotation or scale). |
| [`Instance`](#class-instance) | class | One spawned prefab: its entities by path, and whatever the game attached to it (physics bodies, meshes) to clean up with it. |
| [`LocalTransform`](#localtransform) | constant | Pose relative to the parent; the `TransformSystem` turns it into a world `Transform`. |
| [`Parent`](#parent) | constant | The entity this one is attached to (an entity id; 0 means none: ids start at slot 0 generation 0, so check `has(Parent)` instead of the value). |
| [`PrefabLibrary`](#class-prefablibrary) | class | A library of prefabs. |
| [`PrefabSpawner`](#class-prefabspawner) | class | Makes entities from prefabs and takes them apart again. |
| [`Tags`](#tags) | constant | Up to 32 tags as bits (see `PrefabLibrary.tag(name)`): "enemy", "breakable". |
| [`Transform`](#transform) | constant | Position, orientation (a quaternion) and scale in world space. |
| [`TransformSystem`](#class-transformsystem) | class | Keeps world `Transform`s of attached entities up to date from their `LocalTransform`s, parents before children. |
| [`composeTransform`](#composetransform) | function | parent (world) composed with local, into `out` ({x, y, z, qx.., sx..}). |
| [`expandPaths`](#expandpaths) | function | `{ 'components.health.hp': 5 }` -> `{ components: { health: { hp: 5 } } }` (keys without dots are kept; a dotted key is split at dots). |
| [`mergeDeep`](#mergedeep) | function | Deep merge: objects merge key by key, everything else (numbers, strings, arrays) is replaced. |

## Functions

### `composeTransform`

```js
function composeTransform(out, pw, pi, l)
```

parent (world) composed with local, into `out` ({x, y, z, qx.., sx..}). `pw` is the Transform component's data and `pi` the parent's slot.

<sub>src/transform.js:6</sub>

### `expandPaths`

```js
function expandPaths(flat)
```

`{ 'components.health.hp': 5 }` -> `{ components: { health: { hp: 5 } } }` (keys without dots are kept; a dotted key is split at dots).

<sub>src/library.js:18</sub>

### `mergeDeep`

```js
function mergeDeep(a, b)
```

Deep merge: objects merge key by key, everything else (numbers, strings, arrays) is replaced. Returns `a`.

<sub>src/library.js:9</sub>

## Classes

### `class ComponentRegistry`

```js
class ComponentRegistry
```

Which components a prefab file may name, with the fields each takes (and optional named values for a field, like `team: red`).

#### `ComponentRegistry.constructor`

```js
constructor()
```

#### `ComponentRegistry.add`

```js
add(component, { enums = {} } = {})
```

| Name | Type | Description |
|---|---|---|
| `component` | `import('../../core/src/index.js').Component` |  |
| `o` (optional) | `{enums?: Record<string, Record<string, number>>}` |  |

#### `ComponentRegistry.get`

```js
get(name)
```

#### `ComponentRegistry.names`

```js
get names
```

#### `ComponentRegistry.toNumber`

```js
toNumber(componentName, field, v)
```

Turn a spec value into the number stored: numbers as they are, booleans 1 / 0, strings through the field's named values.

<sub>src/library.js:31</sub>

### `class Instance`

```js
class Instance
```

One spawned prefab: its entities by path, and whatever the game attached to it (physics bodies, meshes) to clean up with it.

#### `Instance.constructor`

```js
constructor(spawner, name, spec, id)
```

#### `Instance.get`

```js
get(path = '')
```

The entity at a path ('' = the root).

#### `Instance.own`

```js
own(fn)
```

Register something to undo when this instance is destroyed (runs in reverse order).

#### `Instance.destroy`

```js
destroy()
```

Remove every entity and run the cleanups. Safe to call twice.

<sub>src/spawner.js:11</sub>

### `class PrefabLibrary`

```js
class PrefabLibrary
```

A library of prefabs.

#### `PrefabLibrary.constructor`

```js
constructor(registry = new ComponentRegistry())
```

| Name | Type | Description |
|---|---|---|
| `registry` (optional) | `ComponentRegistry` |  |

#### `PrefabLibrary.tag`

```js
tag(name)
```

The bit for a tag name (assigned in order of first use, at most 32).

#### `PrefabLibrary.tagNames`

```js
tagNames(bits)
```

Tag names in a bit set.

#### `PrefabLibrary.define`

```js
define(spec)
```

Add a prefab (or a list of them). A prefab with the same name replaces the old one.

**Returns** `this`

#### `PrefabLibrary.load`

```js
load(data)
```

Load prefabs from parsed JSON: an array of specs, or `{ prefabs: [...] }`.

#### `PrefabLibrary.has`

```js
has(name)
```

#### `PrefabLibrary.names`

```js
get names
```

#### `PrefabLibrary.resolve`

```js
resolve(name, stack = [])
```

The prefab with everything it inherits merged in: bases first (`extends` may be a name or a list), then its own values on top.
Components and extras merge field by field; tags are united; children merge by name (a child of the same name changes the inherited
one, a new name adds one); `params` merge by name. The result is a new object you may keep.

**Returns** `any`

#### `PrefabLibrary.validate`

```js
validate()
```

Check every prefab against the registry: components and fields exist, values can be numbers, child prefabs exist, no circles,
parameters point at something. Throws an error listing every problem found.

#### `PrefabLibrary.toJSON`

```js
toJSON()
```

All prefabs as plain JSON (the inverse of `load`).

<sub>src/library.js:56</sub>

### `class PrefabSpawner`

```js
class PrefabSpawner
```

Makes entities from prefabs and takes them apart again. `spawn(name, { at, params, overrides, parent, local, id })` returns an
`Instance`; `extra(key, handler)` teaches it what the game's own data (physics bodies, meshes) means; `capture(instance)` gives
just what changed since the spawn, for saves.

#### `PrefabSpawner.constructor`

```js
constructor(world, library, { strictExtras = false } = {})
```

| Name | Type | Description |
|---|---|---|
| `world` | `import('../../core/src/index.js').World` |  |
| `library` | `import('./library.js').PrefabLibrary` |  |
| `o` (optional) | `{strictExtras?: boolean}` | With `strictExtras`, an extras key nobody handles is an error (default: ignored, so data may carry things only some games use). |

#### `PrefabSpawner.extra`

```js
extra(key, fn, { after = false } = {})
```

Teach the spawner what an `extras` key means: `fn(value, { entity, instance, world, spec, path })` is called for every part that
has it, after its components exist (or, with `{ after: true }`, after its children have been made too). Return a function to be run when the instance is destroyed.

#### `PrefabSpawner.on`

```js
on(event, fn)
```

Call `fn(instance)` after every spawn (`'spawn'`) or before every destroy (`'destroy'`).

#### `PrefabSpawner.spawn`

```js
spawn(name, { at, params, overrides, parent, local, id } = {})
```

Make an entity (and its children) from a prefab.

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `o` (optional) | `object` |  |
| `o.at` (optional) | `{x?: number, y?: number, z?: number, yaw?: number, rotation?: number[], scale?: number}` | Where to put the root (position, a yaw in radians or a quaternion `rotation`, a uniform scale). |
| `o.params` (optional) | `Record<string, any>` | The prefab's named knobs, e.g. `{ hp: 80 }`. |
| `o.overrides` (optional) | `Record<string, any>` | Changes to any part of the resolved prefab: `{ components: { health: { hp: 5 } } }` or dotted `{ 'components.health.hp': 5, 'children.lamp.components.light.intensity': 2 }`; `null` removes a component or a child. |
| `o.parent` (optional) | `number` | Attach the root to this entity. |
| `o.local` (optional) | `Record<string, any>` | The root's pose relative to `parent`. |
| `o.id` (optional) | `number` | Give the instance this id (loading a save); otherwise the next free one. |

**Returns** `Instance`

#### `PrefabSpawner.destroy`

```js
destroy(instance)
```

Destroy an instance's entities (children first) and run its cleanups.

#### `PrefabSpawner.capture`

```js
capture(instance)
```

What differs now from what the prefab says, as overrides: spawn the prefab again with these and you get the same thing back.
Includes changed component values (relative to the prefab's own, not counting this instance's parameters and overrides), components
added or removed since, changed tags, children's local poses, and children that were destroyed. Extras are not captured: they are
the game's own business.

**Returns** `{prefab: string, overrides: Record<string, any>}`

<sub>src/spawner.js:37</sub>

### `class TransformSystem`

```js
class TransformSystem
```

Keeps world `Transform`s of attached entities up to date from their `LocalTransform`s, parents before children. Call `update(world)` once per tick.

#### `TransformSystem.constructor`

```js
constructor(maxDepth = 32)
```

| Name | Type | Description |
|---|---|---|
| `maxDepth` (optional) | `number` | Deepest nesting looked at (a loop of parents stops there instead of hanging). |

#### `TransformSystem.update`

```js
update(world)
```

| Name | Type | Description |
|---|---|---|
| `world` | `import('../../core/src/index.js').World` |  |

**Returns** `number` — how many entities were updated

<sub>src/transform.js:23</sub>

## Constants

### `IDENTITY`

```js
const IDENTITY
```

Identity values for Transform / LocalTransform (a new component starts all zero, which is not a valid rotation or scale).

Value: `Object.freeze({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: `

<sub>src/components.js:15</sub>

### `LocalTransform`

```js
const LocalTransform
```

Pose relative to the parent; the `TransformSystem` turns it into a world `Transform`.

Value: `defineComponent('local', { x: 'f64', y: 'f64', z: 'f64', qx: 'f32', qy: 'f32', q`

<sub>src/components.js:10</sub>

### `Parent`

```js
const Parent
```

The entity this one is attached to (an entity id; 0 means none: ids start at slot 0 generation 0, so check `has(Parent)` instead of the value).

Value: `defineComponent('parent', { id: 'u32' })`

<sub>src/components.js:8</sub>

### `Tags`

```js
const Tags
```

Up to 32 tags as bits (see `PrefabLibrary.tag(name)`): "enemy", "breakable".

Value: `defineComponent('tags', { bits: 'u32' })`

<sub>src/components.js:12</sub>

### `Transform`

```js
const Transform
```

Position, orientation (a quaternion) and scale in world space.

Value: `defineComponent('transform', { x: 'f64', y: 'f64', z: 'f64', qx: 'f32', qy: 'f32`

<sub>src/components.js:6</sub>
