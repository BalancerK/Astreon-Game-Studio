import { PARTICLE_FLOATS, PARTICLE_BYTES, PARTICLE_UNIFORM_FLOATS, PARTICLE_GLSL_VERT, PARTICLE_GLSL_FRAG, writeParticleUniforms } from './particles.js';

/** Draws a ParticleBatch with WebGL2: one instanced draw of camera-facing quads. */
export class GLParticles {
  constructor(gl) {
    this.gl = gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`particle shader error: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, PARTICLE_GLSL_VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, PARTICLE_GLSL_FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`particle link error: ${gl.getProgramInfoLog(p)}`);
    this.loc = { vp: gl.getUniformLocation(p, 'u_viewProj'), right: gl.getUniformLocation(p, 'u_right'), up: gl.getUniformLocation(p, 'u_up'), fwd: gl.getUniformLocation(p, 'u_fwd') };
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    this.capacity = 0;
    this.uniforms = new Float32Array(PARTICLE_UNIFORM_FLOATS);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, PARTICLE_BYTES, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  draw(batch, camera) {
    if (batch.count === 0) return;
    const { gl } = this;
    writeParticleUniforms(this.uniforms, camera);
    const u = this.uniforms;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (batch.count > this.capacity) {
      this.capacity = Math.max(batch.count, this.capacity * 2, 256);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity * PARTICLE_BYTES, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * PARTICLE_FLOATS);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.vp, false, u.subarray(0, 16));
    gl.uniform4fv(this.loc.right, u.subarray(16, 20));
    gl.uniform4fv(this.loc.up, u.subarray(20, 24));
    gl.uniform4fv(this.loc.fwd, u.subarray(24, 28));
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  destroy() { this.gl.deleteBuffer(this.buffer); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.prog); }
}
