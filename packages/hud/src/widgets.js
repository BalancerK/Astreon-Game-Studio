// Widgets for a HUD drawn on a 2D canvas over a 3D view: panels with cut corners, segmented gauges, bars, a cooldown sweep and a compass tape. Each takes the canvas context `g` and a scale `u`
// (1 at the size the numbers were chosen for; a game sets it from the window), draws and leaves the context as it found it.
import { HUD_THEME } from './theme.js';

const TAU = Math.PI * 2;

/** A path round a rectangle with its corners cut off (fill or stroke it afterwards). @param {CanvasRenderingContext2D} g @param {number} c how much is cut off each corner */
export function chamfer(g, x, y, w, h, c) {
  g.beginPath();
  g.moveTo(x + c, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c);
  g.closePath();
}

/**
 * A console panel: dark flat glass, a thin edge, and one short accent line on the top edge.
 * @param {CanvasRenderingContext2D} g @param {number} u the scale @param {{c?: number, glow?: string, theme?: import('./theme.js').HudTheme}} [o] `c` the cut of the corners (4), `glow` the edge colour
 */
export function panel(g, x, y, w, h, u, { c = 4, glow, theme = HUD_THEME } = {}) {
  chamfer(g, x, y, w, h, c * u);
  g.fillStyle = theme.panel; g.fill();
  g.strokeStyle = glow ?? theme.edge; g.lineWidth = 1; g.stroke();
  g.strokeStyle = theme.main; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(x + c * u, y + 0.5); g.lineTo(x + c * u + 22 * u, y + 0.5); g.stroke();
}

/**
 * A row (or a column) of small cells that fill from the start: a gauge.
 * @param {CanvasRenderingContext2D} g @param {number} f how full, 0 to 1 @param {string} colour the colour of the cells that are on @param {number} [count] @param {boolean} [vertical] fills upward
 */
export function segments(g, x, y, w, h, f, colour, count = 24, vertical = false) {
  const gap = 2, on = Math.round(Math.max(0, Math.min(1, f)) * count);
  for (let i = 0; i < count; i++) {
    g.fillStyle = i < on ? colour : 'rgba(255,255,255,0.08)';
    if (vertical) { const ch = (h - gap * (count - 1)) / count; g.fillRect(x, y + h - (i + 1) * ch - i * gap, w, ch); } else { const cw = (w - gap * (count - 1)) / count; g.fillRect(x + i * (cw + gap), y, cw, h); }
  }
}

/** A plain bar that fills from the left. @param {CanvasRenderingContext2D} g @param {number} f how full, 0 to 1 @param {string} colour @param {string} [back] the empty part */
export function bar(g, x, y, w, h, f, colour, back = 'rgba(255,255,255,0.1)') {
  g.fillStyle = back; g.fillRect(x, y, w, h);
  g.fillStyle = colour; g.fillRect(x, y, w * Math.max(0, Math.min(1, f)), h);
}

/**
 * A cooldown sweep: the part of a square cell that is still cooling is shaded like a clock hand going round, starting at the top. `frac` is the part left (1 all of it, 0 none).
 * @param {CanvasRenderingContext2D} g @param {number} s the cell's size @param {number} cut the cut of its corners @param {number} frac @param {string} [shade]
 */
export function sweep(g, x, y, s, cut, frac, shade = 'rgba(0, 0, 0, 0.58)') {
  g.save(); chamfer(g, x, y, s, s, cut); g.clip();
  g.fillStyle = shade;
  g.beginPath(); g.moveTo(x + s / 2, y + s / 2); g.arc(x + s / 2, y + s / 2, s, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, Math.min(1, frac))); g.closePath(); g.fill();
  g.restore();
}

/** The compass tape along the top: 120 degrees across, a tick every 5, the points named, a marker in the middle and the bearing under it. @param {CanvasRenderingContext2D} g @param {number} W the screen's width @param {number} yaw radians (the game's own turn) @param {number} u @param {import('./theme.js').HudTheme} [theme] */
export function compassTape(g, W, yaw, u, theme = HUD_THEME) {
  const w = 440 * u, h = 28 * u, x = W / 2 - w / 2, y = 8 * u, bearing = ((-yaw * 180) / Math.PI % 360 + 360) % 360;
  panel(g, x, y, w, h, u, { c: 6, theme });
  g.save(); g.beginPath(); g.rect(x + 4, y, w - 8, h); g.clip();
  const per = w / 120;                                                                         // 120 degrees across
  g.textAlign = 'center'; g.font = `${Math.round(10 * u)}px ${theme.font}`;
  for (let d = Math.floor((bearing - 62) / 5) * 5; d <= bearing + 62; d += 5) {
    const px = x + w / 2 + (d - bearing) * per, deg = ((d % 360) + 360) % 360;
    g.strokeStyle = theme.main; g.lineWidth = deg % 15 === 0 ? 1.6 : 1;
    g.beginPath(); g.moveTo(px, y + h); g.lineTo(px, y + h - (deg % 15 === 0 ? 9 : 5) * u); g.stroke();
    if (deg % 45 === 0) { g.fillStyle = deg % 90 === 0 ? theme.amber : theme.white; g.fillText({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg], px, y + 14 * u); }
  }
  g.restore();
  g.fillStyle = theme.amber; g.beginPath(); g.moveTo(W / 2, y + h + 6 * u); g.lineTo(W / 2 - 5 * u, y + h + 13 * u); g.lineTo(W / 2 + 5 * u, y + h + 13 * u); g.fill();
  g.fillStyle = theme.white; g.font = `bold ${Math.round(11 * u)}px ${theme.font}`; g.fillText(String(Math.round(bearing)).padStart(3, '0'), W / 2, y + h + 25 * u);
  g.textAlign = 'left';
}
