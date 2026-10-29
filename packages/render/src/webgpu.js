import { INSTANCE_WORDS, INSTANCE_BYTES } from './batch.js';
import { planFilters } from './filters.js';
import { GPUFilterRunner } from './filter-gpu.js';
import { packLighting } from './lighting.js';
import { GPULighting } from './light-gpu.js';
import { GPUMeshes } from './mesh-gpu.js';

const WRITE_CHUNK = 8192; // sprites per writeBuffer call (360 KB)

const WGSL = `
@group(0) @binding(0) var<uniform> cam: vec4f;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d_array<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec4f,
  @location(2) @interpolate(flat) pf: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32,
      @location(0) ipos: vec2f, @location(1) isize: vec2f, @location(2) rot: f32,
      @location(3) uvr: vec4f, @location(4) tint: vec4f, @location(5) pf: u32) -> VOut {
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) - vec2f(0.5);
  let c = cos(rot);
  let s = sin(rot);
  let l = corner * isize;
  let w = ipos + vec2f(l.x * c - l.y * s, l.x * s + l.y * c);
  var o: VOut;
  o.pos = vec4f((w.x - cam.x) * cam.z, (w.y - cam.y) * cam.w, 0.0, 1.0);
  o.uv = mix(uvr.xy, uvr.zw, corner + vec2f(0.5));
  o.tint = tint;
  o.pf = pf;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, i.uv, i32(i.pf & 255u));
  let w = max(fwidth(t.a), 0.0001) * 0.75; // taken outside any branch: derivatives need uniform control flow
  // signed distance field sprites (text): 0.5 is the outline, the screen-space slope gives a one-pixel anti-aliased edge at any scale
  let a = smoothstep(0.5 - w, 0.5 + w, t.a);
  let sdf = vec4f(i.tint.rgb * i.tint.a * a, i.tint.a * a);
  let plain = t * vec4f(i.tint.rgb * i.tint.a, i.tint.a);
  return select(plain, sdf, (i.pf & 256u) != 0u);
}
`;

