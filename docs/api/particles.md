# @engine/particles

Particle effects for the 3D renderer: data-driven bursts and emitters, streaks, decals, additive glow; presets for muzzle flashes, impacts, bullet holes, dust, explosions.

```
npm install @engine/particles
```

Version 0.1.0. The package's own README ([packages/particles](../../packages/particles/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (4 of 4 documented)

| Name | Kind | Summary |
|---|---|---|
| [`Emitter`](#class-emitter) | class | A source that keeps making an effect: at a `rate` per second, or every `spacing` metres it moves. |
| [`ParticleSystem`](#class-particlesystem) | class | Simulates particles on the CPU into a fixed-capacity pool: `burst` and `line` make effects at once, `emitter` makes continuous ones, `update(dt)` moves everything (gravity, an optional bouncing floor), and `writeTo(batch)` fills a `ParticleBatch` for the renderer. |
| [`effects`](#effects) | constant | Ready-made effects as plain data (`muzzleFlash`, `impact`, `sparks`, `dust`, `explosion`, `bulletHole`, …). |
| [`seededRandom`](#seededrandom) | function | mulberry32: small, fast and seedable, so effects can be reproduced in tests. |

## Functions

### `seededRandom`

```js
function seededRandom(seed = 1)
```

mulberry32: small, fast and seedable, so effects can be reproduced in tests.

<sub>src/system.js:35</sub>

## Classes

### `class Emitter`

```js
class Emitter
```

A source that keeps making an effect: at a `rate` per second, or every `spacing` metres it moves. Made by
`ParticleSystem.emitter`; move it with `move(x, y, z)` and end it with `stop()`.

#### `Emitter.constructor`

```js
constructor(system, effect, { x = 0, y = 0, z = 0, rate = 0, spacing = 0, dir, scale, life = Infinity } = {})
```

#### `Emitter.move`

```js
move(x, y, z)
```

#### `Emitter.stop`

```js
stop()
```

#### `Emitter.update`

```js
update(dt)
```

<sub>src/system.js:196</sub>

### `class ParticleSystem`

```js
class ParticleSystem
```

Simulates particles on the CPU into a fixed-capacity pool: `burst` and `line` make effects at once, `emitter` makes continuous
ones, `update(dt)` moves everything (gravity, an optional bouncing floor), and `writeTo(batch)` fills a `ParticleBatch` for the
renderer. Seeded, so the same calls give the same particles.

#### `ParticleSystem.constructor`

```js
constructor({ capacity = 4096, gravity = [0, -9.8, 0], floorY = null, random = seededRandom(1) } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.capacity` (optional) | `number` | Most particles alive at once; new ones are dropped when full (counted in `dropped`). |
| `o.gravity` (optional) | `number[]` | Acceleration, default [0, -9.8, 0]. |
| `o.floorY` (optional) | `number \| null` | Height of an invisible floor particles bounce on (null: none). |
| `o.random` (optional) | `() => number` | A 0..1 generator (default: seeded, deterministic). |

#### `ParticleSystem.clear`

```js
clear()
```

Kill everything and stop every emitter.

#### `ParticleSystem.burst`

```js
burst(effect, x, y, z, o = {})
```

Spawn a burst.

| Name | Type | Description |
|---|---|---|
| `effect` | `Effect \| Effect[]` | An array plays each part (flash, smoke and sparks of one explosion). |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |
| `o` (optional) | `{dir?: number[], scale?: number, amount?: number, tint?: number[], velocity?: number[]}` | `dir` overrides the effect's axis, `scale` multiplies sizes and speeds, `amount` the particle count, `tint` multiplies the colour, `velocity` is added to every particle (a moving source). |

#### `ParticleSystem.line`

```js
line(effect, x0, y0, z0, x1, y1, z1, spacing = 0.5, o = {})
```

Particles along a segment (a tracer's glow, a trail): one burst every `spacing` world units.

| Name | Type | Description |
|---|---|---|
| `effect` | `Effect \| Effect[]` |  |

#### `ParticleSystem.emitter`

```js
emitter(effect, o = {})
```

A continuous source: `rate` bursts per second, and/or one burst per `spacing` world units it moves (a trail behind a projectile).
Move it with `emitter.move(x, y, z)`; stop it with `emitter.stop()`.

| Name | Type | Description |
|---|---|---|
| `effect` | `Effect \| Effect[]` |  |
| `o` (optional) | `{x?: number, y?: number, z?: number, rate?: number, spacing?: number, dir?: number[], scale?: number, life?: number}` | `life`: stop by itself after that many seconds. |

#### `ParticleSystem.update`

```js
update(dt)
```

Advance by `dt` seconds.

#### `ParticleSystem.writeTo`

```js
writeTo(batch)
```

Add every live particle to a batch (anything with `push(x, y, z, size, r, g, b, a, vx, vy, vz, stretch, rot, additive, hardness, orient)`).

| Name | Type | Description |
|---|---|---|
| `batch` | `{push: Function}` |  |

<sub>src/system.js:45</sub>

## Constants

### `effects`

```js
const effects
```

Ready-made effects as plain data (`muzzleFlash`, `impact`, `sparks`, `dust`, `explosion`, `bulletHole`, …). Copy one and change
what you like: `{ ...effects.sparks, count: 30 }`.

Value: `{`

<sub>src/effects.js:10</sub>

## Types

### `Effect`

Everything optional; ranges are `[min, max]` or a single number.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `count` (optional) | `number \| [number, number]` | Particles per burst (default 8). |
| `life` (optional) | `number \| [number, number]` | Seconds (0.5). |
| `speed` (optional) | `number \| [number, number]` | Initial speed along a random direction in the cone (0). |
| `spread` (optional) | `number` | Cone half-angle around `dir` in radians; Math.PI is every direction (0). |
| `dir` (optional) | `number[]` | Cone axis (up). |
| `size` (optional) | `number \| [number, number]` | Start radius in world units (0.1). |
| `sizeEnd` (optional) | `number \| [number, number]` | Multiplier on the size at the end of life (1). |
| `color` (optional) | `number[]` | Start colour [r, g, b, a] 0..1 (white). |
| `colorEnd` (optional) | `number[]` | End colour (the start colour, fully transparent). |
| `hold` (optional) | `number` | Fraction of life the colour stays put before fading (0). |
| `fadeIn` (optional) | `number` | Fraction of life over which opacity rises from 0 (0). |
| `gravity` (optional) | `number` | Multiplier on the system's gravity (0). |
| `drag` (optional) | `number` | Speed lost per second, as exp(-drag * dt) (0). |
| `stretch` (optional) | `number` | Streak length per unit of speed, for orient 'stretch' (0). |
| `spin` (optional) | `number \| [number, number]` | Radians per second (0). |
| `additive` (optional) | `number` | 0 alpha blended .. 1 adds light (0). |
| `hardness` (optional) | `number` | 0 soft .. 1 crisp disc (0). |
| `orient` (optional) | `'billboard' \| 'stretch' \| 'flat'` | Faces the camera, stretches along its velocity, or lies flat on a surface with normal `dir` (a decal; it does not move). |
| `bounce` (optional) | `number` | Bounciness off `floorY` (0 = lands and slides to a stop). |
| `radius` (optional) | `number` | Random offset of the start position (0). |
