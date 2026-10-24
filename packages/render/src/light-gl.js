import { MAX_LIGHTS, MAX_SHADOW_LIGHTS, SHADOW_ANGLES, SHADOW_MARCH_STEPS, SUN_STEPS, LIGHTING_UNIFORM_FLOATS } from './lighting.js';

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
flat out vec3 v_rot;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) - 0.5;
  float c = cos(a_rot), s = sin(a_rot);
  vec2 l = corner * a_size;
  vec2 w = a_pos + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  gl_Position = vec4((w.x - u_cam.x) * u_cam.z, (w.y - u_cam.y) * u_cam.w, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, corner + 0.5);
  v_tint = a_tint;
  v_meta = a_meta;
  v_rot = vec3(c, s, a_size.x < 0.0 ? -1.0 : 1.0);
}`;

/** The same sprite shader with the lighting added after the colour is worked out. Positions are canvas pixels counted from the top left. */
const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2D;
uniform sampler2DArray u_tex;
uniform sampler2DArray u_nrm;
uniform sampler2D u_mask;
uniform sampler2D u_shadow;
layout(std140) uniform Lights { vec4 L[${4 + MAX_LIGHTS * 4}]; };
in vec2 v_uv;
in vec4 v_tint;
flat in uint v_meta;
flat in vec3 v_rot;
out vec4 o;

const float TAU = 6.283185307;
const int ANGLES = ${SHADOW_ANGLES};

float maskA(vec2 p) { return texture(u_mask, vec2(p.x / L[2].x, 1.0 - p.y / L[2].y)).a; }
float ringAt(int row, int idx) {
  int at = idx < 0 ? idx + ANGLES : (idx >= ANGLES ? idx - ANGLES : idx);
  vec4 t = texelFetch(u_shadow, ivec2(at, row), 0);
  return floor(t.r * 255.0 + 0.5) * 256.0 / 65535.0 + floor(t.g * 255.0 + 0.5) / 65535.0;
}
float ringVisibility(int row, float radius, vec2 dir, float d, float size) {
  float delta = clamp(size / max(1.0, d), TAU / float(ANGLES), 0.2);
  float lit = 0.0;
  for (int k = -2; k <= 2; k++) {
    float u = (atan(dir.y, dir.x) + float(k) * delta * 0.5) / TAU;
    u -= floor(u);
    float f = u * float(ANGLES) - 0.5;
    float i0 = floor(f);
    float t = f - i0;
    float a = ringAt(row, int(i0));
    float b = ringAt(row, int(i0) + 1);
    lit += d <= mix(a, b, t) * radius + 1.5 ? 1.0 : 0.0;
  }
  return lit / 5.0;
}

void main() {
  vec4 t = texture(u_tex, vec3(v_uv, float(v_meta & 255u)));
  float w = max(fwidth(t.a), 0.0001) * 0.75;
  vec4 c;
  if ((v_meta & 256u) != 0u) {
    float a = smoothstep(0.5 - w, 0.5 + w, t.a);
    c = vec4(v_tint.rgb * v_tint.a * a, v_tint.a * a);
  } else {
    c = t * vec4(v_tint.rgb * v_tint.a, v_tint.a);
  }
  if ((v_meta & 512u) != 0u || c.a <= 0.0) { o = c; return; }

  vec2 frag = vec2(gl_FragCoord.x, L[2].y - gl_FragCoord.y);
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (L[3].y > 0.5) {
    vec3 m = texture(u_nrm, vec3(v_uv, float(v_meta & 255u))).rgb * 2.0 - 1.0;
    vec2 xy = vec2(m.x * v_rot.z, -m.y);
    n = vec3(xy.x * v_rot.x - xy.y * v_rot.y, xy.x * v_rot.y + xy.y * v_rot.x, m.z) * vec3(L[3].x, L[3].x, 1.0);
    n = normalize(n);
  }
  bool selfShadow = L[1].z > 0.5;
  bool haveMask = L[2].z > 0.5;
  bool inside = haveMask && !selfShadow && maskA(frag) > 0.5;
  vec3 light = L[0].rgb;
  vec3 shine = vec3(0.0);
  float shininess = L[1].x;
  float specular = L[1].y;
  int count = int(L[0].w + 0.5);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= count) break;
    vec4 l0 = L[4 + i * 4], l1 = L[5 + i * 4], l2 = L[6 + i * 4], l3 = L[7 + i * 4];
    int type = int(l1.w + 0.5);
    vec3 ld;
    float att = 1.0, vis = 1.0;
    if (type == 2) {
      ld = l2.xyz;
      if (l3.w > 0.0 && haveMask && !inside) {
        vec2 sd = ld.xy / max(length(ld.xy), 1e-6);
        vec2 side = vec2(-sd.y, sd.x);
        float blocked = 0.0;
        for (int lane = -1; lane <= 1; lane++) {
          bool hit = false;
          for (int s = 1; s <= ${SUN_STEPS}; s++) {
            float d = float(s) / ${SUN_STEPS}.0 * l3.w;
            if (maskA(frag + sd * d + side * float(lane) * l3.z * 0.5) > 0.5) { hit = true; break; }
          }
          if (hit) blocked += 1.0;
        }
        vis = 1.0 - blocked / 3.0;
      }
    } else {
      vec2 dv = l0.xy - frag;
      float d = length(dv);
      if (d >= l0.w) continue;
      float tt = clamp(1.0 - (d / l0.w) * (d / l0.w), 0.0, 1.0);
      att = pow(tt, l3.x);
      ld = normalize(vec3(dv, l0.z));
      if (type == 1) {
        float cs = d > 0.0 ? dot(-dv / d, l2.xy) : 1.0;
        float e = clamp((cs - l2.z) / max(l2.w - l2.z, 1e-6), 0.0, 1.0);
        att *= e * e * (3.0 - 2.0 * e);
      }
      int row = int(l3.y + 0.5);
      if (l3.y >= -0.5 && haveMask && !inside && d > 0.0) vis = ringVisibility(row, l0.w, -dv / d, d, l3.z);
    }
    float lam = clamp(dot(n, ld) / max(ld.z, 1e-3), 0.0, 2.5);
    float k = att * vis;
    light += l1.rgb * (k * lam);
    if (specular > 0.0) {
      vec3 h = normalize(ld + vec3(0.0, 0.0, 1.0));
      shine += l1.rgb * (pow(max(dot(n, h), 0.0), shininess) * specular * k * clamp((1.0 - n.z) * 4.0, 0.0, 1.0));
    }
  }
  o = vec4(clamp(c.rgb * light + shine * c.a, 0.0, 1.0), c.a);
}`;

