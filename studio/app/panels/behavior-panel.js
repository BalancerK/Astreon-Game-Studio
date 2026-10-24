// The Behaviours panel: give a kind of thing things to do by itself, with no code. Pick a kind (enemy, coin, turret...), add behaviours to it from a list (pace, follow,
// shoot, has health, hurt on touch...), set them with sliders, and try it in the arena: your mouse is the hero, a click adds one of the kind. Kept in `src/behaviors.js`;
// the game runs it with `behaviors(table)` once and `behave(game, dt, keys)` every tick.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/behavior-model.js';
import { newGame, spawn, all } from '../../../packages/arcade/src/things.js';
import { behaviors, behave } from '../../../packages/arcade/src/behaviors.js';
import { drawThings } from '../../../packages/arcade/src/draw.js';
import { loadMap } from '../../../packages/arcade/src/map.js';

const FILE = 'src/behaviors.js';
const ARENA = { w: 480, h: 320 };
const DT = 1 / 60;
const SIZE = 22;
// walls in the arena, so "go to" and "keep away" have something to go round
const WALLS = [
  '###############',
  '#.............#',
  '#.....#.......#',
  '#.....#.......#',
  '#.....#.......#',
  '#.....#...#...#',
  '#.............#',
  '#.......#.....#',
  '#.......#.....#',
  '###############',
];
const HINT = 'Give a kind of thing (an enemy, a coin, a turret) things to do by itself, with no code. '
  + 'Start from a ready-made kind and change it.';

const hue = (kind) => [...kind].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);

