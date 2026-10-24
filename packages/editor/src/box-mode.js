// "Shape edit" for the scene editor, like Blender's edit mode but for the sides of a box: press Tab with one box selected and every face (six) and edge (twelve) gets a
// handle. Drag a face to move that one side (the opposite side stays still, so the box grows or shrinks that way), drag an edge to move two sides at once, or click a handle
// and press G to move it with the keyboard (X Y Z, a typed number). It changes the box's real size parameters and its place, so it is as exact as typing them in the inspector.
// The maths is in box-edit.js; this reads the mouse and the document, draws the handles and writes the changes.
import { quat } from '../../math/src/index.js';
import { boxFeatures, moveFeature, describeFeature, nearestFeature } from './box-edit.js';
import { shapeHandles } from './shape-edit.js';
import { aabbOf, snapCoordinate } from './snap.js';
import { decompose, worldToLocalAt, atPatch } from './transform.js';
import { rayFromScreen, rayLine, rayPlane, add, sub, scale as mul, dot } from './picking.js';

const NAMES = ['x', 'y', 'z'];
const COLORS = ['#f0605a', '#6ad06a', '#5a8cf0'];
const HOT = '#ffe14d';
const round = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Shape edit for the box that is selected: the handles on its faces and edges, dragging them, and moving one with G. Returns what the keymap needs to run it.
 * @param {any} editor the object `startEditor` makes
 * @param {{pointer: () => {x: number, y: number}, say: (text: string) => void, changed: () => void}} io
 */
