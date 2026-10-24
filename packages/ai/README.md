# @engine/ai

Game AI for characters that walk a 3D level: **find paths** over a navigation grid built from the level itself, **steer** along them, **decide** with behaviour trees, and **perceive** with a field of view, line of sight, hearing and memory. Zero dependencies beyond `@engine/math` and `@engine/physics` (it reads the same `TriWorld` the physics uses, so what the AI thinks is walkable is what a character can actually walk). Deterministic like the rest of the engine (only `+ - * /` and `sqrt`; randomness comes from a generator you pass): bit-identical in Node, Chrome and Firefox (4 hash suites in `node tools/determinism.js`).

```js
import { NavGrid, findPath, PathQuery, PathFollower, SteeringAgent, accelerate, bt, BehaviorTree, canSee, Memory } from '@engine/ai';

const nav = NavGrid.build(level, { bounds: { minX: -60, minZ: -60, maxX: 60, maxZ: 60 }, agentRadius: 0.45, agentHeight: 1.8, stepHeight: 0.45 });   // ~0.15 s for a 120 m level

const q = findPath(nav, { x: -40, y: 0, z: -40 }, { x: 40, y: 0, z: 40 });                 // q.status: 'found' | 'partial' | 'none'; q.path: points; q.length
const follower = new PathFollower(q.path);                                                  // every tick:
follower.desired(agent, dt, out);  accelerate(agent, out, dt);                              //   the velocity to walk with
```

## Navigation grid

`NavGrid.build(world, options)` casts rays down every column of a grid (default 0.5 m cells) and keeps every floor an agent can stand on: **several per column** in a multi-storey level (a bridge and the ground under it), with the headroom the agent needs, a slope limit, and floors below another surface counted only if they face up. Neighbours are joined where the agent can walk (steps up to `stepHeight`, slopes up to `maxSlope`, nothing solid across the way at knee height, so even a zero-thickness wall blocks), with a margin of `agentRadius` kept from walls and ledges. Also:

- **Drops** (`maxDrop`, one way: an agent steps off a 1 m ledge but cannot climb back) and **gaps** (`maxGap`: a crack between two platforms is stepped across).
- **Areas:** `setArea(box, kind)` and `areaCost[kind] = 5` make swamps, mud or fire expensive; paths go around when there is a cheap way.
- **Dynamic obstacles:** `block(box)` keeps agents out of a closed door or a barricade until `unblock(handle)`; `nav.version` changes so agents know to find a new path. **Extra links** (`addLink(a, b, { cost })`) for jumps, ladders and teleporters.
- `nearest(x, y, z)` (the walkable node closest to a point), `lineOfWalk(a, b)` (can I just walk in a line there?), `walkableCount`. Different agent sizes need different grids (build one per size).

## Paths

`findPath` runs A* (octile distance heuristic, ties broken by node number so a query always gives the same path) and pulls the result straight where agents can walk in a line, never through costlier ground. For many agents use `new PathQuery(nav, from, to)` and call `query.step(300)` a little each tick: a thousand searches can be in flight, each borrowing the search memory only while it runs. If the goal cannot be reached the result is `partial` (the path to the closest reachable point; `partial: false` for `none` instead). `maxExpansions` bounds the work (an unreachable goal costs a few milliseconds, not a stall). On the arena level a path across the whole map takes 6 to 8 ms.

## Navigation mesh and crowds
For open worlds (terrain, big rooms, caves) where a grid wastes memory and cuts corners, `NavMesh` keeps the walkable surface as triangles joined along shared edges. Agents walk anywhere on it; a path is the shortest line through the corridor of triangles (A*, then the funnel algorithm), held off the corners of walls by the agent's radius.

```js
import { NavMesh, Crowd } from '@engine/ai';

// from the level's triangles: it keeps the ones an agent can stand on (facing up, not steeper than maxSlope)
const mesh = NavMesh.build(vertices, indices, { maxSlope: 45, agentRadius: 0.4, maxEdge: 4 });   // maxEdge cuts big triangles so obstacles bite small

const path = mesh.findPath({ x: 2, y: 0, z: 2 }, { x: 40, y: 0, z: 9 }, { radius: 0.4, partial: true });
// path.points = [x, y, z, ...] the corners to turn at; path.found / path.partial / path.length / path.polys

const id = mesh.block(10, -1, 0, 12, 3, 8);     // a barricade (a box on the ground) ... or mesh.blockCircle(x, z, r)
mesh.unblock(id);                               // paths found afterwards use the opening again
mesh.areaCost[1] = 4; mesh.setArea(6, -1, 2, 12, 1, 6, 1);   // mud: kind 1 costs 4 times as much to cross

const crowd = new Crowd(mesh);
const guard = crowd.addAgent({ x: 3, z: 3, radius: 0.4, maxSpeed: 3, maxAccel: 8 });
crowd.moveTo(guard, 30, 0, 12);
crowd.onArrive = (agent) => { /* ... */ };
crowd.update(1 / 60);                           // each fixed step; then draw guard.x, guard.y, guard.z
```
- **Building:** a moment even for a hundred thousand triangles (about 0.15 s on this machine, with a path across it in the same time). Because it is so quick, "runtime baking" is simply building again when the level changes; obstacles and ground kinds are cheaper still, and need no rebuild.
- **Paths:** `findPath(from, to, { radius, partial, snap, maxNodes, smooth })`. Start and goal snap to the mesh within `snap` metres. Corners that belong to walls are moved away along the way the wall faces until both straight stretches beside them clear it by `radius`; with `smooth` (default) corners an agent that wide can walk straight past are dropped. `partial: true` returns a path to the nearest reachable place when there is no route. Triangles can be at different heights (bridges over floors): `polyAt(x, y, z, maxDy)` tells them apart by height.
- **Moving and looking:** `move(poly, x, z, tx, tz)` walks over the surface triangle to triangle and slides along a wall instead of passing through; `raycast(from, to)` and `isVisible` use it; `nearest`, `polyAt`, `heightAt`, `randomPoint(random)` (pass your seeded generator).
- **Obstacles and kinds of ground:** `block` / `blockCircle` close the triangles they touch (cut big triangles with `maxEdge` first); `version` goes up on every change so agents know to look again.
- **Crowds:** `Crowd` gives each agent its own path and goal. Each step an agent looks at the agents near it (a grid keeps this fast: two hundred agents cost a few milliseconds a step) and picks, from 38 sampled velocities, the one closest to where it wants to go that avoids collisions for the next 2.5 seconds, passing on the right so two head-on agents choose opposite sides; speed and acceleration limits are kept, agents never overlap for long (they are pushed apart), and they stay on the mesh. An agent whose route is cut by a new obstacle finds another by itself; if the way is closed it waits as `blocked` and goes when it opens; one that is held up for over a second stops waiting for newer agents; a crowd at one goal settles with the later ones stopping as near as they can. States: `idle`, `moving`, `arrived`, `blocked`, `lost`.
- **Determinism:** only `+ - * /` and `sqrt` (the shared-math check covers it), a fixed order of agents and of the sampled velocities, no random numbers. Paths, ray casts, obstacles and a 20-agent crowd are in the cross-engine suite (`node tools/determinism.js`): Node, Chrome and Firefox give bit-identical results.
- **Limits:** agents avoid each other but not moving obstacles you did not tell the mesh about; walls are avoided only by the mesh edges and the corner clearance (not by sampling); off-mesh links (jumps, ladders) are only in the grid, and a symmetric jam can take a few seconds to unlock.

