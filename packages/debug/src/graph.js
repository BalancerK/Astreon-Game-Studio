/** Smallest "nice" number (1, 2, 5 x 10^n) that is >= v, for tidy graph ranges. */
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  let p = 1;
  while (p > v) p /= 10;
  while (p * 10 <= v) p *= 10;
  for (const m of [1, 2, 5, 10]) if (p * m >= v) return p * m;
  return p * 10;
}

/**
 * Draw a time series as a line graph into a 2D context. Newest sample is at the right edge; gaps (NaN)
 * break the line. Returns the value range used, so the caller can label it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./time-series.js').TimeSeries} series
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @param {object} [o]
 * @param {number} [o.min]
 * @param {number | null} [o.max] null = fit to the data (rounded up to a nice number)
 * @param {string} [o.color]
 * @param {string} [o.background]
 * @param {number | null} [o.warnAbove] Draws a threshold line and colours points above it.
 * @param {string} [o.warnColor]
 * @returns {{min: number, max: number}}
 */
export function drawGraph(ctx, series, rect, { min = 0, max = null, color = '#7fd4ff', background = 'rgba(255,255,255,0.06)', warnAbove = null, warnColor = '#ff7a7a' } = {}) {
  const { x, y, w, h } = rect;
  const top = max ?? Math.max(niceCeil(series.stats().max), min + 1e-9);
  const span = top - min;
  ctx.fillStyle = background;
  ctx.fillRect(x, y, w, h);
  const ypx = (v) => y + h - Math.min(1, Math.max(0, (v - min) / span)) * h;
  if (warnAbove !== null && warnAbove > min && warnAbove < top) {
    ctx.strokeStyle = warnColor;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(x, ypx(warnAbove));
    ctx.lineTo(x + w, ypx(warnAbove));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const n = series.length;
  if (n === 0) return { min, max: top };
  const step = w / Math.max(1, series.capacity - 1);
  const px = (i) => x + w - (n - 1 - i) * step;
  ctx.lineWidth = 1.25;
  let drawing = false;
  let hot = null;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = series.at(i);
    if (v !== v) { drawing = false; continue; }
    const isHot = warnAbove !== null && v > warnAbove;
    if (!drawing) { ctx.moveTo(px(i), ypx(v)); drawing = true; hot = isHot; continue; }
    if (isHot !== hot) { ctx.strokeStyle = hot ? warnColor : color; ctx.stroke(); ctx.beginPath(); ctx.moveTo(px(i - 1), ypx(series.at(i - 1))); hot = isHot; }
    ctx.lineTo(px(i), ypx(v));
  }
  ctx.strokeStyle = hot ? warnColor : color;
  ctx.stroke();
  return { min, max: top };
}