export function createBoxMode(editor, { pointer, say, changed }) {
  const { doc, selection, view, camera, library, state, stage } = editor;
  let active = false;
  let before = null;                   // the tool that was in use before
  let hover = null;                    // a feature id under the pointer
  let picked = null;                   // the feature that was clicked last
  let drag = null;
  let seq = 0;
  let guides = [];                     // lines to draw where the last move snapped to another object

  /** The box that can be edited: one selected entity whose shape is a box with width, height and depth parameters, and where it is now. */
  function snapshot() {
    if (selection.size !== 1 || state.playing) return null;
    const id = selection.primary;
    const entity = doc.get(id);
    const handles = shapeHandles(library, entity);
    if (!handles) return null;
    const names = {};
    const half = [0, 0, 0];
    for (const h of handles) if (h.axes.length === 1) { names[h.axes[0]] = h.name; half[NAMES.indexOf(h.axes[0])] = h.value; }
    if (!names.x || !names.y || !names.z) return null;                       // balls and capsules have no sides to drag
    const d = decompose(view.worldMatrix(id));
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => quat.rotate([0, 0, 0], d.rotation, v));
    return {
      id, names, half, pos: d.position, rot: d.rotation, scale: d.scale, axes, at: JSON.parse(JSON.stringify(entity.at ?? {})),
      parentWorld: entity.parent ? Float64Array.from(view.worldMatrix(entity.parent)) : null,
    };
  }

  const worldPoint = (st, local) => add(st.pos, add(mul(st.axes[0], local[0] * st.scale), add(mul(st.axes[1], local[1] * st.scale), mul(st.axes[2], local[2] * st.scale))));
  const byId = (st) => new Map(boxFeatures(st.half).map((f) => [f.id, f]));

  /** Every handle with its place on the screen. */
  function projected(st) {
    return boxFeatures(st.half).map((f) => {
      const w = worldPoint(st, f.point);
      const p = camera.worldToScreen(w[0], w[1], w[2]);
      return { id: f.id, kind: f.kind, feature: f, world: w, x: p.x, y: p.y, depth: p.depth, visible: p.visible };
    });
  }

  function enter() {
    if (active) return true;
    if (!snapshot()) { say('Select one box first (a cube, wall, floor...) and press Tab to drag its sides'); return false; }
    active = true;
    before = state.tool;
    editor.setTool('select');                                                   // the move handles would be in the way
    changed();
    return true;
  }

  function leave() {
    if (!active) return;
    cancel();
    active = false;
    hover = null;
    picked = null;
    editor.setTool(before ?? 'translate');
    stage.style.cursor = '';
    changed();
  }

  /** Change the box: move a face or an edge by `delta` (the box's own frame, in world units). */
  function applyDelta(st, feature, delta, merge) {
    const k = st.scale;
    const mv = moveFeature(st.half, feature, delta.map((v) => v / k));
    const params = {};
    let shift = [0, 0, 0];
    feature.axes.forEach((a, i) => {
      const half = round(mv.half[a]);
      params[st.names[NAMES[a]]] = half;
      shift = add(shift, mul(st.axes[a], (half - st.half[a]) * feature.signs[i] * k));        // from the rounded size, so the side that stays really stays
    });
    const at = worldToLocalAt(st.parentWorld, add(st.pos, shift), st.rot, st.scale, st.at);
    doc.batch('Reshape', () => { doc.update(st.id, { params }); doc.update(st.id, atPatch(st.at, at)); }, { merge });
    return mv;
  }

  /**
   * Line a face or an edge being dragged up with the other boxes: its plane meets another box's side or middle. Only along the world's axes (a turned box's sides do not snap).
   * @returns {number[]} the move, nudged
   */
  function snapDelta(st, feature, delta, off = false) {
    guides = [];
    if (!state.objectSnap || off || !editor.snapTargets) return delta;
    const out = [...delta];
    const self = view.bounds([st.id]);
    const targets = editor.snapTargets([st.id]);
    if (!self || !targets.length) return delta;
    const threshold = 10 * (editor.pixelSize?.(st.pos) ?? 0.01);
    feature.axes.forEach((a) => {
      const d = st.axes[a];
      const k = [0, 1, 2].find((i) => Math.abs(d[i]) > 0.999);
      if (k === undefined) return;
      const p0 = worldPoint(st, boxFeatures(st.half).find((f) => f.id === feature.id).point);
      const c = p0[k] + out[a] * d[k];
      const hit = snapCoordinate(c, k, self, targets, { threshold });
      if (!hit) return;
      out[a] += (hit.value - c) / d[k];
      const from = [...p0];
      const to = [0, 1, 2].map((i) => (hit.target.min[i] + hit.target.max[i]) / 2);
      from[k] = hit.value;
      to[k] = hit.value;
      guides.push({ axis: k, value: hit.value, from, to });
    });
    return out;
  }

  /** What a ray does to the feature being dragged, as a move in the box's frame (world units). */
  function deltaFor(ray, mods) {
    const { st, feature, mode, start } = drag;
    const delta = [0, 0, 0];
    if (mode === 'line') {
      const hit = rayLine(ray.origin, ray.dir, start.point, start.dir);
      if (!hit) return null;
      delta[feature.axes[0]] = hit.t - start.t;
    } else {
      const hit = rayPlane(ray.origin, ray.dir, start.point, start.dir);
      if (!hit) return null;
      const d = sub(hit.point, start.hit);
      for (const a of feature.axes) delta[a] = dot(d, st.axes[a]);
    }
    if (mods.ctrl) for (const a of feature.axes) delta[a] = Math.round(delta[a] / 0.25) * 0.25;
    return delta;
  }

  function nearest(x, y) {
    const st = snapshot();
    if (!st) return null;
    const list = projected(st).filter((p) => p.visible);
    return nearestFeature(list, x, y, 13);
  }

  function pointerDown(e, local) {
    if (!active || e.button !== 0 || drag) return false;
    const st = snapshot();
    if (!st) { leave(); return false; }
    const id = nearest(local.x, local.y);
    if (!id) return false;
    const feature = byId(st).get(id);
    picked = id;
    const ray = rayFromScreen(camera, local.x, local.y);
    const p0 = worldPoint(st, feature.point);
    let start;
    let mode;
    if (feature.kind === 'face') {
      mode = 'line';
      const dir = st.axes[feature.axes[0]];
      const hit = rayLine(ray.origin, ray.dir, p0, dir);
      if (!hit) return true;
      start = { point: p0, dir, t: hit.t };
    } else {
      mode = 'plane';
      const dir = editor.orbit.forward();                                       // the plane facing the camera: the pointer moves the edge in what you see
      const hit = rayPlane(ray.origin, ray.dir, p0, dir);
      if (!hit) return true;
      start = { point: p0, dir, hit: hit.point };
    }
    drag = { st, feature, mode, start, seq: ++seq, applied: false };
    say(`Dragging the ${describeFeature(feature)}`);
    return true;
  }

  function pointerMove(e, local) {
    if (!active) return;
    if (!drag) {
      const id = nearest(local.x, local.y);
      if (id !== hover) { hover = id; stage.style.cursor = id ? 'pointer' : ''; }
      return;
    }
    const delta = deltaFor(rayFromScreen(camera, local.x, local.y), { ctrl: e.ctrlKey || e.metaKey });
    if (!delta) return;
    applyDelta(drag.st, drag.feature, snapDelta(drag.st, drag.feature, delta, e.altKey), `box:${drag.seq}`);
    drag.applied = true;
  }

  function pointerUp() {
    if (!drag) return false;
    drag = null;
    guides = [];
    say('Done');
    return true;
  }

  /** Put it back: the drag in progress is undone as a whole. */
  function cancel() {
    if (!drag) return false;
    if (drag.applied) doc.undo();
    drag = null;
    guides = [];
    say('Cancelled');
    return true;
  }

  const axisOf = (st, feature) => feature.axes.map((a) => ({ axis: a, name: NAMES[a], dir: st.axes[a] }));

  /** The overlay: a handle on every face and edge of the box. */
  function draw(g) {
    if (!active) return;
    const st = snapshot();
    if (!st) return;
    const list = projected(st);
    const drawn = [];
    for (const p of list) {
      if (!p.visible) continue;
      const on = p.id === picked || (drag && drag.feature.id === p.id);
      const hot = on || p.id === hover;
      const face = p.feature.kind === 'face';
      const size = hot ? 7 : face ? 5 : 4;
      g.beginPath();
      if (face) g.rect(p.x - size, p.y - size, size * 2, size * 2);
      else { g.moveTo(p.x, p.y - size); g.lineTo(p.x + size, p.y); g.lineTo(p.x, p.y + size); g.lineTo(p.x - size, p.y); g.closePath(); }
      g.fillStyle = hot ? HOT : face ? COLORS[p.feature.axes[0]] : '#e8ecf6';
      g.fill();
      g.strokeStyle = on ? '#ffffff' : 'rgba(0, 0, 0, .6)';
      g.lineWidth = on ? 2 : 1;
      g.stroke();
      if (hot) drawn.push(p);
    }
    g.font = '12px system-ui, sans-serif';
    g.textBaseline = 'top';
    for (const p of drawn) {
      const text = describeFeature(p.feature);
      const w = g.measureText(text).width;
      g.fillStyle = 'rgba(12, 16, 26, .85)';
      g.fillRect(p.x + 10, p.y - 22, w + 10, 18);
      g.fillStyle = '#fff';
      g.fillText(text, p.x + 15, p.y - 20);
    }
  }

  return {
    get active() { return active; },
    get dragging() { return !!drag; },
    get picked() { return picked; },
    snapDelta, get guides() { return guides; }, clearGuides() { guides = []; },
    enter, leave, toggle: () => (active ? (leave(), false) : enter()), pointerDown, pointerMove, pointerUp, cancel, draw, applyDelta, snapshot, axisOf,
    /** Where a handle is on the screen (for tests and tools): `{x, y}` or null. */
    featureScreen(id) { const st = snapshot(); const p = st && projected(st).find((q) => q.id === id); return p && p.visible ? { x: p.x, y: p.y } : null; },
    feature(st, id) { return byId(st).get(id) ?? null; },
    select(id) { picked = id; },
  };
}
