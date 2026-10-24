import { VERTEX_FLOATS } from './mesh.js';

/**
 * Morph targets (blend shapes): a mesh that can change shape by mixing in stored offsets, such as a face that smiles, blinks and talks. Each target is a set of offsets for
 * every vertex's position (and optionally its normal); the mesh shows `base + sum(weight * offset)`. Weights are usually 0 to 1 but can go beyond.
 *
 * `new MorphTargets(mesh, targets)` makes a copy of the mesh that is yours to change: set weights, call `update()`, and draw `morph.mesh` instead of the original. Every character
 * can have its own, since each makes its own copy of the vertices (the indices, texture coordinates and skin weights are shared). It works on skinned meshes too: the shape
 * changes first and the skeleton then moves the result. Presentation only, like the rest of animation: it may use ordinary maths.
 *
 * @typedef {{position: Float32Array, normal?: Float32Array | null, name?: string}} MorphTarget Offsets: 3 floats per vertex
 */
export class MorphTargets {
  /**
   * @param {import('./mesh.js').Mesh} mesh The mesh to change (plain or skinned); it is left alone
   * @param {MorphTarget[]} targets
   * @param {object} [o]
   * @param {number[]} [o.weights] Starting weights (default: all 0)
   */
  constructor(mesh, targets, { weights } = {}) {
    const n = mesh.vertexCount;
    for (const [i, t] of targets.entries()) {
      if (!t.position || t.position.length !== n * 3) throw new Error(`morph target ${i}: needs 3 position offsets for each of the ${n} vertices`);
      if (t.normal && t.normal.length !== n * 3) throw new Error(`morph target ${i}: needs 3 normal offsets for each of the ${n} vertices`);
    }
    this.targets = targets;
    this.names = targets.map((t, i) => t.name ?? `target${i}`);
    this.base = mesh;
    this.weights = new Float32Array(targets.length);
    if (weights) for (let i = 0; i < Math.min(weights.length, targets.length); i++) this.weights[i] = weights[i];
    /** The mesh to draw. Its `version` goes up whenever `update()` changes it, which makes the renderers upload the new vertices. */
    this.mesh = { ...mesh, vertices: Float32Array.from(mesh.vertices), version: 0, min: [...mesh.min], max: [...mesh.max] };
    // room for the extremes the targets can reach, so culling does not drop a mesh whose shape grows out of its box
    for (let a = 0; a < 3; a++) {
      let lo = 0, hi = 0;
      for (const t of targets) {
        let tmin = 0, tmax = 0;
        for (let k = a; k < t.position.length; k += 3) { if (t.position[k] < tmin) tmin = t.position[k]; if (t.position[k] > tmax) tmax = t.position[k]; }
        lo += tmin; hi += tmax;
      }
      this.mesh.min[a] += lo; this.mesh.max[a] += hi;
    }
    this.applied = new Float32Array(targets.length).fill(NaN);   // the weights the vertices were last built with
    this.update();
  }

  /** The number of targets. */
  get count() { return this.targets.length; }

  /** The number of a target from its name (or the number itself); throws for one that does not exist. */
  indexOf(target) {
    const i = typeof target === 'number' ? target : this.names.indexOf(target);
    if (!(i >= 0 && i < this.targets.length)) throw new Error(`no morph target "${target}" (have: ${this.names.join(', ') || 'none'})`);
    return i;
  }

  /** Set one weight, by name or number. Call `update()` afterwards (once, after setting all you want). */
  set(target, weight) { this.weights[this.indexOf(target)] = weight; return this; }

  /** Set all the weights at once (`ArrayLike<number>`, in target order; missing ones become 0). */
  setWeights(values) {
    for (let i = 0; i < this.weights.length; i++) this.weights[i] = values[i] ?? 0;
    return this;
  }

  /** Move the weights toward a goal by at most `rate` per second (a smile that eases in); returns true while any weight is still on its way. */
  approach(goals, rate, dt) {
    let moving = false;
    for (let i = 0; i < this.weights.length; i++) {
      const goal = goals[i] ?? 0, d = goal - this.weights[i], step = rate * dt;
      if (Math.abs(d) <= step) this.weights[i] = goal; else { this.weights[i] += Math.sign(d) * step; moving = true; }
    }
    return moving;
  }

