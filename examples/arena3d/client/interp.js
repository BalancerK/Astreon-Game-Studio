import { netSchema } from '../shared/game.js';
import { lerpAngle } from '../../../packages/math/src/index.js';

const [posComp, lookComp, motionComp, styleComp, healthComp] = netSchema.comps;
const [fx, fy, fz] = posComp.fields;
const [fyaw, fpitch] = lookComp.fields;
const [, fgrounded] = motionComp.fields;
const [fhue] = styleComp.fields;
const [fhp] = healthComp.fields;
const F = netSchema.fieldCount;
const TELEPORT_DISTANCE = 20; // jumps larger than this (respawn) are not smeared across the map

/** Reusable output: parallel arrays, one slot per visible entity. */
export function createSampleBuffer(capacity = 1024) {
  return {
    count: 0,
    ids: new Uint32Array(capacity),
    x: new Float64Array(capacity), y: new Float64Array(capacity), z: new Float64Array(capacity),
    yaw: new Float64Array(capacity), pitch: new Float64Array(capacity),
    hue: new Uint8Array(capacity),
    grounded: new Uint8Array(capacity),
    hp: new Uint8Array(capacity),
  };
}

/**
 * Entity states at a (fractional) server tick, interpolated between the two committed snapshots around it (angles take the
 * short way round). Holds the nearest snapshot at the edges.
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
    let z = fz.codec.dequantize(to.vals[o + fz.col]);
    let yaw = fyaw.codec.dequantize(to.vals[o + fyaw.col]);
    const pitch = fpitch.codec.dequantize(to.vals[o + fpitch.col]);
    if (from) {
      const rb = from.rowOf(to.ids[r]);
      if (rb >= 0) {
        const ob = rb * F;
        const x0 = fx.codec.dequantize(from.vals[ob + fx.col]);
        const y0 = fy.codec.dequantize(from.vals[ob + fy.col]);
        const z0 = fz.codec.dequantize(from.vals[ob + fz.col]);
        if (Math.abs(x - x0) < TELEPORT_DISTANCE && Math.abs(y - y0) < TELEPORT_DISTANCE && Math.abs(z - z0) < TELEPORT_DISTANCE) {
          x = x0 + (x - x0) * t; y = y0 + (y - y0) * t; z = z0 + (z - z0) * t;
          yaw = lerpAngle(fyaw.codec.dequantize(from.vals[ob + fyaw.col]), yaw, t);
        }
      }
    }
    const i = out.count++;
    out.ids[i] = to.ids[r];
    out.x[i] = x; out.y[i] = y; out.z[i] = z; out.yaw[i] = yaw; out.pitch[i] = pitch;
    out.hue[i] = fhue.codec.dequantize(to.vals[o + fhue.col]);
    out.grounded[i] = ((to.masks[r] >>> motionComp.bit) & 1) ? fgrounded.codec.dequantize(to.vals[o + fgrounded.col]) : 1;
    out.hp[i] = ((to.masks[r] >>> healthComp.bit) & 1) ? fhp.codec.dequantize(to.vals[o + fhp.col]) : 100;
  }
  return out;
}
