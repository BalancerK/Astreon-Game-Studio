/**
 * 2D filters: blur, glow, outline, drop shadow, pixelate, gradient map, colour changes (grayscale, sepia, hue, brightness...), vignette and wave, for a group of sprites, a piece of text or a whole
 * camera. A filter is a plain description; the renderer draws the batch into a picture of its own, runs the filters over it one after the other, and lays the result over the frame:
 *
 * ```js
 * renderer.render({ camera, batch: world, filters: [Filter.sepia(0.6), Filter.vignette()] });                       // the whole camera
 * renderer.render({ camera, batch: ghosts, clear: null, filters: [Filter.glow({ color: '#60a0ff', radius: 10 })] }); // one group, over what is already drawn
 * renderer.renderLayers({ camera, layers: [{ batch: world }, { batch: boss, filters: [Filter.outline({ color: '#ff0' })] }, { batch: hud }] });
 * ```
 *
 * Filters are the same on WebGPU and WebGL2. The Canvas2D fallback runs the same filters on the CPU (`runFilters`): right, but slow, so use small areas there.
 * Sizes are in CSS pixels (they scale with the device pixel ratio). `planFilters` and `runFilters` are public so a filter chain can be checked without a GPU.
 */

/** Largest number of colour stops in a gradient map. */
export const MAX_GRADIENT_STOPS = 8;
/** Floats in the uniform block each pass gets (16 vec4). */
export const FILTER_UNIFORM_FLOATS = 64;
/** Registers (pictures) a filter chain needs. */
export const FILTER_REGISTERS = 3;

/** Pass kinds, as the numbers the shaders switch on. */
export const FILTER_MODE = Object.freeze({ copy: 0, matrix: 1, blur: 2, outline: 3, pixelate: 4, gradient: 5, composite: 6, vignette: 7, wave: 8 });

/** Taps either side of the centre in the blur shader (17 in all). */
export const BLUR_HALF_TAPS = 8;
/** Rings and directions in the outline shader. */
export const OUTLINE_RINGS = 3;
export const OUTLINE_DIRECTIONS = 16;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * A colour as [r, g, b, a] in 0..1. Accepts a packed tint (see `packTint`), `#rgb`, `#rrggbb`, `#rrggbbaa`, or an array of 3 or 4 numbers in 0..1.
 * @param {number | string | number[]} c @returns {number[]}
 */
export function filterColor(c) {
  if (Array.isArray(c) || ArrayBuffer.isView(c)) return [c[0], c[1], c[2], c[3] ?? 1];
  if (typeof c === 'number') return [(c & 255) / 255, ((c >>> 8) & 255) / 255, ((c >>> 16) & 255) / 255, (c >>> 24) / 255];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(c).trim());
  if (!m) throw new Error(`not a colour: ${c}`);
  let h = m[1]; if (h.length <= 4) h = [...h].map((x) => x + x).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
}

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const matrix = (m, amount = 1) => ({ type: 'matrix', m: Float32Array.from(m.map((v, i) => IDENTITY[i] + (v - IDENTITY[i]) * amount)) });
const LUMA = [0.2126, 0.7152, 0.0722];

/**
 * The filter descriptions. Each returns a plain object you can keep and reuse; change its fields between frames to animate it (a `wave`'s `phase`, a `glow`'s `strength`).
 */
