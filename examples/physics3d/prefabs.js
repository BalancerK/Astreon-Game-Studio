// The playground's things as prefabs (plain data), and what their `extras` mean here: a rigid body, a joint to the part above, a first
// push, a sliding door run by a state machine. The scene file only says WHAT to spawn and WHERE.
import { defineComponent, World } from '../../packages/core/src/index.js';
import { PrefabLibrary, ComponentRegistry, PrefabSpawner, TransformSystem, Transform as spawnerTransform } from '../../packages/prefab/src/index.js';
import { StateMachine } from '../../packages/fsm/src/index.js';
import { RigidBody, sphere, box, capsule, BallJoint, HingeJoint, DistanceJoint } from '../../packages/physics/src/index.js';

/** The colour a thing is drawn with (the page reads it; nothing else cares). */
export const Colour = defineComponent('colour', { r: 'f32', g: 'f32', b: 'f32' });

export const PREFABS = [
  { name: 'thing', components: { transform: {} } },
  { name: 'crate', extends: 'thing', components: { colour: { r: 0.82, g: 0.62, b: 0.35 } }, extras: { body: { shape: { type: 'box', hx: 0.5, hy: 0.3, hz: 0.4 }, mass: 8 } }, params: { mass: 'extras.body.mass' } },
  { name: 'ball', extends: 'thing', components: { colour: { r: 0.35, g: 0.65, b: 0.9 } }, extras: { body: { shape: { type: 'sphere', radius: 0.35 }, mass: 3, restitution: 0.3 } } },
  { name: 'pill', extends: 'thing', components: { colour: { r: 0.8, g: 0.8, b: 0.4 } }, extras: { body: { shape: { type: 'capsule', radius: 0.25, halfHeight: 0.35 }, mass: 4, restitution: 0.5 } } },
  { name: 'cannonball', extends: 'ball', components: { colour: { r: 0.95, g: 0.3, b: 0.25 } }, extras: { body: { shape: { type: 'sphere', radius: 0.4 }, mass: 80, restitution: 0.2, bullet: true } } },
  // a wrecking ball on a chain: seven links hanging from a point, each joined to the one above
  { name: 'chain_link', extends: 'thing', components: { colour: { r: 0.6, g: 0.6, b: 0.65 } }, extras: { body: { shape: { type: 'box', hx: 0.06, hy: 0.28, hz: 0.06 }, mass: 1, canSleep: false } } },
  {
    name: 'wrecking_ball', extends: 'thing',
    children: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ name: `link${i}`, prefab: 'chain_link', local: { y: -0.28 - i * 0.56 }, extras: { joint: { type: 'ball', to: i === 0 ? null : `link${i - 1}`, anchor: [0, 0.28, 0] } } }))
      .concat([{ name: 'ball', prefab: 'thing', local: { y: -0.28 - 7 * 0.56 - 0.62 }, components: { colour: { r: 0.3, g: 0.3, b: 0.35 } }, extras: { body: { shape: { type: 'sphere', radius: 0.7 }, mass: 120, canSleep: false }, joint: { type: 'ball', to: 'link6', anchor: [0, 0.62, 0] } } }]),
  },
  {
    name: 'ragdoll', extends: 'thing',
    extras: { body: { shape: { type: 'box', hx: 0.3, hy: 0.45, hz: 0.18 }, mass: 14, canSleep: false } },
    components: { colour: { r: 0.3, g: 0.55, b: 0.8 } },
    children: [
      { name: 'head', prefab: 'thing', local: { y: 0.75 }, components: { colour: { r: 0.9, g: 0.75, b: 0.6 } }, extras: { body: { shape: { type: 'sphere', radius: 0.2 }, mass: 4, canSleep: false }, joint: { type: 'ball', to: '', anchor: [0, -0.25, 0] } } },
      { name: 'armL', prefab: 'thing', local: { x: -0.55, y: 0.2 }, components: { colour: { r: 0.9, g: 0.75, b: 0.6 } }, extras: { body: { shape: { type: 'capsule', radius: 0.08, halfHeight: 0.2 }, mass: 2.5, canSleep: false }, joint: { type: 'ball', to: '', anchor: [0.2, 0.2, 0] } } },
      { name: 'armR', prefab: 'thing', local: { x: 0.55, y: 0.2 }, components: { colour: { r: 0.9, g: 0.75, b: 0.6 } }, extras: { body: { shape: { type: 'capsule', radius: 0.08, halfHeight: 0.2 }, mass: 2.5, canSleep: false }, joint: { type: 'ball', to: '', anchor: [-0.2, 0.2, 0] } } },
      { name: 'legL', prefab: 'thing', local: { x: -0.15, y: -0.95 }, components: { colour: { r: 0.3, g: 0.55, b: 0.8 } }, extras: { body: { shape: { type: 'capsule', radius: 0.1, halfHeight: 0.3 }, mass: 6, canSleep: false }, joint: { type: 'ball', to: '', anchor: [0, 0.5, 0] } } },
      { name: 'legR', prefab: 'thing', local: { x: 0.15, y: -0.95 }, components: { colour: { r: 0.3, g: 0.55, b: 0.8 } }, extras: { body: { shape: { type: 'capsule', radius: 0.1, halfHeight: 0.3 }, mass: 6, canSleep: false }, joint: { type: 'ball', to: '', anchor: [0, 0.5, 0] } } },
    ],
  },
  { name: 'seesaw_plank', extends: 'thing', components: { colour: { r: 0.7, g: 0.5, b: 0.3 } }, extras: { body: { shape: { type: 'box', hx: 2.5, hy: 0.1, hz: 0.6 }, mass: 20, canSleep: false }, joint: { type: 'hinge', to: null, anchor: [0, 0, 0], axis: [0, 0, 1], limits: [-0.35, 0.35] } } },
  { name: 'hanging_crate', extends: 'thing', components: { colour: { r: 0.5, g: 0.8, b: 0.5 } }, extras: { body: { shape: { type: 'box', hx: 0.4, hy: 0.4, hz: 0.4 }, mass: 6, canSleep: false }, joint: { type: 'spring', to: null, anchor: [0, 3, 0], length: 2.4, frequency: 1.2, damping: 0.1 } } },
  // a sliding door: a kinematic slab raised by a state machine when something comes near its trigger zone
  { name: 'sliding_door', extends: 'thing', components: { colour: { r: 0.45, g: 0.5, b: 0.7 } }, extras: { door: { size: [2, 1.5, 0.25], lift: 3.2, speed: 4, zone: [3, 1.5, 3], closeAfter: 1.5 } } },
];

