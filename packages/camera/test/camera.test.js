import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKick, kick, stepKick, MAX_ANGLE, MAX_DIP, createFollowRig, stepFollowRig, traumaShake, rushFov, createHitStop } from '../src/index.js';

const run = (k, seconds, dt = 1 / 60) => { const trace = []; for (let t = 0; t < seconds; t += dt) { stepKick(k, dt); trace.push(k.pitch); } return trace; };

test('a kick swings the view, overshoots once and settles within about half a second', () => {
  const k = createKick(); kick(k, { pitch: 1.2 });
  const trace = run(k, 1.5);
  assert.ok(Math.max(...trace) > 0.02, 'it moves');
  const first = Math.max(...trace), over = trace.findIndex((v) => v < 0), back = Math.max(...trace.slice(over).map(Math.abs));
  assert.ok(over > 0 && back > 0 && back < first * 0.25, `it swings back past rest, by much less than it went (${back} against ${first})`);
  assert.ok(Math.abs(k.pitch) < 0.002 && Math.abs(k.pitchV) < 0.02, 'it is at rest after a second and a half');
  assert.ok(Math.max(...trace.slice(0, 30).map(Math.abs)) <= MAX_ANGLE + 1e-9);
});

test('a kick never swings further than the limits, a long frame does not make it unstable, and every part kicks on its own', () => {
  const k = createKick(); kick(k, { pitch: 50, yaw: -50, roll: 50, dip: 500 });
  stepKick(k, 1 / 60);
  assert.ok(Math.abs(k.pitch) <= MAX_ANGLE && Math.abs(k.yaw) <= MAX_ANGLE && Math.abs(k.roll) <= MAX_ANGLE && Math.abs(k.dip) <= MAX_DIP);
  stepKick(k, 5);                                                                       // a stalled page: slices, and no more than 0.1 s of it
  assert.ok(Number.isFinite(k.pitch) && Number.isFinite(k.dip));
  const j = createKick(); kick(j, { yaw: 3 }); stepKick(j, 1 / 60);
  assert.ok(j.yaw !== 0 && j.pitch === 0 && j.roll === 0 && j.dip === 0);
  const stiff = createKick({ stiffness: 400, damping: 40, maxAngle: 0.5 }); kick(stiff, { pitch: 100 }); stepKick(stiff, 1 / 60);
  assert.ok(Math.abs(stiff.pitch) > MAX_ANGLE, 'another spring has its own limits');
});

const clear = { pivot: [0, 5, 0], yaw: 0, pitch: 0, distance: 12, dt: 1 / 60 };

test('the follow camera sits the wanted distance from the pivot along the orbit direction, once it has eased out to it', () => {
  const rig = createFollowRig();
  let p; for (let i = 0; i < 300; i++) p = stepFollowRig(rig, clear);
  assert.ok(Math.abs(p.z - 12) < 0.01 && Math.abs(p.x) < 1e-9 && Math.abs(p.y - 5) < 1e-9, JSON.stringify(p));
  const up = createFollowRig(); for (let i = 0; i < 300; i++) p = stepFollowRig(up, { ...clear, pitch: 0.5 });
  assert.ok(Math.abs(p.y - (5 + 12 * Math.sin(0.5))) < 0.01 && Math.abs(p.z - 12 * Math.cos(0.5)) < 0.01, 'a higher orbit puts the camera higher and nearer in');
});

test('a wall pulls the camera in at once-ish and it eases back out slowly; it never gets closer than the minimum, nor stays in the wall', () => {
  const rig = createFollowRig({ minDistance: 2, margin: 1.5 });
  for (let i = 0; i < 300; i++) stepFollowRig(rig, clear);
  const wall = (from, to) => 0.5;                                                       // a wall half way along the 12 m
  const seen = [];
  for (let i = 0; i < 30; i++) seen.push(stepFollowRig(rig, { ...clear, blocked: wall }).distance);
  assert.ok(seen.at(-1) <= 12 * 0.5 - 1.5 + 1e-9, `pulled in to the room there is (${seen.at(-1)})`);
  assert.ok(seen.every((d, i) => i === 0 || d <= seen[i - 1] + 1e-9), 'it only comes in while blocked');
  const out = []; for (let i = 0; i < 20; i++) out.push(stepFollowRig(rig, clear).distance);
  assert.ok(out[0] < 6 && out.at(-1) > out[0], 'it eases out');
  const tight = createFollowRig({ minDistance: 2 }); for (let i = 0; i < 100; i++) tight.distance = stepFollowRig(tight, { ...clear, blocked: () => 0.01 }).distance;
  assert.equal(Math.round(tight.distance * 1000) / 1000, 2, 'not closer than the minimum');
});

test('the shoulder: it moves to the other side smoothly, by the reach, perpendicular to the look direction', () => {
  const rig = createFollowRig();
  let p; for (let i = 0; i < 300; i++) p = stepFollowRig(rig, { ...clear, side: 1, reach: 5 });
  assert.ok(Math.abs(p.x - 5) < 0.01, `to the right: ${p.x}`);
  const mid = stepFollowRig(rig, { ...clear, side: -1, reach: 5 });
  assert.ok(mid.x < 5 && mid.x > -5, 'on its way');
  for (let i = 0; i < 300; i++) p = stepFollowRig(rig, { ...clear, side: -1, reach: 5 });
  assert.ok(Math.abs(p.x + 5) < 0.01);
  const turned = createFollowRig(); turned.sideNow = 1; let q = stepFollowRig(turned, { ...clear, yaw: Math.PI / 2, side: 1, reach: 5 });
  assert.ok(Math.abs(q.z + 5) < 0.2 && q.x > 0, 'with the camera out along +x the right shoulder is toward -z');
  const straight = createFollowRig(); for (let i = 0; i < 300; i++) p = stepFollowRig(straight, { ...clear, side: 1, reach: 0 });
  assert.ok(Math.abs(p.x) < 1e-9, 'no reach, straight behind');
});

