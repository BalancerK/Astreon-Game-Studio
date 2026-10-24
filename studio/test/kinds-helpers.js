// A small helper for the kinds tests: load a scene with the real kit and report what a game would see.
import { newGame } from '../../packages/arcade/src/things.js';
import { loadScene } from '../../packages/arcade/src/map.js';
import { refOf, sceneFieldProblems } from '../../packages/arcade/src/kinds.js';

export { sceneFieldProblems };

export function loadSceneCheck(scene, kinds) {
  const game = newGame();
  const { things } = loadScene(game, scene, kinds);
  return { opensFront: refOf(game, things[1], 'opens') === things[0], count: things.length };
}
