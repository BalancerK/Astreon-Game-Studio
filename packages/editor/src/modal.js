// Blender-style "modal" transforms for the scene editor: press G (grab), R (rotate) or S (scale), then simply move the mouse and the objects follow at once. While
// it runs: X, Y or Z locks it to an axis (a second press uses the object's own axis, a third lets go), Shift+X, Y or Z locks it to the plane without that axis, a
// number typed on the keyboard says exactly how much (Backspace to correct, - to flip the sign), Shift slows the mouse down for fine work, Ctrl snaps to steps,
// Enter or a click keeps it, Esc or a right click puts everything back. This is the maths only: it knows nothing of the page, so it is tested in Node.
//
// For a scale the axes are the object's own, and what changes is the object's size (for a box its width, height or depth), so S then Y is how you make a wall taller.
import { quat } from '../../math/src/index.js';
import { add, sub, scale as mul, dot, normalize } from './picking.js';

const AXES = { x: 0, y: 1, z: 2 };
const NAMES = { grab: 'Move', rotate: 'Rotate', scale: 'Scale' };
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * One modal transform, from the key press to Enter or Esc.
 * @param {object} o
 * @param {'grab' | 'rotate' | 'scale'} o.kind
 * @param {{x: number, y: number}} o.start where the mouse was (pixels in the viewport) when it began
 * @param {{x: number, y: number} | null} o.pivotScreen where the objects' middle is on the screen (for rotating and scaling)
 * @param {{right: number[], up: number[], forward: number[], unitsPerPixel: number}} o.view the camera's directions and how big a pixel is at the objects
 * @param {number[][]} [o.local] the objects' own axes when there is one object ([[x], [y], [z]] unit vectors); the world's otherwise
 * @param {number[][] | null} [o.world] other directions for the first press of X, Y or Z (the 3D cursor's axes); the world's when null
 * @param {{move?: number, rotate?: number, scale?: number}} [o.snap] steps used while Ctrl is held: metres, degrees, a scale factor
 */
export class Modal {
  constructor({ kind, start, pivotScreen = null, view, local = null, world = null, snap = { move: 0.5, rotate: 15, scale: 0.1 } }) {
    this.kind = kind;
    this.view = view;
    this.snap = snap;
    this.localAxes = local;
    /** The directions X, Y and Z lock to the first time: the world's, or another set (the 3D cursor's). */
    this.world = world ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    this.turnedWorld = !!world;
    this.axis = null;                // 'x' | 'y' | 'z'
    this.plane = false;              // the plane without that axis
    this.local = false;              // the object's own axis rather than the world's
    this.typed = '';
    this.ctrl = false;
    this.pivotScreen = pivotScreen;
    this.last = { ...start };
    this.move = { x: 0, y: 0 };                // pixels moved (slowed by Shift)
    this.angle = 0;                            // radians turned on the screen, counted-up
    this.ratio = 1;                            // how far from the middle now, against at the start
    this.lastAngle = pivotScreen ? Math.atan2(-(start.y - pivotScreen.y), start.x - pivotScreen.x) : 0;
    this.startDist = pivotScreen ? Math.max(8, Math.hypot(start.x - pivotScreen.x, start.y - pivotScreen.y)) : 1;
    this.lastDist = this.startDist;
    this.finished = null;                      // 'confirm' | 'cancel'
  }

  get name() { return NAMES[this.kind]; }

  /** The axis (as a world direction) that is locked, or null. */
  axisVector() {
    if (!this.axis) return null;
    const basis = this.local && this.localAxes ? this.localAxes : this.world;
    return basis[AXES[this.axis]];
  }

  /** Mouse moved to a pixel. `fine` (Shift) makes the mouse move a tenth as much, `ctrl` snaps. */
  pointer(x, y, { shift = false, ctrl = false } = {}) {
    this.ctrl = ctrl;
    const k = shift ? 0.1 : 1;
    this.move.x += (x - this.last.x) * k;
    this.move.y += (y - this.last.y) * k;
    this.last = { x, y };
    if (this.pivotScreen) {
      const a = Math.atan2(-(y - this.pivotScreen.y), x - this.pivotScreen.x);
      let d = a - this.lastAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.angle += d * k;
      this.lastAngle = a;
      const dist = Math.max(8, Math.hypot(x - this.pivotScreen.x, y - this.pivotScreen.y));
      this.ratio *= (dist / this.lastDist) ** k;
      this.lastDist = dist;
    }
  }

  /**
   * A key pressed while it runs. Returns true when the key was for this transform (the page must not use it for anything else).
   * @param {string} code a key name: 'x', 'y', 'z', '0'..'9', '.', '-', 'Backspace', 'Enter', 'Escape'
   * @param {{shift?: boolean, ctrl?: boolean}} [mods]
   */
  key(code, { shift = false, ctrl = false } = {}) {
    this.ctrl = ctrl;
    const k = code.toLowerCase();
    if (k === 'enter' || k === ' ') { this.finished = 'confirm'; return true; }
    if (k === 'escape') { this.finished = 'cancel'; return true; }
    if (k in AXES) {
      if (shift) { this.axis = k; this.plane = true; this.local = false; return true; }
      if (this.axis === k && !this.plane) { if (!this.local) this.local = true; else { this.axis = null; this.local = false; } }
      else { this.axis = k; this.local = false; }
      this.plane = false;
      return true;
    }
    if (/^[0-9]$/.test(k) || k === '.') { if (k !== '.' || !this.typed.includes('.')) this.typed += k; return true; }
    if (k === '-') { this.typed = this.typed.startsWith('-') ? this.typed.slice(1) : `-${this.typed}`; return true; }
    if (k === 'backspace') { this.typed = this.typed.slice(0, -1); return true; }
    return false;
  }

  /** The number typed so far, or null. */
  get number() {
    if (!this.typed || this.typed === '-' || this.typed === '.' || this.typed === '-.') return null;
    const n = Number(this.typed);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * What the transform is right now.
   * - grab: `{vector}`, how far to move, in world units, as x y z
   * - rotate: `{axis, angle}`, a world axis and radians (counter-clockwise looking against the axis)
   * - scale: `{factors}`, how much to scale along each of the object's own x, y and z (1 leaves it)
   */
  result() {
    const v = this.view;
    const typed = this.number;
    const snapTo = (value, step) => (this.ctrl && step > 0 ? Math.round(value / step) * step : value);
    if (this.kind === 'grab') {
      const axis = this.axisVector();
      let vec;
      if (typed !== null) vec = mul(axis ?? this.world[0], typed);
      else {
        const free = add(mul(v.right, this.move.x * v.unitsPerPixel), mul(v.up, -this.move.y * v.unitsPerPixel));
        if (axis && !this.plane) {
          const pixels = [dot(axis, v.right) / v.unitsPerPixel, -dot(axis, v.up) / v.unitsPerPixel];     // one unit of the axis, as pixels on the screen
          const len2 = pixels[0] ** 2 + pixels[1] ** 2;
          const amount = len2 < 1e-9 ? 0 : (this.move.x * pixels[0] + this.move.y * pixels[1]) / len2;
          vec = mul(axis, snapTo(amount, this.snap.move));
        } else if (axis && this.plane) vec = sub(free, mul(axis, dot(free, axis)));
        else vec = free;
        if (!axis || this.plane) vec = vec.map((c) => snapTo(c, this.snap.move));
      }
      return { vector: vec };
    }
    if (this.kind === 'rotate') {
      const axis = this.axisVector() ?? mul(v.forward, -1);                       // by default about the line from you to the objects
      let angle;
      if (typed !== null) angle = (typed * Math.PI) / 180;
      else {
        const toward = dot(axis, mul(v.forward, -1));
        angle = this.angle * (toward < 0 ? -1 : 1);
        angle = snapTo(angle, (this.snap.rotate * Math.PI) / 180);
      }
      return { axis: normalize(axis), angle };
    }
    let f = typed !== null ? typed : snapTo(this.ratio, this.snap.scale);
    f = Math.max(0.01, f);
    const factors = [1, 1, 1];
    if (!this.axis) factors.fill(f);
    else if (this.plane) { for (let i = 0; i < 3; i++) if (i !== AXES[this.axis]) factors[i] = f; }
    else factors[AXES[this.axis]] = f;
    return { factors };
  }

  /** The words for the top of the viewport, the way Blender's header says what is going on. */
  header() {
    const r = this.result();
    const axis = this.axis ? ` ${this.plane ? 'not ' : ''}${this.axis.toUpperCase()}${this.local ? ' (its own)' : ''}` : '';
    const typed = this.typed ? `  [${this.typed}]` : '';
    let body;
    if (this.kind === 'grab') body = `${round(r.vector[0])}, ${round(r.vector[1])}, ${round(r.vector[2])}`;
    else if (this.kind === 'rotate') body = `${round(((this.snappedAngle ?? r.angle) * 180) / Math.PI, 1)}°`;
    else {
      const f = this.snappedFactors ?? r.factors;
      body = f.every((x) => x === f[0]) ? `×${round(f[0])}` : f.map((x) => `×${round(x)}`).join(' ');
    }
    const note = this.note ? ` (${this.note})` : '';
    return `${this.name}${axis}${note}   ${body}${typed}   ·   X Y Z axis · type a number · Shift fine · Ctrl snap · Enter keep · Esc cancel`;
  }
}

/** The rotation of an axis and angle, as a quaternion. */
export const axisAngle = (axis, angle) => quat.setAxisAngle ? quat.setAxisAngle([0, 0, 0, 1], axis, angle) : fromAxisAngle(axis, angle);

function fromAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  const n = normalize(axis);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}
