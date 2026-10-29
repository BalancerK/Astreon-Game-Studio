# @engine/testkit

Test a game in a real browser from a script: drive headless Chrome, time frames, check the built pages; never leaves a browser running.

```
npm install @engine/testkit
```

Version 0.1.0. The package's own README ([packages/testkit](../../packages/testkit/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (11 of 11 documented)

| Name | Kind | Summary |
|---|---|---|
| [`CPU_RENDER_ARGS`](#cpu_render_args) | constant | Chrome flags that draw on the CPU (a software graphics card). |
| [`UNTHROTTLED_ARGS`](#unthrottled_args) | constant | Chrome flags that stop the display's pace from capping the frame rate, so a frame's cost can be read from how many there are. |
| [`builtSmoke`](#builtsmoke) | function | Build a project the way it ships, serve it and open each page in headless Chrome, collecting what goes wrong. |
| [`findBrowser`](#findbrowser) | function | The path of an installed browser (`CHROME_PATH` / `FIREFOX_PATH` first, then the usual places), or undefined. |
| [`findChrome`](#findchrome) | function | The path of an installed Chrome (or Edge), or undefined. |
| [`guardBrowser`](#guardbrowser) | function | Watch over a browser a test has started. |
| [`killProfile`](#killprofile) | function | End every process that was started with this profile folder, and wait until none is left (up to a few seconds). |
| [`killTree`](#killtree) | function | End a process and everything it started, when its number is known to be right. |
| [`measureFrames`](#measureframes) | function | The average time of a page's animation frames over `seconds`, after `warmSeconds` (a page that compiles big shaders needs a long warm-up on a slow renderer: 45 s for a software one). |
| [`processesOfProfile`](#processesofprofile) | function | The numbers of the processes that were started with this profile folder on their command line. |
| [`withChromePage`](#withchromepage) | function | Open a page in headless Chrome and hand a controller to `fn`. |

## Functions

### `builtSmoke`

```js
async function builtSmoke(root, { pages, wait = 5, allow = ['favicon'], args = [] } = {})
```

Build a project the way it ships, serve it and open each page in headless Chrome, collecting what goes wrong.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `root` | `string` | the project folder (its `engine.config.json` says how it is built) |
| `o` (optional) | `{pages?: string[], wait?: number, allow?: string[], args?: string[]}` | `pages` default to the config's; `wait` seconds on each page (5); `allow` texts of messages that are expected (default `favicon`): a missing icon, a game server that is not running; `args` more Chrome flags |

**Returns** `Promise<{ok: boolean, results: Array<{page: string, problems: string[]}>}>`

<sub>src/smoke.js:18</sub>

### `findBrowser`

```js
function findBrowser(browser = 'chrome')
```

The path of an installed browser (`CHROME_PATH` / `FIREFOX_PATH` first, then the usual places), or undefined.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `browser` (optional) | `'chrome' \| 'firefox'` |  |

**Returns** `string \| undefined`

<sub>src/browser.js:21</sub>

### `findChrome`

```js
function findChrome()
```

The path of an installed Chrome (or Edge), or undefined.

**Returns** `string \| undefined`

<sub>src/browser.js:23</sub>

### `guardBrowser`

```js
function guardBrowser(proc, profile)
```

Watch over a browser a test has started.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `proc` | `import('node:child_process').ChildProcess` | what `spawn` gave back (it may only be a launcher: the profile is what finds the browser) |
| `profile` (optional) | `string` | the browser's profile folder (a fresh one for this run) |

**Returns** `{stop: () => void}`

<sub>src/guard.js:89</sub>

### `killProfile`

```js
function killProfile(profile)
```

End every process that was started with this profile folder, and wait until none is left (up to a few seconds). Returns how many it ended.

<sub>src/guard.js:32</sub>

### `killTree`

```js
function killTree(pid)
```

End a process and everything it started, when its number is known to be right.

<sub>src/guard.js:44</sub>

### `measureFrames`

```js
async function measureFrames(page, { seconds = 10, warmSeconds = 0 } = {})
```

The average time of a page's animation frames over `seconds`, after `warmSeconds` (a page that compiles big shaders needs a long warm-up on a slow renderer: 45 s for a software one).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `page` | `{eval: (expression: string) => Promise<any>}` | from `withChromePage` |
| `o` (optional) | `{seconds?: number, warmSeconds?: number}` |  |

**Returns** `Promise<{frames: number, ms: number, fps: number}>`

<sub>src/frames.js:20</sub>

### `processesOfProfile`

```js
function processesOfProfile(profile)
```

The numbers of the processes that were started with this profile folder on their command line.

<sub>src/guard.js:21</sub>

### `withChromePage`

```js
async function withChromePage(url, fn, { width = 1400, height = 800, args = [] } = {})
```

Open a page in headless Chrome and hand a controller to `fn`.
Controller: `eval(expr)`, `key(code, down|up)`, `type(text)`, `mouse(type, x, y, options)`, `touch(type, points)`, `screenshot()` -> PNG Buffer, `waitFor(expr, ms)`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `url` | `string` |  |
| `fn` | `(page: any) => Promise<T>` |  |
| `o` (optional) | `{width?: number, height?: number, args?: string[]}` | `args` are more command line flags for Chrome (for example `--disable-gpu-vsync`, to time frames without the display's pace) |

**Returns** `Promise<T>`

<sub>src/chrome.js:22</sub>

## Constants

### `CPU_RENDER_ARGS`

```js
const CPU_RENDER_ARGS
```

Chrome flags that draw on the CPU (a software graphics card). It is far slower than any real card and balances work differently (it has no early depth test, for one), so it cannot say how fast a
game runs on a given card; it does show what scales with the picture (pixels, passes), and by how much, on a machine with no slow card to hand.

Value: `Object.freeze(['--use-angle=swiftshader', '--use-gl=angle'])`

<sub>src/frames.js:10</sub>

### `UNTHROTTLED_ARGS`

```js
const UNTHROTTLED_ARGS
```

Chrome flags that stop the display's pace from capping the frame rate, so a frame's cost can be read from how many there are.

Value: `Object.freeze(['--disable-gpu-vsync', '--disable-frame-rate-limit'])`

<sub>src/frames.js:4</sub>
