// A frame-time overlay's numbers: frames a second, the slowest frame, the time of each named part of a frame (smoothed), and optionally how long the graphics card takes. The numbers are plain data
// (so they can feed a dynamic-resolution controller or a test); `statsRows` makes the lines to show and `drawStatsPanel` draws them.
import { HUD_THEME } from './theme.js';

/**
 * Make the numbers of a frame-time overlay: call `frame()` once a frame and `mark(name)` as each part of the frame finishes.
 * @param {{window?: number, smoothing?: number, now?: () => number, onWindow?: (s: ReturnType<typeof createFrameStats>) => void}} [o] `window` how many milliseconds each reading covers (500), `smoothing` how
 * much of a part's time is the newest reading (0.1), `now` a clock in milliseconds, `onWindow` called when a reading is ready (once every `window`)
 */
export function createFrameStats({ window = 500, smoothing = 0.1, now = () => performance.now(), onWindow } = {}) {
  let frames = 0, since = now(), worst = 0, lastFrame = null, stamp = now();
  const s = {
    /** Frames a second over the last reading. */ fps: 0,
    /** Milliseconds a frame over the last reading. */ interval: 0,
    /** The slowest frame in the last reading, in milliseconds. */ worst: 0,
    /** The time of each named part, smoothed, in milliseconds. @type {Record<string, number>} */ marks: {},
    /** The marks as they were at the last reading, with `worst`. @type {Record<string, number>} */ shown: {},
    /** The graphics card's time for a frame, if it was told (see `watchGpuTime`). @type {number | undefined} */ gpu: undefined,
    /** Say that the part of the frame called `name` has just finished (its time is the time since the last note, or since `begin`). @param {string} name @param {number} [at] */
    mark(name, at = now()) { s.marks[name] = (s.marks[name] ?? 0) * (1 - smoothing) + (at - stamp) * smoothing; stamp = at; },
    /** Start timing the first part of a frame from now (so time spent outside the frame is not counted). @param {number} [at] */
    begin(at = now()) { stamp = at; },
    /** Count a frame (call once a frame); every `window` milliseconds the reading is made. @param {number} [at] @returns {boolean} whether a reading was just made */
    frame(at = now()) {
      frames++; worst = Math.max(worst, at - (lastFrame ?? at)); lastFrame = at;
      if (at - since < window) return false;
      s.fps = (frames * 1000) / (at - since); s.interval = (at - since) / frames;
      s.shown = { ...s.marks, worst }; s.worst = worst;
      frames = 0; since = at; worst = 0;
      onWindow?.(s);
      return true;
    },
    /** The sum of some parts' times (the CPU's share of a frame). @param {string[]} names */
    total(names) { return names.reduce((sum, k) => sum + (s.marks[k] ?? 0), 0); },
  };
  return s;
}

/**
 * Time the graphics card on a WebGPU renderer: after each frame's work is handed over, how long until the card says it is done (smoothed into `stats.gpu`). Does nothing for a renderer without a
 * `device`. Call once a frame, after rendering.
 * @param {{device?: GPUDevice}} renderer @param {ReturnType<typeof createFrameStats>} stats @param {{busy: boolean}} [state] keep the same object between calls
 */
export function watchGpuTime(renderer, stats, state = { busy: false }) {
  if (!renderer.device || state.busy) return state;
  state.busy = true;
  const sent = performance.now();
  renderer.device.queue.onSubmittedWorkDone().then(() => { stats.gpu = (stats.gpu ?? 0) * 0.8 + (performance.now() - sent) * 0.2; state.busy = false; });
  return state;
}

/**
 * The lines of a frame-time overlay.
 * @param {ReturnType<typeof createFrameStats>} stats @param {{parts?: string[], head?: string, extra?: string[]}} [o] `parts` the names to list in order (default: all that were marked), `head` text after the frame rate, `extra` more lines at the end
 * @returns {string[]}
 */
export function statsRows(stats, { parts = Object.keys(stats.shown).filter((k) => k !== 'worst'), head = '', extra = [] } = {}) {
  const cpu = parts.reduce((sum, k) => sum + (stats.shown[k] ?? 0), 0);
  const rows = [`${stats.fps.toFixed(0)} FPS   ${stats.interval.toFixed(1)} ms${head ? `   ${head}` : ''}`];
  rows.push(`worst frame ${(stats.shown.worst ?? 0).toFixed(1)} ms   cpu ${cpu.toFixed(1)} ms${stats.interval > cpu + 1.5 ? '   (rest: waiting for the graphics card)' : ''}`);
  for (const k of parts) rows.push(`  ${k.padEnd(8)} ${(stats.shown[k] ?? 0).toFixed(2)} ms`);
  if (stats.gpu !== undefined) rows.push(`  gpu      ${stats.gpu.toFixed(2)} ms (until the card is done with a frame)`);
  return [...rows, ...extra];
}

/**
 * Draw the lines on a dark panel, the first one coloured by the frame rate (green from 55, amber from 30, red below).
 * @param {CanvasRenderingContext2D} g @param {string[]} rows @param {number} fps @param {number} x @param {number} y the top left @param {number} u the scale @param {import('./theme.js').HudTheme} [theme]
 */
export function drawStatsPanel(g, rows, fps, x, y, u, theme = HUD_THEME) {
  const size = Math.round(12 * u), pad = 8 * u, line = size * 1.35;
  g.font = `bold ${size}px ${theme.font}`;
  const width = Math.max(...rows.map((r) => g.measureText(r).width)) + pad * 2;
  g.fillStyle = 'rgba(10, 14, 18, 0.5)'; g.fillRect(x, y, width, rows.length * line + pad);
  g.strokeStyle = 'rgba(111, 211, 224, 0.5)'; g.lineWidth = 1; g.strokeRect(x, y, width, rows.length * line + pad);
  rows.forEach((r, i) => { g.fillStyle = i === 0 ? (fps >= 55 ? '#6fcf97' : fps >= 30 ? '#e0b84a' : '#e0594f') : '#cfe8f2'; g.fillText(r, x + pad, y + pad + (i + 0.85) * line); });
}
