import { INSTANCE_BYTES } from './batch.js';
import { MAX_LIGHTS, MAX_SHADOW_LIGHTS, SHADOW_ANGLES, SHADOW_MARCH_STEPS, SUN_STEPS, LIGHTING_UNIFORM_FLOATS } from './lighting.js';

/** The lit sprite shader (see light-gl.js: the same maths). Positions are canvas pixels counted from the top left. */
const LIT_WGSL = `
@group(0) @binding(0) var<uniform> cam: vec4f;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d_array<f32>;
@group(0) @binding(3) var nrm: texture_2d_array<f32>;
@group(0) @binding(4) var<uniform> L: array<vec4f, ${4 + MAX_LIGHTS * 4}>;
@group(0) @binding(5) var maskTex: texture_2d<f32>;
@group(0) @binding(6) var ringTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec4f,
  @location(2) @interpolate(flat) pf: u32,
  @location(3) @interpolate(flat) rot: vec3f,
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
  var mirror = 1.0;
  if (isize.x < 0.0) { mirror = -1.0; }
  o.rot = vec3f(c, s, mirror);
  return o;
}

const TAU = 6.283185307;
const ANGLES = ${SHADOW_ANGLES};

fn maskA(p: vec2f) -> f32 { return textureSampleLevel(maskTex, samp, p / L[2].xy, 0.0).a; }
fn ringAt(row: i32, idx: i32) -> f32 {
  var at = idx;
  if (idx < 0) { at = idx + ANGLES; } else if (idx >= ANGLES) { at = idx - ANGLES; }
  let t = textureLoad(ringTex, vec2i(at, row), 0);
  return floor(t.r * 255.0 + 0.5) * 256.0 / 65535.0 + floor(t.g * 255.0 + 0.5) / 65535.0;
}
fn ringVisibility(row: i32, radius: f32, dir: vec2f, d: f32, size: f32) -> f32 {
  let delta = clamp(size / max(1.0, d), TAU / f32(ANGLES), 0.2);
  var lit = 0.0;
  for (var k = -2; k <= 2; k++) {
    var u = (atan2(dir.y, dir.x) + f32(k) * delta * 0.5) / TAU;
    u -= floor(u);
    let f = u * f32(ANGLES) - 0.5;
    let i0 = floor(f);
    let t = f - i0;
    let a = ringAt(row, i32(i0));
    let b = ringAt(row, i32(i0) + 1);
    if (d <= mix(a, b, t) * radius + 1.5) { lit += 1.0; }
  }
  return lit / 5.0;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let page = i32(i.pf & 255u);
  let t = textureSample(tex, samp, i.uv, page);
  let w = max(fwidth(t.a), 0.0001) * 0.75;
  let a = smoothstep(0.5 - w, 0.5 + w, t.a);
  let sdf = vec4f(i.tint.rgb * i.tint.a * a, i.tint.a * a);
  let plain = t * vec4f(i.tint.rgb * i.tint.a, i.tint.a);
  let c = select(plain, sdf, (i.pf & 256u) != 0u);
  let m = textureSampleLevel(nrm, samp, i.uv, page, 0.0).rgb * 2.0 - vec3f(1.0);
  if ((i.pf & 512u) != 0u || c.a <= 0.0) { return c; }

  let frag = i.pos.xy;
  var n = vec3f(0.0, 0.0, 1.0);
  if (L[3].y > 0.5) {
    let xy = vec2f(m.x * i.rot.z, -m.y);
    n = vec3f(xy.x * i.rot.x - xy.y * i.rot.y, xy.x * i.rot.y + xy.y * i.rot.x, m.z) * vec3f(L[3].x, L[3].x, 1.0);
    n = normalize(n);
  }
  let selfShadow = L[1].z > 0.5;
  let haveMask = L[2].z > 0.5;
  var inside = false;
  if (haveMask && !selfShadow) { inside = maskA(frag) > 0.5; }
  var light = L[0].rgb;
  var shine = vec3f(0.0);
  let shininess = L[1].x;
  let specular = L[1].y;
  let count = i32(L[0].w + 0.5);
  for (var li = 0; li < ${MAX_LIGHTS}; li++) {
    if (li >= count) { break; }
    let l0 = L[4 + li * 4];
    let l1 = L[5 + li * 4];
    let l2 = L[6 + li * 4];
    let l3 = L[7 + li * 4];
    let kind = i32(l1.w + 0.5);
    var ld = vec3f(0.0, 0.0, 1.0);
    var att = 1.0;
    var vis = 1.0;
    if (kind == 2) {
      ld = l2.xyz;
      if (l3.w > 0.0 && haveMask && !inside) {
        let sd = ld.xy / max(length(ld.xy), 1e-6);
        let side = vec2f(-sd.y, sd.x);
        var blocked = 0.0;
        for (var lane = -1; lane <= 1; lane++) {
          var hit = false;
          for (var s = 1; s <= ${SUN_STEPS}; s++) {
            let d = f32(s) / ${SUN_STEPS}.0 * l3.w;
            if (maskA(frag + sd * d + side * f32(lane) * l3.z * 0.5) > 0.5) { hit = true; break; }
          }
          if (hit) { blocked += 1.0; }
        }
        vis = 1.0 - blocked / 3.0;
      }
    } else {
      let dv = l0.xy - frag;
      let d = length(dv);
      if (d >= l0.w) { continue; }
      let tt = clamp(1.0 - (d / l0.w) * (d / l0.w), 0.0, 1.0);
      att = pow(tt, l3.x);
      ld = normalize(vec3f(dv, l0.z));
      if (kind == 1) {
        var cs = 1.0;
        if (d > 0.0) { cs = dot(-dv / d, l2.xy); }
        let e = clamp((cs - l2.z) / max(l2.w - l2.z, 1e-6), 0.0, 1.0);
        att *= e * e * (3.0 - 2.0 * e);
      }
      if (l3.y >= -0.5 && haveMask && !inside && d > 0.0) { vis = ringVisibility(i32(l3.y + 0.5), l0.w, -dv / d, d, l3.z); }
    }
    let lam = clamp(dot(n, ld) / max(ld.z, 1e-3), 0.0, 2.5);
    let k = att * vis;
    light += l1.rgb * (k * lam);
    if (specular > 0.0) {
      let h = normalize(ld + vec3f(0.0, 0.0, 1.0));
      shine += l1.rgb * (pow(max(dot(n, h), 0.0), shininess) * specular * k * clamp((1.0 - n.z) * 4.0, 0.0, 1.0));
    }
  }
  return vec4f(clamp(c.rgb * light + shine * c.a, vec3f(0.0), vec3f(1.0)), c.a);
}
`;

