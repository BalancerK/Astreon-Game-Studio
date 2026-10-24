// Signed distance fields for text that stays crisp at any size. Pure maths on byte arrays: no canvas, so it is testable in Node.

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb and Huttenlocher): `f` in, `d` out, `v` and `z` are scratch. */
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { // the new parabola hides the last one: drop it
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared Euclidean distance from every pixel to the nearest pixel where `seed[i]` is 1, in place into `out` (Float64Array). */
function distanceTransform(seed, w, h, out) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) out[i] = seed[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { // columns
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) { // rows
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
}

/**
 * Turn a coverage image into a signed distance field byte image.
 *
 * Each output byte encodes the distance to the glyph outline: 128 is exactly on the edge, 255 is `spread` pixels or more
 * inside, 0 is `spread` pixels or more outside. A shader recovers a sharp, anti-aliased edge at any scale by thresholding
 * around 0.5 with a width taken from the screen-space derivative.
 *
 * @param {ArrayLike<number>} coverage w*h values 0..255 (alpha of the rasterised glyph); >= 128 counts as inside.
 * @param {number} w
 * @param {number} h
 * @param {number} spread Distance range in pixels on each side of the edge that is encoded.
 * @param {Uint8Array} [out] w*h bytes
 * @returns {Uint8Array}
 */
export function computeSdf(coverage, w, h, spread, out = new Uint8Array(w * h)) {
  const n = w * h;
  const inside = new Uint8Array(n), outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const c = coverage[i] >= 128 ? 1 : 0; inside[i] = c; outside[i] = 1 - c; }
  const toOutside = new Float64Array(n), toInside = new Float64Array(n);
  distanceTransform(outside, w, h, toOutside); // for each pixel: distance to the nearest outside pixel (0 for outside pixels)
  distanceTransform(inside, w, h, toInside);   // distance to the nearest inside pixel
  for (let i = 0; i < n; i++) {
    // Pixel centres are half a pixel from the edge between an inside and an outside pixel: remove half a pixel so the edge sits at 0.
    const signed = inside[i] ? Math.sqrt(toOutside[i]) - 0.5 : -(Math.sqrt(toInside[i]) - 0.5);
    const v = 0.5 + signed / (2 * spread);
    out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}
