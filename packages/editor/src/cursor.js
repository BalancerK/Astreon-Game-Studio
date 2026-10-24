// The 3D cursor: a point in the scene that you place with Shift and a right click (or with Shift+S). New blocks appear at it, rotating and stretching can turn about it
// instead of about the middle of the selection, and "Selection to Cursor" and "Cursor to Selected" carry things to and from it. The page-less parts are here: the choice
// of pivot, the middle of some points, how far the selection must move to reach the cursor, the directions of its own axes, and the note that keeps all this with
// the scene.
import { quat } from '../../math/src/index.js';

/** The ways a rotation or a stretch can pick its centre. */
export const PIVOTS = [
  { id: 'median', label: 'Middle of the selection', short: '' },
  { id: 'cursor', label: '3D cursor', short: 'about the 3D cursor' },
  { id: 'individual', label: 'Each object on its own', short: 'each on its own' },
];

/** The middle (the average) of some points, or null when there are none. @param {number[][]} points */
export function medianOf(points) {
  if (!points.length) return null;
  const sum = [0, 0, 0];
  for (const p of points) for (let a = 0; a < 3; a++) sum[a] += p[a];
  return sum.map((v) => v / points.length);
}

/**
 * The point a rotation or stretch turns about for one object.
 * @param {'median' | 'cursor' | 'individual'} mode
 * @param {number[]} median the middle of the selection
 * @param {number[]} cursor
 * @param {number[]} own the object's own origin
 */
export function pivotFor(mode, median, cursor, own) {
  if (mode === 'cursor') return cursor;
  if (mode === 'individual') return own;
  return median;
}

/** How far the selection has to move for its middle to be at the cursor. @param {number[][]} points the objects' origins */
export function offsetToCursor(points, cursor) {
  const m = medianOf(points);
  return m ? cursor.map((v, a) => v - m[a]) : [0, 0, 0];
}

/** The cursor as words for a message: `x, y, z` to two decimals. */
export function cursorText(cursor) {
  return cursor.map((v) => Math.round(v * 100) / 100).join(', ');
}

/** How a new block is turned when it is added: standing straight, or turned like the 3D cursor. */
export const ALIGNS = [
  { id: 'world', label: 'New blocks stand straight' },
  { id: 'cursor', label: 'New blocks turn like the 3D cursor' },
];

/** No turn. */
export const NO_TURN = [0, 0, 0, 1];

/** The ways a lock to X, Y or Z can choose its directions: the world's, or the 3D cursor's own. */
export const ORIENTATIONS = [
  { id: 'global', label: 'Global axes', short: '' },
  { id: 'cursor', label: '3D cursor axes', short: 'along the 3D cursor' },
];

/** The cursor's own x, y and z directions in the world, from its turn. @param {number[]} rotation a quaternion */
export function axesOf(rotation = NO_TURN) {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => quat.rotate([0, 0, 0], rotation, v));
}

const finite = (v) => Number.isFinite(v);
const isDefault = (q) => Math.abs(q[0]) < 1e-9 && Math.abs(q[1]) < 1e-9 && Math.abs(q[2]) < 1e-9 && Math.abs(q[3] - 1) < 1e-9;

/**
 * The cursor as the note kept in the scene file (`editor.cursor`): only what is not the usual, or `null` when everything is the usual (so a scene nobody touched the cursor in
 * stays as it was).
 */
export function cursorNote({ position, rotation, pivot, orientation, align = 'world' }) {
  const note = {};
  if (position.some((v) => Math.abs(v) > 1e-9)) note.position = position.map((v) => Math.round(v * 1000) / 1000);
  if (!isDefault(rotation)) note.rotation = rotation.map((v) => Math.round(v * 1e6) / 1e6);
  if (pivot !== 'median') note.pivot = pivot;
  if (orientation !== 'global') note.orientation = orientation;
  if (align !== 'world') note.align = align;
  return Object.keys(note).length ? note : null;
}

/** Read the note back, forgiving a bad one (anything wrong is the usual value). @returns {{position: number[], rotation: number[], pivot: string, orientation: string, align: string}} */
export function readCursorNote(note) {
  const n = note && typeof note === 'object' ? note : {};
  const position = Array.isArray(n.position) && n.position.length === 3 && n.position.every(finite) ? n.position.map((v) => Math.max(-1e6, Math.min(1e6, v))) : [0, 0, 0];
  let rotation = [...NO_TURN];
  if (Array.isArray(n.rotation) && n.rotation.length === 4 && n.rotation.every(finite) && Math.hypot(...n.rotation) > 1e-6) rotation = quat.normalize([0, 0, 0, 1], n.rotation);
  return {
    position, rotation,
    pivot: PIVOTS.some((p) => p.id === n.pivot) ? n.pivot : 'median',
    orientation: ORIENTATIONS.some((o) => o.id === n.orientation) ? n.orientation : 'global',
    align: ALIGNS.some((a) => a.id === n.align) ? n.align : 'world',
  };
}
