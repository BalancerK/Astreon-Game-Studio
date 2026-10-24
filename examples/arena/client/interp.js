import { netSchema } from '../shared/game.js';

const [posComp, styleComp, healthComp] = netSchema.comps;
const [fx, fy] = posComp.fields;
const [fhue, frad] = styleComp.fields;
const [fhp] = healthComp.fields;
const F = netSchema.fieldCount;
const TELEPORT_DISTANCE = 300; // jumps larger than this (respawn) are not smeared across the map

/** Reusable output: parallel arrays, one slot per visible entity. */
export function createSampleBuffer(capacity = 4096) {
  return {
    count: 0,
    ids: new Uint32Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    hue: new Uint8Array(capacity),
    radius: new Uint8Array(capacity),
    hp: new Uint8Array(capacity),
  };
}

/**
 * Entity positions at a (fractional) server tick, interpolated between the two
 * committed snapshots around it. Holds the nearest snapshot at the edges.
 *
 * @param {import('../../../packages/protocol/src/index.js').SnapshotHistory} history
 * @param {number} renderTick
 * @param {ReturnType<typeof createSampleBuffer>} out
 * @returns {ReturnType<typeof createSampleBuffer>} `out`
 */
export function sampleWorld(history, renderTick, out) {
  out.count = 0;
  const { before, after } = history.around(renderTick);
  const to = after ?? before;
  if (!to) return out;
  const from = before && after && before !== after ? before : null;
  const t = from ? (renderTick - from.tick) / (to.tick - from.tick) : 1;
  for (let r = 0; r < to.count && out.count < out.ids.length; r++) {
    if (((to.masks[r] >>> posComp.bit) & 1) === 0) continue;
    const o = r * F;
    let x = fx.codec.dequantize(to.vals[o + fx.col]);
    let y = fy.codec.dequantize(to.vals[o + fy.col]);
    if (from) {
      const rb = from.rowOf(to.ids[r]);
      if (rb >= 0) {
        const ob = rb * F;
        const x0 = fx.codec.dequantize(from.vals[ob + fx.col]);
        const y0 = fy.codec.dequantize(from.vals[ob + fy.col]);
        if (Math.abs(x - x0) < TELEPORT_DISTANCE && Math.abs(y - y0) < TELEPORT_DISTANCE) {
          x = x0 + (x - x0) * t;
          y = y0 + (y - y0) * t;
        }
      }
    }
    const i = out.count++;
    out.ids[i] = to.ids[r];
    out.x[i] = x;
    out.y[i] = y;
    out.hue[i] = fhue.codec.dequantize(to.vals[o + fhue.col]);
    out.radius[i] = frad.codec.dequantize(to.vals[o + frad.col]);
    out.hp[i] = ((to.masks[r] >>> healthComp.bit) & 1) ? fhp.codec.dequantize(to.vals[o + fhp.col]) : 100;
  }
  return out;
}
