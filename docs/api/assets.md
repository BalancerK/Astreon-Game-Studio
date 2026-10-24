# @engine/assets

Asset manager: one fetch per file, hashed-name manifest, use counting, retries, dependencies, hot reload.

```
npm install @engine/assets
```

Version 0.1.0. The package's own README ([packages/assets](../../packages/assets/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (13 of 13 documented)

| Name | Kind | Summary |
|---|---|---|
| [`AssetError`](#class-asseterror) | class | An asset could not be fetched or decoded. |
| [`AssetHandle`](#class-assethandle) | class | A reference to an asset. |
| [`AssetManager`](#class-assetmanager) | class | Loads, caches and reloads game files. |
| [`audioLoader`](#audioloader) | function | Sounds as `AudioBuffer`s decoded by the given `AudioContext` (or `decode(bytes)`). |
| [`basicLoaders`](#basicloaders) | function | The types every game wants: json, text, binary. |
| [`binaryLoader`](#binaryloader) | constant | Loader for raw bytes (`.bin`, `.dat`): resolves to an `ArrayBuffer`. |
| [`gltfLoader`](#gltfloader) | function | glTF models: `parse(json, {buffers})` is your parser (the render package's `parseGltf`); external buffers are fetched through the manager, so they are cached, counted and hot reloaded with the model. |
| [`imageLoader`](#imageloader) | function | Images as `ImageBitmap` (or whatever `decode(bytes, mime)` returns). |
| [`inlineManifest`](#inlinemanifest) | function | The manifest a built page carries (`<script id="asset-manifest" type="application/json">`): `{ manifest, base }` for `new AssetManager({ base, manifest })`. |
| [`jsonLoader`](#jsonloader) | constant | Loader for JSON files: resolves to the parsed value; a file that is not valid JSON is an `AssetError`. |
| [`textLoader`](#textloader) | constant | Loader for text files (`.txt`, `.glsl`, `.wgsl`, `.md`, `.csv`): resolves to a string. |
| [`watchManifest`](#watchmanifest) | function | Polls a manifest URL and reloads what changed. |
| [`fileFetch`](#filefetch) | function (Node) | A `fetch`-like function that serves files below `root`. |

## Functions

### `audioLoader`

```js
function audioLoader({ context, decode } = {})
```

Sounds as `AudioBuffer`s decoded by the given `AudioContext` (or `decode(bytes)`).

<sub>src/loaders.js:25</sub>

### `basicLoaders`

```js
function basicLoaders()
```

The types every game wants: json, text, binary. Add image / audio / gltf with their loaders.

<sub>src/loaders.js:54</sub>

### `gltfLoader`

```js
function gltfLoader(parse)
```

glTF models: `parse(json, {buffers})` is your parser (the render package's `parseGltf`); external buffers are fetched through the manager,
so they are cached, counted and hot reloaded with the model. `.glb` files go to `parse` as bytes.

<sub>src/loaders.js:40</sub>

### `imageLoader`

```js
function imageLoader({ decode } = {})
```

Images as `ImageBitmap` (or whatever `decode(bytes, mime)` returns). Frees bitmaps when collected.

<sub>src/loaders.js:11</sub>

### `inlineManifest`

```js
function inlineManifest(doc = globalThis.document)
```

The manifest a built page carries (`<script id="asset-manifest" type="application/json">`): `{ manifest, base }` for `new AssetManager({ base, manifest })`.
Without it (running from source) you get an empty manifest and the paths are used as they are.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `doc` (optional) | `{getElementById(id: string): {textContent: string} \| null}` |  |

<sub>src/hot.js:33</sub>

### `watchManifest`

```js
function watchManifest(manager, { url, every = 1000, onReload, fetch: f = manager.fetch, setInterval: si = globalThis.setInterval, clearInterval: ci = globalThis.clearInterval } = {})
```

Polls a manifest URL and reloads what changed. The build tool's dev server writes a new manifest when files change; so does a rebuild.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `manager` | `import('./manager.js').AssetManager` |  |
| `o` | `{url: string, every?: number, onReload?: (paths: string[]) => void, fetch?: typeof fetch, setInterval?: Function, clearInterval?: Function}` |  |

**Returns** `{stop(): void, check(): Promise<string[]>}`

<sub>src/hot.js:9</sub>

## Classes

### `class AssetError`

```js
class AssetError extends Error
```

An asset could not be fetched or decoded. `type` and `path` say which one; the message says why, and `cause` holds the original
error.

#### `AssetError.constructor`

```js
constructor(type, path, message, cause)
```

<sub>src/manager.js:9</sub>

### `class AssetHandle`

```js
class AssetHandle
```

A reference to an asset. It stays valid across hot reloads: read `.value` each time you need it (do not keep the value).

#### `AssetHandle.constructor`

```js
constructor(manager, type, path)
```

#### `AssetHandle.ready`

```js
get ready
```

<sub>src/manager.js:17</sub>

### `class AssetManager`

```js
class AssetManager
```

Loads, caches and reloads game files. Ask for an asset by type and logical path (`load("image", "tex/bricks.png")`); it finds
the real (possibly content-hashed) URL in the manifest, fetches it once however many ask, decodes it with the loader for its
type, counts who uses it, frees it with `collect()` when nobody does, and swaps in new versions when files change
(`update(manifest)`).

#### `AssetManager.constructor`

```js
constructor({ base = '', manifest = { assets: {} }, fetch: f = globalThis.fetch?.bind(globalThis), retries = 2, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.base` (optional) | `string` | Prefix for every URL ('/assets/'). |
| `o.manifest` (optional) | `{assets: Record<string, {url?: string, hash?: string, bytes?: number}>}` | From the build step: logical path -> hashed file. |
| `o.fetch` (optional) | `typeof fetch` |  |
| `o.retries` (optional) | `number` | Extra tries for network failures (2), with growing waits. |
| `o.sleep` (optional) | `(ms: number) => Promise<void>` | Injected for tests. |

#### `AssetManager.register`

```js
register(type, loader)
```

Teach the manager a type.

#### `AssetManager.registerAll`

```js
registerAll(loaders)
```

Register many: `{ json, text, ... }`.

#### `AssetManager.on`

```js
on(event, fn)
```

#### `AssetManager.typeOf`

```js
typeOf(path)
```

Which type a file is, from its extension (null if no registered type claims it).

#### `AssetManager.urlOf`

```js
urlOf(path)
```

The URL a logical path is fetched from.

#### `AssetManager.acquire`

```js
acquire(type, path)
```

The handle for an asset, starting the load if it is new. It counts as one use: call `release` when you are done.

#### `AssetManager.load`

```js
async load(type, path)
```

Load an asset and resolve with its value (it counts as one use).

#### `AssetManager.loadAll`

```js
async loadAll(list, { onProgress, failFast = false } = {})
```

Load many at once. `list` entries are `{type?, path}` or just a path. Progress is reported as each finishes.

| Name | Type | Description |
|---|---|---|
| `list` | `Array<string \| {type?: string, path: string}>` |  |
| `o` (optional) | `{onProgress?: (p: {loaded: number, total: number, path: string, failed: number}) => void, failFast?: boolean}` |  |

**Returns** `Promise<AssetHandle[]>` — the handles (all of them, or it throws the first failure with `failFast`; otherwise failures are listed in the error of `AggregateError`)

#### `AssetManager.release`

```js
release(handle)
```

One fewer user. At zero the asset stays cached until `collect()`.

#### `AssetManager.get`

```js
get(type, path)
```

The value of an asset that is already loaded (throws if it is not; use `load` first).

#### `AssetManager.peek`

```js
peek(type, path)
```

The handle if it exists, without using it.

#### `AssetManager.collect`

```js
collect()
```

Dispose every asset nobody uses (and the dependencies only they used).

**Returns** `number` — how many were freed

#### `AssetManager.reload`

```js
async reload(type, path)
```

Replace an asset's value from its file again. Anything holding the handle sees the new value; if the new file fails to load, the old value stays.

**Returns** `Promise<boolean>` — true if it was reloaded

#### `AssetManager.update`

```js
async update(manifest)
```

Take a new manifest (from a rebuilt game or a dev server) and reload every loaded asset whose hash changed.

**Returns** `Promise<string[]>` — the logical paths that were reloaded

<sub>src/manager.js:57</sub>

## Constants

### `binaryLoader`

```js
const binaryLoader
```

Loader for raw bytes (`.bin`, `.dat`): resolves to an `ArrayBuffer`.

Value: `{ extensions: ['bin', 'dat'], load: (ctx) => ctx.bytes() }`

<sub>src/loaders.js:8</sub>

### `jsonLoader`

```js
const jsonLoader
```

Loader for JSON files: resolves to the parsed value; a file that is not valid JSON is an `AssetError`.

Value: `{ extensions: ['json'], load: (ctx) => ctx.json() }`

<sub>src/loaders.js:4</sub>

### `textLoader`

```js
const textLoader
```

Loader for text files (`.txt`, `.glsl`, `.wgsl`, `.md`, `.csv`): resolves to a string.

Value: `{ extensions: ['txt', 'glsl', 'wgsl', 'md', 'csv'], load: (ctx) => ctx.text() }`

<sub>src/loaders.js:6</sub>

## Node entry

These come from `@engine/assets/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { fileFetch } from '@engine/assets/src/node.js';
```

### `fileFetch`

```js
function fileFetch(root)
```

A `fetch`-like function that serves files below `root`. Paths that climb out of it are refused.

<sub>src/node.js:6</sub>

## Types

### `LoadContext`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `url` | `string` | Where it is being fetched from. |
| `path` | `string` | The logical path. |
| `bytes` | `() => Promise<ArrayBuffer>` |  |
| `text` | `() => Promise<string>` |  |
| `json` | `() => Promise<any>` |  |
| `load` | `(type: string, path: string) => Promise<any>` | Load another asset this one needs (it is released with this one). |
| `sibling` | `(relative: string) => string` | The logical path of a file referred to relative to this one ('model.bin' next to 'models/tree.gltf'). |
| `signal` | `AbortSignal` |  |

### `Loader`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `load` | `(ctx: LoadContext) => Promise<any> \| any` |  |
| `dispose` (optional) | `(value: any) => void` | Free GPU memory, close handles. |
| `extensions` (optional) | `string[]` | File extensions (without dot) this type is guessed from. |