  /** Rebuild the vertices from the weights. Does nothing (and costs nothing) when no weight changed since the last call. @returns {boolean} whether the mesh changed */
  update() {
    const w = this.weights, ap = this.applied;
    let changed = false;
    for (let i = 0; i < w.length; i++) if (w[i] !== ap[i] && !(w[i] !== w[i] && ap[i] !== ap[i])) { changed = true; break; }
    if (!changed) return false;
    const base = this.base.vertices, out = this.mesh.vertices, n = this.base.vertexCount, F = VERTEX_FLOATS;
    out.set(base);
    let normals = false;
    for (let t = 0; t < w.length; t++) {
      const weight = w[t];
      if (weight === 0) continue;
      const tp = this.targets[t].position, tn = this.targets[t].normal;
      for (let v = 0; v < n; v++) {
        out[v * F] += weight * tp[v * 3]; out[v * F + 1] += weight * tp[v * 3 + 1]; out[v * F + 2] += weight * tp[v * 3 + 2];
      }
      if (tn) {
        normals = true;
        for (let v = 0; v < n; v++) {
          out[v * F + 3] += weight * tn[v * 3]; out[v * F + 4] += weight * tn[v * 3 + 1]; out[v * F + 5] += weight * tn[v * 3 + 2];
        }
      }
    }
    if (normals) {
      for (let v = 0; v < n; v++) {
        const x = out[v * F + 3], y = out[v * F + 4], z = out[v * F + 5], l = Math.sqrt(x * x + y * y + z * z) || 1;
        out[v * F + 3] = x / l; out[v * F + 4] = y / l; out[v * F + 5] = z / l;
      }
    }
    ap.set(w);
    this.mesh.version++;
    return true;
  }
}

/**
 * Evaluate weight keyframes: `times` ascending seconds and `values` with `count` weights per key, linear between keys (or held with `step`), clamped outside.
 * @param {ArrayLike<number>} times @param {ArrayLike<number>} values @param {number} count Weights per key @param {number} time @param {Float32Array} out At least `count` long
 * @param {boolean} [step]
 */
export function sampleWeights(times, values, count, time, out, step = false) {
  const n = times.length;
  if (n === 0) return out;
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] > time) hi = mid; else lo = mid + 1; }
  const i0 = Math.max(0, hi - 1), i1 = Math.min(n - 1, hi), span = times[i1] - times[i0];
  const u = step || span <= 0 ? 0 : Math.max(0, Math.min(1, (time - times[i0]) / span));
  for (let k = 0; k < count; k++) out[k] = values[i0 * count + k] + (values[i1 * count + k] - values[i0 * count + k]) * u;
  return out;
}

/**
 * Keyframed morph weights for one model (from a glTF animation that drives `weights`). `sample(time, out)` writes the weights; give them to `MorphTargets.setWeights`.
 */
export class MorphClip {
  /**
   * @param {string} name
   * @param {number} count Weights per key
   * @param {ArrayLike<number>} times @param {ArrayLike<number>} values `count` weights per key
   * @param {object} [o] `loop` (default true), `step`: hold each key instead of blending.
   */
  constructor(name, count, times, values, { loop = true, step = false } = {}) {
    if (times.length === 0 || values.length !== times.length * count) throw new Error(`morph clip "${name}": ${times.length} keys need ${times.length * count} weights (got ${values.length})`);
    this.name = name; this.count = count; this.times = Float32Array.from(times); this.values = Float32Array.from(values); this.loop = loop; this.step = step;
    this.duration = this.times[this.times.length - 1];
  }

  /** The time within the clip for a playback time: wrapped when looping, held at the end otherwise. */
  wrap(time) {
    if (this.duration <= 0) return 0;
    if (this.loop) { const t = time % this.duration; return t < 0 ? t + this.duration : t; }
    return Math.max(0, Math.min(this.duration, time));
  }

  /** Write the weights at a playback time into `out`. */
  sample(time, out = new Float32Array(this.count)) { return sampleWeights(this.times, this.values, this.count, this.wrap(time), out, this.step); }
}
