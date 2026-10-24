// The "Blender" way of working for the scene editor (set `keymap: 'blender'` in the editor's config). Objects are edited with the keyboard and the mouse together:
// G, R and S start a grab, a rotation or a stretch that follows the mouse at once (see modal.js), Shift+D duplicates and grabs, X deletes, A selects, Shift+A adds,
// the number pad looks from the front, side and top, the middle mouse button orbits, and N and T show or hide the side panels. The page-less maths are in modal.js and
// shape-edit.js; this connects them to the editor's document, camera and keys. Nothing here changes what the classic keys do unless this is switched on.
import { quat } from '../../math/src/index.js';
import { Modal } from './modal.js';
import { createBoxMode } from './box-mode.js';
import { aabbOf, snapMove, snapPoints, pointsOf, snapAngle, snapStretch } from './snap.js';
import { PIVOTS, ORIENTATIONS, ALIGNS, NO_TURN, axesOf, cursorNote, readCursorNote, medianOf, pivotFor, offsetToCursor, cursorText } from './cursor.js';
import { shapeHandles, stretch, sizeOf } from './shape-edit.js';
import { decompose, worldToLocalAt, atPatch, eulerFromQuat, quatFromEuler } from './transform.js';
import { add, sub, scale as mul, normalize, dot, rayFromScreen, pick } from './picking.js';

const STEP = Math.PI / 12;                      // a number pad orbit step: 15 degrees
const VIEWS = { Numpad1: ['front', 'back'], Numpad3: ['right', 'left'], Numpad7: ['top', 'bottom'] };   // number pad key -> view, and with Ctrl
const KEYS = [
  ['G', 'Grab: move the selection with the mouse (then X Y Z to lock an axis, type a number, Enter or click to keep, Esc to cancel)'],
  ['R', 'Rotate with the mouse (about the view, or an axis with X Y Z; type degrees)'],
  ['S', 'Stretch the shape: S then Y makes it taller, S then X wider (type a factor). Several objects scale together'],
  ['X Y Z', 'while G, R or S runs: lock to that axis (again: its own axis, again: free). Shift+X Y Z: every axis but that one'],
  ['Shift', 'while G, R or S runs: fine control (a tenth as fast). Ctrl: snap to steps'],
  ['Tab', 'Shape edit for a box: a handle on every face and edge. Drag a face to move one side, an edge to move two. Click a handle, then G and a number. Tab or Esc to leave'],
  ['M', 'Snap to other objects on or off (moving or dragging a side: it lines up with their sides, middles and corners; turning one object: its sides line up with the world\'s or a neighbour\'s, within 6 degrees; stretching one box: its sides meet other boxes\' sides or it matches their size; hold Alt to skip it once)'],
  ['Shift + right click  (drag)', 'Put the 3D cursor there, and keep dragging to slide it over the scene (new blocks appear at it, and turning or stretching can use it as the centre)'],
  ['Shift+S', 'Snap menu: selection to cursor, cursor to selection (and its turn), cursor to the middle of the world, clear the cursor\'s turn'], ['Shift+N', 'Panel to type the 3D cursor\'s place and turn'], ['Shift+C', 'Cursor back to the middle, and show everything'],
  ['.', 'Pivot menu (also: whether new blocks turn like the 3D cursor): turn and stretch about the middle of the selection, the 3D cursor, or each object on its own; and whether X Y Z lock to the world\'s axes or the 3D cursor\'s'],
  ['Ctrl+F2', 'Rename the whole selection at once: names from a pattern (Crate {n}), or find and replace, with a preview'],
  ['F2  /  Shift+F2', 'Rename in place: the name people see (empty gives the id back) / the id itself'],
  ['Shift+D', 'Duplicate and grab'], ['X  or  Delete', 'Delete'], ['A  /  Alt+A  /  Ctrl+I', 'Select all / nothing / invert'],
  ['Shift+A', 'Add a block at the pointer'], ['Ctrl+Z  /  Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+C  /  Ctrl+V', 'Copy / paste'],
  ['Number pad 1  3  7', 'Front, right and top view, without perspective (Ctrl: back, left, bottom). Turning the view by hand goes back to perspective'],
  ['Number pad 5', 'Switch between perspective and orthographic'], ['Number pad 2 4 6 8', 'Orbit in steps (Ctrl: pan)'],
  ['.  or  Number pad .', 'Frame the selection'], ['Home', 'Frame everything'], ['Middle drag', 'Orbit (Shift: pan, Ctrl: zoom). Right drag also orbits'],
  ['N  /  T', 'Show or hide the inspector / the lists'], ['Shift+Tab', 'Snapping on or off'], ['F  /  P', 'Focus / play'], ['?', 'This list'],
];
const CSS = `
.modal-bar { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 6px 12px; border-radius: 8px; z-index: 6;
  background: rgba(14, 18, 28, .88); color: #fff; font: 600 13px system-ui, sans-serif; pointer-events: none; white-space: pre-wrap; text-align: center;
  border: 1px solid rgba(120, 160, 255, .5); }
.modal-bar small { display: block; font-weight: 400; opacity: .8; margin-top: 2px; }
.add-menu { position: absolute; z-index: 9; min-width: 150px; padding: 4px; border-radius: 8px; background: #1b2030; border: 1px solid #45507a; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
.add-menu .head { padding: 4px 8px; opacity: .7; font-size: 12px; }
.add-menu button { display: block; width: 100%; text-align: left; padding: 5px 10px; border: 0; border-radius: 5px; background: transparent; color: #eef; font: inherit; cursor: pointer; }
.add-menu button:hover, .add-menu button:focus { background: #3a4a8a; outline: none; }
.cursor-panel { position: absolute; left: 8px; bottom: 36px; z-index: 7; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 6px; padding: 8px 10px; border-radius: 8px; background: rgba(16, 20, 32, .94); border: 1px solid #45507a; color: #eef; font: 12px system-ui, sans-serif; }
.cursor-panel b { grid-column: 1 / -1; } .cursor-panel[hidden] { display: none; } .cursor-panel label { display: grid; gap: 2px; } .cursor-panel input { width: 100%; box-sizing: border-box; padding: 2px 4px; background: #0e1118; color: inherit; border: 1px solid #3a4468; border-radius: 4px; font: inherit; }
#keymap-help { position: absolute; z-index: 9; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: min(680px, calc(100% - 24px)); max-height: 80%; overflow: auto;
  padding: 12px 16px; border-radius: 10px; background: rgba(16, 20, 32, .96); border: 1px solid #45507a; color: #eef; font: 13px system-ui, sans-serif; }
#keymap-help table { border-collapse: collapse; } #keymap-help td { padding: 3px 10px 3px 0; vertical-align: top; } #keymap-help kbd { background: #2a3350; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
`;

