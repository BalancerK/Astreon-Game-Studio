// The States panel: what a thing does in each situation. A machine is a picture of states (idle, walk, hurt...) joined by arrows that say when to move on: on an event
// (`hit`), after some seconds, or when a number of the thing is some value (`vx != 0`). Each state plays an animation of the thing's sprite. Drag states to arrange them,
// pick one to change it, and try it out live: press the event buttons and set the numbers, and watch the thing change state and animation. Kept in `src/states.js`;
// the game runs it with `stepState(thing, states.hero, dt, events)` from @engine/arcade.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/state-model.js';
import { parseSprite } from '../paint/sprite-model.js';
import { stepState, enterState } from '../../../packages/arcade/src/states.js';
import { animate } from '../../../packages/arcade/src/art.js';

const FILE = 'src/states.js';
const ART = /^src\/art\/([\w-]+)\.js$/;
const SVG = 'http://www.w3.org/2000/svg';
const SCALE = 5;
const NONE = '(none / first)';
const HINT = 'A machine says what a character does in each situation: stand, walk, get hurt. '
  + 'Start from a ready-made one and change it.';

const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
};

export function statePanel(studio) {
  return {
    id: 'states',
    title: 'States',
    icon: 'edit',
    create() {
      let machines = {};
      let current = null;                          // the machine being edited
      let selected = null;                         // the state (or M.ANY) being edited
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let previewSprite = '';
      let drag = null;
      // the live try-out
      let thing = { vx: 0 };
      let events = [];
      let timer = 0;

      const picker = h('select', { class: 'art-select', aria: { label: 'Machine to edit' },
        on: { change: () => { current = picker.value; selected = null; reset(); draw(); } } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const graph = h('div', { class: 'state-graph' });
      const inspector = h('div', { class: 'state-inspector' });
      const trial = h('div', { class: 'state-trial' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'state-body' }, graph, h('div', { class: 'state-side' }, inspector, trial));
      const el = h('div', { class: 'panel-body art states', 'aria-label': 'State machines' }, toolbar, body, issues, help, empty);
      const machine = () => machines[current];
      const sprites = () => (studio.project?.list() ?? []).filter((p) => ART.test(p)).map((p) => ART.exec(p)[1]);

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { machines = raw ? M.parseStates(raw) : {}; } catch (error) { machines = {}; problem = error.message; }
        if (!(current in machines)) current = Object.keys(machines)[0] ?? null;
        if (selected !== M.ANY && !(selected in (machine()?.states ?? {}))) selected = null;
        reset();
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(machines).length) return;
        const out = M.serializeStates(machines);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { keepTry = false } = {}) {
        if (!current || next === machine()) return;
        machines = { ...machines, [current]: next };
        save();
        if (!keepTry) reset();
        draw();
      }

      // ---- the live try-out ----
      function reset() {
        const fields = machine() ? M.fieldsOf(machine()) : [];
        thing = { vx: 0, ...Object.fromEntries(fields.map((f) => [f, thing[f] ?? 0])), sprite: previewSprite || sprites()[0] || '' };
        events = [];
        if (machine()) enterState(thing, machine(), machine().initial);
      }
      function art() {
        const name = thing.sprite;
        const text = name && studio.project?.has(`src/art/${name}.js`) ? studio.project.readText(`src/art/${name}.js`) : null;
        try { return text ? { [name]: parseSprite(text) } : {}; } catch { return {}; }
      }
      function tick() {
        if (!el.isConnected || !el.offsetParent || !machine()) return;
        const before = thing.state;
        stepState(thing, machine(), 1 / 15, events);
        events = [];
        animate(thing, art(), 1 / 15);
        if (thing.state !== before) { paintGraphHighlight(); }
        paintTrial();
      }
      function paintGraphHighlight() {
        for (const n of graph.querySelectorAll('[data-state]')) n.classList.toggle('live', n.dataset.state === thing.state);
      }
      function paintTrial() {
        const canvas = trial.querySelector('canvas');
        const label = trial.querySelector('.state-now');
        if (label) label.textContent = `${thing.state} · ${thing.stateTime.toFixed(1)} s${thing.anim ? ` · plays "${thing.anim}"` : ''}`;
        const sprite = art()[thing.sprite];
        if (!canvas || !sprite) return;
        const g = canvas.getContext('2d');
        g.clearRect(0, 0, canvas.width, canvas.height);
        (sprite.frames[(thing.frame ?? 0) % sprite.frames.length] ?? []).forEach((row, y) => [...row].forEach((ch, x) => {
          if (sprite.palette[ch]) { g.fillStyle = sprite.palette[ch]; g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE); }
        }));
      }

      // ---- the graph ----
      function drawGraph() {
        const m = machine();
        const place = M.layoutOf(m);
        const width = Math.max(420, ...Object.values(place).map(([x]) => x + M.NODE.w + 40));
        const height = Math.max(240, ...Object.values(place).map(([, y]) => y + M.NODE.h + 40));
        const edges = M.edgesOf(m).map((e) => svg('g', { class: `edge${selected === e.from ? ' on' : ''}`, 'data-edge': `${e.from}:${e.index}`,
          tabindex: '0', role: 'button',
          'aria-label': `${e.from === M.ANY ? 'from any state' : e.from} to ${e.to}: ${e.label}` },
        svg('path', { d: e.path, class: 'edge-line', 'marker-end': 'url(#arrow)' }),
        svg('path', { d: e.path, class: 'edge-hit' }),
        (() => { const t = svg('text', { x: e.at[0], y: e.at[1] - 4, class: 'edge-label',
          'text-anchor': 'middle' }); t.textContent = e.label; return t; })()));
        const nodes = Object.entries(place).map(([name, [x, y]]) => {
          const label = svg('text', { x: x + M.NODE.w / 2, y: y + 19, class: 'node-name', 'text-anchor': 'middle' });
          label.textContent = name;
          const sub = svg('text', { x: x + M.NODE.w / 2, y: y + 35, class: 'node-sub', 'text-anchor': 'middle' });
          sub.textContent = m.states[name].animation ? `▶ ${m.states[name].animation}` : '';
          return svg('g', { class: `node${selected === name ? ' on' : ''}${m.initial === name ? ' first' : ''}${thing.state === name ? ' live' : ''}`,
            'data-state': name, tabindex: '0', role: 'button', 'aria-label': `State ${name}${m.initial === name ? ', the first state' : ''}` },
          svg('rect', { x, y, width: M.NODE.w, height: M.NODE.h, rx: 10 }), label, sub, m.initial === name ? svg('circle', { cx: x - 8,
            cy: y + M.NODE.h / 2, r: 5, class: 'start-dot' }) : null);
        });
        const any = m.any?.length ? svg('g', { class: `any${selected === M.ANY ? ' on' : ''}`, 'data-state': M.ANY, role: 'button', tabindex: '0',
          'aria-label': 'From any state' },
          svg('rect', { x: 6, y: height - 40, width: 110, height: 28, rx: 14 }), (() => { const t = svg('text', { x: 61, y: height - 22,
            'text-anchor': 'middle', class: 'node-sub' }); t.textContent = 'from any state'; return t; })()) : null;
        const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'state-svg', role: 'group', 'aria-label': 'State graph' },
          svg('defs', {}, svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7,
            orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }))),
          ...edges, ...nodes, any);
        fill(graph, root);
      }

      function pointerOn(event) {
        const node = event.target.closest?.('[data-state]');
        const edge = event.target.closest?.('[data-edge]');
        return { node, edge };
      }
      graph.addEventListener('pointerdown', (event) => {
        const { node, edge } = pointerOn(event);
        if (node && node.dataset.state !== M.ANY) {
          selected = node.dataset.state;
          const box = graph.querySelector('svg').getBoundingClientRect();
          const at = M.layoutOf(machine())[selected];
          drag = { name: selected, dx: event.clientX - box.left - at[0], dy: event.clientY - box.top - at[1], moved: false };
          graph.setPointerCapture?.(event.pointerId);
          drawGraph();
          drawInspector();
        } else if (node) { selected = M.ANY; drawGraph(); drawInspector(); } else if (edge) {
          selected = edge.dataset.edge.split(':')[0];
          drawGraph();
          drawInspector();
        }
      });
      graph.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const box = graph.querySelector('svg').getBoundingClientRect();
        drag.moved = true;
        machines = { ...machines, [current]: M.moveState(machine(), drag.name, event.clientX - box.left - drag.dx,
          event.clientY - box.top - drag.dy) };
        drawGraph();
      });
      const endDrag = () => { if (drag?.moved) save(); drag = null; };
      graph.addEventListener('pointerup', endDrag);
      graph.addEventListener('pointercancel', endDrag);
      graph.addEventListener('keydown', (event) => {
        const node = event.target.closest?.('[data-state]');
        if (!node || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        selected = node.dataset.state;
        drawGraph();
        drawInspector();
      });

      // ---- the inspector ----
      const input = (props, onChange) => h('input', { ...props, on: { change: (e) => onChange(e.target.value) } });
      const select = (label, options, value, onChange) => h('select', { aria: { label }, on: { change: (e) => onChange(e.target.value) } },
        ...options.map((o) => h('option', { value: o, text: o || NONE, selected: o === value })));

      function transitionRow(from, tr, i, total) {
        const m = machine();
        const targets = Object.keys(m.states).filter((n) => n !== from);
        const when = M.conditionsOf(tr);
        const row = h('div', { class: 'state-tr' },
          h('div', { class: 'state-tr-head' }, h('span', { text: '→' }),
            select('Goes to', [...new Set([tr.to, ...targets])], tr.to, (v) => edit(M.updateTransition(m, from, i, { to: v }), { keepTry: true })),
            button({ text: '↑', class: 'small ghost', disabled: i === 0, aria: { label: 'Check this one earlier' },
              onClick: () => edit(M.moveTransition(m, from, i, -1), { keepTry: true }) }),
            button({ text: '↓', class: 'small ghost', disabled: i === total - 1, aria: { label: 'Check this one later' },
              onClick: () => edit(M.moveTransition(m, from, i, 1), { keepTry: true }) }),
            button({ text: '×', class: 'small ghost', aria: { label: 'Remove this transition' }, onClick: () => edit(M.removeTransition(m, from, i),
              { keepTry: true }) })),
          tr.event !== undefined ? h('label', { class: 'state-line' }, 'on event ', input({ type: 'text', value: tr.event, spellcheck: false,
            'aria-label': 'Event name' },
            (v) => edit(M.updateTransition(m, from, i, { event: v.trim() || 'go' }), { keepTry: true })),
          button({ text: '×', class: 'small ghost', aria: { label: 'Do not wait for an event' }, onClick: () => edit(M.updateTransition(m, from, i,
            { event: undefined }), { keepTry: true }) })) : null,
          tr.after !== undefined ? h('label', { class: 'state-line' }, 'after ', input({ type: 'number', min: '0', step: '0.1',
            value: String(tr.after), 'aria-label': 'Seconds' },
            (v) => edit(M.updateTransition(m, from, i, { after: Math.max(0, Number(v) || 0) }), { keepTry: true })), ' seconds',
          button({ text: '×', class: 'small ghost', aria: { label: 'Do not wait for time' }, onClick: () => edit(M.updateTransition(m, from, i,
            { after: undefined }), { keepTry: true }) })) : null,
          ...when.map((c, k) => h('div', { class: 'state-line' }, 'when ',
            input({ type: 'text', value: c.field, size: '8', spellcheck: false, 'aria-label': 'Number of the thing' }, (v) => edit(M.setCondition(m,
              from, i, k, { field: v.trim() || 'vx' }), { keepTry: true })),
            select('Compare', M.OPS, c.op, (v) => edit(M.setCondition(m, from, i, k, { op: v }), { keepTry: true })),
            input({ type: 'text', value: String(c.value), size: '5', spellcheck: false, 'aria-label': 'Value' }, (v) => edit(M.setCondition(m, from,
              i, k, { value: M.parseValue(v) }), { keepTry: true })),
            button({ text: '×', class: 'small ghost', aria: { label: 'Remove this condition' }, onClick: () => edit(M.removeCondition(m, from, i,
              k), { keepTry: true }) }))),
          h('div', { class: 'state-line' },
            tr.event === undefined ? button({ text: '+ event', class: 'small ghost', onClick: () => edit(M.updateTransition(m, from, i,
              { event: 'go' }), { keepTry: true }) }) : null,
            tr.after === undefined ? button({ text: '+ time', class: 'small ghost', onClick: () => edit(M.updateTransition(m, from, i,
              { after: 1 }), { keepTry: true }) }) : null,
            button({ text: '+ condition', class: 'small ghost', onClick: () => edit(M.addCondition(m, from, i), { keepTry: true }) })),
          h('div', { class: 'dim state-says', text: `Means: ${M.describe(tr)}` }));
        return row;
      }

      function drawInspector() {
        const m = machine();
        if (!m) { fill(inspector); return; }
        if (selected === null) {
          fill(inspector, h('p', { class: 'dim', text: 'Pick a state in the picture to change it. Drag states to arrange them.' }));
          return;
        }
        const from = selected;
        const list = M.listOf(m, from);
        const header = from === M.ANY
          ? [h('h3', { text: 'From any state' }), h('p', { class: 'dim',
            text: 'These arrows are checked in every state (for example "on die → dead").' })]
          : [h('h3', {}, 'State ', h('code', { text: from }), m.initial === from ? h('span', { class: 'dim', text: ' (the first)' }) : null),
            h('label', { class: 'state-line' }, 'Plays animation ', animationPicker(from)),
            h('div', { class: 'state-line' },
              button({ text: 'Rename', class: 'small', onClick: () => renameState(from) }),
              m.initial === from ? null : button({ text: 'Make first', class: 'small', onClick: () => edit(M.setInitial(m, from)) }),
              button({ text: 'Remove', class: 'small ghost', onClick: () => removeState(from) }))];
        const others = Object.keys(m.states).filter((n) => n !== from);
        fill(inspector, header, h('h4', { text: list.length ? 'Moves on when (the first that can happen wins)' : 'Never moves on' }),
          ...list.map((tr, i) => transitionRow(from, tr, i, list.length)),
          others.length || from === M.ANY ? button({
            text: 'Add an arrow', icon: 'plus', class: 'small',
            onClick: () => edit(M.addTransition(m, from, from === M.ANY ? Object.keys(m.states)[0] : others[0]), { keepTry: true }),
          }) : null,
          from === M.ANY ? null : button({
            text: 'Add an arrow from any state to here', class: 'small ghost',
            onClick: () => { selected = M.ANY; edit(M.addTransition(m, M.ANY, from), { keepTry: true }); },
          }));
      }

      function animationPicker(state) {
        const sprite = art()[thing.sprite];
        const names = Object.keys(sprite?.animations ?? {});
        const now = machine().states[state].animation ?? '';
        if (!names.length) {
          return input({ type: 'text', value: now, placeholder: 'name', size: '10', spellcheck: false, 'aria-label': 'Animation name' },
            (v) => edit(M.setAnimation(machine(), state, v.trim())));
        }
        return select('Animation', ['', ...new Set([...names, ...(now ? [now] : [])])], now, (v) => edit(M.setAnimation(machine(), state, v)));
      }

      function drawTrial() {
        const m = machine();
        if (!m) { fill(trial); return; }
        const eventNames = M.eventsOf(m);
        const fields = M.fieldsOf(m);
        const artList = sprites();
        fill(trial, h('h4', { text: 'Try it' }),
          h('div', { class: 'state-try' }, h('canvas', { width: 16 * SCALE, height: 16 * SCALE, class: 'pack-thumb', role: 'img',
            aria: { label: 'The thing in its current state' } }),
            h('div', {}, h('div', { class: 'state-now', 'aria-live': 'polite' }),
              h('label', { class: 'state-line' }, 'Sprite ', select('Sprite to show', ['', ...artList], previewSprite,
                (v) => { previewSprite = v; reset(); draw(); })))),
          eventNames.length ? h('div', { class: 'state-line' }, 'Send: ', ...eventNames.map((n) => button({ text: n, class: 'small',
            onClick: () => { events.push(n); tick(); } }))) : null,
          ...fields.map((f) => h('label', { class: 'state-line' }, `${f} = `, input({ type: 'text', value: String(thing[f] ?? 0), size: '6',
            spellcheck: false, 'aria-label': `Try ${f}` },
            (v) => { thing[f] = M.parseValue(v); tick(); }))),
          button({ text: 'Start again', class: 'small ghost', onClick: () => { reset(); drawGraph(); paintTrial(); } }));
        paintTrial();
      }

      // ---- the parts ----
      function draw() {
        const names = Object.keys(machines);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = !names.length;
        fill(toolbar, picker,
          button({ text: 'New machine', icon: 'plus', class: 'small', onClick: () => newMachine() }),
          names.length ? [button({ text: 'Add a state', class: 'small primary', onClick: addState }),
            button({ text: 'Rename machine', class: 'small ghost', onClick: renameMachine }),
            button({ text: 'Delete machine', class: 'small ghost', onClick: removeMachine })] : null);
        body.hidden = !names.length;
        help.hidden = !names.length;
        issues.hidden = !names.length;
        empty.hidden = names.length > 0;
        if (!names.length) {
          fill(empty, h('h3', { text: problem ? 'The states file needs fixing' : 'No states yet' }),
            h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Make a hero machine', class: 'primary', onClick: () => newMachine(true) }));
          return;
        }
        drawGraph();
        drawInspector();
        drawTrial();
        const found = M.machineProblems(machine());
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
        help.querySelector('pre').textContent = `import states from './states.js';\nimport { stepState } from '@engine/arcade';\n\n`
          + `// every tick, for each thing: its state and animation follow the machine\n`
          + `stepState(thing, states.${current}, dt, events);   // events: what happened this tick, such as ['hit']\n\n`
          + `// thing.state is the state now, thing.anim the animation to play (animate(thing, art, dt) draws it)`;
      }

      async function newMachine(starter) {
        const name = await promptText({
          title: 'Name the machine', label: 'Name (for example hero or slime)', value: M.freeName(machines, starter ? 'hero' : 'thing'),
            confirmLabel: 'Make it',
          validate: (v) => M.nameProblem(v.trim(), (n) => n in machines),
        });
        if (name === undefined) return;
        machines = { ...machines, [name.trim()]: starter ? M.starterMachine() : M.newMachine() };
        current = name.trim();
        selected = null;
        flush();
        reset();
        draw();
      }
      async function renameMachine() {
        const name = await promptText({
          title: 'Rename the machine', label: 'New name', value: current, confirmLabel: 'Rename',
          validate: (v) => M.nameProblem(v.trim(), (n) => n !== current && n in machines),
        });
        if (name === undefined || name.trim() === current) return;
        machines = Object.fromEntries(Object.entries(machines).map(([k, v]) => [k === current ? name.trim() : k, v]));
        current = name.trim();
        flush();
        draw();
      }
      function removeMachine() {
        const next = { ...machines };
        delete next[current];
        machines = next;
        current = Object.keys(machines)[0] ?? null;
        selected = null;
        flush();
        reset();
        draw();
      }
      async function addState() {
        const name = await promptText({
          title: 'Name the state', label: 'Name (for example jump or attack)', value: M.freeName(machine().states, 'state'), confirmLabel: 'Add it',
          validate: (v) => M.nameProblem(v.trim(), (n) => n in machine().states),
        });
        if (name === undefined) return;
        selected = name.trim();
        edit(M.addState(machine(), selected), { keepTry: true });
      }
      async function renameState(from) {
        const name = await promptText({
          title: 'Rename the state', label: 'New name', value: from, confirmLabel: 'Rename',
          validate: (v) => M.nameProblem(v.trim(), (n) => n !== from && n in machine().states),
        });
        if (name === undefined || name.trim() === from) return;
        selected = name.trim();
        edit(M.renameState(machine(), from, selected));
      }
      function removeState(from) {
        try { selected = null; edit(M.removeState(machine(), from)); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }

      timer = setInterval(tick, 1000 / 15);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(machines).length) load(); });
      load();
      return { el, focus: () => picker.focus(), onShow: load, dispose: () => { clearInterval(timer); flush(); } };
    },
  };
}