## Steering

Small functions that write a desired velocity `{x, z}` into an `out` object (no allocation): `seek`, `flee`, `arrive` (slows down and stops), `pursue` and `evade` (lead a moving target), `wander` (a seeded random walk), `separation`, `alignment`, `cohesion` (flocking), `avoidObstacles` (probe ahead with a ray test you provide and swerve), `blend` (weighted sum, limited to top speed) and `accelerate` (change velocity no faster than the agent's acceleration). `PathFollower` walks a path point by point, slows at the end, finishes (`done`) and flags `stuck` after a moment without progress (ask for a new path then).

## Behaviour trees

A node returns `SUCCESS`, `FAILURE` or `RUNNING`. **The tree is data shared by every agent**; what a node remembers (which child is running, a timer) lives in the agent's own `BehaviorTree`, so a thousand agents share one definition. Nodes: `action`, `condition`, `wait`, `sequence` (remembers its running child), `reactiveSequence` (re-checks its conditions every tick, for behaviours that must stop when the situation changes), `selector` (re-checks from the top, so an urgent behaviour interrupts a lazy one and the interrupted branch is reset), `memorySelector`, `parallel('all' | 'one')`, `not`, `always`, `repeat`, `retry`, `cooldown`, `timeout`, `random` (weighted), `guard`.

```js
const tree = bt.selector(
  bt.guard((c) => c.bb.hp < 30, bt.action(retreat)),
  bt.reactiveSequence(bt.condition((c) => c.agent.canSeeEnemy()), bt.action(engage)),
  bt.action(patrol),
);
const mind = new BehaviorTree(tree, { bb: { hp: 100 }, agent: me, rng });
mind.tick(dt);                       // every frame, or every few frames
```

Trees can also come from JSON (`fromData(spec, registry)` with leaves named in a registry of functions), so a level designer or a mod can edit behaviour without code; `describe(tree)` prints an outline.

## Perception

`canSee(eye, fx, fz, target, { range, cosFov, blocked })` (a cone, a range, and your `blocked(...)` ray test; anything within a metre is noticed whichever way you face), `canHear(listener, sound, { sensitivity, muffled })`, and `Memory`: where each thing was last seen, how long ago, a guess of where it is now (carried forward by its last velocity for a moment), a weaker `suspect` for sounds, and forgetting after a while.

## In the arena

`examples/arena3d/server/bots.js` builds the bots from exactly these pieces: a navigation grid of the arena (cached per level), a behaviour tree (retreat when hurt and hunted, engage a player in sight, investigate where one was last seen, otherwise patrol to random places), sight with a 120 degree field of view blocked by the level's real walls, memory, reaction time and accuracy per bot, and a path search spread over a few ticks. They climb the stairs and ramps, take drops, shoot with the same hitscan as players (their shots reach players' screens as ordinary shot events), and sixteen of them cost about 0.06 ms per tick. `startArena3dServer({ botAi: false })` brings back the old random wandering.

## Tests

`npm test`: 36 tests in the package (flat floors, walls and doorways, zero-thickness walls, stairs and jump links, slopes, multi-storey bridges, low ceilings, agent radius, drops, gaps, blocking, areas, partial paths, resumable and interleaved queries, repeatability; every steering function, flocking, path following; every tree node, interruption, sharing one tree between agents, JSON trees; sight, hearing, memory) and 6 in `examples/arena3d/test/bots.test.js` (bots walk the whole level and climb, shoot a visible player, do not shoot through a wall, repeat exactly, reach every part of the map).

Not done (yet): a polygon navmesh (the grid costs more memory on huge levels: 120 m at 0.5 m is 58,000 nodes), hierarchical pathfinding for very large maps, crowd avoidance beyond separation (no velocity obstacles), jump links generated automatically, utility AI and goal planners (GOAP), a debug view of the grid and paths, cover finding.
