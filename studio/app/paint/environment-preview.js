// The Environment panel's picture: the engine's own renderer drawing the sky, the water and the ground an environment file describes, so what you see is what a game made with the
// engine gets. Needs a browser with WebGPU or WebGL2 (`start` says so when there is none).
import {
  createRenderer3D, Camera3D, DrawList3D, createLighting, createSky, sunDirection, skyLighting, proceduralSkyEnvironment,
  createWaterStyle, createWaterMesh,
  Heightmap, Terrain,
} from '../../../packages/render/src/index.js';
import { groundHeight, skySetup, waterSetup, rgb } from './environment-model.js';

const IDENTITY = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
const SIZE = 64;
const CENTER = [32, 0, 32];

/** The waves of the default water, scaled so that a Waves setting of 0.4 is the engine's usual sea. */
const waveScale = (waves) => waves / 0.4;

export class EnvironmentPreview {
  constructor() {
    this.renderer = null;
    this.world = null;
    this.camera = null;
    this.yaw = 0.9;
    this.pitch = 0.45;
    this.distance = 78;
    this.time = 0;
    this.terrain = null;
    this.sea = null;
    this.keys = { terrain: '', sea: '', sky: '' };
    this.list = new DrawList3D();
    this.sky = null;
    this.error = '';
  }

  /** Make the renderer. Resolves to the canvas to put on the page, or null (with `error` set) when this browser cannot draw it. */
  async start(width = 480, height = 300) {
    try {
      this.renderer = await createRenderer3D({ antialias: false, water: true });
      this.renderer.resize(width, height, 1);
      this.camera = new Camera3D({ x: 0, y: 30, z: 0, fovY: 1.0, viewW: width, viewH: height });
      return this.renderer.canvas;
    } catch (error) {
      this.error = String(error?.message ?? error);
      return null;
    }
  }

  /** Turn the view round the place by some radians (dragging the picture). */
  orbit(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(0.08, Math.min(1.45, this.pitch + dpitch));
  }

  /** Come closer or go further away. */
  zoom(factor) { this.distance = Math.max(25, Math.min(140, this.distance * factor)); }

  #place() {
    const c = this.camera;
    const flat = Math.cos(this.pitch) * this.distance;
    c.x = CENTER[0] + Math.sin(this.yaw) * flat;
    c.z = CENTER[2] + Math.cos(this.yaw) * flat;
    c.y = 4 + Math.sin(this.pitch) * this.distance;
    const dx = CENTER[0] - c.x, dy = 2 - c.y, dz = CENTER[2] - c.z;
    c.yaw = Math.atan2(-dx, -dz);
    c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    c.update();
  }

  #build(world) {
    const t = world.terrain;
    const terrainKey = JSON.stringify(t);
    if (terrainKey !== this.keys.terrain) {
      this.keys.terrain = terrainKey;
      this.terrain = new Terrain(Heightmap.fromFunction(SIZE + 1, (x, z) => groundHeight(t, x, z), { cell: 1 }), { chunkCells: 16, lods: 2 });
    }
    const setup = waterSetup(world);
    const seaKey = JSON.stringify([setup && setup.level, terrainKey]);
    if (seaKey !== this.keys.sea) {
      this.keys.sea = seaKey;
      const ground = (x, z) => groundHeight(t, x, z);
      this.sea = setup ? createWaterMesh({ x0: 0, z0: 0, x1: SIZE, z1: SIZE, level: setup.level, cell: 1, ground }) : null;
    }
  }

  /** Draw the environment at a moment (seconds, for the waves and clouds). @param {object} world a clean environment (see environment-model.js) @param {number} time */
  draw(world, time = this.time) {
    if (!this.renderer) return;
    this.time = time;
    this.world = world;
    this.#build(world);
    this.#place();
    const s = skySetup(world);
    const sun = sunDirection({ hour: s.hour, latitude: 45, dayOfYear: 172 });
    const sky = createSky({ sun, turbidity: s.turbidity, exposure: s.exposure, clouds: s.clouds, stars: s.stars, time });
    const skyKey = JSON.stringify([s.hour, s.turbidity, s.exposure, s.stars, !!s.clouds]);
    if (skyKey !== this.keys.sky) {
      this.keys.sky = skyKey;
      this.renderer.setEnvironment?.(proceduralSkyEnvironment(sky));
    }
    const w = waterSetup(world);
    const look = w && { shallow: w.shallow, deep: w.deep, clarity: w.clarity, opacity: w.opacity, waves: this.#waves(w.waves) };
    const style = look ? createWaterStyle(look) : null;
    const list = this.list;
    list.clear();
    list.setCamera(this.camera);
    list.setMaterial(null);
    const [r, g, b] = rgb(world.terrain.color);
    this.terrain.addToDrawList(list, this.camera, { r, g, b });
    if (style && this.sea) {
      list.setWater(0, time);
      list.add(this.sea, IDENTITY, 1, 1, 1, 0.4);
      list.setMaterial(null);
    }
    this.renderer.render({
      camera: this.camera, list, clear: [0, 0, 0, 1],
      lighting: { ...createLighting(), ...skyLighting(sky), sky, water: style ? [style] : [] },
    });
  }

  #waves(amount) {
    const base = createWaterStyle().waves;
    const k = waveScale(amount);
    return base.map((wave) => ({ ...wave, amplitude: wave.amplitude * k }));
  }

  /** Let go of the renderer. */
  destroy() {
    this.renderer?.destroy?.();
    this.renderer = null;
  }
}
