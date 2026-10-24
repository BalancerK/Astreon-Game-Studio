// The Scene panel: place the things of a level by dragging them, instead of typing their numbers. A scene is a file in `scenes/` that a game loads with
// `loadScene`, so the picture and the file are the same thing. Click a thing to select it, drag to move, drag a handle to resize, pick a kind in "Add" and click
// to place one. Everything also works from the keyboard (arrows move, Delete removes, the list on the right selects). The logic is in paint/scene-model.js.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/scene-model.js';
import { History } from '../paint/sprite-model.js';
import { assetsOf } from '../store/assets.js';
import { parseSprite } from '../paint/sprite-model.js';
import { settingsOf } from '../store/project-settings.js';
import { parseKinds, placement } from '../paint/kinds-model.js';
import * as F from '../paint/scene-fields.js';
import { sceneFieldProblems } from '../../../packages/arcade/src/kinds.js';

const CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};
const QUICK_KINDS = ['hero', 'coin', 'enemy', 'wall'];
const GRIDS = [0, 4, 8, 16, 32];
const ZOOMS = ['fit', '0.5', '1', '2', '3'];

export function scenePanel(studio) {
  return {
    id: 'scene2d',
    title: 'Scene',
    icon: 'edit',
    create() {
      let path = null;
      let scene = null;
      let history = null;
      let selected = -1;
      let tool = 'select';              // 'select', or a kind to place
      let grid = 16;
      let zoom = 'fit';
      let lastWritten = '';
      let drag = null;
      let hover = null;
      let problem = '';
      const bitmaps = new Map();        // picture path -> {hash, bitmap}

      const picker = h('select', { class: 'art-select', aria: { label: 'Scene to edit' }, on: { change: () => open(picker.value) } });
      const canvas = h('canvas', {
        class: 'art-canvas scene-canvas', tabIndex: 0, role: 'application',
        aria: { label: 'Scene canvas. Arrow keys move the selected thing, Delete removes it, Escape stops placing, square brackets choose.' },
      });
      canvas.style.cursor = 'default';
      const live = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
      const say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 20); };
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const kinds = h('div', { class: 'scene-kinds' });
      const list = h('div', { class: 'scene-list', role: 'listbox', tabIndex: 0, aria: { label: 'Things in the scene' } });
      const props = h('div', { class: 'scene-props' });
      const notes = h('div', { class: 'level-notes', role: 'status' });
      const fieldIssues = h('ul', { class: 'scene-issues', 'aria-label': 'Problems with names and fields' });
      const hint = h('pre', { class: 'learn-code scene-code' });
      const wrap = h('div', { class: 'art-canvas-wrap scene-wrap' }, canvas);
      const side = h('div', { class: 'art-side wide scene-side' },
        h('div', { class: 'art-label', text: 'Add' }), kinds,
        h('div', { class: 'art-label', text: 'Things' }), list,
        h('div', { class: 'art-label', text: 'Selected' }), props, notes, fieldIssues);
      const empty = h('div', { class: 'empty' });
      const stage = h('div', { class: 'art-stage scene-stage' }, wrap, side);
      const el = h('div', { class: 'panel-body art', 'aria-label': 'Scene editor' }, toolbar, stage, hint, live, empty);

      const files = () => M.sceneFiles(studio.project?.list() ?? []);
      const current = () => scene?.things[selected] ?? null;
      /** The kinds the project defines in the Kinds panel (nothing when there is no file or it cannot be read). */
      function kindTable() {
        try { return studio.project?.has('src/kinds.js') ? parseKinds(studio.project.readText('src/kinds.js')) : {}; } catch { return {}; }
      }

      // ---------- keeping the file ----------
      function flush() {
        if (!scene || !path || !studio.project?.has(path)) return;
        const text = M.serializeScene(scene);
        if (text === lastWritten) return;
        lastWritten = text;
        try {
          studio.project.write(path, text);
        } catch (error) { studio.toasts.show(`Could not keep the scene: ${error.message}`, { kind: 'error' }); }
      }
      function commit(next, { record = true } = {}) {
        if (next === scene) return;
        scene = next;
        if (record) history.push(scene);
        flush();
        redraw();
      }
      function open(file) {
        flush();
        path = file && studio.project?.has(file) ? file : null;
        scene = null;
        problem = '';
        selected = -1;
        if (path) {
          try {
            scene = M.parseScene(studio.project.readText(path));
            lastWritten = studio.project.readText(path);
            history = new History(scene);
          } catch (error) { problem = error.message; }
        }
        redraw();
      }

      // ---------- looking ----------
      const unit = () => {
        if (!scene) return 1;
        if (zoom !== 'fit') return Number(zoom);
        const room = Math.max(120, wrap.clientWidth - 16);
        return Math.max(0.1, Math.min(4, room / scene.w));
      };
      function pictureFor(file) {
        const asset = assetsOf(studio.project).find((a) => a.path === file);
        if (!asset) return null;
        const have = bitmaps.get(file);
        if (have?.hash === asset.hash) return have.bitmap;
        if (!have?.loading) {
          bitmaps.set(file, { hash: asset.hash, bitmap: have?.bitmap ?? null, loading: true });
          createImageBitmap(new Blob([asset.bytes], { type: asset.mime })).then((bitmap) => {
            bitmaps.set(file, { hash: asset.hash, bitmap });
            drawCanvas();
          }, () => bitmaps.set(file, { hash: asset.hash, bitmap: null }));
        }
        return have?.bitmap ?? null;
      }
      /** A sprite from src/art drawn as a picture (its first frame), kept until the sprite file changes. */
      const sprites = new Map();
      function spriteFor(name) {
        const path = `src/art/${name}.js`;
        const text = studio.project?.has(path) ? studio.project.readText(path) : null;
        if (text === null) return null;
        const have = sprites.get(name);
        if (have?.text === text) return have.canvas;
        let canvas = null;
        try {
          const sprite = parseSprite(text);
          canvas = document.createElement('canvas');
          canvas.width = sprite.w;
          canvas.height = sprite.h;
          const c = canvas.getContext('2d');
          sprite.frames[0].forEach((row, y) => [...row].forEach((ch, x) => {
            if (!sprite.palette[ch]) return;
            c.fillStyle = sprite.palette[ch];
            c.fillRect(x, y, 1, 1);
          }));
        } catch { canvas = null; }
        sprites.set(name, { text, canvas });
        return canvas;
      }
      function drawCanvas() {
        if (!scene) return;
        const z = unit();
        canvas.width = Math.round(scene.w * z);
        canvas.height = Math.round(scene.h * z);
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
        const g = canvas.getContext('2d');
        g.imageSmoothingEnabled = false;
        const { settings } = settingsOf(studio.textFiles());
        g.fillStyle = settings.background;
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.save();
        g.scale(z, z);
        if (grid > 0 && grid * z >= 6) {
          g.strokeStyle = 'rgba(160, 170, 200, .18)';
          g.lineWidth = 1 / z;
          g.beginPath();
          for (let x = grid; x < scene.w; x += grid) { g.moveTo(x, 0); g.lineTo(x, scene.h); }
          for (let y = grid; y < scene.h; y += grid) { g.moveTo(0, y); g.lineTo(scene.w, y); }
          g.stroke();
        }
        scene.things.forEach((t, i) => {
          const art = !t.image && t.extra?.sprite ? spriteFor(t.extra.sprite) : null;
          if (art) {
            g.drawImage(art, t.x, t.y, t.w, t.h);
          } else if (t.image) {
            const bitmap = pictureFor(t.image);
            if (bitmap) g.drawImage(bitmap, t.x, t.y, t.w, t.h);
            else { g.fillStyle = '#ff2fd0'; g.fillRect(t.x, t.y, t.w, t.h); }
          } else {
            g.fillStyle = t.color ?? M.DEFAULT_THING.color;
            g.fillRect(t.x, t.y, t.w, t.h);
          }
          if (t.emoji) {
            g.font = `${Math.max(8, Math.min(t.w, t.h) * 0.8)}px sans-serif`;
            g.textBaseline = 'middle';
            g.textAlign = 'center';
            g.fillStyle = '#fff';
            g.fillText(t.emoji, t.x + t.w / 2, t.y + t.h / 2);
          }
          if (i === selected) return;
          g.strokeStyle = 'rgba(255, 255, 255, .25)';
          g.lineWidth = 1 / z;
          g.strokeRect(t.x + 0.5 / z, t.y + 0.5 / z, t.w - 1 / z, t.h - 1 / z);
        });
        const t = current();
        if (t) {
          g.strokeStyle = '#7fe0b0';
          g.fillStyle = '#7fe0b0';
          g.lineWidth = 2 / z;
          g.setLineDash([6 / z, 4 / z]);
          for (const link of F.linksFrom(scene, selected, kindTable())) {
            const to = scene.things[link.to];
            g.beginPath();
            g.moveTo(t.x + t.w / 2, t.y + t.h / 2);
            g.lineTo(to.x + to.w / 2, to.y + to.h / 2);
            g.stroke();
            g.beginPath();
            g.arc(to.x + to.w / 2, to.y + to.h / 2, 4 / z, 0, Math.PI * 2);
            g.fill();
          }
          g.setLineDash([]);
          g.strokeStyle = '#ffd23c';
          g.lineWidth = 2 / z;
          g.strokeRect(t.x, t.y, t.w, t.h);
          g.fillStyle = '#ffffff';
          g.strokeStyle = '#1b1f2e';
          g.lineWidth = 1 / z;
          const r = 4 / z;
          for (const handle of M.HANDLES) {
            const hx = handle.includes('w') ? t.x : handle.includes('e') ? t.x + t.w : t.x + t.w / 2;
            const hy = handle.includes('n') ? t.y : handle.includes('s') ? t.y + t.h : t.y + t.h / 2;
            g.fillRect(hx - r, hy - r, r * 2, r * 2);
            g.strokeRect(hx - r, hy - r, r * 2, r * 2);
          }
        }
        if (tool !== 'select' && hover) {
          g.globalAlpha = 0.5;
          const like = [...scene.things].reverse().find((o) => o.kind === tool);
          g.fillStyle = like?.color ?? M.DEFAULT_THING.color;
          g.fillRect(hover.x, hover.y, like?.w ?? M.DEFAULT_THING.w, like?.h ?? M.DEFAULT_THING.h);
          g.globalAlpha = 1;
        }
        g.restore();
        g.strokeStyle = 'rgba(255, 255, 255, .35)';
        g.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
      }

      // ---------- the side ----------
      function drawKinds() {
        const names = [...new Set([...Object.keys(kindTable()), ...QUICK_KINDS, ...M.kindsOf(scene).map((k) => k.kind)])];
        const input = h('input', {
          type: 'text', placeholder: 'new kind', spellcheck: false, aria: { label: 'Name of a new kind of thing' }, style: { width: '7em' },
        });
        const make = () => {
          const kind = input.value.trim();
          if (!/^[A-Za-z_][\w-]{0,23}$/.test(kind)) { notes.textContent = 'A kind is letters and digits, starting with a letter.'; return; }
          setTool(kind);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } });
        fill(kinds,
          names.map((k) => h('button', {
            type: 'button', class: 'btn small', text: k, aria: { pressed: tool === k }, title: `Place a ${k}: click in the scene`,
            on: { click: () => setTool(tool === k ? 'select' : k) },
          })),
          h('span', { class: 'art-inline' }, input, button({ text: 'Add', class: 'small', onClick: make })));
      }
      function setTool(next) {
        tool = next;
        canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
        drawKinds();
        say(tool === 'select' ? 'Selecting' : `Placing ${tool}. Click in the scene.`);
        drawCanvas();
      }
      function drawList() {
        fill(list, scene.things.map((t, i) => h('div', {
          id: `scene-item-${i}`, class: `scene-item${i === selected ? ' on' : ''}`, role: 'option', aria: { selected: i === selected },
          on: { click: () => select(i) },
        }, h('span', { class: 'scene-n', text: String(i + 1) }), h('span', { class: 'name', text: t.kind }),
        h('span', { class: 'meta', text: `${t.x}, ${t.y}` }))));
        list.setAttribute('aria-activedescendant', selected >= 0 ? `scene-item-${selected}` : '');
        list.querySelector('.scene-item.on')?.scrollIntoView?.({ block: 'nearest' });
      }
      function field(label, input) { return h('label', { class: 'scene-field' }, h('span', { text: label }), input); }
      function matchScreen() {
        const { settings } = settingsOf(studio.textFiles());
        commit(M.resizeScene(scene, settings.width, settings.height));
      }
      function drawProps() {
        drawFieldIssues();
        const t = current();
        if (!t) {
          fill(props, h('p', { class: 'dim', text: 'Nothing selected. Click a thing, or choose one in the list.' }),
            h('div', { class: 'scene-size' },
              field('Scene width', numberInput(scene.w, (v) => commit(M.resizeScene(scene, v, scene.h)), SCENE_MIN)),
              field('Height', numberInput(scene.h, (v) => commit(M.resizeScene(scene, scene.w, v)), SCENE_MIN))),
            button({ text: 'Match the game\'s screen', class: 'small', onClick: matchScreen }));
          return;
        }
        const set = (patch) => commit(M.setThing(scene, selected, patch));
        const images = assetsOf(studio.project).filter((a) => a.kind === 'image');
        const image = h('select', { aria: { label: 'Picture' }, on: { change: () => set({ image: image.value || undefined }) } },
          h('option', { value: '', text: '(none: a coloured box)' }),
          images.map((a) => h('option', { value: a.path, text: a.path, selected: t.image === a.path })));
        const arts = studio.project.list().filter((p) => /^src\/art\/[\w-]+\.js$/.test(p)).map((p) => p.slice(8, -3));
        const sprite = h('select', {
          aria: { label: 'Sprite from src/art' },
          on: {
            change: () => {
              const { sprite: _old, ...rest } = t.extra ?? {};
              set({ extra: sprite.value ? { ...rest, sprite: sprite.value } : rest });
            },
          },
        }, h('option', { value: '', text: '(none)' }), arts.map((n) => h('option', { value: n, text: n, selected: t.extra?.sprite === n })));
        const color = h('input', { type: 'text', value: t.color ?? '', placeholder: '#5ac8ff', spellcheck: false, aria: { label: 'Colour' } });
        const hex = /^#[0-9a-f]{6}$/i.test(t.color ?? '') ? t.color : '#5ac8ff';
        const swatch = h('input', { type: 'color', value: hex, aria: { label: 'Pick a colour' } });
        color.addEventListener('change', () => { set({ color: color.value.trim() || undefined }); });
        swatch.addEventListener('change', () => { set({ color: swatch.value }); });
        const emoji = h('input', { type: 'text', value: t.emoji ?? '', placeholder: '🪙', aria: { label: 'Emoji' }, style: { width: '4em' } });
        emoji.addEventListener('change', () => set({ emoji: emoji.value.trim() || undefined }));
        const kind = h('input', { type: 'text', value: t.kind, spellcheck: false, aria: { label: 'Kind' } });
        kind.addEventListener('change', () => {
          const before = scene;
          set({ kind: kind.value.trim() });
          if (scene === before) {
            kind.value = t.kind;
            notes.textContent = 'A kind is letters and digits, starting with a letter.';
          }
        });
        const extra = h('textarea', {
          rows: 2, spellcheck: false, placeholder: '{"vx": 40, "hp": 3}', value: t.extra ? JSON.stringify(t.extra) : '',
          aria: { label: 'Extra fields as JSON' },
        });
        const extraError = h('div', { class: 'error', role: 'alert' });
        extra.addEventListener('change', () => {
          const parsed = M.parseExtra(extra.value);
          extraError.textContent = parsed.error ?? '';
          if (!parsed.error) set({ extra: parsed.value });
        });
        const kindsNow = kindTable();
        const nameBox = h('input', { type: 'text', value: F.nameOf(t), spellcheck: false, placeholder: '(no name)',
          aria: { label: 'Name of this thing' } });
        nameBox.addEventListener('change', () => {
          try {
            commit(F.setName(scene, selected, nameBox.value.trim(), kindsNow));
          } catch (error) {
            notes.textContent = error.message;
            nameBox.value = F.nameOf(t);
          }
        });
        const typed = Object.entries(kindsNow[t.kind]?.fields ?? {}).map(([fname, def]) => {
          const value = F.fieldValue(t, kindsNow, fname);
          const put = (v) => { try { commit(F.setFieldValue(scene, selected, kindsNow, fname,
            v)); } catch (error) { notes.textContent = error.message; } };
          let input;
          if (def.type === 'number') {
            input = h('input', { type: 'number', value: String(value), min: String(def.min), max: String(def.max), step: String(def.step),
              aria: { label: fname }, style: { width: '6em' } });
            input.addEventListener('change', () => put(input.value));
          } else if (def.type === 'flag') {
            input = h('input', { type: 'checkbox', checked: !!value, aria: { label: fname } });
            input.addEventListener('change', () => put(input.checked));
          } else if (def.type === 'choice') {
            input = h('select', { aria: { label: fname } }, def.choices.map((c) => h('option', { value: c, text: c, selected: c === value })));
            input.addEventListener('change', () => put(input.value));
          } else if (def.type === 'ref') {
            const targets = F.targetsFor(scene, selected, def);
            input = h('select', { aria: { label: fname } }, h('option', { value: '',
              text: targets.length || value ? '(nothing)' : '(name a thing first)' }),
              [...new Set([...targets, ...(value && !targets.includes(value) ? [value] : [])])].map((n) => h('option', { value: n, text: n,
                selected: n === value })));
            input.addEventListener('change', () => put(input.value));
          } else {
            input = h('input', { type: 'text', value: String(value ?? ''), aria: { label: fname } });
            input.addEventListener('change', () => put(input.value));
          }
          return field(`${fname}${def.type === 'ref' ? ` (points at ${def.to || 'a thing'})` : ''}`, input);
        });
        fill(props,
          field('Kind', kind), field('Name (so other things can point at it)', nameBox), ...typed,
          h('div', { class: 'scene-size' },
            field('x', numberInput(t.x, (v) => set({ x: v }))), field('y', numberInput(t.y, (v) => set({ y: v }))),
            field('w', numberInput(t.w, (v) => set({ w: v }), 1)), field('h', numberInput(t.h, (v) => set({ h: v }), 1))),
          h('div', { class: 'scene-colour' }, field('Colour', color), swatch, field('Emoji', emoji)),
          field('Picture', image),
          field('Sprite (draw it with drawThings(g, game, art))', sprite),
          field('Extra fields', extra), extraError);
      }
      function drawFieldIssues() {
        const found = scene ? sceneFieldProblems(scene, kindTable()) : [];
        fill(fieldIssues, found.map((p) => h('li', { class: 'text-missing', text: p.message })));
        fieldIssues.hidden = !found.length;
      }
      const SCENE_MIN = M.SCENE_LIMITS.min;
      function numberInput(value, onChange, min = -100000) {
        const input = h('input', { type: 'number', value, min, step: 1, style: { width: '5.5em' } });
        input.addEventListener('change', () => {
          const v = Number(input.value);
          if (Number.isFinite(v)) onChange(Math.round(v));
          input.value = String(value);
        });
        return input;
      }
      function drawToolbar() {
        const select = (label, values, current2, onChange, text) => {
          const s = h('select', { class: 'art-select', aria: { label }, on: { change: () => onChange(s.value) } },
            values.map((v) => h('option', { value: String(v), text: text(v), selected: String(v) === String(current2) })));
          return s;
        };
        fill(toolbar,
          picker, button({ text: 'New scene', icon: 'plus', class: 'small', onClick: newScene }),
          button({ text: 'Undo', class: 'small ghost', disabled: !history?.canUndo, onClick: undo }),
          button({ text: 'Redo', class: 'small ghost', disabled: !history?.canRedo, onClick: redo }),
          button({ text: 'Copy', class: 'small ghost', disabled: !current(), title: 'Duplicate the selected thing (Ctrl+D)', onClick: duplicate }),
          button({ text: 'Delete', class: 'small ghost', disabled: !current(), title: 'Delete the selected thing (Delete)', onClick: remove }),
          button({ text: 'Forward', class: 'small ghost', disabled: !current(), title: 'Draw it higher (Page Up)', onClick: () => reorder(1) }),
          button({ text: 'Back', class: 'small ghost', disabled: !current(), title: 'Draw it lower (Page Down)', onClick: () => reorder(-1) }),
          select('Snap to the grid', GRIDS, grid, (v) => { grid = Number(v); drawCanvas(); }, (v) => (v ? `Snap ${v}` : 'No snap')),
          select('Zoom', ZOOMS, zoom, (v) => { zoom = v; drawCanvas(); }, (v) => (v === 'fit' ? 'Fit' : `${Number(v) * 100}%`)),
          h('span', { class: 'grow' }),
          button({
            text: 'Run again', icon: 'restart', class: 'small', title: 'Start the game over to see the scene as it is now',
            onClick: () => studio.run({ restart: true }),
          }));
      }

      function redraw() {
        const files2 = files();
        if (path && !files2.includes(path)) { path = null; scene = null; }
        if (!path && files2.length && !problem) open(files2[0]);
        fill(picker, files2.map((f) => h('option', { value: f, text: f.replace(/^scenes\//, ''), selected: f === path })));
        picker.hidden = !files2.length;
        const there = !!studio.project && !!scene;
        stage.hidden = !there;
        hint.hidden = !there;
        empty.hidden = there;
        if (!there) {
          fill(empty, studio.project
            ? [h('h3', { text: problem ? 'This scene cannot be read' : 'No scenes yet' }),
              h('p', { text: problem || 'A scene is the things of a level placed by dragging: heroes, coins, walls. It is a file in scenes/.' }),
              button({ text: 'Make my first scene', icon: 'plus', onClick: newScene })]
            : [h('h3', { text: 'No project open' }), h('p', { text: 'Open a project to make scenes.' })]);
          drawToolbar();
          return;
        }
        if (selected >= scene.things.length) selected = -1;
        drawToolbar();
        drawKinds();
        drawList();
        drawProps();
        notes.textContent = M.warnings(scene).join('. ');
        hint.textContent = M.usageCode(path, scene, Object.keys(kindTable()).length > 0);
        drawCanvas();
      }

      // ---------- doing things ----------
      function select(i, announce = true) {
        selected = i;
        if (i >= 0 && tool !== 'select') tool = 'select';
        drawToolbar();
        drawKinds();
        drawList();
        drawProps();
        drawCanvas();
        const t = current();
        if (announce && t) say(`${t.kind} ${i + 1} of ${scene.things.length}, at ${t.x}, ${t.y}, ${t.w} by ${t.h}`);
      }
      async function newScene() {
        if (!studio.project) return;
        const name = await promptText({
          title: 'New scene', label: 'Name it (for example level1)', confirmLabel: 'Make it',
          value: files().length ? `level${files().length + 1}` : 'level1',
          validate: (v) => {
            if (!/^[a-z][\w-]{0,23}$/i.test(v.trim())) return 'Use letters and numbers, starting with a letter';
            return studio.project.has(`scenes/${v.trim()}.js`) ? 'There is already a scene with that name' : null;
          },
        });
        if (name === undefined) return;
        flush();
        const { settings } = settingsOf(studio.textFiles());
        const file = `scenes/${name.trim()}.js`;
        studio.project.write(file, M.serializeScene(M.newScene(settings.width, settings.height)));
        studio.emit('files');
        open(file);
        canvas.focus();
        studio.emit('plugin-event', 'scene-made');
      }
      const undo = () => { if (history?.canUndo) { scene = history.undo(); flush(); redraw(); } };
      const redo = () => { if (history?.canRedo) { scene = history.redo(); flush(); redraw(); } };
      function remove() {
        if (!current()) return;
        const t = current();
        const at = selected;
        selected = -1;
        commit(M.removeThing(scene, at));
        say(`Deleted ${t.kind}`);
      }
      function duplicate() {
        if (!current()) return;
        const out = M.duplicateThing(scene, selected, grid || 16);
        selected = out.index;
        commit(out.scene);
        say('Copied');
      }
      function reorder(direction) {
        if (!current()) return;
        const out = M.reorderThing(scene, selected, direction);
        selected = out.index;
        commit(out.scene);
      }

      // ---------- the mouse and the keyboard ----------
      const point = (e) => {
        const r = canvas.getBoundingClientRect();
        const z = unit();
        return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z, z };
      };
      canvas.addEventListener('pointerdown', (e) => {
        if (!scene || e.button !== 0) return;
        canvas.focus();
        const p = point(e);
        if (tool !== 'select') {
          const at = { x: M.snap(p.x, grid), y: M.snap(p.y, grid) };
          selected = scene.things.length;
          const kind = tool;
          const next = M.addThing(scene, kind, at.x, at.y, placement(kindTable(), kind));
          if (next === scene) { notes.textContent = `A scene can have at most ${M.SCENE_LIMITS.things} things.`; return; }
          commit(next);
          tool = 'select';
          canvas.style.cursor = 'default';
          select(selected, false);
          say(`Placed ${kind} at ${at.x}, ${at.y}`);
          return;
        }
        const handle = current() ? M.handleAt(current(), p.x, p.y, 6 / p.z) : null;
        if (handle) {
          drag = { type: 'resize', handle, from: p, base: scene, rect: { x: current().x, y: current().y, w: current().w, h: current().h } };
        } else {
          const hit = M.hitTest(scene, p.x, p.y);
          select(hit, true);
          if (hit >= 0) drag = { type: 'move', from: p, base: scene, at: { x: scene.things[hit].x, y: scene.things[hit].y } };
        }
        if (drag) canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!scene) return;
        const p = point(e);
        if (drag) {
          const dx = p.x - drag.from.x;
          const dy = p.y - drag.from.y;
          if (drag.type === 'move') {
            scene = M.setThing(drag.base, selected, { x: M.snap(drag.at.x + dx, grid), y: M.snap(drag.at.y + dy, grid) });
          } else {
            scene = M.setThing(drag.base, selected, M.resizeRect(drag.rect, drag.handle, dx, dy, grid));
          }
          drawCanvas();
          return;
        }
        hover = { x: M.snap(p.x, grid), y: M.snap(p.y, grid) };
        if (tool !== 'select') { drawCanvas(); return; }
        const handle = current() ? M.handleAt(current(), p.x, p.y, 6 / p.z) : null;
        canvas.style.cursor = handle ? CURSORS[handle] : M.hitTest(scene, p.x, p.y) >= 0 ? 'move' : 'default';
      });
      const endDrag = () => {
        if (!drag) return;
        const moved = scene !== drag.base;
        drag = null;
        if (moved) { history.push(scene); flush(); drawList(); drawProps(); notes.textContent = M.warnings(scene).join('. '); }
        drawCanvas();
      };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
      canvas.addEventListener('pointerleave', () => { hover = null; if (tool !== 'select') drawCanvas(); });

      el.addEventListener('keydown', (e) => {
        if (!scene || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
        const inList = e.target === list;
        if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else select(-1, false); return; }
        if (e.key === '[' || (inList && e.key === 'ArrowUp')) {
          e.preventDefault();
          select(Math.max(0, (selected < 0 ? scene.things.length : selected) - 1));
          return;
        }
        if (e.key === ']' || (inList && e.key === 'ArrowDown')) {
          e.preventDefault();
          select(Math.min(scene.things.length - 1, selected + 1));
          return;
        }
        if (!current()) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
        if (e.key === 'PageUp') { e.preventDefault(); reorder(1); return; }
        if (e.key === 'PageDown') { e.preventDefault(); reorder(-1); return; }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (arrows && !inList) {
          e.preventDefault();
          const step = e.altKey ? 1 : (grid || 1) * (e.shiftKey ? 4 : 1);
          commit(M.moveThing(scene, selected, arrows[0] * step, arrows[1] * step, e.altKey ? 0 : grid));
          drawList();
          drawProps();
          const t = current();
          say(`${t.x}, ${t.y}`);
        }
      });

      studio.on('file-changed', (e) => {
        if (e.path === path && studio.project?.readText(path) !== lastWritten && !drag) open(path);
        else if (/^assets\//.test(e.path ?? '')) drawCanvas();
      });
      studio.on('files', redraw);
      studio.on('project', () => { path = null; scene = null; problem = ''; selected = -1; redraw(); });
      new ResizeObserver(() => { if (scene && zoom === 'fit' && el.offsetParent !== null) drawCanvas(); }).observe(wrap);
      redraw();
      return { el, focus: () => (scene ? canvas.focus() : empty.querySelector('button')?.focus()), onShow: redraw, dispose: flush };
    },
  };
}
