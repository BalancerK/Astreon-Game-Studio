import { PARTICLE_BYTES, PARTICLE_FLOATS, PARTICLE_UNIFORM_FLOATS, PARTICLE_WGSL, writeParticleUniforms } from './particles.js';

/** Draws a ParticleBatch with WebGPU inside the main render pass: one instanced draw of camera-facing quads. */
export class GPUParticles {
  constructor(device, format, samples) {
    this.device = device;
    const module = device.createShaderModule({ code: PARTICLE_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'pvs', buffers: [{ arrayStride: PARTICLE_BYTES, stepMode: 'instance', attributes: [0, 1, 2, 3].map((i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' })) }] },
      fragment: { module, entryPoint: 'pfs', targets: [{ format, blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: samples },
    });
    this.uniformBuffer = device.createBuffer({ size: PARTICLE_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }] });
    this.uniforms = new Float32Array(PARTICLE_UNIFORM_FLOATS);
    this.buffer = null;
    this.capacity = 0;
  }

  /** Upload the batch (before the pass is encoded). Returns the instance count to draw. */
  prepare(batch, camera) {
    if (batch.count === 0) return 0;
    const { device } = this;
    if (batch.count > this.capacity) {
      this.buffer?.destroy();
      this.capacity = Math.max(batch.count, this.capacity * 2, 256);
      this.buffer = device.createBuffer({ size: this.capacity * PARTICLE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    writeParticleUniforms(this.uniforms, camera);
    device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
    device.queue.writeBuffer(this.buffer, 0, batch.data, 0, batch.count * PARTICLE_FLOATS);
    return batch.count;
  }

  draw(pass, count) {
    if (count === 0) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.buffer);
    pass.draw(4, count);
  }

  destroy() { this.buffer?.destroy(); this.uniformBuffer.destroy(); }
}