const typing = (t) => !!t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName ?? ''));
const KEYNAME = (e) => (e.code?.startsWith('Digit') ? e.code.slice(5) : e.code?.startsWith('Numpad') && /^Numpad\d$/.test(e.code) ? e.code.slice(6) : e.key);

/**
 * Switch the editor to the Blender-style keys and mouse.
 * @param {any} editor the object `startEditor` makes
 * @returns {{begin: (kind: 'grab' | 'rotate' | 'scale') => boolean, active: () => Modal | null, dispose: () => void}}
 */
export function installBlender(editor) {
  const { doc, selection, view, orbit, camera, state, stage, library } = editor;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const bar = document.createElement('div');
  bar.className = 'modal-bar';
  bar.style.display = 'none';
  bar.setAttribute('role', 'status');
  stage.append(bar);
  let modal = null;
  let cursor = [0, 0, 0];
  let cursorRot = [...NO_TURN];
  let pivotMode = 'median';
  let orientation = 'global';
  let alignNew = 'world';
  let guides = [];
  let altDown = false;
  const box = createBoxMode(editor, { pointer: () => pointer, say: (t) => editor.say(t), changed: () => draw() });
  editor.overlayDraw.push((g) => box.draw(g));
  editor.overlayDraw.push((g) => drawGuides(g, [...guides, ...box.guides]));
  editor.overlayDraw.push((g) => drawCursor(g));
  let session = null;                 // what the transform started from, per object
  let applied = false;
  let seq = 0;
  let pointer = { x: 200, y: 200 };
  let menu = null;
  let help = null;
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const editing = () => !state.playing && !state.rmb;

  // ---- snapping to other objects ----
  /** How big a pixel is at a place in the world, so a snap can reach a fixed number of pixels. */
  editor.pixelSize = (point) => {
    const dist = camera.ortho > 0 ? orbit.distance : Math.max(0.5, Math.hypot(point[0] - camera.x, point[1] - camera.y, point[2] - camera.z));
    return (2 * Math.tan(camera.fovY / 2) * dist) / camera.viewH;
  };
  /** The world boxes of everything but these entities (and what is inside them), to line up with. */
  editor.snapTargets = (ids) => {
    const skip = new Set(ids);
    for (const id of doc.order) if (doc.ancestors(id).some((x) => skip.has(x))) skip.add(id);                 // what is inside them moves with them
    const boxes = view.items().filter((i) => !skip.has(i.id)).map((i) => ({ ...aabbOf(i.matrix, i.half), points: pointsOf(i), id: i.id }));
    boxes.push({ min: [...cursor], max: [...cursor], points: [[...cursor]] });                         // the 3D cursor is something to snap to
    return boxes;
  };
  /** The corners and middles of what is being moved (these snap to the corners and middles of other things). */
  editor.snapPoints = (ids) => {
    const moving = new Set(ids);
    for (const id of doc.order) if (doc.ancestors(id).some((x) => moving.has(x))) moving.add(id);
    return view.items().filter((i) => moving.has(i.id)).flatMap((i) => pointsOf(i));
  };
  const magnet = document.createElement('button');
  magnet.className = 'btn';
  magnet.textContent = 'Magnet';
  magnet.title = 'Snap to other objects while moving and dragging sides (M). Hold Alt to skip it once';
  magnet.addEventListener('click', () => toggleMagnet());
  editor.btns?.snap?.after(magnet);
  function toggleMagnet() {
    state.objectSnap = !state.objectSnap;
    magnet.classList.toggle('on', state.objectSnap);
    editor.say(state.objectSnap ? 'Snapping to other objects' : 'Not snapping to other objects');
  }
  magnet.classList.toggle('on', state.objectSnap);
  // ---- the 3D cursor and the pivot ----
  /** The cursor is kept in the scene file (not as an edit: it is not undone and does not make the scene changed). */
  function restoreCursor() {
    const c = readCursorNote(doc.editor.cursor);
    cursor = c.position;
    cursorRot = c.rotation;
    pivotMode = c.pivot;
    orientation = c.orientation;
    alignNew = c.align;
    syncPanel();
  }
  function remember() {
    doc.setEditor('cursor', cursorNote({ position: cursor, rotation: cursorRot, pivot: pivotMode, orientation, align: alignNew }));
    syncPanel();
  }
  function setCursor(point, say = true, rotation = null) {
    cursor = point.map((v) => Math.round(v * 1000) / 1000);
    if (rotation) cursorRot = rotation;
    remember();
    if (say) editor.say(`3D cursor at ${cursorText(cursor)}`);
  }
  /** Where a pointer on the viewport meets the scene: the nearest thing under it, else the ground, else null. */
  function surfaceAt(x, y) {
    const ray = rayFromScreen(camera, x, y);
    const hit = pick(ray, view.items());
    if (hit) return add(ray.origin, mul(ray.dir, hit.t));
    const ground = editor.groundAt(x, y);
    return ground && ground.every(Number.isFinite) ? ground : null;
  }
  function drawCursor(g) {
    const p = camera.worldToScreen(cursor[0], cursor[1], cursor[2]);
    if (!p.visible) return;
    g.save();
    g.lineCap = 'round';
    for (const [i, color] of ['#f0605a', '#6ad06a', '#5a8cf0'].entries()) {                // the cursor's own axes, short, so its turn can be seen
      const d = axesOf(cursorRot)[i];
      const q = camera.worldToScreen(cursor[0] + d[0], cursor[1] + d[1], cursor[2] + d[2]);
      if (!q.visible) continue;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1e-3) continue;
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x + ((q.x - p.x) / len) * 30, p.y + ((q.y - p.y) / len) * 30);
      g.stroke();
    }
    g.lineWidth = 2.5;
    for (const [color, offset] of [['#ffffff', 0], ['#e8423a', 4]]) {
      g.strokeStyle = color;
      g.setLineDash([4, 4]);
      g.lineDashOffset = offset;
      g.beginPath();
      g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3.5;
    g.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(p.x + dx * 12, p.y + dy * 12); g.lineTo(p.x + dx * 20, p.y + dy * 20); }
    g.stroke();
    g.strokeStyle = '#e8423a';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  }
  /** The orientations a turn can line up with: the world, the 3D cursor when it is turned, and the objects near the one being turned (not the thing itself or what is inside it). */
  function alignTargets(id) {
    const skip = new Set([id]);
    for (const other of doc.order) if (doc.ancestors(other).includes(id)) skip.add(other);
    const here = decompose(view.worldMatrix(id)).position;
    const targets = [{ q: [...NO_TURN], label: 'the world' }];
    if (cursorRot.some((v, i) => Math.abs(v - NO_TURN[i]) > 1e-9)) targets.push({ q: [...cursorRot], label: 'the 3D cursor' });
    const seen = new Set();
    for (const item of view.items()) {
      if (skip.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      const d = decompose(view.worldMatrix(item.id));
      if (Math.hypot(d.position[0] - here[0], d.position[1] - here[1], d.position[2] - here[2]) <= 8) targets.push({ q: d.rotation, label: doc.get(item.id)?.name || item.id });
    }
    return targets;
  }
  const originsOfSelection = () => selection.roots(doc).map((id) => decompose(view.worldMatrix(id)).position);
  /** Move the selected things (their roots) by a vector, as one step. */
  function moveSelection(vector, label) {
    const roots = selection.roots(doc);
    if (!roots.length || state.playing) return;
    doc.batch(label, () => {
      for (const id of roots) {
        const e = doc.get(id);
        const d = decompose(view.worldMatrix(id));
        const parentWorld = e.parent ? Float64Array.from(view.worldMatrix(e.parent)) : null;
        const at = worldToLocalAt(parentWorld, add(d.position, vector), d.rotation, d.scale, e.at ?? {});
        doc.update(id, atPatch(e.at ?? {}, at));
      }
    });
  }
  /** The directions X, Y and Z lock to: the world's, or the cursor's when the orientation says so. */
  const lockAxes = () => (orientation === 'cursor' ? axesOf(cursorRot) : null);
  // a small panel to type the cursor's place and turn exactly (Shift+N, or the Cursor button)
  const panel = document.createElement('div');
  panel.className = 'cursor-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '3D cursor');
  const fields = {};
  const field = (key, label, step) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step;
    input.setAttribute('aria-label', label);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => readPanel());
    fields[key] = input;
    const cell = document.createElement('label');
    cell.textContent = label;
    cell.append(input);
    return cell;
  };
  const title = document.createElement('b');
  title.textContent = '3D cursor';
  panel.append(title, field('x', 'X', '0.1'), field('y', 'Y', '0.1'), field('z', 'Z', '0.1'), field('rx', 'Turn X°', '5'), field('ry', 'Turn Y°', '5'), field('rz', 'Turn Z°', '5'));
  const alignBox = document.createElement('input');
  alignBox.type = 'checkbox';
  alignBox.setAttribute('aria-label', 'New blocks turn like the cursor');
  alignBox.addEventListener('change', () => editor.cursor.setAlign(alignBox.checked ? 'cursor' : 'world'));
  const alignLabel = document.createElement('label');
  alignLabel.style.gridColumn = '1 / -1';
  alignLabel.style.display = 'flex';
  alignLabel.style.gap = '6px';
  alignLabel.append(alignBox, 'New blocks turn like the cursor');
  panel.append(alignLabel);
  for (const [text, run] of [['To selected', () => editor.cursor.toSelected()], ['To origin', () => editor.cursor.toOrigin()], ['No turn', () => editor.cursor.resetTurn()]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = text;
    b.addEventListener('click', run);
    panel.append(b);
  }
  stage.append(panel);
  function syncPanel() {
    if (document.activeElement && panel.contains(document.activeElement)) return;
    const turn = eulerFromQuat(cursorRot);
    fields.x.value = round3(cursor[0]); fields.y.value = round3(cursor[1]); fields.z.value = round3(cursor[2]);
    alignBox.checked = alignNew === 'cursor';
    fields.rx.value = round3(turn[0]); fields.ry.value = round3(turn[1]); fields.rz.value = round3(turn[2]);
  }
  const round3 = (v) => String(Math.round(v * 1000) / 1000);
  function readPanel() {
    const n = (k) => (Number.isFinite(Number(fields[k].value)) ? Number(fields[k].value) : 0);
    setCursor([n('x'), n('y'), n('z')], false, quatFromEuler([n('rx'), n('ry'), n('rz')]));
  }
  const cursorButton = document.createElement('button');
  cursorButton.className = 'btn';
  cursorButton.textContent = 'Cursor';
  cursorButton.title = 'Show the 3D cursor panel: type its place and turn (Shift+N)';
  cursorButton.addEventListener('click', () => togglePanel());
  magnet.after(cursorButton);
  function togglePanel() {
    panel.hidden = !panel.hidden;
    cursorButton.classList.toggle('on', !panel.hidden);
    if (!panel.hidden) syncPanel();
  }
  editor.cursor = {
    get position() { return [...cursor]; },
    get rotation() { return [...cursorRot]; },
    set: (p, rotation) => setCursor(p, true, rotation ?? null),
    /** The cursor goes to the primary selection's origin (the middle of several), and takes the turn of the primary one. */
    toSelected() {
      const m = medianOf(originsOfSelection());
      if (!m) return false;
      setCursor(m, true, selection.primary ? decompose(view.worldMatrix(selection.primary)).rotation : null);
      return true;
    },
    selectionTo() { if (!selection.size) return false; moveSelection(offsetToCursor(originsOfSelection(), cursor), 'Selection to cursor'); editor.say('Moved to the 3D cursor'); return true; },
    toOrigin() { setCursor([0, 0, 0], true, [...NO_TURN]); },
    resetTurn() { cursorRot = [...NO_TURN]; remember(); editor.say('3D cursor turn cleared'); },
    get pivot() { return pivotMode; },
    setPivot(mode) { if (!PIVOTS.some((p) => p.id === mode)) return false; pivotMode = mode; remember(); editor.say(`Pivot: ${PIVOTS.find((p) => p.id === mode).label}`); return true; },
    get orientation() { return orientation; },
    setOrientation(mode) { if (!ORIENTATIONS.some((o) => o.id === mode)) return false; orientation = mode; remember(); editor.say(`X Y Z lock to: ${ORIENTATIONS.find((o) => o.id === mode).label}`); return true; },
    get align() { return alignNew; },
    setAlign(mode) { if (!ALIGNS.some((a) => a.id === mode)) return false; alignNew = mode; remember(); editor.say(ALIGNS.find((a) => a.id === mode).label); return true; },
    togglePanel,
  };
  const addPrefab = editor.addPrefab;
  editor.addPrefab = (name, point, rotation) => addPrefab(name, point ?? [...cursor], rotation ?? (alignNew === 'cursor' ? [...cursorRot] : undefined));     // new blocks appear at the 3D cursor, turned like it when asked
  cleanups.push(doc.onChange((e) => { if (e.kind === 'load') restoreCursor(); }));                        // another scene has its own cursor
  restoreCursor();

  function drawGuides(g, list) {
    if (!list.length) return;
    g.strokeStyle = '#ff4fd8';
    g.fillStyle = '#ff4fd8';
    g.lineWidth = 1.5;
    for (const l of list) {
      const a = camera.worldToScreen(l.from[0], l.from[1], l.from[2]);
      const b = camera.worldToScreen(l.to[0], l.to[1], l.to[2]);
      if (!a.visible || !b.visible) continue;
      if (!l.axis && l.axis !== 0) {                                                  // a corner: a ring where the two points meet
        g.beginPath();
        g.arc(a.x, a.y, 9, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(a.x, a.y, 3, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      for (const p of [a, b]) { g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fill(); }
    }
  }

  // ---- the transform ----
  function begin(kind, { feature = null } = {}) {
    const roots = selection.roots(doc);
    if (!roots.length || state.playing || modal) return false;
    const worlds = roots.map((id) => decompose(view.worldMatrix(id)));
    const median = worlds.reduce((m, d) => add(m, d.position), [0, 0, 0]).map((v) => v / roots.length);
    const pivot = pivotFor(pivotMode, median, cursor, median);
    const cam = [camera.x, camera.y, camera.z];
    const dist = camera.ortho > 0 ? orbit.distance : Math.max(0.5, Math.hypot(...sub(pivot, cam)));     // an orthographic view has the same scale at any depth
    const { right, up } = orbit.axes();
    const p = camera.worldToScreen(pivot[0], pivot[1], pivot[2]);
    const basis = roots.length === 1 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => quat.rotate([0, 0, 0], worlds[0].rotation, v)) : null;
    session = {
      pivot, roots, seq: ++seq,
      starts: roots.map((id, i) => {
        const e = doc.get(id);
        return {
          id, pos: worlds[i].position, rot: worlds[i].rotation, scale: worlds[i].scale, at: JSON.parse(JSON.stringify(e.at ?? {})),
          parentWorld: e.parent ? Float64Array.from(view.worldMatrix(e.parent)) : null, handles: shapeHandles(library, e),
        };
      }),
    };
    modal = new Modal({
      kind, start: pointer, pivotScreen: p.visible ? { x: p.x, y: p.y } : { x: camera.viewW / 2, y: camera.viewH / 2 },
      view: { right, up, forward: orbit.forward(), unitsPerPixel: (2 * Math.tan(camera.fovY / 2) * dist) / camera.viewH },
      local: basis, world: lockAxes(), snap: editor.gizmo.snap.move ? editor.gizmo.snap : { move: 0.5, rotate: 15, scale: 0.1 },
    });
    if (feature) {                                                             // moving one side of a box: along its own axis to begin with
      session.shape = box.snapshot();
      session.feature = feature;
      if (feature.kind === 'face') { modal.axis = ['x', 'y', 'z'][feature.axes[0]]; modal.local = true; }
    }
    const notes = [kind !== 'grab' && pivotMode !== 'median' ? PIVOTS.find((p) => p.id === pivotMode).short : '', orientation === 'cursor' ? ORIENTATIONS[1].short : ''].filter(Boolean);
    if (notes.length) modal.note = notes.join(', ');
    session.mode = pivotMode;
    if (kind === 'rotate' && roots.length === 1) session.align = alignTargets(roots[0]);
    if (kind === 'scale' && roots.length === 1) {
      const shape = box.snapshot();                                                              // a box: its sides can meet other boxes' sides
      if (shape) session.stretch = { shape, targets: editor.snapTargets(roots), self: view.bounds(roots) };
    }
    session.baseNote = modal.note ?? '';
    if (kind === 'grab' && !feature) { session.box = view.bounds(roots); session.targets = editor.snapTargets(roots); session.points = editor.snapPoints(roots); }
    applied = false;
    stage.focus({ preventScroll: true });
    draw();
    return true;
  }

  function apply() {
    const r = modal.result();
    if (session.feature) {                                                       // a side of a box: only the parts along its own axes count
      const delta = [0, 0, 0];
      for (const a of session.feature.axes) delta[a] = dot(r.vector, session.shape.axes[a]);
      const typed = modal.number !== null;
      box.applyDelta(session.shape, session.feature, typed ? delta : box.snapDelta(session.shape, session.feature, delta, altDown), `modal:${session.seq}`);
      applied = true;
      draw();
      return;
    }
    guides = [];
    modal.note = session.baseNote;
    modal.snappedAngle = null;
    modal.snappedFactors = null;
    if (modal.kind === 'scale' && session.stretch && state.objectSnap && !altDown && modal.number === null && !modal.ctrl) {
      const { shape, targets, self } = session.stretch;
      const affected = [0, 1, 2].filter((i) => r.factors[i] !== 1);
      const axes = affected.map((i) => {
        const k = [0, 1, 2].find((j) => Math.abs(shape.axes[i][j]) > 0.999);
        return { half: shape.half[i] * shape.scale, centre: k === undefined ? 0 : shape.pos[k], k: k === undefined ? null : k };
      });
      const hit = affected.length ? snapStretch(r.factors[affected[0]], axes, targets, self, { threshold: 10 * modal.view.unitsPerPixel }) : null;
      if (hit) {                                                                                   // a side of the box now meets another box, or it is as big as one
        for (const i of affected) r.factors[i] = hit.factor;
        modal.snappedFactors = [...r.factors];
        const o = [...shape.pos];
        o[hit.k] = hit.value ?? o[hit.k];
        if (hit.kind === 'side') {
          const across = hit.k === 0 ? 2 : 0;
          const to = hit.target ? [0, 1, 2].map((i) => (hit.target.min[i] + hit.target.max[i]) / 2) : [...o];
          to[hit.k] = hit.value;
          if (!hit.target) { to[across] += 1.5; o[across] -= 1.5; }
          guides = [{ axis: hit.k, from: o, to }];
        }
        modal.note = [session.baseNote, hit.kind === 'size' ? `same size as ${hit.target.id}` : hit.target ? `side meets ${hit.target.id}` : 'side on the ground'].filter(Boolean).join(', ');
      }
    }
    if (modal.kind === 'rotate' && session.align && state.objectSnap && !altDown && modal.number === null && !modal.ctrl) {
      const hit = snapAngle(normalize(r.axis), session.starts[0].rot, r.angle, session.align.map((t) => t.q), { threshold: (6 * Math.PI) / 180 });
      if (hit) {                                                                                  // a side of the thing now runs parallel to a side of something else
        r.angle = hit.angle;
        modal.snappedAngle = hit.angle;                                                              // the header shows the angle it really turned
        const o = session.starts[0].pos;
        guides = [{ axis: 3, from: add(o, mul(hit.from, -1.8)), to: add(o, mul(hit.from, 1.8)) }];
        modal.note = [session.baseNote, `lined up with ${session.align[hit.target].label}`].filter(Boolean).join(', ');
      }
    }
    if (modal.kind === 'grab' && session.box && state.objectSnap && !altDown && modal.number === null && !(modal.axis && (modal.local || modal.turnedWorld))) {
      const only = modal.axis && !modal.plane ? ['x', 'y', 'z'].map((a) => a === modal.axis) : modal.axis ? ['x', 'y', 'z'].map((a) => a !== modal.axis) : [true, true, true];
      const threshold = 10 * modal.view.unitsPerPixel;
      const corner = modal.axis ? null : snapPoints(session.points, r.vector, session.targets, { threshold: 1.4 * threshold });     // a free move can land a corner on a corner
      if (corner) { r.vector = corner.vector; guides = [corner.guide]; } else {
        const snapped = snapMove(session.box, r.vector, session.targets, { threshold, axes: only });
        r.vector = snapped.vector;
        guides = snapped.guides;
      }
    }
    doc.batch(modal.name, () => {
      for (const s of session.starts) {
        let pos = s.pos;
        let rot = s.rot;
        let scale = s.scale;
        if (modal.kind === 'grab') pos = add(s.pos, r.vector);
        else if (modal.kind === 'rotate') {
          const dq = quat.fromAxisAngle([0, 0, 0, 1], normalize(r.axis), r.angle);
          const centre = session.mode === 'individual' ? s.pos : session.pivot;
          pos = add(centre, quat.rotate([0, 0, 0], dq, sub(s.pos, centre)));
          rot = quat.multiply([0, 0, 0, 1], dq, s.rot);
        } else {
          const uniform = r.factors[0] === r.factors[1] && r.factors[1] === r.factors[2];
          if (session.mode !== 'individual' && uniform && (session.starts.length > 1 || session.mode === 'cursor')) pos = add(session.pivot, mul(sub(s.pos, session.pivot), r.factors[0]));
          const patch = s.handles ? stretch(s.handles, r.factors) : null;
          if (patch) { if (Object.keys(patch).length) doc.update(s.id, { params: patch }); } else scale = s.scale * (r.factors[0] * r.factors[1] * r.factors[2]) ** (1 / 3);
        }
        const at = worldToLocalAt(s.parentWorld, pos, rot, scale, s.at);
        doc.update(s.id, atPatch(s.at, at));
      }
    }, { merge: `modal:${session.seq}` });
    applied = true;
    draw();
  }

  function draw() {
    if (!modal) {
      bar.style.display = box.active ? '' : 'none';
      if (box.active) bar.textContent = 'Shape edit — drag a face (one side) or an edge (two sides) · click a handle, then G and a number · Tab to leave';
      return;
    }
    let size = '';
    if (selection.size === 1) {
      const dims = sizeOf(library, doc.get(selection.primary));
      if (dims) size = `size ${dims.map((v) => Math.round(v * 1000) / 1000).join(' × ')}`;
    }
    bar.style.display = '';
    bar.textContent = modal.header();
    if (size) { const small = document.createElement('small'); small.textContent = size; bar.append(small); }
  }

  function finish(how) {
    if (!modal) return;
    if (how === 'cancel' && applied) doc.undo();
    modal = null;
    session = null;
    guides = [];
    box.clearGuides();
    draw();
    editor.say(how === 'cancel' ? 'Cancelled' : 'Done');
  }

  // ---- keys ----
  const orbitTo = (yaw, pitch) => { orbit.ortho &&= !orbit.autoOrtho; orbit.autoOrtho = false; orbit.yaw = yaw; orbit.pitch = pitch; };
  function onKey(e) {
    altDown = e.altKey;
    if (typing(e.target) || e.target.closest?.('.batch-dialog')) return;
    if (box.dragging && e.key === 'Escape') { box.cancel(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (modal) {                                                       // while a transform runs, the keys are its keys
      if (e.repeat && !/^(Backspace|Digit|Numpad)/.test(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.key === 'Shift' || e.key === 'Control') { modal.ctrl = e.ctrlKey; return; }
      const handled = modal.key(KEYNAME(e).toLowerCase() === 'delete' ? 'backspace' : KEYNAME(e), { shift: e.shiftKey, ctrl: e.ctrlKey });
      if (handled || ['Tab'].includes(e.key)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (modal.finished) finish(modal.finished); else { apply(); }
      } else if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (state.playing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const done = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const nav = !state.rmb;
    // the number pad views
    if (nav && VIEWS[e.code]) { editor.setView(VIEWS[e.code][ctrl ? 1 : 0]); return done(); }
    if (nav && e.code === 'Numpad5') { editor.toggleOrtho(); return done(); }
    if (nav && /^Numpad[2468]$/.test(e.code)) {
      if (ctrl) { const k = { Numpad4: [-40, 0], Numpad6: [40, 0], Numpad8: [0, -40], Numpad2: [0, 40] }[e.code]; orbit.pan(k[0], k[1], camera.fovY, camera.viewH); }
      else orbitTo(orbit.yaw + ({ Numpad4: -STEP, Numpad6: STEP }[e.code] ?? 0), Math.max(-1.5, Math.min(1.5, orbit.pitch + ({ Numpad8: STEP, Numpad2: -STEP }[e.code] ?? 0))));
      return done();
    }
    if (nav && e.code === 'NumpadDecimal') { editor.focus(); return done(); }
    if (nav && e.key === '.' && !ctrl && editing()) {
      openChoice('Pivot, X Y Z and new blocks', [
        ...PIVOTS.map((p) => ({ label: `${p.id === pivotMode ? '• ' : ''}${p.label}`, run: () => editor.cursor.setPivot(p.id) })),
        ...ORIENTATIONS.map((o) => ({ label: `${o.id === orientation ? '• ' : ''}${o.label}`, run: () => editor.cursor.setOrientation(o.id) })),
        ...ALIGNS.map((a) => ({ label: `${a.id === alignNew ? '• ' : ''}${a.label}`, run: () => editor.cursor.setAlign(a.id) })),
      ]);
      return done();
    }
    if (nav && e.code === 'Home') { editor.focus(doc.order); return done(); }
    if (e.key === '?' || e.key === 'F1') { toggleHelp(); return done(); }
    if (!editing()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Tab' && !ctrl && !e.altKey && !e.shiftKey) { box.toggle(); return done(); }
    if (k === 'Escape' && box.active) { box.leave(); return done(); }
    if (k === 'g' && box.active && box.picked && !ctrl && !e.altKey) {
      const st = box.snapshot();
      const feature = st && box.feature(st, box.picked);
      if (feature && begin('grab', { feature })) return done();
    }
    if (!ctrl && !e.altKey) {
      if ((k === 'g' || k === 'r' || k === 's') && !e.shiftKey) { if (begin(k === 'g' ? 'grab' : k === 'r' ? 'rotate' : 'scale')) done(); return; }
      if (k === 'd' && e.shiftKey) { if (selection.size) { editor.duplicateSelection(); begin('grab'); } return done(); }
      if (k === 'x') { editor.deleteSelection(); return done(); }
      if (k === 'a' && e.shiftKey) { openMenu(); return done(); }
      if (k === 's' && e.shiftKey) {
        openChoice('Snap', [
          { label: 'Selection to cursor', run: () => editor.cursor.selectionTo() }, { label: 'Cursor to selected', run: () => editor.cursor.toSelected() },
          { label: 'Cursor to the middle of the world', run: () => editor.cursor.toOrigin() }, { label: 'Clear the cursor\'s turn', run: () => editor.cursor.resetTurn() },
        ]);
        return done();
      }
      if (k === 'n' && e.shiftKey) { editor.cursor.togglePanel(); return done(); }
      if (k === 'c' && e.shiftKey) { editor.cursor.toOrigin(); editor.focus(doc.order); return done(); }
      if (k === 'm') { toggleMagnet(); return done(); }
      if (k === 'a') { editor.selectAll(); return done(); }
      if (k === 'n') { toggle('.right'); return done(); }
      if (k === 't') { toggle('.left'); return done(); }
      if (k === 'Tab' && e.shiftKey) { editor.setSnap(!state.snapOn); return done(); }
    }
    if (e.altKey && !ctrl && k === 'a') { selection.clear(); return done(); }
    if (ctrl && !e.altKey && k === 'i') { const now = new Set(selection.ids); selection.set(doc.order.filter((id) => !now.has(id))); return done(); }
  }
  const hidden = { '.left': false, '.right': false };
  function toggle(selector) {
    const root = stage.parentElement;
    const el = root?.querySelector(selector);
    if (!el) return;
    hidden[selector] = !hidden[selector];
    el.style.display = hidden[selector] ? 'none' : '';
    root.style.gridTemplateColumns = `${hidden['.left'] ? '0px' : '250px'} 1fr ${hidden['.right'] ? '0px' : '310px'}`;
  }
  on(window, 'keydown', onKey, true);
  on(window, 'keyup', (e) => { altDown = e.altKey; if (modal && (e.key === 'Shift' || e.key === 'Control')) { modal.ctrl = e.ctrlKey; apply(); } }, true);

  // ---- the mouse ----
  on(stage, 'pointermove', (e) => { pointer = local(e); }, true);
  on(window, 'pointermove', (e) => {
    altDown = e.altKey;
    pointer = local(e);                                    // wherever the mouse is, so a transform starts from where it really was
    if (cursorClick) { const spot = surfaceAt(pointer.x, pointer.y); if (spot) setCursor(spot, false); return; }
    if (!modal) { box.pointerMove(e, pointer); return; }
    modal.pointer(pointer.x, pointer.y, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    apply();
  }, true);
  let cursorClick = null;
  let nav = null;                                          // a middle-button drag: orbit, or pan with Shift, or zoom with Ctrl
  on(stage, 'pointerdown', (e) => {
    if (modal) {                                           // a click keeps it, a right click puts everything back
      e.preventDefault(); e.stopImmediatePropagation();
      finish(e.button === 2 ? 'cancel' : 'confirm');
      return;
    }
    if (menu && !menu.contains(e.target)) closeMenu();
    if (e.button === 2 && e.shiftKey && !state.playing) {                    // Shift + right click: the 3D cursor goes where the pointer is
      e.preventDefault(); e.stopImmediatePropagation();
      stage.setPointerCapture(e.pointerId);
      cursorClick = local(e);
      const spot = surfaceAt(cursorClick.x, cursorClick.y);
      if (spot) setCursor(spot, false);                                       // it goes down at once and follows the pointer while it is dragged
      return;
    }
    if (box.pointerDown(e, local(e))) { e.preventDefault(); e.stopImmediatePropagation(); stage.setPointerCapture(e.pointerId); return; }
    if (e.button === 1 && !state.playing) {
      e.preventDefault(); e.stopImmediatePropagation();
      stage.setPointerCapture(e.pointerId);
      nav = { x: e.clientX, y: e.clientY };
    }
  }, true);
  on(stage, 'pointermove', (e) => {
    if (!nav) return;
    const dx = e.clientX - nav.x;
    const dy = e.clientY - nav.y;
    nav = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) orbit.pan(dx, dy, camera.fovY, stage.clientHeight);
    else if (e.ctrlKey || e.metaKey) orbit.zoom(-dy);
    else orbit.orbit(dx, dy);
  }, true);
  on(stage, 'pointerup', () => { nav = null; }, true);
  on(window, 'pointerup', (e) => {
    box.pointerUp();
    if (!cursorClick) return;
    cursorClick = null;
    editor.say(`3D cursor at ${cursorText(cursor)}`);
  }, true);
  cleanups.push(selection.onChange(() => { if (box.active && !box.snapshot()) box.leave(); }));
  on(stage, 'contextmenu', (e) => { if (modal) e.preventDefault(); }, true);

  // ---- the add menu (Shift+A) and the list of keys (?) ----
  function closeMenu() { menu?.remove(); menu = null; }
  /** A small menu at the pointer: a title and some choices, each a label and what to do. Esc closes it; the arrow keys move through it. */
  function openChoice(title, entries) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'add-menu';
    menu.setAttribute('role', 'menu');
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = title;
    menu.append(head);
    for (const entry of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = entry.label;
      b.addEventListener('click', () => { closeMenu(); entry.run(); stage.focus(); });
      menu.append(b);
    }
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); stage.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...menu.querySelectorAll('button')];
        const at = items.indexOf(document.activeElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      }
    });
    const left = Math.max(4, Math.min(pointer.x, stage.clientWidth - 190));
    const top = Math.max(4, Math.min(pointer.y, stage.clientHeight - 30 - entries.length * 28));
    Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
    stage.append(menu);
    menu.querySelector('button')?.focus();
  }
  /** Shift+A: add a block at the 3D cursor. */
  function openMenu() {
    const names = library.names.filter((n) => !editor.hidePrefabs.includes(n));
    openChoice('Add (at the 3D cursor)', names.map((name) => ({ label: name, run: () => editor.addPrefab(name) })));
  }
  function toggleHelp() {
    if (help) { help.remove(); help = null; return; }
    help = document.createElement('div');
    help.id = 'keymap-help';
    help.setAttribute('role', 'dialog');
    help.setAttribute('aria-label', 'Keys');
    help.addEventListener('click', toggleHelp);
    const title = document.createElement('b');
    title.textContent = 'Keys (Blender style). Click or press ? to close.';
    const table = document.createElement('table');
    for (const [keys, what] of KEYS) {
      const row = table.insertRow();
      const a = row.insertCell();
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      a.append(kbd);
      row.insertCell().textContent = what;
    }
    help.append(title, table);
    stage.append(help);
  }

  const api = {
    begin, active: () => modal, keys: KEYS, box,
    /** Type into a running transform (for tests and tools): the same as pressing the key. */
    press(code, mods = {}) { if (!modal) return false; const ok = modal.key(code, mods); if (modal.finished) finish(modal.finished); else apply(); return ok; },
    pointerTo(x, y, mods = {}) { if (!modal) return; pointer = { x, y }; modal.pointer(x, y, mods); apply(); },
    dispose() { for (const c of cleanups) c(); style.remove(); bar.remove(); closeMenu(); help?.remove(); },
  };
  editor.blender = api;
  return api;
}
