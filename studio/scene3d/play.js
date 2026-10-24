// Play for the 3D scene panel: walk around the scene you made. WASD or the arrows to move, Shift to run, Space to jump, click in the scene to look around with the
// mouse (Esc lets go of the mouse, Esc again stops). Red markers are things to collect; one named "start" says where you begin. The walking itself is in
// play-world.js (and tested in Node); this connects the keys and the mouse, takes over the editor's camera, draws the shapes and writes the words on the screen.
import { mat4 } from '../../packages/math/src/index.js';
import { PlayWorld } from './play-world.js';

const MOVE = { forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] };
const down = (keys, names) => names.some((n) => keys.has(n));

/** @param {any} scene @param {{library: any, describe?: (spec: any) => any}} o */
export function createPlayRuntime(scene, { library, describe }) {
  const play = new PlayWorld(scene, { library, describe });
  const keys = new Set();
  const model = new Float64Array(16);
  const scale = new Float64Array(16);
  const hud = document.createElement('div');
  hud.className = 'play-hud';
  hud.setAttribute('role', 'status');
  Object.assign(hud.style, {
    position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)', padding: '6px 14px', borderRadius: '8px', zIndex: 20, pointerEvents: 'none',
    background: 'rgba(10, 14, 22, .72)', color: '#eef2ff', font: '600 14px system-ui, sans-serif', textAlign: 'center',
  });
  document.body.append(hud);
  let said = '';
  const say = () => {
    const text = play.total
      ? `${play.done ? 'You collected them all! ' : ''}Collected ${play.count} of ${play.total}.   WASD move · Space jump · Shift run · click to look · Esc to stop`
      : 'WASD move · Space jump · Shift run · click to look · Esc to stop. Add red markers to the scene to have things to collect.';
    if (text !== said) { said = text; hud.textContent = text; }
  };
  say();

  const onKey = (e) => {
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(e.code)) {
      if (e.type === 'keydown') keys.add(e.code); else keys.delete(e.code);
      e.preventDefault();
    }
  };
  const onBlur = () => keys.clear();
  const onMouse = (e) => {
    if (!document.pointerLockElement) return;
    play.yaw -= e.movementX * 0.0025;
    play.pitch = Math.max(-1.5, Math.min(1.5, play.pitch - e.movementY * 0.0025));
  };
  const onClick = (e) => { if (e.target instanceof HTMLCanvasElement) Promise.resolve(e.target.requestPointerLock?.()).catch(() => {}); };      // a refusal is not an error
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKey);
  addEventListener('blur', onBlur);
  addEventListener('mousemove', onMouse);
  addEventListener('click', onClick);

  const runtime = {
    play,
    keys,
    step(dt) {
      play.step(dt, {
        forward: (down(keys, MOVE.forward) ? 1 : 0) - (down(keys, MOVE.back) ? 1 : 0),
        strafe: (down(keys, MOVE.right) ? 1 : 0) - (down(keys, MOVE.left) ? 1 : 0),
        run: keys.has('ShiftLeft') || keys.has('ShiftRight'), jump: keys.has('Space'),
      });
      say();
    },
    /** The editor asks for the camera every frame while this plays: it is where the eyes are. */
    camera(camera) {
      const e = play.eye;
      camera.x = e.x;
      camera.y = e.y;
      camera.z = e.z;
      camera.yaw = e.yaw;
      camera.pitch = e.pitch;
      camera.roll = 0;
      camera.fovY = 1.15;
    },
    draw(list, meshes) {
      for (const it of play.drawable()) {
        const s = it.shape;
        const [r, g, b] = it.color;
        if (s.type === 'capsule') { list.add(meshes.capsuleMesh(s.radius, s.halfHeight), it.matrix, r, g, b); continue; }
        const size = s.type === 'sphere' ? [s.radius * 2, s.radius * 2, s.radius * 2] : [s.hx * 2, s.hy * 2, s.hz * 2];
        mat4.scaling(scale, size[0], size[1], size[2]);
        mat4.multiply(model, it.matrix, scale);
        list.add(s.type === 'sphere' ? meshes.unitSphere : it.ramp ? meshes.unitWedge : meshes.unitBox, model, r, g, b);
      }
      if (!play.hasGround) {                                         // the floor an empty scene stands on
        list.addTransform(meshes.unitBox, 0, -0.5, 0, null, 200, 1, 200, 0.42, 0.5, 0.4);
      }
    },
    dispose() {
      removeEventListener('keydown', onKey);
      removeEventListener('keyup', onKey);
      removeEventListener('blur', onBlur);
      removeEventListener('mousemove', onMouse);
      removeEventListener('click', onClick);
      hud.remove();
      if (document.pointerLockElement) document.exitPointerLock?.();
      if (globalThis.__play === runtime) globalThis.__play = null;
    },
  };
  globalThis.__play = runtime;
  return runtime;
}
