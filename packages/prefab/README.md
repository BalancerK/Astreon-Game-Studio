# @engine/prefab

Entity templates as data. A **prefab** is a named description of an entity: its components, tags, free-form `extras` for your own systems (a physics body, a mesh, a sound), and children (inline, or other prefabs). It can extend other prefabs, expose named parameters, and be overridden at spawn time. Prefabs are plain JSON, so they can live in files, come from a level editor or a mod, and be saved back out. Works with the engine's typed-array ECS (`@engine/core`); everything runs identically in Node and browsers.

```js
import { World } from '@engine/core';
import { PrefabLibrary, ComponentRegistry, PrefabSpawner, TransformSystem } from '@engine/prefab';

const registry = new ComponentRegistry().add(Health).add(Team, { enums: { id: { red: 0, blue: 1 } } });
const library = new PrefabLibrary(registry).load(JSON.parse(text));        // or .define({...})
library.validate();                                                         // every component, field, child and parameter checked at once

const world = new World();
const spawner = new PrefabSpawner(world, library);
spawner.extra('body', (cfg, { entity, instance }) => { const b = physics.add(new RigidBody({...cfg})); return () => physics.remove(b); });

const crate = spawner.spawn('crate', { at: { x: 3, y: 1, z: -2, yaw: 0.5 }, params: { hp: 80 }, overrides: { 'components.team.id': 'red' } });
crate.root;            // the entity
crate.get('lid');      // a child, by path ('lamp/bulb' for a grandchild)
crate.destroy();       // children first, then whatever the handlers returned
```

## A prefab

```json
{
  "name": "crate",
  "extends": "prop",
  "tags": ["breakable"],
  "components": { "health": { "hp": 40, "max": 40 }, "transform": {} },
  "extras": { "body": { "shape": { "type": "box", "hx": 0.5, "hy": 0.5, "hz": 0.5 }, "mass": 20 } },
  "children": [ { "name": "lamp", "prefab": "lamp", "local": { "y": 1.2 }, "components": { "light": { "intensity": 2 } } },
                { "name": "base", "components": { "health": { "hp": 100 } }, "local": { "y": -0.5 } } ],
  "params": { "hp": "components.health.hp", "mass": "extras.body.mass" }
}
```

- **Inheritance:** `extends` takes a name or a list; bases first, then the prefab's own values on top. Components and extras merge field by field, tags are united, children merge by name (the same name changes the inherited one), `params` merge by name. Circles are reported with their path (`a -> b -> a`).
- **Values:** numbers, booleans (1 / 0) and named constants registered with the field (`{ enums: { id: { red: 0, blue: 1 } } }`). Anything else is an error that names the component and field. `validate()` lists *every* problem in the library at once (unknown component, unknown field, missing child prefab, a prefab that contains itself, a parameter pointing nowhere).
- **Spawn options:** `at` (position, `yaw` or a quaternion `rotation`, uniform `scale`), `params` (the named knobs), `overrides` (a nested object or dotted paths into the resolved prefab, including `children.NAME.components...`; `null` removes a component or a child), `parent` and `local` (attach the root to an existing entity). A failed spawn leaves nothing behind.
- **Extras:** the engine does not know what `body` or `mesh` mean; you teach the spawner with `spawner.extra(key, (value, { entity, instance, world, spec, path }) => ...)`. Return a function to be run when the instance is destroyed. With `{ after: true }` the handler runs after the part's children exist, to wire parts together (joints between ragdoll limbs). Keys nobody handles are ignored (data may carry things only some games use) unless `strictExtras`.
- **Events:** `spawner.on('spawn' | 'destroy', fn)`.

## Hierarchy

`Transform` (position, quaternion, scale, world space), `Parent`, `LocalTransform` and `Tags` (up to 32 named tags as bits) are ready-made components. Children spawned from a prefab get `Parent` and `LocalTransform` and a correct world `Transform` at once; `TransformSystem.update(world)` keeps them following their parents each tick (parents first, any nesting, loops stop at a depth limit instead of hanging).

## Saving what changed

`spawner.capture(instance)` returns `{ prefab, overrides }`: only what differs from the prefab (changed component values, components added or removed since, tags, children's local poses, children that were destroyed). Spawn the prefab again with those overrides and you get the same thing back; capturing the copy gives the same overrides. This is what a save file wants: the prefab name and a few numbers, not a dump of the world.

## Tests

`npm test`: 15 tests (components, tags and transforms; inheritance and circles; nested children, local poses, rotation and scale; parameters and every kind of override; named constants and error messages; validation; extras, cleanups and late handlers; failed spawns; destroying; capture and rebuild; JSON round trip; deep trees and loops in the transform system). `examples/physics3d` builds its whole scene (crates, a chain with a wrecking ball, a ragdoll with joints, a seesaw, a sliding door) from prefabs, checked live in Chrome.

Not done (yet): prefab variants edited from a file watcher (hot reload), a binary format, per-instance pooling, component arrays (a field holds one number), scenes (a list of prefab instances with their overrides; that comes with the save / load step and the scene format).