test('the camera stays above the ground', () => {
  const rig = createFollowRig({ clearance: 1.5 });
  let p; for (let i = 0; i < 300; i++) p = stepFollowRig(rig, { ...clear, pitch: -0.6, ground: () => 20 });
  assert.ok(p.y >= 21.5 - 1e-9, `${p.y}`);
});

test('shake: nothing at no trauma, a tremor at a little, a lot at full, bounded, and scaled by what the player allows', () => {
  assert.deepEqual(traumaShake(0, 3.3), { x: 0, y: 0, z: 0, roll: 0 });
  const peak = (t, s = 1) => { let m = 0; for (let c = 0; c < 20; c += 0.013) { const r = traumaShake(t, c, s); m = Math.max(m, Math.abs(r.x), Math.abs(r.y), Math.abs(r.z)); } return m; };
  assert.ok(peak(0.2) < 0.12 && peak(1) > 2 && peak(1) <= 2.2 + 1e-9, `${peak(0.2)} ${peak(1)}`);
  assert.equal(peak(1, 0), 0); assert.ok(Math.abs(peak(1, 0.5) - peak(1) / 2) < 1e-9);
  assert.ok(traumaShake(7, 1).x === traumaShake(1, 1).x, 'trauma above 1 counts as 1');
  assert.ok(Math.abs(traumaShake(1, 2.2).roll) <= 0.03);
});

test('a wider view at speed: none up to 1.2 times top speed, the most at 3.4 times, and in between in proportion', () => {
  assert.equal(rushFov(0, 100), 1); assert.equal(rushFov(120, 100), 1);
  assert.ok(Math.abs(rushFov(340, 100) - 1.32) < 1e-9); assert.ok(Math.abs(rushFov(1000, 100) - 1.32) < 1e-9);
  assert.ok(Math.abs(rushFov(230, 100) - 1.16) < 1e-9);
  assert.ok(Math.abs(rushFov(300, 100, { widen: 0.5, from: 1, over: 2 }) - 1.5) < 1e-9);
  assert.equal(rushFov(5, 0) > 1, true, 'no top speed is not a crash');
});

test('hit-stop: a freeze skips that many ticks and keeps the longest, the punch keeps the biggest and fades, and reset stops both', () => {
  const h = createHitStop();
  h.freeze(3); h.freeze(2); assert.equal(h.frozen, true);
  assert.deepEqual([h.skip(), h.skip(), h.skip(), h.skip()], [true, true, true, false]);
  assert.equal(h.frozen, false);
  h.punch(0.1); h.punch(0.05); assert.equal(h.amount, 0.1);
  h.fade(0.1); assert.ok(Math.abs(h.amount - 0.05) < 1e-9);
  h.fade(10); assert.equal(h.amount, 0);
  h.freeze(5); h.punch(1); h.reset(); assert.equal(h.skip(), false); assert.equal(h.amount, 0);
  const fast = createHitStop({ decay: 2 }); fast.punch(1); fast.fade(0.25); assert.equal(fast.amount, 0.5);
});

test('the follow camera does exactly what the game it came from did (the same arithmetic written out, over a long run with moving pivots, walls and a changing shoulder)', () => {
  const rig = createFollowRig();
  let distance = 4, shoulder = 1, seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const blocked = (from, to) => { const mid = (from[0] + to[0]) * 0.5 + (from[2] + to[2]) * 0.5; return Math.sin(mid * 0.7) > 0.5 ? 0.2 + 0.5 * Math.abs(Math.cos(mid)) : null; };
  const ground = (x, z) => 3 + Math.sin(x * 0.05) * 2 + Math.cos(z * 0.04) * 2;
  for (let frame = 0; frame < 2000; frame++) {
    const dt = 1 / 60 + rnd() * 0.01, yaw = Math.sin(frame * 0.013) * 3, pitch = Math.sin(frame * 0.007) * 0.8, scale = 1.5 + rnd(), pivot = [rnd() * 400, 5 + rnd() * 20, rnd() * 400];
    const wantD = 3 + rnd() * 30, sideWant = Math.sign(Math.sin(frame * 0.003)) || 1, blend = Math.max(0, Math.min(1, rnd() * 1.3 - 0.15)), reach = (4.2 + 1.3 * scale) * blend;
    // the original, written out
    const cp = Math.cos(pitch), dir = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    shoulder += (sideWant - shoulder) * Math.min(1, 9 * dt);
    const side = shoulder * reach, target = [pivot[0] + Math.cos(yaw) * side, pivot[1], pivot[2] - Math.sin(yaw) * side];
    const hit = blocked(target, [target[0] + dir[0] * wantD, target[1] + dir[1] * wantD, target[2] + dir[2] * wantD]);
    const room = hit === null ? wantD : Math.max(2, hit * wantD - 1.5);
    distance += (room - distance) * Math.min(1, (room < distance ? 18 : 6) * dt);
    const dist = Math.min(distance, room), x = target[0] + dir[0] * dist, z = target[2] + dir[2] * dist, y = Math.max(ground(x, z) + 1.5, target[1] + dir[1] * dist);
    const p = stepFollowRig(rig, { pivot, yaw, pitch, distance: wantD, side: sideWant, reach, dt, blocked, ground });
    assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9 && Math.abs(p.z - z) < 1e-9, `frame ${frame}`);
  }
});
