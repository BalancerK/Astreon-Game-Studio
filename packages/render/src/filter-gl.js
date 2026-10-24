import { FILTER_MODE, FILTER_REGISTERS, BLUR_HALF_TAPS, OUTLINE_RINGS, OUTLINE_DIRECTIONS } from './filters.js';

const VERT = `#version 300 es
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The one shader for every pass: the first uniform says which. Positions here are pixels counted from the top left (y down), as in the CPU reference. */
const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform vec4 u_p[16];
out vec4 o;
vec2 sz;
vec4 sa(vec2 pd) { return texture(u_a, vec2(pd.x / sz.x, 1.0 - pd.y / sz.y)); }
vec4 sb(vec2 pd) { return texture(u_b, vec2(pd.x / sz.x, 1.0 - pd.y / sz.y)); }
float stopPos(int i) { return u_p[2 + i / 4][i - (i / 4) * 4]; }
void main() {
  sz = u_p[0].yz;
  int mode = int(u_p[0].x + 0.5);
  vec2 ip = vec2(floor(gl_FragCoord.x), sz.y - 1.0 - floor(gl_FragCoord.y));
  vec2 pd = ip + 0.5;
  vec4 c = sa(pd);
  if (mode == ${FILTER_MODE.copy}) { o = c; return; }
  if (mode == ${FILTER_MODE.matrix}) {
    float a = c.a;
    vec4 v = vec4(a > 0.0 ? c.rgb / a : vec3(0.0), a);
    vec4 r = vec4(dot(u_p[1], v), dot(u_p[2], v), dot(u_p[3], v), dot(u_p[4], v)) + u_p[5];
    r = clamp(r, 0.0, 1.0);
    o = vec4(r.rgb * r.a, r.a);
    return;
  }
  if (mode == ${FILTER_MODE.blur}) {
    vec2 stp = u_p[1].xy;
    float sig = u_p[1].z;
    vec4 acc = vec4(0.0);
    float ws = 0.0;
    for (int k = -${BLUR_HALF_TAPS}; k <= ${BLUR_HALF_TAPS}; k++) {
      float fk = float(k);
      float wt = exp(-0.5 * (fk / sig) * (fk / sig));
      acc += sa(pd + fk * stp) * wt;
      ws += wt;
    }
    o = acc / ws;
    return;
  }
  if (mode == ${FILTER_MODE.outline}) {
    float m = 0.0;
    for (int ring = 1; ring <= ${OUTLINE_RINGS}; ring++) {
      float d = u_p[1].x * float(ring) / ${OUTLINE_RINGS}.0;
      for (int k = 0; k < ${OUTLINE_DIRECTIONS}; k++) {
        float ang = float(k) * ${(2 * Math.PI / OUTLINE_DIRECTIONS).toFixed(9)};
        m = max(m, sa(pd + d * vec2(cos(ang), sin(ang))).a);
      }
    }
    float oa = u_p[2].a * m;
    o = c + (1.0 - c.a) * vec4(u_p[2].rgb * oa, oa);
    return;
  }
  if (mode == ${FILTER_MODE.pixelate}) {
    float cell = u_p[1].x;
    float cx = min(sz.x - 1.0, floor(ip.x / cell) * cell + floor(cell / 2.0));
    float cy = min(sz.y - 1.0, floor(ip.y / cell) * cell + floor(cell / 2.0));
    o = texelFetch(u_a, ivec2(int(cx), int(sz.y - 1.0 - cy)), 0);
    return;
  }
  if (mode == ${FILTER_MODE.gradient}) {
    float a = c.a;
    vec3 rgb = a > 0.0 ? c.rgb / a : vec3(0.0);
    float lum = clamp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    int n = int(u_p[1].x + 0.5);
    int i0 = 0, i1 = 0;
    float f = 0.0;
    if (lum <= stopPos(0)) { i0 = 0; i1 = 0; }
    else if (lum >= stopPos(n - 1)) { i0 = n - 1; i1 = n - 1; }
    else {
      for (int i = 0; i < 7; i++) {
        if (i >= n - 1) break;
        float p0 = stopPos(i), p1 = stopPos(i + 1);
        if (lum >= p0 && lum <= p1) { i0 = i; i1 = i + 1; f = (lum - p0) / max(1e-6, p1 - p0); break; }
      }
    }
    vec4 col = mix(u_p[4 + i0], u_p[4 + i1], f);
    float ca = col.a * a;
    o = vec4(col.rgb * ca, ca);
    return;
  }
  if (mode == ${FILTER_MODE.composite}) {
    vec4 b = sb(pd - u_p[1].xy);
    float s = clamp(b.a * u_p[1].z, 0.0, 1.0) * u_p[2].a;
    o = c + (1.0 - c.a) * vec4(u_p[2].rgb * s, s);
    return;
  }
  if (mode == ${FILTER_MODE.vignette}) {
    vec2 v = (pd / sz - 0.5) * 2.0;
    float r = length(v) / 1.41421356;
    float t = smoothstep(u_p[1].x, u_p[1].x + u_p[1].y, r) * u_p[1].z;
    o = vec4(c.rgb * (1.0 - t) + u_p[2].rgb * t * c.a, c.a);
    return;
  }
  if (mode == ${FILTER_MODE.wave}) {
    bool horizontal = u_p[1].w < 0.5;
    float off = u_p[1].x * sin(6.283185307 * (horizontal ? pd.y : pd.x) / u_p[1].y + u_p[1].z);
    o = sa(horizontal ? vec2(pd.x + off, pd.y) : vec2(pd.x, pd.y + off));
    return;
  }
  o = c;
}`;