export const Filter = {
  /** Gaussian blur; `radius` (pixels) is how far it reaches. */
  blur: (radius = 4) => ({ type: 'blur', radius: Math.max(0, num(radius, 4)) }),
  /** A coloured halo around the shape. `strength` above 1 makes it denser. */
  glow: ({ color = '#ffffff', radius = 8, strength = 1.5 } = {}) => ({ type: 'glow', color: filterColor(color), radius: Math.max(0, num(radius, 8)), strength: Math.max(0, num(strength, 1.5)) }),
  /** A blurred copy of the shape, offset and coloured, under it. */
  dropShadow: ({ dx = 3, dy = 3, color = '#000000', alpha = 0.6, blur = 3 } = {}) => ({ type: 'shadow', dx: num(dx, 3), dy: num(dy, 3), color: filterColor(color), alpha: clamp(num(alpha, 0.6), 0, 1), blur: Math.max(0, num(blur, 3)) }),
  /** A solid line of `width` pixels around the shape. */
  outline: ({ color = '#000000', width = 2 } = {}) => ({ type: 'outline', color: filterColor(color), width: Math.max(0, num(width, 2)) }),
  /** Big square pixels, `size` pixels across. */
  pixelate: (size = 4) => ({ type: 'pixelate', size: Math.max(1, Math.round(num(size, 4))) }),
  /** Recolour by brightness: dark parts get the first stop's colour, light parts the last. `stops`: `[[0, '#000'], [0.5, '#c00'], [1, '#ff0']]` (positions 0..1, up to 8). */
  gradientMap: (stops) => {
    if (!Array.isArray(stops) || stops.length < 2) throw new Error('a gradient map needs at least two stops');
    if (stops.length > MAX_GRADIENT_STOPS) throw new Error(`a gradient map takes at most ${MAX_GRADIENT_STOPS} stops`);
    const list = stops.map((s) => (Array.isArray(s) ? { pos: s[0], color: filterColor(s[1]) } : { pos: s.pos ?? s.at ?? 0, color: filterColor(s.color) })).sort((a, b) => a.pos - b.pos);
    return { type: 'gradient', stops: list };
  },
  /** Any colour change as a 4x5 matrix, row by row (`r' = m0 r + m1 g + m2 b + m3 a + m4`, and so on for g, b, a), on colours in 0..1. */
  colorMatrix: (m) => { if (!m || m.length !== 20) throw new Error('a colour matrix has 20 numbers (4 rows of 5)'); return { type: 'matrix', m: Float32Array.from(m) }; },
  /** Remove colour; `amount` 1 is fully gray. */
  grayscale: (amount = 1) => matrix([...LUMA, 0, 0, ...LUMA, 0, 0, ...LUMA, 0, 0, 0, 0, 0, 1, 0], clamp(num(amount, 1), 0, 1)),
  /** Old photograph brown. */
  sepia: (amount = 1) => matrix([0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0], clamp(num(amount, 1), 0, 1)),
  /** 0 gray, 1 unchanged, above 1 vivid. */
  saturate: (s = 1) => { const a = 1 - s; return Filter.colorMatrix([a * LUMA[0] + s, a * LUMA[1], a * LUMA[2], 0, 0, a * LUMA[0], a * LUMA[1] + s, a * LUMA[2], 0, 0, a * LUMA[0], a * LUMA[1], a * LUMA[2] + s, 0, 0, 0, 0, 0, 1, 0]); },
  /** Turn every hue round the colour wheel by `degrees`. */
  hueRotate: (degrees = 0) => {
    const r = (degrees * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return Filter.colorMatrix([
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
      0, 0, 0, 1, 0]);
  },
  /** Multiply the brightness (1 unchanged). */
  brightness: (b = 1) => Filter.colorMatrix([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]),
  /** More (above 1) or less (below 1) difference between light and dark. */
  contrast: (c = 1) => { const o = 0.5 - 0.5 * c; return Filter.colorMatrix([c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0]); },
  /** Photographic negative; `amount` 1 is fully inverted. */
  invert: (amount = 1) => { const a = clamp(num(amount, 1), 0, 1), k = 1 - 2 * a; return Filter.colorMatrix([k, 0, 0, 0, a, 0, k, 0, 0, a, 0, 0, k, 0, a, 0, 0, 0, 1, 0]); },
  /** Mix the picture toward a colour (a hit flash: `Filter.tint('#fff', 0.8)`). The shape is kept. */
  tint: (color = '#ffffff', amount = 0.5) => { const c = filterColor(color), a = clamp(num(amount, 0.5), 0, 1), k = 1 - a; return Filter.colorMatrix([k, 0, 0, 0, c[0] * a, 0, k, 0, 0, c[1] * a, 0, 0, k, 0, c[2] * a, 0, 0, 0, 1, 0]); },
  /** Darken (or colour) the edges. `radius` 0..1.4 is where it starts (0.75 default), `softness` how wide the fade is, `strength` how dark. */
  vignette: ({ radius = 0.75, softness = 0.5, strength = 0.6, color = '#000000' } = {}) => ({ type: 'vignette', radius: num(radius, 0.75), softness: Math.max(0.01, num(softness, 0.5)), strength: clamp(num(strength, 0.6), 0, 1), color: filterColor(color) }),
  /** A ripple: the picture is shifted sideways (`axis: 'x'`) or up and down (`'y'`) by a sine wave across it. Animate it by changing `phase` each frame. */
  wave: ({ amplitude = 4, wavelength = 40, phase = 0, axis = 'x' } = {}) => ({ type: 'wave', amplitude: num(amplitude, 4), wavelength: Math.max(1, num(wavelength, 40)), phase: num(phase, 0), axis: axis === 'y' ? 'y' : 'x' }),
};

/**
 * Turn a list of filters into passes over three pictures ("registers"). Register 0 holds the drawn group at the start. Each pass reads one or two registers, writes another, and has a block
 * of uniforms; `result` says where the finished picture is.
 * @param {object[]} filters @param {{scale?: number}} [o] `scale`: pixels per CSS pixel
 * @returns {{passes: {mode: number, inputs: number[], output: number, u: Float32Array}[], result: number}}
 */
export function planFilters(filters, { scale = 1 } = {}) {
  const passes = [];
  const live = new Set([0]);
  let cur = 0;
  const free = () => { for (let r = 0; r < FILTER_REGISTERS; r++) if (!live.has(r)) return r; throw new Error('filter plan ran out of registers'); };
  const pass = (mode, inputs, u) => {
    const output = free();
    passes.push({ mode, inputs, output, u });
    live.add(output);
    return output;
  };
  const block = (mode) => { const u = new Float32Array(FILTER_UNIFORM_FLOATS); u[0] = mode; return u; };
  const set = (u, at, ...v) => { for (let i = 0; i < v.length; i++) u[at + i] = v[i]; return u; };
  const step = (mode, u) => { const out = pass(mode, [cur], u); live.delete(cur); cur = out; };
  const blurPasses = (radius, from) => {                          // returns the register holding the blurred copy of `from`; leaves `from` alive
    const n = Math.max(1, Math.ceil(radius / 16)), r = radius / Math.sqrt(n), stepPx = r / BLUR_HALF_TAPS;
    let at = from;
    for (let i = 0; i < n; i++) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const u = set(block(FILTER_MODE.blur), 4, stepPx * dx, stepPx * dy, BLUR_HALF_TAPS / 3, 0);
        const out = pass(FILTER_MODE.blur, [at], u);
        if (at !== from) live.delete(at);
        at = out;
      }
    }
    return at;
  };
  for (const f of filters) {
    if (!f || typeof f.type !== 'string') throw new Error('not a filter (use Filter.blur(...), Filter.glow(...) and so on)');
    switch (f.type) {
      case 'matrix': { const u = block(FILTER_MODE.matrix); for (let i = 0; i < 4; i++) set(u, 4 + i * 4, f.m[i * 5], f.m[i * 5 + 1], f.m[i * 5 + 2], f.m[i * 5 + 3]); set(u, 20, f.m[4], f.m[9], f.m[14], f.m[19]); step(FILTER_MODE.matrix, u); break; }
      case 'blur': {
        const r = f.radius * scale;
        if (r < 0.25) break;
        const out = blurPasses(r, cur); live.delete(cur); cur = out; break;
      }
      case 'glow': case 'shadow': {
        const shadow = f.type === 'shadow', r = (shadow ? f.blur : f.radius) * scale;
        const orig = cur;
        const blurred = r < 0.25 ? orig : blurPasses(r, orig);
        const u = set(block(FILTER_MODE.composite), 4, shadow ? f.dx * scale : 0, shadow ? f.dy * scale : 0, shadow ? 1 : f.strength, 0);
        set(u, 8, f.color[0], f.color[1], f.color[2], shadow ? f.color[3] * f.alpha : f.color[3]);
        const out = pass(FILTER_MODE.composite, [orig, blurred], u);
        live.delete(orig); if (blurred !== orig) live.delete(blurred);
        cur = out; break;
      }
      case 'outline': { if (f.width * scale < 0.25) break; step(FILTER_MODE.outline, set(set(block(FILTER_MODE.outline), 4, f.width * scale), 8, ...f.color)); break; }
      case 'pixelate': step(FILTER_MODE.pixelate, set(block(FILTER_MODE.pixelate), 4, Math.max(1, Math.round(f.size * scale)))); break;
      case 'gradient': {
        const u = set(block(FILTER_MODE.gradient), 4, f.stops.length);
        f.stops.forEach((s, i) => { u[8 + i] = s.pos; set(u, 16 + i * 4, ...s.color); });
        step(FILTER_MODE.gradient, u); break;
      }
      case 'vignette': step(FILTER_MODE.vignette, set(set(block(FILTER_MODE.vignette), 4, f.radius, f.softness, f.strength), 8, ...f.color)); break;
      case 'wave': step(FILTER_MODE.wave, set(block(FILTER_MODE.wave), 4, f.amplitude * scale, f.wavelength * scale, f.phase, f.axis === 'y' ? 1 : 0)); break;
      default: throw new Error(`unknown filter type: ${f.type}`);
    }
  }
  return { passes, result: cur };
}

