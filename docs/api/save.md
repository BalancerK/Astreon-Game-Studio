# @engine/save

Save and load: slots, quick and auto saves, checksums and backups, all-or-nothing loads, versioned data with migrations, sections for the scene, physics and state machines, storage in memory, localStorage, IndexedDB, files or over HTTP.

```
npm install @engine/save
```

Version 0.1.0. The package's own README ([packages/save](../../packages/save/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (21 of 21 documented)

| Name | Kind | Summary |
|---|---|---|
| [`AutoSaver`](#class-autosaver) | class | Saves the game now and then while you tick it: `auto.tick(dt)` each frame; every `every` seconds it autosaves, unless `canSave()` says no (in a fight, in a cutscene). |
| [`CloudSync`](#class-cloudsync) | class | Cloud saves: `sync()` brings the slots on the device and on the server into step, in both directions, without ever losing a save. |
| [`FORMAT`](#format) | constant | The `format` field of every save file (`"engine-save"`). |
| [`FORMAT_VERSION`](#format_version) | constant | The version of the save file envelope this code writes and reads. |
| [`HttpStorage`](#class-httpstorage) | class | Saves on a server (see `createSaveHandler` in node.js): `GET {base}/{key}`, `PUT`, `DELETE`, `GET {base}?prefix=` (a JSON list of keys). |
| [`IndexedDbStorage`](#class-indexeddbstorage) | class | The browser's IndexedDB: much more room than localStorage. |
| [`LocalStorageStorage`](#class-localstoragestorage) | class | The browser's `localStorage` (about 5 MB in all: compress, or use IndexedDB, for big saves). |
| [`MemoryStorage`](#class-memorystorage) | class | Keys in memory (nothing survives the process). |
| [`SaveError`](#class-saveerror) | class | A failure with a code the game can act on: 'missing', 'corrupt', 'newer', 'game', 'migration', 'section', 'apply', 'storage'. |
| [`SaveGame`](#class-savegame) | class | Save and load for a game: slots, quick and rolling autosaves, sections the game registers (scene, physics, values…), safe writes with a backup, checksums, migrations for old saves, and loads that are all-or-nothing. |
| [`checksum`](#checksum) | function | Two FNV-1a hashes with different seeds, as 16 hex digits: catches truncation and damage (it is not a defence against someone editing the file on purpose). |
| [`decode`](#decode) | function | Read and verify saved text. |
| [`ecsSection`](#ecssection) | function | Every entity of an ECS world with its components, for games that do not use prefabs. |
| [`encode`](#encode) | function | Seal a file object: add the checksum, and (with `compress`) gzip it into text prefixed `gz:`. |
| [`objectsSection`](#objectssection) | function | Objects with `save()` and `load(data)` (state machines, animation graphs, behaviour trees, memories), by name. |
| [`physicsSection`](#physicssection) | function | A rigid-body world (`PhysicsWorld`): poses, velocities, sleep, contact and joint impulses. |
| [`rngSection`](#rngsection) | function | A random generator whose state is a number (or a small array) at `rng.state`: saving it means the same dice after loading as without. |
| [`sceneSection`](#scenesection) | function | The prefab scene: every live instance as its prefab name, its id and what differs from the prefab (see `PrefabSpawner.capture`). |
| [`valueSection`](#valuesection) | function | Plain values the game keeps itself (score, level, flags): `get()` returns them as data, `set(data)` takes them back. |
| [`FileStorage`](#class-filestorage) | class (Node) | Saves as files in a directory. |
| [`createSaveHandler`](#createsavehandler) | function (Node) | An HTTP handler for saves: `GET /` lists keys (`?prefix=`), `GET /key`, `PUT /key`, `DELETE /key`. |

## Functions

### `checksum`

```js
function checksum(text)
```

Two FNV-1a hashes with different seeds, as 16 hex digits: catches truncation and damage (it is not a defence against someone editing the file on purpose).

<sub>src/format.js:15</sub>

### `decode`

```js
async function decode(text)
```

Read and verify saved text.

**Returns** `Promise<any>` — the file object

<sub>src/format.js:50</sub>

### `ecsSection`

```js
function ecsSection(world, components, { filter = () => true, version = 1, migrations = {} } = {})
```

Every entity of an ECS world with its components, for games that do not use prefabs. Entities are made again on load (their ids change),
so fields that hold another entity's id are listed in `refs` and fixed up to the new ids.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `world` | `import('../../core/src/index.js').World` |  |
| `components` | `Record<string, {component: any, refs?: string[]}>` | By name. `refs`: fields that hold entity ids. |
| `o` (optional) | `{filter?: (id: number) => boolean}` | Entities to leave out. |

<sub>src/sections.js:83</sub>

### `encode`

```js
async function encode(file, { compress = false } = {})
```

Seal a file object: add the checksum, and (with `compress`) gzip it into text prefixed `gz:`.

**Returns** `Promise<string>`

<sub>src/format.js:42</sub>

### `objectsSection`

```js
function objectsSection(objects, { version = 1, migrations = {} } = {})
```

Objects with `save()` and `load(data)` (state machines, animation graphs, behaviour trees, memories), by name. Only the names present
in the save are loaded; objects that have gone since are skipped. `get` may return the current map (entities come and go).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `objects` | `Record<string, {save: Function, load: Function}> \| (() => Record<string, {save: Function, load: Function}>)` |  |

<sub>src/sections.js:57</sub>

### `physicsSection`

```js
function physicsSection(world, { version = 1, migrations = {} } = {})
```

A rigid-body world (`PhysicsWorld`): poses, velocities, sleep, contact and joint impulses. Register after the scene that creates the bodies.

<sub>src/sections.js:48</sub>

### `rngSection`

```js
function rngSection(rng, { version = 1 } = {})
```

A random generator whose state is a number (or a small array) at `rng.state`: saving it means the same dice after loading as without.

<sub>src/sections.js:72</sub>

### `sceneSection`

```js
function sceneSection(spawner, { filter = () => true, version = 1, migrations = {} } = {})
```

The prefab scene: every live instance as its prefab name, its id and what differs from the prefab (see `PrefabSpawner.capture`).
Loading destroys the instances that exist and spawns the saved ones again with the same ids, so the game's extras handlers (physics
bodies, meshes) run exactly as they did the first time.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spawner` | `import('../../prefab/src/spawner.js').PrefabSpawner` |  |
| `o` (optional) | `{filter?: (instance: any) => boolean, version?: number, migrations?: Record<number, Function>}` | `filter` leaves out what should not be saved (bullets, effects). |

<sub>src/sections.js:26</sub>

### `valueSection`

```js
function valueSection(get, set, { version = 1, migrations = {} } = {})
```

Plain values the game keeps itself (score, level, flags): `get()` returns them as data, `set(data)` takes them back.

<sub>src/sections.js:67</sub>

## Classes

### `class AutoSaver`

```js
class AutoSaver
```

Saves the game now and then while you tick it: `auto.tick(dt)` each frame; every `every` seconds it autosaves, unless `canSave()` says no
(in a fight, in a cutscene). Failures go to `onError` and never throw into the frame loop.

#### `AutoSaver.constructor`

```js
constructor(saves, { every = 120, canSave = () => true, meta = () => ({}), onError = () => {} } = {})
```

| Name | Type | Description |
|---|---|---|
| `saves` | `SaveGame` |  |
| `o` (optional) | `{every?: number, canSave?: () => boolean, meta?: () => object, onError?: (e: Error) => void}` |  |

#### `AutoSaver.tick`

```js
tick(dt)
```

<sub>src/savegame.js:188</sub>

### `class CloudSync`

```js
class CloudSync
```

Cloud saves: `sync()` brings the slots on the device and on the server into step, in both directions, without ever losing a save. Both sides are `{get, set, delete, keys}` storages, so the server can
be `HttpStorage` (with `createSaveHandler` on your own server, or anything that speaks the same few requests), a folder, or another device's storage in a test.

For each slot, it compares the two files with a record, kept on the device, of the file both sides held when they last agreed:
only the device changed: upload; only the server changed: download; the same on both: nothing; **both changed** (played offline on two devices): a conflict, settled by `strategy`.
Before a file is replaced on either side the old one is kept as `.bak`, as `SaveGame` does, so even a wrong choice can be undone by hand.

#### `CloudSync.constructor`

```js
constructor({ local, remote, strategy = 'newest', prefix = 'slot.', ledgerPrefix = 'sync.', deletions = false })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.local` | `{get: Function, set: Function, delete: Function, keys: Function}` | The device's storage (the one the `SaveGame` uses). |
| `o.remote` | `{get: Function, set: Function, delete: Function, keys: Function}` | The server's. |
| `o.strategy` (optional) | `'newest' \| 'local' \| 'remote' \| 'ask' \| ((local: any, remote: any, info: {slot: string}) => 'local' \| 'remote' \| any \| Promise<any>)` | What to do when both sides changed: `'newest'` (the default) keeps the save with the later `savedAt` (ties go to the one with more play time), `'local'` / `'remote'` always keep that side, `'ask'` writes nothing and reports the conflict for the player to settle (`resolve(slot, 'local' \| 'remote')`), or a function that gets both decoded save files and returns `'local'`, `'remote'`, or a **merged save file object** (written to both sides). |
| `o.prefix` (optional) | `string` | Only slots whose key starts with this (default `slot.`: every `SaveGame` slot). |
| `o.ledgerPrefix` (optional) | `string` | Where the record of the last agreement is kept on the device (`sync.`). |
| `o.deletions` (optional) | `boolean` | Whether a slot deleted on one side is deleted on the other (false: a missing slot is brought back from the side that has it). |

#### `CloudSync.slots`

```js
async slots()
```

Slot names on both sides (without `.bak` and `.meta`).

#### `CloudSync.syncSlot`

```js
async syncSlot(slot)
```

Bring one slot into step.

| Name | Type | Description |
|---|---|---|
| `slot` | `string` | (without the `slot.` prefix) |

**Returns** `Promise<SyncResult>`

#### `CloudSync.resolve`

```js
async resolve(slot, choice)
```

Settle a slot that `sync` reported as a conflict (with `strategy: 'ask'`): keep the device's save, the server's, or a merged save file.

**Returns** `Promise<SyncResult>`

#### `CloudSync.sync`

```js
async sync()
```

Bring every slot into step (one after another, so a slow server is not flooded). Never throws for one bad slot: its result says `failed`.

**Returns** `Promise<{results: SyncResult[], uploaded: number, downloaded: number, deleted: number, conflicts: number, failed: number, same: number}>`

<sub>src/sync.js:25</sub>

### `class HttpStorage`

```js
class HttpStorage
```

Saves on a server (see `createSaveHandler` in node.js): `GET {base}/{key}`, `PUT`, `DELETE`, `GET {base}?prefix=` (a JSON list of keys).
Writes carry `If-Match` with the checksum of what you last read, so two devices cannot silently overwrite each other (a 412 is a 'conflict').

#### `HttpStorage.constructor`

```js
constructor(base, { headers = {}, fetch: f = globalThis.fetch?.bind(globalThis) } = {})
```

| Name | Type | Description |
|---|---|---|
| `base` | `string` |  |
| `o` (optional) | `{headers?: Record<string, string>, fetch?: typeof fetch}` |  |

#### `HttpStorage.get`

```js
async get(key)
```

#### `HttpStorage.set`

```js
async set(key, text)
```

#### `HttpStorage.delete`

```js
async delete(key)
```

#### `HttpStorage.keys`

```js
async keys(prefix = '')
```

<sub>src/storage.js:53</sub>

### `class IndexedDbStorage`

```js
class IndexedDbStorage
```

The browser's IndexedDB: much more room than localStorage.

#### `IndexedDbStorage.constructor`

```js
constructor(name = 'saves', idb = globalThis.indexedDB)
```

#### `IndexedDbStorage.get`

```js
get(key)
```

#### `IndexedDbStorage.set`

```js
async set(key, text)
```

#### `IndexedDbStorage.delete`

```js
async delete(key)
```

#### `IndexedDbStorage.keys`

```js
async keys(prefix = '')
```

<sub>src/storage.js:24</sub>

### `class LocalStorageStorage`

```js
class LocalStorageStorage
```

The browser's `localStorage` (about 5 MB in all: compress, or use IndexedDB, for big saves). A full or blocked store reports 'storage'.

#### `LocalStorageStorage.constructor`

```js
constructor(namespace = 'save:', store = globalThis.localStorage)
```

| Name | Type | Description |
|---|---|---|
| `namespace` (optional) | `string` | Prefix for every key, so games on one origin do not mix. |
| `store` (optional) | `Storage` |  |

#### `LocalStorageStorage.get`

```js
async get(key)
```

#### `LocalStorageStorage.set`

```js
async set(key, text)
```

#### `LocalStorageStorage.delete`

```js
async delete(key)
```

#### `LocalStorageStorage.keys`

```js
async keys(prefix = '')
```

<sub>src/storage.js:14</sub>

### `class MemoryStorage`

```js
class MemoryStorage
```

Keys in memory (nothing survives the process).

#### `MemoryStorage.constructor`

```js
constructor()
```

#### `MemoryStorage.get`

```js
async get(key)
```

#### `MemoryStorage.set`

```js
async set(key, text)
```

#### `MemoryStorage.delete`

```js
async delete(key)
```

#### `MemoryStorage.keys`

```js
async keys(prefix = '')
```

<sub>src/storage.js:5</sub>

### `class SaveError`

```js
class SaveError extends Error
```

A failure with a code the game can act on: 'missing', 'corrupt', 'newer', 'game', 'migration', 'section', 'apply', 'storage'.

#### `SaveError.constructor`

```js
constructor(code, message, cause)
```

<sub>src/format.js:10</sub>

### `class SaveGame`

```js
class SaveGame
```

Save and load for a game: slots, quick and rolling autosaves, sections the game registers (scene, physics, values…), safe writes
with a backup, checksums, migrations for old saves, and loads that are all-or-nothing.

#### `SaveGame.constructor`

```js
constructor({ game, version = 1, storage, clock = () => Date.now(), compress = false, autosaveSlots = 3, migrations = {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.game` | `string` | Name of the game (a save from another game is refused). |
| `o.version` (optional) | `number` | The game's version number (1). Saves from a newer version are refused; older ones go through `migrations`. |
| `o.storage` | `{get: Function, set: Function, delete: Function, keys: Function}` |  |
| `o.clock` (optional) | `() => number` | Milliseconds (default `Date.now`): given so tests and replays are exact. |
| `o.compress` (optional) | `boolean` | gzip the files (where the platform can). |
| `o.autosaveSlots` (optional) | `number` | Rolling autosaves kept (3). |
| `o.migrations` (optional) | `Record<number, (file: any) => any>` | Whole-file upgrades by game version: `{ 1: (file) => file2 }` turns a version 1 save into version 2. |

#### `SaveGame.section`

```js
section(name, def)
```

Register a subsystem. Sections are written and loaded in the order registered, so put what others depend on first (the scene before the physics that refers to its bodies).

#### `SaveGame.tick`

```js
tick(dt)
```

Count play time.

#### `SaveGame.on`

```js
on(event, fn)
```

Run `fn()` just before every save (flush buffers, pause streaming) and `fn(meta)` after every load.

#### `SaveGame.capture`

```js
capture(meta = {})
```

The game's state as a file object, without writing anything (also what `load` restores if applying a save fails).

| Name | Type | Description |
|---|---|---|
| `meta` (optional) | `Record<string, any>` | Facts for the load screen: `{ title, level, thumbnail }`. |

#### `SaveGame.save`

```js
async save(slot, meta = {})
```

Write a slot. The old file becomes `.bak` first, so a write that fails or is cut short never costs the player their save.

**Returns** `Promise<{slot: string, bytes: number, file: any}>`

#### `SaveGame.list`

```js
async list()
```

Everything for a load screen, newest first: slot, title, time, play time, size. Cheap (reads small header entries, not the saves).

#### `SaveGame.has`

```js
async has(slot)
```

#### `SaveGame.delete`

```js
async delete(slot)
```

#### `SaveGame.read`

```js
async read(slot)
```

Read, check and upgrade a slot without touching the game. Falls back to the backup if the main file is damaged.

**Returns** `Promise<{file: any, sections: Record<string, any>, recovered: boolean}>`

#### `SaveGame.load`

```js
async load(slot)
```

Load a slot into the game. If anything is wrong with the file nothing changes; if a section fails while applying, the game is put back as it was.

**Returns** `Promise<{meta: any, recovered: boolean, ignored: string[], playtime: number}>`

#### `SaveGame.quicksave`

```js
quicksave(meta)
```

#### `SaveGame.quickload`

```js
quickload()
```

#### `SaveGame.autosave`

```js
async autosave(meta)
```

Save into the rolling autosave slots (auto-1 is the newest; each save pushes the older ones down and drops the oldest).

<sub>src/savegame.js:21</sub>

## Constants

### `FORMAT`

```js
const FORMAT
```

The `format` field of every save file (`"engine-save"`).

Value: `'engine-save'`

<sub>src/format.js:5</sub>

### `FORMAT_VERSION`

```js
const FORMAT_VERSION
```

The version of the save file envelope this code writes and reads.

Value: `1`

<sub>src/format.js:7</sub>

## Node entry

These come from `@engine/save/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { FileStorage, createSaveHandler } from '@engine/save/src/node.js';
```

### `class FileStorage`

```js
class FileStorage
```

Saves as files in a directory. Writes go to a temporary file first and are renamed into place, so a crash never leaves half a save.

#### `FileStorage.constructor`

```js
constructor(dir)
```

#### `FileStorage.get`

```js
async get(key)
```

#### `FileStorage.set`

```js
async set(key, text)
```

#### `FileStorage.delete`

```js
async delete(key)
```

#### `FileStorage.keys`

```js
async keys(prefix = '')
```

<sub>src/node.js:9</sub>

### `createSaveHandler`

```js
function createSaveHandler({ storageFor, userOf, maxBytes = 4_000_000 })
```

An HTTP handler for saves: `GET /` lists keys (`?prefix=`), `GET /key`, `PUT /key`, `DELETE /key`. Keys are checked, bodies are capped,
and each file has an ETag (its checksum): a `PUT` with `If-Match` that no longer matches is refused with 412, `If-None-Match: *`
only creates. Use it under a path of your server, after your own authentication: `userOf(req)` returns who the request is for (a
directory name), or null to refuse.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `{storageFor: (user: string) => {get: Function, set: Function, delete: Function, keys: Function}, userOf: (req: any) => string \| null, maxBytes?: number}` |  |

**Returns** `(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, path: string) => Promise<void>` — path: the part of the URL after your mount point ('/' or '/key')

<sub>src/node.js:32</sub>

## Types

### `SectionDef`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `version` (optional) | `number` | Version of the data this section writes (1). |
| `save` | `() => any` | Return the section's state as plain data. |
| `load` | `(data: any, ctx: {file: any, meta: any}) => void` | Put it back (after upgrades). Sections load in the order registered. |
| `migrations` (optional) | `Record<number, (data: any) => any>` | `{ 1: (old) => v2data }`: how to upgrade data saved at that version by one step. |
| `optional` (optional) | `boolean` | A save without this section still loads (the section is left as it is). |

### `SlotInfo`

What `CloudSync` did, or found, for one slot.
- `same`: both sides hold the same save. `uploaded` / `downloaded`: the older side (or the side without the slot) was brought up to date. `deleted`: the slot was deleted on one side and, with `deletions`, now on the other (`from` says where it was deleted).
- `conflict`: both sides changed since they last agreed and nothing was written (with `strategy: 'ask'`, or a merge that declined): `local` and `remote` describe both.
- `resolved`: it was a conflict, and the strategy chose (`chose` says which side, or `merged`).
- `failed`: a side could not be reached or a file was unreadable (`error`).

Type: `{savedAt: number, playtime: number, title: string \| null, sum: string, bytes: number}`

### `SyncResult`

What `CloudSync` did, or found, for one slot.
- `same`: both sides hold the same save. `uploaded` / `downloaded`: the older side (or the side without the slot) was brought up to date. `deleted`: the slot was deleted on one side and, with `deletions`, now on the other (`from` says where it was deleted).
- `conflict`: both sides changed since they last agreed and nothing was written (with `strategy: 'ask'`, or a merge that declined): `local` and `remote` describe both.
- `resolved`: it was a conflict, and the strategy chose (`chose` says which side, or `merged`).
- `failed`: a side could not be reached or a file was unreadable (`error`).

Type: `{slot: string, action: 'same' \| 'uploaded' \| 'downloaded' \| 'deleted' \| 'conflict' \| 'resolved' \| 'failed', from?: 'local' \| 'remote', chose?: 'local' \| 'remote' \| 'merged', local?: SlotInfo, remote?: SlotInfo, error?: string}`
