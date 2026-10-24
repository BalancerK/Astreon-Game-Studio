# @engine/physics

2D: broad-phase spatial hash and swept (continuous) box collision, built for fast movers. 3D: static triangle worlds, swept ellipsoid movement and a character controller (below). 3D rigid bodies: shapes, contacts, a solver, joints, sleeping. Everything is deterministic: only `+ - * /` and `sqrt`.

**May import:** `@engine/core`. **Never import:** server, client, render, transport.

## Public API
| Export | Purpose |
|---|---|
| `SpatialHash` | Uniform grid over typed arrays. Per tick: `clear()`, `insert(index, cx, cy, hw, hh, group)`, `build()`. Then `queryRect(...)` and `sweep(...)`. No per-tick allocation. |
| `sweepAabbVsAabb` | Time of impact + normal for a moving box against a static box. |
| `moveAndSlide` | Move, stop at the first obstacle, slide along it with the remaining motion (up to 4 contacts). Cannot tunnel at any speed. |
| `substepCount` | How many substeps a tick needs when movers interact with each other. |

## 3D
Right-handed, +y up (same as `@engine/math`).

| Export | Purpose |
|---|---|
| `TriWorld` | Static collision geometry: a triangle soup in a 3D uniform grid (typed arrays, built once). `addTriangle`, `addQuad`, `addBox`, `addMesh(positions, indices)` (a glTF's data), `addTriangles(nineNumbersEach)` (terrain: `level.addTriangles(heightmap.toTriangles())`), `build()`; then `queryAabb` and `raycast` (a 3D cell walk: cost follows the ray, not the world). Triangles are two-sided. |
| `moveEllipsoid` | Move an ellipsoid (a body) through the world and slide along what it hits. A continuous sweep, so nothing tunnels at any speed, even through a single zero-thickness triangle. Contacts, crease sliding, corner stopping; options for treating too-steep surfaces as walls and for ground probes. |
| `CharacterController` | A first/third-person body: walks on slopes (keeps its pace, never bounces going downhill), climbs steps, jumps, falls, stands perfectly still, slides down surfaces that are too steep, stops at ceilings. One `update(world, wishX, wishZ, jump, dt)` per tick, the same function on the server and in client prediction. |
| `sweepSphereVsTriangle`, `closestPointOnTriangle`, `rayTriangle`, `findGround`, `pushOutEllipsoid` | The building blocks. |

```js
const world = new TriWorld({ cellSize: 4 });
world.addBox(0, -1, 0, 100, 1, 100);              // the ground: top at y = 0
world.addMesh(gltf.positions, gltf.indices);      // anything else
world.build();

const player = new CharacterController({ x: 0, y: 5, z: 0, radius: 0.4, halfHeight: 0.9, stepHeight: 0.45 });
player.update(world, vx, vz, jumpPressed, 1 / 60);   // then read x, y (body centre), z, vy, grounded, groundNy, blocked
world.raycast(ox, oy, oz, dx, dy, dz, 100, hit);     // hitscan / line of sight: hit.t, hit.index, hit.nx..nz
```

How it works: the body is an **ellipsoid**; dividing every coordinate by its radii turns it into a unit sphere, which is swept against each triangle (face, then edges and vertices, Fauerby's method). Slides are clipped Quake-style against every plane touched so far, so a corner holds and a crease is followed. Ground is judged by the **triangle's own normal** of what the body touches (not the tilted contact direction at an edge), which makes stair edges and ledges behave. A step is accepted only if the surface it lands on is within one step height of where the feet started.

Verified (`test/physics3d.test.js`, `test/character3d.test.js`): the sweep against a fine-stepped reference; closest point against dense sampling; broad phase and ray casts against brute force; 30,000 random moves up to 10^7 units long inside a sealed room made of **zero-thickness quads** never escape; in cluttered scenes the end position never penetrates any triangle; the character stands bit-still for 10 s, walks at exactly the asked speed, jumps to the physical height, climbs 0.3 m steps (and descends them without leaving the ground), refuses a 0.6 m block and a 60 degree ramp, slides down steep slopes, and survives floods of random input at speeds up to 5,000 units/s. **Bit-identical results in Node, Chrome and Firefox** (4 hash suites: `node tools/determinism.js`).

Performance (`node packages/physics/bench/character3d.js 500 800`): 500 characters among 9,600 triangles cost **2.3 ms per tick** in total (4.7 microseconds per character); 200 characters 0.5 ms.

Limits of the character controller (by design, for now): it moves through the static world only (rigid bodies below are a separate system; no standing on a moving platform or character-vs-character pushing yet); no per-triangle groups or materials; one grid for the whole world (very tall sparse worlds waste cells); an ellipsoid hangs on a ledge edge up to about 90% of its radius, then falls.

## Rigid bodies (`PhysicsWorld`)

Dynamic physics for things that tumble, stack, roll, hang and get knocked about: crates, barrels, balls, ragdolls, doors, chains, wrecking balls, moving platforms. Zero dependencies, and deterministic like the rest of this package (only `+ - * /` and `sqrt`; a hinge's angle uses the engine's own `atan2`): **bit-identical in Node, Chrome and Firefox** (3 new hash suites in `node tools/determinism.js`).

```js
import { PhysicsWorld, RigidBody, box, sphere, capsule, BallJoint, HingeJoint, FixedJoint, DistanceJoint, TriWorld } from '@engine/physics';

const level = new TriWorld(); level.addBox(0, -1, 0, 50, 1, 50); level.addMesh(gltf.positions, gltf.indices); level.build();
const world = new PhysicsWorld({ terrain: level });                       // gravity, 2 substeps and 8 solver passes by default

const crate = world.add(new RigidBody({ shape: box(0.5, 0.5, 0.5), x: 0, y: 5, z: 0, mass: 20, friction: 0.6 }));
const ball = world.add(new RigidBody({ shape: sphere(0.3), x: 2, y: 8, z: 0, restitution: 0.7 }));
world.addJoint(new HingeJoint(null, door, [0, 1, 0], [0, 1, 0], { limits: [-1.5, 1.5] }));   // null is the world

world.step(1 / 60);                                                      // a fixed dt, like the rest of the engine
world.raycast(ox, oy, oz, dx, dy, dz, 100, hit);                         // hit.body (null: the level), hit.t, hit.nx.., hit.x..
crate.applyImpulse(0, 40, 0);                                            // (x, y, z, optionally at a world point px, py, pz)
```

| | |
|---|---|
| **Shapes** | `sphere(r)`, `box(hx, hy, hz)`, `capsule(radius, halfHeight)` (along the body's y axis). Mass defaults to 1000 kg/m^3 times volume; inertia follows from the shape. |
| **Body types** | `dynamic` (simulated), `kinematic` (you move it, it pushes and carries others: `world.moveKinematic(platform, x, y, z, dt)`), `static`. Options: `friction`, `restitution`, `linearDamping`, `angularDamping`, `gravityScale`, `canSleep`, `bullet`, `group` and `mask` (collision filtering), `sensor` (a trigger), `userData`. |
| **Collision** | Sphere / capsule / box against each other and against the triangles of a `TriWorld`. Boxes use the separating-axis test and face clipping, so a box on a surface gets up to four contacts spread over the touching area and does not rock or sink. |
| **Solver** | Sequential impulses with warm starting from the previous step (stacks settle and stay: a tower of 8 crates stands for 10 s and sleeps), Coulomb friction in a cone, restitution, soft position correction. Rolling resistance lets balls come to rest. |
| **Joints** | `BallJoint` (a shared point), `HingeJoint` (one axis, optional `limits` and `motor: { speed, maxTorque }`, `hingeAngle`), `FixedJoint` (a weld), `DistanceJoint` (a rod, a rope with `min` / `max`, or a spring with `frequency` and `damping`). `joint.breakImpulse` snaps one that is pushed too hard; joined bodies skip each other's collisions unless `collideConnected`. Angles and speeds are those of body `b` relative to `a`; a `null` body is the world. |
| **Sleeping** | Bodies that stay still for `sleepTime` (0.5 s) go to sleep **with everything touching them** and cost nothing; a hit, an impulse or a moving platform wakes the whole group. A 1,000-body pile costs about 5 ms per step while moving, and almost nothing once it rests. |
| **Fast bodies** | A body flagged `bullet` (or moving more than about three quarters of its size in one substep) has its path checked against the level, so it cannot tunnel through a zero-thickness wall at 1,500 m/s. (Bullets against other dynamic bodies are not swept.) |
| **Events** | `world.onContactBegin(a, b, impactSpeed)` (`b` is null for the level), `onContactEnd`, `onTrigger(sensor, body, entered)`. |
| **Queries** | `raycast` (bodies and level, with a filter), `overlapSphere`, `queryAabb`. |
| **Saving** | `world.getState()` is plain data (JSON-safe) including the contact impulses and joint state, so `setState(...)` and carrying on gives **exactly the same bits** as never having stopped (save games, network resync, rewind). Bodies are matched by `id` and joints by order: rebuild the same scene first (`resetBodyIds()` helps). |

Verified (`test/rigid-*.test.js`, 38 tests): every contact generator against hand-computed cases (face, edge, corner, inside, rotated, capsule ends, box on triangles); free fall; resting height and sleep; bounce height `e^2 h`; sliding down a 30 degree slope at the predicted acceleration and staying put with enough friction; towers, walls and a 150-body pile; elastic and sticky collisions conserve momentum; energy and angular momentum of a free spinning box; rolling without slipping; a pendulum's length and period; hinges with limits and motors; a weld under load; a rod, a rope and a spring at its frequency; a 12-link chain; a platform that carries a crate; triggers; contact events; rays against every shape; collision filtering; tunnelling at up to 1,500 m/s; island sleep and wake; state save and restore bit for bit. `examples/physics3d` (`npm run physics3d`) is a playground (a wall of crates, a wrecking ball, a seesaw, a ragdoll, a spinning paddle, a trigger zone, a spring) tested live in Chrome on both renderers by `tools/physics3d-test.js`. Benchmark: `node packages/physics/bench/rigid.js 1000`.

Not done (yet): continuous collision between two fast dynamic bodies, slider and twist-limited joints, convex hulls and triangle-mesh dynamic bodies (only the static `TriWorld`), compound shapes (several shapes on one body), friction anisotropy and rolling friction as a proper constraint, soft bodies and cloth (E17 marks them C), and a networked-physics layer (the state is there; sending it is up to the game).

### Ragdolls and cone joints

`ConeJoint(a, b, anchor, axis, maxSwing)` is a ball joint whose swing is limited: the angle between `axis` as carried by body a and by body b may not pass `maxSwing` radians (twist about the axis is free). With hinges for elbows and knees it makes a body that bends the way bodies bend.

```js
import { PhysicsWorld, Ragdoll, humanoidRagdollSpec } from '@engine/physics';
const world = new PhysicsWorld({ terrain: level, substeps: 4, iterations: 16 });     // joints this stiff want 4+ substeps
const rag = new Ragdoll(humanoidRagdollSpec({ height: 1.8, mass: 75 }), { x, y, z, yaw }).addTo(world);
rag.setLinearVelocity(vx, vy, vz);                  // carry on the way it was running
rag.applyImpulse('head', 40, 0, 10);                // the hit that killed it
// every frame: rag.bodies[i], rag.modelRotationDelta(i), rag.centerOfMass(), rag.resting
```

- **`humanoidRagdollSpec({ height, mass })`**: 13 capsules (hips, chest, head, upper and lower arms, upper and lower legs, feet), named as `humanoidKey` in `@engine/render` names joints, masses that add up to `mass`, cone joints at the shoulders, hips, neck and ankles, hinges at elbows (forward only) and knees (backward only). It is plain data: change radii, masses and limits, or write your own bones (`{ name, parent, from, to, radius, mass, joint }`).
- **`Ragdoll`** places it (`x`, `y`, `z`, `yaw`), makes the bodies and joints, `addTo` / `removeFrom` a world, and by default tells the world its own limbs pass through each other (`world.ignoreCollision(a, b)`; `selfCollision: true` turns that off). Damping is high on purpose, or limbs flail.
- **To and from a skeleton**: `poseToRagdoll(skeleton, pose, ragdoll, { velocity })` starts it from the pose being animated, and `poseFromRagdoll(skeleton, pose, ragdoll)` draws it, both in `@engine/render`; `ragdollSpecFromSkeleton(skeleton, base)` fits the bones to the skeleton's own joints. `setBone(i, delta, from)` is the primitive underneath.
- **Not done:** a twist limit (an arm can spin about its own length), a blend from ragdoll back to animation (stand up again: blend the two poses yourself over a second), active ragdolls that try to hold a pose with motors, and breaking joints on a heavy hit (a joint's `breakImpulse` exists: set it on `rag.joints`).

### Vehicles (`RaycastVehicle`)

A car, a bike, a cart, a hovercraft: a dynamic chassis held up by spring-and-damper "wheels" that are rays.

```js
const chassis = world.add(new RigidBody({ shape: box(0.9, 0.25, 2), y: 1, mass: 1200, canSleep: false }));
const wheel = (x, z, front) => ({ x, y: -0.1, z, radius: 0.35, suspensionLength: 0.3, steer: front ? 1 : 0, drive: 1, handbrake: !front });
const car = new RaycastVehicle(world, chassis, { wheels: [wheel(0.8, 1.3, true), wheel(-0.8, 1.3, true), wheel(0.8, -1.3, false), wheel(-0.8, -1.3, false)], antiRoll: [[0, 1, 15000], [2, 3, 15000]] });
// every tick, before world.step(dt):
car.steering = 0.25; car.engineForce = 4000; car.brake = 0; car.handbrake = 0;
car.update(dt); world.step(dt);
// to draw: car.wheelMatrix(i) (a 4x4 with the axle along x), car.speed, car.wheelsOnGround, car.wheels[i].load / slip / compression
```

- **Springs:** by default each spring is set from the chassis mass so the car sags a quarter of the suspension length at rest, with 0.8 of the critical damping for it; set `stiffness`, `damping`, `maxCompression` per wheel to tune.
- **Tyres:** each wheel grips sideways and along (engine, brakes, a little rolling resistance) up to `friction` times the load on it: a friction circle, so a wheel that is braking hard has less grip to turn with, a loaded outside wheel grips more, and an icy road (`friction: 0.1`) slides. Positive `steering` turns right.
- **Verified** (`test/rigid-ragdoll-vehicle.test.js`): it settles at the ride height the spring constants predict with the weight shared by the wheels; 4000 N for 3 s reaches the speed Newton gives; brakes stop it in the distance their force allows and reversing works; 0.3 rad of steering on a 2.6 m wheelbase makes the turn the geometry predicts; a sliding car is caught by grippy tyres and not by icy ones and does not roll; in the air no wheel is on the ground and it lands on its wheels; the hand brake works on the rear wheels only; an anti-roll bar reduces the lean; and the whole thing is deterministic (cross-engine hashes `rigid.ragdoll` and `rigid.vehicle` in `node tools/determinism.js`).
- **Not done:** gears and an engine torque curve (set `engineForce` yourself from a speed curve), tyre slip curves (grip is a constant coefficient), a ground that is another vehicle's wheel, trailers and articulated vehicles (join them with a `HingeJoint` or `BallJoint`), tracked vehicles, and soft bodies and cloth.

## 2D rigid bodies (`World2D`)
Circles, boxes and convex polygons that stack, tumble, slide, bounce and hang from joints, with the same fixed-step, bit-for-bit deterministic design as the 3D world. Units are metres with +y down (the 2D renderer's direction), so gravity is `[0, 9.81]`; angles are radians, positive turning clockwise on screen. Keep a 1 x 1 crate near 1 unit and scale when you draw (for example 32 pixels to the metre).

```js
import { World2D, Body2D, boxShape, circleShape, polygonShape, RevoluteJoint2D, DistanceJoint2D, WeldJoint2D } from '@engine/physics';

const world = new World2D();                                            // { gravity, substeps: 2, iterations: 8, sleepTime: 0.5 }
world.add(new Body2D({ shape: boxShape(20, 1), type: 'static', x: 0, y: 11 }));          // a floor whose top is at y = 10
const crate = world.add(new Body2D({ shape: boxShape(0.5, 0.5), x: 0, y: 0, friction: 0.6, restitution: 0.2 }));
const ball = world.add(new Body2D({ shape: circleShape(0.4), x: 3, y: -2, density: 2 }));
world.addJoint(new RevoluteJoint2D(null, ball, 3, -6));                 // a pendulum: null is the world; the pivot is a world point
world.onContactBegin = (a, b, speed) => { if (speed > 4) playThud(); };
world.onTrigger = (sensor, body, entered) => { /* bodies made with sensor: true report overlaps and never push */ };

// every fixed step (render from body.x, body.y, body.angle):
world.step(1 / 60);
```
- **Bodies:** `dynamic`, `kinematic` (moved by the velocity you give it, carries and pushes others: platforms) and `static`. `mass` or `density`, `friction` (two bodies use the geometric mean), `restitution` (the larger), `linearDamping`, `angularDamping`, `gravityScale`, `fixedRotation`, `canSleep`, collision `group`/`mask` bits, `sensor`, `userData`. Push with `applyForce`, `applyImpulse`, `applyForceAt`, `applyImpulseAt`, `setVelocity`; move with `setPosition`, `setAngle`.
- **Shapes:** `circleShape(r)`, `boxShape(hx, hy)`, `polygonShape(points)` (convex, up to 16 points, either way round; the body's position becomes its centre of mass; a concave shape is several bodies joined with `WeldJoint2D`).
- **Joints:** `RevoluteJoint2D` (a pin or hinge, with an optional motor), `WeldJoint2D` (rigid link), `DistanceJoint2D` (a rod, or a spring with `frequency` and `damping`). Pass `null` for the world. Joined bodies do not collide with each other unless `collideConnected`.
- **Solving:** sequential impulses with warm starting (contacts keep their impulses from step to step, matched by which edges made them), friction cones, a restitution threshold, and **speculative contacts** for fast pairs: a contact found a little before the shapes meet limits the approach speed, so a ball at 150 m/s stops at a 0.2 m wall instead of passing through, and nothing sinks in and pops back out. Resting groups sleep (`world.stats`), and are woken by touch.
- **Also:** `raycast`, `queryPoint`, `queryAabb`, the events above, and `getState()` / `setState()` (plain data: saves, rollback and netcode; a replay from a saved state is bit for bit the same).
- **Determinism:** only `+ - * /` and `sqrt`; rotation is kept as a cosine and sine and turned by a rational rotation, with `sinCos(angle)` computed by a series, so no `Math.sin` is involved and a server and a browser agree exactly (`tools/check-shared-math.js` enforces it for this package).

Verified (`test/rigid2d.test.js`, 20 tests): every shape pairing's contacts against hand-computed depths and normals, free fall and bounce height, a ten-box stack and a six-row pyramid standing and sleeping, slopes that grip or slide with friction, pendulum length and swing, a motor reaching its speed, a weld that stays rigid, a spring that rings at its frequency, sensors and contact events, collision filters, queries and rays, tunnelling at 150 m/s, a platform carrying a box, 400 mixed bodies settling and sleeping (about 1 ms a step on this machine), and a bit-exact replay from a saved state.

Not done (yet): continuous collision for a fast thin *dynamic* body against another (fast pairs use speculative contacts, which are good but not exact for spinning shapes), prismatic and pulley joints, joint limits, compound shapes on one body, rounded polygons, and Box2D-style position-only correction (overlap is pushed out through velocity, so a very deep overlap recovers over a few steps).

## Smooth drawing between steps
Physics runs at a fixed rate and the screen does not, so drawing bodies where the last step left them stutters on a 144 Hz display. `PoseInterpolator` keeps each body's pose from before the step and blends toward the pose after it. It works with `World2D` and `PhysicsWorld`, only reads, and so cannot change a replay or a network game.

```js
import { PoseInterpolator } from '@engine/physics';
const view = new PoseInterpolator(world);
const pose = {};                                   // reused, so drawing allocates nothing

// fixed update:
view.snapshot(); world.step(1 / 60);
// render(alpha), with the alpha the game loop gives:
const p = view.pose(crate, alpha, pose);           // 2D: p.x, p.y, p.angle (and p.c, p.s); 3D: p.x, p.y, p.z, p.qx..p.qw
```
- Rotation is blended the short way round (2D through the cosine and sine, 3D as a quaternion with the sign fixed), and stays unit length.
- A body added after the last `snapshot` is drawn where it is; after moving one by hand between a snapshot and a draw, call `view.reset(body)` so it does not slide in from the old place. Bodies removed from the world are forgotten.
- It costs a few multiplications per body. Draw the pose, never feed it back into the simulation.

## Limits (the older 2D movement, by design)
- Axis-aligned boxes only. World bounds must contain all motion.
- Movers are swept against the hash as built at the start of the tick; other movers count as stationary during it.
- Already-overlapping boxes are only nudged out by `SKIN`, not fully depenetrated.

## Benchmark
`node packages/physics/bench/movement.js [movers] [statics]`