const FS_VERT = `#version 300 es
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;

/** One row per shadow-casting light, one column per direction: how far the light gets before something blocks it, in sixteen bits over two channels. */
const POLAR = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_mask;
uniform vec4 u_ring[${MAX_SHADOW_LIGHTS}];
uniform vec2 u_size;
out vec4 o;
float maskA(vec2 p) { return texture(u_mask, vec2(p.x / u_size.x, 1.0 - p.y / u_size.y)).a; }
void main() {
  vec2 ip = floor(gl_FragCoord.xy);
  vec4 ring = u_ring[int(ip.y)];
  float a = (ip.x + 0.5) / ${SHADOW_ANGLES}.0 * 6.283185307;
  vec2 dir = vec2(cos(a), sin(a));
  float radius = max(ring.z, 1.0);
  float stp = max(1.0, radius / ${SHADOW_MARCH_STEPS}.0);
  int n = int(min(${SHADOW_MARCH_STEPS}.0, ceil(radius / stp)));
  float hit = radius;
  for (int s = 1; s <= ${SHADOW_MARCH_STEPS}; s++) {
    if (s > n) break;
    float d = float(s) * stp;
    if (maskA(ring.xy + dir * d) > 0.5) { hit = min(d, radius); break; }
  }
  float v16 = floor(hit / radius * 65535.0 + 0.5);
  o = vec4(floor(v16 / 256.0) / 255.0, mod(v16, 256.0) / 255.0, 0.0, 1.0);
}`;

