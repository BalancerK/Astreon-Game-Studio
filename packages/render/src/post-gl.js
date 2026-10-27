import {
  resolvePostOptions, writePostUniforms, writeFxUniforms, aoSize, bloomLevels, POST_UNIFORM_FLOATS, FX_UNIFORM_FLOATS,
  POST_GLSL_VERT, POST_GLSL_DOWN, POST_GLSL_UP, POST_GLSL_COMPOSITE, POST_GLSL_AO, POST_GLSL_AOBLUR, POST_GLSL_DOF, POST_GLSL_FXAA,
} from './post.js';

/**
 * Post-processing with WebGL2: the scene goes into a (multisampled) half-float framebuffer, then (each only when asked for) ambient occlusion, depth of field, bloom,
 * the final composite, and FXAA. The depth effects read the scene's depth, kept in a texture.
 */
export class GLPost {
  constructor(gl, samples) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('post-processing needs float render targets (EXT_color_buffer_float)');
    gl.getExtension('OES_texture_float_linear');
    this.samples = Math.min(samples, gl.getParameter(gl.MAX_SAMPLES));
    this.compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`post shader error: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    this.programs = new Map();
    this.down = this.#program('down', POST_GLSL_DOWN, ['u_src', 'u_bp', 'u_bq']);
    this.up = this.#program('up', POST_GLSL_UP, ['u_src', 'u_bp', 'u_bq']);
    this.comp = this.#program('comp', POST_GLSL_COMPOSITE, ['u_scene', 'u_bloom', 'u_ao', 'u_gr']);
    this.vao = gl.createVertexArray();
    this.w = 0; this.h = 0; this.key = '';
    this.msaaFbo = null; this.msaaColor = null; this.msaaDepth = null;
    this.sceneFbo = null; this.sceneTex = null; this.depthTex = null;
    this.levels = []; // {tex, fbo, w, h}
    this.extra = [];  // the other targets: ao, depth of field, the picture before FXAA
    this.black = gl.createTexture(); // bound as the bloom texture when bloom is off
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.uniforms = new Float32Array(POST_UNIFORM_FLOATS);
    this.fxUniforms = new Float32Array(FX_UNIFORM_FLOATS);
  }

  /** A program with the full-screen vertex shader and this fragment shader, made the first time it is asked for. @returns {{program: WebGLProgram, loc: Record<string, WebGLUniformLocation>}} */
  #program(name, frag, uniforms) {
    let p = this.programs.get(name);
    if (!p) {
      const { gl } = this;
      const program = gl.createProgram();
      gl.attachShader(program, this.compile(gl.VERTEX_SHADER, POST_GLSL_VERT));
      gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`post link error: ${gl.getProgramInfoLog(program)}`);
      p = { program, loc: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(program, n)])) };
      this.programs.set(name, p);
    }
    return p;
  }

  #texture(w, h, format = this.gl.RGBA16F) {
    const { gl } = this;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  #free() {
    const { gl } = this;
    for (const l of [...this.levels, ...this.extra]) { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fbo); }
    this.levels = []; this.extra = [];
    if (this.sceneFbo) { gl.deleteFramebuffer(this.sceneFbo); gl.deleteTexture(this.sceneTex); this.sceneFbo = this.sceneTex = null; }
    if (this.depthTex) { gl.deleteTexture(this.depthTex); this.depthTex = null; }
    if (this.msaaFbo) { gl.deleteFramebuffer(this.msaaFbo); gl.deleteRenderbuffer(this.msaaColor); gl.deleteRenderbuffer(this.msaaDepth); this.msaaFbo = null; }
    this.ao = this.dofTarget = this.ldr = null;
  }

  #size(w, h, p) {
    const { gl } = this;
    const want = p.bloom ? bloomLevels(w, h, p.bloom.levels) : [];
    const key = [w, h, want.length, p.ao ? p.ao.scale : 0, p.dof ? 1 : 0, p.fxaa ? 1 : 0, p.needsDepth ? 1 : 0].join(',');
    if (key === this.key && this.sceneFbo) return;
    this.#free();
    this.key = key;
    this.w = w; this.h = h;
    const scene = this.#texture(w, h);
    this.sceneTex = scene.tex; this.sceneFbo = scene.fbo;
    const depthTexture = () => { // the depth as a texture the depth effects can read (nearest only: depth is not filtered)
      this.depthTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    };
    if (this.samples > 1) {
      this.msaaFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
      this.msaaColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA16F, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColor);
      this.msaaDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
      if (p.needsDepth) depthTexture(); // resolved from the multisampled depth
    } else depthTexture(); // no multisampling: the scene is drawn straight into this target, depth and all
    for (const s of want) this.levels.push(this.#texture(s.w, s.h));
    const extra = (tw, th, format) => { const t = this.#texture(tw, th, format); this.extra.push(t); return t; };
    if (p.ao) { const s = aoSize(w, h, p.ao); this.ao = { a: extra(s.w, s.h, gl.R8), b: extra(s.w, s.h, gl.R8) }; }
    if (p.dof) this.dofTarget = extra(w, h, gl.RGBA16F);
    if (p.fxaa) this.ldr = extra(w, h, gl.RGBA8);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Bind the HDR target the scene is drawn into (call before clearing and drawing). */
  begin(width, height, options, camera) {
    this.options = resolvePostOptions(options, camera);
    this.camera = camera;
    this.#size(width, height, this.options);
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? this.sceneFbo);
  }

  /** Resolve the scene, run the effects, make the bloom, and draw the finished picture to the canvas. */
  finish() {
    const { gl } = this, p = this.options;
    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneFbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, p.needsDepth ? gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT : gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    const full = (target, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    if (p.needsDepth) {
      writeFxUniforms(this.fxUniforms, p, this.camera, this.w, this.h);
      const fxProgram = (name, frag, extra) => {
        const q = this.#program(name, frag, ['u_fx', 'u_depth', ...extra]);
        gl.useProgram(q.program); gl.uniform4fv(q.loc.u_fx, this.fxUniforms); gl.uniform1i(q.loc.u_depth, 1); bind(1, this.depthTex);
        return q.loc;
      };
      if (p.ao) {
        fxProgram('ao', POST_GLSL_AO, []);
        full(this.ao.a.fbo, this.ao.a.w, this.ao.a.h);
        const blur = fxProgram('aoBlur', POST_GLSL_AOBLUR, ['u_src', 'u_dir']);
        gl.uniform1i(blur.u_src, 0);
        bind(0, this.ao.a.tex); gl.uniform2f(blur.u_dir, 1, 0); full(this.ao.b.fbo, this.ao.b.w, this.ao.b.h);
        bind(0, this.ao.b.tex); gl.uniform2f(blur.u_dir, 0, 1); full(this.ao.a.fbo, this.ao.a.w, this.ao.a.h);
      }
      if (p.dof) {
        const dof = fxProgram('dof', POST_GLSL_DOF, ['u_src']);
        gl.uniform1i(dof.u_src, 0); bind(0, this.sceneTex);
        full(this.dofTarget.fbo, this.w, this.h);
      }
    }
    const colorTex = this.dofTarget?.tex ?? this.sceneTex;   // what bloom and the composite read
    let bloomTex = this.black;
    if (p.bloom && this.levels.length > 0) {
      let src = { tex: colorTex, w: this.w, h: this.h };
      gl.useProgram(this.down.program);
      gl.uniform1i(this.down.loc.u_src, 0);
      this.levels.forEach((lv, i) => { // down: the first level also keeps only what is bright
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fbo);
        gl.viewport(0, 0, lv.w, lv.h);
        bind(0, src.tex);
        gl.uniform4f(this.down.loc.u_bp, 1 / src.w, 1 / src.h, p.bloom.threshold, p.bloom.knee);
        gl.uniform2f(this.down.loc.u_bq, i === 0 ? 1 : 0, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = lv;
      });
      gl.useProgram(this.up.program);
      gl.uniform1i(this.up.loc.u_src, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.levels.length - 1; i > 0; i--) { // up: each level adds the blurred level below it
        const from = this.levels[i], to = this.levels[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
        gl.viewport(0, 0, to.w, to.h);
        bind(0, from.tex);
        gl.uniform4f(this.up.loc.u_bp, 1 / from.w, 1 / from.h, 0, 0);
        gl.uniform2f(this.up.loc.u_bq, 0, p.bloom.radius);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
      bloomTex = this.levels[0].tex;
    }
    gl.useProgram(this.comp.program);
    writePostUniforms(this.uniforms, p, this.w / Math.max(1, this.h));
    gl.uniform4fv(this.comp.loc.u_gr, this.uniforms);
    gl.uniform1i(this.comp.loc.u_scene, 0); gl.uniform1i(this.comp.loc.u_bloom, 1); gl.uniform1i(this.comp.loc.u_ao, 2);
    bind(2, this.ao?.a.tex ?? this.black); bind(1, bloomTex); bind(0, colorTex);
    full(p.fxaa ? this.ldr.fbo : null, this.w, this.h);
    if (p.fxaa) {
      writeFxUniforms(this.fxUniforms, p, this.camera, this.w, this.h);
      const q = this.#program('fxaa', POST_GLSL_FXAA, ['u_fx', 'u_src']);
      gl.useProgram(q.program); gl.uniform4fv(q.loc.u_fx, this.fxUniforms); gl.uniform1i(q.loc.u_src, 0);
      bind(0, this.ldr.tex);
      full(null, this.w, this.h);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // the scene's blending (premultiplied alpha), as the renderer left it
  }

  destroy() {
    const { gl } = this;
    this.#free();
    gl.deleteTexture(this.black); gl.deleteVertexArray(this.vao);
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
  }
}
