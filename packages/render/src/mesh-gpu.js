import { MESH_VERTEX_WORDS, MESH_VERTEX_BYTES } from './meshbatch.js';

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
fn vs(@location(0) p: vec2f, @location(1) uv: vec2f, @location(2) tint: vec4f, @location(3) pf: u32) -> VOut {
  var o: VOut;
  o.pos = vec4f((p.x - cam.x) * cam.z, (p.y - cam.y) * cam.w, 0.0, 1.0);
  o.uv = uv;
  o.tint = tint;
  o.pf = pf;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let c = textureSample(tex, samp, i.uv, i32(i.pf & 255u)) * vec4f(i.tint.rgb * i.tint.a, i.tint.a);
  return select(c, vec4f(c.rgb, 0.0), (i.pf & 1024u) != 0u);
}
`;

/** Draws a `MeshBatch2D` with WebGPU: one indexed draw over the same atlas texture array the sprites use. */
export class GPUMeshes {
  /** @param {GPUDevice} device */
  constructor(device) {
    this.device = device;
    this.module = device.createShaderModule({ code: WGSL });
    this.pipelines = new Map();
    this.vertexBuffer = null; this.vertexCapacity = 0; this.indexBuffer = null; this.indexCapacity = 0;
  }

  #pipeline(format) {
    let p = this.pipelines.get(format);
    if (!p) {
      const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
      p = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: this.module, entryPoint: 'vs',
          buffers: [{ arrayStride: MESH_VERTEX_BYTES, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'unorm8x4' }, { shaderLocation: 3, offset: 20, format: 'uint32' }] }],
        },
        fragment: { module: this.module, entryPoint: 'fs', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
      this.pipelines.set(format, p);
    }
    return p;
  }

  /** Copy the meshes to the GPU (before the frame's commands are submitted). @param {import('./meshbatch.js').MeshBatch2D} meshes */
  upload(meshes) {
    const { device } = this;
    if (meshes.vertexCount > this.vertexCapacity) {
      this.vertexBuffer?.destroy();
      this.vertexCapacity = Math.max(meshes.vertexCount, this.vertexCapacity * 2, 256);
      this.vertexBuffer = device.createBuffer({ size: this.vertexCapacity * MESH_VERTEX_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (meshes.indexCount > this.indexCapacity) {
      this.indexBuffer?.destroy();
      this.indexCapacity = Math.max(meshes.indexCount, this.indexCapacity * 2, 768);
      this.indexBuffer = device.createBuffer({ size: this.indexCapacity * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    device.queue.writeBuffer(this.vertexBuffer, 0, meshes.f32, 0, meshes.vertexCount * MESH_VERTEX_WORDS);
    device.queue.writeBuffer(this.indexBuffer, 0, meshes.indices, 0, meshes.indexCount);
  }

  /** Add the draw to a pass. @param {GPURenderPassEncoder} pass @param {GPUTextureFormat} format @param {GPUBuffer} camera @param {GPUSampler} sampler @param {GPUTextureView} atlasView @param {import('./meshbatch.js').MeshBatch2D} meshes */
  draw(pass, format, camera, sampler, atlasView, meshes) {
    const pipeline = this.#pipeline(format);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: camera } }, { binding: 1, resource: sampler }, { binding: 2, resource: atlasView }] }));
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint32');
    pass.drawIndexed(meshes.indexCount);
  }

  destroy() { this.vertexBuffer?.destroy(); this.indexBuffer?.destroy(); }
}
