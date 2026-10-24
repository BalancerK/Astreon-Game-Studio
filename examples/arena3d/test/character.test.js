import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter, J } from '../client/character.js';
import { CharacterRig } from '../client/locomotion.js';
import { samplePose } from '../../../packages/render/src/index.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const character = createCharacter();

/** Vertex positions of a skinned mesh after a palette is applied (what the GPU computes). */
function skinned(mesh, palette) {
  const n = mesh.vertexCount, out = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = mesh.vertices[v * 6], y = mesh.vertices[v * 6 + 1], z = mesh.vertices[v * 6 + 2];
    for (let k = 0; k < 4; k++) {
      const w = mesh.skin[v * 8 + 4 + k]; if (w === 0) continue;
      const o = mesh.skin[v * 8 + k] * 16;
      out[v * 3] += w * (palette[o] * x + palette[o + 4] * y + palette[o + 8] * z + palette[o + 12]);
      out[v * 3 + 1] += w * (palette[o + 1] * x + palette[o + 5] * y + palette[o + 9] * z + palette[o + 13]);
      out[v * 3 + 2] += w * (palette[o + 2] * x + palette[o + 6] * y + palette[o + 10] * z + palette[o + 14]);
    }
  }
  return out;
}

test('the character meshes are valid closed surfaces facing outward, about 1.76 m tall, with their feet on y = 0', () => {
  let minY = Infinity, maxY = -Infinity;
  for (const [name, mesh] of Object.entries(character.meshes)) {
    const v = mesh.vertices;
    let wrong = 0, volume = 0;
    for (let i = 0; i < mesh.vertexCount; i++) {
      near(Math.hypot(v[i * 6 + 3], v[i * 6 + 4], v[i * 6 + 5]), 1, 1e-4, `${name} normal ${i}`);
      near(mesh.skin[i * 8 + 4] + mesh.skin[i * 8 + 5] + mesh.skin[i * 8 + 6] + mesh.skin[i * 8 + 7], 1, 1e-5, `${name} weights ${i}`);
      minY = Math.min(minY, v[i * 6 + 1]); maxY = Math.max(maxY, v[i * 6 + 1]);
    }
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
      assert.ok(a < mesh.vertexCount && b < mesh.vertexCount && c < mesh.vertexCount);
      const A = [v[a * 6], v[a * 6 + 1], v[a * 6 + 2]], B = [v[b * 6], v[b * 6 + 1], v[b * 6 + 2]], C = [v[c * 6], v[c * 6 + 1], v[c * 6 + 2]];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
      if (Math.hypot(...n) < 1e-12) continue;
      const vn = [0, 1, 2].map((k) => v[a * 6 + 3 + k] + v[b * 6 + 3 + k] + v[c * 6 + 3 + k]);
      if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] <= 0) wrong++;
    }
    assert.equal(wrong, 0, `${name}: every triangle faces the way its normals say`);
    assert.ok(volume > 0.0004, `${name}: encloses a positive volume (${volume})`);
  }
  near(minY, 0, 0.002, 'soles on the floor');
  near(maxY, character.height, 0.02, 'height');
});

test('in the bind pose the palette is the identity, so the model is exactly the mesh', () => {
  const sk = character.skeleton;
  const palette = sk.computePalette(sk.createPose().setRest(sk));
  for (let j = 0; j < sk.count; j++) for (let k = 0; k < 16; k++) near(palette[j * 16 + k], k % 5 === 0 ? 1 : 0, 1e-5);
});

test('walking: the stride opens and closes, feet are planted on the floor and nothing sinks through it', () => {
  const rig = new CharacterRig(character);
  const sk = character.skeleton;
  let leftFront = 0, rightFront = 0, worstSink = 0;
  for (const clip of ['walk', 'run']) {
    for (let k = 0; k < 24; k++) {
      const phase = k / 24;
      samplePose(sk, character.clips[clip], phase, rig.pose);
      sk.computePalette(rig.pose, rig.palette);
      const lz = sk.jointWorld(J.FOOT_L)[14], rz = sk.jointWorld(J.FOOT_R)[14];
      if (clip === 'walk' && k === 6) { leftFront = lz; rightFront = rz; }
    }
  }
  assert.ok(leftFront < rightFront - 0.2, `a quarter into the walk the left foot is well ahead (z ${leftFront.toFixed(2)} vs ${rightFront.toFixed(2)}; forward is -z)`);

  // through the rig, which also plants the feet: move at walking and running speed and check the skinned vertices
  for (const speed of [4.5, 7.5]) {
    const r = new CharacterRig(character);
    let z = 0;
    for (let f = 0; f < 90; f++) {
      z -= speed / 60;
      const palette = r.update(1 / 60, 0, z, 0, 0, true);
      if (f < 30) continue;
      for (const mesh of Object.values(character.meshes)) {
        const p = skinned(mesh, palette);
        for (let i = 1; i < p.length; i += 3) worstSink = Math.min(worstSink, p[i]);
      }
    }
  }
  assert.ok(worstSink > -0.03, `no vertex sinks more than 3 cm below the floor (${worstSink.toFixed(3)})`);
});