const POLAR_WGSL = `
@group(0) @binding(0) var<uniform> P: array<vec4f, ${MAX_SHADOW_LIGHTS + 1}>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var maskTex: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let c = vec2f(f32(vi & 1u), f32(vi >> 1u));
  return vec4f(c * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let ip = floor(frag.xy);
  let ring = P[i32(ip.y)];
  let size = P[${MAX_SHADOW_LIGHTS}].xy;
  let a = (ip.x + 0.5) / ${SHADOW_ANGLES}.0 * 6.283185307;
  let dir = vec2f(cos(a), sin(a));
  let radius = max(ring.z, 1.0);
  let stp = max(1.0, radius / ${SHADOW_MARCH_STEPS}.0);
  let n = i32(min(${SHADOW_MARCH_STEPS}.0, ceil(radius / stp)));
  var hit = radius;
  for (var s = 1; s <= ${SHADOW_MARCH_STEPS}; s++) {
    if (s > n) { break; }
    let d = f32(s) * stp;
    if (textureSampleLevel(maskTex, samp, (ring.xy + dir * d) / size, 0.0).a > 0.5) { hit = min(d, radius); break; }
  }
  let v16 = floor(hit / radius * 65535.0 + 0.5);
  return vec4f(floor(v16 / 256.0) / 255.0, (v16 - floor(v16 / 256.0) * 256.0) / 255.0, 0.0, 1.0);
}
`;

