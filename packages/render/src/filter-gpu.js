import { FILTER_MODE, FILTER_REGISTERS, FILTER_UNIFORM_FLOATS, BLUR_HALF_TAPS, OUTLINE_RINGS, OUTLINE_DIRECTIONS } from './filters.js';

/** The one shader for every pass (see filter-gl.js: the same maths, with positions counted from the top left). */
const WGSL = `
@group(0) @binding(0) var<uniform> P: array<vec4f, 16>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var ta: texture_2d<f32>;
@group(0) @binding(3) var tb: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let c = vec2f(f32(vi & 1u), f32(vi >> 1u));
  return vec4f(c * 2.0 - 1.0, 0.0, 1.0);
}

fn sa(pd: vec2f, sz: vec2f) -> vec4f { return textureSampleLevel(ta, samp, pd / sz, 0.0); }
fn sb(pd: vec2f, sz: vec2f) -> vec4f { return textureSampleLevel(tb, samp, pd / sz, 0.0); }
fn stopPos(i: i32) -> f32 { return P[2 + i / 4][i % 4]; }

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let sz = P[0].yz;
  let mode = i32(P[0].x + 0.5);
  let ip = floor(frag.xy);
  let pd = ip + vec2f(0.5);
  let c = sa(pd, sz);
  var o = c;
  if (mode == ${FILTER_MODE.matrix}) {
    let a = c.a;
    var rgb = vec3f(0.0);
    if (a > 0.0) { rgb = c.rgb / a; }
    let v = vec4f(rgb, a);
    let r = clamp(vec4f(dot(P[1], v), dot(P[2], v), dot(P[3], v), dot(P[4], v)) + P[5], vec4f(0.0), vec4f(1.0));
    o = vec4f(r.rgb * r.a, r.a);
  } else if (mode == ${FILTER_MODE.blur}) {
    let stp = P[1].xy;
    let sig = P[1].z;
    var acc = vec4f(0.0);
    var ws = 0.0;
    for (var k = -${BLUR_HALF_TAPS}; k <= ${BLUR_HALF_TAPS}; k++) {
      let fk = f32(k);
      let wt = exp(-0.5 * (fk / sig) * (fk / sig));
      acc += sa(pd + fk * stp, sz) * wt;
      ws += wt;
    }
    o = acc / ws;
  } else if (mode == ${FILTER_MODE.outline}) {
    var m = 0.0;
    for (var ring = 1; ring <= ${OUTLINE_RINGS}; ring++) {
      let d = P[1].x * f32(ring) / ${OUTLINE_RINGS}.0;
      for (var k = 0; k < ${OUTLINE_DIRECTIONS}; k++) {
        let ang = f32(k) * ${(2 * Math.PI / OUTLINE_DIRECTIONS).toFixed(9)};
        m = max(m, sa(pd + d * vec2f(cos(ang), sin(ang)), sz).a);
      }
    }
    let oa = P[2].a * m;
    o = c + (1.0 - c.a) * vec4f(P[2].rgb * oa, oa);
  } else if (mode == ${FILTER_MODE.pixelate}) {
    let cell = P[1].x;
    let cx = min(sz.x - 1.0, floor(ip.x / cell) * cell + floor(cell / 2.0));
    let cy = min(sz.y - 1.0, floor(ip.y / cell) * cell + floor(cell / 2.0));
    o = textureLoad(ta, vec2i(i32(cx), i32(cy)), 0);
  } else if (mode == ${FILTER_MODE.gradient}) {
    let a = c.a;
    var rgb = vec3f(0.0);
    if (a > 0.0) { rgb = c.rgb / a; }
    let lum = clamp(dot(rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let n = i32(P[1].x + 0.5);
    var i0 = 0;
    var i1 = 0;
    var f = 0.0;
    if (lum <= stopPos(0)) { i0 = 0; i1 = 0; }
    else if (lum >= stopPos(n - 1)) { i0 = n - 1; i1 = n - 1; }
    else {
      for (var i = 0; i < 7; i++) {
        if (i >= n - 1) { break; }
        let p0 = stopPos(i);
        let p1 = stopPos(i + 1);
        if (lum >= p0 && lum <= p1) { i0 = i; i1 = i + 1; f = (lum - p0) / max(1e-6, p1 - p0); break; }
      }
    }
    let col = mix(P[4 + i0], P[4 + i1], f);
    let ca = col.a * a;
    o = vec4f(col.rgb * ca, ca);
  } else if (mode == ${FILTER_MODE.composite}) {
    let b = sb(pd - P[1].xy, sz);
    let s = clamp(b.a * P[1].z, 0.0, 1.0) * P[2].a;
    o = c + (1.0 - c.a) * vec4f(P[2].rgb * s, s);
  } else if (mode == ${FILTER_MODE.vignette}) {
    let v = (pd / sz - vec2f(0.5)) * 2.0;
    let r = length(v) / 1.41421356;
    let t = smoothstep(P[1].x, P[1].x + P[1].y, r) * P[1].z;
    o = vec4f(c.rgb * (1.0 - t) + P[2].rgb * t * c.a, c.a);
  } else if (mode == ${FILTER_MODE.wave}) {
    let horizontal = P[1].w < 0.5;
    var coord = pd.x;
    if (horizontal) { coord = pd.y; }
    let off = P[1].x * sin(6.283185307 * coord / P[1].y + P[1].z);
    var at = vec2f(pd.x, pd.y + off);
    if (horizontal) { at = vec2f(pd.x + off, pd.y); }
    o = sa(at, sz);
  }
  return o;
}
`;

