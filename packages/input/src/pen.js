/**
 * A stroke as a pen (or finger, or mouse) draws it: a list of samples with position, pressure, tilt and time. `StrokeRecorder` turns a stream of pointer positions into strokes (thinning out
 * samples that barely moved, smoothing jitter, keeping the high-rate samples a pen reports between frames), and `penWidth` turns pressure into a brush width. The pieces take plain numbers, so
 * a test or a replay can draw too; `attachPenStrokes` connects a page.
 * @typedef {{x: number, y: number, pressure: number, tiltX: number, tiltY: number, t: number}} StrokeSample
 */

/**
 * The width of a brush at a pressure: `min` at 0 to `max` at 1, with `curve` above 1 making a light touch lighter (a pen that feels harder) and below 1 making it heavier.
 * @param {number} pressure 0..1 @param {number} min @param {number} max @param {number} [curve]
 */
export function penWidth(pressure, min, max, curve = 1) {
  const p = Math.min(1, Math.max(0, pressure));
  return min + (max - min) * (curve === 1 ? p : p ** curve);
}

/** Records strokes. */
export class StrokeRecorder {
  /**
   * @param {object} [o]
   * @param {number} [o.minDistance] Samples closer than this (pixels) to the last kept one are dropped, except the last of a stroke (0.75).
   * @param {number} [o.smoothing] 0 keeps positions exactly; toward 1 each sample is pulled toward the last kept one, rounding off hand jitter (0). Pressure is smoothed the same way.
   * @param {boolean} [o.keep] Keep finished strokes in `strokes` (default true). @param {number} [o.maxStrokes] Oldest are dropped past this many (1000).
   * @param {(stroke: Stroke) => void} [o.onStart] @param {(stroke: Stroke, samples: StrokeSample[]) => void} [o.onPoints] Called with the samples just added. @param {(stroke: Stroke) => void} [o.onEnd]
   */
  constructor({ minDistance = 0.75, smoothing = 0, keep = true, maxStrokes = 1000, onStart = null, onPoints = null, onEnd = null } = {}) {
    Object.assign(this, { minDistance, smoothing, keep, maxStrokes, onStart, onPoints, onEnd });
    /** @type {Stroke[]} Finished strokes, oldest first. */ this.strokes = [];
    /** @type {Map<number, Stroke>} Strokes being drawn, by pointer. */ this.active = new Map();
    this.nextId = 1;
  }

  /** The pointer touched down. `pointerType` is `'pen'`, `'touch'` or `'mouse'`; `eraser` marks a stroke made with the eraser end. @returns {Stroke} */
  down(id, x, y, { pressure = 0.5, tiltX = 0, tiltY = 0, t = 0, pointerType = 'pen', eraser = false } = {}) {
    const stroke = { id: this.nextId++, pointerType, eraser, samples: [{ x, y, pressure, tiltX, tiltY, t }], done: false, length: 0 };
    this.active.set(id, stroke);
    this.onStart?.(stroke);
    this.onPoints?.(stroke, stroke.samples.slice());
    return stroke;
  }

  /** The pointer moved while down. `more` holds the extra samples the device reported since the last event (`getCoalescedEvents`), oldest first, each `{x, y, pressure, tiltX, tiltY, t}`. */
  move(id, x, y, { pressure, tiltX, tiltY, t = 0 } = {}, more = []) {
    const stroke = this.active.get(id);
    if (!stroke) return [];
    const added = [];
    for (const s of [...more, { x, y, pressure, tiltX, tiltY, t }]) {
      const last = stroke.samples[stroke.samples.length - 1];
      const d = Math.hypot(s.x - last.x, s.y - last.y);
      if (d < this.minDistance) continue;
      const k = this.smoothing, p = s.pressure ?? last.pressure;
      const sample = { x: last.x + (s.x - last.x) * (1 - k), y: last.y + (s.y - last.y) * (1 - k), pressure: last.pressure + (p - last.pressure) * (1 - k), tiltX: s.tiltX ?? last.tiltX, tiltY: s.tiltY ?? last.tiltY, t: s.t ?? t };
      stroke.length += Math.hypot(sample.x - last.x, sample.y - last.y);
      stroke.samples.push(sample); added.push(sample);
    }
    if (added.length) this.onPoints?.(stroke, added);
    return added;
  }

  /** The pointer lifted: the stroke is finished (and kept, if `keep`). A stroke that never moved is a dot (one sample). @returns {Stroke | null} */
  up(id, x, y, { pressure, t = 0 } = {}) {
    const stroke = this.active.get(id);
    if (!stroke) return null;
    const last = stroke.samples[stroke.samples.length - 1];
    if (x !== undefined && (Math.hypot(x - last.x, y - last.y) >= 0.01)) { stroke.samples.push({ x, y, pressure: pressure ?? last.pressure, tiltX: last.tiltX, tiltY: last.tiltY, t }); stroke.length += Math.hypot(x - last.x, y - last.y); this.onPoints?.(stroke, [stroke.samples[stroke.samples.length - 1]]); }
    stroke.done = true; this.active.delete(id);
    if (this.keep) { this.strokes.push(stroke); if (this.strokes.length > this.maxStrokes) this.strokes.shift(); }
    this.onEnd?.(stroke);
    return stroke;
  }

  /** The pointer was cancelled: the stroke is dropped. */
  cancel(id) { this.active.delete(id); }
  clear() { this.strokes.length = 0; this.active.clear(); }
}

/** @typedef {{id: number, pointerType: string, eraser: boolean, samples: StrokeSample[], done: boolean, length: number}} Stroke */

/**
 * Feed a page's pointer events to a stroke recorder (pen, and `touch` / `mouse` if asked for), including the extra samples a pen reports between frames. Sets `touch-action: none` on the element.
 * The positions are relative to the element.
 * @param {HTMLElement} element @param {StrokeRecorder} recorder @param {{pointerTypes?: string[], preventDefault?: boolean}} [o] `pointerTypes` defaults to `['pen']`.
 */
export function attachPenStrokes(element, recorder, { pointerTypes = ['pen'], preventDefault = true } = {}) {
  const wants = (e) => pointerTypes.includes(e.pointerType);
  const rect = () => element.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const sample = (e, r) => ({ x: e.clientX - r.left, y: e.clientY - r.top, pressure: e.pointerType === 'pen' ? e.pressure : (e.pressure || 0.5), tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0, t: e.timeStamp ?? 0 });
  const down = (e) => {
    if (!wants(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const s = sample(e, rect());
    recorder.down(e.pointerId, s.x, s.y, { ...s, pointerType: e.pointerType, eraser: (e.buttons & 32) !== 0 });
    try { element.setPointerCapture?.(e.pointerId); } catch { /* the pointer is gone */ }
    if (preventDefault) e.preventDefault?.();
  };
  const move = (e) => {
    if (!wants(e) || !recorder.active.has(e.pointerId)) return;
    const r = rect(), main = sample(e, r), more = (e.getCoalescedEvents?.() ?? []).map((c) => sample(c, r));
    recorder.move(e.pointerId, main.x, main.y, main, more.slice(0, -1));
    if (preventDefault) e.preventDefault?.();
  };
  const up = (e) => { if (!wants(e)) return; const s = sample(e, rect()); recorder.up(e.pointerId, s.x, s.y, s); };
  const cancel = (e) => recorder.cancel(e.pointerId);
  const previous = element.style?.touchAction;
  if (preventDefault && element.style) element.style.touchAction = 'none';
  element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', cancel);
  return {
    detach() {
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', cancel);
      if (preventDefault && element.style) element.style.touchAction = previous ?? '';
    },
  };
}