/** 2D lighting for the WebGPU renderer: the lit sprite pipelines, the occluder picture, the shadow maps and the light block. */
export class GPULighting {
  /** @param {GPUDevice} device @param {GPUSampler} sampler */
  constructor(device, sampler) {
    this.device = device; this.sampler = sampler;
    this.module = device.createShaderModule({ code: LIT_WGSL });
    this.polarModule = device.createShaderModule({ code: POLAR_WGSL });
    this.pipelines = new Map();
    this.lights = device.createBuffer({ size: LIGHTING_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ringUniform = device.createBuffer({ size: (MAX_SHADOW_LIGHTS + 1) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ring = device.createTexture({ size: [SHADOW_ANGLES, MAX_SHADOW_LIGHTS], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.ringView = this.ring.createView();
    this.mask = null; this.maskView = null; this.w = 0; this.h = 0;
    this.polar = device.createRenderPipeline({
      layout: 'auto', vertex: { module: this.polarModule, entryPoint: 'vs' },
      fragment: { module: this.polarModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-strip' },
    });
  }

  /** The error messages from compiling the shaders, if any. */
  async compilationErrors() {
    const out = [];
    for (const m of [this.module, this.polarModule]) { const info = await m.getCompilationInfo?.(); for (const x of info?.messages ?? []) if (x.type === 'error') out.push(`line ${x.lineNum}: ${x.message}`); }
    return out;
  }

  /** The lit sprite pipeline drawing into a target of this format. */
  pipeline(format) {
    let p = this.pipelines.get(format);
    if (!p) {
      const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
      p = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: this.module, entryPoint: 'vs',
          buffers: [{
            arrayStride: INSTANCE_BYTES, stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }, { shaderLocation: 2, offset: 16, format: 'float32' },
              { shaderLocation: 3, offset: 20, format: 'float32x4' }, { shaderLocation: 4, offset: 36, format: 'unorm8x4' }, { shaderLocation: 5, offset: 40, format: 'uint32' },
            ],
          }],
        },
        fragment: { module: this.module, entryPoint: 'fs', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-strip' },
      });
      this.pipelines.set(format, p);
    }
    return p;
  }

  /** The bind group for a lit draw. */
  bindGroup(pipeline, camera, colourView, normalView) {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: camera } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: colourView }, { binding: 3, resource: normalView },
        { binding: 4, resource: { buffer: this.lights } }, { binding: 5, resource: this.maskView ?? this.ringView }, { binding: 6, resource: this.ringView },
      ],
    });
  }

  /** Make the occluder picture the size of the screen; returns the view the occluders are drawn into. */
  beginMask(w, h) {
    if (w !== this.w || h !== this.h) {
      this.mask?.destroy();
      this.mask = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.maskView = this.mask.createView(); this.w = w; this.h = h;
    }
    return this.maskView;
  }

  /** Upload the light block. */
  upload(pack) { this.device.queue.writeBuffer(this.lights, 0, pack.data); }

  /** Add the pass that fills the shadow maps of the shadow-casting lights from the occluder picture. */
  encodeShadows(encoder, rows) {
    const data = new Float32Array((MAX_SHADOW_LIGHTS + 1) * 4);
    rows.forEach((r, i) => { data[i * 4] = r.x; data[i * 4 + 1] = r.y; data[i * 4 + 2] = r.radius; });
    data[MAX_SHADOW_LIGHTS * 4] = this.w; data[MAX_SHADOW_LIGHTS * 4 + 1] = this.h;
    this.device.queue.writeBuffer(this.ringUniform, 0, data);
    const group = this.device.createBindGroup({
      layout: this.polar.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.ringUniform } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.maskView }],
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.ringView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.polar);
    pass.setBindGroup(0, group);
    pass.draw(4);
    pass.end();
  }

  destroy() { this.mask?.destroy(); this.ring.destroy(); this.lights.destroy(); this.ringUniform.destroy(); }
}
