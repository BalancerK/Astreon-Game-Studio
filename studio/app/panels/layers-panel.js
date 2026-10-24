// The Layers panel: the camera and the backdrop. The camera follows your hero with a little delay, looks ahead and ignores small moves; the layers are sky, stars, clouds, hills,
// buildings and pictures behind the game (or mist in front of it) that move slower than the world, so they look far away. Slide the camera or press Walk to see it move.
// Kept in `src/layers.js`; the game uses it with `followSmooth(game, hero, map, dt, layers.camera)` and `drawLayers(g, game, layers)` from @engine/arcade.
import { h, button, fill } from '../ui/dom.js';
import * as M from '../paint/layers-model.js';
import { drawLayers } from '../../../packages/arcade/src/camera.js';
import { parseSprite } from '../paint/sprite-model.js';

const FILE = 'src/layers.js';
const VIEW = { w: 400, h: 240 };
const WORLD = 1600;
const HINT = 'Layers make a flat game feel deep: a sky that does not move, hills that drift slowly, a near hill that keeps up with you. '
  + 'Start from a ready-made set and change it.';
const SNIPPET = [
  "import layers from './layers.js';",
  "import { followSmooth, stepLayers, drawLayers, clear, drawThings } from '@engine/arcade';",
  '',
  '// in update(game, dt):',
  '//   stepLayers(game, dt);',
  '//   followSmooth(game, game.hero, game.map, dt, layers.camera);',
  '// in render(game, g):',
  '//   drawLayers(g, game, layers);                  // the backdrop',
  '//   drawThings(g, game);',
  '//   drawLayers(g, game, layers, { front: true }); // mist in front',
].join('\n');

const RANGES = {
  size: { label: 'Size', min: 4, max: 800, step: 4, help: 'How wide one hill, cloud cell or building is, in pixels' },
  y: { label: 'Top', min: -100, max: 400, step: 2, help: 'Where it starts, in pixels from the top of the screen' },
  height: { label: 'Height', min: 0, max: 400, step: 2, help: 'How tall, in pixels' },
  alpha: { label: 'See-through', min: 0, max: 1, step: 0.05, help: '1 is solid, 0 is invisible' },
  seed: { label: 'Shuffle', min: 0, max: 99, step: 1, help: 'A different scattering of the same thing' },
};
const KIND_FIELDS = {
  gradient: [], color: ['y', 'height'], stars: ['size', 'y', 'height', 'seed'], clouds: ['size', 'y', 'height', 'alpha', 'seed'],
  hills: ['size', 'y', 'height'], buildings: ['size', 'y', 'height', 'seed'], image: ['size', 'y', 'height'], sprite: ['size', 'y', 'height'],
};
const CAMERA_FIELDS = [
  { key: 'smooth', label: 'Delay', min: 0, max: 1, step: 0.01, help: 'Seconds the camera takes to catch up. 0 sticks to the hero.' },
  { key: 'lookAhead', label: 'Look ahead', min: 0, max: 200, step: 2, help: 'Pixels shown ahead of where the hero is heading' },
  { key: 'deadZone', label: 'Dead zone', min: 0, max: 200, step: 2, help: 'Pixels the hero may wander before the camera moves' },
];

