import { Canvas2DRenderer } from './canvas2d.js';
import { WebGL2Renderer } from './webgl2.js';
import { WebGPURenderer } from './webgpu.js';

const defaultCreateCanvas = () => document.createElement('canvas');

/**
 * Create the best available renderer, falling back automatically:
 * WebGPU -> WebGL2 -> Canvas2D (override with `prefer`).
 *
 * A canvas is locked to the first context type requested from it, so every
 * attempt gets a fresh canvas from `createCanvas`. Append `renderer.canvas` to the page.
 *
 * @param {object} o
 * @param {import('./atlas.js').Atlas} o.atlas
 * @param {('webgpu'|'webgl2'|'canvas2d')[]} [o.prefer]
 * @param {() => HTMLCanvasElement} [o.createCanvas]
 * @param {boolean} [o.transparent] Give the canvas an alpha channel (cleared to transparent by default) so it can be stacked over another canvas, e.g. a 2D HUD over a 3D view.
 * @param {'linear' | 'nearest'} [o.filter] `'nearest'` draws scaled sprites with hard pixels (pixel art); default `'linear'`. Scalable (SDF) text needs linear.
 * @returns {Promise<WebGPURenderer | WebGL2Renderer | Canvas2DRenderer>} `renderer.kind` says which one won.
 */
export async function createRenderer({ atlas, prefer = ['webgpu', 'webgl2', 'canvas2d'], createCanvas = defaultCreateCanvas, transparent = false, filter = 'linear' }) {
  const failures = [];
  for (const kind of prefer) {
    try {
      const canvas = createCanvas();
      if (kind === 'webgpu') return await WebGPURenderer.create(canvas, atlas, { transparent, filter });
      if (kind === 'webgl2') return new WebGL2Renderer(canvas, atlas, { transparent, filter });
      if (kind === 'canvas2d') return new Canvas2DRenderer(canvas, atlas, { transparent, filter });
      throw new Error('unknown renderer kind');
    } catch (e) {
      failures.push(`${kind}: ${e.message}`);
    }
  }
  throw new Error(`no renderer could be created:\n  ${failures.join('\n  ')}`);
}
