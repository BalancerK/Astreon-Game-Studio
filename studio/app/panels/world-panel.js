// The World panel: the rooms of your game as boxes on a board, joined by arrows. A room is a scene or a level of the project; drag the boxes to arrange them. A link says "leave this
// room through the right edge (or through that door) and arrive in the other room, over there". Pick a box to see its links and add more. Kept in `src/world.js`; the game uses it with
// `makeWorld(world, loaders)` from @engine/arcade.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/world-model.js';

const FILE = 'src/world.js';
const SVG = 'http://www.w3.org/2000/svg';
const BOARD = { w: 640, h: 360 };
const HINT = 'A world joins your levels and scenes into a place to walk around: leave the cave through its right edge and arrive in the forest, '
  + 'or step through a door. '
  + 'Make some scenes first, then add them here.';
const SNIPPET = [
  "import data from './world.js';",
  "import cave from '../scenes/cave.js';",
  "import forest from '../scenes/forest.js';",
  "import { makeWorld, loadScene, followSmooth } from '@engine/arcade';",
  '',
  '// once:       const world = makeWorld(data, { cave: (g) => loadScene(g, cave), forest: (g) => loadScene(g, forest) });',
  '// in create:  world.start(game);                          // loads the first room',
  '// each tick:  world.step(game);                           // the hero left through an edge or touched a door: the next room is loaded',
  '//             followSmooth(game, hero, game.map, dt);     // game.map is the size of the room that is loaded now',
  '// by hand:    world.goTo(game, "forest");   world.room(game);   world.visited(game);',
].join('\n');
const ARROW_MODES = { default: 'where the link goes by itself', at: 'next to a named thing', place: 'at a place', side: 'on an edge' };

