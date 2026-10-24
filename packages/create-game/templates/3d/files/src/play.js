// Running a scene: make a world, put the scene's things in it, and update and draw them. The page and the editor's Play button both use this.
import { World } from '@engine/core';
import { mat4 } from '@engine/math';
import { PrefabSpawner, Transform, TransformSystem } from '@engine/prefab';
import { LoadedScene, spawnEntities, normalizeScene } from '@engine/scene';
import { createLibrary, Colour, Shape, Spin } from './prefabs.js';

/** @param {object} sceneJson A scene file (scenes/main.json). */
export function createPlay(sceneJson) {
  const library = createLibrary();
  const world = new World(4096);
  const spawner = new PrefabSpawner(world, library);
  const scene = normalizeScene(sceneJson);
  scene.prefabs.forEach((p) => library.define(p));            // prefabs only this scene uses
  const loaded = new LoadedScene(spawner, scene.name, scene.settings);
  spawnEntities(scene, spawner, loaded);

  const transforms = new TransformSystem();
  const ids = new Uint32Array(4096), model = new Float64Array(16), q = [0, 0, 0, 1];

  /** One tick of game logic: every thing with a Spin turns about the vertical axis. */
  function step(dt) {
    const n = world.query(ids, [Transform, Spin]);
    const t = world.data(Transform), s = world.data(Spin);
    for (let k = 0; k < n; k++) {
      const i = ids[k] & 0xfffff;
      s.angle[i] += s.speed[i] * dt;
      t.qx[i] = 0; t.qz[i] = 0; t.qy[i] = Math.sin(s.angle[i] / 2); t.qw[i] = Math.cos(s.angle[i] / 2);
    }
    transforms.update(world);                                  // children follow their parents
  }

  /** Add everything to a `DrawList3D`. `meshes` has the unit box and sphere. */
  function draw(list, meshes) {
    const n = world.query(ids, [Transform, Shape, Colour]);
    const t = world.data(Transform), sh = world.data(Shape), c = world.data(Colour);
    for (let k = 0; k < n; k++) {
      const i = ids[k] & 0xfffff;
      q[0] = t.qx[i]; q[1] = t.qy[i]; q[2] = t.qz[i]; q[3] = t.qw[i];
      mat4.compose(model, t.x[i], t.y[i], t.z[i], q, t.sx[i] * sh.sx[i], t.sy[i] * sh.sy[i], t.sz[i] * sh.sz[i]);
      list.add(sh.kind[i] === 1 ? meshes.unitSphere : meshes.unitBox, model, c.r[i], c.g[i], c.b[i]);
    }
  }

  /** How far a scene entity is turned about the vertical axis, in radians. */
  function yawOf(id) { const e = loaded.get(id).root & 0xfffff, t = world.data(Transform); return 2 * Math.atan2(t.qy[e], t.qw[e]); }

  transforms.update(world);
  return { world, spawner, loaded, step, draw, yawOf, dispose: () => loaded.unload() };
}
