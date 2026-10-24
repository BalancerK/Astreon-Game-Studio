// The Lights panel: darkness, lights and screen effects. Make the screen dark and cut pools of light out of it: torches on every thing of a kind, a glow round the hero, a lamp at a
// place. Tint the whole screen a colour and darken the corners. The picture is a little room: move your mouse and you are the hero. Kept in `src/lights.js`; the game uses it with
// `drawLights(g, game, lights)` from @engine/arcade, after `drawThings`.
import { h, button, fill } from '../ui/dom.js';
import * as M from '../paint/lights-model.js';
import { drawLights } from '../../../packages/arcade/src/lights.js';
import { drawThings } from '../../../packages/arcade/src/draw.js';

const FILE = 'src/lights.js';
const VIEW = { w: 400, h: 240 };
const HINT = 'Lights make a game moody: a dungeon that is dark except round your torch, a night with lanterns, a warm sunset. '
  + 'Start from a ready-made set and change it.';
const SNIPPET = [
  "import lights from './lights.js';",
  "import { stepLayers, drawLights, drawThings, clear } from '@engine/arcade';",
  '',
  '// in update(game, keys, dt):  stepLayers(game, dt);      // keeps flickering lights moving',
  '// in render(game, g):',
  '//   clear(g);',
  '//   drawThings(g, game);',
  '//   drawLights(g, game, lights);                          // the dark and the lights, over the picture',
  '//   ...then write the score and draw screens, so they stay bright',
].join('\n');
const SCREEN_FIELDS = [
  { key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.05, help: '0 is daylight, 1 is pitch black away from the lights' },
  { key: 'tintAlpha', label: 'Tint strength', min: 0, max: 1, step: 0.02, help: 'How strongly the whole screen is coloured' },
  { key: 'vignette', label: 'Dark corners', min: 0, max: 1, step: 0.05, help: 'Darkens the edges of the screen' },
];
const LIGHT_FIELDS = [
  { key: 'radius', label: 'Size', min: 10, max: 400, step: 5, help: 'How far the light reaches, in pixels' },
  { key: 'intensity', label: 'Brightness', min: 0, max: 1, step: 0.05, help: 'How much of the dark it clears' },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, help: '0 is steady, 1 is a candle in a draught' },
];

