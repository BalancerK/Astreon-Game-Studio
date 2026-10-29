// Making a picture cheaper for a slow graphics card without a game writing the same rules again: the levels (what each costs), a finishing pass reduced to a level, dynamic resolution (the picture is
// drawn with fewer pixels when the card cannot keep up) and a guess at how strong the card is from its name.
//
//   const q = qualityOf('low');                                       // { shadowSize: 1024, pixelRatioCap: 1, antialias: false, lights: 6, particles: 0.7, post: 'plain' }
//   const renderer = await createRenderer3D({ antialias: q.antialias });
//   const drs = createDynamicResolution();                            // every half second: if (drs.update(fps, worstFrameMs, seconds)) renderer.setRenderScale(drs.scale);
//   renderer.render({ ..., shadows: { size: q.shadowSize }, post: reducePost(fullPost, 'low') });

/**
 * What each level costs the graphics card. `shadowSize` is the sun's shadow map (0 for none), `pixelRatioCap` the most pixels drawn for a screen pixel, `antialias` multisampling (it can only be chosen
 * when the renderer is made), `lights` how many point lights are lit at most, `particles` the share of particles drawn, and `post` the finishing pass: `full`, `glow` (glow, colour and smooth edges) or
 * `plain` (colour and smooth edges).
 * @type {Readonly<Record<'low' | 'medium' | 'high', {shadowSize: number, pixelRatioCap: number, antialias: boolean, lights: number, particles: number, post: 'full' | 'glow' | 'plain'}>>}
 */
export const QUALITY_LEVELS = Object.freeze({
  low: Object.freeze({ shadowSize: 1024, pixelRatioCap: 1, antialias: false, lights: 6, particles: 0.7, post: 'plain' }),
  medium: Object.freeze({ shadowSize: 1024, pixelRatioCap: 1.5, antialias: true, lights: 16, particles: 1, post: 'glow' }),
  high: Object.freeze({ shadowSize: 2048, pixelRatioCap: 2, antialias: true, lights: 24, particles: 1, post: 'full' }),
});

/** The settings of a level; anything else is the lightest, so a slow machine never has to find the setting. @param {string} level */
export const qualityOf = (level) => QUALITY_LEVELS[level] ?? QUALITY_LEVELS.low;

const CHEAP = ['tonemap', 'exposure', 'contrast', 'saturation', 'gain', 'vignette'];

/**
 * A finishing pass (the `post` of `render`) reduced to a level: `high` as it is; `medium` keeps the glow (at most four levels), the colour work, and smooth edges, and drops shading in the creases,
 * reflections, depth of field and heat haze; `low` keeps only the colour work and smooth edges.
 * @param {any} full the complete pass @param {string} level @returns {any}
 */
export function reducePost(full, level) {
  const q = qualityOf(level);
  if (q.post === 'full' || !full) return full;
  const out = {};
  for (const k of CHEAP) if (full[k] !== undefined) out[k] = full[k];
  if (q.post === 'glow' && full.bloom) out.bloom = { ...full.bloom, levels: Math.min(full.bloom.levels ?? 4, 4) };
  out.fxaa = true;
  return out;
}

/**
 * Dynamic resolution: the share of the screen's size the 3D picture is drawn at, kept where the card can manage the frame rate. How long a frame takes follows the number of pixels, so the picture
 * shrinks by about the square root of how far the frame rate is below the target, grows back slowly when the card keeps up, and waits longer before trying again after a try that failed. Frames of
 * the first seconds (loading), of a hidden page and a single long stall do not count against the card.
 * Give it the frame rate over the last half second every half second; draw the 3D picture at `renderer.setRenderScale(drs.scale)` and the writing and the controls at the screen's own size.
 * @param {{target?: number, min?: number, step?: number, grace?: number}} [o] `target` frames a second to aim for (60), `min` the smallest share (0.4), `step` how much it grows by (0.05), `grace`
 * seconds after starting (or coming back to the page) in which a slow frame rate is put down to loading (4).
 */
export function createDynamicResolution({ target = 60, min = 0.4, step = 0.05, grace = 4 } = {}) {
  let scale = 1, calm = 0, need = 6, sinceUp = 1e9, started = null, away = 0;
  return {
    get scale() { return scale; },
    /** Back to full size (the player changed the graphics level, or turned this off). */
    reset() { scale = 1; calm = 0; need = 6; sinceUp = 1e9; },
    /** The page was hidden or came back: the frames of that time say nothing. @param {number} now seconds */
    pause(now) { away = now; },
    /**
     * @param {number} fps the frame rate over the last half second @param {number} worstMs the slowest frame in it @param {number} now seconds
     * @returns {boolean} whether the scale changed
     */
    update(fps, worstMs, now) {
      started ??= now;
      if (now - started < grace || now - away < grace / 2 || (worstMs > 600 && fps >= 12)) { calm = 0; return false; }
      sinceUp += 0.5;
      const before = scale;
      if (fps < target * 0.88) {
        scale = Math.max(min, Math.round((scale * Math.min(0.95, Math.max(0.7, Math.sqrt(fps / target)))) / 0.025) / 40);
        if (sinceUp < 8) need = Math.min(40, need * 2);                    // it was too much to grow: wait longer before trying again
        calm = 0;
      } else if (fps >= target * 0.96 && scale < 1) {
        if (++calm >= need) { scale = Math.round(Math.min(1, scale + step) * 1000) / 1000; calm = 0; sinceUp = 0; }
      } else calm = 0;
      return scale !== before;
    },
  };
}

const STRONG = /\b(geforce|rtx|gtx|quadro|radeon rx|radeon pro|radeon (r9|vii)|apple m\d+|apple gpu|arc(\(tm\))? a\d+|nvidia)\b/i;
const WEAK = /(intel.*(hd graphics|uhd|iris)|\bmali\b|adreno|powervr|swiftshader|llvmpipe|basic render|software|radeon\(tm\) (r\d|graphics)|radeon graphics|vega \d+ graphics|geforce (mx|gt ?[0-9]{3}\b)|gma)/i;

/** What kind of graphics card a name says it is: `strong` (enough for the highest level), `weak` (integrated, a phone's, or software drawing), or `unknown`. @param {string} [name] @returns {'strong' | 'weak' | 'unknown'} */
export function gpuClass(name = '') {
  if (WEAK.test(name)) return 'weak';
  if (STRONG.test(name)) return 'strong';
  return 'unknown';
}

/** The name of the graphics card in use, if the browser tells: a WebGPU renderer's adapter, else a WebGL context's debug information. @param {any} [renderer] @returns {string} */
export function gpuName(renderer) {
  try {
    const info = renderer?.device?.adapterInfo;
    if (info && (info.description || info.vendor)) return `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.device ?? ''} ${info.description ?? ''}`.trim();
    const gl = globalThis.document?.createElement('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}
