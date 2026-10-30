# @engine/camera

The feel of a 3D view: a follow camera with wall pull-in and shoulder switch, a spring kick, trauma shake, a wider view at speed, and hit-stop.

```
npm install @engine/camera
```

Version 0.1.0. The package's own README ([packages/camera](../../packages/camera/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (12 of 12 documented)

| Name | Kind | Summary |
|---|---|---|
| [`DAMPING`](#damping) | constant | How much of its speed the spring loses each second (see `STIFFNESS`). |
| [`MAX_ANGLE`](#max_angle) | constant | The most the view can be turned or rolled by, in radians. |
| [`MAX_DIP`](#max_dip) | constant | The most the view can dip, in body sizes (a game multiplies `dip` by the size of what the camera is on). |
| [`STIFFNESS`](#stiffness) | constant | How stiff the spring is (per second squared) and how much of its speed it loses (per second): a damping ratio of 0.58, so it overshoots once and settles in about half a second. |
| [`createFollowRig`](#createfollowrig) | function | Make the state of a follow camera (see `stepFollowRig`). |
| [`createHitStop`](#createhitstop) | function | Hit-stop and punch. |
| [`createKick`](#createkick) | function | A resting camera: pitch, yaw and roll (radians) and dip (in body sizes, downward), each with its speed. |
| [`kick`](#kick) | function | Push the camera: `pitch` (positive tips the view up), `yaw` (positive turns it right), `roll` and `dip` are the speeds given to each (about 14 times the most it will swing). |
| [`rushFov`](#rushfov) | function | A wider field of view the faster you go: the factor to multiply the field of view by, 1 up to `from` times top speed, then up to `1 + widen` at `from + over` times it. |
| [`stepFollowRig`](#stepfollowrig) | function | Move the camera for one frame. |
| [`stepKick`](#stepkick) | function | One step of `dt` seconds (in small slices, so a slow frame does not make it unstable). |
| [`traumaShake`](#traumashake) | function | The camera shake of a given trauma (0 to 1), as offsets to add to the camera's position and roll. |

## Functions

### `createFollowRig`

```js
function createFollowRig({ minDistance = 2, margin = 1.5, pullIn = 18, pullOut = 6, sideEase = 9, clearance = 1.5 } = {})
```

Make the state of a follow camera (see `stepFollowRig`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{minDistance?: number, margin?: number, pullIn?: number, pullOut?: number, sideEase?: number, clearance?: number}` | `minDistance` the closest it will come (2), `margin` how far in front of a wall it stays (1.5), `pullIn` / `pullOut` how fast it comes in when blocked and goes out when clear, per second (18 and 6), `sideEase` how fast it changes shoulder (9), `clearance` the least height above the ground (1.5) |

<sub>src/follow.js:18</sub>

### `createHitStop`

```js
function createHitStop({ decay = 0.5 } = {})
```

Hit-stop and punch. A heavy blow freezes the game for a few ticks (`freeze`) and pulls the view in for a moment (`punch`, which fades). In the game loop, for each fixed tick ask `skip()`: while it
says true, do not step the simulation (and draw without moving things).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{decay?: number}` | `decay` how much punch is lost each second (0.5) |

<sub>src/feel.js:28</sub>

### `createKick`

```js
function createKick(spring = {})
```

A resting camera: pitch, yaw and roll (radians) and dip (in body sizes, downward), each with its speed.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spring` (optional) | `{stiffness?: number, damping?: number, maxAngle?: number, maxDip?: number}` | another spring than the default |

<sub>src/kick.js:24</sub>

### `kick`

```js
function kick(k, { pitch = 0, yaw = 0, roll = 0, dip = 0 })
```

Push the camera: `pitch` (positive tips the view up), `yaw` (positive turns it right), `roll` and `dip` are the speeds given to each (about 14 times the most it will swing).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `k` | `ReturnType<typeof createKick>` |  |
| `push` | `{pitch?: number, yaw?: number, roll?: number, dip?: number}` |  |

**Returns** `ReturnType<typeof createKick>`

<sub>src/kick.js:32</sub>

### `rushFov`

```js
function rushFov(speed, topSpeed, { widen = 0.32, from = 1.2, over = 2.2 } = {})
```

A wider field of view the faster you go: the factor to multiply the field of view by, 1 up to `from` times top speed, then up to `1 + widen` at `from + over` times it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `speed` | `number` | how fast now |
| `topSpeed` | `number` | the speed that is "usual" fast |
| `o` (optional) | `{widen?: number, from?: number, over?: number}` | by default 0.32 wider, from 1.2 times top speed over 2.2 more |

<sub>src/feel.js:18</sub>

### `stepFollowRig`

```js
function stepFollowRig(rig, { pivot, yaw, pitch, distance, side = 0, reach = 0, dt, blocked = () => null, ground = () => -Infinity })
```

Move the camera for one frame.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `rig` | `ReturnType<typeof createFollowRig>` |  |
| `o` | `object` |  |
| `o.pivot` | `number[]` | the point it looks at and orbits, `[x, y, z]` (a shoulder height over the body) |
| `o.yaw` | `number` |  |
| `o.pitch` | `number` | the orbit angles, in radians: the camera sits at `pivot + (sin yaw cos pitch, sin pitch, cos yaw cos pitch) * distance`, looking back at the pivot (a game's look angles, when the camera looks the opposite way; give the angles it uses for that) |
| `o.distance` | `number` | how far back it wants to be |
| `o.side` (optional) | `number` | which shoulder: -1 to 1 (it eases toward it) |
| `o.reach` (optional) | `number` | how far to the side that is at 1, in metres (0: straight behind) |
| `o.dt` | `number` | seconds since the last frame |
| `o.blocked` (optional) | `(from: number[], to: number[]) => (number \| null)` | how far along `from` to `to` (0 to 1) a wall is, or null for a clear way |
| `o.ground` (optional) | `(x: number, z: number) => number` | the height of the ground |

**Returns** `{x: number, y: number, z: number, distance: number}`

<sub>src/follow.js:35</sub>

### `stepKick`

```js
function stepKick(k, dt)
```

One step of `dt` seconds (in small slices, so a slow frame does not make it unstable). Returns `k`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `k` | `ReturnType<typeof createKick>` |  |
| `dt` | `number` |  |

<sub>src/kick.js:38</sub>

### `traumaShake`

```js
function traumaShake(trauma, clock, strength = 1)
```

The camera shake of a given trauma (0 to 1), as offsets to add to the camera's position and roll. Trauma squared, so a light one is a tremor and a big one is felt.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `trauma` | `number` | 0 to 1 |
| `clock` | `number` | seconds (any steadily growing time) |
| `strength` (optional) | `number` | how much the player allows (0 to 1), and how hard the game shakes at all |

**Returns** `{x: number, y: number, z: number, roll: number}` — metres, and radians of roll

<sub>src/feel.js:8</sub>

## Constants

### `DAMPING`

```js
const DAMPING
```

How much of its speed the spring loses each second (see `STIFFNESS`).

Value: `11`

<sub>src/kick.js:12</sub>

### `MAX_ANGLE`

```js
const MAX_ANGLE
```

The most the view can be turned or rolled by, in radians.

Value: `0.12`

<sub>src/kick.js:14</sub>

### `MAX_DIP`

```js
const MAX_DIP
```

The most the view can dip, in body sizes (a game multiplies `dip` by the size of what the camera is on).

Value: `0.9`

<sub>src/kick.js:16</sub>

### `STIFFNESS`

```js
const STIFFNESS
```

How stiff the spring is (per second squared) and how much of its speed it loses (per second): a damping ratio of 0.58, so it overshoots once and settles in about half a second.

Value: `90`

<sub>src/kick.js:10</sub>