// ---------------------------------------------------------------------------------------------------------------------------- CPU reference

/** Premultiplied float pixels (4 per pixel) from canvas pixel data (RGBA bytes, not premultiplied). @param {ArrayLike<number>} data */
export function toPremultiplied(data) {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; out[i] = data[i] / 255 * a; out[i + 1] = data[i + 1] / 255 * a; out[i + 2] = data[i + 2] / 255 * a; out[i + 3] = a; }
  return out;
}
/** Canvas pixel data (RGBA bytes, not premultiplied) from premultiplied float pixels. @param {Float32Array} f @param {Uint8ClampedArray} [out] */
export function fromPremultiplied(f, out = new Uint8ClampedArray(f.length)) {
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    if (a <= 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
    out[i] = Math.round(clamp(f[i] / a, 0, 1) * 255); out[i + 1] = Math.round(clamp(f[i + 1] / a, 0, 1) * 255); out[i + 2] = Math.round(clamp(f[i + 2] / a, 0, 1) * 255); out[i + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  return out;
}

const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Bilinear sample, clamp to the edge, at a continuous position where the centre of pixel (i, j) is (i + 0.5, j + 0.5). Writes 4 floats to `out`. */
function sampleInto(img, w, h, x, y, out) {
  const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const xa = clamp(x0, 0, w - 1), xb = clamp(x0 + 1, 0, w - 1), ya = clamp(y0, 0, h - 1), yb = clamp(y0 + 1, 0, h - 1);
  const a = (ya * w + xa) * 4, b = (ya * w + xb) * 4, c = (yb * w + xa) * 4, d = (yb * w + xb) * 4;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  for (let k = 0; k < 4; k++) out[k] = img[a + k] * w00 + img[b + k] * w10 + img[c + k] * w01 + img[d + k] * w11;
}

/**
 * Run a plan on the CPU: the reference the shaders are checked against, and the Canvas2D fallback. Slow (every pixel in JavaScript), but exact.
 * @param {ReturnType<typeof planFilters>} plan @param {Float32Array} pixels Premultiplied float RGBA (see `toPremultiplied`); not changed. @param {number} w @param {number} h
 * @returns {Float32Array} The finished picture, premultiplied.
 */
export function runFilters(plan, pixels, w, h) {
  const regs = [pixels, null, null];
  const s = new Float32Array(4), t = new Float32Array(4), acc = new Float32Array(4);
  for (const p of plan.passes) {
    const u = p.u, mode = u[0], out = new Float32Array(w * h * 4), src = regs[p.inputs[0]], src2 = p.inputs[1] !== undefined ? regs[p.inputs[1]] : null;
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const o = (iy * w + ix) * 4, px = ix + 0.5, py = iy + 0.5;
        switch (mode) {
          case FILTER_MODE.copy: for (let k = 0; k < 4; k++) out[o + k] = src[o + k]; break;
          case FILTER_MODE.matrix: {
            const a = src[o + 3], r = a > 0 ? src[o] / a : 0, g = a > 0 ? src[o + 1] / a : 0, b = a > 0 ? src[o + 2] / a : 0;
            const row = (i) => clamp(u[4 + i * 4] * r + u[5 + i * 4] * g + u[6 + i * 4] * b + u[7 + i * 4] * a + u[20 + i], 0, 1);
            const na = row(3);
            out[o] = row(0) * na; out[o + 1] = row(1) * na; out[o + 2] = row(2) * na; out[o + 3] = na; break;
          }
          case FILTER_MODE.blur: {
            const sx = u[4], sy = u[5], sig = u[6];
            acc.fill(0); let ws = 0;
            for (let k = -BLUR_HALF_TAPS; k <= BLUR_HALF_TAPS; k++) {
              const wt = Math.exp(-0.5 * (k / sig) * (k / sig));
              sampleInto(src, w, h, px + k * sx, py + k * sy, s);
              for (let c = 0; c < 4; c++) acc[c] += s[c] * wt;
              ws += wt;
            }
            for (let c = 0; c < 4; c++) out[o + c] = acc[c] / ws; break;
          }
          case FILTER_MODE.outline: {
            let m = 0;
            for (let ring = 1; ring <= OUTLINE_RINGS; ring++) {
              const d = (u[4] * ring) / OUTLINE_RINGS;
              for (let k = 0; k < OUTLINE_DIRECTIONS; k++) { const ang = (k * 2 * Math.PI) / OUTLINE_DIRECTIONS; sampleInto(src, w, h, px + d * Math.cos(ang), py + d * Math.sin(ang), s); if (s[3] > m) m = s[3]; }
            }
            const oa = u[11] * m, k = 1 - src[o + 3];
            out[o] = src[o] + k * u[8] * oa; out[o + 1] = src[o + 1] + k * u[9] * oa; out[o + 2] = src[o + 2] + k * u[10] * oa; out[o + 3] = src[o + 3] + k * oa; break;
          }
          case FILTER_MODE.pixelate: {
            const cell = u[4], cx = Math.min(w - 1, Math.floor(ix / cell) * cell + Math.floor(cell / 2)), cy = Math.min(h - 1, Math.floor(iy / cell) * cell + Math.floor(cell / 2)), i = (cy * w + cx) * 4;
            for (let k = 0; k < 4; k++) out[o + k] = src[i + k]; break;
          }
          case FILTER_MODE.gradient: {
            const a = src[o + 3], r = a > 0 ? src[o] / a : 0, g = a > 0 ? src[o + 1] / a : 0, b = a > 0 ? src[o + 2] / a : 0, lum = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 1), n = u[4];
            let c0 = 16, c1 = 16, f = 0;
            if (lum <= u[8]) { c0 = c1 = 16; } else if (lum >= u[8 + n - 1]) { c0 = c1 = 16 + (n - 1) * 4; } else {
              for (let i = 0; i < n - 1; i++) if (lum >= u[8 + i] && lum <= u[9 + i]) { c0 = 16 + i * 4; c1 = c0 + 4; f = (lum - u[8 + i]) / Math.max(1e-6, u[9 + i] - u[8 + i]); break; }
            }
            const cr = u[c0] + (u[c1] - u[c0]) * f, cg = u[c0 + 1] + (u[c1 + 1] - u[c0 + 1]) * f, cb = u[c0 + 2] + (u[c1 + 2] - u[c0 + 2]) * f, ca = (u[c0 + 3] + (u[c1 + 3] - u[c0 + 3]) * f) * a;
            out[o] = cr * ca; out[o + 1] = cg * ca; out[o + 2] = cb * ca; out[o + 3] = ca; break;
          }
          case FILTER_MODE.composite: {
            sampleInto(src2, w, h, px - u[4], py - u[5], s);
            const sa = clamp(s[3] * u[6], 0, 1) * u[11], k = 1 - src[o + 3];
            out[o] = src[o] + k * u[8] * sa; out[o + 1] = src[o + 1] + k * u[9] * sa; out[o + 2] = src[o + 2] + k * u[10] * sa; out[o + 3] = src[o + 3] + k * sa; break;
          }
          case FILTER_MODE.vignette: {
            const vx = (px / w - 0.5) * 2, vy = (py / h - 0.5) * 2, r = Math.sqrt(vx * vx + vy * vy) / Math.SQRT2;
            const tt = smooth(u[4], u[4] + u[5], r) * u[6], a = src[o + 3];
            out[o] = src[o] * (1 - tt) + u[8] * tt * a; out[o + 1] = src[o + 1] * (1 - tt) + u[9] * tt * a; out[o + 2] = src[o + 2] * (1 - tt) + u[10] * tt * a; out[o + 3] = a; break;
          }
          case FILTER_MODE.wave: {
            const horizontal = u[7] === 0, off = u[4] * Math.sin((2 * Math.PI * (horizontal ? py : px)) / u[5] + u[6]);
            sampleInto(src, w, h, horizontal ? px + off : px, horizontal ? py : py + off, t);
            for (let k = 0; k < 4; k++) out[o + k] = t[k]; break;
          }
          default: throw new Error(`unknown pass mode ${mode}`);
        }
      }
    }
    regs[p.output] = out;
    // a register nobody reads again could be reused; the GPU runners do that, here a fresh array per pass is simpler and the CPU path is for small pictures
  }
  return regs[plan.result];
}
