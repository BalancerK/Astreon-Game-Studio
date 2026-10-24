# @engine/math

Deterministic sin/cos/tan/atan2/asin/acos plus 3D vectors and quaternions, bit-identical in Node, Chrome and Firefox (the built-in Math.sin is not).

```
npm install @engine/math
```

Version 0.1.0. The package's own README ([packages/math](../../packages/math/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (60 of 60 documented)

| Name | Kind | Summary |
|---|---|---|
| [`DEG_TO_RAD`](#deg_to_rad) | constant | Multiply degrees by this to get radians. |
| [`HALF_PI`](#half_pi) | constant | π / 2. |
| [`PI`](#pi) | constant | π. |
| [`QUARTER_PI`](#quarter_pi) | constant | π / 4. |
| [`RAD_TO_DEG`](#rad_to_deg) | constant | Multiply radians by this to get degrees. |
| [`TWO_PI`](#two_pi) | constant | 2π. |
| [`acos`](#acos) | function | Arc cosine of `x` in radians (0 to π), computed with + - * / and sqrt only, so the result is the same bits in every engine. |
| [`asin`](#asin) | function | Arc sine of `x` in radians (-π/2 to π/2), computed with + - * / and sqrt only, so the result is the same bits in every engine. |
| [`atan`](#atan) | function | Arc tangent of `x` in radians (-π/2 to π/2), computed with + - * / only, so the result is the same bits in every engine. |
| [`atan2`](#atan2) | function | Angle of the point (x, y) from the +x axis, in (-pi, pi]; same special cases as Math.atan2. |
| [`cos`](#cos) | function | Cosine of `x` (radians), computed with + - * / only, so the result is the same bits in every engine (unlike `Math.cos`). |
| [`deltaAngle`](#deltaangle) | function | The shortest signed turn from angle `from` to angle `to`, in [-pi, pi]. |
| [`lerpAngle`](#lerpangle) | function | Interpolate between two angles the short way round. |
| [`mat4`](#mat4) | namespace | 4x4 matrices as plain arrays or Float32Array/Float64Array of 16, COLUMN-major (element [column * 4 + row]), the layout both WebGPU and WebGL expect, so a matrix can be uploaded as it is. |
| [`quat`](#quat) | namespace | Quaternions as plain arrays [x, y, z, w] (unit length for rotations); output-first and allocation-free. |
| [`sin`](#sin) | function | Sine of `x` (radians), computed with + - * / only, so the result is the same bits in every engine (unlike `Math.sin`). |
| [`sincos`](#sincos) | function | Both at once with a single argument reduction: the right call for rotations. |
| [`tan`](#tan) | function | Tangent of `x` (radians), computed with + - * / only, so the result is the same bits in every engine. |
| [`vec3`](#vec3) | namespace | 3D vectors as plain arrays [x, y, z] (or Float64Array(3)): no function here allocates; the first argument is the output (and may be one of the inputs). |
| [`wrapAngle`](#wrapangle) | function | Wrap an angle (radians) into [-pi, pi]. |

## Functions

### `acos`

```js
function acos(x)
```

Arc cosine of `x` in radians (0 to π), computed with + - * / and sqrt only, so the result is the same bits in every engine.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` | In [-1, 1]; NaN outside. |

**Returns** `number` — Radians in [0, pi].

<sub>src/trig.js:225</sub>

### `asin`

```js
function asin(x)
```

Arc sine of `x` in radians (-π/2 to π/2), computed with + - * / and sqrt only, so the result is the same bits in every engine.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` | In [-1, 1]; NaN outside. |

**Returns** `number` — Radians in [-pi/2, pi/2].

<sub>src/trig.js:214</sub>

### `atan`

```js
function atan(x)
```

Arc tangent of `x` in radians (-π/2 to π/2), computed with + - * / only, so the result is the same bits in every engine.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |

**Returns** `number` — Radians in [-pi/2, pi/2].

<sub>src/trig.js:161</sub>

### `atan2`

```js
function atan2(y, x)
```

Angle of the point (x, y) from the +x axis, in (-pi, pi]; same special cases as Math.atan2.

<sub>src/trig.js:188</sub>

### `cos`

```js
function cos(x)
```

Cosine of `x` (radians), computed with + - * / only, so the result is the same bits in every engine (unlike `Math.cos`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Radians. |

<sub>src/trig.js:110</sub>

### `deltaAngle`

```js
function deltaAngle(from, to)
```

The shortest signed turn from angle `from` to angle `to`, in [-pi, pi].

<sub>src/angle.js:10</sub>

### `lerpAngle`

```js
function lerpAngle(from, to, t)
```

Interpolate between two angles the short way round.

<sub>src/angle.js:15</sub>

### `sin`

```js
function sin(x)
```

Sine of `x` (radians), computed with + - * / only, so the result is the same bits in every engine (unlike `Math.sin`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Radians. |

<sub>src/trig.js:94</sub>

### `sincos`

```js
function sincos(x, out)
```

Both at once with a single argument reduction: the right call for rotations.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Radians. |
| `out` | `number[] \| Float64Array` | Receives [sin, cos]. |

<sub>src/trig.js:126</sub>

### `tan`

```js
function tan(x)
```

Tangent of `x` (radians), computed with + - * / only, so the result is the same bits in every engine.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Radians. Near odd multiples of pi/2 the result is huge, as it should be. |

<sub>src/trig.js:144</sub>

### `wrapAngle`

```js
function wrapAngle(a)
```

Wrap an angle (radians) into [-pi, pi]. Exact for angles that are already inside.

<sub>src/angle.js:4</sub>

## Constants

### `DEG_TO_RAD`

```js
const DEG_TO_RAD
```

Multiply degrees by this to get radians.

Value: `0.017453292519943295`

<sub>src/angle.js:20</sub>

### `HALF_PI`

```js
const HALF_PI
```

π / 2.

Value: `1.5707963267948966`

<sub>src/trig.js:19</sub>

### `PI`

```js
const PI
```

π.

Value: `3.141592653589793`

<sub>src/trig.js:15</sub>

### `QUARTER_PI`

```js
const QUARTER_PI
```

π / 4.

Value: `0.7853981633974483`

<sub>src/trig.js:21</sub>

### `RAD_TO_DEG`

```js
const RAD_TO_DEG
```

Multiply radians by this to get degrees.

Value: `57.29577951308232`

<sub>src/angle.js:22</sub>

### `TWO_PI`

```js
const TWO_PI
```

2π.

Value: `6.283185307179586`

<sub>src/trig.js:17</sub>

## Namespaces

### `mat4`

4x4 matrices as plain arrays or Float32Array/Float64Array of 16, COLUMN-major (element [column * 4 + row]), the layout both WebGPU and WebGL expect, so a matrix can be uploaded as it is. Output-first and allocation-free, like vec3 and quat. Right-handed, +y up, the camera looks down -z. `perspective` and `orthographic` give clip-space depth in [0, 1] (WebGPU's convention; the WebGL2 renderer remaps it in the vertex shader). Deterministic: only + - * / and sqrt, plus this package's own sin, cos and tan.

#### `mat4.compose`

```js
function compose(out, px, py, pz, q, sx, sy, sz)
```

A model matrix from a position, a rotation quaternion and a scale (the usual translate * rotate * scale).

<sub>src/mat4.js:66</sub>

#### `mat4.copy`

```js
function copy(out, a)
```

out = a. Returns `out`.

<sub>src/mat4.js:20</sub>

#### `mat4.create`

```js
function create()
```

A new identity matrix (16 numbers, column-major).

<sub>src/mat4.js:10</sub>

#### `mat4.fromQuat`

```js
function fromQuat(out, q)
```

The rotation matrix of a unit quaternion [x, y, z, w].

<sub>src/mat4.js:54</sub>

#### `mat4.identity`

```js
function identity(out)
```

Set `out` to the identity matrix. Returns `out`.

<sub>src/mat4.js:13</sub>

#### `mat4.invert`

```js
function invert(out, a)
```

out = a^-1, or the identity if `a` is singular. Returns false when it was singular. `out` may be `a`.

<sub>src/mat4.js:140</sub>

#### `mat4.lookAt`

```js
function lookAt(out, eye, target, up)
```

The view matrix of a camera at `eye` looking at `target`; `up` is usually [0, 1, 0].

<sub>src/mat4.js:105</sub>

#### `mat4.multiply`

```js
function multiply(out, a, b)
```

out = a * b: the transform that applies `b` first, then `a`. `out` may be `a` or `b`.

<sub>src/mat4.js:26</sub>

#### `mat4.orthographic`

```js
function orthographic(out, l, r, b, t, near, far)
```

Orthographic projection of the box [l, r] x [b, t] x [-near, -far] to clip space (depth 0..1).

<sub>src/mat4.js:92</sub>

#### `mat4.perspective`

```js
function perspective(out, fovY, aspect, near, far)
```

Perspective projection (right-handed, looking down -z; clip depth 0 at `near` and 1 at `far`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `fovY` | `number` | Vertical field of view in radians |
| `aspect` | `number` | Width / height |

<sub>src/mat4.js:80</sub>

#### `mat4.scaling`

```js
function scaling(out, x, y, z)
```

Set `out` to a scale by (x, y, z). Returns `out`.

<sub>src/mat4.js:47</sub>

#### `mat4.transformDirection`

```js
function transformDirection(out, m, d)
```

Transform the direction d by the upper 3x3 of m (no translation, no divide). `out` may be `d`.

<sub>src/mat4.js:181</sub>

#### `mat4.transformPoint`

```js
function transformPoint(out, m, p)
```

Transform the point p by m (with the perspective divide). `out` may be `p`.

<sub>src/mat4.js:170</sub>

#### `mat4.translation`

```js
function translation(out, x, y, z)
```

Set `out` to a move by (x, y, z). Returns `out`.

<sub>src/mat4.js:40</sub>

#### `mat4.viewFromYawPitch`

```js
function viewFromYawPitch(out, x, y, z, yaw, pitch, roll = 0)
```

The view matrix of a first-person camera: at (x, y, z) with the orientation of yaw/pitch/roll (see quat.fromYawPitchRoll;
`vec3.forward(yaw, pitch)` is the direction it looks).

<sub>src/mat4.js:129</sub>

<sub>src/mat4.js:1</sub>

### `quat`

Quaternions as plain arrays [x, y, z, w] (unit length for rotations); output-first and allocation-free. Deterministic: sin, cos and atan2 come from this package, never Math.*.

#### `quat.conjugate`

```js
function conjugate(out, a)
```

out = the conjugate of `a` (the inverse rotation, for a unit quaternion). Returns `out`.

<sub>src/quat.js:12</sub>

#### `quat.copy`

```js
function copy(out, a)
```

out = a. Returns `out`.

<sub>src/quat.js:10</sub>

#### `quat.dot`

```js
function dot(a, b)
```

The dot product of two quaternions (1 means the same rotation, for unit quaternions).

<sub>src/quat.js:14</sub>

#### `quat.fromAxisAngle`

```js
function fromAxisAngle(out, axis, angle)
```

Rotation of `angle` radians around the (unit) `axis`.

<sub>src/quat.js:17</sub>

#### `quat.fromYawPitchRoll`

```js
function fromYawPitchRoll(out, yaw, pitch, roll = 0)
```

First-person camera orientation: yaw around +y, then pitch around the new +x, then roll around the new +z
(the "YXZ" order). Rotating (0, 0, -1) by the result gives `forward(yaw, pitch)` from vec3.js.

<sub>src/quat.js:46</sub>

#### `quat.identity`

```js
function identity(out)
```

Set `out` to the identity rotation [0, 0, 0, 1]. Returns `out`.

<sub>src/quat.js:8</sub>

#### `quat.multiply`

```js
function multiply(out, a, b)
```

Hamilton product: the rotation that applies `b` first, then `a`. `out` may be `a` or `b`.

<sub>src/quat.js:24</sub>

#### `quat.nlerp`

```js
function nlerp(out, a, b, t)
```

Normalised linear interpolation: cheap, and good for small steps.

<sub>src/quat.js:69</sub>

#### `quat.normalize`

```js
function normalize(out, a)
```

Scale to unit length; a zero quaternion becomes the identity.

<sub>src/quat.js:34</sub>

#### `quat.rotate`

```js
function rotate(out, q, v)
```

Rotate the vector `v` by the unit quaternion `q`. `out` may be `v`.

<sub>src/quat.js:58</sub>

#### `quat.slerp`

```js
function slerp(out, a, b, t)
```

Spherical interpolation along the shortest arc at constant angular speed.

<sub>src/quat.js:79</sub>

<sub>src/quat.js:1</sub>

### `vec3`

3D vectors as plain arrays [x, y, z] (or Float64Array(3)): no function here allocates; the first argument is the output (and may be one of the inputs). Right-handed, +x right, +y up, the camera looks down -z. Deterministic: only + - * / and sqrt, plus this package's own sin and cos.

#### `vec3.add`

```js
function add(out, a, b)
```

out = a + b. Returns `out`.

<sub>src/vec3.js:13</sub>

#### `vec3.addScaled`

```js
function addScaled(out, a, b, s)
```

out = a + b * s

<sub>src/vec3.js:19</sub>

#### `vec3.copy`

```js
function copy(out, a)
```

out = a. Returns `out`.

<sub>src/vec3.js:11</sub>

#### `vec3.create`

```js
function create(x = 0, y = 0, z = 0)
```

A new vector [x, y, z].

<sub>src/vec3.js:7</sub>

#### `vec3.cross`

```js
function cross(out, a, b)
```

out = a x b (right-handed).

<sub>src/vec3.js:34</sub>

#### `vec3.distance`

```js
function distance(a, b)
```

The distance between points `a` and `b`.

<sub>src/vec3.js:27</sub>

#### `vec3.dot`

```js
function dot(a, b)
```

The dot product of `a` and `b`.

<sub>src/vec3.js:21</sub>

#### `vec3.forward`

```js
function forward(out, yaw, pitch)
```

The direction a camera or player looks for the given angles. Yaw 0 looks down -z; positive yaw turns left
(counter-clockwise seen from above); positive pitch looks up.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `out` | `number[]` |  |
| `yaw` | `number` | Radians |
| `pitch` | `number` | Radians |

<sub>src/vec3.js:58</sub>

#### `vec3.length`

```js
function length(a)
```

The length of `a`.

<sub>src/vec3.js:25</sub>

#### `vec3.lengthSq`

```js
function lengthSq(a)
```

The squared length of `a` (no square root: cheaper for comparisons).

<sub>src/vec3.js:23</sub>

#### `vec3.lerp`

```js
function lerp(out, a, b, t)
```

out = a + (b - a) * t. Returns `out`.

<sub>src/vec3.js:29</sub>

#### `vec3.negate`

```js
function negate(out, a)
```

out = -a. Returns `out`.

<sub>src/vec3.js:31</sub>

#### `vec3.normalize`

```js
function normalize(out, a)
```

Unit vector in the direction of `a`; the zero vector stays zero (never NaN).

<sub>src/vec3.js:41</sub>

#### `vec3.right`

```js
function right(out, yaw)
```

The unit vector to the right of a yaw (always horizontal).

<sub>src/vec3.js:67</sub>

#### `vec3.scale`

```js
function scale(out, a, s)
```

out = a * s. Returns `out`.

<sub>src/vec3.js:17</sub>

#### `vec3.set`

```js
function set(out, x, y, z)
```

Set `out` to (x, y, z). Returns `out`.

<sub>src/vec3.js:9</sub>

#### `vec3.sub`

```js
function sub(out, a, b)
```

out = a - b. Returns `out`.

<sub>src/vec3.js:15</sub>

<sub>src/vec3.js:1</sub>
