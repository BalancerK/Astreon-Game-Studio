# @engine/math

Deterministic trigonometry, 3D vectors and quaternions for simulation code that the server and the predicting client must agree on **bit for bit**. No dependencies.

**May import:** nothing.

## Why this exists
The language leaves `Math.sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `pow`, `exp`, ... implementation-defined, and engines really do disagree in the last bits. Measured by `node tools/determinism.js` on the same inputs:

| Function | Node 24 | Chrome 154 | Firefox 157 |
|---|---|---|---|
| `Math.sin`, `Math.cos`, `Math.tan` | A | B | C (all three differ) |
| `Math.atan`, `atan2`, `asin`, `acos` | A | B | A |

A one-bit difference per call is enough: a predicting client then drifts from the server and corrects (visible rubber-banding), or a deterministic replay fails. The 2D engine avoided the problem by only using `+ - * /` and `sqrt` (enforced by `tools/check-shared-math.js`). A 3D game needs rotations, so this package provides the functions built **only from `+ - * / sqrt` and comparisons**, which every engine computes exactly.

**Result:** the 11 hash suites in `packages/math/browser-test/suite.js` (sin, cos, tan, sincos, atan, atan2, asin, acos, angle helpers, vec3, quat; 20,000+ inputs each, including huge, tiny, signed zero, infinities and NaN) are **bit-identical in Node, Chrome and Firefox**, while the built-in versions differ.

## Trigonometry
```js
import { sin, cos, sincos, tan, atan, atan2, asin, acos, PI } from '@engine/math';
const out = [0, 0];
sincos(angle, out);                 // [sin, cos] with one argument reduction: the right call for rotations
atan2(dy, dx);                      // same special cases as Math.atan2 (signed zero, infinities, NaN)
```
The algorithms are the classic fdlibm kernels: Cody-Waite reduction by a three-part pi/2, then a polynomial on [-pi/4, pi/4] (atan: argument reduction plus a polynomial). Accuracy is within one unit in the last place of the reference (tested against `Math.*`: worst error 1.1e-16 for sin and cos, 4.4e-16 for acos). `sin(-x) === -sin(x)` and `cos(-x) === cos(x)` hold exactly. Speed is on par with the built-ins (about 1M sines in a few ms).

Limits: argument reduction is exact up to about 1.6 million radians. Beyond that it reduces by whole turns first, which loses precision but stays deterministic; wrap angles with `wrapAngle` before using them. `tan` is `sin / cos`, so it is huge near odd multiples of pi/2, as it should be.

## Angles
`wrapAngle(a)` into [-pi, pi], `deltaAngle(from, to)` the short signed turn, `lerpAngle(from, to, t)` the short way round, `DEG_TO_RAD`, `RAD_TO_DEG`.

## Vectors and quaternions
Plain arrays, **output first, no allocation**, right-handed, **+x right, +y up, the camera looks down -z** (the WebGPU/OpenGL convention; the 2D engine's +y down stays in 2D).
```js
import { vec3, quat } from '@engine/math';
const f = vec3.forward([0, 0, 0], yaw, pitch);       // yaw 0 looks down -z; positive yaw turns left; positive pitch looks up
vec3.right(r, yaw); vec3.cross(o, a, b); vec3.normalize(o, a);   // normalising zero gives zero, never NaN
const q = quat.fromYawPitchRoll([0, 0, 0, 1], yaw, pitch, roll); // "YXZ" first-person camera order
quat.rotate(o, q, [0, 0, -1]);                       // equals vec3.forward(yaw, pitch) for roll 0
quat.multiply(o, a, b);                              // applies b first, then a
quat.slerp(o, a, b, t); quat.nlerp(o, a, b, t);      // shortest arc, constant angular speed (slerp)
```

## Using it from simulation code
Shared simulation code (anything in `packages/*/src`, `examples/*/shared`) may import `@engine/math` and call these. It still may not call `Math.sin` and friends: `tools/check-shared-math.js` fails the build, and this package's own source is under the same rule. Rendering-only code (camera matrices, particles) may use `Math.*` freely.

## Tests
`npm test` covers accuracy against the reference, exact symmetry, every special case, the vector and quaternion algebra, and the recorded golden hashes. `node tools/determinism.js` runs the suites in Node, Chrome and Firefox and fails on any bit of difference (`--update` records new golden hashes).
