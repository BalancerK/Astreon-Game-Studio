// The Clips panel: numbers that change over time, drawn as curves. A clip has a length and a track for each number it changes (x, y, alpha, w, h...); a track is a
// row of keys (dots) you can drag: left and right is when, up and down is the value. Click an empty place to add a key, pick a key to set how it moves on to the next
// (smoothly, slowly in, slowly out, or a jump). Press Play to watch a little square follow the clip. Kept in `src/clips.js`; the game plays it with
// `stepClip(thing, clips.bob, dt)` from @engine/arcade.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/clip-model.js';
import { clipTime } from '../../../packages/arcade/src/clips.js';

const FILE = 'src/clips.js';
const SVG = 'http://www.w3.org/2000/svg';
const LANE = { w: 560, h: 84, left: 10, right: 10, top: 8, bottom: 8 };
const STAGE = { w: 220, h: 140 };
const HINT = 'A clip changes numbers over time: a coin that bobs, a door that slides, a title that fades in. '
  + 'Pick a ready-made one and change it.';

const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
};
const words = (el, text) => { el.textContent = text; return el; };

export function clipPanel(studio) {
  return {
    id: 'clips',
    title: 'Clips',
    icon: 'edit',
    create() {
      let clips = {};
      let current = null;
      let selected = null;                           // { field, index }
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let drag = null;
      let playing = false;
      let time = 0;
      let timer = 0;

      const picker = h('select', { class: 'art-select', aria: { label: 'Clip to edit' },
        on: { change: () => { current = picker.value; selected = null; time = 0; draw(); } } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const lanes = h('div', { class: 'clip-lanes' });
      const stage = h('canvas', { width: STAGE.w, height: STAGE.h, class: 'clip-stage', role: 'img',
        aria: { label: 'A square following the clip' } });
      const inspector = h('div', { class: 'clip-inspector' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'clip-body' }, lanes, h('div', { class: 'clip-side' }, stage, inspector));
      const el = h('div', { class: 'panel-body art clips', 'aria-label': 'Clips' }, toolbar, body, issues, help, empty);
      const clip = () => clips[current];

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { clips = raw ? M.parseClips(raw) : {}; } catch (error) { clips = {}; problem = error.message; }
        if (!(current in clips)) current = Object.keys(clips)[0] ?? null;
        selected = null;
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(clips).length) return;
        const out = M.serializeClips(clips);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { redraw = true } = {}) {
        if (!current || next === clip()) return;
        clips = { ...clips, [current]: next };
        save();
        if (redraw) draw(); else { drawLanes(); paintStage(); }
      }

      // ---- the little square ----
      function paintStage() {
        const c = clip();
        if (!c) return;
        const v = M.sampleClip(c, time);
        const first = (f) => c.tracks[f]?.[0]?.[1] ?? 0;
        const g = stage.getContext('2d');
        g.clearRect(0, 0, stage.width, stage.height);
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, stage.width, stage.height);
        const w = v.w ?? v.scale ?? 32;
        const hgt = v.h ?? v.scale ?? 32;
        const x = STAGE.w / 2 - w / 2 + (v.x !== undefined ? v.x - first('x') : 0);
        const y = STAGE.h / 2 - hgt / 2 + (v.y !== undefined ? v.y - first('y') : 0);
        g.globalAlpha = Math.max(0, Math.min(1, v.alpha ?? 1));
        g.fillStyle = '#8b8bff';
        g.fillRect(x, y, w, hgt);
        g.globalAlpha = 1;
        g.fillStyle = '#9aa3b5';
        g.font = '11px system-ui, sans-serif';
        g.fillText(`${time.toFixed(2)} s`, 6, 14);
      }
      function tick() {
        if (!playing || !el.isConnected || !el.offsetParent || !clip()) return;
        time += 1 / 30;
        if (!clip().loop && time >= clip().duration) { time = clip().duration; playing = false; drawToolbar(); }
        for (const line of lanes.querySelectorAll('.lane-playhead')) {
          const x = xOf(clipTime(clip(), time));
          line.setAttribute('x1', x);
          line.setAttribute('x2', x);
        }
        paintStage();
      }

      // ---- the lanes ----
      const xOf = (t) => LANE.left + (t / clip().duration) * (LANE.w - LANE.left - LANE.right);
      const tOf = (x) => ((x - LANE.left) / (LANE.w - LANE.left - LANE.right)) * clip().duration;
      const yOf = (v, [lo, hi]) => LANE.top + (1 - (v - lo) / (hi - lo)) * (LANE.h - LANE.top - LANE.bottom);
      const vOf = (y, [lo, hi]) => lo + (1 - (y - LANE.top) / (LANE.h - LANE.top - LANE.bottom)) * (hi - lo);

      function drawLanes() {
        const c = clip();
        const rows = Object.entries(c.tracks).map(([field, keys]) => {
          const range = M.rangeOf(keys);
          const curve = [];
          for (let i = 0; i <= 120; i++) {
            const t = (i / 120) * c.duration;
            curve.push(`${i ? 'L' : 'M'}${xOf(t).toFixed(1)},${yOf(M.sampleTrack(keys, t), range).toFixed(1)}`);
          }
          const dots = keys.map(([t, v], i) => svg('circle', {
            cx: xOf(t), cy: yOf(v, range), r: selected?.field === field && selected.index === i ? 7 : 5, 'data-key': `${field}:${i}`, tabindex: '0',
              role: 'button',
            class: `key${selected?.field === field && selected.index === i ? ' on' : ''}`,
              'aria-label': `${field} key ${i + 1}: ${t} seconds, value ${v}`,
          }));
          const lane = svg('svg', { viewBox: `0 0 ${LANE.w} ${LANE.h}`, width: LANE.w, height: LANE.h, class: 'clip-lane', 'data-lane': field,
            role: 'group', 'aria-label': `Track ${field}` },
            svg('rect', { x: 0, y: 0, width: LANE.w, height: LANE.h, class: 'lane-bg' }),
            svg('path', { d: curve.join(' '), class: 'lane-curve' }),
            svg('line', { x1: xOf(clipTime(c, time)), x2: xOf(clipTime(c, time)), y1: 0, y2: LANE.h, class: 'lane-playhead' }),
            ...dots,
            words(svg('text', { x: LANE.w - 6, y: 12, 'text-anchor': 'end', class: 'lane-range' }),
              `${(+range[1].toFixed(1))} … ${(+range[0].toFixed(1))}`));
          return h('div', { class: 'clip-row' },
            h('div', { class: 'clip-name' }, h('code', { text: field }),
              button({ text: 'Rename', class: 'small ghost', onClick: () => renameTrack(field) }),
              button({ text: '×', class: 'small ghost', title: `Remove ${field}`, aria: { label: `Remove track ${field}` },
                onClick: () => removeTrack(field) })),
            lane);
        });
        fill(lanes, ...rows);
      }

      const spot = (event, lane) => {
        const box = lane.getBoundingClientRect();
        return [((event.clientX - box.left) / box.width) * LANE.w, ((event.clientY - box.top) / box.height) * LANE.h];
      };
      lanes.addEventListener('pointerdown', (event) => {
        const lane = event.target.closest?.('[data-lane]');
        if (!lane) return;
        const field = lane.dataset.lane;
        const key = event.target.closest?.('[data-key]');
        const range = M.rangeOf(clip().tracks[field]);
        const [x, y] = spot(event, lane);
        if (key) {
          selected = { field, index: Number(key.dataset.key.split(':')[1]) };
        } else if (y < 0 || event.shiftKey) {
          time = Math.max(0, Math.min(clip().duration, tOf(x)));
          drawLanes();
          paintStage();
          return;
        } else {
          try {
            const made = M.addKey(clip(), field, tOf(x), vOf(y, range));
            selected = { field, index: made.index };
            clips = { ...clips, [current]: made.clip };
            save();
          } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); return; }
        }
        drag = { field, range };
        lanes.setPointerCapture?.(event.pointerId);                // the lane is drawn again as the key moves, so the lanes' box holds the mouse
        drawLanes();
        drawInspector();
      });
      lanes.addEventListener('pointermove', (event) => {
        if (!drag || !selected) return;
        const lane = lanes.querySelector(`[data-lane="${drag.field}"]`);
        if (!lane) return;
        const [x, y] = spot(event, lane);
        const moved = M.moveKey(clip(), drag.field, selected.index, tOf(x), vOf(y, drag.range));
        selected = { field: drag.field, index: moved.index };
        clips = { ...clips, [current]: moved.clip };
        save();
        drawLanes();
        paintStage();
        drawInspector();
      });
      const endDrag = () => { drag = null; };
      lanes.addEventListener('pointerup', endDrag);
      lanes.addEventListener('pointercancel', endDrag);
      lanes.addEventListener('keydown', (event) => {
        const key = event.target.closest?.('[data-key]');
        if (!key) return;
        const [field, index] = [key.dataset.key.split(':')[0], Number(key.dataset.key.split(':')[1])];
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selected = { field, index }; drawLanes(); drawInspector(); }
        if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); removeSelectedKey(field, index); }
      });

      // ---- the inspector ----
      function drawInspector() {
        const c = clip();
        if (!c) { fill(inspector); return; }
        if (!selected || !c.tracks[selected.field]?.[selected.index]) {
          fill(inspector, h('p', { class: 'dim',
            text: 'Click a track to add a key. Drag a key to change when and how much. Pick a key to set how it moves on.' }));
          return;
        }
        const { field, index } = selected;
        const [t, v, how] = c.tracks[field][index];
        const number = (label, value, step, apply) => h('label', { class: 'state-line' }, `${label} `, h('input', {
          type: 'number', step: String(step), value: String(value), aria: { label },
            on: { change: (e) => { if (e.target.value !== '') apply(Number(e.target.value)); } },
        }));
        const last = index === c.tracks[field].length - 1;
        fill(inspector, h('h4', {}, 'Key of ', h('code', { text: field })),
          number('At (s)', t, 0.05, (n) => moveSelected(n, v)),
          number('Value', v, 0.5, (n) => moveSelected(t, n)),
          last ? h('p', { class: 'dim', text: 'The last key has nothing to move on to.' }) : h('label', { class: 'state-line' }, 'Moves on ',
            h('select', {
            aria: { label: 'How this key moves on to the next' }, on: { change: (e) => edit(M.setEase(c, field, index, e.target.value)) },
          }, ...M.EASES.map((e) => h('option', { value: e, text: EASE_WORDS[e], selected: (how ?? 'linear') === e })))),
          button({ text: 'Remove this key', class: 'small ghost', onClick: () => removeSelectedKey(field, index) }));
      }
      function moveSelected(t, v) {
        const moved = M.moveKey(clip(), selected.field, selected.index, t, v);
        selected = { field: selected.field, index: moved.index };
        edit(moved.clip);
      }
      function removeSelectedKey(field, index) {
        try { selected = null; edit(M.removeKey(clip(), field, index)); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      // ---- the parts ----
      const EASE_WORDS = { linear: 'steadily', in: 'slowly at first', out: 'slowing down', inout: 'smoothly', step: 'with a jump' };

      function drawToolbar() {
        const names = Object.keys(clips);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = !names.length;
        const presets = h('select', { aria: { label: 'Start a new clip from' },
          on: { change: (e) => { if (e.target.value) newClip(e.target.value); } } },
          h('option', { value: '', text: 'New clip from…' }), ...Object.keys(M.PRESETS).map((n) => h('option', { value: n, text: n })), h('option',
            { value: '_blank', text: 'a blank clip' }));
        const c = clip();
        fill(toolbar, picker, presets,
          c ? [button({ text: playing ? 'Pause' : 'Play', icon: playing ? 'stop' : 'play', class: `small${playing ? '' : ' primary'}`,
            onClick: () => {
            if (!playing && !c.loop && time >= c.duration) time = 0;
            playing = !playing;
            drawToolbar();
          } }),
          h('label', { class: 'art-inline' }, 'Length ', h('input', {
            type: 'number', min: '0.05', max: String(M.CLIP_LIMITS.duration), step: '0.1', value: String(c.duration),
              aria: { label: 'Length in seconds' },
            on: { change: (e) => edit(M.setDuration(c, Number(e.target.value) || 1)) },
          }), ' s'),
          h('label', { class: 'art-inline' }, h('input', { type: 'checkbox', checked: Boolean(c.loop), on: { change: (e) => edit(M.setLoop(c,
            e.target.checked)) } }), ' Repeat'),
          button({ text: 'Add a track', class: 'small', onClick: addTrack }),
          button({ text: 'Rename', class: 'small ghost', onClick: renameClip }),
          button({ text: 'Delete', class: 'small ghost', onClick: removeClip })] : null);
      }

      function draw() {
        drawToolbar();
        const has = Boolean(clip());
        body.hidden = !has;
        help.hidden = !has;
        issues.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(empty, h('h3', { text: problem ? 'The clips file needs fixing' : 'No clips yet' }),
            h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Make a bobbing clip', class: 'primary', onClick: () => newClip('bob') }));
          return;
        }
        drawLanes();
        drawInspector();
        paintStage();
        const found = M.clipProblems(clip());
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
        const field = Object.keys(clip().tracks)[0];
        help.querySelector('pre').textContent = `import clips from './clips.js';\nimport { stepClip } from '@engine/arcade';\n\n`
          + `// every tick: the clip sets ${Object.keys(clip().tracks).join(', ')} on the thing\n`
          + `stepClip(thing, clips.${current}, dt);\n\n`
          + `// a different clip on the same thing starts from its beginning: stepClip(thing, clips.other, dt, 'other')\n`
          + `// thing.${field} is now ${(+(M.sampleClip(clip(), 0)[field] ?? 0).toFixed(2))} at the start`;
      }

      async function newClip(from) {
        const name = await promptText({
          title: 'Name the clip', label: 'Name (for example bob or fade-in)', value: M.freeName(clips, from === '_blank' ? 'clip' : from),
            confirmLabel: 'Make it',
          validate: (v) => M.nameProblem(v.trim(), (n) => n in clips),
        });
        if (name === undefined) { draw(); return; }
        clips = { ...clips, [name.trim()]: from === '_blank' ? M.newClip() : M.PRESETS[from]() };
        current = name.trim();
        selected = null;
        time = 0;
        flush();
        draw();
      }
      async function renameClip() {
        const name = await promptText({
          title: 'Rename the clip', label: 'New name', value: current, confirmLabel: 'Rename', validate: (v) => M.nameProblem(v.trim(),
            (n) => n !== current && n in clips),
        });
        if (name === undefined || name.trim() === current) return;
        clips = Object.fromEntries(Object.entries(clips).map(([k, v]) => [k === current ? name.trim() : k, v]));
        current = name.trim();
        flush();
        draw();
      }
      function removeClip() {
        const next = { ...clips };
        delete next[current];
        clips = next;
        current = Object.keys(clips)[0] ?? null;
        selected = null;
        flush();
        draw();
      }
      async function addTrack() {
        const field = await promptText({
          title: 'Add a track', label: 'The number it changes (x, y, alpha, w, h...)', value: 'alpha', confirmLabel: 'Add it',
            validate: (v) => M.fieldProblem(clip(), v.trim()),
        });
        if (field !== undefined) edit(M.addTrack(clip(), field.trim(), field.trim() === 'alpha' ? 1 : 0));
      }
      async function renameTrack(from) {
        const to = await promptText({
          title: 'Rename the track', label: 'New name', value: from, confirmLabel: 'Rename',
            validate: (v) => (v.trim() === from ? null : M.fieldProblem(clip(), v.trim())),
        });
        if (to === undefined || to.trim() === from) return;
        if (selected?.field === from) selected = { ...selected, field: to.trim() };
        edit(M.renameTrack(clip(), from, to.trim()));
      }
      function removeTrack(field) {
        try { selected = null; edit(M.removeTrack(clip(), field)); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      timer = setInterval(tick, 1000 / 30);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(clips).length) load(); });
      load();
      return { el, focus: () => picker.focus(), onShow: load, dispose: () => { clearInterval(timer); flush(); } };
    },
  };
}