test('the rig measures speed, cycles the legs at a sensible rate, and reverses them when moving backwards', () => {
  const rig = new CharacterRig(character);
  let z = 0, cycles = 0, last = rig.phase;
  for (let f = 0; f < 120; f++) { // 2 s forwards at 4.5 m/s
    z -= 4.5 / 60;
    rig.update(1 / 60, 0, z, 0, 0, true);
    if (f >= 60) { let d = rig.phase - last; if (d < -0.5) d += 1; if (d > 0.5) d -= 1; cycles += d; }
    last = rig.phase;
  }
  near(rig.speed, 4.5, 0.15, 'measured speed');
  near(cycles, 4.5 / 3.0, 0.15, 'one second of walking at 4.5 m/s is 1.5 leg cycles');
  near(rig.legTurn, 0, 0.05, 'legs straight ahead');

  const back = new CharacterRig(character);
  z = 0; last = back.phase; let delta = 0;
  for (let f = 0; f < 120; f++) {
    z += 4.5 / 60; // facing -z (yaw 0) but moving toward +z: backing up
    back.update(1 / 60, 0, z, 0, 0, true);
    if (f >= 60) { let d = back.phase - last; if (d < -0.5) d += 1; if (d > 0.5) d -= 1; delta += d; }
    last = back.phase;
  }
  assert.ok(delta < -1, `the cycle runs backwards (${delta.toFixed(2)} cycles)`);
  near(back.legTurn, 0, 0.1, 'backing up: legs fold back to straight, not turned half way round');

  const diag = new CharacterRig(character);
  let x = 0; z = 0;
  for (let f = 0; f < 120; f++) { x += 3 / 60; z -= 3 / 60; diag.update(1 / 60, x, z, 0, 0, true); }
  near(diag.legTurn, -Math.PI / 4, 0.1, 'running forward-right turns the legs 45 degrees to the right (yaw is positive to the left)');
});

test('standing still plays the idle clip; being off the ground blends to the airborne pose; a respawn does not look like a sprint', () => {
  const rig = new CharacterRig(character);
  for (let f = 0; f < 120; f++) rig.update(1 / 60, 3, 3, 0, 0, true);
  near(rig.speed, 0, 1e-6);
  const idlePose = character.skeleton.createPose();
  samplePose(character.skeleton, character.clips.idle, rig.idleTime, idlePose);
  for (let k = 0; k < 4; k++) near(rig.pose.r[J.THIGH_L * 4 + k], idlePose.r[J.THIGH_L * 4 + k], 1e-5, 'legs at idle');
  assert.equal(rig.phase, 0, 'legs do not cycle while standing');

  for (let f = 0; f < 60; f++) rig.update(1 / 60, 3, 3, 0, 0, false);
  assert.ok(rig.air > 0.99, `fully airborne after a second (${rig.air})`);
  assert.ok(rig.pose.r[J.THIGH_L * 4] > 0.25, 'left thigh swung forward in the air pose');
  for (let f = 0; f < 60; f++) rig.update(1 / 60, 3, 3, 0, 0, true);
  assert.ok(rig.air < 0.01, 'and back on the ground');

  rig.update(1 / 60, 40, 40, 0, 0, true); // a respawn across the map
  near(rig.speed, 0, 1e-6, 'no speed from a teleport');
});

test('the head follows the pitch of the look direction', () => {
  const rig = new CharacterRig(character);
  rig.update(1 / 60, 0, 0, 0, 0, true);
  const flat = rig.pose.r[J.HEAD * 4];
  rig.update(1 / 60, 0, 0, 0, 0.8, true);
  assert.ok(rig.pose.r[J.HEAD * 4] > flat + 0.1, 'looking up tilts the head up (positive turn about x)');
  rig.update(1 / 60, 0, 0, 0, -0.8, true);
  assert.ok(rig.pose.r[J.HEAD * 4] < flat - 0.1, 'looking down tilts it down');
});
