# @engine/build

Production build (bundle, minify, content-hashed files, manifest, precompression) and a dev server with live manifest and page reload.

```
npm install @engine/build
```

Version 0.1.0. The package's own README ([packages/build](../../packages/build/README.md)) explains how the pieces fit together; this page lists every export.

Command line: `engine-build`

## Contents (16 of 16 documented)

| Name | Kind | Summary |
|---|---|---|
| [`BundleError`](#class-bundleerror) | class | The bundler could not bundle the code (a missing file, a circular import, an unsupported form). |
| [`build`](#build) | function | Build a project. |
| [`bundle`](#bundle) | function | Bundle an entry module and everything it imports. |
| [`codeTest`](#codetest) | function | A function that says whether an offset is code (not inside a comment, string, regular expression or the text of a template). |
| [`findImportMap`](#findimportmap) | function | Browsers cannot resolve `import '@engine/render'`; an import map tells them where it is. |
| [`formatReport`](#formatreport) | function | A short text report of a build. |
| [`globToRegExp`](#globtoregexp) | function | `*` = within a folder, `**` = any folders, `?` = one character, `{a,b}` = either. |
| [`hashBytes`](#hashbytes) | function | A short SHA-256 hex digest of some bytes, used in hashed file names (`length` hex digits, default 8). |
| [`matchFiles`](#matchfiles) | function | Files below `root` matching any of the globs (relative to root), sorted. |
| [`minifyCss`](#minifycss) | function | CSS without comments and with the whitespace that does not matter removed. |
| [`minifyJs`](#minifyjs) | function | Makes JavaScript smaller without changing what it does: removes comments and indentation (keeping every line break, and anything inside strings, templates and regular expressions exactly). |
| [`minifyJson`](#minifyjson) | function | JSON without whitespace (throws on invalid JSON with the position). |
| [`resolveImport`](#resolveimport) | function | Where an import specifier points. |
| [`scan`](#scan) | function | Split source text into the parts that are not code. |
| [`serve`](#serve) | function | `handle(req, res)` runs first for every request: return true if it answered (your own API next to the pages). |
| [`transformModule`](#transformmodule) | function | Rewrite one module's imports and exports. |

## Functions

### `build`

```js
function build(config = {})
```

Build a project. Same input, same output, byte for byte.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `config` | `BuildConfig` |  |

**Returns** `{outDir: string, files: Array<{path: string, bytes: number, gzip?: number, brotli?: number}>, manifest: any, bundles: Array<{page: string, entry: string, file: string, modules: number, source: number, minified: number, gzip: number}>, warnings: string[]}`

<sub>src/build.js:51</sub>

### `bundle`

```js
function bundle(entry, { root, minify = false, alias = {}, define = {} } = {})
```

Bundle an entry module and everything it imports.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `entry` | `string` | Path to the entry file. |
| `o` (optional) | `object` |  |
| `o.root` (optional) | `string` | Module ids are paths relative to this (default: the entry's folder). |
| `o.minify` (optional) | `boolean` |  |
| `o.alias` (optional) | `Record<string, string>` | Replace the start of a specifier: `{ '@game': '/abs/path/src' }`. |
| `o.define` (optional) | `Record<string, string>` | Replace plain identifiers with literal text: `{ DEBUG: 'false' }` (code only, never inside strings). |

**Returns** `{code: string, modules: Array<{id: string, file: string, bytes: number}>}` — modules in the order they run

<sub>src/bundle.js:155</sub>

### `codeTest`

```js
function codeTest(segments)
```

A function that says whether an offset is code (not inside a comment, string, regular expression or the text of a template).

<sub>src/lexer.js:71</sub>

### `findImportMap`

```js
function findImportMap(root)
```

Browsers cannot resolve `import '@engine/render'`; an import map tells them where it is. This lists the `@engine/*` packages installed in
the project's node_modules and maps each to a URL under `/@modules/`, which the dev server serves from there.

**Returns** `{imports: Record<string, string>, packages: Map<string, string>}`

<sub>src/dev.js:15</sub>

### `formatReport`

```js
function formatReport(result)
```

A short text report of a build.

<sub>src/build.js:166</sub>

### `globToRegExp`

```js
function globToRegExp(glob)
```

`*` = within a folder, `**` = any folders, `?` = one character, `{a,b}` = either.

<sub>src/files.js:7</sub>

### `hashBytes`

```js
function hashBytes(bytes, length = 8)
```

A short SHA-256 hex digest of some bytes, used in hashed file names (`length` hex digits, default 8).

<sub>src/files.js:43</sub>

### `matchFiles`

```js
function matchFiles(root, globs)
```

Files below `root` matching any of the globs (relative to root), sorted.

<sub>src/files.js:37</sub>

### `minifyCss`

```js
function minifyCss(src)
```

CSS without comments and with the whitespace that does not matter removed.

<sub>src/minify.js:48</sub>

### `minifyJs`

```js
function minifyJs(src, { keepLicense = true } = {})
```

Makes JavaScript smaller without changing what it does: removes comments and indentation (keeping every line break, and anything
inside strings, templates and regular expressions exactly). Names are not shortened.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `src` | `string` |  |
| `o` (optional) | `{keepLicense?: boolean}` | Keep comments that begin with `/*!` (default true). |

<sub>src/minify.js:12</sub>

### `minifyJson`

```js
function minifyJson(text)
```

JSON without whitespace (throws on invalid JSON with the position).

<sub>src/minify.js:43</sub>

### `resolveImport`

```js
function resolveImport(spec, fromFile, { alias = {} } = {})
```

Where an import specifier points.

**Returns** `string` — an absolute file path

<sub>src/bundle.js:37</sub>

### `scan`

```js
function scan(src)
```

Split source text into the parts that are not code.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `src` | `string` |  |

**Returns** `Array<{start: number, end: number, type: 'comment' \| 'string' \| 'template' \| 'regex'}>` — in order, end exclusive. `${...}` inside a template is code.

<sub>src/lexer.js:12</sub>

### `serve`

```js
async function serve({ root = '.', assets = [], port = 8080, host = '127.0.0.1', liveReload = true, writable = [], handle, log = () => {} } = {})
```

`handle(req, res)` runs first for every request: return true if it answered (your own API next to the pages).
`writable` lets pages (the scene editor) list, read, write and delete files in chosen folders: `[{ route: '/__scenes', dir: 'scenes', ext: '.json' }]`.
Names are checked, only that extension is touched, bodies are capped, JSON is validated, writes are atomic, and requests from other origins are refused.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{root?: string, assets?: string[], port?: number, host?: string, publicPath?: string, liveReload?: boolean, writable?: Array<{route: string, dir: string, ext?: string, maxBytes?: number}>, handle?: (req: any, res: any) => boolean \| void, log?: (msg: string) => void}` |  |

**Returns** `Promise<{server: http.Server, port: number, url: string, close(): Promise<void>, manifest(): any, changed(path?: string): void}>`

<sub>src/dev.js:39</sub>

### `transformModule`

```js
function transformModule(src, file, resolveId, { id = file } = {})
```

Rewrite one module's imports and exports.

**Returns** `{code: string, deps: string[]}` — deps are absolute paths, in order

<sub>src/bundle.js:66</sub>

## Classes

### `class BundleError`

```js
class BundleError extends Error
```

The bundler could not bundle the code (a missing file, a circular import, an unsupported form). The message names the file.

#### `BundleError.constructor`

```js
constructor(message)
```

<sub>src/bundle.js:16</sub>

## Types

### `BuildConfig`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `root` (optional) | `string` | The project folder (default: the current folder). Everything below is relative to it. |
| `outDir` (optional) | `string` | Where the build goes (`dist`). It is emptied first. |
| `pages` (optional) | `string[]` | HTML pages to process (`['index.html']`): their module scripts are bundled, files they refer to are hashed. |
| `assets` (optional) | `string[]` | Globs of files the game loads at run time (`['assets/**']`): they get hashed names and manifest entries. |
| `publicPath` (optional) | `string` | URL prefix the build will be served under (`''` = next to the page, `'/game/'`...). |
| `minify` (optional) | `boolean` | Default true. |
| `compress` (optional) | `Array<'gzip' \| 'brotli'>` | Precompressed copies written next to files that shrink (default both). |
| `hashLength` (optional) | `number` | Hex digits of the content hash in file names (8). |
| `alias` (optional) | `Record<string, string>` | Import specifier prefixes to replace. |
| `define` (optional) | `Record<string, string>` | Identifiers replaced by literal text in the code (`{ DEBUG: 'false' }`). |
| `transforms` (optional) | `Record<string, (bytes: Buffer, file: string) => Buffer \| string>` | By extension (`'.png'`): change a file's bytes before hashing (compress textures, convert audio...). |
| `log` (optional) | `(msg: string) => void` |  |
