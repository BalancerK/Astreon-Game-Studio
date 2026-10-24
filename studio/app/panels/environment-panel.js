// The Environment panel: set the sky, the water and the ground of a 3D place with sliders and watch it drawn by the engine's own renderer. The settings are kept in
// environment.json (a plain text file in the project); a game made with the engine reads that file and gets the same sky, water and hills.
import { h, button, fill } from '../ui/dom.js';
import * as M from '../paint/environment-model.js';
import { EnvironmentPreview } from '../paint/environment-preview.js';

const SNIPPET = [
  '// A game made with the engine (@engine/render) can read the file and build the same place:',
  '//   const { sky, water, terrain } = JSON.parse(await (await fetch("environment.json")).text());',
  '//   const sun = sunDirection({ hour: sky.hour });                       // then createSky({ sun, turbidity: sky.turbidity, ... })',
  '//   const style = createWaterStyle({ clarity: water.clarity, opacity: water.opacity });',
  '// The ground is made from "seed", "hills" and "roughness" (see groundHeight in the studio\'s environment-model.js).',
].join('\n');

const PARTS = [['sky', 'The sky'], ['water', 'The water'], ['terrain', 'The ground']];

export function environmentPanel(studio) {
  return {
    id: 'environment',
    title: 'Environment',
    icon: 'play',
    create() {
      let world = M.parseWorld('').world;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let timer = 0;
      let clock = 0;
      const preview = new EnvironmentPreview();
      const note = h('p', { class: 'lab-explain', role: 'status' });
      const stage = h('div', { class: 'env-stage' });
      const controls = h('div', { class: 'lab-controls' });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }),
        h('pre', { class: 'learn-code', text: SNIPPET }));
      const el = h('div', { class: 'panel-body art lab', 'aria-label': 'Environment' }, toolbar, stage, note, controls, help);

      function load() {
        const raw = studio.project?.has(M.FILE) ? studio.project.readText(M.FILE) : '';
        lastWritten = raw ?? '';
        const r = M.parseWorld(raw);
        world = r.world;
        problem = r.problems.join(' ');
        drawControls();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project) return;
        const out = M.serializeWorld(world);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(M.FILE, out);
        studio.emit('files');
      }
      const edit = (next, redraw = false) => {
        world = next;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 250);
        if (redraw) drawControls(); else note.textContent = M.describeWorld(world);
      };
      const attempt = (fn, redraw) => {
        try { edit(fn(), redraw); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      };

      function slider(part, f) {
        const out = h('output', { text: String(Math.round(world[part][f.key] * 100) / 100) });
        const input = h('input', { type: 'range', min: String(f.min), max: String(f.max), step: String(f.step), value: String(world[part][f.key]),
          aria: { label: f.label } });
        input.addEventListener('input', () => {
          out.textContent = String(Math.round(Number(input.value) * 100) / 100);
          attempt(() => M.setWorld(world, part, { [f.key]: Number(input.value) }));
        });
        return h('label', { class: 'sound-slider', title: f.help }, h('span', { text: f.label }), input, out);
      }
      const colour = (part, key, label) => h('label', { class: 'sound-slider' }, h('span', { text: label }),
        h('input', { type: 'color', value: world[part][key], aria: { label },
          on: { input: (e) => attempt(() => M.setWorld(world, part, { [key]: e.target.value })) } }));
      const check = (part, key, label) => h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: world[part][key],
        on: { change: (e) => attempt(() => M.setWorld(world, part, { [key]: e.target.checked }), true) } }), ` ${label}`);

      function drawControls() {
        fill(toolbar, h('select', { aria: { label: 'Start from' }, on: { change: (e) => {
          const make = M.STARTERS[e.target.value];
          e.target.value = '';
          if (make) edit(make(), true);
        } } }, h('option', { value: '', text: 'Start from…' }),
        ...Object.keys(M.STARTERS).map((k) => h('option', { value: k, text: k[0].toUpperCase() + k.slice(1) }))),
        button({ text: 'Reload the file', class: 'small ghost', label: 'Reload the file', onClick: load }));
        note.textContent = problem || M.describeWorld(world);
        const w = world;
        fill(controls,
          h('fieldset', { class: 'sound-layer' }, h('legend', { text: PARTS[0][1] }),
            ...M.FIELDS.sky.map((f) => slider('sky', f)), check('sky', 'stars', 'Stars at night')),
          h('fieldset', { class: 'sound-layer' }, h('legend', { text: PARTS[1][1] }), check('water', 'on', 'There is water'),
            ...(w.water.on ? [...M.FIELDS.water.map((f) => slider('water', f)),
              colour('water', 'shallow', 'Shallow colour'), colour('water', 'deep', 'Deep colour')] : [])),
          h('fieldset', { class: 'sound-layer' }, h('legend', { text: PARTS[2][1] }),
            ...M.FIELDS.terrain.map((f) => slider('terrain', f)), colour('terrain', 'color', 'Ground colour')));
      }

      // ---- the picture: drag to turn it, scroll to come closer ----
      let dragging = null;
      stage.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY }; stage.setPointerCapture?.(e.pointerId); });
      stage.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        preview.orbit(-(e.clientX - dragging.x) * 0.008, (e.clientY - dragging.y) * 0.006);
        dragging = { x: e.clientX, y: e.clientY };
      });
      stage.addEventListener('pointerup', () => { dragging = null; });
      stage.addEventListener('wheel', (e) => { e.preventDefault(); preview.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

      function frame() {
        if (!el.isConnected || !el.offsetParent || !preview.renderer) return;
        clock += 1 / 30;
        try { preview.draw(world, clock); } catch (error) { preview.error = String(error?.message ?? error); }
      }
      (async () => {
        const canvas = await preview.start();
        if (canvas) {
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', 'The environment, drawn by the engine. Drag to turn it round; scroll to come closer.');
          canvas.style.cssText = 'width:100%;height:auto;display:block;touch-action:none;cursor:grab';
          stage.append(canvas);
          timer = setInterval(frame, 33);
        } else {
          const why = `The picture needs WebGPU or WebGL2, and this browser has neither (${preview.error}). You can still change the settings.`;
          stage.append(h('p', { class: 'dim', text: why }));
        }
      })();

      el.environment = { preview, frame };                            // so a test can draw a frame and read it in the same moment
      studio.on('files', () => { if (studio.project?.has(M.FILE) && studio.project.readText(M.FILE) !== lastWritten) load(); });
      load();
      return {
        el, focus: () => controls.querySelector('input')?.focus(),
        dispose: () => { clearInterval(timer); flush(); preview.destroy(); },
        expose: { get world() { return world; }, get preview() { return preview; } },
      };
    },
  };
}