const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function worldPanel(studio) {
  return {
    id: 'world',
    title: 'World',
    icon: 'edit',
    create() {
      let world = M.newWorld();
      let has = false;
      let selected = '';
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let drag = null;
      let sizes = {};

      const toolbar = h('div', { class: 'toolbar art-bar' });
      const board = h('div', { class: 'world-board' });
      const inspector = h('div', { class: 'world-inspector' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code',
        text: SNIPPET }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'layers-body' }, board, inspector);
      const el = h('div', { class: 'panel-body art world', 'aria-label': 'World' }, toolbar, body, issues, help, empty);

      const read = (path) => { try { return studio.project?.has(path) ? studio.project.readText(path) : ''; } catch { return ''; } };
      const nameList = (room) => { const f = world.rooms[room]?.file; return f ? M.namesIn(read(f), f) : []; };

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        has = raw !== null;
        try { world = raw ? M.parseWorld(raw) : M.newWorld(); } catch (error) { world = M.newWorld(); problem = error.message; has = false; }
        if (!(selected in world.rooms)) selected = world.start;
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !has) return;
        const out = M.serializeWorld(world);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function edit(next, { redraw = true } = {}) {
        world = next;
        has = true;
        save();
        if (redraw) draw(); else drawBoard();
      }
      const attempt = (fn, o) => { try { edit(fn(), o); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); draw(); } };

      // ---- the board ----
      function boxOf(room) {
        const r = world.rooms[room];
        const s = sizes[room];
        return { x: r.x ?? 0, y: r.y ?? 0, w: s ? clamp(s.w / 4, 110, 220) : 110, h: s ? clamp(s.h / 4, 60, 140) : 64 };
      }
      const edgePoint = (b, side) => ({ left: [b.x, b.y + b.h / 2], right: [b.x + b.w, b.y + b.h / 2], up: [b.x + b.w / 2, b.y],
        down: [b.x + b.w / 2, b.y + b.h] }[side]);
      function drawBoard() {
        const names = Object.keys(world.rooms);
        const extent = names.map((n) => boxOf(n)).reduce((m, b) => ({ w: Math.max(m.w, b.x + b.w + 30), h: Math.max(m.h, b.y + b.h + 30) }), BOARD);
        const root = svg('svg', { viewBox: `0 0 ${extent.w} ${extent.h}`, class: 'world-svg', role: 'group',
          'aria-label': 'The rooms of the world' });
        root.append(svg('defs', {}, svg('marker', { id: 'world-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7,
          orient: 'auto-start-reverse' },
          svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'world-head' }))));
        world.links.forEach((l, i) => {
          const a = boxOf(l.from);
          const b = boxOf(l.to);
          const start = l.via.kind === 'edge' ? edgePoint(a, l.via.side) : [a.x + a.w / 2, a.y + a.h / 2];
          const toSide = l.arrive?.side ?? (l.via.kind === 'edge' ? M.OPPOSITE[l.via.side] : M.suggestSide(world, l.to, l.from));
          const end = edgePoint(b, toSide);
          const bend = (i % 2 ? 1 : -1) * 14;
          const mx = (start[0] + end[0]) / 2 + bend;
          const my = (start[1] + end[1]) / 2 + bend;
          root.append(svg('path', { d: `M${start[0]} ${start[1]} Q${mx} ${my} ${end[0]} ${end[1]}`,
            class: selected === l.from || selected === l.to ? 'world-link on' : 'world-link',
            'marker-end': 'url(#world-arrow)' }));
          if (l.via.kind === 'thing') root.append(Object.assign(svg('text', { x: mx, y: my - 3, class: 'world-label' }),
            { textContent: l.via.name }));
        });
        for (const name of names) root.append(roomBox(name));
        board.replaceChildren(root);
      }
      function roomBox(name) {
        const b = boxOf(name);
        const on = name === selected;
        const g = svg('g', { class: `world-room${on ? ' on' : ''}`, tabindex: '0', role: 'button',
          'aria-label': `Room ${name}${name === world.start ? ', where the game starts' : ''}`, 'aria-pressed': String(on) });
        g.append(svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6 }),
          Object.assign(svg('text', { x: b.x + 8, y: b.y + 18, class: 'world-name' }), { textContent: name }),
          Object.assign(svg('text', { x: b.x + 8, y: b.y + b.h - 8, class: 'world-small' }),
            { textContent: sizes[name] ? `${sizes[name].w} × ${sizes[name].h}` : 'no file' }));
        if (name === world.start) g.append(Object.assign(svg('text', { x: b.x + 8, y: b.y + b.h / 2 + 4, class: 'world-start' }),
          { textContent: '★ start' }));
        g.addEventListener('pointerdown', (event) => {
          g.setPointerCapture?.(event.pointerId);
          const r = board.querySelector('svg').getBoundingClientRect();
          const scale = board.querySelector('svg').viewBox.baseVal.width / r.width;
          drag = { room: name, scale, dx: (event.clientX - r.left) * scale - b.x, dy: (event.clientY - r.top) * scale - b.y, moved: false };
          if (selected !== name) { selected = name; drawInspector(); }
        });
        g.addEventListener('keydown', (event) => {
          const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
          if (!step) return;
          event.preventDefault();
          selected = name;
          attempt(() => M.moveRoom(world, name, b.x + step[0], b.y + step[1]));
          board.querySelector('.world-room.on')?.focus();
        });
        return g;
      }
      board.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const r = board.querySelector('svg').getBoundingClientRect();
        const x = (event.clientX - r.left) * drag.scale - drag.dx;
        const y = (event.clientY - r.top) * drag.scale - drag.dy;
        drag.moved = true;
        world = M.moveRoom(world, drag.room, x, y);
        save();
        drawBoard();
      });
      const endDrag = () => { if (drag?.moved) { has = true; flush(); drawInspector(); } else if (drag) { draw(); } drag = null; };
      board.addEventListener('pointerup', endDrag);
      board.addEventListener('pointercancel', endDrag);

      // ---- the inspector ----
      const field = (label, input) => h('label', { class: 'state-line' }, `${label} `, input);
      function drawInspector() {
        const room = world.rooms[selected];
        if (!room) { fill(inspector, h('p', { class: 'dim', text: 'Pick a room on the board to see how it joins the others.' })); return; }
        const others = Object.keys(world.rooms).filter((n) => n !== selected);
        const mine = M.linksOf(world, selected);
        const newLink = { to: others[0] ?? '', kind: 'edge', side: others[0] ? M.suggestSide(world, selected, others[0]) : 'right', door: '',
          both: true };
        const doors = nameList(selected);
        const size = sizes[selected];
        const startBox = room.start ? { x: room.start.x, y: room.start.y } : null;
        fill(inspector,
          h('h4', { text: `The room "${selected}"` }),
          h('p', { class: 'dim', text: `${room.file ?? 'no file'}${size ? `, ${size.w} × ${size.h} pixels` : ''}${doors.length ? `,
            doors: ${doors.join(', ')}` : ''}` }),
          h('div', { class: 'toolbar' },
            button({ text: selected === world.start ? '★ The game starts here' : 'Make the game start here', class: 'small',
              disabled: selected === world.start,
              onClick: () => attempt(() => M.setStart(world, selected)) }),
            button({ text: 'Rename', class: 'small ghost', onClick: renameRoom }),
            button({ text: 'Delete room', class: 'small ghost', onClick: () => attempt(() => { const next = M.removeRoom(world,
              selected); selected = next.start; return next; }) })),
          h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: !!startBox,
            aria: { label: 'The hero starts at a place in this room' },
            on: { change: (e) => attempt(() => M.setRoomStart(world, selected, e.target.checked ? { x: 40, y: 40 } : null)) } }),
              ' The hero starts at a place when the game starts here'),
          startBox ? h('div', { class: 'toolbar' }, field('x', numberBox('Start x', startBox.x, (v) => attempt(() => M.setRoomStart(world, selected,
            { x: v, y: startBox.y }), { redraw: false }))),
            field('y', numberBox('Start y', startBox.y, (v) => attempt(() => M.setRoomStart(world, selected, { x: startBox.x, y: v }),
              { redraw: false })))) : null,
          h('h4', { text: 'Links' }),
          ...(mine.length ? mine.map((i) => linkRow(i)) : [h('p', { class: 'dim', text: 'No links yet.' })]),
          others.length ? addLinkForm(newLink, others, doors) : h('p', { class: 'dim', text: 'Add another room to link it.' }));
      }
      function numberBox(label, value, onChange) {
        return h('input', { type: 'number', value: String(value), step: '1', style: { width: '5.5em' }, aria: { label },
          on: { change: (e) => onChange(Number(e.target.value)) } });
      }
      function linkRow(i) {
        const l = world.links[i];
        const mode = l.arrive?.at ? 'at' : l.arrive?.side ? 'side' : l.arrive ? 'place' : 'default';
        const set = (arrive) => attempt(() => M.setLink(world, i, { arrive }));
        const targetNames = nameList(l.to);
        const control = mode === 'at'
          ? h('select', { aria: { label: `Arrive next to, link ${i + 1}` },
            on: { change: (e) => set(e.target.value ? { at: e.target.value } : null) } },
            h('option', { value: '', text: '(pick a thing)' }), ...targetNames.map((n) => h('option', { value: n, text: n,
              selected: n === l.arrive.at })))
          : mode === 'side'
            ? h('select', { aria: { label: `Arrive on the edge, link ${i + 1}` }, on: { change: (e) => set({ side: e.target.value }) } },
              ...M.SIDES.map((s) => h('option', { value: s, text: s, selected: s === l.arrive.side })))
            : mode === 'place'
              ? h('span', {}, numberBox(`Arrive x, link ${i + 1}`, l.arrive.x, (v) => set({ x: v, y: l.arrive.y })), ' ',
                numberBox(`Arrive y, link ${i + 1}`, l.arrive.y, (v) => set({ x: l.arrive.x, y: v })))
              : null;
        return h('div', { class: 'kind-field' },
          h('div', { class: 'layers-row' }, h('strong', { text: M.describeLink(l) }),
            button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove link ${i + 1}: ${M.describeLink(l)}` },
              onClick: () => attempt(() => M.removeLink(world, i)) })),
          l.from === selected ? h('div', { class: 'toolbar' }, field('It arrives', h('select', { aria: { label: `How link ${i + 1} arrives` },
            on: { change: (e) => set({ default: null, at: targetNames[0] ? { at: targetNames[0] } : { x: 40, y: 40 }, place: { x: 40, y: 40 },
              side: { side: M.OPPOSITE[l.via.side ?? 'left'] ?? 'left' } }[e.target.value]) } },
          ...Object.entries(ARROW_MODES).map(([k, label]) => h('option', { value: k, text: label, selected: k === mode })))), control) : null);
      }
      function addLinkForm(state, others, doors) {
        const to = h('select', { aria: { label: 'Link to the room' },
          on: { change: (e) => { state.to = e.target.value; side.value = M.suggestSide(world, selected, state.to); state.side = side.value; } } },
          ...others.map((n) => h('option', { value: n, text: n })));
        const kind = h('select', { aria: { label: 'Leave through' },
          on: { change: (e) => {
            state.kind = e.target.value;
            edgeBox.hidden = state.kind !== 'edge';
            doorBox.hidden = state.kind !== 'door';
            both.parentElement.hidden = state.kind !== 'edge';
          } } },
          h('option', { value: 'edge', text: 'a screen edge' }), h('option', { value: 'door', text: 'a named door' }));
        const side = h('select', { aria: { label: 'Which edge' }, on: { change: (e) => { state.side = e.target.value; } } },
          ...M.SIDES.map((s) => h('option', { value: s, text: s, selected: s === state.side })));
        const door = h('select', { aria: { label: 'Which door' }, on: { change: (e) => { state.door = e.target.value; } } },
          h('option', { value: '', text: doors.length ? '(pick a door)' : '(name a thing in the scene first)' }), ...doors.map((n) => h('option',
            { value: n, text: n })));
        const both = h('input', { type: 'checkbox', checked: true, aria: { label: 'Both ways' },
          on: { change: (e) => { state.both = e.target.checked; } } });
        const edgeBox = h('span', {}, ' ', side);
        const doorBox = h('span', { hidden: true }, ' ', door);
        return h('div', { class: 'kind-field' }, h('h4', { text: 'Add a link' }),
          h('div', { class: 'toolbar' }, field('To', to), field('Leave through', kind), edgeBox, doorBox, h('label', { class: 'state-line' }, both,
            ' and back again')),
          button({ text: 'Add the link', class: 'small primary', onClick: () => {
            const via = state.kind === 'edge' ? { kind: 'edge', side: state.side } : { kind: 'thing', name: state.door };
            if (via.kind === 'thing' && !via.name) {
              studio.toasts.show('Pick a door first: name a thing in the scene (its Name box), then it is here.', { kind: 'info' });
              return;
            }
            attempt(() => M.addLink(world, { from: selected, to: state.to, via }, state.both).world);
          } }));
      }

      // ---- the toolbar and the whole panel ----
      function draw() {
        sizes = Object.fromEntries(Object.entries(world.rooms).map(([n, r]) => [n, r.file ? M.roomSize(read(r.file), r.file) : null]));
        const used = new Set(Object.values(world.rooms).map((r) => r.file));
        const free = M.roomFiles(studio.project?.list() ?? []).filter((f) => !used.has(f));
        fill(toolbar, h('select', { aria: { label: 'Add a room' }, disabled: !free.length && has, on: { change: (e) => {
          const f = e.target.value;
          e.target.value = '';
          if (f) attempt(() => { const r = M.addRoom(world, f); selected = r.room; return r.world; });
        } } }, h('option', { value: '', text: free.length ? 'Add a room…' : 'No scenes or levels left to add' }), ...free.map((f) => h('option',
          { value: f, text: f }))));
        const show = has || Object.keys(world.rooms).length > 0;
        body.hidden = !show;
        help.hidden = !show;
        issues.hidden = !show;
        empty.hidden = show;
        toolbar.hidden = !studio.project;
        if (!show) {
          fill(empty, h('h3', { text: problem ? 'The world file needs fixing' : 'No world yet' }), h('p', { text: problem || HINT }),
            problem || !free.length ? (free.length ? null : h('p', { class: 'dim',
              text: 'There are no scenes or levels in this project yet. Make one in the Scene or Level panel.' }))
              : button({ text: 'Make a world from my scenes and levels', class: 'primary', onClick: makeFromAll }));
          return;
        }
        drawBoard();
        drawInspector();
        const found = M.worldProblems(world, M.knownNames(world, read));
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
      }
      function makeFromAll() {
        let next = M.newWorld();
        for (const f of M.roomFiles(studio.project.list()).slice(0, M.WORLD_LIMITS.rooms)) next = M.addRoom(next, f).world;
        selected = next.start;
        edit(next);
        flush();
      }
      async function renameRoom() {
        const to = await promptText({ title: 'Rename the room', label: 'New name', value: selected, confirmLabel: 'Rename',
          validate: (v) => (v.trim() === selected ? null : M.nameProblem(world, v.trim())) });
        if (to === undefined || to.trim() === selected) return;
        attempt(() => { const next = M.renameRoom(world, selected, to.trim()); selected = to.trim(); return next; });
      }

      studio.on('file-changed',
        (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); else if (e.path !== FILE) draw(); });
      studio.on('project', load);
      let listed = '';
      studio.on('files', () => {
        const now = JSON.stringify(studio.project?.list() ?? []);
        if (!has) load(); else if (now !== listed) draw();
        listed = now;
      });
      load();
      return { el, focus: () => el.querySelector('button, select')?.focus(), onShow: load, dispose: () => flush() };
    },
  };
}
