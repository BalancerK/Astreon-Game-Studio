# @engine/mods

Safe third-party mods: manifests, content-hashed bundles, sandboxed script mods in confined processes, signing, policy, validated commands (guide: docs/MODDING.md, threat model: docs/SECURITY.md).

```
npm install @engine/mods
```

Version 0.1.0. The package's own README ([packages/mods](../../packages/mods/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (25 of 25 documented)

| Name | Kind | Summary |
|---|---|---|
| [`BUNDLE_LIMITS`](#bundle_limits) | constant | A bundle is a manifest plus its files as text, plus an optional signature. |
| [`MANIFEST_LIMITS`](#manifest_limits) | constant | Maximum sizes, so a manifest cannot be used to burn memory. |
| [`bundleText`](#bundletext) | function | Canonical text of everything that defines what the bundle does (not the signature). |
| [`canonicalJson`](#canonicaljson) | function | Deterministic JSON: object keys sorted, no whitespace. |
| [`clientView`](#clientview) | function | What a client needs: ids, versions and the data to apply. |
| [`hashBundle`](#hashbundle) | function | The SHA-256 of a whole bundle (manifest and files, in a canonical form): what a signature covers. |
| [`hashClientView`](#hashclientview) | function | The SHA-256 of a bundle's client view: the hash a server advertises so clients can check what they download. |
| [`mergeRuleSets`](#mergerulesets) | function | Merge rule sets from several mods (in load order; later wins) and report every key more than one mod sets. |
| [`sha256Bytes`](#sha256bytes) | function | Pure-JS SHA-256 over bytes. |
| [`sha256Hex`](#sha256hex) | function | SHA-256 of a string (UTF-8) as lowercase hex, using the platform's native implementation when present. |
| [`sha256HexSync`](#sha256hexsync) | function | Synchronous SHA-256 of a string (always the pure-JS implementation). |
| [`validateBundle`](#validatebundle) | function | Validate structure and sizes. |
| [`validateCommand`](#validatecommand) | function | Check a command a mod sent against the allowed commands (`op` names and the types and ranges of their fields). |
| [`validateManifest`](#validatemanifest) | function | Check a parsed `mod.json`: ids, versions, permissions, limits, files. |
| [`verifyClientView`](#verifyclientview) | function | Check a downloaded client view against the hash the server advertised. |
| [`ALLOWED_HOOKS`](#allowed_hooks) | constant (Node) | Hook names a mod may register; anything else is ignored. |
| [`InlineSandbox`](#class-inlinesandbox) | class (Node) | Same interface as ModSandbox but in this process, for tools and deterministic tests. |
| [`ModManager`](#class-modmanager) | class (Node) | Loads mods, runs script mods in confined sandboxes, and turns what they return into validated commands. |
| [`ModSandbox`](#class-modsandbox) | class (Node) | One mod, in its own confined process. |
| [`SandboxCore`](#class-sandboxcore) | class (Node) | The confined JavaScript environment a mod script runs in: a fresh context with no host objects, code generation from strings switched off, and a time limit on every call. |
| [`generateSigningKey`](#generatesigningkey) | function (Node) | Make an Ed25519 key pair for signing mod bundles. |
| [`loadBundleDir`](#loadbundledir) | function (Node) | Load one mod directory: `mod.json` plus its text files (any depth up to 3), plus an optional `signature.json`. |
| [`loadCatalog`](#loadcatalog) | function (Node) | Load every mod directory under `root`. |
| [`signHash`](#signhash) | function (Node) | Sign a bundle hash. |
| [`verifySignature`](#verifysignature) | function (Node) | Check a bundle signature: true only for a well-formed, valid signature over exactly this hash. |

## Functions

### `bundleText`

```js
function bundleText(bundle)
```

Canonical text of everything that defines what the bundle does (not the signature).

<sub>src/bundle.js:18</sub>

### `canonicalJson`

```js
function canonicalJson(value)
```

Deterministic JSON: object keys sorted, no whitespace. The same value always gives the same text, so the
same bundle always gives the same hash regardless of how it was written to disk.
Only plain JSON values are allowed (no undefined, functions, NaN, Infinity or cycles).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `value` | `any` |  |

**Returns** `string`

<sub>src/hash.js:11</sub>

### `clientView`

```js
function clientView(bundle)
```

What a client needs: ids, versions and the data to apply. No scripts.

<sub>src/bundle.js:33</sub>

### `hashBundle`

```js
function hashBundle(bundle)
```

The SHA-256 of a whole bundle (manifest and files, in a canonical form): what a signature covers.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bundle` | `Bundle` |  |

**Returns** `string` — SHA-256 hex of the bundle.

<sub>src/bundle.js:28</sub>

### `hashClientView`

```js
function hashClientView(bundle)
```

The SHA-256 of a bundle's client view: the hash a server advertises so clients can check what they download.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bundle` | `Bundle` |  |

**Returns** `string` — The hash advertised to clients.

<sub>src/bundle.js:44</sub>

### `mergeRuleSets`

```js
function mergeRuleSets(sets)
```

Merge rule sets from several mods (in load order; later wins) and report every key more than one mod sets.
Keys are dotted paths, so `weapon.damage` and `weapon.cooldownTicks` from different mods do not conflict.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `sets` | `{mod: string, rules: Record<string, any>}[]` |  |

**Returns** `{merged: Record<string, any>, conflicts: {key: string, mods: string[], winner: string}[]}` — `merged` uses dotted keys.

<sub>src/commands.js:54</sub>

### `sha256Bytes`

```js
function sha256Bytes(bytes)
```

Pure-JS SHA-256 over bytes. Fallback for environments without `crypto.subtle`.

<sub>src/hash.js:37</sub>

### `sha256Hex`

```js
async function sha256Hex(text)
```

SHA-256 of a string (UTF-8) as lowercase hex, using the platform's native implementation when present.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `text` | `string` |  |

**Returns** `Promise<string>`

<sub>src/hash.js:77</sub>

### `sha256HexSync`

```js
function sha256HexSync(text)
```

Synchronous SHA-256 of a string (always the pure-JS implementation).

<sub>src/hash.js:85</sub>

### `validateBundle`

```js
function validateBundle(bundle)
```

Validate structure and sizes. Returns problems rather than throwing, so tools can list all of them.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bundle` | `any` |  |

**Returns** `{ok: boolean, errors: string[]}`

<sub>src/bundle.js:64</sub>

### `validateCommand`

```js
function validateCommand(cmd, specs)
```

Check a command a mod sent against the allowed commands (`op` names and the types and ranges of their fields). Never throws:
returns `{ ok: true }` or `{ ok: false, error }`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cmd` | `any` |  |
| `specs` | `CommandSpecs` |  |

**Returns** `{ok: true} \| {ok: false, error: string}`

<sub>src/commands.js:17</sub>

### `validateManifest`

```js
function validateManifest(value)
```

Check a parsed `mod.json`: ids, versions, permissions, limits, files. Returns the manifest, or every problem found.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `value` | `any` | Parsed JSON |

**Returns** `{ok: true, manifest: ModManifest, errors: []} \| {ok: false, manifest: null, errors: string[]}`

<sub>src/manifest.js:37</sub>

### `verifyClientView`

```js
async function verifyClientView(view, expectedHash)
```

Check a downloaded client view against the hash the server advertised. Uses native SHA-256 when available.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `view` | `any` |  |
| `expectedHash` | `string` |  |

<sub>src/bundle.js:53</sub>

## Constants

### `BUNDLE_LIMITS`

```js
const BUNDLE_LIMITS
```

A bundle is a manifest plus its files as text, plus an optional signature. The hash covers the manifest and
all files, so it identifies exactly what will run. The *client view* is the data clients need (`rules` and
`client`); it has its own hash, which the server advertises and clients verify before playing.

Value: `Object.freeze({ files: 16, fileBytes: 128 * 1024, totalBytes: 256 * 1024 })`

**Properties**

| Name | Type | Description |
|---|---|---|
| `manifest` | `import('./manifest.js').ModManifest` |  |
| `files` | `Record<string, string>` | path -> text (the entry script, extra data files) |
| `signature` (optional) | `{key: string, sig: string} \| null` | Ed25519: raw public key (hex) and signature over the bundle hash (hex). |

<sub>src/bundle.js:15</sub>

### `MANIFEST_LIMITS`

```js
const MANIFEST_LIMITS
```

Maximum sizes, so a manifest cannot be used to burn memory.

Value: `Object.freeze({ text: 512, rulesJsonBytes: 4096, clientJsonBytes: 8192, dependen`

<sub>src/manifest.js:29</sub>

## Node entry

These come from `@engine/mods/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { ALLOWED_HOOKS, InlineSandbox, ModManager } from '@engine/mods/src/node.js';
```

### `ALLOWED_HOOKS`

```js
const ALLOWED_HOOKS
```

Hook names a mod may register; anything else is ignored.

Value: `Object.freeze(['onInit', 'onFrame', 'onShutdown', 'serialize'])`

<sub>src/sandbox-core.js:13</sub>

### `class InlineSandbox`

```js
class InlineSandbox
```

Same interface as ModSandbox but in this process, for tools and deterministic tests. NOT confined.

#### `InlineSandbox.constructor`

```js
constructor({ id, source, limits = {} })
```

#### `InlineSandbox.start`

```js
async start()
```

#### `InlineSandbox.call`

```js
async call(hook, arg, budgetMs)
```

#### `InlineSandbox.stop`

```js
async stop()
```

#### `InlineSandbox.kill`

```js
kill()
```

<sub>src/manager.js:9</sub>

### `class ModManager`

```js
class ModManager
```

Loads mods, runs script mods in confined sandboxes, and turns what they return into validated commands.

The game integrates in four steps: `add` bundles, `start()`, `emitFrame(frame)` on a timer (non-blocking), and
`drainCommands()` each tick to apply what mods asked for. Slow or misbehaving mods are skipped, struck, and
eventually disabled; none of this can block the caller.

#### `ModManager.constructor`

```js
constructor({ commands, policy = {}, mode = 'process', log = () => {}, now = () => Date.now(), selftest = false })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.commands` | `import('./commands.js').CommandSpecs` | Operations mods may request. |
| `o.policy` (optional) | `Partial<typeof DEFAULT_POLICY>` |  |
| `o.mode` (optional) | `'process' \| 'inline'` | 'process' = confined child process per mod (use this for anything untrusted). |
| `o.log` (optional) | `(message: string) => void` |  |
| `o.now` (optional) | `() => number` |  |
| `o.selftest` (optional) | `boolean` | Enable runtime diagnostics (tests only). |

#### `ModManager.add`

```js
add(bundle)
```

Register a bundle. Returns problems instead of throwing.

| Name | Type | Description |
|---|---|---|
| `bundle` | `import('./bundle.js').Bundle` |  |

**Returns** `{ok: boolean, errors: string[], id?: string}`

#### `ModManager.start`

```js
async start()
```

Resolve dependency order, then start sandboxes for script mods. Mods with problems are rejected individually.

#### `ModManager.emitFrame`

```js
emitFrame(frame)
```

Offer the current game state to every running script mod. Never blocks: a mod still busy with its previous
frame is skipped. Results become commands (see `drainCommands`) when they arrive.

| Name | Type | Description |
|---|---|---|
| `frame` | `any \| (() => any)` | JSON-serialisable (keep it small: it is copied into each sandbox). Pass a function to build it lazily: it is only called on ticks when some mod is actually due. |

#### `ModManager.drainCommands`

```js
drainCommands()
```

Validated commands produced since the last call, in arrival order.

**Returns** `{mod: string, cmd: any}[]`

#### `ModManager.reload`

```js
async reload(bundle)
```

Replace a script mod with a new bundle (development hot reload). The old version's `serialize()` result,
if any, is handed to the new version's `onInit` as `savedState`.

| Name | Type | Description |
|---|---|---|
| `bundle` | `import('./bundle.js').Bundle` |  |

#### `ModManager.collectRules`

```js
collectRules()
```

Rules from every enabled mod in load order, merged with conflicts reported.

#### `ModManager.advertised`

```js
advertised()
```

What to tell joining clients: the mods that carry client-relevant data, with the hash they must verify.

#### `ModManager.clientViews`

```js
clientViews()
```

**Returns** `Map<string, any>` — content-addressed client views (hash -> data) for serving over HTTP.

#### `ModManager.list`

```js
list()
```

Status of every mod, for dashboards and logs.

#### `ModManager.close`

```js
async close()
```

<sub>src/manager.js:49</sub>

### `class ModSandbox`

```js
class ModSandbox
```

One mod, in its own confined process. Started with:
 --permission (no filesystem except reading the engine's own sandbox files, no child processes, no workers),
 --max-old-space-size (a runaway allocation kills the child, not the server),
 --disallow-code-generation-from-strings (even the child's own realm cannot eval),
 a scrubbed environment, no stdio, and below-normal OS priority.
It does NOT block the network (Node 24's permission model does not cover it): see SECURITY.md.

#### `ModSandbox.constructor`

```js
constructor({ id, source, limits = {}, selftest = false })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.id` | `string` |  |
| `o.source` | `string` | The mod's JavaScript. |
| `o.limits` (optional) | `SandboxLimits` |  |
| `o.selftest` (optional) | `boolean` | Enable diagnostic messages in the runtime (tests only). |

#### `ModSandbox.busy`

```js
get busy
```

#### `ModSandbox.start`

```js
async start()
```

Start the child and load the mod. Resolves `{ok, hooks}` or `{ok: false, kind, error}`.

#### `ModSandbox.call`

```js
call(hook, arg, budgetMs = this.limits.tickBudgetMs)
```

Call a hook. Resolves with the same result shapes as SandboxCore plus `kind: 'crash' | 'watchdog'`.

| Name | Type | Description |
|---|---|---|
| `hook` | `string` |  |
| `arg` | `any` |  |
| `budgetMs` (optional) | `number` |  |

#### `ModSandbox.probe`

```js
probe()
```

Diagnostics from inside the confined process (tests only: requires `selftest`).

#### `ModSandbox.hang`

```js
hang()
```

Block the child's event loop outside the vm (tests only), to exercise the watchdog.

#### `ModSandbox.kill`

```js
kill(reason = 'killed')
```

Terminate the child immediately. The sandbox is dead as soon as this returns.

#### `ModSandbox.stop`

```js
async stop()
```

Ask the child to exit, then make sure it did.

<sub>src/sandbox.js:27</sub>

### `class SandboxCore`

```js
class SandboxCore
```

The confined JavaScript environment a mod script runs in: a fresh context with no host objects, code generation from strings
switched off, and a time limit on every call. Only strings cross the boundary. Node only; `docs/SECURITY.md` explains the
layers.

#### `SandboxCore.constructor`

```js
constructor({ source, filename = 'mod.js', loadBudgetMs = 250, defaultBudgetMs = 2, maxResultBytes = 64 * 1024, maxArgBytes = 256 * 1024 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.source` | `string` | The mod's JavaScript. |
| `o.filename` (optional) | `string` |  |
| `o.loadBudgetMs` (optional) | `number` | CPU budget for loading the script. |
| `o.defaultBudgetMs` (optional) | `number` | CPU budget per call unless overridden. |
| `o.maxResultBytes` (optional) | `number` | Largest result accepted from a call. |
| `o.maxArgBytes` (optional) | `number` | Largest argument sent into a call. |

#### `SandboxCore.load`

```js
load()
```

Create the context, run the mod's top level, and report which hooks it registered.

#### `SandboxCore.call`

```js
call(hook, arg, budgetMs = this.defaultBudgetMs)
```

Call a registered hook with a JSON-serialisable argument.

| Name | Type | Description |
|---|---|---|
| `hook` | `string` |  |
| `arg` | `any` |  |
| `budgetMs` (optional) | `number` |  |

**Returns** `CallResult`

<sub>src/sandbox-core.js:94</sub>

### `generateSigningKey`

```js
function generateSigningKey()
```

Make an Ed25519 key pair for signing mod bundles.

**Returns** `{publicKey: string, privateKey: string}` — Raw public key as hex; private key as PKCS8 PEM.

<sub>src/signing.js:13</sub>

### `loadBundleDir`

```js
function loadBundleDir(dir)
```

Load one mod directory: `mod.json` plus its text files (any depth up to 3), plus an optional `signature.json`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `dir` | `string` |  |

**Returns** `{ok: true, bundle: import('./bundle.js').Bundle, errors: []} \| {ok: false, bundle: null, errors: string[]}`

<sub>src/loader.js:15</sub>

### `loadCatalog`

```js
function loadCatalog(root)
```

Load every mod directory under `root`. Problems are reported per directory, never thrown.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `root` | `string` |  |

**Returns** `{bundles: import('./bundle.js').Bundle[], problems: {dir: string, errors: string[]}[]}`

<sub>src/loader.js:68</sub>

### `signHash`

```js
function signHash(bundleHash, key)
```

Sign a bundle hash.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bundleHash` | `string` | hex |
| `key` | `{publicKey: string, privateKey: string}` |  |

**Returns** `{key: string, sig: string}`

<sub>src/signing.js:25</sub>

### `verifySignature`

```js
function verifySignature(bundleHash, signature)
```

Check a bundle signature: true only for a well-formed, valid signature over exactly this hash. A signature says who
published a bundle, not that it is safe.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bundleHash` | `string` |  |
| `signature` | `{key: string, sig: string} \| null \| undefined` |  |

**Returns** `boolean` — True only for a well-formed, valid signature.

<sub>src/signing.js:39</sub>

## Types

### `Bundle`

A bundle is a manifest plus its files as text, plus an optional signature. The hash covers the manifest and
all files, so it identifies exactly what will run. The *client view* is the data clients need (`rules` and
`client`); it has its own hash, which the server advertises and clients verify before playing.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `manifest` | `import('./manifest.js').ModManifest` |  |
| `files` | `Record<string, string>` | path -> text (the entry script, extra data files) |
| `signature` (optional) | `{key: string, sig: string} \| null` | Ed25519: raw public key (hex) and signature over the bundle hash (hex). |

### `CommandSpecs`

op name -> field name -> spec

Type: `Record<string, Record<string, FieldSpec>>`

### `FieldSpec`

Mods act on the game only through *commands*: small JSON objects the game defines and validates. The mod
proposes, the game decides (and can refuse). A command spec lists exactly the allowed fields and their types.

Type: `{type: 'int' \| 'number', min?: number, max?: number} \| {type: 'string', maxLength?: number} \| {type: 'bool'}`

### `ModManifest`

A mod's `mod.json`. Strict on purpose: unknown fields are errors, so typos do not silently do nothing and
a manifest cannot smuggle in fields a future version might interpret.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `id` | `string` | Lowercase id; namespaces everything the mod adds. |
| `version` | `string` | `x.y.z` |
| `engine` (optional) | `string` | Engine version range, e.g. `^0.0.1`. |
| `name` (optional) | `string` |  |
| `description` (optional) | `string` |  |
| `author` (optional) | `string` |  |
| `tier` | `'data' \| 'script'` |  |
| `entry` (optional) | `string` | Script file (tier `script` only). |
| `dependencies` (optional) | `Record<string, string>` | Other mod ids -> version ranges. |
| `rules` (optional) | `Record<string, any>` | Tier 1: rule values (the game whitelists and range-checks them). |
| `client` (optional) | `Record<string, any>` | Presentation data sent to clients (the game whitelists it). |
| `limits` (optional) | `{tickBudgetMs?: number, memoryMb?: number, tickEvery?: number}` | What the mod asks for; the server policy clamps it. |
