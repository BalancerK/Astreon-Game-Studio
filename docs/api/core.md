# @engine/core

Fixed-timestep loop, typed-array ECS, plugin system, scheduler.

```
npm install @engine/core
```

Version 0.1.0. The package's own README ([packages/core](../../packages/core/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (16 of 16 documented)

| Name | Kind | Summary |
|---|---|---|
| [`App`](#class-app) | class | The application: a world, a scheduler of systems, an event bus, shared resources and the plugins that set them up. |
| [`ENGINE_VERSION`](#engine_version) | constant | The engine version plugins are checked against (their `engine` range must accept it). |
| [`EventBus`](#class-eventbus) | class | Synchronous event bus. |
| [`FixedLoop`](#class-fixedloop) | class | Fixed-timestep simulation loop. |
| [`INDEX_MASK`](#index_mask) | constant | Mask that keeps the slot-index bits of an entity id (the low 20 bits): `id & INDEX_MASK`. |
| [`MAX_ENTITIES`](#max_entities) | constant | The most entities that can exist at once (2^20). |
| [`PluginApp`](#class-pluginapp) | class | What a plugin sees in `setup(app)`. |
| [`Scheduler`](#class-scheduler) | class | Orders systems by before/after constraints (stable: ties keep registration order). |
| [`World`](#class-world) | class | Entities + struct-of-arrays component storage. |
| [`defineComponent`](#definecomponent) | function | Declare a component: a name and a schema of typed fields (`{ x: "f32", hp: "u8" }`). |
| [`definePlugin`](#defineplugin) | function | Validate and freeze a plugin definition. |
| [`entityGeneration`](#entitygeneration) | function | The generation part of an entity id (its high 12 bits). |
| [`entityIndex`](#entityindex) | function | The slot index part of an entity id (its low 20 bits): where its data lives in the component arrays. |
| [`parseVersion`](#parseversion) | function | Read a version string `x.y.z` as `[x, y, z]`; anything else throws. |
| [`resolvePlugins`](#resolveplugins) | function | Check dependencies and return plugins in load order (dependencies first). |
| [`satisfies`](#satisfies) | function | Does a version fit a range? |

## Functions

### `defineComponent`

```js
function defineComponent(name, schema)
```

Declare a component: a name and a schema of typed fields (`{ x: "f32", hp: "u8" }`). Components are stored as one typed array
per field; read them with `world.data(Component).x[id & INDEX_MASK]`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `schema` | `Record<string, keyof ARRAYS>` |  |

**Returns** `Component`

<sub>src/world.js:25</sub>

### `definePlugin`

```js
function definePlugin(def)
```

Validate and freeze a plugin definition.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `def` | `PluginDef` |  |

**Returns** `Readonly<PluginDef>`

<sub>src/plugin.js:19</sub>

### `entityGeneration`

```js
function entityGeneration(id)
```

The generation part of an entity id (its high 12 bits). Destroying an entity bumps its slot's generation, so a stale id is never
mistaken for a recycled one.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `id` | `number` |  |

<sub>src/entity.js:25</sub>

### `entityIndex`

```js
function entityIndex(id)
```

The slot index part of an entity id (its low 20 bits): where its data lives in the component arrays.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `id` | `number` |  |

<sub>src/entity.js:18</sub>

### `parseVersion`

```js
function parseVersion(v)
```

Read a version string `x.y.z` as `[x, y, z]`; anything else throws.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `v` | `string` |  |

<sub>src/semver.js:8</sub>

### `resolvePlugins`

```js
function resolvePlugins(plugins, engineVersion)
```

Check dependencies and return plugins in load order (dependencies first).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `plugins` | `Readonly<PluginDef>[]` |  |
| `engineVersion` | `string` |  |

**Returns** `Readonly<PluginDef>[]`

<sub>src/plugin.js:32</sub>

### `satisfies`

```js
function satisfies(version, range)
```

Does a version fit a range? Ranges are `*`, `x.y.z` (exactly), `^x.y.z` (same major, at least this) and `>=x.y.z`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `version` | `string` |  |
| `range` | `string` |  |

<sub>src/semver.js:25</sub>

## Classes

### `class App`

```js
class App
```

The application: a world, a scheduler of systems, an event bus, shared resources and the plugins that set them up. `use(plugin)`
loads plugins (dependencies resolved, setup run in load order); `update(dt, tick)` runs every system once.

#### `App.constructor`

```js
constructor({ capacity } = {})
```

| Name | Type | Description |
|---|---|---|
| `opts` (optional) | `{capacity?: number}` |  |

#### `App.registerComponent`

```js
registerComponent(comp)
```

| Name | Type | Description |
|---|---|---|
| `comp` | `import('./world.js').Component` |  |

#### `App.use`

```js
use(...plugins)
```

Resolve dependencies, then run each plugin's setup in load order.

| Name | Type | Description |
|---|---|---|
| `...plugins` | `Readonly<import('./plugin.js').PluginDef>` |  |

**Returns** `this`

#### `App.update`

```js
update(dt, tick)
```

Run all systems once.

| Name | Type | Description |
|---|---|---|
| `dt` | `number` | Seconds |
| `tick` | `number` |  |

<sub>src/app.js:62</sub>

### `class EventBus`

```js
class EventBus
```

Synchronous event bus. Plugins communicate through events, not each other's internals.

#### `EventBus.constructor`

```js
constructor()
```

#### `EventBus.on`

```js
on(name, fn)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` | Namespaced event name, e.g. `engine:entity-spawned`. |
| `fn` | `(payload: any) => void` |  |

**Returns** `() => void` — Unsubscribe function.

#### `EventBus.emit`

```js
emit(name, payload)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `payload` (optional) | `any` |  |

<sub>src/events.js:2</sub>

### `class FixedLoop`

```js
class FixedLoop
```

Fixed-timestep simulation loop. Runs identically on client and server:
the host feeds it elapsed time, it calls `update` at a constant rate and
`render` with an interpolation alpha. No timers or DOM inside, so it is
trivially testable and deterministic.

#### `FixedLoop.constructor`

```js
constructor({ tickRate, update, render, maxFrameTime = 0.25 })
```

| Name | Type | Description |
|---|---|---|
| `opts` | `object` |  |
| `opts.tickRate` | `number` | Simulation ticks per second. |
| `opts.update` | `(dt: number, tick: number) => void` | Called once per fixed tick (dt in seconds). |
| `opts.render` (optional) | `(alpha: number) => void` | Called per frame; alpha in [0,1) between last two ticks. |
| `opts.maxFrameTime` (optional) | `number` | Cap on elapsed time per advance, in seconds (spiral-of-death guard). |

#### `FixedLoop.advance`

```js
advance(elapsed)
```

Advance by `elapsed` seconds of real time.

| Name | Type | Description |
|---|---|---|
| `elapsed` | `number` |  |

**Returns** `number` — Number of ticks simulated.

<sub>src/loop.js:7</sub>

### `class PluginApp`

```js
class PluginApp
```

What a plugin sees in `setup(app)`. Everything it registers is namespaced
with the plugin id, so two plugins can never collide by accident.

#### `PluginApp.constructor`

```js
constructor(app, id)
```

| Name | Type | Description |
|---|---|---|
| `app` | `App` |  |
| `id` | `string` |  |

#### `PluginApp.defineComponent`

```js
defineComponent(name, schema)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `schema` | `Record<string, 'f32'\|'f64'\|'i8'\|'u8'\|'i16'\|'u16'\|'i32'\|'u32'>` |  |

#### `PluginApp.addSystem`

```js
addSystem(name, fn, { before = [], after = [] } = {})
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` | System name (namespaced automatically; before/after entries without a `:` refer to this plugin's own systems). |
| `fn` | `Function` | Called as `fn(dt, tick)`. |
| `opts` (optional) | `import('./scheduler.js').SystemOptions` |  |

#### `PluginApp.setResource`

```js
setResource(name, value)
```

Store a shared value other plugins can read by its namespaced name.

#### `PluginApp.getResource`

```js
getResource(name)
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` | Full namespaced name, e.g. `physics:grid`. |

#### `PluginApp.on`

```js
on(name, fn)
```

#### `PluginApp.emit`

```js
emit(name, payload)
```

<sub>src/app.js:13</sub>

### `class Scheduler`

```js
class Scheduler
```

Orders systems by before/after constraints (stable: ties keep registration
order). Constraints naming systems that are not registered are ignored, so a
plugin can say "before render" and still work on a headless server.

#### `Scheduler.constructor`

```js
constructor()
```

#### `Scheduler.add`

```js
add(name, fn, { before = [], after = [] } = {})
```

| Name | Type | Description |
|---|---|---|
| `name` | `string` | Unique system name. |
| `fn` | `Function` |  |
| `opts` (optional) | `SystemOptions` |  |

#### `Scheduler.order`

```js
order()
```

**Returns** `string[]` — System names in execution order.

#### `Scheduler.run`

```js
run(...args)
```

Run every system once, in order, passing `...args`.

<sub>src/scheduler.js:12</sub>

### `class World`

```js
class World
```

Entities + struct-of-arrays component storage. Hot loops should grab
`world.data(Comp)` once and index its typed arrays by `id & INDEX_MASK`.

#### `World.constructor`

```js
constructor(capacity = 65536)
```

| Name | Type | Description |
|---|---|---|
| `capacity` (optional) | `number` |  |

#### `World.register`

```js
register(comp)
```

| Name | Type | Description |
|---|---|---|
| `comp` | `Component` |  |

#### `World.create`

```js
create()
```

#### `World.isAlive`

```js
isAlive(id)
```

#### `World.destroy`

```js
destroy(id)
```

#### `World.add`

```js
add(id, comp, values)
```

Attach a component; unspecified fields reset to 0.

| Name | Type | Description |
|---|---|---|
| `id` | `number` |  |
| `comp` | `Component` |  |
| `values` (optional) | `Record<string, number>` |  |

#### `World.remove`

```js
remove(id, comp)
```

#### `World.has`

```js
has(id, comp)
```

#### `World.data`

```js
data(comp)
```

Typed arrays for a component, keyed by field. Index with `id & INDEX_MASK`.

#### `World.query`

```js
query(out, comps)
```

Fill `out` with ids of live entities that have all `comps`. No allocation.

| Name | Type | Description |
|---|---|---|
| `out` | `Uint32Array` | Must hold at least `capacity` ids. |
| `comps` | `Component[]` |  |

**Returns** `number` — Number of ids written.

<sub>src/world.js:36</sub>

## Constants

### `ENGINE_VERSION`

```js
const ENGINE_VERSION
```

The engine version plugins are checked against (their `engine` range must accept it).

Value: `'0.0.1'`

<sub>src/app.js:7</sub>

### `INDEX_MASK`

```js
const INDEX_MASK
```

Mask that keeps the slot-index bits of an entity id (the low 20 bits): `id & INDEX_MASK`.

Value: `(1 << INDEX_BITS) - 1`

<sub>src/entity.js:8</sub>

### `MAX_ENTITIES`

```js
const MAX_ENTITIES
```

The most entities that can exist at once (2^20).

Value: `INDEX_MASK + 1`

<sub>src/entity.js:10</sub>

## Types

### `Component`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` | Namespaced name, e.g. `engine:transform`. |
| `schema` | `Record<string, keyof ARRAYS>` | Field name -> numeric type. |
| `fields` | `string[]` |  |

### `PluginDef`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `id` | `string` | Lowercase id, e.g. `my-mod`. Namespaces everything the plugin registers. |
| `version` | `string` | `x.y.z` |
| `engine` (optional) | `string` | Engine version range this plugin supports (default `*`). |
| `dependencies` (optional) | `Record<string, string>` | Plugin id -> version range. |
| `setup` | `(app: import('./app.js').PluginApp) => void` |  |

### `SystemOptions`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `before` (optional) | `string[]` | Run before these systems (absent names are ignored). |
| `after` (optional) | `string[]` | Run after these systems (absent names are ignored). |
