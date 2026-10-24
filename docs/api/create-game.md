# @engine/create-game

npx create-game my-game: a new project from a template (2D, 3D or multiplayer card game), wired to the dev server, the build and the editor.

```
npm install @engine/create-game
```

Version 0.1.0. The package's own README ([packages/create-game](../../packages/create-game/README.md)) explains how the pieces fit together; this page lists every export.

Command line: `create-game`

## Contents (4 of 4 documented)

| Name | Kind | Summary |
|---|---|---|
| [`checkName`](#checkname) | function | A name that works as an npm package name and a folder. |
| [`createProject`](#createproject) | function | Make a new game project from a template: copies the template files (filling in the name), writes a `package.json` with the engine packages it needs, and optionally runs `npm install`. |
| [`listTemplates`](#listtemplates) | function | The available templates: `{ name, description, engine }` each, where `engine` lists the engine packages it uses. |
| [`titleOf`](#titleof) | function | "my-cool-game" -> "My Cool Game" |

## Functions

### `checkName`

```js
function checkName(name)
```

A name that works as an npm package name and a folder.

<sub>src/create.js:25</sub>

### `createProject`

```js
function createProject({ dir, name, template = '2d', enginePath, install = false, log = () => {} })
```

Make a new game project from a template: copies the template files (filling in the name), writes a `package.json` with the
engine packages it needs, and optionally runs `npm install`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.dir` | `string` | Where to make the project (made if needed; must be empty if it exists). |
| `o.name` (optional) | `string` | Package name (default: the folder name). |
| `o.template` (optional) | `string` | '2d' or '3d'. |
| `o.enginePath` (optional) | `string` | A checkout of the engine to link instead of installing from npm (`file:` dependencies). |
| `o.install` (optional) | `boolean` | Run `npm install` afterwards. |
| `o.log` (optional) | `(msg: string) => void` |  |

**Returns** `{dir: string, files: string[], dependencies: Record<string, string>}`

<sub>src/create.js:75</sub>

### `listTemplates`

```js
function listTemplates()
```

The available templates: `{ name, description, engine }` each, where `engine` lists the engine packages it uses.

**Returns** `Array<{name: string, description: string, engine: string[]}>`

<sub>src/create.js:17</sub>

### `titleOf`

```js
function titleOf(name)
```

"my-cool-game" -> "My Cool Game"

<sub>src/create.js:32</sub>
