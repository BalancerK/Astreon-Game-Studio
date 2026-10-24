// The physics playground's world: a ground with a ramp, a wall of crates, a wrecking ball on a chain, a seesaw, a spinning paddle,
// a trigger zone, a ragdoll and a sliding door. The level is built from engine pieces; everything that moves is a prefab (see prefabs.js)
// spawned at a place. The page draws whatever is in `world.bodies`.
import { PhysicsWorld, RigidBody, TriWorld, box } from '../../packages/physics/src/index.js';
import { createPrefabs } from './prefabs.js';
import { sceneSection, physicsSection, objectsSection } from '../../packages/save/src/index.js';
import { LoadedScene, spawnEntities, normalizeScene } from '../../packages/scene/src/index.js';

/**
 * @param {{scene?: any}} [o] A scene file (see scenes/yard.json): what to spawn on `reset()`. Without one the same layout is built by code.
 */
export function buildPlayground({ scene } = {}) {
  const sceneData = scene ? normalizeScene(scene) : null;
  const terrain = new TriWorld({ cellSize: 4 });
  const statics = [];
  const solid = (x, y, z, hx, hy, hz, color) => { terrain.addBox(x, y, z, hx, hy, hz); statics.push({ x, y, z, hx, hy, hz, color }); };
  solid(0, -1, 0, 40, 1, 40, [0.4, 0.5, 0.38]);                                   // the ground (top at y = 0)
  for (const [x, z, hx, hz] of [[-40, 0, 0.5, 40], [40, 0, 0.5, 40], [0, -40, 40, 0.5], [0, 40, 40, 0.5]]) solid(x, 1.5, z, hx, 1.5, hz, [0.5, 0.5, 0.58]); // low outer walls
  // a ramp, as a quad (rises 2.4 m over 8 m), with a back stop
  terrain.addQuad(14, 0, -6, 22, 2.4, -6, 22, 2.4, 6, 14, 0, 6);
  solid(22.6, 1.2, 0, 0.6, 1.2, 6, [0.55, 0.45, 0.4]);
  // a wall across the room with a gap 4 m wide: the sliding door fills it
  solid(-9, 1.75, 22, 7, 1.75, 0.3, [0.5, 0.5, 0.58]); solid(9, 1.75, 22, 7, 1.75, 0.3, [0.5, 0.5, 0.58]);
  terrain.build();

  const world = new PhysicsWorld({ terrain, substeps: 2, iterations: 8 });
  const zone = new RigidBody({ shape: box(2, 1.5, 2), type: 'static', x: -18, y: 1.5, z: 12, sensor: true });
  zone.key = 'zone';
  world.add(zone);
  const inside = new Set();
  world.onTrigger = (sensor, body, entered) => { if (sensor !== zone) return; if (entered) inside.add(body); else inside.delete(body); };
  const paddle = new RigidBody({ shape: box(3.5, 0.3, 0.3), type: 'kinematic', x: 14, y: 0.35, z: 14, friction: 0.7 });
  paddle.setAngularVelocity(0, 1.6, 0);
  paddle.key = 'paddle';
  world.add(paddle);

  const prefabs = createPrefabs(world);
  /** @type {import('../../packages/prefab/src/index.js').Instance[]} */
  let spawned = [];
  const spawn = (name, at, o = {}) => { const inst = prefabs.spawner.spawn(name, { at, ...o }); spawned.push(inst); return inst; };
  /** Hook a `SaveGame` up to everything that matters: the prefab instances, the physics state, each door's state machine. */
  const attach = (saves) => {
    saves.section('scene', sceneSection(prefabs.spawner));
    saves.section('physics', physicsSection(world));
    saves.section('doors', objectsSection(() => Object.fromEntries([...prefabs.spawner.instances.values()].filter((i) => i.data.door).map((i) => [i.id, i.data.door]))));
    saves.on('afterLoad', () => { inside.clear(); });
    return saves;
  };
  const play = { attach, world, statics, paddle, zone, inside, prefabs, reset: null, spawn, tick: (dt) => prefabs.tick(dt), get spawned() { return spawned; } };

  play.reset = () => {
    for (const inst of spawned) inst.destroy();
    spawned = [];
    for (const b of [...world.bodies]) if (b.userData?.dynamic && b.userData.entity === undefined) world.remove(b); // things shot or rained in by hand
    if (sceneData) { // the level comes from a scene file
      const loaded = new LoadedScene(prefabs.spawner, sceneData.name, sceneData.settings);
      sceneData.prefabs.forEach((p) => prefabs.spawner.library.define(p));
      spawnEntities(sceneData, prefabs.spawner, loaded);
      spawned = [...loaded.instances.values()];
      inside.clear();
      return;
    }
    for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) { // a wall of crates, each a little browner than the one below
      spawn('crate', { x: -6 + col * 1.02 + (row % 2) * 0.5, y: 0.3 + row * 0.6, z: -12 }, { overrides: { 'components.colour': { g: 0.62 + row * 0.03 } } });
    }
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) spawn('ball', { x: -22 + i * 0.72 + row * 0.36, y: 0.35 + row * 0.62, z: -6 });
    const wreck = spawn('wrecking_ball', { x: 0, y: 9, z: -2 });
    wreck.data.bodies.get('ball').setVelocity(9, 0, 0);
    spawn('seesaw_plank', { x: 8, y: 0.8, z: 8 });
    spawn('crate', { x: 9.8, y: 1.5, z: 8 }, { params: { mass: 30 }, overrides: { 'extras.body.shape': { type: 'box', hx: 0.4, hy: 0.4, hz: 0.4 }, 'components.colour': { r: 0.8, g: 0.3, b: 0.3 } } });
    spawn('ragdoll', { x: -14, y: 5, z: 0 });
    spawn('hanging_crate', { x: -6, y: 4, z: 8 });
    spawn('sliding_door', { x: 0, y: 0, z: 22 });
    inside.clear();
  };
  /** The door that is in the world now (a load replaces it with a new one). */
  Object.defineProperty(play, 'door', { get() { for (const i of prefabs.spawner.instances.values()) if (i.data.door) return i.data.door; return null; } });
  play.reset();
  return play;
}
