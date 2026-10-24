// The UI panel: lay out menus and HUDs by dragging. A screen is a set of widgets (text, panels, buttons, bars, pictures), each pinned to a corner, an edge or the middle
// of the screen so the layout works at any size. The picture is drawn by the same code the game uses (`drawUi` from @engine/arcade), so what you see is what you get;
// the numbers it shows (`Score: {score}`) take test values you can change. Kept in `src/ui.js`.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/ui-model.js';
import { parseSprite } from '../paint/sprite-model.js';
import { drawUi, layoutUi, uiButtons } from '../../../packages/arcade/src/ui.js';

const FILE = 'src/ui.js';
const ART = /^src\/art\/([\w-]+)\.js$/;
const HANDLE = 9;
const BG = '#12161f';
const ANCHOR_WORDS = {
  'top-left': 'top left', top: 'top', 'top-right': 'top right', left: 'left', center: 'middle', right: 'right',
  'bottom-left': 'bottom left', bottom: 'bottom', 'bottom-right': 'bottom right',
};
const HINT = 'A screen is a menu or a HUD. Drag text, buttons, bars and pictures into place; they stay pinned to the corner or edge you choose, '
  + 'so the layout works at any size. Start from a ready-made screen and change it.';

export function uiPanel(studio) {
  return {
    id: 'ui',
    title: 'UI',
    icon: 'edit',
    create() {
      let screens = {};
      let current = null;
      let selected = -1;
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let snap = 4;
      let values = {};
      let focusId = '';
      let drag = null;

      const picker = h('select', {
        class: 'art-select', aria: { label: 'Screen to edit' }, on: { change: () => { current = picker.value; selected = -1; draw(); } },
      });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const canvas = h('canvas', { class: 'ui-canvas', tabindex: '0',
        aria: { label: 'The screen. Drag a widget to move it; arrow keys nudge the picked one.' } });
      const list = h('div', { class: 'ui-list', role: 'listbox', aria: { label: 'Widgets, the last is on top' } });
      const inspector = h('div', { class: 'ui-inspector' });
      const tests = h('div', { class: 'ui-tests' });
      const issues = h('details', { class: 'art-help text-issues' }, h('summary'), h('ul'));
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const side = h('div', { class: 'ui-side' }, list, inspector, tests);
      const body = h('div', { class: 'ui-body' }, h('div', { class: 'ui-stage' }, canvas), side);
      const el = h('div', { class: 'panel-body art ui', 'aria-label': 'UI screens' }, toolbar, body, issues, help, empty);
      const screen = () => screens[current];
      const widget = () => screen()?.widgets[selected];
      const size = () => M.sizeOf(screen());

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { screens = raw ? M.parseUi(raw) : {}; } catch (error) { screens = {}; problem = error.message; }
        if (!(current in screens)) current = Object.keys(screens)[0] ?? null;
        selected = -1;
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !Object.keys(screens).length) return;
        const out = M.serializeUi(screens);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function change(next, { index = selected, redraw = true } = {}) {
        if (next === screen()) return;
        screens = { ...screens, [current]: next };
        selected = index;
        save();
        if (redraw) draw(); else { paint(); drawNotes(); }
      }

      // ---- the picture ----
      function sprites() {
        const out = {};
        for (const path of studio.project?.list() ?? []) {
          const name = ART.exec(path)?.[1];
          if (!name) continue;
          try { out[name] = parseSprite(studio.project.readText(path)); } catch { /* a damaged sprite just shows as a dashed box */ }
        }
        return out;
      }
      const sample = () => M.sampleGame(screen(), values);
      function paint() {
        const s = screen();
        if (!s) return;
        const { width, height } = size();
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const g = canvas.getContext('2d');
        g.fillStyle = BG;
        g.fillRect(0, 0, width, height);
        if (snap > 1) {
          g.fillStyle = '#232a3a';
          for (let x = 0; x < width; x += snap * 4) for (let y = 0; y < height; y += snap * 4) g.fillRect(x, y, 1, 1);
        }
        drawUi(g, s, sample(), { size: { width, height }, focus: focusId, art: sprites() });
        const w = widget();
        if (w) {
          const b = M.placeOf(w, size());
          g.strokeStyle = '#8b8bff';
          g.lineWidth = 1.5;
          g.setLineDash([5, 3]);
          g.strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1);
          g.setLineDash([]);
          g.fillStyle = '#8b8bff';
          g.fillRect(b.x + b.w - HANDLE / 2, b.y + b.h - HANDLE / 2, HANDLE, HANDLE);
        }
      }

      // ---- mouse and keys on the picture ----
      const spot = (event) => {
        const box = canvas.getBoundingClientRect();
        return { x: ((event.clientX - box.left) / box.width) * canvas.width, y: ((event.clientY - box.top) / box.height) * canvas.height };
      };
      function widgetAt(x, y) {
        const boxes = layoutUi(screen(), sample(), { size: size() });
        for (let i = boxes.length - 1; i >= 0; i--) {
          const b = boxes[i];
          if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return screen().widgets.indexOf(b.widget);
        }
        return -1;
      }
      canvas.addEventListener('pointerdown', (event) => {
        if (!screen()) return;
        const p = spot(event);
        const w = widget();
        if (w) {
          const b = M.placeOf(w, size());
          if (Math.abs(p.x - (b.x + b.w)) <= HANDLE && Math.abs(p.y - (b.y + b.h)) <= HANDLE) {
            drag = { mode: 'resize' };
            canvas.setPointerCapture?.(event.pointerId);
            return;
          }
        }
        const hit = widgetAt(p.x, p.y);
        selected = hit;
        if (hit >= 0) {
          const b = M.placeOf(screen().widgets[hit], size());
          drag = { mode: 'move', dx: p.x - b.x, dy: p.y - b.y };
          canvas.setPointerCapture?.(event.pointerId);
        }
        paint();
        drawList();
        drawInspector();
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!drag || selected < 0) return;
        const p = spot(event);
        const next = drag.mode === 'move' ? M.moveWidgetTo(screen(), selected, p.x - drag.dx, p.y - drag.dy, snap)
          : M.resizeWidgetTo(screen(), selected, p.x, p.y, snap);
        screens = { ...screens, [current]: next };
        save();
        paint();
        drawInspector();
      });
      const endDrag = () => { drag = null; };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
      canvas.addEventListener('keydown', (event) => {
        if (!screen() || selected < 0) return;
        const step = event.shiftKey ? 10 : 1;
        const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (move) { event.preventDefault(); change(M.nudgeWidget(screen(), selected, ...move), { redraw: false }); drawInspector(); }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
        if (event.key === 'Escape') { selected = -1; draw(); }
      });

      // ---- the list and the inspector ----
      function drawList() {
        const s = screen();
        fill(list, ...s.widgets.map((w, i) => h('button', {
          type: 'button', role: 'option', class: `ui-item${i === selected ? ' on' : ''}`, 'aria-selected': String(i === selected),
          on: { click: () => { selected = i; paint(); drawList(); drawInspector(); } },
        }, h('span', { class: 'dim', text: M.WIDGET_TYPES[w.type].label }), ' ', h('strong', { text: w.id || '(no id)' }),
        w.text ? h('span', { class: 'dim', text: ` “${w.text.slice(0, 18)}”` }) : null)).reverse());
      }
      const field = (label, value, apply, props = {}) => h('label', { class: 'state-line' }, `${label} `, h('input', {
        type: 'text', value: String(value ?? ''), spellcheck: false, size: '9', aria: { label }, ...props,
        on: { change: (e) => apply(e.target.value) },
      }));
      const numberField = (label, value, key, min) => h('label', { class: 'state-line' }, `${label} `, h('input', {
        type: 'number', value: String(Math.round(value)), step: '1', min: min === undefined ? undefined : String(min), aria: { label },
          style: { width: '5em' },
        on: { change: (e) => { if (e.target.value !== '') change(M.updateWidget(screen(), selected, { [key]: Number(e.target.value) }),
          { redraw: false }); drawInspector(); } },
      }));
      const colorField = (label, value, key) => h('label', { class: 'state-line' }, `${label} `, h('input', {
        type: 'color', value: String(value).slice(0, 7).length === 7 ? String(value).slice(0, 7) : '#ffffff', aria: { label },
        on: { change: (e) => change(M.updateWidget(screen(), selected, { [key]: e.target.value }), { redraw: false }) },
      }));
      const set = (key) => (v) => change(M.updateWidget(screen(), selected, { [key]: v }), { redraw: false });

      function drawInspector() {
        const w = widget();
        if (!w) { fill(inspector, h('p', { class: 'dim',
          text: 'Click a widget in the picture or the list to change it. Drag its corner square to resize it.' })); return; }
        const kind = M.WIDGET_TYPES[w.type];
        const ids = [];
        fill(inspector, h('h4', {}, kind.label, ' ', h('code', { text: w.id || '(no id)' })),
          field('Name (id)', w.id, (v) => change(M.updateWidget(screen(), selected, { id: v.trim() }), { redraw: false }), { placeholder: 'play' }),
          h('label', { class: 'state-line' }, 'Pinned to ', h('select', {
            aria: { label: 'Pinned to' }, on: { change: (e) => change(M.setAnchor(screen(), selected, e.target.value), { redraw: false }) },
          }, ...M.ANCHORS.map((a) => h('option', { value: a, text: ANCHOR_WORDS[a], selected: a === w.anchor })))),
          h('div', { class: 'state-line' }, numberField('x', w.x, 'x'), numberField('y', w.y, 'y'), numberField('Wide', w.w, 'w', 1),
            numberField('High', w.h, 'h', 1)),
          ...(w.type === 'label' || w.type === 'button' ? [
            field('Words', w.text, set('text'), { size: '18', placeholder: 'Score: {score}  or  @start' }),
            h('div', { class: 'state-line' }, numberField('Size', w.size, 'size', 6), colorField('Color', w.color, 'color'),
              h('select', { aria: { label: 'Align' }, on: { change: (e) => change(M.updateWidget(screen(), selected, { align: e.target.value }),
                { redraw: false }) } },
                ...['left', 'center', 'right'].map((a) => h('option', { value: a, text: a, selected: w.align === a })))),
          ] : []),
          ...(w.type === 'panel' || w.type === 'button' || w.type === 'bar' ? [
            h('div', { class: 'state-line' }, colorField('Fill', w.bg, 'bg'), colorField('Border', w.border || '#000000', 'border'),
              numberField('Corners', w.radius, 'radius', 0),
              button({ text: 'No border', class: 'small ghost', onClick: () => change(M.updateWidget(screen(), selected, { border: '' }),
                { redraw: false }) })),
          ] : []),
          ...(w.type === 'button' ? [colorField('Lit when chosen', w.bgFocus, 'bgFocus')] : []),
          ...(w.type === 'bar' ? [
            field('Shows', w.value, set('value'), { placeholder: 'hp' }), field('Full is', w.max,
              (v) => set('max')(Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : v.trim())),
            h('div', { class: 'state-line' }, colorField('Bar', w.color, 'color'), colorField('Nearly empty', w.lowColor, 'lowColor')),
          ] : []),
          ...(w.type === 'image' ? [h('label', { class: 'state-line' }, 'Sprite ', h('select', {
            aria: { label: 'Sprite' }, on: { change: (e) => change(M.updateWidget(screen(), selected, { sprite: e.target.value }),
              { redraw: false }) },
          }, h('option', { value: '', text: '(none)' }), ...Object.keys(sprites()).map((n) => h('option', { value: n, text: n,
            selected: n === w.sprite }))))] : []),
          field('Only shows when', w.showIf ?? '', (v) => set('showIf')(v.trim() || undefined), { placeholder: 'lives   or   !paused' }),
          h('div', { class: 'state-line' },
            button({ text: 'Copy', class: 'small', onClick: duplicateSelected }),
            button({ text: 'Send back', class: 'small', disabled: selected === 0, onClick: () => reorder(-1) }),
            button({ text: 'Bring forward', class: 'small', disabled: selected === screen().widgets.length - 1, onClick: () => reorder(1) }),
            button({ text: 'Remove', class: 'small ghost', onClick: removeSelected })));
        void ids;
      }

      function drawTests() {
        const s = screen();
        const paths = M.pathsOf(s);
        const buttons = uiButtons(s, sample());
        const game = sample();
        const shown = (path) => path.split('.').reduce((o, k) => o?.[k], game) ?? 0;
        fill(tests, h('h4', { text: 'Try it' }),
          buttons.length ? h('label', { class: 'state-line' }, 'Lit button ', h('select', {
            aria: { label: 'Which button is lit' }, on: { change: (e) => { focusId = e.target.value; paint(); } },
          }, h('option', { value: '', text: '(none)' }), ...buttons.map((b) => h('option', { value: b, text: b, selected: b === focusId })))) : null,
          ...paths.map((p) => h('label', { class: 'state-line' }, `${p} = `, h('input', {
            type: 'text', size: '6', spellcheck: false, value: String(shown(p)),
            aria: { label: `Test value of ${p}` }, on: { change: (e) => { values = { ...values, [p]: parseTest(e.target.value) }; paint(); } },
          }))),
          paths.length ? null : h('p', { class: 'dim', text: 'Put {score} in some text, or point a bar at a number, to try values here.' }));
      }
      const parseTest = (text) => {
        const t = String(text).trim();
        if (t === 'true') return true;
        if (t === 'false') return false;
        return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
      };

      function drawNotes() {
        const s = screen();
        const found = M.uiProblems(s, size());
        issues.hidden = !found.length;
        issues.querySelector('summary').textContent = `${found.length} thing${found.length === 1 ? '' : 's'} to look at`;
        fill(issues.querySelector('ul'), ...found.map((p) => h('li', { class: 'text-missing', text: p.message })));
        const hasButtons = s.widgets.some((w) => w.type === 'button');
        const imports = hasButtons ? 'drawUi, uiHit, uiNext' : 'drawUi';
        const draws = `drawUi(g, ui.${current}, game${hasButtons ? ', { focus }' : ''});   // in render, after the game`;
        const hit = `const clicked = uiHit(ui.${current}, mouse.x, mouse.y);   // the id of the button under the mouse, or null`;
        const next = `focus = uiNext(ui.${current}, focus, +1);       // arrow keys: the next button`;
        help.querySelector('pre').textContent = `import ui from './ui.js';\nimport { ${imports} } from '@engine/arcade';\n\n${draws}`
          + (hasButtons ? `\n${hit}\n${next}` : '');
      }

      // ---- the parts ----
      function draw() {
        const names = Object.keys(screens);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = !names.length;
        const starters = h('select', {
          aria: { label: 'Start a new screen from' }, on: { change: (e) => { if (e.target.value) newScreen(e.target.value); } },
        }, h('option', { value: '', text: 'New screen from…' }), ...Object.keys(M.STARTERS).map((n) => h('option', { value: n, text: n })),
        h('option', { value: '_blank', text: 'an empty screen' }));
        const adder = h('select', {
          aria: { label: 'Add a widget' }, on: { change: (e) => { if (e.target.value) add(e.target.value); e.target.value = ''; } },
        }, h('option', { value: '', text: 'Add…' }), ...Object.entries(M.WIDGET_TYPES).map(([type, k]) => h('option', { value: type,
          text: k.label })));
        const sizes = h('select', { aria: { label: 'Screen size' }, on: { change: (e) => resize(e.target.value) } },
          ...M.SIZES.map(([w, hh]) => h('option', {
            value: `${w}x${hh}`, text: `${w} × ${hh}`, selected: current && w === size().width && hh === size().height,
          })));
        const snaps = h('select', { aria: { label: 'Snap to a grid' }, on: { change: (e) => { snap = Number(e.target.value); paint(); } } },
          ...[[1, 'no grid'], [4, 'grid 4'], [8, 'grid 8'], [16, 'grid 16']].map(([n, t]) => h('option', { value: n, text: t,
            selected: n === snap })));
        fill(toolbar, picker, starters, current ? [adder, sizes, snaps,
          button({ text: 'Rename', class: 'small ghost', onClick: rename }), button({ text: 'Delete', class: 'small ghost',
            onClick: removeScreen })] : null);
        body.hidden = !current;
        help.hidden = !current;
        empty.hidden = Boolean(current);
        if (!current) {
          issues.hidden = true;
          fill(empty, h('h3', { text: problem ? 'The UI file needs fixing' : 'No screens yet' }), h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Make a menu', class: 'primary', onClick: () => newScreen('menu') }));
          return;
        }
        paint();
        drawList();
        drawInspector();
        drawTests();
        drawNotes();
      }
      function add(type) {
        try {
          const made = M.addWidget(screen(), type);
          change(made.screen, { index: made.index });
        } catch (error) { studio.toasts.show(error.message, { kind: 'error' }); }
      }
      function duplicateSelected() {
        try { const made = M.duplicateWidget(screen(), selected); change(made.screen, { index: made.index }); } catch (error) {
          studio.toasts.show(error.message, { kind: 'error' });
        }
      }
      function reorder(by) {
        const moved = M.moveWidgetOrder(screen(), selected, by);
        change(moved.screen, { index: moved.index });
      }
      function removeSelected() {
        if (selected < 0) return;
        change(M.removeWidget(screen(), selected), { index: -1 });
      }
      function resize(text) {
        const [w, hh] = text.split('x').map(Number);
        change(M.setSize(screen(), w, hh));
      }

      async function newScreen(from) {
        const name = await promptText({
          title: 'Name the screen', label: 'Name (for example hud or menu)', value: M.freeName(screens, from === '_blank' ? 'screen' : from),
            confirmLabel: 'Make it',
          validate: (v) => M.nameProblem(v.trim(), (n) => n in screens),
        });
        if (name === undefined) { draw(); return; }
        screens = { ...screens, [name.trim()]: from === '_blank' ? { widgets: [] } : M.STARTERS[from]() };
        current = name.trim();
        selected = -1;
        values = {};
        flush();
        draw();
      }
      async function rename() {
        const name = await promptText({
          title: 'Rename the screen', label: 'New name', value: current, confirmLabel: 'Rename', validate: (v) => M.nameProblem(v.trim(),
            (n) => n !== current && n in screens),
        });
        if (name === undefined || name.trim() === current) return;
        screens = Object.fromEntries(Object.entries(screens).map(([k, v]) => [k === current ? name.trim() : k, v]));
        current = name.trim();
        flush();
        draw();
      }
      function removeScreen() {
        const next = { ...screens };
        delete next[current];
        screens = next;
        current = Object.keys(screens)[0] ?? null;
        selected = -1;
        flush();
        draw();
      }

      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !Object.keys(screens).length) load(); });
      load();
      return { el, focus: () => picker.focus(), onShow: load, dispose: flush };
    },
  };
}