export function lightsPanel(studio) {
  return {
    id: 'lights',
    title: 'Lights',
    icon: 'edit',
    create() {
      let file = null;
      let selected = 0;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let clock = 0;
      let mouse = { x: 200, y: 120 };
      let timer = 0;

      const toolbar = h('div', { class: 'toolbar art-bar' });
      const view = h('canvas', { width: VIEW.w, height: VIEW.h, class: 'layers-view', tabindex: '0', role: 'img',
        aria: { label: 'A little room with the lights: your mouse is the hero' } });
      const list = h('div', { class: 'layers-list' });
      const inspector = h('div', { class: 'layers-inspector' });
      const screenBox = h('fieldset', { class: 'sound-layer' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code',
        text: SNIPPET }));
      const empty = h('div', { class: 'empty' });
      const note = h('div', { class: 'dim', text: 'Move the mouse over the picture: you are the hero. Torches are the two orange squares.' });
      const body = h('div', { class: 'layers-body' }, view, note, screenBox, list, inspector);
      const el = h('div', { class: 'panel-body art layers', 'aria-label': 'Lights' }, toolbar, body, issues, help, empty);

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { file = raw ? M.parseLights(raw) : null; } catch (error) { file = null; problem = error.message; }
        selected = Math.min(selected, Math.max(0, (file?.lights.length ?? 1) - 1));
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !file) return;
        const out = M.serializeLights(file);
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
      function paint() {
        if (!file) return;
        const g = view.getContext('2d');
        g.fillStyle = '#3d6b4f';
        g.fillRect(0, 0, VIEW.w, VIEW.h);
        const things = [
          { kind: 'torch', x: 70, y: 150, w: 14, h: 14, color: '#ff9a3c', id: 1 }, { kind: 'torch', x: 320, y: 60, w: 14, h: 14, color: '#ff9a3c',
            id: 2 },
          { kind: 'wall', x: 150, y: 70, w: 100, h: 24, color: '#8a8f9c' }, { kind: 'wall', x: 230, y: 170, w: 24, h: 60, color: '#8a8f9c' },
          { kind: 'wall', x: 20, y: 40, w: 60, h: 24, color: '#8a8f9c' },
          { kind: 'hero', x: mouse.x - 11, y: mouse.y - 11, w: 22, h: 22, color: '#8b8bff', id: 3 },
        ];
        drawThings(g, { things }, {});
        drawLights(g, { things, camera: { x: 0, y: 0 }, layerClock: clock }, file, { width: VIEW.w, height: VIEW.h });
      }
      view.addEventListener('pointermove', (event) => {
        const box = view.getBoundingClientRect();
        mouse = { x: ((event.clientX - box.left) / box.width) * VIEW.w, y: ((event.clientY - box.top) / box.height) * VIEW.h };
      });
      function tick() {
        if (!file || !el.isConnected || !el.offsetParent) return;
        clock += 1 / 30;
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
      const colorInput = (label, value, onInput) => h('label', { class: 'sound-slider' }, h('span', { text: label }),
        h('input', { type: 'color', value, aria: { label }, on: { input: (e) => onInput(e.target.value) } }));
      function drawToolbar() {
        fill(toolbar, file ? h('select', { aria: { label: 'Add a light' }, on: { change: (e) => {
          const sort = e.target.value;
          e.target.value = '';
          if (sort) attempt(() => { const r = M.addLight(file, sort); selected = r.index; return r.file; });
        } } }, h('option', { value: '', text: 'Add a light…' }), ...Object.entries(M.LIGHT_SORTS).map(([k, s]) => h('option', { value: k,
          text: s.label }))) : null);
      }
      function drawScreen() {
        const fx = { ...M.SCREEN_DEFAULTS, ...file.screen };
        const set = (props, redraw = false) => attempt(() => M.setScreen(file, props), { redraw });
        fill(screenBox, h('legend', { text: 'The whole screen' }),
          ...SCREEN_FIELDS.slice(0, 1).map((f) => slider(f, fx[f.key], (v) => set({ [f.key]: v }))),
          colorInput('Colour of the dark', fx.ambient, (v) => set({ ambient: v })),
          colorInput('Tint colour', fx.tint || '#ff9a4a', (v) => set({ tint: v })),
          ...SCREEN_FIELDS.slice(1).map((f) => slider(f, fx[f.key], (v) => set({ [f.key]: v }))));
      }
      function drawList() {
        fill(list, h('h4', { text: 'Lights' }), ...file.lights.map((l, i) => h('div', { class: `layers-row${i === selected ? ' on' : ''}` },
          button({ text: l.name, class: 'small', aria: { label: `Edit light ${l.name}`, pressed: String(i === selected) },
            onClick: () => { selected = i; draw(); } }),
          h('span', { class: 'dim', text: `${l.follow ? `on every ${l.follow}` : 'at a place'}${l.hidden ? ', hidden' : ''}` }),
          button({ text: 'Copy', class: 'small ghost', aria: { label: `Copy ${l.name}` },
            onClick: () => attempt(() => { const r = M.duplicateLight(file, i); selected = r.index; return r.file; }) }),
          button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove ${l.name}` },
            onClick: () => attempt(() => { selected = Math.max(0, Math.min(selected, file.lights.length - 2)); return M.removeLight(file,
              i); }) }))));
      }
      function drawInspector() {
        const l = file.lights[selected];
        if (!l) { fill(inspector, h('p', { class: 'dim', text: 'No lights. Add one from the list above.' })); return; }
        const set = (props, redraw = false) => attempt(() => M.setLight(file, selected, props), { redraw });
        fill(inspector, h('h4', { text: `The light "${l.name}"` }),
          h('label', { class: 'state-line' }, 'Name ', h('input', { type: 'text', value: l.name, maxlength: '32', aria: { label: 'Light name' },
            on: { change: (e) => set({ name: e.target.value }, true) } })),
          h('label', { class: 'state-line' }, 'Sits on every thing of the kind ', h('input', { type: 'text', value: l.follow ?? '',
            placeholder: '(empty: a place in the world)',
            aria: { label: 'Kind of thing the light follows' }, on: { change: (e) => set({ follow: e.target.value.trim() }, true) } })),
          l.follow ? null : slider({ key: 'x', label: 'Across', min: 0, max: 480, step: 2,
            help: 'Where it is, in pixels from the left of the world' }, l.x ?? 0, (v) => set({ x: v })),
          l.follow ? null : slider({ key: 'y', label: 'Down', min: 0, max: 320, step: 2, help: 'Where it is, in pixels from the top of the world' },
            l.y ?? 0, (v) => set({ y: v })),
          colorInput('Colour', l.color ?? '#ffffff', (v) => set({ color: v })),
          ...LIGHT_FIELDS.map((f) => slider(f, l[f.key] ?? 0, (v) => set({ [f.key]: v }))),
          h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: !!l.hidden,
            on: { change: (e) => set({ hidden: e.target.checked }, true) } }), ' Hidden for now'));
      }
      function draw() {
        drawToolbar();
        const has = Boolean(file);
        body.hidden = !has;
        help.hidden = !has;
        issues.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(empty, h('h3', { text: problem ? 'The lights file needs fixing' : 'No lights yet' }), h('p', { text: problem || HINT }),
            problem ? null : h('div', { class: 'toolbar' }, ...[['night', 'A night with torches'], ['cave', 'A dark cave'], ['sunset',
              'A warm sunset']].map(([k, label]) => button({
              text: label, class: 'primary', onClick: () => { selected = 0; edit(M.STARTERS[k]()); flush(); } }))));
          return;
        }
        drawScreen();
        drawList();
        drawInspector();
        paint();
        const found = M.lightProblems(file);
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
