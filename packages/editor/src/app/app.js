// The scene editor: a viewport with gizmos, the hierarchy, the inspector, undo, save, and play-in-editor, assembled from the core modules.
//
//   const editor = await startEditor({ library, scenes: new HttpSceneStore('/__scenes'), scene: 'yard', createRuntime });
//
// A game describes itself with a config object (see packages/editor/README.md): its prefab `library`, a scene `store`, optionally how to
// draw scenery, how to preview its prefabs (`describe`), and how to run a scene (`createRuntime`) for the Play button.
import { mat4, quat } from '../../../math/src/index.js';
import { SceneDocument, emptyScene, validateScene } from '../../../scene/src/index.js';
import { createRenderer3D, Camera3D, DrawList3D, createLighting, createBox, createSphere, createCapsule } from '../../../render/src/index.js';
import { Selection } from '../selection.js';
import { SceneView } from '../visuals.js';
import { Gizmo } from '../gizmo.js';
import { OrbitController } from '../orbit.js';
import { installBlender } from '../blender.js';
import { openBatchRename } from './batch-rename-dialog.js';
import { createWedge } from '../wedge.js';
import { Shortcuts } from '../shortcuts.js';
import { copyText, pasteText } from '../clipboard.js';
import { rayFromScreen, pick, inRect, rayPlane, sub, add, scale as mul } from '../picking.js';
import { decompose, worldToLocalAt, atPatch } from '../transform.js';
import { h, CSS } from './dom.js';
import { createHierarchy, createInspector, createPalette } from './panels.js';

const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
const GIZMO_COLORS = { x: '#f0605a', y: '#5ee07a', z: '#5a8cf0', xy: '#b0b050', xz: '#b050b0', yz: '#50b0b0', u: '#e0e0e0' };
const HOT = '#ffe14d';

/**
 * @typedef {object} EditorConfig
 * @property {import('../../../prefab/src/library.js').PrefabLibrary} library The game's prefabs.
 * @property {{list(): Promise<any[]>, load(name: string): Promise<any>, save(name: string, scene: any): Promise<void>}} scenes Where scenes live.
 * @property {string} [scene] The scene to open first (default: the first one, or a new empty scene).
 * @property {string} [title]
 * @property {(spec: any) => any} [describe] How a prefab part looks in the editor (see `defaultDescribe`).
 * @property {(list: DrawList3D, meshes: any) => void} [scenery] Draw the parts of the level that are not entities (ground, walls).
 * @property {'classic' | 'blender'} [keymap] `blender`: G, R and S start a grab, rotation or stretch that follows the mouse (X Y Z lock an axis, numbers are exact), Shift+D duplicates, the number pad changes the view; see `blender.js`.
 * @property {(scene: any, ctx: {library: any}) => {step(dt: number): void, draw(list: DrawList3D, meshes: any): void, camera?(camera: Camera3D): void, dispose?(): void}} [createRuntime]
 *   Run a scene for Play. A runtime with a `camera(camera)` function takes over the view while it plays (a walk-around game): it moves the camera each frame, and the
 *   editor's own mouse and key handling stays out of the way except Esc and P.
 * @property {string[]} [hidePrefabs] Prefabs to leave out of the palette (abstract bases).
 * @property {'webgpu' | 'webgl2'} [renderer]
 * @property {HTMLElement} [mount]
 */

