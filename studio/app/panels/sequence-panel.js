// The Sequences panel: cutscenes on one timeline. Each row is the number of a thing (the hero's x, the camera's y, the screen's fade to black) as dots you can drag left and right to
// change when they happen; click an empty place in a row to add a dot. The bottom row holds events: a sound, a line of the story, a shake, a message to your game. Press Play to
// watch the little stage, or drag along the ruler. Kept in `src/sequences.js`; the game plays it with `playSequence` and `stepSequence` from @engine/arcade.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/sequence-model.js';
import { sampleTrack } from '../../../packages/arcade/src/clips.js';
import { parseSounds } from '../paint/sound-model.js';
import { parseSongs } from '../paint/music-model.js';
import { parseStoryFile, splitNodes } from '../paint/story-model.js';

const FILE = 'src/sequences.js';
const SVG = 'http://www.w3.org/2000/svg';
const T = { w: 600, left: 130, right: 16, ruler: 28, lane: 36 };
const STAGE = { w: 320, h: 200, world: { w: 480, h: 320 } };
const HINT = 'A sequence is a cutscene: the hero walks to the door, the camera slides across, the screen fades, a sound plays and someone speaks. '
  + 'Pick a ready-made one and change it.';
const SNIPPET = [
  "import sequences from './sequences.js';",
  "import { playSequence, stepSequence, sequenceActive, drawSequence } from '@engine/arcade';",
  '',
  "// when the cutscene starts:   playSequence(game, sequences.intro, 'intro');",
  '// in update(game, keys, dt):   if (sequenceActive(game)) stepSequence(game, sequences.intro, dt, { skip: keys.has("Escape") });',
  '//                              (leave the player and the camera alone while it is on)',
  '// in render(game, g):          drawSequence(g, game);     // the fade and the black bars, over the picture',
  '// what it asked the game to do: for (const c of takeSequenceCommands(game)) if (c.name === "open-door") ...',
].join('\n');

