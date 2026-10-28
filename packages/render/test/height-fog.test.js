import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLighting, Camera3D } from '../src/index.js';
import { writeSceneUniforms, SCENE_UNIFORM_FLOATS } from '../src/webgpu3d.js';

test('height fog goes to the spare floats of the scene block, and is off by default', () => {
  const cam = new Camera3D({}); cam.x = 1; cam.y = 7; cam.z = 3; cam.update();
  const off = new Float32Array(SCENE_UNIFORM_FLOATS);
  writeSceneUniforms(off, cam, {});
  assert.equal(off[27], 0, 'no height fog unless asked for');
  assert.equal(createLighting().fogHeightDensity, 0);
  const on = new Float32Array(SCENE_UNIFORM_FLOATS);
  writeSceneUniforms(on, cam, { fogHeightDensity: 0.004, fogHeightFalloff: 0.03, fogHeightBase: 12 });
  assert.ok(Math.abs(on[27] - 0.004) < 1e-7 && Math.abs(on[31] - 0.03) < 1e-7 && on[39] === 12);
  assert.equal(on[36], 1, 'the camera position next to it is unchanged');
});
