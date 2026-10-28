import { resolvePostOptions, writePostUniforms, writeFxUniforms, aoSize, bloomLevels, POST_UNIFORM_FLOATS, FX_UNIFORM_FLOATS, POST_WGSL, postFxWgsl } from './post.js';

export const HDR_FORMAT = 'rgba16float';
const AO_FORMAT = 'r8unorm';

/**
 * Post-processing with WebGPU: the scene is drawn into a half-float texture, then (each only when asked for) ambient occlusion, depth of field, bloom passes, the final
 * composite, and FXAA. The depth effects read the scene's own depth texture.
 */
export class GPUPost {
  constructor(device, canvasFormat, samples = 1) {
    this.device = device;
    this.canvasFormat = canvasFormat;
    this.samples = samples;
    const module = device.createShaderModule({ code: POST_WGSL });
    const make = (frag, format, blend) => device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'fsVert' },
      fragment: { module, entryPoint: frag, targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
    const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    this.downPipeline = make('bloomDown', HDR_FORMAT);
    this.upPipeline = make('bloomUp', HDR_FORMAT, add);
    this.compositePipeline = make('composite', canvasFormat);
    this.fxPipelines = new Map(); // made the first time an effect is asked for
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.gradeBuffer = device.createBuffer({ size: POST_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.fxBuffer = device.createBuffer({ size: FX_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.black = device.createTexture({ size: [1, 1], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING });
    this.blackView = this.black.createView();
    this.uniforms = new Float32Array(POST_UNIFORM_FLOATS);
    this.fxUniforms = new Float32Array(FX_UNIFORM_FLOATS);
    this.key = '';
    this.w = 0; this.h = 0;
    this.scene = null; this.sceneView = null;
    this.levels = [];
    this.compositeGroup = null;
    this.free = [];
    this.depth = null;
  }

  #fx(name, format) {
    let p = this.fxPipelines.get(name);
    if (!p) {
      this.fxModule ??= this.device.createShaderModule({ code: postFxWgsl(this.samples) });
      p = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: this.fxModule, entryPoint: 'fsVert' },
        fragment: { module: this.fxModule, entryPoint: name, targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.fxPipelines.set(name, p);
    }
    return p;
  }

  #free() {
    this.scene?.destroy();
    for (const l of this.levels) { l.tex.destroy(); l.bp.destroy(); l.bq.destroy(); l.bu.destroy(); }
    for (const x of this.free) x.destroy();
    this.levels = []; this.free = [];
    this.compositeGroup = null; this.depth = null;
    this.ao = this.dofTex = this.ssrTex = this.ldr = null;
  }

  /** (Re)build the targets for this canvas size and these effects. */
  setup(w, h, p) {
    const bloom = p.bloom;
    const want = bloom ? bloomLevels(w, h, bloom.levels) : [];
    const key = [w, h, want.length, p.ao ? p.ao.scale : 0, p.dof ? 1 : 0, p.ssr ? 1 : 0, p.fxaa ? 1 : 0].join(',');
    if (key === this.key && this.scene) return;
    this.#free();
    this.key = key;
    const { device } = this;
    this.w = w; this.h = h;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const target = (tw, th, format) => { const tex = device.createTexture({ size: [tw, th], format, usage }); this.free.push(tex); return { tex, view: tex.createView(), w: tw, h: th }; };
    this.scene = device.createTexture({ size: [w, h], format: HDR_FORMAT, usage });
    this.sceneView = this.scene.createView();
    this.ssrTex = p.ssr ? target(w, h, HDR_FORMAT) : null;                         // the scene with its reflections, which depth of field, bloom and the composite read
    this.dofTex = p.dof ? target(w, h, HDR_FORMAT) : null;                         // the scene after depth of field, which bloom and the composite read
    this.ldr = p.fxaa ? target(w, h, this.canvasFormat) : null;                    // the finished picture, before FXAA
    if (p.ao) { const s = aoSize(w, h, p.ao); this.ao = { a: target(s.w, s.h, AO_FORMAT), b: target(s.w, s.h, AO_FORMAT) }; }
    const uni = () => device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const colorView = this.dofTex?.view ?? this.ssrTex?.view ?? this.sceneView;
    this.levels = want.map((s) => {
      const tex = device.createTexture({ size: [s.w, s.h], format: HDR_FORMAT, usage });
      return { tex, view: tex.createView(), w: s.w, h: s.h, bp: uni(), bq: uni(), bu: uni(), downGroup: null, upGroup: null };
    });
    // bind groups: level i is made from the level (or scene) above it, and added into by the level below it
    this.levels.forEach((lv, i) => {
      const src = i === 0 ? { view: colorView, w, h } : this.levels[i - 1];
      lv.downSrc = src;
      lv.downGroup = device.createBindGroup({ layout: this.downPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: src.view }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: lv.bp } }, { binding: 3, resource: { buffer: lv.bq } },
      ] });
      lv.upGroup = device.createBindGroup({ layout: this.upPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: lv.view }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: lv.bu } }, { binding: 3, resource: { buffer: lv.bq } },
      ] });
    });
    this.compositeGroup = device.createBindGroup({ layout: this.compositePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: colorView }, { binding: 1, resource: this.levels[0]?.view ?? this.blackView }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.gradeBuffer } },
      { binding: 4, resource: this.ao?.a.view ?? this.blackView },
    ] });
    if (p.fxaa) this.fxaaGroup = device.createBindGroup({ layout: this.#fx('fxaa', this.canvasFormat).getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.fxBuffer } }, { binding: 2, resource: this.ldr.view }, { binding: 3, resource: this.sampler },
    ] });
  }

  /** The groups that read the scene's depth; made again when the renderer makes a new depth texture. */
  #bindDepth(depthTexture) {
    if (this.depth === depthTexture) return;
    this.depth = depthTexture;
    const { device } = this, p = this.options;
    const depthView = depthTexture.createView({ aspect: 'depth-only' });
    const fx = { binding: 0, resource: { buffer: this.fxBuffer } }, dv = { binding: 1, resource: depthView };
    const dir = (x, y) => { const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, new Float32Array([x, y, 0, 0])); this.free.push(b); return b; };
    if (p.ao) {
      const blur = this.#fx('aoBlur', AO_FORMAT).getBindGroupLayout(0);
      this.aoGroup = device.createBindGroup({ layout: this.#fx('aoMain', AO_FORMAT).getBindGroupLayout(0), entries: [fx, dv] });
      this.aoBlurH = device.createBindGroup({ layout: blur, entries: [fx, dv, { binding: 2, resource: this.ao.a.view }, { binding: 4, resource: { buffer: dir(1, 0) } }] });
      this.aoBlurV = device.createBindGroup({ layout: blur, entries: [fx, dv, { binding: 2, resource: this.ao.b.view }, { binding: 4, resource: { buffer: dir(0, 1) } }] });
    }
    if (p.ssr) this.ssrGroup = device.createBindGroup({ layout: this.#fx('ssr', HDR_FORMAT).getBindGroupLayout(0), entries: [fx, dv, { binding: 2, resource: this.sceneView }] });
    if (p.dof) this.dofGroup = device.createBindGroup({ layout: this.#fx('dof', HDR_FORMAT).getBindGroupLayout(0), entries: [fx, dv, { binding: 2, resource: this.ssrTex?.view ?? this.sceneView }] });
  }

  /** Prepare for a frame: targets, and every uniform the later passes read. Returns the resolved options. */
  prepare(width, height, options, camera) {
    const p = resolvePostOptions(options, camera);
    this.setup(width, height, p);
    const { device } = this;
    writePostUniforms(this.uniforms, p, width / Math.max(1, height));
    device.queue.writeBuffer(this.gradeBuffer, 0, this.uniforms);
    writeFxUniforms(this.fxUniforms, p, camera, width, height);
    device.queue.writeBuffer(this.fxBuffer, 0, this.fxUniforms);
    this.levels.forEach((lv, i) => {
      const s = lv.downSrc;
      // the down pass reads the level above (its texel size), the up pass reads this level (its own texel size)
      device.queue.writeBuffer(lv.bp, 0, new Float32Array([1 / s.w, 1 / s.h, p.bloom.threshold, p.bloom.knee]));
      device.queue.writeBuffer(lv.bu, 0, new Float32Array([1 / lv.w, 1 / lv.h, 0, 0]));
      device.queue.writeBuffer(lv.bq, 0, new Float32Array([i === 0 ? 1 : 0, p.bloom.radius, 0, 0]));
    });
    this.options = p;
    return p;
  }

  /** Encode the effect, bloom and composite passes (after the scene pass has been resolved into `sceneView`). `depthTexture` is the scene's, kept (not discarded) when a depth effect is on. */
  encode(encoder, swapView, depthTexture) {
    const p = this.options;
    const draw = (view, pipeline, group, clear = true) => {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: clear ? 'clear' : 'load', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
    };
    if (p.needsDepth) this.#bindDepth(depthTexture);
    if (p.ao) {
      draw(this.ao.a.view, this.#fx('aoMain', AO_FORMAT), this.aoGroup);
      draw(this.ao.b.view, this.#fx('aoBlur', AO_FORMAT), this.aoBlurH);
      draw(this.ao.a.view, this.#fx('aoBlur', AO_FORMAT), this.aoBlurV);
    }
    if (p.ssr) draw(this.ssrTex.view, this.#fx('ssr', HDR_FORMAT), this.ssrGroup);
    if (p.dof) draw(this.dofTex.view, this.#fx('dof', HDR_FORMAT), this.dofGroup);
    const lv = this.levels;
    for (let i = 0; i < lv.length; i++) draw(lv[i].view, this.downPipeline, lv[i].downGroup);
    for (let i = lv.length - 1; i > 0; i--) draw(lv[i - 1].view, this.upPipeline, lv[i].upGroup, false);
    draw(p.fxaa ? this.ldr.view : swapView, this.compositePipeline, this.compositeGroup);
    if (p.fxaa) draw(swapView, this.#fx('fxaa', this.canvasFormat), this.fxaaGroup);
  }

  destroy() { this.#free(); this.gradeBuffer.destroy(); this.fxBuffer.destroy(); this.black.destroy(); }
}
