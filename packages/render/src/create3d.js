import { WebGPURenderer3D } from './webgpu3d.js';
import { WebGL2Renderer3D } from './webgl3d.js';

const defaultCreateCanvas = () => document.createElement('canvas');

/**
 * Create the best available 3D renderer, falling back automatically: WebGPU -> WebGL2 (Canvas2D cannot draw 3D). Each
 * attempt gets a fresh canvas because a canvas is locked to its first context type; append `renderer.canvas` to the page.
 *
 * @param {object} [o]
 * @param {('webgpu'|'webgl2')[]} [o.prefer]
 * @param {boolean} [o.antialias] Multisample anti-aliasing (default on).
 * @param {boolean} [o.water] Compile the water shading (`list.setWater`, `lighting.water`). Off by default because WebGL2 pays for it in shader compile time even when no water is drawn; WebGPU ignores it.
 * @param {boolean} [o.skyBake] Bake the procedural sky's atmosphere into small textures that are filled again only when the sun moves, so the sky and the water read it instead of working it out for every pixel (default on; WebGL2 does it when the card can draw to half-float textures, and turns it off by itself when it cannot).
 * @param {() => HTMLCanvasElement} [o.createCanvas]
 * @returns {Promise<WebGPURenderer3D | WebGL2Renderer3D>} `renderer.kind` says which one won.
 */
export async function createRenderer3D({ prefer = ['webgpu', 'webgl2'], antialias = true, water = false, skyBake = true, createCanvas = defaultCreateCanvas } = {}) {
  const failures = [];
  for (const kind of prefer) {
    try {
      const canvas = createCanvas();
      if (kind === 'webgpu') return await WebGPURenderer3D.create(canvas, { antialias, skyBake });
      if (kind === 'webgl2') return new WebGL2Renderer3D(canvas, { antialias, water, skyBake });
      throw new Error('unknown renderer kind');
    } catch (e) {
      failures.push(`${kind}: ${e.message}`);
    }
  }
  throw new Error(`no 3D renderer could be created:\n  ${failures.join('\n  ')}`);
}
