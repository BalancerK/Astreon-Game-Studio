// Dragging the sides of a box: a face (one side) or an edge (two sides at once) moves while the opposite sides stay where they are, so the box grows or shrinks on that
// side only and its middle moves to keep the other sides still. This is the maths of it with no page in it: which faces and edges a box has, and what moving one does to
// the half sizes and to the middle. The editor turns that into changes to the object's size parameters and its place (see blender.js).
//
// A box is described in its own frame: half sizes `[hx, hy, hz]` around its middle. A feature is `{id, kind, axes, signs, point, along}`: a face has one axis and a
// sign (`x+` is the side at +x), an edge has two (`x+y-`) and runs along the third.
const NAMES = ['x', 'y', 'z'];
/** The smallest a half size may get: a box can be flattened but never turned inside out. */
export const MIN_HALF = 0.025;

/** Every face and edge of a box (6 and 12), with the place of its middle in the box's own frame. @param {number[]} half */
export function boxFeatures(half) {
  const out = [];
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const point = [0, 0, 0];
      point[a] = s * half[a];
      out.push({ id: `${NAMES[a]}${s > 0 ? '+' : '-'}`, kind: 'face', axes: [a], signs: [s], point, along: null });
    }
  }
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      const along = 3 - a - b;
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          const point = [0, 0, 0];
          point[a] = sa * half[a];
          point[b] = sb * half[b];
          out.push({ id: `${NAMES[a]}${sa > 0 ? '+' : '-'}${NAMES[b]}${sb > 0 ? '+' : '-'}`, kind: 'edge', axes: [a, b], signs: [sa, sb], point, along });
        }
      }
    }
  }
  return out;
}

/**
 * Move a face or an edge by a vector in the box's own frame (only the parts along the feature's axes count) and say what the box becomes.
 * @param {number[]} half the half sizes now
 * @param {{axes: number[], signs: number[]}} feature
 * @param {number[]} delta how far to move it, in the box's frame
 * @returns {{half: number[], shift: number[], moved: number[]}} the new half sizes, how far the box's middle moves (in its frame), and how far the feature really moved
 *   (less than asked when a side was stopped by the smallest size)
 */
export function moveFeature(half, feature, delta) {
  const next = [...half];
  const shift = [0, 0, 0];
  const moved = [0, 0, 0];
  feature.axes.forEach((a, i) => {
    const s = feature.signs[i];
    const outward = Math.max(delta[a] * s, -2 * (half[a] - MIN_HALF));      // moving outward grows the box; moving in is stopped at the smallest size
    next[a] = half[a] + outward / 2;
    shift[a] = (outward * s) / 2;
    moved[a] = outward * s;
  });
  return { half: next, shift, moved };
}

/** The name of a feature in words: "right face", "top front edge". */
export function describeFeature(feature) {
  const word = { 'x+': 'right', 'x-': 'left', 'y+': 'top', 'y-': 'bottom', 'z+': 'front', 'z-': 'back' };
  const parts = feature.axes.map((a, i) => word[`${NAMES[a]}${feature.signs[i] > 0 ? '+' : '-'}`]);
  return feature.kind === "face" ? `${parts[0]} face` : `${parts.join(" ")} edge`;
}

/**
 * The feature nearest to a point on the screen, within a distance in pixels.
 * @param {{id: string, kind?: string, x: number, y: number, depth: number}[]} projected features with their screen place and how far they are from the camera
 * @param {number} x
 * @param {number} y
 * @param {number} [reach] pixels
 * @returns {string | null} the id, preferring a nearer one when two are as close
 */
export function nearestFeature(projected, x, y, reach = 12) {
  let best = null;
  for (const f of projected) {
    const d = Math.hypot(f.x - x, f.y - y);
    if (d > reach) continue;
    const score = f.kind === 'edge' ? d : Math.max(0, d - 6);                // a face is easier to hit than an edge that lies over it (seen from the front, an edge's middle is on a face's)
    const tie = best && Math.abs(score - best.score) <= 2;
    const better = !best || score < best.score - 2 || (tie && (f.kind !== best.kind ? f.kind === 'face' : f.depth < best.depth));
    if (better) best = { id: f.id, kind: f.kind, score, depth: f.depth };
  }
  return best ? best.id : null;
}
