# @engine/persist

What outlives a match: a versioned key-value store (memory, files), player profiles with a write-behind cache and migrations, leaderboards, guest accounts and an append-only log.

```
npm install @engine/persist
```

Version 0.1.0. The package's own README ([packages/persist](../../packages/persist/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (10 of 10 documented)

| Name | Kind | Summary |
|---|---|---|
| [`Leaderboard`](#class-leaderboard) | class | A leaderboard: ranks, the best scores, and the players just above and below one player. |
| [`MemoryStore`](#class-memorystore) | class | Records in memory (tests, a single server that does not need to survive a restart). |
| [`Profile`](#class-profile) | class | A profile that is open: change `data`, then call `touch()` (or use `change`). |
| [`Profiles`](#class-profiles) | class | Player profiles: the data that outlives a match. |
| [`StoreConflictError`](#class-storeconflicterror) | class | A write expected an older version of the record than the one that exists. |
| [`checkName`](#checkname) | function | Throw unless a namespace or key is one of the safe names every store accepts (letters, digits and `_ . |
| [`updateRecord`](#updaterecord) | function | Read, change and write a record, trying again if someone else wrote it in between (so concurrent updates never lose each other's changes). |
| [`AppendLog`](#class-appendlog) | class (Node) | An append-only log of JSON lines (match results, purchases, moderation actions): cheap to write, rotated by size, easy to read back. |
| [`FileStore`](#class-filestore) | class (Node) | Records as JSON files in a folder: `<dir>/<namespace>/<two hex digits>/<key>.json`, each written to a temporary file and renamed into place, so a crash never leaves half a record. |
| [`GuestAccounts`](#class-guestaccounts) | class (Node) | Players without a sign-up: the first time someone plays they get an id and a secret to keep in the browser; showing the secret later proves it is the same player. |

## Functions

### `checkName`

```js
function checkName(kind, name)
```

Throw unless a namespace or key is one of the safe names every store accepts (letters, digits and `_ . @ : -`, up to 128).

<sub>src/store.js:16</sub>

### `updateRecord`

```js
async function updateRecord(store, ns, key, fn, { retries = 8, create } = {})
```

Read, change and write a record, trying again if someone else wrote it in between (so concurrent updates never lose each other's changes).
`fn(value, version)` returns the new value (or changes `value` in place and returns nothing). Every store's `update` is this.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `store` | `Store` |  |
| `ns` | `string` |  |
| `key` | `string` |  |
| `fn` | `(value: any, version: number) => any` |  |
| `o` (optional) | `{retries?: number, create?: () => any}` | `create` makes the value when the record does not exist yet (without it, a missing record is an error). |

<sub>src/store.js:39</sub>

## Classes

### `class Leaderboard`

```js
class Leaderboard
```

A leaderboard: ranks, the best scores, and the players just above and below one player. Kept sorted in memory (ranks are
instant) and saved to a store as one record. A player appears once; ties go to whoever got the score first.

#### `Leaderboard.constructor`

```js
constructor({ order = 'desc', maxEntries = Infinity, now = () => Date.now() } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.order` (optional) | `'desc' \| 'asc'` | `desc`: higher is better (points); `asc`: lower is better (race times). |
| `o.maxEntries` (optional) | `number` | Keep only the best this many (default: all). |
| `o.now` (optional) | `() => number` |  |

#### `Leaderboard.submit`

```js
submit(id, score, { mode = 'best', meta } = {})
```

Record a score.

| Name | Type | Description |
|---|---|---|
| `id` | `string` |  |
| `score` | `number` |  |
| `o` (optional) | `{mode?: 'best' \| 'replace' \| 'add', meta?: any}` | `best` keeps the player's better score (default); `replace` always takes the new one; `add` adds to the total. |

**Returns** `{rank: number, score: number, improved: boolean}` — the player's rank (1 is first) and score after this

#### `Leaderboard.remove`

```js
remove(id)
```

#### `Leaderboard.rank`

```js
rank(id)
```

A player's rank, 1 being the best, or 0 if they have no score.

#### `Leaderboard.score`

```js
score(id)
```

#### `Leaderboard.size`

```js
get size
```

#### `Leaderboard.top`

```js
top(count = 10, offset = 0)
```

The best `count` entries from position `offset` (0 is the best), each with its `rank`.

#### `Leaderboard.around`

```js
around(id, radius = 3)
```

A player and the `radius` entries above and below them (for "you are here"), or `[]` if they have no score.

#### `Leaderboard.reset`

```js
reset()
```

Start a new season: empty the board and return what it held (to archive).

#### `Leaderboard.toJSON`

```js
toJSON()
```

#### `Leaderboard.from`

```js
static from(data, o = {})
```

| Name | Type | Description |
|---|---|---|
| `data` | `{order?: string, entries: any[]}` |  |
| `o` (optional) | `ConstructorParameters<typeof Leaderboard>[0]` |  |

#### `Leaderboard.save`

```js
async save(store, ns, key)
```

Save to a store as one record.

| Name | Type | Description |
|---|---|---|
| `store` | `import('./store.js').Store` |  |

#### `Leaderboard.load`

```js
static async load(store, ns, key, o = {})
```

Load a board saved with `save` (an empty one if there is none).

<sub>src/leaderboard.js:8</sub>

### `class MemoryStore`

```js
class MemoryStore
```

Records in memory (tests, a single server that does not need to survive a restart). Values are copied in and out, so nothing aliases.

#### `MemoryStore.constructor`

```js
constructor()
```

#### `MemoryStore.get`

```js
async get(ns, key)
```

#### `MemoryStore.put`

```js
async put(ns, key, value, { ifVersion } = {})
```

#### `MemoryStore.delete`

```js
async delete(ns, key, { ifVersion } = {})
```

#### `MemoryStore.list`

```js
async list(ns, { prefix = '', limit = 100, after = '' } = {})
```

#### `MemoryStore.update`

```js
update(ns, key, fn, o)
```

#### `MemoryStore.dump`

```js
dump()
```

A deep copy of everything, for tests and backups: `{ ns: { key: value } }`.

<sub>src/store.js:51</sub>

### `class Profile`

```js
class Profile
```

A profile that is open: change `data`, then call `touch()` (or use `change`).

#### `Profile.constructor`

```js
constructor(manager, id, data, version, base)
```

#### `Profile.touch`

```js
touch()
```

Say the data changed: it is written back at the next flush.

#### `Profile.change`

```js
change(fn)
```

Change the data and mark it: `profile.change((d) => { d.coins += 5; })`.

<sub>src/profiles.js:15</sub>

### `class Profiles`

```js
class Profiles
```

Player profiles: the data that outlives a match. A profile is open while its player is connected: changes are made in memory
and written back in the background, when the player leaves and on shutdown. Old layouts are upgraded as they are read, and a
write that finds another server changed the profile is merged (or the conflict is counted) rather than lost.

#### `Profiles.constructor`

```js
constructor({ store, spec, ns = 'profiles', flushMs = 5000, now = () => Date.now(), log = () => {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.store` | `import('./store.js').Store` |  |
| `o.spec` | `ProfileSpec` |  |
| `o.ns` (optional) | `string` | The store namespace (`"profiles"`). |
| `o.flushMs` (optional) | `number` | How often dirty profiles are written back (5000; 0 = only when you call `flush`). |
| `o.now` (optional) | `() => number` |  |
| `o.log` (optional) | `(msg: string) => void` |  |

#### `Profiles.openProfile`

```js
async openProfile(playerId)
```

Open a player's profile (creating it the first time). Opening twice gives the same object. Call `close` when the player leaves.

| Name | Type | Description |
|---|---|---|
| `playerId` | `string` |  |

**Returns** `Promise<Profile>`

#### `Profiles.peek`

```js
async peek(playerId)
```

A profile without keeping it open (read once; changes are not tracked).

#### `Profiles.flush`

```js
async flush()
```

Write the changed profiles now.

**Returns** `Promise<number>` — how many were written

#### `Profiles.close`

```js
async close(playerId)
```

The player left: write their profile and let go of it.

#### `Profiles.closeAll`

```js
async closeAll()
```

Server shutdown: write everything and stop the timer.

<sub>src/profiles.js:32</sub>

### `class StoreConflictError`

```js
class StoreConflictError extends Error
```

A write expected an older version of the record than the one that exists.

#### `StoreConflictError.constructor`

```js
constructor(ns, key, expected, actual)
```

| Name | Type | Description |
|---|---|---|
| `ns` | `string` |  |
| `key` | `string` |  |
| `expected` | `number` |  |
| `actual` | `number` |  |

<sub>src/store.js:6</sub>

## Node entry

These come from `@engine/persist/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { AppendLog, FileStore, GuestAccounts } from '@engine/persist/src/node.js';
```

### `class AppendLog`

```js
class AppendLog
```

An append-only log of JSON lines (match results, purchases, moderation actions): cheap to write, rotated by size, easy to read back.

#### `AppendLog.constructor`

```js
constructor(path, { maxBytes = 5_000_000, keep = 3 } = {})
```

| Name | Type | Description |
|---|---|---|
| `path` | `string` |  |
| `o` (optional) | `{maxBytes?: number, keep?: number}` | `maxBytes`: rotate at this size (5 MB); `keep`: how many old files to keep (3). |

#### `AppendLog.append`

```js
append(record)
```

Add one record (any JSON value). Returns a promise for when it is written; writes keep their order.

#### `AppendLog.tail`

```js
async tail(count = 100)
```

The last `count` records, oldest first (looking back through rotated files if needed).

#### `AppendLog.flush`

```js
flush()
```

Wait until everything appended so far is on disk.

<sub>src/node.js:141</sub>

### `class FileStore`

```js
class FileStore
```

Records as JSON files in a folder: `<dir>/<namespace>/<two hex digits>/<key>.json`, each written to a temporary file and renamed into place,
so a crash never leaves half a record. Writes to one record are queued, so version checks are exact inside one server process. Use it for one
server (or one server per folder); several servers sharing records need a database behind the same `Store` contract.
`list` reads folder names: fine for thousands of records, not for millions.

#### `FileStore.constructor`

```js
constructor(dir)
```

| Name | Type | Description |
|---|---|---|
| `dir` | `string` |  |

#### `FileStore.get`

```js
async get(ns, key)
```

#### `FileStore.put`

```js
put(ns, key, value, { ifVersion } = {})
```

#### `FileStore.delete`

```js
delete(ns, key, { ifVersion } = {})
```

#### `FileStore.list`

```js
async list(ns, { prefix = '', limit = 100, after = '' } = {})
```

#### `FileStore.update`

```js
update(ns, key, fn, { create } = {})
```

Read, change and write a record while holding its lock, so concurrent updates in this process queue up instead of retrying.

<sub>src/node.js:13</sub>

### `class GuestAccounts`

```js
class GuestAccounts
```

Players without a sign-up: the first time someone plays they get an id and a secret to keep in the browser; showing the secret later proves it
is the same player. Only a hash of the secret is stored. Accounts can later be linked to a login from outside (a platform or social id),
which is how a guest keeps their progress when they sign in on another device.

#### `GuestAccounts.constructor`

```js
constructor({ store, now = () => Date.now(), ns = 'accounts' })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.store` | `import('./store.js').Store` |  |
| `o.now` (optional) | `() => number` |  |
| `o.ns` (optional) | `string` |  |

#### `GuestAccounts.create`

```js
async create({ name = null } = {})
```

Make an account.

**Returns** `Promise<{playerId: string, secret: string}>` — give both to the player; the secret is not kept.

#### `GuestAccounts.authenticate`

```js
async authenticate(playerId, secret)
```

Does this secret belong to this player? (Never throws; compares in constant time.)

#### `GuestAccounts.get`

```js
async get(playerId)
```

#### `GuestAccounts.setName`

```js
async setName(playerId, name)
```

#### `GuestAccounts.rotateSecret`

```js
async rotateSecret(playerId)
```

A new secret (the old one stops working): for "log out everywhere" or a lost device.

#### `GuestAccounts.link`

```js
async link(playerId, provider, externalId)
```

Tie an outside identity (`google`, `steam`…) to a player. One outside identity belongs to one player.

**Returns** `Promise<boolean>` — false if it already belongs to someone else

#### `GuestAccounts.findByLink`

```js
async findByLink(provider, externalId)
```

The player an outside identity belongs to, or null.

#### `GuestAccounts.delete`

```js
async delete(playerId)
```

Delete an account and its links.

<sub>src/node.js:93</sub>

## Types

### `ProfileSpec`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `version` (optional) | `number` | The profile layout version (1). |
| `create` | `(playerId: string) => any` | The data of a brand-new player. |
| `migrations` (optional) | `Record<number, (data: any) => any>` | `{ 1: (old) => v2data }` upgrades data saved at that version by one step. |
| `merge` (optional) | `(mine: any, theirs: any, base: any) => any` | When a write finds another server changed the profile, combine the two (default: keep ours). |

### `Store`

What every store provides. `ifVersion` on a write: omit it to write regardless, `0` to create only (fail if it exists), or the version you read.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `get` | `(ns: string, key: string) => Promise<{value: any, version: number} \| null>` |  |
| `put` | `(ns: string, key: string, value: any, o?: {ifVersion?: number}) => Promise<{version: number}>` |  |
| `delete` | `(ns: string, key: string, o?: {ifVersion?: number}) => Promise<boolean>` |  |
| `list` | `(ns: string, o?: {prefix?: string, limit?: number, after?: string}) => Promise<Array<{key: string, version: number}>>` |  |
| `update` | `(ns: string, key: string, fn: (value: any, version: number) => any, o?: {retries?: number, create?: () => any}) => Promise<{value: any, version: number}>` |  |
