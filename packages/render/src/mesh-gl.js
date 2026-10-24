import { MESH_VERTEX_WORDS, MESH_VERTEX_BYTES } from './meshbatch.js';

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_tint;
layout(location=3) in uint a_meta;
uniform vec4 u_cam;
out vec2 v_uv;
out vec4 v_tint;
flat out uint v_meta;
void main() {
  gl_Position = vec4((a_pos.x - u_cam.x) * u_cam.z, (a_pos.y - u_cam.y) * u_cam.w, 0.0, 1.0);
  v_uv = a_uv;
  v_tint = a_tint;
  v_meta = a_meta;
}`;

const FRAG = `#version 300 es
precision mediump float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
in vec2 v_uv;
in vec4 v_tint;
flat in uint v_meta;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, vec3(v_uv, float(v_meta & 255u))) * vec4(v_tint.rgb * v_tint.a, v_tint.a);
  o = (v_meta & 1024u) != 0u ? vec4(c.rgb, 0.0) : c;
}`;

/** Draws a `MeshBatch2D` with WebGL2: one indexed draw call over the same atlas texture array the sprites use. */
export class GLMeshes {
  constructor(gl) {
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`mesh shader error: ${gl.getShaderInfoLog(s)}`); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`mesh link error: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    this.uCam = gl.getUniformLocation(prog, 'u_cam'); this.uTex = gl.getUniformLocation(prog, 'u_tex');
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer(); this.ibo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, MESH_VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, MESH_VERTEX_BYTES, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, MESH_VERTEX_BYTES, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, MESH_VERTEX_BYTES, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);
  }

  /** Draw the meshes; the atlas texture array must be bound to unit 0. @param {Float32Array} camera The camera uniforms. @param {import('./meshbatch.js').MeshBatch2D} meshes */
  draw(camera, meshes) {
    const { gl } = this;
    gl.useProgram(this.prog);
    gl.uniform1i(this.uTex, 0);
    gl.uniform4fv(this.uCam, camera);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, meshes.f32, gl.DYNAMIC_DRAW, 0, meshes.vertexCount * MESH_VERTEX_WORDS);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshes.indices, gl.DYNAMIC_DRAW, 0, meshes.indexCount);
    gl.drawElements(gl.TRIANGLES, meshes.indexCount, gl.UNSIGNED_INT, 0);
  }

  destroy() { const { gl } = this; gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.ibo); gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog); }
}