/** Same instance buffer and one draw call, through WebGPU. Create with `WebGPURenderer.create`. */
export class WebGPURenderer {
  static async create(canvas, atlas, { transparent = false, filter = 'linear' } = {}) {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) throw new Error('WebGPU unavailable');
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas context unavailable');
    return new WebGPURenderer(canvas, atlas, device, context, gpu.getPreferredCanvasFormat(), transparent, filter);
  }

  constructor(canvas, atlas, device, context, format, transparent = false, filter = 'linear') {
    this.kind = 'webgpu';
    this.transparent = transparent;
    /** How sprites are sampled when scaled: `'linear'` (smooth) or `'nearest'` (hard pixels, for pixel art). Change with `setFilter`. */
    this.filter = filter === 'nearest' ? 'nearest' : 'linear';
    this.canvas = canvas;
    this.atlas = atlas;
    this.device = device;
    this.context = context;
    this.lost = false;
    this.onLost = null;
    this.dpr = 1;
    this.format = format;
    this.filterRunner = null;
    this.lightingGpu = null;
    this.meshesGpu = null;
    this.normalTexture = null;
    this.normalView = null;
    this.normalLayers = 0;
    this.normalVersions = [];
    this.occluderBuffer = null;
    this.occluderCapacity = 0;
    /** 2D lighting (`render({ lighting })`) is available. */
    this.lightingSupported = true;
    this.pageVersions = [];
    this.layers = 0;
    this.camera = new Float32Array(4);
    device.lost.then((info) => { this.lost = true; this.onLost?.(info); });
    /** The latest GPU validation error message, if any (they are otherwise silent: the frame just comes out empty). */
    this.lastError = '';
    device.addEventListener?.('uncapturederror', (e) => { this.lastError = e.error?.message ?? String(e.error); console.error(`WebGPU validation error: ${this.lastError}`); });
    context.configure({ device, format, alphaMode: transparent ? 'premultiplied' : 'opaque' });

    const module = device.createShaderModule({ code: WGSL });
    module.getCompilationInfo?.().then((info) => { // shader errors would otherwise only show up as an empty frame
      for (const m of info.messages) if (m.type === 'error') { this.lastError = `WGSL line ${m.lineNum}: ${m.message}`; console.error(`WebGPU shader error: ${this.lastError}`); }
    });
    const blend = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    this.makePipeline = (target) => device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module, entryPoint: 'vs',
        buffers: [{
          arrayStride: INSTANCE_BYTES, stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32' },
            { shaderLocation: 3, offset: 20, format: 'float32x4' },
            { shaderLocation: 4, offset: 36, format: 'unorm8x4' },
            { shaderLocation: 5, offset: 40, format: 'uint32' },
          ],
        }],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format: target, blend }] },
      primitive: { topology: 'triangle-strip' },
    });
    this.pipeline = this.makePipeline(format);
    this.groupPipeline = null;    // the same, drawing into a filter's picture (rgba8unorm); made when filters are first used
    this.groupBindGroup = null;
    this.uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: this.filter, minFilter: this.filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.texture = null;
    this.bindGroup = null;
    this.#allocateTexture(Math.max(1, Math.min(atlas.maxPages, 2)));
    this.instanceCapacity = 0;
    this.instanceBuffer = null;
  }

  /** Switch between smooth (`'linear'`) and hard-pixel (`'nearest'`) sampling of sprites, meshes and normal maps. Text drawn as scalable (SDF) glyphs needs `'linear'`. @param {'linear' | 'nearest'} mode */
  setFilter(mode) {
    this.filter = mode === 'nearest' ? 'nearest' : 'linear';
    this.sampler = this.device.createSampler({ magFilter: this.filter, minFilter: this.filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.#allocateTexture(this.layers);
  }

  /** (Re)create the texture array with room for `layers` atlas pages. */
  #allocateTexture(layers) {
    const { device, atlas } = this;
    this.texture?.destroy();
    this.layers = layers;
    this.texture = device.createTexture({
      size: [atlas.size, atlas.size, layers],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.textureView = this.texture.createView({ dimension: '2d-array' });
    const entries = [
      { binding: 0, resource: { buffer: this.uniform } },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: this.textureView },
    ];
    this.bindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries });
    this.groupBindGroup = this.groupPipeline ? device.createBindGroup({ layout: this.groupPipeline.getBindGroupLayout(0), entries }) : null;
    this.pageVersions = [];
    this.normalLayers = 0;                                  // the normal-map array follows the colour array
  }

  /** Upload only the atlas pages that changed; grow the texture array (re-uploading everything) when pages were added. */
  #uploadPages() {
    const { device, atlas } = this;
    const pages = atlas.pages;
    if (pages.length > this.layers) this.#allocateTexture(Math.min(atlas.maxPages, Math.max(pages.length, this.layers * 2)));
    for (let i = 0; i < pages.length; i++) {
      if (this.pageVersions[i] === pages[i].version) continue;
      device.queue.copyExternalImageToTexture({ source: pages[i].canvas }, { texture: this.texture, origin: [0, 0, i], premultipliedAlpha: true }, [atlas.size, atlas.size]);
      this.pageVersions[i] = pages[i].version;
    }
    if (atlas.hasNormals) this.#uploadNormals();
  }

  /** The normal-map twins of the atlas pages, as a second texture array (only once the atlas has any normal maps). */
  #uploadNormals() {
    const { device, atlas } = this;
    const pages = atlas.pages;
    if (!this.normalTexture || this.normalLayers !== this.layers) {
      this.normalTexture?.destroy();
      this.normalTexture = device.createTexture({ size: [atlas.size, atlas.size, this.layers], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.normalView = this.normalTexture.createView({ dimension: '2d-array' });
      this.normalLayers = this.layers; this.normalVersions = [];
    }
    for (let i = 0; i < pages.length; i++) {
      const n = pages[i].normals;
      if (!n || this.normalVersions[i] === n.version) continue;
      device.queue.copyExternalImageToTexture({ source: n.canvas }, { texture: this.normalTexture, origin: [0, 0, i], premultipliedAlpha: false }, [atlas.size, atlas.size]);
      this.normalVersions[i] = n.version;
    }
  }

  /** The pipeline that draws sprites into a filter's picture or the occluder picture (rgba8unorm); made the first time it is needed. */
  #ensureGroupPipeline() {
    if (this.groupPipeline) return;
    this.groupPipeline = this.makePipeline('rgba8unorm');
    this.groupBindGroup = this.device.createBindGroup({ layout: this.groupPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.textureView }] });
  }

  resize(cssW, cssH, dpr = 1) {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;                      // (setting a canvas's size, even to what it is, empties it, and a 3D renderer makes its picture buffers again)
    if (this.canvas.height !== h) this.canvas.height = h;
    if (this.canvas.style) { const sw = `${cssW}px`, sh = `${cssH}px`; if (this.canvas.style.width !== sw) this.canvas.style.width = sw; if (this.canvas.style.height !== sh) this.canvas.style.height = sh; }
  }

  /**
   * @param {{camera: import('./camera.js').Camera, batch: import('./batch.js').SpriteBatch, clear?: number[] | null, filters?: object[], lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}} frame
   * `clear: null` keeps the previous contents (overlay pass). `filters` (see `Filter`) run over this batch alone, then the result is laid over the frame.
   * `lighting` (see `Lighting2D`) lights this batch; `occluders` is a batch of the things that block light, drawn in the same camera, for shadows.
   * `meshes` (a `MeshBatch2D`: skeletons, ropes, anything of triangles) is drawn after the sprites, unlit.
   */
  render({ camera, batch, clear = this.transparent ? [0, 0, 0, 0] : [0.05, 0.05, 0.08, 1], filters, lighting, occluders, meshes }) {
    if (this.lost) return;
    batch.sort();
    const { device } = this;
    this.#uploadPages();
    const write = (buffer, b) => {
      // in chunks: one very large writeBuffer is several times slower than the same bytes in pieces (measured: 200,000 sprites 5.2 ms -> see docs/BENCHMARKS.md)
      for (let k = 0; k < b.count; k += WRITE_CHUNK) {
        const n = Math.min(WRITE_CHUNK, b.count - k);
        device.queue.writeBuffer(buffer, k * INSTANCE_BYTES, b.f32, k * INSTANCE_WORDS, n * INSTANCE_WORDS);
      }
    };
    if (batch.count > this.instanceCapacity) {
      this.instanceBuffer?.destroy();
      this.instanceCapacity = Math.max(batch.count, this.instanceCapacity * 2, 256);
      this.instanceBuffer = device.createBuffer({ size: this.instanceCapacity * INSTANCE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    device.queue.writeBuffer(this.uniform, 0, camera.uniforms(this.camera));
    write(this.instanceBuffer, batch);

    const hasMeshes = !!meshes && meshes.indexCount > 0;
    if (hasMeshes) { this.meshesGpu ??= new GPUMeshes(device); this.meshesGpu.upload(meshes); }
    const w = this.canvas.width, h = this.canvas.height;
    let pack = null, shadows = false;
    if (lighting && lighting.enabled !== false && batch.count > 0) {
      this.lightingGpu ??= new GPULighting(device, this.sampler);
      const blockers = occluders && occluders.count > 0;
      pack = packLighting(lighting, camera, { dpr: this.dpr, width: w, height: h, hasOccluders: !!blockers, hasNormals: this.atlas.hasNormals });
      shadows = !!blockers && (pack.shadowRows.length > 0 || pack.sun);
      if (!shadows) pack.data[10] = 0;
      this.lightingGpu.upload(pack);
      if (shadows) {
        occluders.sort();
        if (occluders.count > this.occluderCapacity) {
          this.occluderBuffer?.destroy();
          this.occluderCapacity = Math.max(occluders.count, this.occluderCapacity * 2, 64);
          this.occluderBuffer = device.createBuffer({ size: this.occluderCapacity * INSTANCE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        }
        write(this.occluderBuffer, occluders);
      }
    }

    const encoder = device.createCommandEncoder();
    const target = this.context.getCurrentTexture().createView();
    const plan = filters?.length && (batch.count > 0 || hasMeshes) ? planFilters(filters, { scale: this.dpr }) : null;
    if (shadows) {
      this.#ensureGroupPipeline();
      const mask = encoder.beginRenderPass({ colorAttachments: [{ view: this.lightingGpu.beginMask(w, h), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      mask.setPipeline(this.groupPipeline);
      mask.setBindGroup(0, this.groupBindGroup);
      mask.setVertexBuffer(0, this.occluderBuffer);
      mask.draw(4, occluders.count);
      mask.end();
      if (pack.shadowRows.length) this.lightingGpu.encodeShadows(encoder, pack.shadowRows);
    }
    const normals = this.atlas.hasNormals && this.normalView ? this.normalView : this.textureView;
    const draw = (pass, format, grouped) => {
      if (pack) {
        const pipeline = this.lightingGpu.pipeline(format);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.lightingGpu.bindGroup(pipeline, this.uniform, this.textureView, normals));
      } else {
        pass.setPipeline(grouped ? this.groupPipeline : this.pipeline);
        pass.setBindGroup(0, grouped ? this.groupBindGroup : this.bindGroup);
      }
      if (batch.count > 0) {
        pass.setVertexBuffer(0, this.instanceBuffer);
        pass.draw(4, batch.count);
      }
      if (hasMeshes) this.meshesGpu.draw(pass, format, this.uniform, this.sampler, this.textureView, meshes);
    };
    if (plan) {
      if (!this.filterRunner) this.filterRunner = new GPUFilterRunner(device, this.format);
      this.#ensureGroupPipeline();
      const view = this.filterRunner.begin(w, h);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      draw(pass, 'rgba8unorm', true);
      pass.end();
      this.filterRunner.encode(encoder, plan, target, clear);
    } else {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: target,
          clearValue: clear ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] } : undefined,
          loadOp: clear ? 'clear' : 'load', storeOp: 'store', // `clear: null` keeps the previous contents (overlay pass)
        }],
      });
      if (batch.count > 0 || hasMeshes) draw(pass, this.format, false);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Several batches in order, each with its own filters (and camera): a world, then a glowing boss, then the HUD.
   * @param {{camera: import('./camera.js').Camera, clear?: number[] | null, layers: {batch: import('./batch.js').SpriteBatch, filters?: object[], camera?: import('./camera.js').Camera, lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}[]}} frame
   */
  renderLayers({ camera, clear, layers }) {
    layers.forEach((l, i) => this.render({ camera: l.camera ?? camera, batch: l.batch, filters: l.filters, lighting: l.lighting, occluders: l.occluders, meshes: l.meshes, ...(i === 0 ? (clear === undefined ? {} : { clear }) : { clear: null }) }));
  }

  destroy() {
    this.filterRunner?.destroy();
    this.lightingGpu?.destroy();
    this.meshesGpu?.destroy();
    this.normalTexture?.destroy();
    this.occluderBuffer?.destroy();
    this.instanceBuffer?.destroy();
    this.texture.destroy();
    this.uniform.destroy();
    this.device.destroy();
  }
}
