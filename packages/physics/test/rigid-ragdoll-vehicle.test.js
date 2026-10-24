import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, RigidBody, box, sphere, BallJoint, ConeJoint, HingeJoint, Ragdoll, humanoidRagdollSpec, RaycastVehicle } from '../src/index.js';
import { TriWorld } from '../src/tri-world.js';

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} is not within ${eps} of ${b}`);
const run = (w, seconds, each = null, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) { each?.(i); w.step(dt); } };
const ground = () => { const t = new TriWorld(); t.addBox(0, -1, 0, 80, 1, 80); t.build(); return t; };

// ------------------------------------------------------------------ the cone joint

test('a cone joint stops a swinging body at its swing limit, where a plain ball joint lets it swing right over', () => {
  const swing = (limit) => {
    const w = new PhysicsWorld({ substeps: 4, iterations: 12 });
    const b = w.add(new RigidBody({ shape: box(0.03, 0.5, 0.03), x: 0, y: -0.5, z: 0, mass: 1, linearDamping: 0, angularDamping: 0, canSleep: false }));   // a rod hanging from the joint: its orientation is what the cone limits
    const j = w.addJoint(limit ? new ConeJoint(null, b, [0, 0, 0], [0, -1, 0], limit) : new BallJoint(null, b, [0, 0, 0]));
    b.setVelocity(4, 0, 0);
    let worst = 0;
    run(w, 3, () => { const a = Math.atan2(Math.hypot(b.x, b.z), -b.y); worst = Math.max(worst, a); });
    return { worst, j };
  };
  const free = swing(0), capped = swing(0.5);
  assert.ok(free.worst > 1.2, `a ball joint swings high: ${free.worst}`);
  assert.ok(capped.worst > 0.4 && capped.worst < 0.56, `the cone holds it at 0.5: ${capped.worst}`);
  assert.ok(capped.j.swing <= 0.56);
});

test('a cone joint keeps the shared point together, and its impulses survive a save and restore exactly', () => {
  const build = () => {
    const w = new PhysicsWorld({ substeps: 2, iterations: 10 });
    const a = w.add(new RigidBody({ shape: box(0.1, 0.4, 0.1), x: 0, y: 3, z: 0, mass: 3, canSleep: false })), b = w.add(new RigidBody({ shape: box(0.1, 0.4, 0.1), x: 0.3, y: 2.2, z: 0, mass: 2, canSleep: false }));
    a.key = 'a'; b.key = 'b';
    const j = w.addJoint(new ConeJoint(a, b, [0, 2.6, 0], [0, -1, 0], 0.4)); j.key = 'cone';
    w.addJoint(Object.assign(new BallJoint(null, a, [0, 3.4, 0]), { key: 'top' }));
    return { w, a, b, j };
  };
  const one = build(); run(one.w, 1.2);
  const saved = JSON.parse(JSON.stringify(one.w.getState()));
  run(one.w, 1);
  const two = build(); two.w.setState(saved); run(two.w, 1);
  for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'wx']) assert.equal(two.b[k], one.b[k], `body b ${k} bit for bit`);
  const pa = one.a.toWorld(...one.j.la), pb = one.b.toWorld(...one.j.lb);
  near(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]), 0, 0.02, 'the joint point');
});

test('the world can be told that two bodies pass through each other, and told again that they do not', () => {
  const w = new PhysicsWorld(), a = w.add(new RigidBody({ shape: sphere(0.5), x: 0, y: 0, z: 0, gravityScale: 0 })), b = w.add(new RigidBody({ shape: sphere(0.5), x: 0.3, y: 0, z: 0, gravityScale: 0 }));
  w.ignoreCollision(a, b); run(w, 0.5);
  near(b.x - a.x, 0.3, 1e-9, 'untouched while ignored');
  w.allowCollision(a, b); run(w, 0.5);
  assert.ok(b.x - a.x > 0.6, `pushed apart once they may collide: ${b.x - a.x}`);
});

// ------------------------------------------------------------------ ragdolls

const dropRagdoll = (o = {}) => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 4, iterations: 16 });
  const rag = new Ragdoll(humanoidRagdollSpec({ height: 1.8, mass: 75 }), { x: 0, y: 1, z: 0, yaw: 0.5, ...o }).addTo(w);
  return { w, rag };
};

test('the humanoid description has 13 named bones, a mass of 75 kg and joints that match what bodies can do', () => {
  const spec = humanoidRagdollSpec({ height: 1.8, mass: 75 });
  assert.equal(spec.bones.length, 13);
  assert.deepEqual(spec.bones.map((b) => b.name), ['hips', 'spine.1', 'head', 'upperarm.l', 'lowerarm.l', 'upperarm.r', 'lowerarm.r', 'upleg.l', 'lowleg.l', 'foot.l', 'upleg.r', 'lowleg.r', 'foot.r']);
  near(spec.bones.reduce((s, b) => s + b.mass, 0), 75, 3);
  const feet = spec.bones.filter((b) => b.name.startsWith('foot')); for (const f of feet) near(Math.min(f.from[1], f.to[1]) - f.radius, 0.05 * 1.8 - 0.03 * 1.8 + 0.0 - 0.0, 0.1);
  assert.equal(spec.bones.find((b) => b.name === 'lowerarm.l').joint.type, 'hinge'); assert.equal(spec.bones.find((b) => b.name === 'upperarm.l').joint.type, 'cone');
  const tall = humanoidRagdollSpec({ height: 2.2 }); near(tall.bones[2].to[1], 0.94 * 2.2, 1e-9);
});

test('a ragdoll built from it starts in its rest pose, and the bodies know where they are in model space', () => {
  const rag = new Ragdoll(humanoidRagdollSpec(), { x: 3, y: 0, z: -2, yaw: 1.0 });
  assert.equal(rag.bodies.length, 13); assert.equal(rag.joints.length, 12);
  near(rag.mass, 75, 3);
  for (let i = 0; i < rag.count; i++) {
    const d = rag.modelRotationDelta(i); near(d[3], 1, 1e-9, `bone ${i} has not turned`);
    const p = rag.modelPosition(i), c = rag.spec.bones[i]; for (let k = 0; k < 3; k++) near(p[k], (c.from[k] + c.to[k]) / 2, 1e-9);
  }
  const hips = rag.body('hips'); const world = rag.toWorld(rag.modelPosition(0)); near(hips.x, world[0], 1e-9); near(hips.z, world[2], 1e-9);
  assert.equal(rag.body('nothing'), undefined);
});

test('setBone puts a body where an animated pose has it, and reads back the same', () => {
  const rag = new Ragdoll(humanoidRagdollSpec(), { x: 1, y: 0, z: 1, yaw: -0.7 });
  const half = Math.sin(0.4), delta = [0, 0, half, Math.cos(0.4)], from = [0.2, 1.3, 0.1];
  const arm = rag.names.indexOf('upperarm.l');
  rag.setBone(arm, delta, from);
  const d = rag.modelRotationDelta(arm); for (let k = 0; k < 4; k++) near(d[k], delta[k], 1e-9);
  const j = rag.modelJointPosition(arm); for (let k = 0; k < 3; k++) near(j[k], from[k], 1e-9);
});

test('a ragdoll dropped on a floor collapses and comes to rest on it, with every joint holding', () => {
  const { w, rag } = dropRagdoll();
  let worstGap = 0, worstSwing = 0, maxHingeLow = 0, below = 0;
  const step = () => {
    for (const j of rag.joints) {
      const a = j.a.toWorld(j.la[0], j.la[1], j.la[2], [0, 0, 0]), b = j.b.toWorld(j.lb[0], j.lb[1], j.lb[2], [0, 0, 0]);
      worstGap = Math.max(worstGap, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      if (j instanceof ConeJoint) worstSwing = Math.max(worstSwing, j.swing - j.maxSwing);
      if (j instanceof HingeJoint) maxHingeLow = Math.min(maxHingeLow, j.hingeAngle - j.limits[0], j.limits[1] - j.hingeAngle);
    }
    for (const b of rag.bodies) below = Math.min(below, b.minY);
  };
  run(w, 5, step);
  for (const b of rag.bodies) for (const k of ['x', 'y', 'z', 'qx', 'qw']) assert.ok(Number.isFinite(b[k]), `${k} is finite`);
  assert.ok(worstGap < 0.05, `joints hold together: gap ${worstGap}`);
  assert.ok(worstSwing < 0.25, `swing limits hold: over by ${worstSwing}`);
  assert.ok(maxHingeLow > -0.15, `elbows and knees do not bend the wrong way: ${maxHingeLow}`);
  assert.ok(below > -0.05, `nothing goes through the floor: ${below}`);
  const hips = rag.body('hips'); assert.ok(hips.y < 0.5, `it has fallen down: hips at ${hips.y}`);
  assert.ok(rag.bodies.every((b) => Math.hypot(b.vx, b.vy, b.vz) < 0.3), 'it has stopped moving');
  const com = rag.centerOfMass(); assert.ok(com[1] < 0.5 && com[1] > 0.03, `centre of mass ${com[1]}`);
});

test('a ragdoll is deterministic, and a shove makes it fall differently', () => {
  const trace = (shove) => {
    const { w, rag } = dropRagdoll();
    if (shove) rag.applyImpulse('head', 60, 0, 0);
    run(w, 2);
    return rag.bodies.map((b) => [b.x, b.y, b.z, b.qx, b.qy, b.qz, b.qw].join()).join('|');
  };
  assert.equal(trace(false), trace(false), 'same run, same bits');
  assert.notEqual(trace(false), trace(true));
});

test('a ragdoll can be taken out of the world again, and may collide with itself when asked', () => {
  const { w, rag } = dropRagdoll();
  rag.removeFrom(w);
  assert.equal(w.bodies.length, 0); assert.equal(w.joints.length, 0);
  const sw = new PhysicsWorld({ terrain: ground() });
  new Ragdoll(humanoidRagdollSpec(), { x: 0, y: 0, z: 0, selfCollision: true }).addTo(sw);
  assert.equal(sw.ignored.size, 0);
  const own = new PhysicsWorld({ terrain: ground() });
  new Ragdoll(humanoidRagdollSpec(), { x: 0, y: 0, z: 0 }).addTo(own);
  assert.equal(own.ignored.size, 13 * 12 / 2);
});

// ------------------------------------------------------------------ the raycast vehicle

const makeCar = (o = {}) => {
  const w = new PhysicsWorld({ terrain: ground(), substeps: 2, iterations: 8 });
  const chassis = w.add(new RigidBody({ shape: box(0.9, 0.25, 2.0), x: 0, y: o.y ?? 0.7, z: 0, mass: 1200, linearDamping: 0, angularDamping: 0.05, canSleep: false }));
  const wheel = (x, z, front) => ({ x, y: -0.1, z, radius: 0.35, suspensionLength: 0.3, friction: o.friction ?? 0.8, steer: front ? 1 : 0, drive: 1, brake: 1, handbrake: !front });
  const car = new RaycastVehicle(w, chassis, { wheels: [wheel(0.8, 1.3, true), wheel(-0.8, 1.3, true), wheel(0.8, -1.3, false), wheel(-0.8, -1.3, false)], antiRoll: o.antiRoll ?? [] });
  const drive = (seconds, each) => run(w, seconds, (i) => { each?.(i); car.update(1 / 60); });
  return { w, chassis, car, drive };
};
const yawOf = (c) => { const r = c.r; return Math.atan2(r[2], r[8]); };   // forward (0, 0, 1) in the world: x = r[2], z = r[8]

test('a car settles on its springs at the height the spring constants predict, with its weight shared by the wheels', () => {
  const { chassis, car, drive } = makeCar();
  drive(3);
  assert.equal(car.wheelsOnGround, 4);
  assert.ok(Math.hypot(chassis.vx, chassis.vy, chassis.vz) < 0.05, 'at rest');
  near(chassis.y, 0.675, 0.04, 'ride height'); // 0.35 + (0.3 - 0.075) - 0.1 + ... the springs sag by a quarter of their length
  const load = car.wheels.reduce((s, w) => s + w.load, 0);
  near(load, 1200 * 9.81, 1200 * 9.81 * 0.06, 'the springs carry the weight');
  for (const wh of car.wheels) near(wh.load, 1200 * 9.81 / 4, 1200 * 9.81 / 4 * 0.12, 'each wheel carries about a quarter');
});

test('engine force accelerates the car, rolling resistance slows it a little, brakes stop it in the distance their force allows', () => {
  const { chassis, car, drive } = makeCar();
  drive(2);
  car.engineForce = 4000;
  drive(3);
  const v = car.speed;
  assert.ok(v > 8 && v < 10.6, `a = (4000 - rolling) / 1200 for 3 s: speed ${v}`);
  car.engineForce = 0;
  const z0 = chassis.z; car.brake = 8000;
  drive(2.5);
  assert.ok(Math.abs(car.speed) < 0.3, `stopped: ${car.speed}`);
  const dist = chassis.z - z0; assert.ok(dist > 4 && dist < 11, `braking distance ${dist}`);
  car.brake = 0; drive(1); assert.ok(Math.abs(car.speed) < 0.3, 'and stays stopped');
  car.engineForce = -2000; drive(2); assert.ok(car.speed < -1.5, `reverses: ${car.speed}`);
});

test('steering turns the car about as the geometry says (a wheelbase of 2.6 m and 0.3 rad gives a turn radius near 8.4 m), toward the right', () => {
  const { chassis, car, drive } = makeCar();
  drive(2);
  chassis.setVelocity(0, 0, 8);
  const yaw0 = yawOf(chassis);
  car.steering = 0.3;
  drive(2);
  const turned = yawOf(chassis) - yaw0;
  assert.ok(turned < -1.3 && turned > -2.5, `turned ${turned} rad in 2 s at about 8 m/s (the circle predicts -1.9)`);
  assert.ok(chassis.x < -2, `and toward the right-hand side (-x when facing +z): x ${chassis.x}`);
  assert.equal(car.wheelsOnGround, 4, 'all wheels stay down in the turn');
  assert.ok(car.wheels[0].steerAngle === 0.3 && car.wheels[2].steerAngle === 0, 'only the front wheels steer');
});

test('the tyres grip sideways: a sliding car stops sliding, and with less grip it slides further', () => {
  const slide = (friction) => {
    const { chassis, car, drive } = makeCar({ friction });
    drive(2);
    chassis.setVelocity(4, 0, 0);
    drive(0.5);
    return { vx: chassis.vx, tip: chassis.r[4] };
  };
  const grippy = slide(0.8), icy = slide(0.1);
  assert.ok(Math.abs(grippy.vx) < 1.2, `grippy: ${grippy.vx}`);
  assert.ok(Math.abs(icy.vx) > 2.5, `icy: ${icy.vx}`);
  assert.ok(grippy.tip > 0.8, 'and it did not roll over');
});

test('in the air no wheel touches anything, and the car lands on its wheels', () => {
  const { chassis, car, drive } = makeCar({ y: 4 });
  drive(0.05);
  assert.equal(car.wheelsOnGround, 0);
  drive(3);
  assert.equal(car.wheelsOnGround, 4);
  assert.ok(chassis.y < 1 && chassis.y > 0.5, `landed at ${chassis.y}`);
});

test('the hand brake locks only the back wheels, and an anti-roll bar spreads load between the two sides', () => {
  const a = makeCar(); a.drive(2); a.chassis.setVelocity(0, 0, 10); a.car.handbrake = 6000; a.drive(1.5);
  assert.ok(a.car.speed < 6.5 && a.car.speed > 1, `the rear brakes alone slow it a lot but cannot stop it as fast as all four: ${a.car.speed}`);
  const stiff = makeCar({ antiRoll: [[0, 1, 20000], [2, 3, 20000]] }); stiff.drive(2);
  stiff.chassis.setVelocity(0, 0, 8); stiff.car.steering = 0.2; stiff.drive(1.5);
  const loose = makeCar(); loose.drive(2); loose.chassis.setVelocity(0, 0, 8); loose.car.steering = 0.2; loose.drive(1.5);
  const roll = (c) => Math.abs(c.chassis.r[7]);                         // the sideways lean (up vector's z component... the tilt about the forward axis)
  const lean = (c) => Math.abs(c.car.wheels[0].compression - c.car.wheels[1].compression);
  assert.ok(lean(stiff) < lean(loose), `the bar reduces the difference between sides: ${lean(stiff)} vs ${lean(loose)}`);
  void roll;
});

test('wheelMatrix is a rigid transform at the wheel, turned by steering, with the spring and spin in it', () => {
  const { car, drive } = makeCar();
  drive(2); car.steering = 0.4; car.engineForce = 3000; drive(1);
  const m = car.wheelMatrix(0);
  const len = (o) => Math.hypot(m[o], m[o + 1], m[o + 2]), dot = (a, b) => m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2];
  for (const o of [0, 4, 8]) near(len(o), 1, 1e-6); near(dot(0, 4), 0, 1e-6); near(dot(0, 8), 0, 1e-6); near(dot(4, 8), 0, 1e-6);
  near(m[12], car.chassis.toWorld(0.8, -0.1, 1.3)[0], 0.2, 'near the fixing, x');
  assert.ok(m[13] < car.chassis.y && m[13] > 0.2, `the wheel hangs below the chassis: ${m[13]}`);
  assert.ok(Math.abs(m[2]) > 0.2, 'the axle is turned by the steering');
  const rest = car.wheelMatrix(2); assert.ok(Math.abs(rest[2]) < 0.2, 'the rear axle is not');
  assert.ok(car.wheels[0].spin > 2, 'the wheel has spun');
});

test('a vehicle is deterministic', () => {
  const trace = () => { const { chassis, car, drive } = makeCar(); car.engineForce = 3000; drive(1); car.steering = 0.2; drive(2); return [chassis.x, chassis.y, chassis.z, chassis.qx, chassis.qy, chassis.qz, chassis.qw, ...car.wheels.map((w) => w.spin)].join(); };
  assert.equal(trace(), trace());
  assert.throws(() => new RaycastVehicle(new PhysicsWorld(), new RigidBody({ shape: box(1, 1, 1) }), { wheels: [] }), /at least one wheel/);
});