/**
 * Runs a filter plan with WebGL2: three canvas-sized pictures, one full-screen pass for each step. The group is drawn into picture 0 by the renderer (`target(0)`), then `run` does the
 * passes and lays the result over the screen.
 */
export class GLFilterRunner {
  constructor(gl) {
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`filter shader error: ${gl.getShaderInfoLog(s)}`); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`filter link error: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
    this.uA = gl.getUniformLocation(prog, 'u_a'); this.uB = gl.getUniformLocation(prog, 'u_b'); this.uP = gl.getUniformLocation(prog, 'u_p');
    this.vao = gl.createVertexArray();
    this.w = 0; this.h = 0;
    this.pictures = [];
  }

  #allocate(w, h) {
    const { gl } = this;
    for (const p of this.pictures) { gl.deleteTexture(p.tex); gl.deleteFramebuffer(p.fbo); }
    this.pictures = [];
    for (let i = 0; i < FILTER_REGISTERS; i++) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.pictures.push({ tex, fbo });
    }
    this.w = w; this.h = h;
  }

  /** Make the pictures the size of the screen and aim drawing at picture 0, cleared to transparent. */
  begin(w, h) {
    const { gl } = this;
    if (w !== this.w || h !== this.h) this.#allocate(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pictures[0].fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Run the passes, then draw the result over the default framebuffer (blended, premultiplied). The caller has cleared it (or not) already. */
  finish(plan) {
    const { gl, w, h } = this;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.uniform1i(this.uA, 0); gl.uniform1i(this.uB, 1);
    const draw = (p, input0, input1) => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pictures[input0].tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.pictures[input1].tex);
      p.u[1] = w; p.u[2] = h;
      gl.uniform4fv(this.uP, p.u);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    gl.viewport(0, 0, w, h);
    for (const p of plan.passes) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pictures[p.output].fbo);
      draw(p, p.inputs[0], p.inputs[1] ?? p.inputs[0]);
    }
    return this.#present(plan.result, w, h);
  }

  #present(result, w, h) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = new Float32Array(64); u[1] = w; u[2] = h;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pictures[result].tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.pictures[result].tex);
    gl.uniform4fv(this.uP, u);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  destroy() {
    const { gl } = this;
    for (const p of this.pictures) { gl.deleteTexture(p.tex); gl.deleteFramebuffer(p.fbo); }
    gl.deleteProgram(this.prog); gl.deleteVertexArray(this.vao);
  }
}