/** @param {EditorConfig} config */
export async function startEditor(config) {
  const mount = config.mount ?? document.body;
  const style = h('style', {}, CSS); document.head.append(style);
  const library = config.library;
  const doc = new SceneDocument(emptyScene('Untitled'), { library });
  const selection = new Selection(); selection.follow(doc);
  const view = new SceneView(doc, { library, describe: config.describe });
  const gizmo = new Gizmo({ mode: 'translate' });
  const orbit = new OrbitController({ target: [0, 1, 0], distance: 24 });
  const camera = new Camera3D({ fovY: 1, near: 0.1, far: 2000 });
  const shortcuts = new Shortcuts();

  // ---- the page ----
  const root = h('div', { id: 'ed' });
  const bar = h('div', { class: 'bar' });
  const hierBox = h('div', { id: 'hier' }), paletteBox = h('div', { id: 'palette' });
  const left = h('div', { class: 'left' }, h('div', { class: 'pane-title' }, 'Hierarchy'), hierBox, h('div', { class: 'pane-title' }, 'Prefabs (click or drag into the scene)'), paletteBox);
  const stage = h('div', { id: 'stage', tabIndex: 0 });
  const right = h('div', { class: 'right' });
  const status = h('div', { class: 'status' });
  root.append(bar, left, stage, right, status);
  mount.append(root);

  const renderer = await createRenderer3D({ prefer: config.renderer ? [config.renderer] : undefined, antialias: true });
  stage.append(renderer.canvas);
  const overlay = h('canvas', { id: 'overlay' });
  stage.append(overlay);
  const g2 = overlay.getContext('2d');
  const hud = h('div', { class: 'hud' }); stage.append(hud);
  const banner = h('div', { class: 'banner', style: { display: 'none' } }, 'PLAYING — Esc or Stop to return to editing'); stage.append(banner);
  const marquee = h('div', { class: 'marquee', style: { display: 'none' } }); stage.append(marquee);

  // ---- meshes ----
  const unitBox = createBox(1, 1, 1), unitSphere = createSphere(0.5, 20, 12);
  const capsules = new Map();
  const capsuleMesh = (r, hh) => { const k = `${r}|${hh}`; if (!capsules.has(k)) capsules.set(k, createCapsule(r, 2 * hh + 2 * r, 16, 6)); return capsules.get(k); };
  const unitWedge = createWedge();
  const meshes = { unitBox, unitSphere, capsuleMesh, unitWedge };
  const list = new DrawList3D();
  const light = { ...createLighting(), direction: [0.4, 1, 0.3], fogDensity: 0 };

  const state = { objectSnap: true, tool: 'translate', sceneName: null, playing: false, runtime: null, dragSeq: 0, drag: null, mode: null, rmb: false, snapOn: false, problems: [], showProblems: false };
  let message = { text: '', kind: '', until: 0 };

  // ---- the editor object ----
  const editor = {
    doc, selection, view, gizmo, orbit, camera, library, config, state, renderer, stage, shortcuts, bar, btns: null, hidePrefabs: config.hidePrefabs ?? [],
    say(text, kind = '') { message = { text, kind, until: performance.now() + 4000 }; renderStatus(); },
    undo() { if (state.playing) return; doc.undo(); }, redo() { if (state.playing) return; doc.redo(); },
    setTool(tool) { state.tool = tool; gizmo.mode = tool === 'select' ? 'translate' : tool; renderBar(); },
    setSpace(space) { gizmo.space = space; renderBar(); },
    setSnap(on) { state.snapOn = on; gizmo.snap = on ? { move: 0.5, rotate: 15, scale: 0.1 } : { move: 0, rotate: 0, scale: 0 }; renderBar(); },
    /** Look from the front, back, right, left, top or bottom (an orthographic view), or from 'perspective' (the usual view, turned a little). */
    setView(name) {
      if (name === 'perspective') { orbit.ortho = false; orbit.autoOrtho = false; if (orbit.viewName) { orbit.yaw = 0.6; orbit.pitch = 0.45; } }
      else if (!orbit.setView(name)) return false;
      renderBar();
      return true;
    },
    toggleOrtho() { orbit.toggleOrtho(); renderBar(); return orbit.ortho; },
    focus(ids) {
      const b = view.bounds(ids && ids.length ? ids : selection.size ? selection.ids : doc.order);
      if (b) orbit.focus(b.min, b.max, camera.fovY, camera.aspect);
    },
    /** Pixel position (in the viewport) of an entity's origin, for tests and tools. */
    screenOf(id) { const m = view.worldMatrix(id); const p = camera.worldToScreen(m[12], m[13], m[14]); return p.visible ? { x: p.x, y: p.y } : null; },
    /** Where on the ground (y = 0) a viewport pixel points, or null. */
    groundAt(x, y) { const ray = rayFromScreen(camera, x, y); const p = rayPlane(ray.origin, ray.dir, [0, 0, 0], [0, 1, 0]); return p ? p.point : null; },

    /**
     * Add a block of a prefab: at a point (the middle of the view by default; its height is where it stands) and, when given, turned (a quaternion).
     * @param {string} name @param {number[]} [point] @param {number[]} [rotation]
     */
    addPrefab(name, point, rotation) {
      if (state.playing) return null;
      const rect = stage.getBoundingClientRect();
      const at = point ?? editor.groundAt(rect.width / 2, rect.height / 2);
      const ground = at && at.every(Number.isFinite) ? at : [orbit.target[0], 0, orbit.target[2]];   // not before the first frame, not off the horizon
      const floorY = ground[1];                                                                         // 0 on the ground, higher when the 3D cursor sits on something
      const s = state.snapOn ? gizmo.snap.move : 0;
      const sn = (v) => (s > 0 ? Math.round(v / s) * s : round(v, 3));
      let id;
      doc.batch(`Add ${name}`, () => {
        const at = { x: sn(ground[0]), y: round(floorY, 3), z: sn(ground[2]) };
        if (rotation && rotation.some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 1e-9)) {
          const aboutUp = Math.abs(rotation[0]) < 1e-9 && Math.abs(rotation[2]) < 1e-9;                  // a turn about the upright axis is a yaw
          if (aboutUp) at.yaw = round(2 * Math.atan2(rotation[1], rotation[3]), 6); else at.rotation = rotation.map((v) => round(v, 6));
        }
        id = doc.add({ prefab: name, at });
        const b = view.bounds([id]);
        if (b && b.min[1] < floorY) doc.update(id, { at: { y: round(2 * floorY - b.min[1], 3) } }); // rests on the ground (or on the cursor's height)
      });
      selection.set(id);
      return id;
    },
    deleteSelection() {
      if (state.playing || !selection.size) return;
      const roots = selection.roots(doc);
      doc.batch(roots.length === 1 ? `Delete ${roots[0]}` : `Delete ${roots.length} entities`, () => roots.forEach((id) => doc.remove(id)));
    },
    duplicateSelection() {
      if (state.playing || !selection.size) return;
      const copies = [];
      doc.batch('Duplicate', () => selection.roots(doc).forEach((id) => copies.push(doc.duplicate(id, { offset: { x: 1, y: 0, z: 1 } }))));
      selection.set(copies);
    },
    /** Functions called with the overlay's 2D context every frame, to draw handles and the like. */
    overlayDraw: [],
    clipboard: '',
    copy() { if (!selection.size) return; editor.clipboard = copyText(doc, selection.roots(doc)); navigator.clipboard?.writeText?.(editor.clipboard).catch(() => {}); editor.say(`Copied ${selection.roots(doc).length}`); },
    paste() { if (state.playing || !editor.clipboard) return; const ids = pasteText(doc, editor.clipboard); if (ids.length) selection.set(ids); },
    selectAll() { selection.set(doc.order); },

    async save() {
      if (!state.sceneName) { const name = (typeof prompt === 'function' ? prompt('Name for this scene (letters, digits, - and _):', doc.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')) : null); if (!name) return false; state.sceneName = name; }
      const errors = doc.validate().filter((p) => p.severity === 'error');
      try {
        await config.scenes.save(state.sceneName, doc.toJSON());
        doc.markSaved(); renderBar(); renderStatus();
        editor.say(`Saved "${state.sceneName}"${errors.length ? ` (with ${errors.length} problem${errors.length === 1 ? '' : 's'})` : ''}`, errors.length ? 'warn' : 'good');
        refreshSceneList();
        return true;
      } catch (e) { editor.say(`Could not save: ${e.message}`, 'bad'); return false; }
    },
    async open(name) {
      try {
        const json = await config.scenes.load(name);
        doc.load(json); state.sceneName = name; selection.clear(); editor.focus(doc.order);
        editor.say(`Opened "${name}"`); renderBar();
      } catch (e) { editor.say(`Could not open "${name}": ${e.message}`, 'bad'); }
    },
    newScene(name = 'Untitled') { doc.load(emptyScene(name)); state.sceneName = null; selection.clear(); renderBar(); },

    play() {
      if (state.playing) return;
      if (!config.createRuntime) { editor.say('This game has not set up a Play mode', 'warn'); return; }
      const errors = validateScene(doc.toJSON(), { library }).filter((p) => p.severity === 'error');
      if (errors.length) { editor.say(`Cannot play: ${errors[0].path}: ${errors[0].message}`, 'bad'); return; }
      try { state.runtime = config.createRuntime(doc.toJSON(), { library }); } catch (e) { editor.say(`Could not start: ${e.message}`, 'bad'); return; }
      state.playing = true; state.acc = 0; banner.style.display = ''; renderBar(); renderStatus();
    },
    stop() {
      if (!state.playing) return;
      try { state.runtime?.dispose?.(); } catch (e) { console.error(e); }
      state.runtime = null; state.playing = false; banner.style.display = 'none'; renderBar(); renderStatus();
    },
    togglePlay() { if (state.playing) editor.stop(); else editor.play(); },
  };

  // ---- panels ----
  const hierarchy = createHierarchy(editor, hierBox);
  /** Rename the primary selection in place (F2): its name, or with `what` = 'id' its id. */
  editor.rename = (id = selection.primary, what = 'name') => !!id && hierarchy.rename(id, what);
  /** Rename the whole selection at once (Ctrl+F2): names from a pattern, or find and replace, with a preview. */
  editor.renameMany = () => openBatchRename(editor);
  const inspector = createInspector(editor, right);
  createPalette(editor, paletteBox);

  let refreshQueued = false;
  const queueRefresh = () => { if (refreshQueued) return; refreshQueued = true; queueMicrotask(() => { refreshQueued = false; hierarchy.refresh(); inspector.refresh(); recomputeProblems(); renderBar(); renderStatus(); }); };
  doc.onChange(queueRefresh); selection.onChange(() => { editor.revealPrimary = true; queueRefresh(); });

  // ---- toolbar and status ----
  const sceneSelect = h('select', { class: 'btn', title: 'Open a scene', onchange: async () => {
    if (!sceneSelect.value) return;
    if (doc.dirty && typeof confirm === 'function' && !confirm('Discard unsaved changes?')) { sceneSelect.value = state.sceneName ?? ''; return; }
    await editor.open(sceneSelect.value);
  } });
  async function refreshSceneList() {
    try {
      const names = (await config.scenes.list()).map((s) => s.name);
      sceneSelect.textContent = '';
      sceneSelect.append(h('option', { value: '' }, state.sceneName ? '— scenes —' : '(unsaved scene)'));
      for (const n of names) sceneSelect.append(h('option', { value: n, selected: n === state.sceneName }, n));
    } catch (e) { editor.say(`Could not list scenes: ${e.message}`, 'bad'); }
  }
  const btns = {};
  editor.btns = btns;
  const viewSelect = h('select', { class: 'btn', title: 'View: perspective, or a front, side or top view without perspective (number pad 1, 3, 7; 5 switches)', 'aria-label': 'View',
    onchange: () => { editor.setView(viewSelect.value); stage.focus({ preventScroll: true }); } },
    ...[['perspective', 'Perspective'], ['front', 'Front'], ['back', 'Back'], ['right', 'Right'], ['left', 'Left'], ['top', 'Top'], ['bottom', 'Bottom']]
      .map(([value, label]) => h('option', { value }, label)));
  const mk = (id, label, title, onclick, cls = '') => (btns[id] = h('button', { class: `btn ${cls}`, title, onclick }, label));
  bar.append(
    h('span', { class: 'title' }, config.title ?? 'Scene editor'), sceneSelect,
    mk('new', 'New', 'New empty scene', () => { if (!doc.dirty || confirm('Discard unsaved changes?')) { editor.newScene(prompt('Name of the new scene:', 'Untitled') || 'Untitled'); refreshSceneList(); } }),
    mk('save', 'Save', 'Save the scene (Ctrl+S)', () => editor.save()),
    h('span', { class: 'sep' }),
    mk('undo', 'Undo', 'Ctrl+Z', () => editor.undo()), mk('redo', 'Redo', 'Ctrl+Y', () => editor.redo()),
    h('span', { class: 'sep' }),
    mk('select', 'Select', 'Q', () => editor.setTool('select')), mk('translate', 'Move', 'W', () => editor.setTool('translate')), mk('rotate', 'Rotate', 'E', () => editor.setTool('rotate')), mk('scale', 'Scale', 'R', () => editor.setTool('scale')),
    h('span', { class: 'sep' }),
    mk('space', 'World', 'Handles follow the world or the object (X)', () => editor.setSpace(gizmo.space === 'world' ? 'local' : 'world')),
    mk('snap', 'Snap', 'Snap to 0.5 m / 15° / 0.1 (G)', () => editor.setSnap(!state.snapOn)),
    mk('focus', 'Focus', 'Frame the selection (F)', () => editor.focus()),
    viewSelect,
    h('span', { class: 'sep' }),
    mk('play', '▶ Play', 'Run the scene (P)', () => editor.togglePlay(), 'play'),
    mk('help', '?', 'Keys', () => toggleHelp()),
  );
  function renderBar() {
    const edit = !state.playing;
    btns.undo.disabled = !doc.canUndo || !edit; btns.redo.disabled = !doc.canRedo || !edit;
    for (const t of ['select', 'translate', 'rotate', 'scale']) { btns[t].classList.toggle('on', state.tool === t); btns[t].disabled = !edit; }
    viewSelect.value = orbit.ortho && orbit.viewName ? orbit.viewName : 'perspective';
    btns.space.textContent = gizmo.space === 'world' ? 'World' : 'Local'; btns.snap.classList.toggle('on', state.snapOn);
    btns.save.disabled = !edit; btns.save.textContent = doc.dirty ? 'Save *' : 'Save';
    btns.play.textContent = state.playing ? '■ Stop' : '▶ Play'; btns.play.classList.toggle('on', state.playing);
    document.title = `${doc.dirty ? '* ' : ''}${state.sceneName ?? doc.name} — ${config.title ?? 'Scene editor'}`;
  }
  const problemsBox = h('div', { id: 'problems', style: { display: 'none' } });
  mount.append(problemsBox);
  const statusInfo = h('span', {}), statusProblems = h('span', { class: 'problems', onclick: () => { state.showProblems = !state.showProblems; renderStatus(); } }), statusMsg = h('span', { class: 'msg' });
  status.append(statusInfo, statusProblems, statusMsg);
  function recomputeProblems() { state.problems = doc.validate(); }
  function renderStatus() {
    statusInfo.textContent = `${state.sceneName ?? '(unsaved)'} — ${doc.size} entities${selection.size ? `, ${selection.size} selected` : ''}`;
    const errs = state.problems.filter((p) => p.severity === 'error').length, warns = state.problems.length - errs;
    statusProblems.textContent = state.problems.length ? `${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}` : 'no problems';
    statusProblems.className = `problems ${errs ? 'bad' : 'ok'}`;
    problemsBox.style.display = state.showProblems && state.problems.length ? '' : 'none';
    problemsBox.textContent = '';
    for (const p of state.problems) problemsBox.append(h('div', { class: `problem ${p.severity}`, onclick: () => { const m = /entities\[(\d+)\]/.exec(p.path); if (m) { const e = doc.entities[Number(m[1])]; if (e) selection.set(e.id); } } }, `${p.path}: ${p.message}`));
    const live = performance.now() < message.until;
    statusMsg.textContent = live ? message.text : (state.playing ? 'playing' : '');
    statusMsg.style.color = live ? ({ bad: 'var(--bad)', warn: 'var(--warn)', good: 'var(--good)' }[message.kind] ?? '') : '';
  }
  let helpEl = null;
  function toggleHelp() {
    if (helpEl) { helpEl.remove(); helpEl = null; return; }
    helpEl = h('div', { id: 'help', onclick: toggleHelp }, h('b', {}, 'Keys'), h('table', {}, ...shortcuts.list().map((s) => h('tr', {}, h('td', {}, h('kbd', {}, s.keys)), h('td', {}, s.label))),
      h('tr', {}, h('td', {}, h('kbd', {}, 'right-drag')), h('td', {}, 'orbit (hold, then W A S D Q E to fly)')), h('tr', {}, h('td', {}, h('kbd', {}, 'middle-drag')), h('td', {}, 'pan')),
      h('tr', {}, h('td', {}, h('kbd', {}, 'wheel')), h('td', {}, 'zoom')), h('tr', {}, h('td', {}, h('kbd', {}, 'drag on empty')), h('td', {}, 'box select')), h('tr', {}, h('td', {}, h('kbd', {}, 'shift / ctrl click')), h('td', {}, 'add to selection'))));
    mount.append(helpEl);
  }

  // ---- shortcuts ----
  const editing = (fn) => () => { if (!state.playing && !state.rmb) fn(); };
  shortcuts
    .bind('ctrl+z', editing(() => editor.undo()), 'Undo').bind(['ctrl+y', 'ctrl+shift+z'], editing(() => editor.redo()), 'Redo')
    .bind('ctrl+s', () => { if (!state.playing) editor.save(); }, 'Save')
    .bind('ctrl+d', editing(() => editor.duplicateSelection()), 'Duplicate').bind('ctrl+c', editing(() => editor.copy()), 'Copy').bind('ctrl+v', editing(() => editor.paste()), 'Paste').bind('ctrl+a', editing(() => editor.selectAll()), 'Select all')
    .bind(['delete', 'backspace'], editing(() => editor.deleteSelection()), 'Delete')
    .bind('q', editing(() => editor.setTool('select')), 'Select tool').bind('w', editing(() => editor.setTool('translate')), 'Move tool').bind('e', editing(() => editor.setTool('rotate')), 'Rotate tool').bind('r', editing(() => editor.setTool('scale')), 'Scale tool')
    .bind('x', editing(() => editor.setSpace(gizmo.space === 'world' ? 'local' : 'world')), 'World / local handles').bind('g', editing(() => editor.setSnap(!state.snapOn)), 'Snap on / off')
    .bind('f', () => { if (!state.rmb) editor.focus(); }, 'Focus the selection').bind('p', () => { if (!state.rmb) editor.togglePlay(); }, 'Play / stop')
    .bind('esc', () => { if (state.playing) editor.stop(); else if (helpEl) toggleHelp(); else selection.clear(); }, 'Stop playing / deselect')
    .bind('ctrl+f2', editing(() => editor.renameMany()), 'Rename several at once').bind('f2', editing(() => editor.rename(undefined, 'name')), 'Rename').bind('shift+f2', editing(() => editor.rename(undefined, 'id')), 'Rename the id')
    .bind('shift+/', () => toggleHelp(), 'This list');
  const keysDown = new Set();
  addEventListener('keydown', (e) => { if (captured() && e.code !== 'Escape' && e.code !== 'KeyP') return; if (state.rmb && /^Key[WASDQE]$/.test(e.code)) { keysDown.add(e.code); e.preventDefault(); return; } shortcuts.handle(e); });
  addEventListener('keyup', (e) => keysDown.delete(e.code));
  addEventListener('beforeunload', (e) => { if (doc.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- the viewport ----
  function resize() {
    const r = stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    renderer.resize(Math.max(1, r.width), Math.max(1, r.height), dpr); camera.setViewport(r.width, r.height);
    overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr);
  }
  new ResizeObserver(resize).observe(stage); resize();

  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const rayAt = (e) => { const p = local(e); return rayFromScreen(camera, p.x, p.y); };
  const camPos = () => [camera.x, camera.y, camera.z];
  const IDQ = [0, 0, 0, 1];

  function pivotInfo() {
    const roots = selection.roots(doc);
    if (!roots.length || state.playing || state.tool === 'select') return null;
    const c = [0, 0, 0];
    for (const id of roots) { const m = view.worldMatrix(id); c[0] += m[12]; c[1] += m[13]; c[2] += m[14]; }
    const pos = c.map((v) => v / roots.length);
    const rot = gizmo.space === 'local' && roots.length === 1 ? decompose(view.worldMatrix(roots[0])).rotation : IDQ;
    return { roots, pos, rot };
  }

  function beginGizmoDrag(handle, ray, pv) {
    const starts = pv.roots.map((id) => {
      const e = doc.get(id), d = decompose(view.worldMatrix(id));
      return { id, pos: d.position, rot: d.rotation, scale: d.scale, at: JSON.parse(JSON.stringify(e.at ?? {})), parentWorld: e.parent ? Float64Array.from(view.worldMatrix(e.parent)) : null };
    });
    const st = gizmo.begin(handle, ray, pv.pos, pv.rot, 1, camPos());
    if (!st) return false;
    state.drag = { handle, st, starts, pivot: pv.pos, rot: pv.rot, seq: ++state.dragSeq };
    return true;
  }
  function updateGizmoDrag(ray) {
    const d = state.drag, r = gizmo.update(d.st, ray);
    if (!r.position && !r.rotation && r.scale === undefined) return;
    doc.batch('Transform', () => {
      for (const s of d.starts) {
        let pos = s.pos, rot = s.rot, scale = s.scale;
        if (r.position) pos = add(s.pos, sub(r.position, d.pivot));
        else if (r.rotation) {
          const dq = quat.multiply([0, 0, 0, 1], r.rotation, quat.conjugate([0, 0, 0, 1], d.rot));
          pos = add(d.pivot, quat.rotate([0, 0, 0], dq, sub(s.pos, d.pivot)));
          rot = quat.multiply([0, 0, 0, 1], dq, s.rot);
        } else { pos = add(d.pivot, mul(sub(s.pos, d.pivot), r.scale)); scale = s.scale * r.scale; }
        const at = worldToLocalAt(s.parentWorld, pos, rot, scale, s.at);
        doc.update(s.id, atPatch(s.at, at));
      }
    }, { merge: `gizmo:${d.seq}` });
  }

  let down = null;
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  const captured = () => state.playing && !!state.runtime?.camera;             // a playing game that has taken the camera
  stage.addEventListener('pointerdown', (e) => {
    stage.focus({ preventScroll: true });
    if (captured()) return;
    stage.setPointerCapture(e.pointerId);
    const p = local(e);
    down = { x: p.x, y: p.y, lx: e.clientX, ly: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, moved: 0 };
    if (e.button === 2 && !e.shiftKey) { state.mode = 'orbit'; state.rmb = true; }
    else if (e.button === 1 || (e.button === 2 && e.shiftKey)) state.mode = 'pan';
    else if (e.button === 0 && e.altKey) state.mode = 'orbit';
    else if (e.button === 0) {
      const pv = pivotInfo();
      if (pv) { const hit = gizmo.hit(rayAt(e), pv.pos, pv.rot, camPos()); if (hit && beginGizmoDrag(hit, rayAt(e), pv)) { state.mode = 'gizmo'; return; } }
      state.mode = 'click';
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!down) { // hovering: light up the handle under the pointer
      const pv = pivotInfo();
      gizmo.hover = pv ? gizmo.hit(rayAt(e), pv.pos, pv.rot, camPos()) : null;
      stage.style.cursor = gizmo.hover ? 'pointer' : '';
      return;
    }
    const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
    down.lx = e.clientX; down.ly = e.clientY; down.moved += Math.abs(dx) + Math.abs(dy);
    if (state.mode === 'orbit') orbit.orbit(dx, dy);
    else if (state.mode === 'pan') orbit.pan(dx, dy, camera.fovY, stage.clientHeight);
    else if (state.mode === 'gizmo') updateGizmoDrag(rayAt(e));
    else if (state.mode === 'click' && Math.hypot(p.x - down.x, p.y - down.y) > 5 && !state.playing) state.mode = 'box';
    if (state.mode === 'box') {
      const x0 = Math.min(down.x, p.x), y0 = Math.min(down.y, p.y);
      Object.assign(marquee.style, { display: '', left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(p.x - down.x)}px`, height: `${Math.abs(p.y - down.y)}px` });
    }
  });
  stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    const p = local(e);
    if (state.mode === 'click' && !state.playing) {
      const hit = pick(rayAt(e), view.items());
      if (hit) { if (down.shift || down.ctrl) selection.toggle(hit.item.id); else selection.set(hit.item.id); }
      else if (!down.shift && !down.ctrl) selection.clear();
    } else if (state.mode === 'box') {
      const ids = inRect(camera, view.items(), down.x, down.y, p.x, p.y);
      selection.set(down.shift || down.ctrl ? [...selection.ids, ...ids] : ids);
      marquee.style.display = 'none';
    }
    if (state.mode === 'gizmo') state.drag = null;
    if (state.mode === 'orbit') { state.rmb = false; keysDown.clear(); }
    state.mode = null; down = null;
  });
  stage.addEventListener('pointercancel', () => { state.mode = null; down = null; state.drag = null; state.rmb = false; marquee.style.display = 'none'; });
  stage.addEventListener('wheel', (e) => { if (!captured()) orbit.zoom(e.deltaY); e.preventDefault(); }, { passive: false });
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('text/x-prefab')) e.preventDefault(); });
  stage.addEventListener('drop', (e) => {
    const name = e.dataTransfer?.getData('text/x-prefab'); if (!name) return;
    e.preventDefault();
    const p = local(e); editor.addPrefab(name, editor.groundAt(p.x, p.y) ?? undefined);
  });

  // ---- drawing ----
  const model = new Float64Array(16), scl = new Float64Array(16);
  const tint = (c, selected) => (selected ? [Math.min(1, c[0] * 0.5 + 0.5), Math.min(1, c[1] * 0.5 + 0.38), c[2] * 0.4] : c);
  function drawItems(selectedSet) {
    for (const it of view.items()) {
      const s = it.shape, sel = selectedSet.has(it.id), k = it.disabled ? 0.45 : 1;
      let c = tint(it.color, sel); c = [c[0] * k, c[1] * k, c[2] * k];
      if (s.type === 'capsule') list.add(capsuleMesh(s.radius, s.halfHeight), it.matrix, c[0], c[1], c[2]);
      else {
        const sc = s.type === 'sphere' ? [s.radius * 2, s.radius * 2, s.radius * 2] : [s.hx * 2, s.hy * 2, s.hz * 2];
        mat4.scaling(scl, sc[0], sc[1], sc[2]); mat4.multiply(model, it.matrix, scl);
        list.add(s.type === 'sphere' ? unitSphere : it.ramp ? unitWedge : unitBox, model, c[0], c[1], c[2]);
      }
    }
  }

  const eps = 0.05;
  function clip(p) { const m = camera.viewProj; return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]]; }
  function segment(a, b) {
    let ca = clip(a), cb = clip(b);
    if (ca[3] < eps && cb[3] < eps) return false;
    const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
    if (ca[3] < eps) ca = lerp(ca, cb, (eps - ca[3]) / (cb[3] - ca[3]));
    else if (cb[3] < eps) cb = lerp(ca, cb, (eps - ca[3]) / (cb[3] - ca[3]));
    const W = camera.viewW, H = camera.viewH;
    g2.moveTo((ca[0] / ca[3] * 0.5 + 0.5) * W, (0.5 - ca[1] / ca[3] * 0.5) * H);
    g2.lineTo((cb[0] / cb[3] * 0.5 + 0.5) * W, (0.5 - cb[1] / cb[3] * 0.5) * H);
    return true;
  }
  const line = (a, b, color, width = 1, alpha = 1) => { g2.beginPath(); g2.strokeStyle = color; g2.lineWidth = width; g2.globalAlpha = alpha; segment(a, b); g2.stroke(); g2.globalAlpha = 1; };

  function drawGrid() {
    const far = orbit.distance > 120 ? 10 : orbit.distance > 40 ? 5 : 1, n = 24;
    const cx = Math.round(orbit.target[0] / far / 5) * far * 5, cz = Math.round(orbit.target[2] / far / 5) * far * 5;
    g2.beginPath(); g2.strokeStyle = '#ffffff'; g2.lineWidth = 1; g2.globalAlpha = 0.09;
    for (let i = -n; i <= n; i++) { const o = i * far; segment([cx + o, 0, cz - n * far], [cx + o, 0, cz + n * far]); segment([cx - n * far, 0, cz + o], [cx + n * far, 0, cz + o]); }
    g2.stroke(); g2.globalAlpha = 1;
    line([-500, 0.001, 0], [500, 0.001, 0], '#f0605a', 1, 0.5); line([0, 0.001, -500], [0, 0.001, 500], '#5a8cf0', 1, 0.5);
  }
  function drawBox(m, half, color) {
    const c = [];
    for (let i = 0; i < 8; i++) { const x = i & 1 ? half[0] : -half[0], y = i & 2 ? half[1] : -half[1], z = i & 4 ? half[2] : -half[2]; c.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]); }
    g2.beginPath(); g2.strokeStyle = color; g2.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) segment(c[i], c[i | bit]);
    g2.stroke();
  }
  function drawGizmo(pv) {
    const geo = gizmo.geometry(pv.pos, pv.rot, camPos());
    const active = state.drag?.handle ?? gizmo.hover;
    for (const l of geo.lines) line(l.from, l.to, active === l.id ? HOT : GIZMO_COLORS[l.id] ?? '#fff', l.id.length > 1 ? 2 : 3.5);
    for (const r of geo.rings) { g2.beginPath(); g2.strokeStyle = active === r.id ? HOT : GIZMO_COLORS[r.id[1]]; g2.lineWidth = active === r.id ? 4 : 2.5; for (let i = 0; i < r.points.length - 1; i++) segment(r.points[i], r.points[i + 1]); g2.stroke(); }
    if (gizmo.mode !== 'rotate') for (const l of geo.lines.filter((x) => x.id.length === 1)) { const p = camera.worldToScreen(l.to[0], l.to[1], l.to[2]); if (p.visible) { g2.fillStyle = active === l.id ? HOT : GIZMO_COLORS[l.id]; g2.fillRect(p.x - 4, p.y - 4, 8, 8); } }
    if (gizmo.mode === 'scale') { const p = camera.worldToScreen(pv.pos[0], pv.pos[1], pv.pos[2]); if (p.visible) { g2.fillStyle = active === 'u' ? HOT : '#e0e0e0'; g2.fillRect(p.x - 6, p.y - 6, 12, 12); } }
  }
  function drawOverlay() {
    const dpr = devicePixelRatio || 1;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, camera.viewW, camera.viewH);
    g2.lineCap = 'round';
    if (!state.playing) {
      drawGrid();
      const sel = new Set(selection.ids);
      for (const it of view.items()) if (sel.has(it.id)) drawBox(it.matrix, it.half, it.id === selection.primary ? '#ffe14d' : '#ffb347');
      const pv = pivotInfo(); if (pv) drawGizmo(pv);
      for (const fn of editor.overlayDraw) fn(g2);                    // things a keymap draws on top (the handles of a box's sides)
    }
  }

  let last = performance.now(), frames = 0, fps = 0, fpsClock = last;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (state.rmb && keysDown.size) orbit.fly([(keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('KeyA') ? 1 : 0), (keysDown.has('KeyE') ? 1 : 0) - (keysDown.has('KeyQ') ? 1 : 0), (keysDown.has('KeyW') ? 1 : 0) - (keysDown.has('KeyS') ? 1 : 0)], dt);
    orbit.apply(camera);
    camera.ortho = orbit.ortho && !state.playing ? orbit.orthoHeight(camera.fovY) : 0;
    if (captured()) state.runtime.camera(camera);
    camera.update();
    list.clear(); list.setCamera(camera);
    config.scenery?.(list, meshes);
    if (state.playing && state.runtime) {
      try {
        state.acc += dt; let n = 0;
        while (state.acc >= 1 / 60 && n++ < 5) { state.runtime.step(1 / 60); state.acc -= 1 / 60; }
        if (n >= 5) state.acc = 0;
        state.runtime.draw(list, meshes);
      } catch (e) { console.error(e); editor.stop(); editor.say(`The scene stopped: ${e.message}`, 'bad'); }
    } else drawItems(new Set(selection.ids));
    renderer.render({ camera, list, clear: [0.17, 0.19, 0.23, 1], lighting: light, shadows: { size: 2048, radius: 60 } });
    drawOverlay();
    frames++; if (now - fpsClock >= 500) { fps = (frames * 1000) / (now - fpsClock); frames = 0; fpsClock = now; }
    hud.textContent = `${renderer.kind}  ${fps.toFixed(0)} fps   ${state.tool}${state.snapOn ? ' (snap)' : ''}  ${gizmo.space}   ${orbit.ortho ? `${orbit.viewName ?? 'user'} orthographic` : 'perspective'}`;
    if (message.until && performance.now() > message.until) { message.until = 0; renderStatus(); }
    requestAnimationFrame(frame);
  }

  if (config.keymap === 'blender') installBlender(editor);          // G R S with the mouse, Shift+D, the number pad views...

  // ---- go ----
  editor.revealPrimary = false;
  await refreshSceneList();
  const first = config.scene ?? (await config.scenes.list())[0]?.name;
  if (first) await editor.open(first);
  recomputeProblems(); hierarchy.refresh(); inspector.refresh(); renderBar(); renderStatus();
  requestAnimationFrame(frame);
  return editor;
}