/**
 * Runs a filter plan with WebGPU: three canvas-sized pictures, one full-screen pass for each step, all in the frame's own command encoder.
 * The renderer draws the group into picture 0 (`view(0)`), then `encode` does the passes and lays the result over the screen.
 */
export class GPUFilterRunner {
  /** @param {GPUDevice} device @param {GPUTextureFormat} canvasFormat */
  constructor(device, canvasFormat) {
    this.device = device;
    this.format = 'rgba8unorm';
    const module = device.createShaderModule({ code: WGSL });
    this.module = module;
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const make = (format, withBlend) => device.createRenderPipeline({
      layout, vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [withBlend ? { format, blend } : { format }] },
      primitive: { topology: 'triangle-strip' },
    });
    this.passPipeline = make(this.format, false);
    this.presentPipeline = make(canvasFormat, true);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.uniforms = null; this.uniformCapacity = 0;
    this.w = 0; this.h = 0; this.pictures = [];
  }

  /** The error messages from compiling the shader, if any. */
  async compilationErrors() { const info = await this.module.getCompilationInfo?.(); return (info?.messages ?? []).filter((m) => m.type === 'error').map((m) => `line ${m.lineNum}: ${m.message}`); }

  #allocate(w, h) {
    for (const p of this.pictures) p.destroy();
    this.pictures = Array.from({ length: FILTER_REGISTERS }, () => this.device.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
    this.views = this.pictures.map((p) => p.createView());
    this.w = w; this.h = h;
  }

  /** Make the pictures the size of the screen; returns the view the group is drawn into. */
  begin(w, h) {
    if (w !== this.w || h !== this.h) this.#allocate(w, h);
    return this.views[0];
  }

  /**
   * Add the passes, and the final one onto `target`, to the encoder.
   * @param {GPUCommandEncoder} encoder @param {ReturnType<typeof import('./filters.js').planFilters>} plan @param {GPUTextureView} target @param {number[] | null} clear
   */
  encode(encoder, plan, target, clear) {
    const { device, w, h } = this;
    const total = plan.passes.length + 1;
    if (total > this.uniformCapacity) {
      this.uniforms?.destroy();
      this.uniformCapacity = Math.max(total, this.uniformCapacity * 2, 8);
      this.uniforms = device.createBuffer({ size: this.uniformCapacity * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    const data = new Float32Array(total * FILTER_UNIFORM_FLOATS);
    plan.passes.forEach((p, i) => { data.set(p.u, i * FILTER_UNIFORM_FLOATS); data[i * FILTER_UNIFORM_FLOATS + 1] = w; data[i * FILTER_UNIFORM_FLOATS + 2] = h; });
    const last = plan.passes.length * FILTER_UNIFORM_FLOATS;
    data[last + 1] = w; data[last + 2] = h;
    device.queue.writeBuffer(this.uniforms, 0, data);
    const group = (a, b) => device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.uniforms, size: 256 } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.views[a] },
        { binding: 3, resource: this.views[b] },
      ],
    });
    plan.passes.forEach((p, i) => {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.views[p.output], loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }] });
      pass.setPipeline(this.passPipeline);
      pass.setBindGroup(0, group(p.inputs[0], p.inputs[1] ?? p.inputs[0]), [i * 256]);
      pass.draw(4);
      pass.end();
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, clearValue: clear ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] } : undefined, loadOp: clear ? 'clear' : 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, group(plan.result, plan.result), [plan.passes.length * 256]);
    pass.draw(4);
    pass.end();
  }

  destroy() { for (const p of this.pictures) p.destroy(); this.uniforms?.destroy(); }
}