export function layersPanel(studio) {
  return {
    id: 'layers',
    title: 'Layers',
    icon: 'edit',
    create() {
      let file = null;
      let selected = 0;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let camX = 0;
      let walking = false;
      let clock = 0;
      let timer = 0;

      const toolbar = h('div', { class: 'toolbar art-bar' });
      const view = h('canvas', { width: VIEW.w, height: VIEW.h, class: 'layers-view', role: 'img',
        aria: { label: 'The layers as a player sees them' } });
      const scrub = h('input', { type: 'range', min: '0', max: String(WORLD), step: '4', value: '0',
        aria: { label: 'Where the camera is in the world' } });
      scrub.addEventListener('input', () => { camX = Number(scrub.value); walking = false; drawToolbar(); paint(); });
      const list = h('div', { class: 'layers-list' });
      const inspector = h('div', { class: 'layers-inspector' });
      const cameraBox = h('fieldset', { class: 'sound-layer' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code',
        text: SNIPPET }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'layers-body' }, view, h('label', { class: 'sound-slider' }, h('span', { text: 'Camera' }), scrub), list,
        inspector, cameraBox);
      const el = h('div', { class: 'panel-body art layers', 'aria-label': 'Layers' }, toolbar, body, issues, help, empty);

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { file = raw ? M.parseLayers(raw) : null; } catch (error) { file = null; problem = error.message; }
        selected = Math.min(selected, Math.max(0, (file?.layers.length ?? 1) - 1));
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !file) return;
        const out = M.serializeLayers(file);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { redraw = true } = {}) {
        file = next;
        save();
        if (redraw) draw(); else paint();
      }
      const attempt = (fn, { redraw = true } = {}) => {
        try { edit(fn(), { redraw }); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); draw(); }
      };

      // ---- the picture ----
      function art() {
        const out = {};
        for (const l of file?.layers ?? []) {
          const path = `src/art/${l.sprite}.js`;
          if (l.kind === 'sprite' && l.sprite && !(l.sprite in out) && studio.project?.has(path)) {
            try { out[l.sprite] = parseSprite(studio.project.readText(path)); } catch { /* a damaged sprite is left out */ }
          }
        }
        return out;
      }
      function paint() {
        if (!file) return;
        const g = view.getContext('2d');
        g.clearRect(0, 0, VIEW.w, VIEW.h);
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, VIEW.w, VIEW.h);
        const game = { camera: { x: camX, y: 0 }, layerClock: clock };
        const opts = { art: art(), width: VIEW.w, height: VIEW.h };
        drawLayers(g, game, file, opts);
        // a ground and a hero, so the movement of the layers has something to be measured against
        g.fillStyle = '#4a4f5c';
        g.fillRect(0, VIEW.h - 24, VIEW.w, 24);
        g.fillStyle = '#2b2f3a';
        for (let x = -(camX % 40); x < VIEW.w; x += 40) g.fillRect(x, VIEW.h - 24, 2, 24);
        g.fillStyle = '#8b8bff';
        g.fillRect(VIEW.w / 2 - 10, VIEW.h - 24 - 28, 20, 28);
        drawLayers(g, game, file, { ...opts, front: true });
        g.fillStyle = '#9aa3b5';
        g.font = '11px system-ui, sans-serif';
        g.fillText(`camera ${Math.round(camX)}`, 6, 14);
      }
      function tick() {
        if (!file || !el.isConnected || !el.offsetParent) return;
        clock += 1 / 30;
        if (walking) {
          camX += 4;
          if (camX > WORLD) camX = 0;
          scrub.value = String(camX);
        }
        paint();
      }

      // ---- the controls ----
      function slider(f, value, onInput) {
        const out = h('output', { text: String(Math.round(value * 100) / 100) });
        const input = h('input', { type: 'range', min: String(f.min), max: String(f.max), step: String(f.step), value: String(value),
          aria: { label: f.label } });
        input.addEventListener('input',
          () => { out.textContent = String(Math.round(Number(input.value) * 100) / 100); onInput(Number(input.value)); });
        return h('label', { class: 'sound-slider', title: f.help }, h('span', { text: f.label }), input, out);
      }
      function drawToolbar() {
        fill(toolbar,
          file ? h('select', { aria: { label: 'Add a layer' }, on: { change: (e) => {
            const kind = e.target.value;
            e.target.value = '';
            if (!kind) return;
            attempt(() => { const r = M.addLayer(file, kind); selected = r.index; return r.file; });
          } } }, h('option', { value: '', text: 'Add a layer…' }), ...Object.entries(M.LAYER_KINDS).map(([k, d]) => h('option', { value: k, text: k,
            title: d }))) : null,
          file ? button({ text: walking ? 'Stop' : 'Walk', class: 'small',
            aria: { label: walking ? 'Stop the camera walking' : 'Make the camera walk' },
            onClick: () => { walking = !walking; drawToolbar(); } }) : null);
      }
      function drawList() {
        fill(list, h('h4', { text: 'Layers (back to front)' }), ...file.layers.map((l, i) => h('div',
          { class: `layers-row${i === selected ? ' on' : ''}` },
          button({ text: l.name, class: 'small', aria: { label: `Edit layer ${l.name}`, pressed: String(i === selected) },
            onClick: () => { selected = i; draw(); } }),
          h('span', { class: 'dim', text: `${l.kind}${l.front ? ', in front' : ''}${l.hidden ? ', hidden' : ''}` }),
          button({ text: '↑', class: 'small ghost', title: 'Towards the back', aria: { label: `Move ${l.name} back` }, disabled: i === 0,
            onClick: () => attempt(() => { const r = M.moveLayer(file, i, i - 1); selected = r.index; return r.file; }) }),
          button({ text: '↓', class: 'small ghost', title: 'Towards the front', aria: { label: `Move ${l.name} forward` },
            disabled: i === file.layers.length - 1,
            onClick: () => attempt(() => { const r = M.moveLayer(file, i, i + 1); selected = r.index; return r.file; }) }),
          button({ text: 'Copy', class: 'small ghost', aria: { label: `Copy ${l.name}` },
            onClick: () => attempt(() => { const r = M.duplicateLayer(file, i); selected = r.index; return r.file; }) }),
          button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove ${l.name}` },
            onClick: () => attempt(() => { selected = Math.max(0, Math.min(selected, file.layers.length - 2)); return M.removeLayer(file,
              i); }) }))));
      }
      function drawInspector() {
        const l = file.layers[selected];
        if (!l) { fill(inspector, h('p', { class: 'dim', text: 'No layers. Add one from the list above.' })); return; }
        const set = (props, redraw = false) => attempt(() => M.setLayer(file, selected, props), { redraw });
        const color = (label, key) => h('label', { class: 'sound-slider' }, h('span', { text: label }), h('input', {
          type: 'color', value: l[key] ?? '#ffffff', aria: { label }, on: { input: (e) => set({ [key]: e.target.value }) },
        }));
        const sprites = studio.project?.list().filter((p) => /^src\/art\/[\w-]+\.js$/.test(p)).map((p) => p.slice(8, -3)) ?? [];
        fill(inspector, h('h4', { text: `The layer "${l.name}"` }),
          h('label', { class: 'state-line' }, 'Name ', h('input', { type: 'text', value: l.name, maxlength: '32', aria: { label: 'Layer name' },
            on: { change: (e) => set({ name: e.target.value }, true) } })),
          h('p', { class: 'dim', text: M.LAYER_KINDS[l.kind] }),
          l.kind !== 'image' && l.kind !== 'sprite' ? color(l.kind === 'gradient' ? 'Top colour' : 'Colour', 'color') : null,
          l.kind === 'gradient' ? color('Bottom colour', 'color2') : null,
          l.kind === 'sprite' ? h('label', { class: 'state-line' }, 'Sprite ', h('select', { aria: { label: 'Sprite to repeat' },
            on: { change: (e) => set({ sprite: e.target.value }) } },
            h('option', { value: '', text: sprites.length ? '(pick one)' : '(no sprites yet)' }), ...sprites.map((s) => h('option', { value: s,
              text: s, selected: s === l.sprite })))) : null,
          l.kind === 'image' ? h('label', { class: 'state-line' }, 'Picture file ', h('input', { type: 'text', value: l.image ?? '',
            placeholder: 'assets/sky.png',
            aria: { label: 'Picture file' }, on: { change: (e) => set({ image: e.target.value }) } })) : null,
          ...(KIND_FIELDS[l.kind] ?? []).map((k) => slider({ ...RANGES[k], label: RANGES[k].label }, l[k] ?? 0, (v) => set({ [k]: v }))),
          l.kind !== 'gradient' ? slider({ label: 'Parallax across', min: 0, max: 1.5, step: 0.05,
            help: '0 stays put on the screen, 0.5 moves half as much as the world, 1 moves with it' },
            l.parallax?.[0] ?? 0, (v) => set({ parallax: [v, l.parallax?.[1] ?? 0] })) : null,
          l.kind !== 'gradient' ? slider({ label: 'Parallax up and down', min: 0, max: 1.5, step: 0.05,
            help: 'How much it moves when the camera goes up or down' },
            l.parallax?.[1] ?? 0, (v) => set({ parallax: [l.parallax?.[0] ?? 0, v] })) : null,
          l.kind !== 'gradient' ? slider({ label: 'Drifts by itself', min: -60, max: 60, step: 1,
            help: 'Pixels a second it slides sideways, even when the camera is still' },
            l.scroll?.[0] ?? 0, (v) => set({ scroll: [v, l.scroll?.[1] ?? 0] })) : null,
          h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: !!l.front,
            on: { change: (e) => set({ front: e.target.checked }, true) } }), ' In front of the game'),
          h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: !!l.hidden,
            on: { change: (e) => set({ hidden: e.target.checked }, true) } }), ' Hidden for now'));
      }
      function drawCamera() {
        const cam = { ...M.CAMERA_DEFAULTS, ...file.camera };
        fill(cameraBox, h('legend', { text: 'The camera' }), ...CAMERA_FIELDS.map((f) => slider(f, cam[f.key],
          (v) => attempt(() => M.setCamera(file, { [f.key]: v }), { redraw: false }))),
          h('p', { class: 'dim',
            text: 'These are for followSmooth. The picture above does not follow a hero; slide the camera to see the layers.' }));
      }

      function draw() {
        drawToolbar();
        const has = Boolean(file);
        body.hidden = !has;
        help.hidden = !has;
        issues.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(empty, h('h3', { text: problem ? 'The layers file needs fixing' : 'No layers yet' }), h('p', { text: problem || HINT }),
            problem ? null : h('div', { class: 'toolbar' }, ...[['day', 'A sunny day'], ['night', 'A starry night'], ['city',
              'A city at sunset']].map(([k, label]) => button({
              text: label, class: 'primary', onClick: () => { selected = 0; edit(M.STARTERS[k]()); flush(); } }))));
          return;
        }
        drawList();
        drawInspector();
        drawCamera();
        paint();
        const found = M.layerProblems(file).concat(M.missingSprites(file, studio.project?.list().map((p) => p.slice(8,
          -3)) ?? []).map((s) => `The sprite "${s}" is not in this project.`));
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((f) => h('li', { text: f })));
      }

      timer = setInterval(tick, 1000 / 30);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!file) load(); });
      load();
      return { el, focus: () => el.querySelector('button, select')?.focus(), onShow: load, dispose: () => { clearInterval(timer); flush(); } };
    },
  };
}