/**
 * 2D lighting for the WebGL2 renderer: the lit sprite program, the occluder picture, the shadow maps and the light block. The renderer draws with `program` through its own instance buffer.
 */
export class GLLighting {
  constructor(gl) {
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`lighting shader error: ${gl.getShaderInfoLog(s)}`); return s; };
    const link = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`lighting link error: ${gl.getProgramInfoLog(p)}`); return p; };
    this.program = link(VERT, FRAG);
    this.polar = link(FS_VERT, POLAR);
    const u = (p, n) => gl.getUniformLocation(p, n);
    this.loc = { cam: u(this.program, 'u_cam'), tex: u(this.program, 'u_tex'), nrm: u(this.program, 'u_nrm'), mask: u(this.program, 'u_mask'), shadow: u(this.program, 'u_shadow') };
    this.polarLoc = { mask: u(this.polar, 'u_mask'), ring: u(this.polar, 'u_ring'), size: u(this.polar, 'u_size') };
    gl.uniformBlockBinding(this.program, gl.getUniformBlockIndex(this.program, 'Lights'), 3);
    this.ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, LIGHTING_UNIFORM_FLOATS * 4, gl.DYNAMIC_DRAW);
    this.vao = gl.createVertexArray();
    this.w = 0; this.h = 0;
    this.mask = null; this.maskFbo = null;
    const mk = (w, h) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };
    this.make = mk;
    const ring = mk(SHADOW_ANGLES, MAX_SHADOW_LIGHTS);
    gl.bindTexture(gl.TEXTURE_2D, ring.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.ring = ring;
  }

  /** Make the occluder picture the size of the screen and aim drawing at it, cleared to transparent. */
  beginMask(w, h) {
    const { gl } = this;
    if (w !== this.w || h !== this.h) {
      if (this.mask) { gl.deleteTexture(this.mask.tex); gl.deleteFramebuffer(this.mask.fbo); }
      this.mask = this.make(w, h); this.w = w; this.h = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mask.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Fill the shadow maps of the shadow-casting lights from the occluder picture. */
  buildShadows(rows) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ring.fbo);
    gl.viewport(0, 0, SHADOW_ANGLES, MAX_SHADOW_LIGHTS);
    gl.disable(gl.BLEND);
    gl.useProgram(this.polar);
    gl.bindVertexArray(this.vao);
    const data = new Float32Array(MAX_SHADOW_LIGHTS * 4);
    rows.forEach((r, i) => { data[i * 4] = r.x; data[i * 4 + 1] = r.y; data[i * 4 + 2] = r.radius; });
    gl.uniform4fv(this.polarLoc.ring, data);
    gl.uniform2f(this.polarLoc.size, this.w, this.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.mask.tex);
    gl.uniform1i(this.polarLoc.mask, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  /** Upload the light block and bind everything the lit program reads, apart from the colour and normal pages (units 0 and 1), which the renderer binds. */
  bind(pack) {
    const { gl } = this;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, pack.data);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 3, this.ubo);
    gl.uniform1i(this.loc.tex, 0); gl.uniform1i(this.loc.nrm, 1); gl.uniform1i(this.loc.mask, 2); gl.uniform1i(this.loc.shadow, 3);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, (this.mask ?? this.ring).tex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ring.tex);
    gl.activeTexture(gl.TEXTURE0);
  }

  destroy() {
    const { gl } = this;
    if (this.mask) { gl.deleteTexture(this.mask.tex); gl.deleteFramebuffer(this.mask.fbo); }
    gl.deleteTexture(this.ring.tex); gl.deleteFramebuffer(this.ring.fbo);
    gl.deleteBuffer(this.ubo); gl.deleteProgram(this.program); gl.deleteProgram(this.polar); gl.deleteVertexArray(this.vao);
  }
}