export function behaviorPanel(studio) {
  return {
    id: 'behaviors',
    title: 'Behaviours',
    icon: 'edit',
    create() {
      let table = {};
      let current = null;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let game = newGame();
      let mouse = { x: ARENA.w / 2, y: ARENA.h / 2 };
      let timer = 0;

      const picker = h('select', {
        class: 'art-select', aria: { label: 'Kind of thing' }, on: { change: () => { current = picker.value; restart(); draw(); } },
      });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const arena = h('canvas', {
        width: ARENA.w, height: ARENA.h, class: 'particle-view', tabindex: '0',
        aria: { label: 'Arena: your mouse is the hero. Click to add one of the kind.' },
      });
      const note = h('div', { class: 'dim particle-count', role: 'status' });
      const cards = h('div', { class: 'behavior-cards' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'particle-body' }, h('div', { class: 'particle-left' }, arena, note), cards);
      const el = h('div', { class: 'panel-body art behaviors', 'aria-label': 'Behaviours' }, toolbar, body, issues, help, empty);
      const list = () => table[current] ?? [];

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { table = raw ? M.parseBehaviors(raw) : {}; } catch (error) { table = {}; problem = error.message; }
        if (!(current in table)) current = Object.keys(table)[0] ?? null;
        restart();
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(table).length) return;
        const out = M.serializeBehaviors(table);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function change(next, { redraw = true } = {}) {
        table = { ...table, [current]: next };
        save();
        useTable();
        if (redraw) draw(); else drawNotes();
      }

      // ---- the arena ----
      function useTable() {
        const withHero = 'hero' in table ? table : { ...table, hero: M.STARTERS.hero() };
        behaviors(withHero);
      }
      function addOne(x, y) {
        if (!current || current === 'hero') return;
        spawn(game, current, { x: x - SIZE / 2, y: y - SIZE / 2, w: SIZE, h: SIZE, color: `hsl(${hue(current)} 70% 60%)` });
      }
      function restart() {
        game = newGame();
        loadMap(game, WALLS, { '#': { kind: 'wall', color: '#2f3a55' } }, 32);
        useTable();
        spawn(game, 'hero', { x: mouse.x - SIZE / 2, y: mouse.y - SIZE / 2, w: SIZE, h: SIZE, color: '#8b8bff' });
        addOne(90, 80);
        addOne(390, 240);
      }
      function tick() {
        if (!el.isConnected || !el.offsetParent || !current) return;
        let hero = all(game, 'hero')[0];
        if (!hero) {
          game.heroGone = (game.heroGone ?? 0) + DT;
          if (game.heroGone > 1) { game.heroGone = 0; hero = spawn(game, 'hero', { w: SIZE, h: SIZE, color: '#8b8bff' }); }
        }
        if (hero) { hero.x = mouse.x - SIZE / 2; hero.y = mouse.y - SIZE / 2; }
        behave(game, DT, new Set());
        paint();
      }
      function paint() {
        const g = arena.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, ARENA.w, ARENA.h);
        for (const t of game.things) if (t.kind !== 'hero' && !t.color) t.color = `hsl(${hue(t.kind)} 70% 60%)`;
        drawThings(g, game, {});
        g.font = '11px system-ui, sans-serif';
        g.fillStyle = '#e6e9f0';
        g.textAlign = 'center';
        for (const t of game.things) if (t.hp !== undefined) g.fillText(`${t.kind} ♥${t.hp}`, t.x + t.w / 2, t.y - 4);
        g.textAlign = 'left';
        g.fillText(`score ${game.score ?? 0}`, 8, 16);
        note.textContent = current === 'hero' ? 'Move the mouse: you are the hero.' : `Move the mouse: you are the hero. Click to add a ${current}.`;
      }
      const spot = (event) => {
        const box = arena.getBoundingClientRect();
        return { x: ((event.clientX - box.left) / box.width) * ARENA.w, y: ((event.clientY - box.top) / box.height) * ARENA.h };
      };
      arena.addEventListener('pointermove', (event) => { mouse = spot(event); });
      arena.addEventListener('pointerdown', (event) => { mouse = spot(event); addOne(mouse.x, mouse.y); });

      // ---- the cards ----
      function control(index, name, p, value) {
        const label = `${p.label}`;
        const set = (v) => change(M.setParam(list(), index, name, v), { redraw: false });
        if (p.kind === 'number') {
          const out = h('output', { text: String(Math.round(value * 100) / 100) });
          const input = h('input', {
            type: 'range', min: String(p.min), max: String(p.max), step: String(p.step), value: String(value),
              aria: { label: `${label} (${M.BEHAVIORS[list()[index].type].label})` },
          });
          input.addEventListener('input', () => { out.textContent = String(Math.round(Number(input.value) * 100) / 100); set(Number(input.value)); });
          return h('label', { class: 'sound-slider' }, h('span', { text: label }), input, out);
        }
        if (p.kind === 'choice') {
          return h('label', { class: 'state-line' }, `${label} `, h('select', {
            aria: { label }, on: { change: (e) => change(M.setParam(list(), index, name, e.target.value)) },
          }, ...p.choices.map((c) => h('option', { value: c, text: c, selected: c === value }))));
        }
        if (p.kind === 'flag') {
          return h('label', { class: 'art-inline' }, h('input', { type: 'checkbox', checked: value, on: { change: (e) => set(e.target.checked) } }),
            ` ${label}`);
        }
        return h('label', { class: 'state-line' }, `${label} `, h('input', {
          type: 'text', value, size: '10', spellcheck: false, aria: { label }, on: { change: (e) => change(M.setParam(list(), index, name,
            e.target.value.trim()), { redraw: false }) },
        }));
      }
      function card(b, index) {
        const kind = M.BEHAVIORS[b.type];
        return h('div', { class: 'behavior-card' },
          h('div', { class: 'state-tr-head' }, h('strong', { text: kind.label }),
            button({ text: '↑', class: 'small ghost', disabled: index === 0, aria: { label: 'Run this earlier' },
              onClick: () => change(M.moveBehavior(list(), index, -1)) }),
            button({ text: '↓', class: 'small ghost', disabled: index === list().length - 1, aria: { label: 'Run this later' },
              onClick: () => change(M.moveBehavior(list(), index, 1)) }),
            button({ text: '×', class: 'small ghost', aria: { label: `Remove ${kind.label}` }, onClick: () => change(M.removeBehavior(list(),
              index)) })),
          h('p', { class: 'dim state-says', text: kind.help }),
          ...Object.entries(kind.params).map(([name, p]) => control(index, name, p, b[name])));
      }

      // ---- the parts ----
      function drawNotes() {
        const found = M.behaviorProblems(list());
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
        const others = M.mentions(list()).filter((k) => !(k in table) && k !== current);
        const more = others.length ? `\n\n// it mentions: ${others.join(', ')} (make things of those kinds in your game)` : '';
        const head = `import behaviorTable from './behaviors.js';\nimport { behaviors, behave, hurt } from '@engine/arcade';\n\n`;
        help.querySelector('pre').textContent = head
          + `behaviors(behaviorTable);               // once: every kind gets its behaviours\n`
          + `spawn(game, '${current}', { x: 100, y: 100, w: 24, h: 24 });\n`
          + `behave(game, dt, keys);                 // every tick\n`
          + `hurt(game, thing, 1);                   // when something hits a thing that has health${more}`;
      }
      function draw() {
        const names = Object.keys(table);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = !names.length;
        const starters = h('select', {
          aria: { label: 'Start a new kind from' }, on: { change: (e) => { if (e.target.value) newKind(e.target.value); } },
        }, h('option', { value: '', text: 'New kind from…' }), ...Object.keys(M.STARTERS).map((n) => h('option', { value: n, text: n })),
        h('option', { value: '_blank', text: 'an empty kind' }));
        const adder = h('select', {
          aria: { label: 'Add a behaviour' }, on: { change: (e) => { if (e.target.value) add(e.target.value); } },
        }, h('option', { value: '', text: 'Add a behaviour…' }), ...Object.entries(M.BEHAVIORS).map(([type, k]) => h('option', { value: type,
          text: k.label })));
        fill(toolbar, picker, starters, current ? [adder, button({ text: 'Rename', class: 'small ghost', onClick: rename }),
          button({ text: 'Delete', class: 'small ghost', onClick: remove }), button({ text: 'Start the arena again', class: 'small',
            onClick: restart })] : null);
        body.hidden = !current;
        help.hidden = !current;
        issues.hidden = !current;
        empty.hidden = Boolean(current);
        if (!current) {
          fill(empty, h('h3', { text: problem ? 'The behaviours file needs fixing' : 'No behaviours yet' }),
            h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Make an enemy', class: 'primary', onClick: () => newKind('enemy') }));
          return;
        }
        fill(cards, h('p', { class: 'dim', text: `${current}: ${M.summarize(list())}.` }), ...list().map(card),
          list().length ? null : h('p', { class: 'dim', text: 'Use "Add a behaviour…" in the bar above.' }));
        drawNotes();
        paint();
      }
      function add(type) {
        try { change(M.addBehavior(list(), type)); } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); draw(); }
      }

      async function newKind(from) {
        const name = await promptText({
          title: 'Name the kind', label: 'Name of the kind of thing (for example enemy or coin)', value: M.freeName(table,
            from === '_blank' ? 'thing' : from),
          confirmLabel: 'Make it', validate: (v) => M.nameProblem(v.trim(), (n) => n in table),
        });
        if (name === undefined) { draw(); return; }
        table = { ...table, [name.trim()]: from === '_blank' ? [] : M.STARTERS[from]() };
        current = name.trim();
        flush();
        useTable();
        restart();
        draw();
      }
      async function rename() {
        const name = await promptText({
          title: 'Rename the kind', label: 'New name', value: current, confirmLabel: 'Rename', validate: (v) => M.nameProblem(v.trim(),
            (n) => n !== current && n in table),
        });
        if (name === undefined || name.trim() === current) return;
        table = Object.fromEntries(Object.entries(table).map(([k, v]) => [k === current ? name.trim() : k, v]));
        current = name.trim();
        flush();
        restart();
        draw();
      }
      function remove() {
        const next = { ...table };
        delete next[current];
        table = next;
        current = Object.keys(table)[0] ?? null;
        flush();
        restart();
        draw();
      }

      timer = setInterval(tick, 1000 / 60);
      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(table).length) load(); });
      load();
      return { el, focus: () => picker.focus(), onShow: load, dispose: () => { clearInterval(timer); flush(); } };
    },
  };
}