const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
};
const hue = (text) => [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function sequencePanel(studio) {
  return {
    id: 'sequences',
    title: 'Sequences',
    icon: 'edit',
    create() {
      let table = {};
      let current = null;
      let sel = null;                              // { type: 'key', target, field, index } or { type: 'event', index }
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let drag = null;
      let keepFocus = false;                       // after a key press redraws the timeline, the dot that was selected gets the focus back
      let playing = false;
      let time = 0;
      let timer = 0;

      const picker = h('select', { class: 'art-select', aria: { label: 'Sequence to edit' },
        on: { change: () => { current = picker.value; sel = null; time = 0; draw(); } } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const timeline = h('div', { class: 'seq-timeline' });
      const stage = h('canvas', { width: STAGE.w, height: STAGE.h, class: 'clip-stage', role: 'img',
        aria: { label: 'The cutscene as a little stage' } });
      const log = h('ol', { class: 'seq-log', 'aria-label': 'What has happened so far' });
      const inspector = h('div', { class: 'clip-inspector' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code',
        text: SNIPPET }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'clip-body' }, timeline, h('div', { class: 'clip-side' }, stage, log, inspector));
      const el = h('div', { class: 'panel-body art sequences', 'aria-label': 'Sequences' }, toolbar, body, issues, help, empty);
      const seq = () => table[current];

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { table = raw ? M.parseSequences(raw) : {}; } catch (error) { table = {}; problem = error.message; }
        if (!(current in table)) current = Object.keys(table)[0] ?? null;
        sel = null;
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(table).length) return;
        const out = M.serializeSequences(table);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { redraw = true } = {}) {
        if (!current || next === seq()) return;
        table = { ...table, [current]: next };
        save();
        if (redraw) draw(); else { drawTimeline(); paintStage(); }
      }
      const attempt = (fn, o) => { try { fn(); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); draw(); } return o; };

      // ---- the timeline ----
      const xOf = (t) => T.left + (t / seq().duration) * (T.w - T.left - T.right);
      const timeAt = (x) => Math.max(0, Math.min(seq().duration, ((x - T.left) / (T.w - T.left - T.right)) * seq().duration));
      const lanes = () => Object.entries(seq().tracks).flatMap(([target, fields]) => Object.keys(fields).map((field) => ({ target, field })));
      const svgX = (event) => { const r = timeline.querySelector('svg').getBoundingClientRect(); return ((event.clientX - r.left) / r.width) * T.w; };
      const select = (next) => { sel = next; drawInspector(); drawTimeline(); };

      function drawTimeline() {
        const s = seq();
        if (!s) return;
        const rows = lanes();
        const height = T.ruler + (rows.length + 1) * T.lane + 6;
        const root = svg('svg', { viewBox: `0 0 ${T.w} ${height}`, class: 'seq-svg', role: 'group', 'aria-label': 'Timeline' });
        const tick = Math.max(0.5, Math.ceil(s.duration / 12));
        for (let t = 0; t <= s.duration + 1e-6; t += tick) {
          root.append(svg('line', { x1: xOf(t), x2: xOf(t), y1: T.ruler - 6, y2: height, class: 'seq-grid' }),
            Object.assign(svg('text', { x: xOf(t) + 3, y: 16, class: 'seq-tick' }), { textContent: `${Math.round(t * 10) / 10}s` }));
        }
        const ruler = svg('rect', { x: T.left, y: 0, width: T.w - T.left, height: T.ruler, class: 'seq-ruler', 'aria-hidden': 'true' });
        ruler.addEventListener('pointerdown',
          (event) => {
            drag = { type: 'scrub' };
            ruler.setPointerCapture?.(event.pointerId);
            time = timeAt(svgX(event));
            playing = false;
            paintStage();
            drawTimeline();
          });
        root.append(ruler);
        rows.forEach(({ target, field }, i) => {
          const y = T.ruler + i * T.lane;
          const keys = s.tracks[target][field];
          root.append(svg('rect', { x: 0, y, width: T.w, height: T.lane, class: i % 2 ? 'seq-lane alt' : 'seq-lane' }),
            Object.assign(svg('text', { x: 6, y: y + T.lane / 2 + 4, class: 'seq-name' }), { textContent: `${target}.${field}` }));
          const hit = svg('rect', { x: T.left, y, width: T.w - T.left - T.right, height: T.lane, class: 'seq-hit', 'aria-hidden': 'true' });
          hit.addEventListener('pointerdown', (event) => {
            const t = timeAt(svgX(event));
            attempt(() => { const r = M.addKey(s, target, field, t, sampleTrack(keys, t)); edit(r.seq, { redraw: false }); select({ type: 'key',
              target, field, index: r.index }); });
          });
          root.append(hit);
          for (let k = 0; k < keys.length; k++) root.append(keyDot(target, field, k, keys[k], y));
        });
        const ey = T.ruler + rows.length * T.lane;
        root.append(svg('rect', { x: 0, y: ey, width: T.w, height: T.lane, class: 'seq-lane events' }),
          Object.assign(svg('text', { x: 6, y: ey + T.lane / 2 + 4, class: 'seq-name' }), { textContent: 'events' }));
        s.events.forEach((e, i) => root.append(eventMark(e, i, ey)));
        root.append(svg('line', { x1: xOf(time), x2: xOf(time), y1: 0, y2: height, class: 'seq-playhead' }));
        timeline.replaceChildren(root);
        if (keepFocus) {
          keepFocus = false;
          timeline.querySelector('.seq-key.on, .seq-event.on')?.focus();
        }
      }
      function keyDot(target, field, index, key, y) {
        const on = sel?.type === 'key' && sel.target === target && sel.field === field && sel.index === index;
        const dot = svg('circle', { cx: xOf(key[0]), cy: y + T.lane / 2, r: on ? 9 : 7, class: on ? 'seq-key on' : 'seq-key', tabindex: '0',
          role: 'button',
          'aria-label': `Key of ${target}.${field} at ${key[0]} seconds, value ${Math.round(key[1] * 100) / 100}` });
        dot.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          dot.setPointerCapture?.(event.pointerId);
          drag = { type: 'key', target, field, index, moved: false };
          select({ type: 'key', target, field, index });
        });
        dot.addEventListener('keydown', (event) => keyboard(event, () => ({ type: 'key', target, field, index }), key[0]));
        return dot;
      }
      function eventMark(e, index, y) {
        const on = sel?.type === 'event' && sel.index === index;
        const x = xOf(e.at);
        const mark = svg('path', { d: `M${x} ${y + 5} l7 ${T.lane / 2 - 5} l-7 ${T.lane / 2 - 5} l-7 -${T.lane / 2 - 5} z`,
          class: on ? 'seq-event on' : 'seq-event', tabindex: '0', role: 'button',
          'aria-label': `${M.describeEvent(e)} at ${e.at} seconds` });
        mark.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          mark.setPointerCapture?.(event.pointerId);
          drag = { type: 'event', index };
          select({ type: 'event', index });
        });
        mark.addEventListener('keydown', (event) => keyboard(event, () => ({ type: 'event', index }), e.at));
        return mark;
      }
      /** Left and right move a key or event by 0.05 s, Delete takes it away. */
      function keyboard(event, make, at) {
        const target = make();
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          keepFocus = true;
          const t = at + (event.key === 'ArrowRight' ? 0.05 : -0.05);
          if (target.type === 'key') {
            const v = seq().tracks[target.target][target.field][target.index][1];
            attempt(() => { const r = M.moveKey(seq(), target.target, target.field, target.index, t, v); sel = { ...target,
              index: r.index }; edit(r.seq); });
          } else attempt(() => { const r = M.moveEvent(seq(), target.index, t); sel = { type: 'event', index: r.index }; edit(r.seq); });
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          removeSelected(target);
        }
      }
      function removeSelected(target = sel) {
        if (!target) return;
        attempt(() => {
          sel = null;
          edit(target.type === 'key' ? M.removeKey(seq(), target.target, target.field, target.index) : M.removeEvent(seq(), target.index));
        });
      }
      timeline.addEventListener('pointermove', (event) => {
        if (!drag || !seq()) return;
        const t = timeAt(svgX(event));
        if (drag.type === 'scrub') { time = t; paintStage(); drawTimeline(); return; }
        if (drag.type === 'key') {
          const value = seq().tracks[drag.target][drag.field][drag.index][1];
          const r = M.moveKey(seq(), drag.target, drag.field, drag.index, t, value);
          drag.index = r.index;
          sel = { type: 'key', target: drag.target, field: drag.field, index: r.index };
          edit(r.seq, { redraw: false });
        } else {
          const r = M.moveEvent(seq(), drag.index, t);
          drag.index = r.index;
          sel = { type: 'event', index: r.index };
          edit(r.seq, { redraw: false });
        }
        drawInspector();
      });
      const endDrag = () => { drag = null; flush(); };
      timeline.addEventListener('pointerup', endDrag);
      timeline.addEventListener('pointercancel', endDrag);

      // ---- the stage and the log ----
      function paintStage() {
        const s = seq();
        if (!s) return;
        const view = M.previewAt(s, time);
        const k = STAGE.w / STAGE.world.w;
        const g = stage.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, STAGE.w, STAGE.h);
        g.save();
        g.translate(-view.camera.x * k, -view.camera.y * k);
        g.fillStyle = '#1d2433';
        for (let x = 0; x < STAGE.world.w * 2; x += 40) g.fillRect(x * k, STAGE.h - 20, 2, 20);
        Object.keys(s.tracks).filter((n) => n !== 'camera' && n !== 'screen').forEach((name, i) => {
          const t = view.things[name] ?? {};
          const x = (t.x ?? 40 + i * 60) * k;
          const y = (t.y ?? 120) * k;
          const w = (t.w ?? 24) * k;
          const hgt = (t.h ?? 24) * k;
          g.globalAlpha = Math.max(0, Math.min(1, t.alpha ?? 1));
          g.fillStyle = `hsl(${hue(name)} 65% 60%)`;
          g.fillRect(x, y, w, hgt);
          g.globalAlpha = 1;
          g.fillStyle = '#e6e9f0';
          g.font = '10px system-ui, sans-serif';
          g.fillText(name, x, y - 3);
        });
        g.restore();
        if (view.screen.letterbox > 0) {
          const bar = view.screen.letterbox * STAGE.h * 0.14;
          g.fillStyle = '#000';
          g.fillRect(0, 0, STAGE.w, bar);
          g.fillRect(0, STAGE.h - bar, STAGE.w, bar);
        }
        if (view.screen.fade > 0) {
          g.globalAlpha = view.screen.fade;
          g.fillStyle = '#000';
          g.fillRect(0, 0, STAGE.w, STAGE.h);
          g.globalAlpha = 1;
        }
        g.fillStyle = '#9aa3b5';
        g.font = '11px system-ui, sans-serif';
        g.fillText(`${time.toFixed(2)} s`, 6, 14);
        fill(log, ...view.happened.map((e) => h('li', { text: `${e.at}s  ${M.describeEvent(e)}` })));
      }
      function tick() {
        if (!playing || !el.isConnected || !el.offsetParent || !seq()) return;
        time += 1 / 30;
        if (time >= seq().duration) { time = seq().duration; playing = false; drawToolbar(); }
        paintStage();
        timeline.querySelector('.seq-playhead')?.setAttribute('x1', String(xOf(time)));
        timeline.querySelector('.seq-playhead')?.setAttribute('x2', String(xOf(time)));
      }

      // ---- the inspector ----
      const numberField = (label, value, step, onChange, min) => h('label', { class: 'state-line' }, `${label} `, h('input', {
        type: 'number', value: String(Math.round(value * 1000) / 1000), step: String(step), min: min === undefined ? undefined : String(min),
          aria: { label },
        on: { change: (e) => onChange(Number(e.target.value)) },
      }));
      function drawInspector() {
        const s = seq();
        if (!s || !sel) { fill(inspector, h('p', { class: 'dim',
          text: 'Click a dot or a diamond to change it. Click an empty place in a row to add a dot. Drag along the ruler to look at any moment.' }));
          return;
        }
        if (sel.type === 'key') {
          const key = s.tracks[sel.target]?.[sel.field]?.[sel.index];
          if (!key) { sel = null; drawInspector(); return; }
          const keyChange = (t, v) => attempt(() => { const r = M.moveKey(s, sel.target, sel.field, sel.index, t, v); sel = { ...sel,
            index: r.index }; edit(r.seq); });
          fill(inspector, h('h4', { text: `${sel.target}.${sel.field}` }),
            numberField('Time (s)', key[0], 0.05, (v) => keyChange(v, key[1]), 0), numberField('Value', key[1], 1, (v) => keyChange(key[0], v)),
            h('label', { class: 'state-line' }, 'Then it moves ', h('select', { aria: { label: 'How it moves to the next dot' },
              on: { change: (e) => attempt(() => edit(M.setEase(s, sel.target, sel.field, sel.index, e.target.value))) } },
            ...M.EASES.map((how) => h('option', { value: how, text: { linear: 'steadily', in: 'slowly at first', out: 'slowly at the end',
              inout: 'slowly at both ends', step: 'with a jump' }[how],
              selected: (key[2] ?? 'linear') === how })))),
            button({ text: 'Remove this dot', class: 'small ghost', onClick: () => removeSelected() }),
            button({ text: 'Remove this track', class: 'small ghost', onClick: () => {
              const { target, field } = sel;
              attempt(() => { sel = null; edit(M.removeField(s, target, field)); });
            } }));
          return;
        }
        const e = s.events[sel.index];
        if (!e) { sel = null; drawInspector(); return; }
        const kind = M.EVENT_KINDS[e.kind];
        const change = (props) => attempt(() => edit(M.setEvent(s, sel.index, props), { redraw: false }));
        fill(inspector, h('h4', { text: kind.label }), h('p', { class: 'dim', text: kind.help }),
          numberField('Time (s)', e.at, 0.05, (v) => attempt(() => { const r = M.moveEvent(s, sel.index, v); sel = { type: 'event',
            index: r.index }; edit(r.seq); }), 0),
          ...Object.entries(kind.params).map(([name, p]) => (p.kind === 'flag'
            ? h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: !!e[name],
              on: { change: (ev) => change({ [name]: ev.target.checked }) } }), ` ${p.label}`)
            : p.kind === 'number'
              ? numberField(p.label, e[name], p.step, (v) => change({ [name]: v }), p.min)
              : h('label', { class: 'state-line' }, `${p.label} `, h('input', { type: 'text', value: e[name] ?? '', aria: { label: p.label },
                on: { change: (ev) => change({ [name]: ev.target.value }) } })))),
          button({ text: 'Remove this event', class: 'small ghost', onClick: () => removeSelected() }));
      }

      // ---- the toolbar and the whole panel ----
      function drawToolbar() {
        const names = Object.keys(table);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        const has = Boolean(seq());
        fill(toolbar, names.length ? picker : null,
          h('select', { aria: { label: 'New sequence from a ready-made one' },
            on: { change: (e) => { const k = e.target.value; e.target.value = ''; if (k) newSequence(k); } } },
            h('option', { value: '', text: 'New sequence from…' }), ...Object.keys(M.PRESETS).map((n) => h('option', { value: n, text: n }))),
          has ? button({ text: playing ? 'Pause' : 'Play', class: 'small', aria: { label: playing ? 'Pause the cutscene' : 'Play the cutscene' },
            onClick: () => { if (time >= seq().duration) time = 0; playing = !playing; drawToolbar(); } }) : null,
          has ? button({ text: 'Back to start', class: 'small',
            onClick: () => { time = 0; playing = false; paintStage(); drawToolbar(); drawTimeline(); } }) : null,
          has ? numberField('Length (s)', seq().duration, 0.5, (v) => attempt(() => edit(M.setDuration(seq(), v))), 0.1) : null,
          has ? h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: seq().skippable !== false,
            on: { change: (e) => edit(M.setSkippable(seq(), e.target.checked)) } }), ' Can be skipped') : null,
          has ? button({ text: 'Add a track', class: 'small', onClick: addTrack }) : null,
          has ? h('select', { aria: { label: 'Add an event at the playhead' }, on: { change: (e) => {
            const k = e.target.value;
            e.target.value = '';
            if (k) attempt(() => { const r = M.addEvent(seq(), k, time); sel = { type: 'event', index: r.index }; edit(r.seq); });
          } } }, h('option', { value: '', text: 'Add an event…' }), ...Object.entries(M.EVENT_KINDS).map(([k, v]) => h('option', { value: k,
            text: v.label }))) : null,
          has ? button({ text: 'Rename', class: 'small ghost', onClick: renameSequence }) : null,
          has ? button({ text: 'Delete', class: 'small ghost', onClick: removeSequence }) : null);
      }
      function draw() {
        drawToolbar();
        const has = Boolean(seq());
        body.hidden = !has;
        help.hidden = !has;
        issues.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(empty, h('h3', { text: problem ? 'The sequences file needs fixing' : 'No sequences yet' }), h('p', { text: problem || HINT }),
            problem ? null : h('div', { class: 'toolbar' }, ...Object.keys(M.PRESETS).map((n) => button({ text: `A ${n} sequence`, class: 'primary',
              onClick: () => newSequence(n) }))));
          return;
        }
        drawTimeline();
        drawInspector();
        paintStage();
        const found = M.sequenceProblems(seq(), knownNames());
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
      }
      /** The names a sequence may use that the project has: its sounds, songs and story parts (a file that cannot be read is left out, the panel for it explains). */
      function knownNames() {
        const names = (path, read) => {
          if (!studio.project?.has(path)) return [];
          try { return read(studio.project.readText(path)); } catch { return undefined; }
        };
        return {
          sounds: names('src/sounds.js', (t) => Object.keys(parseSounds(t))),
          songs: names('src/music.js', (t) => Object.keys(parseSongs(t).songs)),
          nodes: names('src/dialogue.js', (t) => splitNodes(parseStoryFile(t)).nodes.map((n) => n.name)),
        };
      }

      // ---- adding, naming, deleting ----
      function newSequence(kind) {
        const name = M.freeName(table, kind);
        table = { ...table, [name]: M.PRESETS[kind]() };
        current = name;
        sel = null;
        time = 0;
        flush();
        draw();
      }
      async function addTrack() {
        const text = await promptText({
          title: 'Add a track', label: 'Which number of which thing (for example hero.x, camera.x, screen.fade, door.alpha)', value: 'hero.y',
            confirmLabel: 'Add it',
          validate: (v) => { const [t, f] = v.trim().split('.'); return !f ? 'Write it like hero.x' : (M.targetProblem(seq(),
            t) && !(t in seq().tracks) ? M.targetProblem(seq(), t) : M.fieldProblem(seq(), t, f)); },
        });
        if (text === undefined) return;
        const [target, field] = text.trim().split('.');
        attempt(() => edit(target in seq().tracks ? M.addField(seq(), target, field) : M.addTarget(seq(), target, field)));
      }
      async function renameSequence() {
        const name = await promptText({ title: 'Rename the sequence', label: 'New name', value: current, confirmLabel: 'Rename',
          validate: (v) => (v.trim() === current ? null : M.nameProblem(v.trim(), (n) => n in table)) });
        if (name === undefined || name.trim() === current) return;
        table = Object.fromEntries(Object.entries(table).map(([k, v]) => [k === current ? name.trim() : k, v]));
        current = name.trim();
        flush();
        draw();
      }
      function removeSequence() {
        const next = { ...table };
        delete next[current];
        table = next;
        current = Object.keys(table)[0] ?? null;
        sel = null;
        flush();
        draw();
      }

      timer = setInterval(tick, 1000 / 30);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(table).length) load(); });
      load();
      return { el, focus: () => picker.focus(), onShow: load, dispose: () => { clearInterval(timer); flush(); } };
    },
  };
}
