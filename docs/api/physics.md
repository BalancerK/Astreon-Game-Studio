# @engine/physics

2D spatial hash and swept box collision; 3D triangle worlds, swept-ellipsoid movement and a character controller (no tunnelling at any speed); rigid bodies with joints, sleeping and triggers.

```
npm install @engine/physics
```

Version 0.1.0. The package's own README ([packages/physics](../../packages/physics/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (57 of 57 documented)

| Name | Kind | Summary |
|---|---|---|
| [`BallJoint`](#class-balljoint) | class | A ball-and-socket: the two bodies share a point and rotate freely about it (a shoulder, a rope link). |
| [`Body2D`](#class-body2d) | class | A 2D simulated object: a circle or convex polygon with mass, friction, bounciness and damping, of type `dynamic` (simulated), `kinematic` (moved only by the velocity you give it, pushes others) or `static` (never moves). |
| [`CONTACT_EDGE`](#contact_edge) | constant | Contact kinds reported by `sweepSphereVsTriangle`. |
| [`CONTACT_FACE`](#contact_face) | constant | Contact kinds reported by `sweepSphereVsTriangle`. |
| [`CONTACT_VERTEX`](#contact_vertex) | constant | Contact kinds reported by `sweepSphereVsTriangle`. |
| [`CharacterController`](#class-charactercontroller) | class | A first- or third-person character body: walks on slopes, climbs steps, falls, jumps, stands still without jitter and slides down surfaces that are too steep. |
| [`ConeJoint`](#class-conejoint) | class | A ball-and-socket whose swing is limited: the two bodies share a point, and the angle between `axis` (a direction fixed in each body, taken from the world direction you pass at creation) as seen on body a and on body b may not exceed `maxSwing` radians. |
| [`DistanceJoint`](#class-distancejoint) | class | A distance joint between two points: a rod (fixed `length`), a rope (`min`/`max` range) or a spring (`frequency` in Hz and `damping` ratio, soft so it stretches). |
| [`DistanceJoint2D`](#class-distancejoint2d) | class | A rod or spring between a point on each body, keeping them `length` apart. |
| [`FixedJoint`](#class-fixedjoint) | class | A weld: the bodies keep their relative position and orientation (a bolted-on part that can break off). |
| [`HingeJoint`](#class-hingejoint) | class | A hinge: the bodies share a point and can only rotate about one axis (a door, a wheel, a knee). |
| [`Joint`](#class-joint) | class | Base of all joints: two bodies (`null` means the world), whether they still collide with each other, and an optional break threshold. |
| [`Joint2D`](#class-joint2d) | class | Base of the joints: the two bodies, whether they may collide with each other, and the steps the world calls. |
| [`MAX_POLYGON_VERTICES`](#max_polygon_vertices) | constant | The most points a polygon shape can have. |
| [`Manifold`](#class-manifold) | class | The result of testing two shapes: a normal from body A towards body B and up to four contact points with their penetration depth. |
| [`Manifold2D`](#class-manifold2d) | class | Where two shapes touch: up to two points (`px`, `py`, `sep` negative when overlapping, `id`) and the normal (`nx`, `ny`) from the first shape toward the second. |
| [`PhysicsWorld`](#class-physicsworld) | class | The rigid-body world: bodies, joints, the static triangle world and the fixed-step `step(dt)` that moves them, with sleeping, triggers, ray casts and `getState` / `setState` for saves. |
| [`PoseInterpolator`](#class-poseinterpolator) | class | Blends each body between where it was before the last physics step and where it is now, so drawing at any frame rate looks smooth. |
| [`Ragdoll`](#class-ragdoll) | class | A character made of rigid bodies. |
| [`RaycastVehicle`](#class-raycastvehicle) | class | A car, bike, cart, hovercraft or anything else that rolls on springs. |
| [`RevoluteJoint2D`](#class-revolutejoint2d) | class | A pin: the point (`x`, `y`, in the world when you make it) stays in the same place on both bodies, which can turn about it, like a hinge, a wheel's axle or a pendulum's pivot. |
| [`RigidBody`](#class-rigidbody) | class | A simulated object: a sphere, box or capsule with mass, friction, restitution, damping, and a type (`dynamic`, `kinematic` or `static`); also sensors (triggers), bullets (continuous collision) and a `userData` slot for your own data. |
| [`SKIN`](#skin) | constant | Gap left between a mover and the surface it hit, so it never rests exactly in contact. |
| [`STATIC_BODY`](#static_body) | constant | The immovable stand-in for the static world (triangle meshes) in contacts. |
| [`SpatialHash`](#class-spatialhash) | class | Uniform-grid broad phase over typed arrays. |
| [`TriWorld`](#class-triworld) | class | Static 3D collision geometry: a triangle soup indexed by a uniform 3D grid (typed arrays, built once). |
| [`VERY_CLOSE`](#very_close) | constant | Gap kept between a mover and the surface it hit, as a fraction of its radius (in ellipsoid space). |
| [`WeldJoint2D`](#class-weldjoint2d) | class | Glue: the two bodies keep the relative position and angle they had when the joint was made (a rigid link; it can flex a little under heavy load). |
| [`World2D`](#class-world2d) | class | The 2D rigid-body world. |
| [`boundingRadius`](#boundingradius) | function | Radius of the smallest sphere around the shape's centre that contains it. |
| [`box`](#box) | function | A box from its half extents (a 1 x 1 x 1 m crate is `box(0.5, 0.5, 0.5)`). |
| [`boxShape`](#boxshape) | function | A box from its half width and half height (a 1 x 1 crate is `boxShape(0.5, 0.5)`). |
| [`capsule`](#capsule) | function | A capsule standing along the body's local y axis: a cylinder `2 * halfHeight` long capped by two hemispheres. |
| [`circleShape`](#circleshape) | function | A circle with its centre at the body's position. |
| [`closestPointOnTriangle`](#closestpointontriangle) | function | Closest point on triangle (a, b, c) to point p (Ericson, Real-Time Collision Detection). |
| [`collide`](#collide) | function | Contacts between two bodies. |
| [`collide2D`](#collide2d) | function | Find where bodies `a` and `b` touch. |
| [`collideTriangle`](#collidetriangle) | function | Contacts between a body and one triangle of the static world, given as the 9 numbers at `verts[o..o+8]`. |
| [`createMoveResult`](#createmoveresult) | function | A reusable result object for `moveBox` (so moving things does not allocate). |
| [`createSlide3Result`](#createslide3result) | function | A reusable result object for `slideEllipsoid` and the character controller (so moving things does not allocate). |
| [`findGround`](#findground) | function | Is the ellipsoid standing on something? |
| [`humanoidRagdollSpec`](#humanoidragdollspec) | function | The description of a humanoid ragdoll of 13 bodies (hips, chest, head, upper and lower arms, upper and lower legs, feet), standing with its arms a little out from its sides, facing +z, its left side toward +x, feet at y = 0. |
| [`moveAndSlide`](#moveandslide) | function | Move a box by (dx, dy), stopping at the first obstacle and sliding along it with the remaining motion (up to `maxIter` contacts, so corners work). |
| [`moveEllipsoid`](#moveellipsoid) | function | Move an ellipsoid (a character body) through static triangle geometry and slide along what it hits. |
| [`polygonShape`](#polygonshape) | function | A convex polygon from points given in order (either way round). |
| [`pushOutEllipsoid`](#pushoutellipsoid) | function | Push an ellipsoid out of any geometry it overlaps (a few iterations along the direction away from the closest point). |
| [`rayBody`](#raybody) | function | The first hit of a ray (origin o, unit direction d) on a body within `maxT`, or -1. |
| [`rayTriangle`](#raytriangle) | function | Ray against a triangle (Moeller-Trumbore), two-sided. |
| [`resetBodyIds`](#resetbodyids) | function | Reset the id counter (a new world, or a test that wants stable numbers). |
| [`resetBodyIds2D`](#resetbodyids2d) | function | Start body numbers again from 1 (a new world, or a test that wants stable numbers). |
| [`shapeRadius`](#shaperadius) | function | Radius of the circle around the shape's centre that holds all of it. |
| [`sinCos`](#sincos) | function | Sine and cosine from + - * / only (a series after bringing the angle near zero), the same in every browser and on the server. |
| [`sphere`](#sphere) | function | A ball. |
| [`substepCount`](#substepcount) | function | How many substeps a caller should split a tick into so no mover travels more than half its smallest extent per substep. |
| [`sweepAabbVsAabb`](#sweepaabbvsaabb) | function | Sweep a moving box against a static box (Minkowski sum + slab test): the box centre becomes a ray against the target grown by the mover's half extents. |
| [`sweepSphereVsTriangle`](#sweepspherevstriangle) | function | Sweep the unit sphere centred at p along v (the whole step) against triangle (a, b, c); two-sided. |
| [`volume`](#volume) | function | Volume in cubic metres (mass = density x volume). |

## Functions

### `boundingRadius`

```js
function boundingRadius(s)
```

Radius of the smallest sphere around the shape's centre that contains it.

<sub>src/rigid/body.js:14</sub>

### `box`

```js
function box(hx, hy, hz)
```

A box from its half extents (a 1 x 1 x 1 m crate is `box(0.5, 0.5, 0.5)`).

<sub>src/rigid/body.js:9</sub>

### `boxShape`

```js
function boxShape(hx, hy)
```

A box from its half width and half height (a 1 x 1 crate is `boxShape(0.5, 0.5)`).

<sub>src/rigid2d/shapes.js:56</sub>

### `capsule`

```js
function capsule(radius, halfHeight)
```

A capsule standing along the body's local y axis: a cylinder `2 * halfHeight` long capped by two hemispheres.

<sub>src/rigid/body.js:11</sub>

### `circleShape`

```js
function circleShape(radius)
```

A circle with its centre at the body's position. Units are metres: keep a 1 x 1 crate near 1 unit and scale when you draw.

<sub>src/rigid2d/shapes.js:11</sub>

### `closestPointOnTriangle`

```js
function closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out)
```

Closest point on triangle (a, b, c) to point p (Ericson, Real-Time Collision Detection).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `px` | `number` |  |
| `py` | `number` |  |
| `pz` | `number` |  |
| `out` | `{x: number, y: number, z: number}` |  |

**Returns** `number` — Squared distance from p to the triangle.

<sub>src/sweep3d.js:29</sub>

### `collide`

```js
function collide(a, b, m)
```

Contacts between two bodies. The normal points from `a` to `b`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `a` | `import('./body.js').RigidBody` |  |
| `b` | `import('./body.js').RigidBody` |  |
| `m` | `Manifold` |  |

<sub>src/rigid/contacts.js:136</sub>

### `collide2D`

```js
function collide2D(m, a, b, margin = 0.02)
```

Find where bodies `a` and `b` touch. `margin` lets contacts that are not quite touching through (so a resting body keeps its contact between steps).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `m` | `Manifold2D` |  |

**Returns** `Manifold2D` — the same manifold, with `count` 0 when they do not touch

<sub>src/rigid2d/collide.js:122</sub>

### `collideTriangle`

```js
function collideTriangle(a, verts, o, m)
```

Contacts between a body and one triangle of the static world, given as the 9 numbers at `verts[o..o+8]`. The normal points from
the body to the triangle (so the triangle plays the part of body B).

<sub>src/rigid/contacts.js:170</sub>

### `createMoveResult`

```js
function createMoveResult()
```

A reusable result object for `moveBox` (so moving things does not allocate).

**Returns** `MoveResult` — Reusable result object.

<sub>src/move.js:20</sub>

### `createSlide3Result`

```js
function createSlide3Result()
```

A reusable result object for `slideEllipsoid` and the character controller (so moving things does not allocate).

**Returns** `Slide3Result` — Reusable result object.

<sub>src/slide3d.js:25</sub>

### `findGround`

```js
function findGround(world, x, y, z, rx, ry, rz, out)
```

Is the ellipsoid standing on something? Looks at every triangle it is touching (within about 1% of its radius) whose
touch point is in the lower part of the body, and reports the most horizontal of their face normals (pointing up).
Using the triangle's own normal rather than the ellipsoid's contact normal matters at ledges and stair edges: the body
rests on an edge there, the contact direction is tilted, yet the surface it stands on is a flat tread.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `out` | `{nx: number, ny: number, nz: number, tri: number, y: number}` | Written: the best support's normal, triangle and the height (world y) of the point it touches (ny = -1 when none). |

**Returns** `boolean` — True if anything supports it.

<sub>src/slide3d.js:207</sub>

### `humanoidRagdollSpec`

```js
function humanoidRagdollSpec({ height = 1.8, mass = 75 } = {})
```

The description of a humanoid ragdoll of 13 bodies (hips, chest, head, upper and lower arms, upper and lower legs, feet), standing with its arms a little out from its sides, facing +z,
its left side toward +x, feet at y = 0. For tight joints step the world with `substeps: 4` and `iterations: 16` or more (a foot landing hard is the stiffest thing it meets). Elbows bend forward and knees backward, only; shoulders, hips, neck and ankles swing within limits; bones are named as `humanoidKey` names them
in `@engine/render` so that `poseFromRagdoll` finds the joints of a skeleton.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{height?: number, mass?: number}` | `height` in metres (1.8), `mass` in kg (75). |

**Returns** `{bones: RagdollBone[]}`

<sub>src/rigid/ragdoll.js:43</sub>

### `moveAndSlide`

```js
function moveAndSlide(hash, cx, cy, hw, hh, dx, dy, mask, ignore, out, maxIter = 4)
```

Move a box by (dx, dy), stopping at the first obstacle and sliding along it
with the remaining motion (up to `maxIter` contacts, so corners work).
Motion is swept, so speed can never tunnel through thin geometry.
Does not push out of existing deep overlap beyond a `SKIN` nudge.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `hash` | `import('./spatial-hash.js').SpatialHash` |  |
| `cx` | `number` |  |
| `cy` | `number` |  |
| `hw` | `number` |  |
| `hh` | `number` |  |
| `dx` | `number` |  |
| `dy` | `number` |  |
| `mask` | `number` | Groups to collide with. |
| `ignore` | `number` | Index of the mover itself, or -1. |
| `out` | `MoveResult` |  |
| `maxIter` (optional) | `number` |  |

**Returns** `MoveResult` — `out`

<sub>src/move.js:41</sub>

### `moveEllipsoid`

```js
function moveEllipsoid(world, px, py, pz, vx, vy, vz, rx, ry, rz, out, wallBelowY = 0, stopAtContact = false)
```

Move an ellipsoid (a character body) through static triangle geometry and slide along what it hits. The motion is a
continuous sweep, so no speed can carry it through a surface (even a single zero-thickness triangle), and the result is
the same bits on every engine. Works in "ellipsoid space": every coordinate divided by the radii makes the body a unit
sphere, which is what the narrow phase sweeps.

Up to 5 contacts are processed; when the motion is jammed between two surfaces it slides along their crease, and between
three it stops.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `world` | `import('./tri-world.js').TriWorld` | A built world. |
| `px` | `number` | Centre |
| `py` | `number` |  |
| `pz` | `number` |  |
| `vx` | `number` | Motion over the whole step |
| `vy` | `number` |  |
| `vz` | `number` |  |
| `rx` | `number` | Radii |
| `ry` | `number` |  |
| `rz` | `number` |  |
| `out` | `Slide3Result` |  |
| `wallBelowY` (optional) | `number` | Contacts whose world normal has 0 <= y < this are treated as vertical walls: sliding along them never lifts the body (a surface too steep to walk on cannot be climbed by pushing against it). Default 0 = off. |
| `stopAtContact` (optional) | `boolean` | Stop at the first contact instead of sliding (a ground probe must not slide down slopes). |

**Returns** `Slide3Result` — `out`

<sub>src/slide3d.js:68</sub>

### `polygonShape`

```js
function polygonShape(points)
```

A convex polygon from points given in order (either way round). The body's position is moved to the polygon's centre of mass: the points you give are
taken relative to the body's origin and re-centred, so `body.x, body.y` is where its middle is. At most 16 points.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `points` | `number[][]` | [[x, y], ...] |

**Returns** `Polygon`

<sub>src/rigid2d/shapes.js:22</sub>

### `pushOutEllipsoid`

```js
function pushOutEllipsoid(world, out, rx, ry, rz, iterations = 4)
```

Push an ellipsoid out of any geometry it overlaps (a few iterations along the direction away from the closest point).
Use before a move when the start may be slightly embedded (teleports, spawns, moving geometry).

**Returns** `boolean` — True if the position changed.

<sub>src/slide3d.js:167</sub>

### `rayBody`

```js
function rayBody(b, ox, oy, oz, dx, dy, dz, maxT, n)
```

The first hit of a ray (origin o, unit direction d) on a body within `maxT`, or -1. Writes the surface normal into n.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `b` | `import('./body.js').RigidBody` |  |
| `n` | `number[]` | 3 numbers |

**Returns** `number` — distance along the ray, or -1

<sub>src/rigid/query.js:9</sub>

### `rayTriangle`

```js
function rayTriangle(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz, maxT)
```

Ray against a triangle (Moeller-Trumbore), two-sided.

**Returns** `number` — Distance along the (unit or not) direction as a multiple of it, or -1 for a miss. Only hits in (0, maxT] count.

<sub>src/sweep3d.js:193</sub>

### `resetBodyIds`

```js
function resetBodyIds()
```

Reset the id counter (a new world, or a test that wants stable numbers).

<sub>src/rigid/body.js:54</sub>

### `resetBodyIds2D`

```js
function resetBodyIds2D()
```

Start body numbers again from 1 (a new world, or a test that wants stable numbers).

<sub>src/rigid2d/body.js:5</sub>

### `shapeRadius`

```js
function shapeRadius(s)
```

Radius of the circle around the shape's centre that holds all of it.

<sub>src/rigid2d/shapes.js:62</sub>

### `sinCos`

```js
function sinCos(angle)
```

Sine and cosine from + - * / only (a series after bringing the angle near zero), the same in every browser and on the server.

<sub>src/rigid2d/shapes.js:70</sub>

### `sphere`

```js
function sphere(radius)
```

A ball.

<sub>src/rigid/body.js:7</sub>

### `substepCount`

```js
function substepCount(speed, dt, minExtent, maxSteps = 8)
```

How many substeps a caller should split a tick into so no mover travels more
than half its smallest extent per substep. Useful when movers interact with
each other (rebuild the hash between substeps); static geometry is already
covered by swept movement.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `speed` | `number` | Units per second |
| `dt` | `number` | Seconds per tick |
| `minExtent` | `number` | Smallest collider size involved |
| `maxSteps` (optional) | `number` |  |

<sub>src/move.js:72</sub>

### `sweepAabbVsAabb`

```js
function sweepAabbVsAabb(cx, cy, hw, hh, dx, dy, bx, by, bhw, bhh, out)
```

Sweep a moving box against a static box (Minkowski sum + slab test):
the box centre becomes a ray against the target grown by the mover's half extents.
If they already overlap, reports t = 0 with the normal of least penetration.
Touching without overlap while moving apart or along the surface is not a hit.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cx` | `number` | Mover centre x |
| `cy` | `number` |  |
| `hw` | `number` | Mover half width |
| `hh` | `number` |  |
| `dx` | `number` | Motion over the whole step |
| `dy` | `number` |  |
| `bx` | `number` | Target centre x |
| `by` | `number` |  |
| `bhw` | `number` | Target half width |
| `bhh` | `number` |  |
| `out` | `Hit` | Written only when true is returned. |

**Returns** `boolean`

<sub>src/sweep.js:31</sub>

### `sweepSphereVsTriangle`

```js
function sweepSphereVsTriangle(px, py, pz, vx, vy, vz, ax, ay, az, bx, by, bz, cx, cy, cz, tLimit, out)
```

Sweep the unit sphere centred at p along v (the whole step) against triangle (a, b, c); two-sided. Reports the earliest
contact earlier than `tLimit`. A sphere that already overlaps the triangle is a hit at t = 0 only if it is moving
toward it (moving away or sliding along is not a hit, so a resting sphere is never stuck).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `tLimit` | `number` | Only hits with t < tLimit count (pass 1 for a full step, or the best hit so far). |
| `out` | `SphereHit` | Written only when true is returned. |

**Returns** `boolean`

<sub>src/sweep3d.js:96</sub>

### `volume`

```js
function volume(s)
```

Volume in cubic metres (mass = density x volume).

<sub>src/rigid/body.js:29</sub>

## Classes

### `class BallJoint`

```js
class BallJoint extends PointJoint
```

A ball-and-socket: the two bodies share a point and rotate freely about it (a shoulder, a rope link).

#### `BallJoint.constructor`

```js
constructor(a, b, anchor)
```

| Name | Type | Description |
|---|---|---|
| `a` | `import('./body.js').RigidBody \| null` |  |
| `b` | `import('./body.js').RigidBody \| null` | null is the world. |
| `anchor` | `number[]` | world position |

#### `BallJoint.prepare`

```js
prepare(h, beta)
```

#### `BallJoint.warmStart`

```js
warmStart()
```

#### `BallJoint.solve`

```js
solve()
```

<sub>src/rigid/joints.js:100</sub>

### `class Body2D`

```js
class Body2D
```

A 2D simulated object: a circle or convex polygon with mass, friction, bounciness and damping, of type `dynamic` (simulated), `kinematic` (moved only by the
velocity you give it, pushes others) or `static` (never moves). Coordinates are metres with +y down, like the 2D renderer; angles are in radians, positive turning
clockwise on screen. The rotation is kept as a cosine and sine so the simulation never needs a trigonometric function.

#### `Body2D.constructor`

```js
constructor({ shape, type = 'dynamic', x = 0, y = 0, angle = 0, density = 1, mass, friction = 0.4, restitution = 0, linearDamping = 0, angularDamping = 0.05, gravityScale = 1, sensor = false, fixedRotation = false, canSleep = true, group = 1, mask = 0xffff, userData = null })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.shape` | `import('./shapes.js').Circle \| import('./shapes.js').Polygon` |  |
| `o.type` (optional) | `'dynamic' \| 'kinematic' \| 'static'` |  |
| `o.x` (optional) | `number` |  |
| `o.y` (optional) | `number` | Position of the shape's centre. |
| `o.angle` (optional) | `number` | Radians. |
| `o.density` (optional) | `number` | kg per square metre (default 1); `mass` overrides it. |
| `o.mass` (optional) | `number` |  |
| `o.friction` (optional) | `number` | Coulomb friction (0.4); two bodies use the geometric mean. |
| `o.restitution` (optional) | `number` | Bounciness 0..1 (0); two bodies use the larger. |
| `o.linearDamping` (optional) | `number` | Speed lost per second, as a rate (0). |
| `o.angularDamping` (optional) | `number` | (0.05) |
| `o.gravityScale` (optional) | `number` | 1 normal, 0 floating. |
| `o.sensor` (optional) | `boolean` | A trigger: reports who overlaps it but never pushes anything. |
| `o.fixedRotation` (optional) | `boolean` | Never turns (a platformer hero). |
| `o.canSleep` (optional) | `boolean` | false keeps it awake (default true). |
| `o.group` (optional) | `number` | Collision category bits (1). |
| `o.mask` (optional) | `number` | Which categories it collides with (all). |
| `o.userData` (optional) | `any` | Anything you want to find again. |

#### `Body2D.angle`

```js
get angle
```

The angle in radians (for drawing; the simulation itself never uses it).

#### `Body2D.setAngle`

```js
setAngle(a)
```

Turn the body to an angle (radians).

#### `Body2D.setPosition`

```js
setPosition(x, y)
```

Put the body somewhere (and wake it).

#### `Body2D.refresh`

```js
refresh()
```

Recompute the corner points and bounding box from the pose. Called for you after every move.

#### `Body2D.applyForce`

```js
applyForce(fx, fy)
```

Push with a force (newtons) through the centre; it lasts for the next step only.

#### `Body2D.applyForceAt`

```js
applyForceAt(fx, fy, px, py)
```

Push with a force at a world point (it also turns the body).

#### `Body2D.applyImpulse`

```js
applyImpulse(ix, iy)
```

Change the speed at once by an impulse (newton-seconds), through the centre.

#### `Body2D.applyImpulseAt`

```js
applyImpulseAt(ix, iy, px, py)
```

An impulse at a world point.

#### `Body2D.setVelocity`

```js
setVelocity(vx, vy, w = this.w)
```

Set the velocity (a kinematic platform moves this way).

#### `Body2D.wake`

```js
wake()
```

Wake a sleeping body.

#### `Body2D.localToWorld`

```js
localToWorld(lx, ly)
```

World position of a point given relative to the body (turned with it).

#### `Body2D.worldToLocal`

```js
worldToLocal(px, py)
```

The point of the body at a world position, relative to the body's own axes.

#### `Body2D.velocityAt`

```js
velocityAt(px, py)
```

Velocity of the body at a world point.

<sub>src/rigid2d/body.js:12</sub>

### `class CharacterController`

```js
class CharacterController
```

A first- or third-person character body: walks on slopes, climbs steps, falls, jumps, stands still without jitter and
slides down surfaces that are too steep. Collision is an ellipsoid swept through a `TriWorld`, so nothing tunnels at any
speed. One `update` is one tick: the same function runs on the server (authoritative) and in the client (prediction),
and uses only + - * / and sqrt, so both get the same bits on every engine.

Coordinates: +y up. `x, y, z` is the centre of the body; the feet are at `y - halfHeight`.

#### `CharacterController.constructor`

```js
constructor({ x = 0, y = 0, z = 0, radius = 0.4, halfHeight = 0.9, stepHeight = 0.45, minGroundNormalY = 0.7, gravity = 25, jumpSpeed = 8, maxFallSpeed = 60, snapDistance } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.x` (optional) | `number` |  |
| `o.y` (optional) | `number` |  |
| `o.z` (optional) | `number` | Starting centre. |
| `o.radius` (optional) | `number` | Horizontal radius. |
| `o.halfHeight` (optional) | `number` | Half the body's height. |
| `o.stepHeight` (optional) | `number` | Highest ledge it walks up without jumping. |
| `o.minGroundNormalY` (optional) | `number` | A surface counts as ground (walkable) when its normal's y is at least this: 0.7 is about 45 degrees, 0.5 is 60. |
| `o.gravity` (optional) | `number` | Units per second squared. |
| `o.jumpSpeed` (optional) | `number` | Initial upward speed of a jump. |
| `o.maxFallSpeed` (optional) | `number` |  |
| `o.snapDistance` (optional) | `number` | How far it follows the ground down (slopes, small drops) instead of leaving it. |

#### `CharacterController.feetY`

```js
get feetY
```

The y of the soles of the feet.

#### `CharacterController.update`

```js
update(world, wishX, wishZ, jump, dt)
```

Advance one tick.

| Name | Type | Description |
|---|---|---|
| `world` | `import('./tri-world.js').TriWorld` |  |
| `wishX` | `number` | Desired horizontal velocity (units per second), x |
| `wishZ` | `number` | Desired horizontal velocity, z |
| `jump` | `boolean` | Jump button held (it jumps only from the ground) |
| `dt` | `number` | Seconds per tick |

<sub>src/character3d.js:14</sub>

### `class ConeJoint`

```js
class ConeJoint extends PointJoint
```

A ball-and-socket whose swing is limited: the two bodies share a point, and the angle between `axis` (a direction fixed in each body, taken from the world direction you pass at
creation) as seen on body a and on body b may not exceed `maxSwing` radians. A shoulder that cannot reach behind the back, a neck, a hip. Twist about the axis is free.
Angles and impulses are those of body b relative to body a.

#### `ConeJoint.constructor`

```js
constructor(a, b, anchor, axis, maxSwing)
```

| Name | Type | Description |
|---|---|---|
| `anchor` | `number[]` | world position |
| `axis` | `number[]` | world direction of the cone's centre line |
| `maxSwing` | `number` | radians, 0 to just under pi |

#### `ConeJoint.saveState`

```js
saveState()
```

#### `ConeJoint.loadState`

```js
loadState(s)
```

#### `ConeJoint.prepare`

```js
prepare(h, beta)
```

#### `ConeJoint.warmStart`

```js
warmStart()
```

#### `ConeJoint.solve`

```js
solve()
```

<sub>src/rigid/joints.js:331</sub>

### `class DistanceJoint`

```js
class DistanceJoint extends Joint
```

A distance joint between two points: a rod (fixed `length`), a rope (`min`/`max` range) or a spring (`frequency` in Hz and
`damping` ratio, soft so it stretches).

#### `DistanceJoint.constructor`

```js
constructor(a, b, anchorA, anchorB, { length, min = null, max = null, frequency = 0, damping = 0.5 } = {})
```

| Name | Type | Description |
|---|---|---|
| `anchorA` | `number[]` | world position on a |
| `anchorB` | `number[]` | world position on b |

#### `DistanceJoint.saveState`

```js
saveState()
```

#### `DistanceJoint.loadState`

```js
loadState(s)
```

#### `DistanceJoint.prepare`

```js
prepare(h, beta)
```

#### `DistanceJoint.warmStart`

```js
warmStart()
```

#### `DistanceJoint.solve`

```js
solve()
```

<sub>src/rigid/joints.js:262</sub>

### `class DistanceJoint2D`

```js
class DistanceJoint2D extends Joint2D
```

A rod or spring between a point on each body, keeping them `length` apart. With `frequency` above 0 it is a spring (Hz) with `damping` (0 loose to 1 no bounce).

#### `DistanceJoint2D.constructor`

```js
constructor(a, b, ax, ay, bx, by, { length, frequency = 0, damping = 0.5, collideConnected = false } = {})
```

| Name | Type | Description |
|---|---|---|
| `ax` | `number` |  |
| `ay` | `number` | World point on body a, now. |
| `bx` | `number` |  |
| `by` | `number` | World point on body b, now. |
| `o` (optional) | `object` | `length` (default: the distance now), `frequency` (Hz, 0 = rigid), `damping`, `collideConnected`. |

#### `DistanceJoint2D.prestep`

```js
prestep(h, beta)
```

#### `DistanceJoint2D.warmStart`

```js
warmStart()
```

#### `DistanceJoint2D.solve`

```js
solve()
```

<sub>src/rigid2d/joints.js:117</sub>

### `class FixedJoint`

```js
class FixedJoint extends PointJoint
```

A weld: the bodies keep their relative position and orientation (a bolted-on part that can break off).

#### `FixedJoint.constructor`

```js
constructor(a, b, anchor)
```

#### `FixedJoint.saveState`

```js
saveState()
```

#### `FixedJoint.loadState`

```js
loadState(s)
```

#### `FixedJoint.prepare`

```js
prepare(h, beta)
```

#### `FixedJoint.warmStart`

```js
warmStart()
```

#### `FixedJoint.solve`

```js
solve()
```

<sub>src/rigid/joints.js:210</sub>

### `class HingeJoint`

```js
class HingeJoint extends PointJoint
```

A hinge: the bodies share a point and can only rotate about one axis (a door, a wheel, a knee).
Optional `limits: [min, max]` in radians about the axis, and a `motor` { speed (rad/s), maxTorque (N m) }.

#### `HingeJoint.constructor`

```js
constructor(a, b, anchor, axis, { limits = null, motor = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `anchor` | `number[]` | world position |
| `axis` | `number[]` | world direction of the hinge axis |

#### `HingeJoint.saveState`

```js
saveState()
```

#### `HingeJoint.loadState`

```js
loadState(s)
```

#### `HingeJoint.hingeAngle`

```js
get hingeAngle
```

The current hinge angle in radians (0 at creation, continuing past a half turn).

#### `HingeJoint.prepare`

```js
prepare(h, beta)
```

#### `HingeJoint.warmStart`

```js
warmStart()
```

#### `HingeJoint.solve`

```js
solve()
```

<sub>src/rigid/joints.js:125</sub>

### `class Joint`

```js
class Joint
```

Base of all joints: two bodies (`null` means the world), whether they still collide with each other, and an optional break
threshold. Angles, speeds and impulses are those of body b relative to body a.

#### `Joint.constructor`

```js
constructor(a, b)
```

#### `Joint.prepare`

```js
prepare()
```

#### `Joint.warmStart`

```js
warmStart()
```

#### `Joint.solve`

```js
solve()
```

#### `Joint.saveState`

```js
saveState()
```

The numbers that must be remembered to carry on exactly where it left off (impulses for warm starting, hinge angle).

#### `Joint.loadState`

```js
loadState()
```

<sub>src/rigid/joints.js:28</sub>

### `class Joint2D`

```js
class Joint2D
```

Base of the joints: the two bodies, whether they may collide with each other, and the steps the world calls.

#### `Joint2D.constructor`

```js
constructor(a, b, collideConnected = false)
```

| Name | Type | Description |
|---|---|---|
| `a` | `Body2D \| null` |  |
| `b` | `Body2D \| null` | `null` is the world. |
| `collideConnected` (optional) | `boolean` | Whether the two bodies still collide with each other (false). |

#### `Joint2D.prestep`

```js
prestep()
```

#### `Joint2D.warmStart`

```js
warmStart()
```

#### `Joint2D.solve`

```js
solve()
```

<sub>src/rigid2d/joints.js:10</sub>

### `class Manifold`

```js
class Manifold
```

The result of testing two shapes: a normal from body A towards body B and up to four contact points with their penetration
depth.

#### `Manifold.constructor`

```js
constructor()
```

#### `Manifold.clear`

```js
clear()
```

#### `Manifold.setNormal`

```js
setNormal(x, y, z)
```

#### `Manifold.add`

```js
add(x, y, z, depth)
```

<sub>src/rigid/contacts.js:10</sub>

### `class Manifold2D`

```js
class Manifold2D
```

Where two shapes touch: up to two points (`px`, `py`, `sep` negative when overlapping, `id`) and the normal (`nx`, `ny`) from the first shape toward the second.

#### `Manifold2D.constructor`

```js
constructor()
```

#### `Manifold2D.clear`

```js
clear()
```

#### `Manifold2D.add`

```js
add(px, py, sep, id)
```

<sub>src/rigid2d/collide.js:5</sub>

### `class PhysicsWorld`

```js
class PhysicsWorld
```

The rigid-body world: bodies, joints, the static triangle world and the fixed-step `step(dt)` that moves them, with sleeping,
triggers, ray casts and `getState` / `setState` for saves. Deterministic: only + - * / and sqrt, in a fixed order.

#### `PhysicsWorld.constructor`

```js
constructor({ gravity = [0, -9.81, 0], terrain = null, substeps = 2, iterations = 8, sleepTime = 0.5, beta = 0.2, slop = 0.005, gyroscopic = true } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.gravity` (optional) | `number[]` | m/s^2, default [0, -9.81, 0]. |
| `o.terrain` (optional) | `import('../tri-world.js').TriWorld \| null` | Static triangle geometry (built) that bodies collide with. |
| `o.substeps` (optional) | `number` | Smaller steps inside each `step` (default 2): stiffer stacks and faster bodies for a bit more cost. |
| `o.iterations` (optional) | `number` | Solver passes per substep (default 8). |
| `o.sleepTime` (optional) | `number` | Seconds of near-stillness before a group of bodies sleeps (0.5). |
| `o.beta` (optional) | `number` | How fast overlap is pushed out (0.2). |
| `o.slop` (optional) | `number` | Overlap tolerated without pushing, in metres (0.005). |
| `o.gyroscopic` (optional) | `boolean` | Model the way a spinning uneven body wobbles (default true). |

#### `PhysicsWorld.add`

```js
add(...bodies)
```

Add a body (or several); returns the first.

#### `PhysicsWorld.remove`

```js
remove(body)
```

Take a body out of the world (and the joints that use it).

#### `PhysicsWorld.addJoint`

```js
addJoint(joint)
```

Add a joint (see joints.js). Both its bodies must already be in the world.

#### `PhysicsWorld.removeJoint`

```js
removeJoint(joint)
```

#### `PhysicsWorld.ignoreCollision`

```js
ignoreCollision(a, b)
```

Make two bodies pass through each other (the limbs of one ragdoll, a trailer and its truck). Undone by `allowCollision`.

#### `PhysicsWorld.allowCollision`

```js
allowCollision(a, b)
```

#### `PhysicsWorld.moveKinematic`

```js
moveKinematic(body, x, y, z, dt)
```

Move a kinematic body toward a pose over `dt`, so bodies riding it are carried along (its velocity is set to cover the distance).
Call before `step(dt)`.

#### `PhysicsWorld.step`

```js
step(dt)
```

Advance the simulation by `dt` seconds (call it with a fixed dt, like 1/60).

#### `PhysicsWorld.raycast`

```js
raycast(ox, oy, oz, dx, dy, dz, maxDistance, hit = { t: 0, body: null, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 }, filter = null)
```

The nearest thing a ray hits: a body or the static world (`hit.body` is null for the world). The direction is normalised for you.

| Name | Type | Description |
|---|---|---|
| `maxDistance` | `number` |  |
| `hit` (optional) | `{t: number, body: RigidBody \| null, nx: number, ny: number, nz: number, x: number, y: number, z: number}` | Written when true is returned. |
| `filter` (optional) | `(body: RigidBody) => boolean` | Return false to skip a body. |

**Returns** `boolean`

#### `PhysicsWorld.queryAabb`

```js
queryAabb(minX, minY, minZ, maxX, maxY, maxZ)
```

Bodies whose bounding boxes overlap this box.

#### `PhysicsWorld.overlapSphere`

```js
overlapSphere(x, y, z, radius)
```

Bodies that actually overlap a sphere.

#### `PhysicsWorld.getState`

```js
getState()
```

Everything needed to carry on exactly where the world is now, as plain data (a save file, a network resync): every body's pose,
velocity and sleep state, the contact impulses used for warm starting, and the joints' impulses. Restoring it and stepping gives
the same bits as never having stopped. Rebuild the same scene first; bodies and joints are matched by their `key` (a string you set,
stable between sessions) or, without one, by id (bodies) and order (joints). Across sessions, give bodies and joints keys.

#### `PhysicsWorld.setState`

```js
setState(state)
```

Put the world back to a state from `getState` (matched by key, else by id; bodies that are not in the world are ignored).

<sub>src/rigid/world.js:21</sub>

### `class PoseInterpolator`

```js
class PoseInterpolator
```

Blends each body between where it was before the last physics step and where it is now, so drawing at any frame rate looks smooth.
Works with `World2D` (bodies with `x, y, c, s`) and `PhysicsWorld` (bodies with `x, y, z` and a quaternion); rotations are blended the short way round.

```js
const view = new PoseInterpolator(world);
// in the fixed update:   view.snapshot(); world.step(dt);
// in the render, with the loop's alpha:   const p = view.pose(body, alpha, pose);   draw at p.x, p.y, p.angle
```

#### `PoseInterpolator.constructor`

```js
constructor(world)
```

| Name | Type | Description |
|---|---|---|
| `world` | `{ bodies: any[] }` | A `World2D` or `PhysicsWorld`. |

#### `PoseInterpolator.snapshot`

```js
snapshot()
```

Remember every body's pose. Call it once right before each `world.step`. Bodies that have left the world are forgotten.

#### `PoseInterpolator.reset`

```js
reset(body)
```

Forget where a body was, so it is drawn where it is now (after moving it with `setPosition`, say, when no step has run yet).

#### `PoseInterpolator.pose`

```js
pose(body, alpha, out = {})
```

The pose to draw a body at, `alpha` (0..1) of the way from its pose before the last step to its pose now. A body with no snapshot yet (just added) is
drawn where it is. 2D fills `x, y, c, s, angle`; 3D fills `x, y, z, qx, qy, qz, qw`.

| Name | Type | Description |
|---|---|---|
| `body` | `any` |  |
| `alpha` | `number` |  |
| `out` (optional) | `object` | Reused if given, so drawing allocates nothing. |

<sub>src/interpolate.js:15</sub>

### `class Ragdoll`

```js
class Ragdoll
```

A character made of rigid bodies. Build it from a description (`humanoidRagdollSpec()` or your own bones), `addTo(world)`, and step the world: it falls, collapses and comes to rest.
To go from an animation into a ragdoll, copy the animated pose onto the bodies with `setBone` (see `poseToRagdoll` in `@engine/render`), give it the character's velocity
(`setLinearVelocity`), and let go; to draw it, copy the bodies back onto a skeleton's pose (`poseFromRagdoll`).

#### `Ragdoll.constructor`

```js
constructor(spec, { x = 0, y = 0, z = 0, yaw = 0, friction = 0.8, linearDamping = 0.08, angularDamping = 0.4, selfCollision = false, group = 1, mask = 0xffff, userData = null } = {})
```

| Name | Type | Description |
|---|---|---|
| `spec` | `{bones: RagdollBone[]}` |  |
| `o` (optional) | `object` |  |
| `o.x` (optional) | `number` |  |
| `o.y` (optional) | `number` |  |
| `o.z` (optional) | `number` | Where the model-space origin (the feet) is placed in the world. |
| `o.yaw` (optional) | `number` | Turned this much (radians) about the vertical axis. |
| `o.friction` (optional) | `number` | 0.8. |
| `o.linearDamping` (optional) | `number` | 0.08. |
| `o.angularDamping` (optional) | `number` | 0.4: a ragdoll needs some, or its limbs flail. |
| `o.selfCollision` (optional) | `boolean` | Whether its own limbs collide with each other (false: they pass through, which is stable and rarely noticed). |
| `o.group` (optional) | `number` |  |
| `o.mask` (optional) | `number` | Collision filtering of every body, as for a `RigidBody`. |
| `o.userData` (optional) | `any` | Put on every body (an entity id). |

#### `Ragdoll.toWorld`

```js
toWorld(p)
```

A model-space point in the world.

#### `Ragdoll.toModel`

```js
toModel(p)
```

A world point in model space.

#### `Ragdoll.body`

```js
body(name)
```

The body of a bone by name, or undefined.

#### `Ragdoll.addTo`

```js
addTo(world)
```

Put the bodies and joints into a physics world. Unless `selfCollision`, the bodies are told to ignore each other.

#### `Ragdoll.removeFrom`

```js
removeFrom(world)
```

Take it out again.

#### `Ragdoll.modelPosition`

```js
modelPosition(i, out = [0, 0, 0])
```

Where the bone's body is, in model space (the centre of the capsule).

| Name | Type | Description |
|---|---|---|
| `i` | `number` |  |

#### `Ragdoll.modelRotationDelta`

```js
modelRotationDelta(i, out = [0, 0, 0, 1])
```

How much the bone's body has turned from its rest orientation, as a model-space quaternion [x, y, z, w] (the change to apply to the rest pose).

#### `Ragdoll.modelJointPosition`

```js
modelJointPosition(i, out = [0, 0, 0])
```

Where bone i's joint (its `from` point) is now in model space, taken from its body.

#### `Ragdoll.setBone`

```js
setBone(i, delta, fromPosition)
```

Put a bone's body where an animated pose has it: `delta` is how much the bone has turned from rest (model-space quaternion), `fromPosition` where its joint is (model space).
Does not touch velocities.

#### `Ragdoll.setLinearVelocity`

```js
setLinearVelocity(vx, vy, vz)
```

Give every body this velocity (the speed the character was moving at).

#### `Ragdoll.clearSpin`

```js
clearSpin()
```

Zero the spin of every body (after `setBone`).

#### `Ragdoll.applyImpulse`

```js
applyImpulse(bone, ix, iy, iz, px, py, pz)
```

A shove: an impulse (newton-seconds) on a bone (a name or an index), at a world point if given (a bullet hit, an explosion).

#### `Ragdoll.mass`

```js
get mass
```

Total mass in kg.

#### `Ragdoll.centerOfMass`

```js
centerOfMass(out = [0, 0, 0])
```

The centre of mass in the world.

#### `Ragdoll.resting`

```js
get resting
```

Whether every body is asleep.

<sub>src/rigid/ragdoll.js:74</sub>

### `class RaycastVehicle`

```js
class RaycastVehicle
```

A car, bike, cart, hovercraft or anything else that rolls on springs. The chassis is an ordinary dynamic `RigidBody` in the world; each wheel casts a ray down from its fixing, pushes the
chassis up with a spring and damper where it hits, and grips the ground sideways and along (engine, brakes, rolling resistance) up to what its load allows (a friction circle: a wheel that is
braking hard has less grip to turn with). Call `update(dt)` once per tick, **before** `world.step(dt)`.

Chassis axes: `forward` (default +z) and `up` (default +y) in its own coordinates; positive `steering` turns toward the right, the side your right hand is on looking along `forward` with `up` overhead (with forward +z that is -x).

#### `RaycastVehicle.constructor`

```js
constructor(world, chassis, { wheels, forward = [0, 0, 1], up = [0, 1, 0], rollingResistance = 0.015, maxSuspensionForce, antiRoll = [] })
```

| Name | Type | Description |
|---|---|---|
| `world` | `import('./world.js').PhysicsWorld` |  |
| `chassis` | `import('./body.js').RigidBody` |  |
| `o` | `object` |  |
| `o.wheels` | `WheelSpec[]` |  |
| `o.forward` (optional) | `number[]` |  |
| `o.up` (optional) | `number[]` |  |
| `o.rollingResistance` (optional) | `number` | Fraction of its load a rolling wheel loses to friction (0.015). |
| `o.maxSuspensionForce` (optional) | `number` | Cap on any one spring's force in newtons (default: eight times the car's weight divided by the number of wheels). |
| `o.antiRoll` (optional) | `number[][]` | `[wheelA, wheelB, stiffness]`: an anti-roll bar between two wheels (N/m of the difference in their compression), to keep the car level in corners. |

#### `RaycastVehicle.update`

```js
update(dt)
```

Apply the suspension, tyre and engine forces for this tick to the chassis. Call before `world.step(dt)`.

#### `RaycastVehicle.wheelMatrix`

```js
wheelMatrix(i, out = new Float32Array(16))
```

The matrix to draw wheel `i` with (column-major 4x4, in the world): the wheel's centre, its axle along the local x axis, so a cylinder lying along x spins about it; it includes steering,
the spin so far and how far the spring has compressed.

| Name | Type | Description |
|---|---|---|
| `i` | `number` |  |
| `out` (optional) | `Float32Array \| number[]` |  |

#### `RaycastVehicle.speed`

```js
get speed
```

The car's speed along its forward direction in m/s (negative when reversing).

#### `RaycastVehicle.wheelsOnGround`

```js
get wheelsOnGround
```

How many wheels are touching the ground.

<sub>src/rigid/vehicle.js:26</sub>

### `class RevoluteJoint2D`

```js
class RevoluteJoint2D extends Joint2D
```

A pin: the point (`x`, `y`, in the world when you make it) stays in the same place on both bodies, which can turn about it, like a hinge, a wheel's axle or a
pendulum's pivot. Optionally a motor turns it.

#### `RevoluteJoint2D.constructor`

```js
constructor(a, b, x, y, { motorSpeed = 0, maxMotorTorque = 0, collideConnected = false } = {})
```

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` | The pivot, as a world position now. |
| `o` (optional) | `object` | `motorSpeed` (rad/s) and `maxMotorTorque` (N m) turn it; `collideConnected`. |

#### `RevoluteJoint2D.prestep`

```js
prestep(h, beta)
```

#### `RevoluteJoint2D.warmStart`

```js
warmStart()
```

#### `RevoluteJoint2D.solve`

```js
solve(h)
```

<sub>src/rigid2d/joints.js:43</sub>

### `class RigidBody`

```js
class RigidBody
```

A simulated object: a sphere, box or capsule with mass, friction, restitution, damping, and a type (`dynamic`, `kinematic` or
`static`); also sensors (triggers), bullets (continuous collision) and a `userData` slot for your own data.

#### `RigidBody.constructor`

```js
constructor({ shape, type = 'dynamic', mass, x = 0, y = 0, z = 0, rotation = [0, 0, 0, 1], friction = 0.5, restitution = 0, linearDamping = 0.01, angularDamping = 0.02, gravityScale = 1, sensor = false, bullet = false, canSleep = true, group = 1, mask = 0xffff, userData = null })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.shape` | `Shape` |  |
| `o.type` (optional) | `'dynamic' \| 'kinematic' \| 'static'` | Dynamic bodies are simulated; kinematic ones move only as you tell them (platforms) and push others; static ones never move. |
| `o.mass` (optional) | `number` | kg (default: density 1000 x volume, like water). Ignored for kinematic and static bodies. |
| `o.x` (optional) | `number` |  |
| `o.y` (optional) | `number` |  |
| `o.z` (optional) | `number` | Centre position. |
| `o.rotation` (optional) | `number[]` | Orientation as a quaternion [x, y, z, w] (default: none). |
| `o.friction` (optional) | `number` | Coulomb friction coefficient (0.5). Two bodies use the geometric mean of theirs. |
| `o.restitution` (optional) | `number` | Bounciness 0..1 (0). Two bodies use the larger. |
| `o.linearDamping` (optional) | `number` | Speed lost per second as a fraction (0.01). |
| `o.angularDamping` (optional) | `number` | (0.02) |
| `o.gravityScale` (optional) | `number` | 1 normal, 0 floating. |
| `o.sensor` (optional) | `boolean` | A trigger: reports who is inside it but never pushes anything. |
| `o.canSleep` (optional) | `boolean` | false keeps it awake even when still (default true). |
| `o.bullet` (optional) | `boolean` | Treat as very fast: its path is checked against the static world so it cannot skip through thin walls. |
| `o.group` (optional) | `number` | Collision category bits (1) and `mask`: which categories it collides with (all). |
| `o.mask` (optional) | `number` |  |
| `o.userData` (optional) | `any` | Anything you want to find again (an entity id, a mesh). |

#### `RigidBody.dynamic`

```js
get dynamic
```

#### `RigidBody.setMass`

```js
setMass(m)
```

Set the mass (kg); 0 makes the body immovable. Inertia follows from the shape.

#### `RigidBody.refresh`

```js
refresh()
```

Recompute the rotation matrix, world inertia and bounding box after the pose changed.

#### `RigidBody.setPosition`

```js
setPosition(x, y, z)
```

Put the body somewhere (and wake it). Velocity is kept.

#### `RigidBody.setRotation`

```js
setRotation(qx, qy, qz, qw)
```

Orientation as a quaternion [x, y, z, w] (normalised for you).

#### `RigidBody.setVelocity`

```js
setVelocity(vx, vy, vz)
```

#### `RigidBody.setAngularVelocity`

```js
setAngularVelocity(wx, wy, wz)
```

#### `RigidBody.applyForce`

```js
applyForce(fx, fy, fz, px, py, pz)
```

Add a force (newtons) for the next step, at the centre or at a world point (which also turns the body).

#### `RigidBody.applyTorque`

```js
applyTorque(tx, ty, tz)
```

#### `RigidBody.applyImpulse`

```js
applyImpulse(ix, iy, iz, px, py, pz)
```

Change velocity at once by an impulse (newton-seconds), at the centre or at a world point.

#### `RigidBody.wake`

```js
wake()
```

Wake the body, and with it everything that went to sleep touching it.

#### `RigidBody.toWorld`

```js
toWorld(lx, ly, lz, out = [0, 0, 0])
```

World position of a point given in the body's own coordinates.

| Name | Type | Description |
|---|---|---|
| `out` | `number[]` |  |

#### `RigidBody.toLocal`

```js
toLocal(wx, wy, wz, out = [0, 0, 0])
```

A world point in the body's own coordinates.

#### `RigidBody.velocityAt`

```js
velocityAt(px, py, pz, out = [0, 0, 0])
```

Velocity of the material point of the body at a world position.

#### `RigidBody.kineticEnergy`

```js
get kineticEnergy
```

Kinetic energy in joules.

<sub>src/rigid/body.js:60</sub>

### `class SpatialHash`

```js
class SpatialHash
```

Uniform-grid broad phase over typed arrays. Rebuilt every tick (counting
sort, no per-tick allocation): `clear()`, `insert()` each box, `build()`.
Boxes are centre + half extents. Items are identified by a caller-chosen
integer `index < capacity` (use the entity slot index).

World bounds must contain all motion: items outside collapse into edge
cells, and sweeps stop at the grid edge.

#### `SpatialHash.constructor`

```js
constructor({ width, height, cellSize, capacity, originX = 0, originY = 0 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.width` | `number` | World width |
| `o.height` | `number` | World height |
| `o.cellSize` | `number` | Pick ~2x the typical box size. |
| `o.capacity` | `number` | Max item index + 1. |
| `o.originX` (optional) | `number` |  |
| `o.originY` (optional) | `number` |  |

#### `SpatialHash.clear`

```js
clear()
```

#### `SpatialHash.insert`

```js
insert(index, cx, cy, hw, hh, group = 1)
```

| Name | Type | Description |
|---|---|---|
| `index` | `number` |  |
| `cx` | `number` | Centre x |
| `cy` | `number` |  |
| `hw` | `number` | Half width |
| `hh` | `number` |  |
| `group` (optional) | `number` | Bit mask this item belongs to (default 1). |

#### `SpatialHash.build`

```js
build()
```

Index all inserted boxes. Call after the last `insert`.

#### `SpatialHash.queryRect`

```js
queryRect(minX, minY, maxX, maxY, out, mask = 0xffffffff)
```

Items whose box overlaps the rectangle, deduplicated.

| Name | Type | Description |
|---|---|---|
| `minX` | `number` |  |
| `minY` | `number` |  |
| `maxX` | `number` |  |
| `maxY` | `number` |  |
| `out` | `Int32Array` |  |
| `mask` (optional) | `number` | Only items whose group & mask is non-zero. |

**Returns** `number` — Count written (capped at out.length).

#### `SpatialHash.sweep`

```js
sweep(cx, cy, hw, hh, dx, dy, mask, ignore, hit)
```

Sweep a moving box through the grid (Amanatides-Woo cell walk along its
centre path, checking a ring of neighbour cells to cover its extents) and
find the earliest contact. Zero extents give a ray (hitscan).

| Name | Type | Description |
|---|---|---|
| `cx` | `number` | Mover centre |
| `cy` | `number` |  |
| `hw` | `number` | Mover half extents |
| `hh` | `number` |  |
| `dx` | `number` | Motion over the whole step |
| `dy` | `number` |  |
| `mask` | `number` | Collide only with items whose group & mask is non-zero. |
| `ignore` | `number` | Item index to skip (the mover itself), or -1. |
| `hit` | `import('./sweep.js').Hit` | Written when true is returned. |

**Returns** `boolean`

<sub>src/spatial-hash.js:12</sub>

### `class TriWorld`

```js
class TriWorld
```

Static 3D collision geometry: a triangle soup indexed by a uniform 3D grid (typed arrays, built once). Everything the
3D character controller, hitscan and line-of-sight need: `queryAabb` (candidates for a moving shape) and `raycast`.
Boxes, quads and arbitrary indexed meshes (a glTF's positions and indices) all become triangles.

Conventions: right-handed, +y up (see @engine/math). Triangles are two-sided, so winding only matters for `normal*`
(outward by the right-hand rule: (b - a) x (c - a)).

Usage: add geometry, call `build()` once, then query. Adding after `build()` requires another `build()`.

#### `TriWorld.constructor`

```js
constructor({ cellSize = 4, maxCells = 1 << 20 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.cellSize` (optional) | `number` | Grid cell edge; about the size of a character is a good start. |
| `o.maxCells` (optional) | `number` | Upper bound on grid cells; the cell size grows to respect it (huge flat worlds). |

#### `TriWorld.triangleCount`

```js
get triangleCount
```

#### `TriWorld.addTriangle`

```js
addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz)
```

Add one triangle; returns its index.

#### `TriWorld.addQuad`

```js
addQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz)
```

A quad a, b, c, d (in order around its edge) as two triangles.

#### `TriWorld.addBox`

```js
addBox(cx, cy, cz, hx, hy, hz)
```

An axis-aligned box (centre and half extents) as 12 triangles with outward normals.

#### `TriWorld.addTriangles`

```js
addTriangles(triangles)
```

Add triangles given as nine numbers each (three corners): what `Heightmap.toTriangles()` in `@engine/render` gives for terrain, or any triangle list you have built.

| Name | Type | Description |
|---|---|---|
| `triangles` | `ArrayLike<number>` |  |

#### `TriWorld.addMesh`

```js
addMesh(positions, indices)
```

An indexed triangle mesh.

| Name | Type | Description |
|---|---|---|
| `positions` | `ArrayLike<number>` | x, y, z per vertex |
| `indices` | `ArrayLike<number>` | three vertex indices per triangle |

#### `TriWorld.build`

```js
build()
```

Compute normals and the grid. Call once after adding geometry.

#### `TriWorld.queryAabb`

```js
queryAabb(minX, minY, minZ, maxX, maxY, maxZ, out)
```

Triangles whose cells overlap the box (a superset of those touching it: callers run their own narrow phase).

| Name | Type | Description |
|---|---|---|
| `out` | `Int32Array` |  |

**Returns** `number` — Count written (capped at out.length).

#### `TriWorld.raycast`

```js
raycast(ox, oy, oz, dx, dy, dz, maxT, hit)
```

Nearest triangle hit by a ray (a 3D cell walk, so cost follows the length of the ray, not the size of the world).
The direction need not be unit length: `t` is in multiples of it.

| Name | Type | Description |
|---|---|---|
| `maxT` | `number` | Furthest hit considered, in multiples of the direction. |
| `hit` | `{t: number, index: number, nx: number, ny: number, nz: number}` | Written when true is returned (the normal faces the ray). |

**Returns** `boolean`

<sub>src/tri-world.js:13</sub>

### `class WeldJoint2D`

```js
class WeldJoint2D extends Joint2D
```

Glue: the two bodies keep the relative position and angle they had when the joint was made (a rigid link; it can flex a little under heavy load).

#### `WeldJoint2D.constructor`

```js
constructor(a, b, x, y, { collideConnected = false } = {})
```

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` | The point the link is made at, as a world position now. |

#### `WeldJoint2D.prestep`

```js
prestep(h, beta)
```

#### `WeldJoint2D.warmStart`

```js
warmStart()
```

#### `WeldJoint2D.solve`

```js
solve()
```

<sub>src/rigid2d/joints.js:80</sub>

### `class World2D`

```js
class World2D
```

The 2D rigid-body world. Gravity is in metres per second squared with +y down (the 2D renderer's direction), so the default is `[0, 9.81]`.

#### `World2D.constructor`

```js
constructor({ gravity = [0, 9.81], substeps = 2, iterations = 8, sleepTime = 0.5, beta = 0.2, slop = 0.005 } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.gravity` (optional) | `number[]` |  |
| `o.substeps` (optional) | `number` | Smaller steps inside each `step` (default 2): stiffer stacks and faster bodies for a little more cost. |
| `o.iterations` (optional) | `number` | Solver passes per substep (default 8). |
| `o.sleepTime` (optional) | `number` | Seconds of stillness before a group of bodies sleeps (0.5). |
| `o.beta` (optional) | `number` | How fast overlap is pushed out (0.2). |
| `o.slop` (optional) | `number` | Overlap that is tolerated, in metres (0.005). |

#### `World2D.add`

```js
add(...bodies)
```

Add bodies; returns the first.

#### `World2D.remove`

```js
remove(body)
```

Take a body out (and the joints that use it).

#### `World2D.addJoint`

```js
addJoint(joint)
```

#### `World2D.removeJoint`

```js
removeJoint(joint)
```

#### `World2D.step`

```js
step(dt)
```

Advance by `dt` seconds (call it with a fixed dt, like 1/60).

#### `World2D.queryAabb`

```js
queryAabb(minX, minY, maxX, maxY, filter = null)
```

Every body whose bounding box overlaps a rectangle.

#### `World2D.queryPoint`

```js
queryPoint(x, y, filter = null)
```

Every body that contains a point.

#### `World2D.raycast`

```js
raycast(ox, oy, dx, dy, maxDistance = Infinity, filter = null)
```

The first body a ray hits.

| Name | Type | Description |
|---|---|---|
| `ox` | `number` |  |
| `oy` | `number` | Start. |
| `dx` | `number` |  |
| `dy` | `number` | Direction (any length). |
| `maxDistance` (optional) | `number` |  |
| `filter` (optional) | `(body: import('./body.js').Body2D) => boolean` | Return false to ignore a body. |

**Returns** `{body: import('./body.js').Body2D, distance: number, x: number, y: number, nx: number, ny: number} \| null`

#### `World2D.getState`

```js
getState()
```

The whole moving state as plain data (for saves, rollback and tests). Joints and shapes are not in it: make them the same way again.

#### `World2D.setState`

```js
setState(s)
```

Put the state back (the same bodies and joints must be in the world, matched by body number).

<sub>src/rigid2d/world.js:26</sub>

## Constants

### `CONTACT_EDGE`

```js
const CONTACT_EDGE
```

Contact kinds reported by `sweepSphereVsTriangle`.

<sub>src/sweep3d.js:7</sub>

### `CONTACT_FACE`

```js
const CONTACT_FACE
```

Contact kinds reported by `sweepSphereVsTriangle`.

Value: `0, CONTACT_EDGE = 1, CONTACT_VERTEX = 2`

<sub>src/sweep3d.js:7</sub>

### `CONTACT_VERTEX`

```js
const CONTACT_VERTEX
```

Contact kinds reported by `sweepSphereVsTriangle`.

<sub>src/sweep3d.js:7</sub>

### `MAX_POLYGON_VERTICES`

```js
const MAX_POLYGON_VERTICES
```

The most points a polygon shape can have.

Value: `16`

<sub>src/rigid2d/shapes.js:5</sub>

### `SKIN`

```js
const SKIN
```

Gap left between a mover and the surface it hit, so it never rests exactly in contact.

Value: `1e-4`

<sub>src/sweep.js:2</sub>

### `STATIC_BODY`

```js
const STATIC_BODY
```

The immovable stand-in for the static world (triangle meshes) in contacts.

Value: `new RigidBody({ shape: sphere(1), type: 'static' })`

<sub>src/rigid/body.js:207</sub>

### `VERY_CLOSE`

```js
const VERY_CLOSE
```

Gap kept between a mover and the surface it hit, as a fraction of its radius (in ellipsoid space).

Value: `5e-3`

<sub>src/slide3d.js:4</sub>

## Types

### `Circle`

Type: `{type: 'circle', radius: number, area: number, inertia: number}`

### `Hit`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `t` | `number` | Fraction (0..1) of the motion travelled before contact. |
| `nx` | `number` | Surface normal x (axis-aligned: -1, 0 or 1). |
| `ny` | `number` | Surface normal y. |
| `index` | `number` | Item hit (set by SpatialHash.sweep). |

### `MoveResult`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Final centre x |
| `y` | `number` |  |
| `hit` | `boolean` | True if anything blocked the motion. |
| `nx` | `number` | Normal of the last surface hit. |
| `ny` | `number` |  |
| `index` | `number` | Index of the last item hit, or -1. |

### `Polygon`

Type: `{type: 'polygon', count: number, xs: number[], ys: number[], nxs: number[], nys: number[], area: number, inertia: number, radius: number}`

### `RagdollBone`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` | What it is (a joint name of the skeleton it will drive, see `poseFromRagdoll`). |
| `parent` | `number` | Index of the bone it hangs from, or -1 for the root. |
| `from` | `number[]` | Where it starts (the joint with its parent) in model space. |
| `to` | `number[]` | Where it ends. |
| `radius` | `number` | Thickness of its capsule. |
| `mass` | `number` | kg. |
| `joint` (optional) | `{type: 'cone', swing: number} \| {type: 'hinge', axis: number[], limits: number[]} \| {type: 'ball'} \| {type: 'fixed'}` | How it is joined to its parent at `from`: a `cone` swings within `swing` radians of the way the bone points (a shoulder, a hip, a neck); a `hinge` bends about `axis` (model space) between `limits` radians (an elbow, a knee). |

### `Shape`

Type: `{type: 'sphere', radius: number} \| {type: 'box', hx: number, hy: number, hz: number} \| {type: 'capsule', radius: number, halfHeight: number}`

### `Slide3Result`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `x` | `number` | Final centre |
| `y` | `number` |  |
| `z` | `number` |  |
| `hit` | `boolean` | True if anything blocked the motion. |
| `count` | `number` | Number of contacts recorded (at most 5). |
| `normals` | `Float64Array` | World-space contact normals, 3 per contact (the direction the surface pushes the mover). |
| `tri` | `Int32Array` | Triangle index of each contact. |
| `kind` | `Uint8Array` | CONTACT_FACE, CONTACT_EDGE or CONTACT_VERTEX of each contact. |
| `faceNormals` | `Float64Array` | World-space normal of the triangle itself for each contact (facing the mover). |

### `SphereHit`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `t` | `number` | Fraction (0..1) of the motion travelled before contact. |
| `x` | `number` | Contact point on the triangle. |
| `y` | `number` |  |
| `z` | `number` |  |
| `kind` | `number` | CONTACT_FACE, CONTACT_EDGE or CONTACT_VERTEX. |

### `WheelSpec`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` | Where the suspension is fixed to the chassis, in the chassis's own coordinates (the top of the spring). |
| `radius` (optional) | `number` | 0.35. |
| `suspensionLength` (optional) | `number` | How far below the fixing the wheel's centre hangs with the spring fully extended (0.3 m). |
| `maxCompression` (optional) | `number` | How far the spring can compress before it bottoms out (80% of the length). |
| `stiffness` (optional) | `number` | Spring constant, N/m. Default: set so the car sags by a quarter of the suspension length at rest on all of its wheels, from the chassis mass. |
| `damping` (optional) | `number` | N s/m. Default: about 0.4 of critical damping for that spring. |
| `friction` (optional) | `number` | Tyre grip as a multiple of the load pressing it down (1.2: the tyre can push sideways with up to 1.2 times its load). |
| `steer` (optional) | `number` | How much of the steering angle this wheel takes (front wheels 1, rear 0; default 0). |
| `drive` (optional) | `number` | Share of the engine force this wheel gets (default 0; shares are normalised). |
| `brake` (optional) | `number` | Share of the brake force (default 1). |
| `handbrake` (optional) | `boolean` | Whether the hand brake locks this wheel (the rear wheels). |
