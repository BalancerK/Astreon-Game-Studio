// The Particles panel: make fire, smoke, sparkles, rain and confetti by moving sliders, and watch the effect as you go. An effect is a recipe (colors, speed, direction,
// how long, how big, gravity) kept in `src/particles.js`. Click the preview to throw a burst from that spot; an effect that burns (a campfire) runs by itself and follows
// the mouse. A game plays it with `emit(game, particles.explosion, x, y)` once, or `stream(game, particles.fire, x, y, dt)` every tick while it burns.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/particle-model.js';
import { newGame, all } from '../../../packages/arcade/src/things.js';
import { emit, stream } from '../../../packages/arcade/src/particles.js';
import { effects } from '../../../packages/arcade/src/effects.js';
import { drawThings } from '../../../packages/arcade/src/draw.js';

const FILE = 'src/particles.js';
const VIEW = { w: 480, h: 280 };
const DT = 1 / 60;

export function particlePanel(studio) {
  return {
    id: 'particles',
    title: 'Particles',
    icon: 'edit',
    create() {
      let effectsByName = {};
      let current = null;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let seed = 1;
      let game = newGame();
      let point = { x: VIEW.w / 2, y: VIEW.h * 0.6 };
      let timer = 0;
      let sinceBurst = 0;
      let repeat = true;
      let clock = 0;

      const picker = h('select', {
        class: 'art-select', aria: { label: 'Effect to edit' },
        on: { change: () => { current = picker.value; restart(); draw(); } },
      });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const view = h('canvas', {
        width: VIEW.w, height: VIEW.h, class: 'particle-view', tabindex: '0', aria: { label: 'Preview of the effect. Click to throw a burst.' },
      });
      const counter = h('div', { class: 'dim particle-count', role: 'status' });
      const controls = h('div', { class: 'particle-controls' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'particle-body' }, h('div', { class: 'particle-left' }, view, counter), controls);
      const el = h('div', { class: 'panel-body art particles', 'aria-label': 'Particle effects' }, toolbar, body, help, empty);
      const effect = () => effectsByName[current];

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { effectsByName = raw ? M.parseParticles(raw) : {}; } catch (error) { effectsByName = {}; problem = error.message; }
        if (!(current in effectsByName)) current = Object.keys(effectsByName)[0] ?? null;
        restart();
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(effectsByName).length) return;
        const out = M.serializeParticles(effectsByName);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { redraw = false } = {}) {
        if (!current || next === effect()) return;
        effectsByName = { ...effectsByName, [current]: next };
        save();
        if (redraw) draw();
        else drawNotes();
      }

      // ---- the preview ----
      function restart() {
        game = newGame();
        sinceBurst = 99;
      }
      function burst(x = point.x, y = point.y) {
        if (effect()) emit(game, effect(), x, y);
      }
      function tick() {
        if (!el.isConnected || !el.offsetParent || !effect()) return;
        clock += DT;
        const e = effect();
        if (e.use === 'stream') stream(game, e, point.x, point.y, DT);
        else if (repeat) {
          sinceBurst += DT;
          if (sinceBurst >= Math.max(1, e.life[1] + 0.3)) { sinceBurst = 0; burst(); }
        }
        effects(game, DT);
        paint();
      }
      function paint() {
        const g = view.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, VIEW.w, VIEW.h);
        g.strokeStyle = '#2a3140';
        g.beginPath();
        g.moveTo(point.x - 8, point.y);
        g.lineTo(point.x + 8, point.y);
        g.moveTo(point.x, point.y - 8);
        g.lineTo(point.x, point.y + 8);
        g.stroke();
        drawThings(g, game, {});
        counter.textContent = `${all(game, 'spark').length} particles`;
      }
      const spot = (event) => {
        const box = view.getBoundingClientRect();
        return { x: ((event.clientX - box.left) / box.width) * VIEW.w, y: ((event.clientY - box.top) / box.height) * VIEW.h };
      };
      view.addEventListener('pointerdown', (event) => {
        point = spot(event);
        if (effect()?.use !== 'stream') { burst(); sinceBurst = 0; }
      });
      view.addEventListener('pointermove', (event) => { if (effect()?.use === 'stream' || event.buttons) point = spot(event); });

      // ---- the controls ----
      function slider(f, value, onInput) {
        const out = h('output', { text: String(Math.round(value * 100) / 100) });
        const input = h('input', {
          type: 'range', min: String(f.min), max: String(f.max), step: String(f.step), value: String(value),
            aria: { label: f.names ? `${f.label}, ${f.names[0]}` : f.label },
        });
        input.addEventListener('input',
          () => { out.textContent = String(Math.round(Number(input.value) * 100) / 100); onInput(Number(input.value)); });
        return [input, out];
      }
      function control(f) {
        const e = effect();
        if (!f.pair) {
          return h('label', { class: 'sound-slider', title: f.help }, h('span', { text: f.label }), ...slider(f, e[f.key],
            (v) => edit(M.setValue(effect(), f.key, v))));
        }
        const row = (i) => h('label', { class: 'sound-slider' }, h('span', { class: 'dim', text: f.names[i] }), ...slider(
          { ...f, label: f.label }, e[f.key][i], (v) => edit(M.setPair(effect(), f.key, i, v), { redraw: false })));
        return h('fieldset', { class: 'sound-layer' }, h('legend', { text: f.label }), row(0), row(1));
      }
      function drawControls() {
        const e = effect();
        fill(controls,
          h('label', { class: 'state-line' }, 'A game plays it ', h('select', {
            aria: { label: 'How a game plays this effect' }, on: { change: (ev) => { edit(M.setUse(effect(), ev.target.value),
              { redraw: true }); restart(); } },
          }, h('option', { value: 'emit', text: 'once, as a burst', selected: e.use === 'emit' }), h('option', { value: 'stream',
            text: 'all the time, as a stream', selected: e.use === 'stream' }))),
          ...M.FIELDS.filter((f) => f.key !== 'count' || e.use === 'emit').filter((f) => f.key !== 'rate' || e.use === 'stream').map(control),
          h('label', { class: 'state-line' }, 'Shape ', h('select', { aria: { label: 'Shape' }, on: { change: (ev) => edit(M.setShape(effect(),
            ev.target.value)) } },
            ...['square', 'circle'].map((s) => h('option', { value: s, text: s, selected: e.shape === s }))),
          h('label', { class: 'art-inline' }, h('input', { type: 'checkbox', checked: e.fade, on: { change: (ev) => edit(M.setFade(effect(),
            ev.target.checked)) } }), ' Fade out')),
          h('div', { class: 'state-line' }, 'Colors ', ...e.colors.map((c, i) => h('span', { class: 'particle-color' }, h('input', {
            type: 'color', value: c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c.slice(0, 7),
              aria: { label: `Color ${i + 1}` },
            on: { input: (ev) => edit(M.setColor(effect(), i, ev.target.value)) },
          }), button({
            text: '×', class: 'small ghost', disabled: e.colors.length <= 1, aria: { label: `Remove color ${i + 1}` },
            onClick: () => edit(M.removeColor(effect(), i), { redraw: true }),
          }))), button({
            text: 'Add a color', class: 'small', disabled: e.colors.length >= 6, onClick: () => edit(M.addColor(effect(), '#ffffff'),
              { redraw: true }),
          })));
      }
      function drawNotes() {
        if (!effect()) return;
        const e = effect();
        const call = e.use === 'stream'
          ? `stream(game, particles.${current}, x, y, dt);   // every tick while it burns`
          : `emit(game, particles.${current}, x, y);   // once, when it happens`;
        help.querySelector('pre').textContent = `import particles from './particles.js';\nimport { ${e.use}, effects } from '@engine/arcade';\n\n`
          + `${call}\neffects(game, dt);   // once a tick: moves, fades and removes the particles`;
      }

      // ---- the parts ----
      function draw() {
        const names = Object.keys(effectsByName);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = !names.length;
        const presets = h('select', {
          aria: { label: 'Start a new effect from' }, on: { change: (ev) => { if (ev.target.value) newEffect(ev.target.value); } },
        }, h('option', { value: '', text: 'New effect from…' }), ...Object.keys(M.PRESETS).map((n) => h('option', { value: n, text: n })),
        h('option', { value: '_blank', text: 'a blank effect' }));
        const has = Boolean(effect());
        fill(toolbar, picker, presets, has ? [
          button({ text: 'Burst', icon: 'play', class: 'small primary', onClick: () => burst() }),
          h('label', { class: 'art-inline' }, h('input', { type: 'checkbox', checked: repeat,
            on: { change: (ev) => { repeat = ev.target.checked; } } }), ' Repeat'),
          button({
            text: 'Surprise me', class: 'small', title: 'A random variation of this effect',
            onClick: () => { edit(M.mutate(effect(), seed++, 0.6), { redraw: true }); restart(); },
          }),
          button({ text: 'Rename', class: 'small ghost', onClick: rename }),
          button({ text: 'Delete', class: 'small ghost', onClick: remove })] : null);
        body.hidden = !has;
        help.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(empty, h('h3', { text: problem ? 'The effects file needs fixing' : 'No effects yet' }),
            h('p', { text: problem || 'Make fire, smoke, sparkles or confetti with sliders. Start from a ready-made effect and change it.' }),
            problem ? null : button({ text: 'Make a fire', class: 'primary', onClick: () => newEffect('fire') }));
          return;
        }
        drawControls();
        drawNotes();
        paint();
      }

      async function newEffect(from) {
        const name = await promptText({
          title: 'Name the effect', label: 'Name (for example fire or explosion)', value: M.freeName(effectsByName,
            from === '_blank' ? 'effect' : from),
          confirmLabel: 'Make it', validate: (v) => M.nameProblem(v.trim(), (n) => n in effectsByName),
        });
        if (name === undefined) { draw(); return; }
        effectsByName = { ...effectsByName, [name.trim()]: from === '_blank' ? M.newEffect() : M.preset(from) };
        current = name.trim();
        flush();
        restart();
        draw();
      }
      async function rename() {
        const name = await promptText({
          title: 'Rename the effect', label: 'New name', value: current, confirmLabel: 'Rename',
          validate: (v) => M.nameProblem(v.trim(), (n) => n !== current && n in effectsByName),
        });
        if (name === undefined || name.trim() === current) return;
        effectsByName = Object.fromEntries(Object.entries(effectsByName).map(([k, v]) => [k === current ? name.trim() : k, v]));
        current = name.trim();
        flush();
        draw();
      }
      function remove() {
        const next = { ...effectsByName };
        delete next[current];
        effectsByName = next;
        current = Object.keys(effectsByName)[0] ?? null;
        flush();
        restart();
        draw();
      }

      timer = setInterval(tick, 1000 / 60);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(effectsByName).length) load(); });
      load();
      void clock;
      return { el, focus: () => picker.focus(), onShow: load, dispose: () => { clearInterval(timer); flush(); } };
    },
  };
}
