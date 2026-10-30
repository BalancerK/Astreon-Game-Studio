// A round radar that turns with the view: what is ahead is at the top, far things stick to the rim so none is lost, a wedge shows how wide the camera sees, and a ring with ticks and a north mark go
// round it. The picture inside (a terrain image, rings for places) and the markers are the game's: it gets a function to draw each, and a way to find where a world place is on the radar.
import { HUD_THEME } from './theme.js';

/**
 * Where a world place is on a radar. `to(x, z)` gives `{ x, y, edge, dist }`: its place on the canvas, whether it was far and was pulled in to the rim, and how far it is from the middle (in pixels).
 * Pure, so a game can test where its markers land.
 * @param {{cx: number, cy: number, size: number, range: number, center: number[], yaw: number}} r `range` is how many metres from the middle to the rim; `center` is `[x, z]` of the player; `yaw` the camera's (yaw 0 looks along -z)
 * @returns {{k: number, turn: number, to: (x: number, z: number, inset?: number) => {x: number, y: number, edge: boolean, dist: number}}} `k` is pixels a metre, `turn` the turn that puts the view's direction at the top
 */
export function radarProject({ cx, cy, size, range, center, yaw }) {
  const k = size / 2 / range, fx = -Math.sin(yaw), fz = -Math.cos(yaw), turn = -Math.PI / 2 - Math.atan2(fz, fx), c = Math.cos(turn), s = Math.sin(turn);
  const to = (x, z, inset = 7) => {
    const dx = x - center[0], dz = z - center[1], px = cx + (dx * c - dz * s) * k, py = cy + (dx * s + dz * c) * k, d = Math.hypot(px - cx, py - cy), edge = size / 2 - inset;
    return d > edge ? { x: cx + ((px - cx) / d) * edge, y: cy + ((py - cy) / d) * edge, edge: true, dist: d } : { x: px, y: py, edge: false, dist: d };
  };
  return { k, turn, to };
}

/**
 * Draw a radar.
 * @param {CanvasRenderingContext2D} g
 * @param {object} o
 * @param {number} o.cx @param {number} o.cy the middle on the canvas @param {number} [o.size] the diameter (150) @param {number} o.range metres from the middle to the rim @param {number[]} o.center `[x, z]` of the player
 * @param {number} o.yaw the camera's yaw @param {number} [o.wedge] half the width the camera sees, in radians, drawn as a wedge of light (none if left out)
 * @param {(g: CanvasRenderingContext2D, k: {k: number, turn: number}) => void} [o.drawWorld] draws the picture inside, with the origin at the player and units in metres (already turned to the view)
 * @param {(g: CanvasRenderingContext2D, to: ReturnType<typeof radarProject>['to'], r: {cx: number, cy: number, size: number, k: number, turn: number}) => void} [o.drawMarkers] draws what is on it, on top of the picture and the wedge, under the player's own mark
 * @param {string} [o.background] the colour behind the picture @param {import('./theme.js').HudTheme} [o.theme]
 * @returns {ReturnType<typeof radarProject>} so the caller can place its own writing round the rim
 */
export function drawRadar(g, { cx, cy, size = 150, range, center, yaw, wedge, drawWorld, drawMarkers, background = '#0b0e14', theme = HUD_THEME }) {
  const p = radarProject({ cx, cy, size, range, center, yaw }), { k, turn } = p;
  g.save();
  g.beginPath(); g.arc(cx, cy, size / 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = background; g.fillRect(cx - size / 2, cy - size / 2, size, size);
  if (drawWorld) { g.save(); g.translate(cx, cy); g.rotate(turn); g.scale(k, k); drawWorld(g, { k, turn }); g.restore(); }
  if (wedge) {                                                                // the view: a wedge of light as wide as the camera sees, so the radar shows what is in front
    const light = g.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    light.addColorStop(0, 'rgba(255, 255, 255, 0.42)'); light.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
    g.fillStyle = light; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, size / 2, -Math.PI / 2 - wedge, -Math.PI / 2 + wedge); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)'; g.lineWidth = 1; g.beginPath();
    for (const s of [-1, 1]) { g.moveTo(cx, cy); g.lineTo(cx + Math.sin(s * wedge) * size / 2, cy - Math.cos(wedge) * size / 2); }
    g.stroke();
  }
  if (drawMarkers) drawMarkers(g, p.to, { cx, cy, size, k, turn });
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx - 5, cy + 5); g.lineTo(cx + 5, cy + 5); g.fill();                      // you, always facing up
  g.restore();
  g.strokeStyle = theme.main; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, size / 2, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0x55 / 255; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, size / 4, 0, Math.PI * 2); g.stroke();                       // (the inner ring and the ticks are faint)
  for (let a = 0; a < 36; a++) { const t = (a / 36) * Math.PI * 2, r1 = size / 2 + 3, r2 = size / 2 + (a % 3 === 0 ? 10 : 6); g.beginPath(); g.moveTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); g.lineTo(cx + Math.cos(t) * r2, cy + Math.sin(t) * r2); g.stroke(); }
  g.globalAlpha = 1;
  g.fillStyle = theme.amber; g.font = `bold 12px ${theme.font}`; g.textAlign = 'center';
  g.fillText('N', cx + Math.sin(turn) * (size / 2 + 20), cy - Math.cos(turn) * (size / 2 + 20) + 4);                    // north (the world's -z) goes round the rim as the view turns
  g.textAlign = 'left';
  return p;
}
