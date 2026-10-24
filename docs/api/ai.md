# @engine/ai

Navigation grid built from the level, A* paths (resumable), steering, behaviour trees and perception; the arena's bots are built from it.

```
npm install @engine/ai
```

Version 0.1.0. The package's own README ([packages/ai](../../packages/ai/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (50 of 50 documented)

| Name | Kind | Summary |
|---|---|---|
| [`Action`](#class-action) | class | Runs a function: `(ctx) => status \| boolean \| void`. |
| [`BehaviorTree`](#class-behaviortree) | class | One agent's instance of a tree: its blackboard, its memory, its random generator. |
| [`Condition`](#class-condition) | class | Asks a yes/no question: `(ctx) => boolean`. |
| [`Cooldown`](#class-cooldown) | class | After the child has run (to success or failure), refuses to run it again for `seconds`. |
| [`Crowd`](#class-crowd) | class | Agents walking a `NavMesh`. |
| [`DIRECTIONS`](#directions) | constant | The eight directions: 0 = +x, then clockwise seen from above (+z is 2). |
| [`FAILURE`](#failure) | constant | What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked again next time and carries on). |
| [`Guard`](#class-guard) | class | Runs `child` only while `condition` holds; if the condition stops holding the child is abandoned (FAILURE). |
| [`Inverter`](#class-inverter) | class | Swaps success and failure. |
| [`Memory`](#class-memory) | class | What an agent remembers about things it has noticed: where it last saw each, how long ago, and how sure it is. |
| [`NavGrid`](#class-navgrid) | class | A grid of the walkable floor in a level, built once from its collision triangles: a height per cell, several floors per column (stairs, bridges), cells too close to walls removed for the agent's radius, and links for drops and small gaps. |
| [`NavMesh`](#class-navmesh) | class | The walkable surface of a level as a mesh of triangles. |
| [`NavVolume`](#class-navvolume) | class | A three-dimensional navigation volume for one size of agent: add the solid boxes, then ask for paths between points (see the notes at the top of this file). |
| [`Node`](#class-node) | class | Base class. |
| [`Parallel`](#class-parallel) | class | Runs all children every tick. |
| [`PathFollower`](#class-pathfollower) | class | Walks an agent along a path (the points from `findPath`): head for the next point, move on when close, slow down at the end. |
| [`PathQuery`](#class-pathquery) | class | One path request: `step(n)` expands up to n nodes, `status` is 'running', 'found', 'partial' or 'none'. |
| [`RUNNING`](#running) | constant | What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked again next time and carries on). |
| [`RandomSelector`](#class-randomselector) | class | Picks one child at random (by weight) when started and keeps running it until it finishes. |
| [`Repeater`](#class-repeater) | class | Repeats its child `times` times (Infinity: forever, always RUNNING); stops early with FAILURE if the child fails. |
| [`Retry`](#class-retry) | class | Tries the child up to `times` times until it succeeds. |
| [`STATUS_NAMES`](#status_names) | constant | The status numbers as readable names (`1: "success"`), for logs and debug views. |
| [`SUCCESS`](#success) | constant | What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked again next time and carries on). |
| [`Selector`](#class-selector) | class | Tries children in order until one succeeds: the first that works wins. |
| [`Sequence`](#class-sequence) | class | Runs children in order until one fails: all must succeed. |
| [`SteeringAgent`](#class-steeringagent) | class | A moving thing to steer. |
| [`Succeeder`](#class-succeeder) | class | Always succeeds (unless still running). |
| [`Timeout`](#class-timeout) | class | Fails the child if it is still running after `seconds`. |
| [`Wait`](#class-wait) | class | Waits `seconds` (RUNNING until then, then SUCCESS). |
| [`accelerate`](#accelerate) | function | Change the agent's velocity toward a desired one, no faster than its acceleration allows. |
| [`alignment`](#alignment) | function | Match the average heading of neighbours. |
| [`arrive`](#arrive) | function | Like seek, but slow down inside `slowRadius` and stop at the point (speed falls off linearly with the distance left). |
| [`avoidObstacles`](#avoidobstacles) | function | Steer around things ahead: probe along the way you are heading with `blocked(fromX, fromZ, toX, toZ)` (a ray cast or a nav line-of-walk test returning true if something is in the way) and swerve to whichever side is clear. |
| [`blend`](#blend) | function | The weighted sum of desired velocities, limited to the agent's top speed. |
| [`bt`](#bt) | constant | Short builders: `bt.sequence(bt.condition(canSee), bt.action(shoot))`. |
| [`canHear`](#canhear) | function | Did a sound at (x, y, z) of this loudness (metres it carries in the open) reach the listener? |
| [`canSee`](#cansee) | function | Can an agent at `eye` looking along (fx, fz) see a point? |
| [`cohesion`](#cohesion) | function | Move toward the middle of the neighbours. |
| [`describe`](#describe) | function | A readable outline of a tree (for debugging). |
| [`evade`](#evade) | function | Run from where a moving target will be. |
| [`findPath`](#findpath) | function | Find a path, all at once. |
| [`flee`](#flee) | function | Walk away from a point at full speed. |
| [`fromData`](#fromdata) | function | Build a tree from plain data (so a tree can live in a JSON file, be edited, or come from a mod). |
| [`limit`](#limit) | function | Clamp a vector to a length. |
| [`pathIsClear`](#pathisclear) | function | Whether a path still looks valid: every node of it is still walkable and unblocked (after `nav.version` changed). |
| [`pursue`](#pursue) | function | Seek where a moving target will be (looking ahead by the time it takes to reach it). |
| [`seek`](#seek) | function | Walk straight toward a point at full speed. |
| [`separation`](#separation) | function | Push away from neighbours that are too close (each pushes harder the closer it is). |
| [`smoothNodes`](#smoothnodes) | function | Drop the nodes of a path that a straight walk can skip: from each point, jump to the farthest one it can walk to in a line. |
| [`wander`](#wander) | function | Meander: keep going roughly the way you were going, turning a little at random. |

## Functions

### `accelerate`

```js
function accelerate(agent, desired, dt)
```

Change the agent's velocity toward a desired one, no faster than its acceleration allows.

<sub>src/steering.js:135</sub>

### `alignment`

```js
function alignment(agent, neighbours, out = { x: 0, z: 0 })
```

Match the average heading of neighbours.

<sub>src/steering.js:87</sub>

### `arrive`

```js
function arrive(agent, tx, tz, slowRadius = 2, out = { x: 0, z: 0 })
```

Like seek, but slow down inside `slowRadius` and stop at the point (speed falls off linearly with the distance left).

<sub>src/steering.js:36</sub>

### `avoidObstacles`

```js
function avoidObstacles(agent, blocked, lookAhead = 2, out = { x: 0, z: 0 })
```

Steer around things ahead: probe along the way you are heading with `blocked(fromX, fromZ, toX, toZ)` (a ray cast or a nav
line-of-walk test returning true if something is in the way) and swerve to whichever side is clear.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `blocked` | `(x0: number, z0: number, x1: number, z1: number) => boolean` |  |

<sub>src/steering.js:106</sub>

### `blend`

```js
function blend(agent, parts, out = { x: 0, z: 0 })
```

The weighted sum of desired velocities, limited to the agent's top speed.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `parts` | `[{x: number, z: number}, number][]` |  |

<sub>src/steering.js:128</sub>

### `canHear`

```js
function canHear(listener, sound, { sensitivity = 1, muffled = null } = {})
```

Did a sound at (x, y, z) of this loudness (metres it carries in the open) reach the listener? `muffled(…)` may say a wall is between.

<sub>src/perception.js:21</sub>

### `canSee`

```js
function canSee(eye, fx, fz, target, { range = 40, cosFov = 0.5, blocked = null } = {})
```

Can an agent at `eye` looking along (fx, fz) see a point? A cone (`cosFov`: the cosine of half the field of view, from `cos` in
@engine/math), a range, and `blocked(x0, y0, z0, x1, y1, z1)` true when something solid is in the way.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `eye` | `{x: number, y: number, z: number}` |  |
| `fx` | `number` |  |
| `fz` | `number` | Unit facing direction on the ground plane. |
| `target` | `{x: number, y: number, z: number}` |  |
| `o` (optional) | `{range?: number, cosFov?: number, blocked?: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => boolean}` |  |

<sub>src/perception.js:12</sub>

### `cohesion`

```js
function cohesion(agent, neighbours, out = { x: 0, z: 0 })
```

Move toward the middle of the neighbours.

<sub>src/steering.js:95</sub>

### `describe`

```js
function describe(node, depth = 0)
```

A readable outline of a tree (for debugging).

<sub>src/bt.js:288</sub>

### `evade`

```js
function evade(agent, target, out = { x: 0, z: 0 })
```

Run from where a moving target will be.

<sub>src/steering.js:52</sub>

### `findPath`

```js
function findPath(nav, from, to, o = {})
```

Find a path, all at once.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `nav` | `import('./navgrid.js').NavGrid` |  |
| `o` (optional) | `PathOptions` |  |

**Returns** `PathQuery` — With `status`, `path` (points) and `length`.

<sub>src/path.js:184</sub>

### `flee`

```js
function flee(agent, fx, fz, out = { x: 0, z: 0 })
```

Walk away from a point at full speed.

<sub>src/steering.js:30</sub>

### `fromData`

```js
function fromData(spec, registry)
```

Build a tree from plain data (so a tree can live in a JSON file, be edited, or come from a mod). Leaves name functions in `registry`.
`{ type: 'selector', children: [ { type: 'sequence', children: [ { type: 'condition', name: 'canSeeEnemy' }, { type: 'action', name: 'shoot' } ] }, { type: 'action', name: 'patrol' } ] }`

**Parameters**

| Name | Type | Description |
|---|---|---|
| `spec` | `object` |  |
| `registry` | `Record<string, (ctx: TickContext) => any>` |  |

<sub>src/bt.js:265</sub>

### `limit`

```js
function limit(out, max)
```

Clamp a vector to a length.

<sub>src/steering.js:16</sub>

### `pathIsClear`

```js
function pathIsClear(nav, path, from = 0)
```

Whether a path still looks valid: every node of it is still walkable and unblocked (after `nav.version` changed).

<sub>src/path.js:191</sub>

### `pursue`

```js
function pursue(agent, target, out = { x: 0, z: 0 })
```

Seek where a moving target will be (looking ahead by the time it takes to reach it). target: {x, z, vx, vz}.

<sub>src/steering.js:45</sub>

### `seek`

```js
function seek(agent, tx, tz, out = { x: 0, z: 0 })
```

Walk straight toward a point at full speed.

<sub>src/steering.js:23</sub>

### `separation`

```js
function separation(agent, neighbours, distance = 1.5, out = { x: 0, z: 0 })
```

Push away from neighbours that are too close (each pushes harder the closer it is).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `neighbours` | `{x: number, z: number, radius?: number}[]` |  |

<sub>src/steering.js:75</sub>

### `smoothNodes`

```js
function smoothNodes(nav, nodes)
```

Drop the nodes of a path that a straight walk can skip: from each point, jump to the farthest one it can walk to in a line.

<sub>src/path.js:158</sub>

### `wander`

```js
function wander(agent, state, rng, turn = 0.3, out = { x: 0, z: 0 })
```

Meander: keep going roughly the way you were going, turning a little at random. `state` is `{dx, dz}` (create with `{dx: 1, dz: 0}`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `rng` | `() => number` | 0..1 |
| `turn` (optional) | `number` | How much the heading may change per call, 0..1 (0.3). |

<sub>src/steering.js:62</sub>

## Classes

### `class Action`

```js
class Action extends Node
```

Runs a function: `(ctx) => status | boolean | void`.

#### `Action.constructor`

```js
constructor(fn, name = 'action')
```

#### `Action.tick`

```js
tick(ctx)
```

<sub>src/bt.js:37</sub>

### `class BehaviorTree`

```js
class BehaviorTree
```

One agent's instance of a tree: its blackboard, its memory, its random generator.

#### `BehaviorTree.constructor`

```js
constructor(root, { bb = {}, agent = null, rng = () => 0.5 } = {})
```

| Name | Type | Description |
|---|---|---|
| `root` | `Node` |  |
| `o` (optional) | `{bb?: object, agent?: any, rng?: () => number}` |  |

#### `BehaviorTree.bb`

```js
get bb
```

#### `BehaviorTree.tick`

```js
tick(dt)
```

Run the tree once.

**Returns** `number` — the root's status

#### `BehaviorTree.save`

```js
save(bbKeys = [])
```

What the tree is in the middle of, as plain data: which child is running, timers, counters, and the blackboard entries you name.
Nodes are identified by their position in the tree, so a save loads into any tree built the same way (node numbers are not stable between sessions).

| Name | Type | Description |
|---|---|---|
| `bbKeys` (optional) | `string[]` | Blackboard entries to keep (only plain data). |

#### `BehaviorTree.load`

```js
load(data)
```

Put the tree back where `save()` found it (into a tree of the same shape).

#### `BehaviorTree.reset`

```js
reset()
```

Forget what every node was doing (start over).

<sub>src/bt.js:197</sub>

### `class Condition`

```js
class Condition extends Node
```

Asks a yes/no question: `(ctx) => boolean`.

#### `Condition.constructor`

```js
constructor(fn, name = 'condition')
```

#### `Condition.tick`

```js
tick(ctx)
```

<sub>src/bt.js:43</sub>

### `class Cooldown`

```js
class Cooldown extends Node
```

After the child has run (to success or failure), refuses to run it again for `seconds`.

#### `Cooldown.constructor`

```js
constructor(child, seconds, name = 'cooldown')
```

#### `Cooldown.tick`

```js
tick(ctx)
```

<sub>src/bt.js:145</sub>

### `class Crowd`

```js
class Crowd
```

Agents walking a `NavMesh`.

#### `Crowd.constructor`

```js
constructor(mesh, { horizon = 2.5, neighborDistance = 6, arriveDistance = 0.25, repathDelay = 0.5 } = {})
```

| Name | Type | Description |
|---|---|---|
| `mesh` | `import('./navmesh.js').NavMesh` |  |
| `o` (optional) | `object` |  |
| `o.horizon` (optional) | `number` | Seconds ahead agents look for collisions (2.5). |
| `o.neighborDistance` (optional) | `number` | How far away other agents are taken into account (6 metres). |
| `o.arriveDistance` (optional) | `number` | How close to its goal an agent has to get (0.25 metres). |
| `o.repathDelay` (optional) | `number` | Least seconds between an agent's searches for a new path (0.5). |

#### `Crowd.addAgent`

```js
addAgent({ x, y = 0, z, radius = 0.4, maxSpeed = 3.5, maxAccel = 8, userData = null })
```

Put an agent on the mesh (at the nearest place to the position given).

| Name | Type | Description |
|---|---|---|
| `o` | `{x: number, y?: number, z: number, radius?: number, maxSpeed?: number, maxAccel?: number, userData?: any}` |  |

**Returns** `CrowdAgent`

#### `Crowd.removeAgent`

```js
removeAgent(agent)
```

#### `Crowd.moveTo`

```js
moveTo(agent, x, y, z)
```

Send an agent to a place; it finds its own way, and finds another if the way is closed on the road.

#### `Crowd.stop`

```js
stop(agent)
```

Stop an agent where it is.

#### `Crowd.update`

```js
update(dt)
```

Advance every agent by `dt` seconds (call it with a fixed step, like the rest of the simulation).

<sub>src/crowd.js:37</sub>

### `class Guard`

```js
class Guard extends Node
```

Runs `child` only while `condition` holds; if the condition stops holding the child is abandoned (FAILURE).

#### `Guard.constructor`

```js
constructor(condition, child, name = 'guard')
```

#### `Guard.tick`

```js
tick(ctx)
```

<sub>src/bt.js:188</sub>

### `class Inverter`

```js
class Inverter extends Node
```

Swaps success and failure.

#### `Inverter.constructor`

```js
constructor(child, name = 'not')
```

#### `Inverter.tick`

```js
tick(ctx)
```

<sub>src/bt.js:108</sub>

### `class Memory`

```js
class Memory
```

What an agent remembers about things it has noticed: where it last saw each, how long ago, and how sure it is.

#### `Memory.constructor`

```js
constructor(forgetAfter = 10)
```

| Name | Type | Description |
|---|---|---|
| `forgetAfter` (optional) | `number` | Seconds until a memory is dropped (10). |

#### `Memory.see`

```js
see(id, x, y, z, vx = 0, vz = 0)
```

Note that `id` was seen at a place now (with its velocity, if known).

#### `Memory.suspect`

```js
suspect(id, x, y, z)
```

Note a sound or a hint: a place worth checking, less certain than a sighting.

#### `Memory.get`

```js
get(id)
```

#### `Memory.forget`

```js
forget(id)
```

#### `Memory.update`

```js
update(dt)
```

Age everything; things not seen this tick lose their "currently visible" flag. Call once per tick after the `see` calls.

#### `Memory.guess`

```js
guess(id, maxExtrapolate = 1.5)
```

Where something probably is now: the last known place, carried forward by its last known velocity for a moment.

#### `Memory.save`

```js
save()
```

The memories as plain data.

#### `Memory.load`

```js
load(data)
```

#### `Memory.freshest`

```js
freshest()
```

The remembered thing seen most recently, or null.

<sub>src/perception.js:29</sub>

### `class NavGrid`

```js
class NavGrid
```

A grid of the walkable floor in a level, built once from its collision triangles: a height per cell, several floors per column
(stairs, bridges), cells too close to walls removed for the agent's radius, and links for drops and small gaps. Create it with
`NavGrid.build(world, options)` and search it with `findPath`.

#### `NavGrid.constructor`

```js
constructor(o)
```

Use `NavGrid.build(world, options)`.

#### `NavGrid.build`

```js
static build(world, options)
```

| Name | Type | Description |
|---|---|---|
| `world` | `import('../../physics/src/tri-world.js').TriWorld` | A built world. Triangles should be wound so their normal points out of the solid (boxes and glTF meshes are); a floor below another surface counts only if it faces up. |
| `options` | `NavOptions` |  |

#### `NavGrid.walkableCount`

```js
get walkableCount
```

Number of nodes an agent can stand on.

#### `NavGrid.columnAt`

```js
columnAt(x, z)
```

The cell column holding a world position, or -1 outside the grid.

#### `NavGrid.nearest`

```js
nearest(x, y, z, maxCells = 6)
```

The walkable node nearest a point: the best floor in its column (preferring one at about the same height), else the nearest
cell in rings around it, up to `maxCells` away.

**Returns** `number` — node index, or -1

#### `NavGrid.setArea`

```js
setArea(minX, minY, minZ, maxX, maxY, maxZ, kind)
```

Set the kind of ground inside a box (e.g. water, mud) and give each kind a cost multiplier with `areaCost[kind] = 3`.

#### `NavGrid.block`

```js
block(minX, minY, minZ, maxX, maxY, maxZ, margin = this.agentRadius)
```

Keep agents out of a box (a closed door, a barricade, a spreading fire). Nodes within `margin` of it become impassable until
`unblock`. Returns a handle.

#### `NavGrid.unblock`

```js
unblock(id)
```

#### `NavGrid.addLink`

```js
addLink(from, to, { cost = null, bidirectional = true } = {})
```

Connect two nodes by something that is not walking: a jump, a ladder, a teleporter. `cost` is in metres of walking it is worth.

#### `NavGrid.lineOfWalk`

```js
lineOfWalk(a, b, costLimit = Infinity)
```

Can an agent walk in a straight line between two nodes along the grid (every step of the line is a real connection)?
Used to smooth paths and to test "can I just go there". `costLimit`: refuse to walk through ground costlier than this (a swamp).

<sub>src/navgrid.js:35</sub>

### `class NavMesh`

```js
class NavMesh
```

The walkable surface of a level as a mesh of triangles. Make it with `NavMesh.build(vertices, indices, options)`.

#### `NavMesh.build`

```js
static build(vertices, indices, options = {})
```

Make a navigation mesh from triangles (the level's collision triangles will do: it keeps the ones an agent can stand on).

| Name | Type | Description |
|---|---|---|
| `vertices` | `ArrayLike<number>` | x, y, z for each vertex |
| `indices` | `ArrayLike<number>` | three vertex numbers for each triangle |
| `options` (optional) | `NavMeshOptions` |  |

#### `NavMesh.constructor`

```js
constructor(vertices, indices, { maxSlope = 45, maxEdge = Infinity, agentRadius = 0.4, weld = 0.0001 } = {})
```

#### `NavMesh.edge`

```js
edge(p, e)
```

The corners of a triangle's edge `e` (the edge from corner e to corner e + 1, both vertex numbers).

#### `NavMesh.contains`

```js
contains(p, x, z)
```

Whether (x, z) is over triangle p.

#### `NavMesh.heightAt`

```js
heightAt(p, x, z)
```

The height of triangle p at (x, z).

#### `NavMesh.polyAt`

```js
polyAt(x, y, z, maxDy = Infinity)
```

The triangle under a point: the one whose surface at (x, z) is nearest to height y, within `maxDy` (so a bridge and the ground under it are told apart). -1 if there is none.

| Name | Type | Description |
|---|---|---|
| `maxDy` (optional) | `number` |  |

#### `NavMesh.nearest`

```js
nearest(x, y, z, radius = 2, blocked = false)
```

The nearest place on the mesh to a point (not counting blocked triangles unless `blocked`), looking up to `radius` away.

**Returns** `{poly: number, x: number, y: number, z: number, distance: number} \| null`

#### `NavMesh.randomPoint`

```js
randomPoint(random)
```

A point on the mesh chosen with `random()` (a function giving numbers from 0 up to 1; pass your game's seeded generator) from a triangle that is not blocked, or null.

#### `NavMesh.block`

```js
block(minX, minY, minZ, maxX, maxY, maxZ, margin = 0)
```

Block everything inside a box (a crate, a barricade, a closed door) so paths go round. Triangles the box touches cannot be entered, so cut big triangles smaller with `maxEdge`
when you build the mesh to keep the blocked patch close to the shape. Returns a number for `unblock`.

| Name | Type | Description |
|---|---|---|
| `margin` | `number` | Make the box this much bigger on every side |

#### `NavMesh.blockCircle`

```js
blockCircle(x, z, radius, minY = -Infinity, maxY = Infinity)
```

Block a circle on the ground (a pillar, a stopped vehicle) between two heights. Returns a number for `unblock`.

#### `NavMesh.unblock`

```js
unblock(id)
```

Take an obstacle away.

#### `NavMesh.setArea`

```js
setArea(minX, minY, minZ, maxX, maxY, maxZ, kind)
```

Mark the ground inside a box as a kind (0 normal; give a kind a cost with `areaCost[kind] = 3` for mud, water, a road to keep to).

#### `NavMesh.findPath`

```js
findPath(from, to, { radius = this.agentRadius, partial = false, snap = 2, maxNodes = 100000, smooth = true } = {})
```

The shortest walk from one place to another, held off the corners of walls by the agent's radius.

| Name | Type | Description |
|---|---|---|
| `from` | `{x: number, y: number, z: number}` |  |
| `to` | `{x: number, y: number, z: number}` |  |
| `o` (optional) | `object` |  |
| `o.radius` (optional) | `number` | Distance to keep from corners (default: the mesh's `agentRadius`). |
| `o.partial` (optional) | `boolean` | When the goal cannot be reached, go as near as possible instead of failing. |
| `o.snap` (optional) | `number` | How far from the mesh the start and goal may be and still count (2 metres). |
| `o.maxNodes` (optional) | `number` | Give up after looking at this many triangles (100000). |
| `o.smooth` (optional) | `boolean` | Cut out corners that a straight walk the width of the agent can skip (default true): the corridor search is close to the shortest route but not exact. |

**Returns** `NavPath`

#### `NavMesh.canWalk`

```js
canWalk(x, y, z, tx, tz, radius = this.agentRadius)
```

Whether an agent `radius` wide standing at (x, y, z) can walk straight to (tx, tz) without a wall in the way (see `isVisible` for a point-sized one).

#### `NavMesh.move`

```js
move(poly, x, z, tx, tz)
```

Move along the surface from a place in triangle `poly` toward (tx, tz): the walk passes from triangle to triangle and slides along a wall it meets instead of passing through.

**Returns** `{poly: number, x: number, y: number, z: number, hit: boolean}` — where it ended up; `hit` says a wall stopped it

#### `NavMesh.raycast`

```js
raycast(from, to)
```

Walk a straight line over the mesh from a point to another and report where a wall stops it, if one does.

**Returns** `{hit: boolean, t: number, x: number, y: number, z: number, poly: number}` — `t` is how far along the line (0 to 1) it got

#### `NavMesh.isVisible`

```js
isVisible(from, to)
```

Whether a straight walk between two points is free of walls (the path can be shortened to it).

<sub>src/navmesh.js:75</sub>

### `class NavVolume`

```js
class NavVolume
```

A three-dimensional navigation volume for one size of agent: add the solid boxes, then ask for paths between points (see the notes at the top of this file).

#### `NavVolume.constructor`

```js
constructor({ min, max, cell = 4, radius = 1, height = 5 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.min` | `number[]` | The low corner of the space. |
| `o.max` | `number[]` | The high corner. |
| `o.cell` (optional) | `number` | The size of a cube, in metres (4). |
| `o.radius` (optional) | `number` | The agent's half width. |
| `o.height` (optional) | `number` | The agent's height. The agent's feet are what the cubes hold, so the lowest layer is the floor. |

#### `NavVolume.cellAt`

```js
cellAt(x, y, z)
```

The cube number of a point, or -1 outside the space.

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |

#### `NavVolume.centerOf`

```js
centerOf(cell)
```

Where the agent's feet are for a cube.

| Name | Type | Description |
|---|---|---|
| `cell` | `number` |  |

**Returns** `number[]`

#### `NavVolume.addBox`

```js
addBox(b)
```

Mark the cubes a box blocks (where the agent's body would touch it).

| Name | Type | Description |
|---|---|---|
| `b` | `Box` |  |

#### `NavVolume.addBoxes`

```js
addBoxes(boxes)
```

| Name | Type | Description |
|---|---|---|
| `boxes` | `Box[]` |  |

#### `NavVolume.free`

```js
free(x, y, z)
```

Is the agent allowed to be with its feet here?

| Name | Type | Description |
|---|---|---|
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |

#### `NavVolume.nearestFree`

```js
nearestFree(x, y, z, rings = 4)
```

The nearest free point to somewhere (a spot inside a wall, say), looking outward a few cubes. Returns null if none is near.

#### `NavVolume.lineClear`

```js
lineClear(a, b)
```

Is the straight line between two points clear (every step along it is a free place)?

| Name | Type | Description |
|---|---|---|
| `a` | `number[]` |  |
| `b` | `number[]` |  |

#### `NavVolume.findPath`

```js
findPath(from, to, { maxNodes = 40000, smooth = true } = {})
```

Find a path. The start and the goal are moved to the nearest free place if they are inside something.

| Name | Type | Description |
|---|---|---|
| `from` | `number[]` |  |
| `to` | `number[]` |  |
| `o` (optional) | `{maxNodes?: number, smooth?: boolean}` |  |

**Returns** `{status: 'found' \| 'partial' \| 'none', path: number[][], cost: number}` — `partial` means the goal cannot be reached; the path ends as near to it as the search got.

<sub>src/navvolume.js:56</sub>

### `class Node`

```js
class Node
```

Base class. Subclasses implement `tick(ctx)`; `reset(ctx)` clears memory when a node is abandoned.

#### `Node.constructor`

```js
constructor(name = '')
```

#### `Node.tick`

```js
tick(ctx)
```

| Name | Type | Description |
|---|---|---|
| `ctx` | `TickContext` |  |

**Returns** `number`

#### `Node.reset`

```js
reset(ctx)
```

<sub>src/bt.js:29</sub>

### `class Parallel`

```js
class Parallel extends Node
```

Runs all children every tick. `policy: 'all'` succeeds when all succeed (fails when any fails); `'one'` succeeds when any succeeds.

#### `Parallel.constructor`

```js
constructor(children, { policy = 'all', name = 'parallel' } = {})
```

#### `Parallel.tick`

```js
tick(ctx)
```

<sub>src/bt.js:97</sub>

### `class PathFollower`

```js
class PathFollower
```

Walks an agent along a path (the points from `findPath`): head for the next point, move on when close, slow down at the end.
`stuck` turns true when it has made no progress for `stuckTime` seconds (a moved obstacle, a blocked door): ask for a new path.

#### `PathFollower.constructor`

```js
constructor(path = [], { reach = 0.35, slowRadius = 1.5, stuckTime = 1.2 } = {})
```

| Name | Type | Description |
|---|---|---|
| `path` | `{x: number, y: number, z: number}[]` |  |

#### `PathFollower.set`

```js
set(path)
```

#### `PathFollower.target`

```js
get target
```

The point being walked to, or null.

#### `PathFollower.remaining`

```js
remaining(agent)
```

Metres left along the path from the agent.

#### `PathFollower.desired`

```js
desired(agent, dt, out = { x: 0, z: 0 })
```

The velocity to walk with this tick.

**Returns** `{x: number, z: number}` — out

<sub>src/steering.js:147</sub>

### `class PathQuery`

```js
class PathQuery
```

One path request: `step(n)` expands up to n nodes, `status` is 'running', 'found', 'partial' or 'none'.

#### `PathQuery.constructor`

```js
constructor(nav, from, to, o = {})
```

| Name | Type | Description |
|---|---|---|
| `nav` | `import('./navgrid.js').NavGrid` |  |
| `from` | `{x: number, y: number, z: number}` |  |
| `to` | `{x: number, y: number, z: number}` |  |
| `o` (optional) | `PathOptions` |  |

#### `PathQuery.step`

```js
step(budget = 500)
```

Expand up to `budget` nodes. Returns the status.

#### `PathQuery.cancel`

```js
cancel()
```

Give up on a running query (its search memory goes back to the pool).

<sub>src/path.js:55</sub>

### `class RandomSelector`

```js
class RandomSelector extends Node
```

Picks one child at random (by weight) when started and keeps running it until it finishes.

#### `RandomSelector.constructor`

```js
constructor(children, weights = null, name = 'random')
```

#### `RandomSelector.tick`

```js
tick(ctx)
```

<sub>src/bt.js:171</sub>

### `class Repeater`

```js
class Repeater extends Node
```

Repeats its child `times` times (Infinity: forever, always RUNNING); stops early with FAILURE if the child fails.

#### `Repeater.constructor`

```js
constructor(child, times = Infinity, name = 'repeat')
```

#### `Repeater.tick`

```js
tick(ctx)
```

<sub>src/bt.js:119</sub>

### `class Retry`

```js
class Retry extends Node
```

Tries the child up to `times` times until it succeeds.

#### `Retry.constructor`

```js
constructor(child, times = 3, name = 'retry')
```

#### `Retry.tick`

```js
tick(ctx)
```

<sub>src/bt.js:132</sub>

### `class Selector`

```js
class Selector extends Node
```

Tries children in order until one succeeds: the first that works wins. Without `memory` (default) it re-checks from the top every
tick, so a more important behaviour can interrupt a less important one that is still running.

#### `Selector.constructor`

```js
constructor(children, { memory = false, name = 'selector' } = {})
```

#### `Selector.tick`

```js
tick(ctx)
```

<sub>src/bt.js:78</sub>

### `class Sequence`

```js
class Sequence extends Node
```

Runs children in order until one fails: all must succeed. With `memory` (default) a running child is resumed, not restarted.

#### `Sequence.constructor`

```js
constructor(children, { memory = true, name = 'sequence' } = {})
```

#### `Sequence.tick`

```js
tick(ctx)
```

<sub>src/bt.js:60</sub>

### `class SteeringAgent`

```js
class SteeringAgent
```

A moving thing to steer. Positions in metres, velocities in m/s.

#### `SteeringAgent.constructor`

```js
constructor({ x = 0, y = 0, z = 0, maxSpeed = 4, maxAccel = 25, radius = 0.4 } = {})
```

<sub>src/steering.js:6</sub>

### `class Succeeder`

```js
class Succeeder extends Node
```

Always succeeds (unless still running).

#### `Succeeder.constructor`

```js
constructor(child, name = 'always')
```

#### `Succeeder.tick`

```js
tick(ctx)
```

<sub>src/bt.js:113</sub>

### `class Timeout`

```js
class Timeout extends Node
```

Fails the child if it is still running after `seconds`.

#### `Timeout.constructor`

```js
constructor(child, seconds, name = 'timeout')
```

#### `Timeout.tick`

```js
tick(ctx)
```

<sub>src/bt.js:158</sub>

### `class Wait`

```js
class Wait extends Node
```

Waits `seconds` (RUNNING until then, then SUCCESS).

#### `Wait.constructor`

```js
constructor(seconds, name = 'wait')
```

#### `Wait.tick`

```js
tick(ctx)
```

<sub>src/bt.js:49</sub>

## Constants

### `DIRECTIONS`

```js
const DIRECTIONS
```

The eight directions: 0 = +x, then clockwise seen from above (+z is 2). Even numbers are straight, odd are diagonal.

Value: `Object.freeze({ dx: DX, dz: DZ })`

<sub>src/navgrid.js:14</sub>

### `FAILURE`

```js
const FAILURE
```

What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked
again next time and carries on).

<sub>src/bt.js:10</sub>

### `RUNNING`

```js
const RUNNING
```

What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked
again next time and carries on).

<sub>src/bt.js:10</sub>

### `STATUS_NAMES`

```js
const STATUS_NAMES
```

The status numbers as readable names (`1: "success"`), for logs and debug views.

Value: `{ 1: 'success', 2: 'failure', 3: 'running' }`

<sub>src/bt.js:12</sub>

### `SUCCESS`

```js
const SUCCESS
```

What a behaviour-tree node reports when it is ticked: `SUCCESS` (1), `FAILURE` (2), or `RUNNING` (3, still working: it is ticked
again next time and carries on).

Value: `1, FAILURE = 2, RUNNING = 3`

<sub>src/bt.js:10</sub>

### `bt`

```js
const bt
```

Short builders: `bt.sequence(bt.condition(canSee), bt.action(shoot))`.

Value: `{`

<sub>src/bt.js:241</sub>

## Types

### `Box`

A solid, with the smaller number first on each axis.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `x0` | `number` |  |
| `x1` | `number` |  |
| `y0` | `number` |  |
| `y1` | `number` |  |
| `z0` | `number` |  |
| `z1` | `number` |  |

### `CrowdAgent`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `id` | `number` |  |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` | Position on the mesh. |
| `vx` | `number` |  |
| `vz` | `number` | Velocity (metres per second). |
| `radius` | `number` |  |
| `maxSpeed` | `number` |  |
| `maxAccel` | `number` |  |
| `state` | `'idle' \| 'moving' \| 'arrived' \| 'blocked' \| 'lost'` | `idle`: no goal; `moving`: on its way; `arrived`: at its goal (or as near as the crowd let it get); `blocked`: no route to the goal (it went as near as it could); `lost`: pushed off the mesh with nowhere to stand. |
| `path` | `number[]` | The corners it is following (x, y, z, ...). |
| `userData` | `any` | Anything you want to keep with the agent. |

### `NavMeshOptions`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `maxSlope` (optional) | `number` | Steepest slope walked, in degrees (45); steeper triangles, and ceilings, are not part of the mesh. |
| `maxEdge` (optional) | `number` | Cut triangles with a side longer than this into smaller ones (default: leave them). Obstacles and ground kinds work on whole triangles, so smaller triangles mean finer shapes; a few metres is usually right for big flat areas. |
| `agentRadius` (optional) | `number` | The default distance paths keep from the corners of walls and obstacles (0.4); `findPath` can ask for another. |
| `weld` (optional) | `number` | Vertices closer than this are joined (0.0001). |
| `found` | `boolean` | A route to the goal was found. |
| `partial` | `boolean` | No route to the goal exists; `points` lead to the nearest place that can be reached (only with `partial: true`). |
| `points` | `number[]` | The way, as x, y, z, x, y, z, ...: the start, the corners to turn at, and the end. |
| `polys` | `number[]` | The triangles crossed. |
| `length` | `number` | Metres. |

### `NavOptions`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `bounds` | `{minX: number, minZ: number, maxX: number, maxZ: number}` | Area to cover (metres). |
| `cellSize` (optional) | `number` | Grid spacing (0.5). Smaller finds narrower gaps and costs more memory and build time. |
| `agentRadius` (optional) | `number` | Keep this far from walls and ledges (0.4). |
| `agentHeight` (optional) | `number` | Headroom needed above a floor (1.8). |
| `stepHeight` (optional) | `number` | Highest step it climbs (0.4). |
| `maxSlope` (optional) | `number` | Steepest slope it walks, in degrees (45). |
| `maxDrop` (optional) | `number` | Longest drop it will step off, one way (1.2); 0 for none. |
| `maxGap` (optional) | `number` | Widest gap (a crack between two platforms, a missing step) it will step across (0.6 m); 0 for none. |
| `top` (optional) | `number` | Highest floor to look for (default 60) and `bottom` the lowest (-5). |
| `maxLayers` (optional) | `number` | Floors kept per column (6). |

### `NavPath`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `maxSlope` (optional) | `number` | Steepest slope walked, in degrees (45); steeper triangles, and ceilings, are not part of the mesh. |
| `maxEdge` (optional) | `number` | Cut triangles with a side longer than this into smaller ones (default: leave them). Obstacles and ground kinds work on whole triangles, so smaller triangles mean finer shapes; a few metres is usually right for big flat areas. |
| `agentRadius` (optional) | `number` | The default distance paths keep from the corners of walls and obstacles (0.4); `findPath` can ask for another. |
| `weld` (optional) | `number` | Vertices closer than this are joined (0.0001). |
| `found` | `boolean` | A route to the goal was found. |
| `partial` | `boolean` | No route to the goal exists; `points` lead to the nearest place that can be reached (only with `partial: true`). |
| `points` | `number[]` | The way, as x, y, z, x, y, z, ...: the start, the corners to turn at, and the end. |
| `polys` | `number[]` | The triangles crossed. |
| `length` | `number` | Metres. |

### `PathOptions`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `maxExpansions` (optional) | `number` | Give up after expanding this many nodes (default 20000); the result is then the best partial path. |
| `smooth` (optional) | `boolean` | Pull the path straight where agents can walk in a line (default true). |
| `partial` (optional) | `boolean` | If the goal cannot be reached, return the path to the closest reachable node (default true). |
| `searchRadius` (optional) | `number` | Nearest-node search range in cells for the start and goal (6). |

### `TickContext`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `dt` | `number` | Seconds since the last tick. |
| `bb` | `Record<string, any>` | The blackboard: the agent's facts ("target", "hp", "path"). |
| `agent` | `any` | Whatever the game wants leaves to act on. |
| `rng` | `() => number` | 0..1 |
| `mem` | `Record<number, any>` | Per-node memory (managed for you). |