/** The prefab library on its own (no world needed): what the scene editor lists and previews. */
export function createLibrary() {
  const library = new PrefabLibrary(new ComponentRegistry().add(Colour)).define(PREFABS);
  library.validate();
  return library;
}

/** A world, the library, and a spawner that knows how to make physics bodies, joints and doors. */
export function createPrefabs(physics) {
  const library = createLibrary();
  const registry = library.registry;
  const ecs = new World(4096);
  const spawner = new PrefabSpawner(ecs, library);
  const transforms = new TransformSystem();
  const doors = new Set();
  const shapeOf = (s) => (s.type === 'box' ? box(s.hx, s.hy, s.hz) : s.type === 'sphere' ? sphere(s.radius) : capsule(s.radius, s.halfHeight));

  // a rigid body at the part's place; its colour is the Colour component; it remembers which entity it belongs to
  spawner.extra('body', (cfg, { entity, instance, world, path }) => {
    const t = world.data(spawnerTransform), i = entity & 0xfffff;
    const body = physics.add(new RigidBody({ ...cfg, shape: shapeOf(cfg.shape), x: t.x[i], y: t.y[i], z: t.z[i], rotation: [t.qx[i], t.qy[i], t.qz[i], t.qw[i]], userData: { dynamic: true, entity, color: colourOf(world, entity) } }));
    body.key = `${instance.id}:${path}`; // stable between sessions: a saved physics state finds this body again
    (instance.data.bodies ??= new Map()).set(path, body);
    if (cfg.velocity) body.setVelocity(...cfg.velocity);
    return () => physics.remove(body);
  });

  // a joint between this part's body and another part's (`to`: a path from the root, '' for the root itself, null for the world).
  // `anchor` is the joint's place as an offset from THIS part's centre, as it is spawned (upright).
  spawner.extra('joint', (cfg, { instance, path }) => {
    const me = instance.data.bodies.get(path), other = cfg.to === null ? null : instance.data.bodies.get(cfg.to);
    if (cfg.to !== null && !other) throw new Error(`joint on "${path}": no part "${cfg.to}" (it has ${[...instance.data.bodies.keys()].map((k) => `"${k}"`).join(', ')})`);
    const at = [me.x + cfg.anchor[0], me.y + cfg.anchor[1], me.z + cfg.anchor[2]];
    let joint;
    if (cfg.type === 'ball') joint = new BallJoint(other, me, at);
    else if (cfg.type === 'hinge') joint = new HingeJoint(other, me, at, cfg.axis, { limits: cfg.limits });
    else joint = new DistanceJoint(other, me, at, [me.x, me.y, me.z], { length: cfg.length, frequency: cfg.frequency, damping: cfg.damping });
    joint.key = `${instance.id}:${path}:joint`;
    physics.addJoint(joint);
    return () => physics.removeJoint(joint);
  }, { after: true });

  spawner.extra('door', (cfg, { entity, instance, world }) => {
    const t = world.data(spawnerTransform), i = entity & 0xfffff;
    const slab = physics.add(Object.assign(new RigidBody({ shape: box(cfg.size[0], cfg.size[1], cfg.size[2]), type: 'kinematic', x: t.x[i], y: t.y[i] + cfg.size[1], z: t.z[i], friction: 0.6, userData: { dynamic: true, entity, color: colourOf(world, entity) } }), { key: `${instance.id}:slab` }));
    const zone = physics.add(Object.assign(new RigidBody({ shape: box(cfg.zone[0], cfg.zone[1], cfg.zone[2]), type: 'static', x: t.x[i], y: t.y[i] + cfg.zone[1], z: t.z[i], sensor: true, userData: { dynamic: true } }), { key: `${instance.id}:zone` }));
    const near = new Set();
    const baseY = slab.y;
    // closed -> opening (rises) -> open (waits while anything is near, then a moment longer) -> closing -> closed
    const machine = new StateMachine({
      initial: 'closed',
      states: {
        closed: { on: { near: 'opening' } },
        opening: { update: (c, dt) => { c.lift = Math.min(cfg.lift, c.lift + cfg.speed * dt); }, transitions: [{ to: 'open', when: (c) => c.lift >= cfg.lift }] },
        open: { transitions: [{ to: 'closing', when: (c, m) => near.size === 0 && m.time > cfg.closeAfter }] },
        closing: { update: (c, dt) => { c.lift = Math.max(0, c.lift - cfg.speed * dt); }, on: { near: 'opening' }, transitions: [{ to: 'closed', when: (c) => c.lift <= 0 }] },
      },
    });
    const ctx = { lift: 0 };
    // what a save needs of the door: where its machine is and how far it has lifted (the slab's pose is in the physics state)
    const door = { entity, slab, zone, machine, ctx, near, get state() { return machine.state; }, save: () => ({ machine: machine.save(), lift: ctx.lift }), load: (d) => { machine.load(d.machine); ctx.lift = d.lift; near.clear(); } };
    physics.onTrigger = ((prev) => (sensor, body, entered) => {
      prev?.(sensor, body, entered);
      if (sensor !== zone || body === slab) return; // (the door's own slab is inside its zone)
      if (entered) { near.add(body); machine.send('near', ctx); } else near.delete(body);
    })(physics.onTrigger);
    const tick = (dt) => { machine.update(dt, ctx); physics.moveKinematic(slab, slab.x, baseY + ctx.lift, slab.z, dt); };
    doors.add({ tick });
    instance.data.door = door;
    return () => { physics.remove(slab); physics.remove(zone); for (const d of doors) if (d.tick === tick) doors.delete(d); };
  });

  const colourOf = (world, e) => { const d = world.data(Colour), i = e & 0xfffff; return world.has(e, Colour) ? [d.r[i], d.g[i], d.b[i]] : [0.6, 0.6, 0.7]; };
  return { registry, library, ecs, spawner, transforms, tick(dt) { for (const d of doors) d.tick(dt); transforms.update(ecs); } };
}
