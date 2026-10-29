import { INSTANCE_WORDS, INSTANCE_BYTES } from './batch.js';
import { planFilters } from './filters.js';
import { GLFilterRunner } from './filter-gl.js';
import { packLighting } from './lighting.js';
import { GLLighting } from './light-gl.js';
import { GLMeshes } from './mesh-gl.js';

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_size;
layout(location=2) in float a_rot;
layout(location=3) in vec4 a_uv;
layout(location=4) in vec4 a_tint;
layout(location=5) in uint a_meta;
uniform vec4 u_cam;
out vec2 v_uv;
out vec4 v_tint;
flat out uint v_meta;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) - 0.5;
  float c = cos(a_rot), s = sin(a_rot);
  vec2 l = corner * a_size;
  vec2 w = a_pos + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  gl_Position = vec4((w.x - u_cam.x) * u_cam.z, (w.y - u_cam.y) * u_cam.w, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, corner + 0.5);
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
  vec4 t = texture(u_tex, vec3(v_uv, float(v_meta & 255u)));
  float w = max(fwidth(t.a), 0.0001) * 0.75; // derivatives are taken outside the branch (they need uniform control flow)
  if ((v_meta & 256u) != 0u) {
    // signed distance field: 0.5 is the outline; the screen-space slope gives a one-pixel anti-aliased edge at any scale
    float a = smoothstep(0.5 - w, 0.5 + w, t.a);
    o = vec4(v_tint.rgb * v_tint.a * a, v_tint.a * a);
  } else {
    o = t * vec4(v_tint.rgb * v_tint.a, v_tint.a);
  }
}`;

/** Instanced-quad renderer: the whole batch is one draw call. */
export class WebGL2Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./atlas.js').Atlas} atlas
   * @param {{transparent?: boolean}} [o] See Canvas2DRenderer.
   */
  constructor(canvas, atlas, { transparent = false, filter = 'linear' } = {}) {
    const gl = canvas.getContext('webgl2', { alpha: transparent, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.kind = 'webgl2';
    this.transparent = transparent;
    /** How sprites are sampled when scaled: `'linear'` (smooth) or `'nearest'` (hard pixels, for pixel art). Change with `setFilter`. */
    this.filter = filter === 'nearest' ? 'nearest' : 'linear';
    this.canvas = canvas;
    this.gl = gl;
    this.atlas = atlas;
    this.pageVersions = [];   // what has been uploaded of each atlas page
    this.layers = 0;          // layers currently allocated in the texture array
    this.lost = false;
    this.onLost = null;
    this.dpr = 1;
    this.filterRunner = null;
    this.lightingGl = null;
    this.meshesGl = null;
    this.normalTexture = null;
    this.normalLayers = 0;
    this.normalVersions = [];
    /** 2D lighting (`render({ lighting })`) is available. */
    this.lightingSupported = true;
    this.camera = new Float32Array(4);
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.onLost?.(); });
    this.#init();
  }

  #compile(type, src) {
    const { gl } = this;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader error: ${gl.getShaderInfoLog(sh)}`);
    return sh;
  }

  #init() {
    const { gl } = this;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.#compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, this.#compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link error: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    this.uCam = gl.getUniformLocation(prog, 'u_cam');
    this.uTex = gl.getUniformLocation(prog, 'u_tex');

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const attr = (loc, size, type, normalized, offset) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, INSTANCE_BYTES, offset);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(0, 2, gl.FLOAT, false, 0);          // position
    attr(1, 2, gl.FLOAT, false, 8);          // size
    attr(2, 1, gl.FLOAT, false, 16);         // rotation
    attr(3, 4, gl.FLOAT, false, 20);         // uv rect
    attr(4, 4, gl.UNSIGNED_BYTE, true, 36);  // tint, R,G,B,A bytes
    gl.enableVertexAttribArray(5);           // meta: atlas page and flags (an integer attribute)
    gl.vertexAttribIPointer(5, 1, gl.UNSIGNED_INT, INSTANCE_BYTES, 40);
    gl.vertexAttribDivisor(5, 1);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    this.#applyFilter();
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha
  }

  #applyFilter() {
    const { gl } = this, f = this.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, f);
  }

  /** Switch between smooth (`'linear'`) and hard-pixel (`'nearest'`) sampling of sprites, meshes and normal maps. Text drawn as scalable (SDF) glyphs needs `'linear'`. @param {'linear' | 'nearest'} mode */
  setFilter(mode) {
    this.filter = mode === 'nearest' ? 'nearest' : 'linear';
    const { gl } = this;
    for (const tex of [this.texture, this.normalTexture]) if (tex) { gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); this.#applyFilter(); }
  }

  /** Upload only the atlas pages that changed, growing the texture array (and re-uploading everything) when pages were added. */
  #uploadPages() {
    const { gl, atlas } = this;
    const pages = atlas.pages;
    if (pages.length > this.layers) {
      this.layers = Math.min(atlas.maxPages, Math.max(pages.length, this.layers * 2, 2));
      gl.deleteTexture(this.texture);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
      this.#applyFilter();
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, atlas.size, atlas.size, this.layers);
      this.pageVersions = [];
    }
    for (let i = 0; i < pages.length; i++) {
      if (this.pageVersions[i] === pages[i].version) continue;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, atlas.size, atlas.size, 1, gl.RGBA, gl.UNSIGNED_BYTE, pages[i].canvas);
      this.pageVersions[i] = pages[i].version;
    }
    if (atlas.hasNormals) this.#uploadNormals();
  }

  /** The normal-map twins of the atlas pages, as a second texture array (only once the atlas has any normal maps). */
  #uploadNormals() {
    const { gl, atlas } = this;
    const pages = atlas.pages;
    if (!this.normalTexture || this.normalLayers !== this.layers) {
      if (this.normalTexture) gl.deleteTexture(this.normalTexture);
      this.normalTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normalTexture);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, this.filter === 'nearest' ? gl.NEAREST : gl.LINEAR], [gl.TEXTURE_MAG_FILTER, this.filter === 'nearest' ? gl.NEAREST : gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, atlas.size, atlas.size, this.layers);
      this.normalLayers = this.layers; this.normalVersions = [];
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normalTexture);
    for (let i = 0; i < pages.length; i++) {
      const n = pages[i].normals;
      if (!n || this.normalVersions[i] === n.version) continue;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, atlas.size, atlas.size, 1, gl.RGBA, gl.UNSIGNED_BYTE, n.canvas);
      this.normalVersions[i] = n.version;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
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
   * `clear: null` keeps the previous contents (draw an overlay pass). `filters` (see `Filter`) run over this batch alone, then the result is laid over the frame.
   * `lighting` (see `Lighting2D`) lights this batch; `occluders` is a batch of the things that block light, drawn in the same camera, for shadows.
   * `meshes` (a `MeshBatch2D`: skeletons, ropes, anything of triangles) is drawn after the sprites, unlit.
   */
  render({ camera, batch, clear = this.transparent ? [0, 0, 0, 0] : [0.05, 0.05, 0.08, 1], filters, lighting, occluders, meshes }) {
    const { gl } = this;
    if (this.lost) return;
    batch.sort();
    const plan = filters?.length ? planFilters(filters, { scale: this.dpr }) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (clear) { // `clear: null` draws on top of what is already there (HUD / overlay pass)
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    const hasMeshes = !!meshes && meshes.indexCount > 0;
    if (batch.count === 0 && !hasMeshes) return;
    let lit = null;
    if (lighting && lighting.enabled !== false) {
      this.lightingGl ??= new GLLighting(gl);
      const w = this.canvas.width, h = this.canvas.height, blockers = occluders && occluders.count > 0;
      const pack = packLighting(lighting, camera, { dpr: this.dpr, width: w, height: h, hasOccluders: !!blockers, hasNormals: this.atlas.hasNormals });
      if (blockers && (pack.shadowRows.length > 0 || pack.sun)) {
        occluders.sort();
        this.lightingGl.beginMask(w, h);
        this.#drawBatch(camera, occluders, null);
        if (pack.shadowRows.length) this.lightingGl.buildShadows(pack.shadowRows);
      } else pack.data[10] = 0;
      lit = pack;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }
    if (plan) {
      this.filterRunner ??= new GLFilterRunner(gl);
      this.filterRunner.begin(this.canvas.width, this.canvas.height);
    }
    this.#drawBatch(camera, batch, lit);
    if (hasMeshes) this.#drawMeshes(camera, meshes);
    if (plan) {
      this.filterRunner.finish(plan);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  /**
   * Several batches in order, each with its own filters (and camera): a world, then a glowing boss, then the HUD.
   * @param {{camera: import('./camera.js').Camera, clear?: number[] | null, layers: {batch: import('./batch.js').SpriteBatch, filters?: object[], camera?: import('./camera.js').Camera, lighting?: import('./lighting.js').Lighting2D, occluders?: import('./batch.js').SpriteBatch, meshes?: import('./meshbatch.js').MeshBatch2D}[]}} frame
   */
  renderLayers({ camera, clear, layers }) {
    layers.forEach((l, i) => this.render({ camera: l.camera ?? camera, batch: l.batch, filters: l.filters, lighting: l.lighting, occluders: l.occluders, meshes: l.meshes, ...(i === 0 ? (clear === undefined ? {} : { clear }) : { clear: null }) }));
  }

  #drawMeshes(camera, meshes) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    this.#uploadPages();
    this.meshesGl ??= new GLMeshes(gl);
    this.meshesGl.draw(camera.uniforms(this.camera), meshes);
  }

  #drawBatch(camera, batch, lit) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    this.#uploadPages();
    if (lit) {
      const L = this.lightingGl;
      gl.useProgram(L.program);
      gl.uniform4fv(L.loc.cam, camera.uniforms(this.camera));
      L.bind(lit);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.hasNormals && this.normalTexture ? this.normalTexture : this.texture);
      gl.activeTexture(gl.TEXTURE0);
    } else {
      gl.useProgram(this.prog);
      gl.uniform1i(this.uTex, 0);
      gl.uniform4fv(this.uCam, camera.uniforms(this.camera));
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // Re-specifying the data each frame lets the driver orphan the old buffer instead of stalling.
    gl.bufferData(gl.ARRAY_BUFFER, batch.f32, gl.DYNAMIC_DRAW, 0, batch.count * INSTANCE_WORDS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
  }

  destroy() {
    const { gl } = this;
    this.filterRunner?.destroy();
    this.lightingGl?.destroy();
    this.meshesGl?.destroy();
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.texture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
