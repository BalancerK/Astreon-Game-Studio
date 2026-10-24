// The Level painter: paint your level instead of typing letters. It edits the same list of rows that is in your code (`const LEVEL = [ ... ]`), using the
// legend your game gives to `loadMap`, so the picture and the text are always the same thing and the running game changes as you paint.
import { h, button, fill } from '../ui/dom.js';
import * as L from '../paint/level-model.js';
import * as AT from '../paint/autotile-model.js';
import { parseSprite } from '../paint/sprite-model.js';
import { drawSprite } from '../../../packages/arcade/src/art.js';

const TILE_PX = 28;

export function levelPanel(studio) {
  return {
    id: 'levels',
    title: 'Level',
    icon: 'edit',
    create() {
      let target = null;                  // { file, name }
      let rows = null;
      let legend = [];
      let tool = 'pencil';
      let letter = '#';
      let drag = false;
      let cursor = { x: 0, y: 0 };
      let lastWritten = '';
      let saveTimer = 0;
      const undoStack = [];
      const redoStack = [];

      const picker = h('select', { class: 'art-select', aria: { label: 'Level to paint' }, on: { change: () => choose(picker.value) } });
      const canvas = h('canvas', {
        class: 'art-canvas', tabIndex: 0, role: 'application',
        aria: { label: 'Level canvas. Arrow keys move, Space paints, Delete erases, numbers pick tiles, Control Z undoes.' },
      });
      const live = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const palette = h('div', { class: 'art-palette tiles', role: 'listbox', aria: { label: 'Tiles' } });
      const notes = h('div', { class: 'level-notes', role: 'status' });
      const autoBox = h('div', { class: 'level-auto' });
      let art = {};                        // the project's sprites, by name (the auto-tile pictures a tile may use)
      const empty = h('div', { class: 'empty' });
      const wrap = h('div', { class: 'art-canvas-wrap' }, canvas);
      const side = h('div', { class: 'art-side wide' }, h('div', { class: 'art-label', text: 'Tiles' }), palette, autoBox, notes);
      const stage = h('div', { class: 'art-stage level-stage' }, side, wrap);
      const el = h('div', { class: 'panel-body art', 'aria-label': 'Level painter' }, toolbar, stage, live, empty);

      const say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 20); };
      const texts = () => Object.entries(studio.project?.toFiles() ?? {}).filter(([p, c]) => typeof c === 'string' && p.endsWith('.js'));
      const allLevels = () => texts().flatMap(([file, text]) => L.findLevels(text).map((lv) => ({ file, name: lv.name })));
      const keyOf = (t) => `${t.file}::${t.name}`;
      const legendFor = () => texts().flatMap(([, text]) => L.legendOf(text)).filter((e, i, a) => a.findIndex((x) => x.ch === e.ch) === i);

      function choose(key) {
        flush();
        target = allLevels().find((t) => keyOf(t) === key) ?? null;
        load();
      }
      function load() {
        undoStack.length = 0;
        redoStack.length = 0;
        const there = target && studio.project?.has(target.file);
        const lv = there ? L.findLevels(studio.project.readText(target.file)).find((l) => l.name === target.name) : null;
        rows = lv ? lv.rows : null;
        lastWritten = lv ? studio.project.readText(target.file) : '';
        legend = legendFor();
        art = spritesOf();
        if (rows && !legend.some((e) => e.ch === letter)) letter = legend.find((e) => e.kind === 'wall')?.ch ?? legend[0]?.ch ?? '#';
        draw();
      }
      function change(next, { record = true } = {}) {
        if (next === rows) return;
        if (record) { undoStack.push(rows); redoStack.length = 0; if (undoStack.length > 100) undoStack.shift(); }
        rows = next;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 200);
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!rows || !target || !studio.project?.has(target.file)) return;
        const text = L.writeLevel(studio.project.readText(target.file), target.name, rows);
        if (text !== studio.project.readText(target.file)) { lastWritten = text; studio.project.write(target.file, text); }
      }
      const undo = () => { if (undoStack.length) { redoStack.push(rows); rows = undoStack.pop(); flush(); draw(); } };
      const redo = () => { if (redoStack.length) { undoStack.push(rows); rows = redoStack.pop(); flush(); draw(); } };

      const entry = (ch) => legend.find((e) => e.ch === ch);
      function spritesOf() {
        const out = {};
        for (const path of studio.project?.list() ?? []) {
          const m = /^src\/art\/([\w-]+)\.js$/.exec(path);
          if (!m) continue;
          try { out[m[1]] = parseSprite(studio.project.readText(path)); } catch { /* a damaged sprite is just not shown */ }
        }
        return out;
      }
      /** The picture an auto-tiled tile uses: a sprite with a frame for each shape (found by its file name or its name in camel case). */
      const tilesSprite = (name) => art[name] ?? Object.entries(art).find(([k]) => k.replace(/-(\w)/g, (a, c) => c.toUpperCase()) === name)?.[1];
      function drawTile(g, ch, x, y, size, mask = null) {
        const e = entry(ch);
        if (ch === '.' || ch === ' ') return;
        const auto = mask !== null ? AT.autotileOf(e) : null;
        if (auto) {
          const sprite = auto.sprite ? tilesSprite(auto.sprite) : null;
          if (sprite && sprite.frames.length === AT.AUTOTILE_MODES[auto.mode]) drawSprite(g, sprite, AT.frameFor(mask, auto.mode), x, y, size, size);
          else {
            const width = auto.width ? (auto.width * size) / 32 : undefined;
            AT.drawAutoTile(g, x, y, size, mask, e.color || '#556', { edge: auto.edge || undefined, width });
          }
          return;
        }
        g.fillStyle = e?.color || (e ? '#556' : '#c33');
        if (!e?.emoji) g.fillRect(x, y, size, size);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = e?.emoji ? '#fff' : 'rgba(255,255,255,.85)';
        g.font = `${Math.round(size * (e?.emoji ? 0.8 : 0.5))}px system-ui, "Segoe UI Emoji", sans-serif`;
        g.fillText(e?.emoji || (e?.color ? '' : ch), x + size / 2, y + size / 2 + 1);
        if (!e) { g.fillText(ch, x + size / 2, y + size / 2); }
      }
      function drawCanvas() {
        const w = rows[0].length;
        const fit = Math.floor(Math.min((wrap.clientWidth - 12) / w, (wrap.clientHeight - 12) / rows.length));
        const size = Math.max(6, Math.min(TILE_PX, fit || TILE_PX));
        canvas.width = w * size;
        canvas.height = rows.length * size;
        const g = canvas.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, canvas.width, canvas.height);
        const masks = AT.levelMasks(rows, legend);
        rows.forEach((row, y) => [...row].forEach((ch, x) => drawTile(g, ch, x * size, y * size, size, masks[y][x])));
        g.strokeStyle = 'rgba(128,128,160,.22)';
        g.beginPath();
        for (let x = 0; x <= w; x++) { g.moveTo(x * size + 0.5, 0); g.lineTo(x * size + 0.5, canvas.height); }
        for (let y = 0; y <= rows.length; y++) { g.moveTo(0, y * size + 0.5); g.lineTo(canvas.width, y * size + 0.5); }
        g.stroke();
        g.strokeStyle = '#ffd23c';
        g.lineWidth = 2;
        g.strokeRect(cursor.x * size + 1, cursor.y * size + 1, size - 2, size - 2);
      }

      function draw() {
        const levels = allLevels();
        fill(picker, ...levels.map((t) => h('option', {
          value: keyOf(t), text: `${t.file.replace(/^src\//, '')}: ${t.name}`, selected: target && keyOf(t) === keyOf(target),
        })));
        const has = !!rows;
        stage.hidden = !has;
        empty.hidden = has;
        if (!has) {
          fill(toolbar, picker, button({ text: 'Import Tiled / LDtk…', class: 'small', onClick: () => studio.commands.execute('level.import') }));
          fill(empty, h('h3', { text: 'No level found' }), h('p', {
            text: 'The painter looks for a list of rows of letters in your code, like const LEVEL = [ ... ] with a # and an @ in it. '
              + 'The "Run and jump" game has one.',
          }));
          return;
        }
        const w = rows[0].length;
        const numberInput = (label, value, min, max, on) => h('label', { class: 'art-inline' }, `${label} `, h('input', {
          type: 'number', value: String(value), min: String(min), max: String(max), class: 'num', aria: { label },
          on: { change: (e) => on(Number(e.target.value)) },
        }));
        fill(toolbar, picker,
          button({ text: 'Undo', class: 'small', disabled: !undoStack.length, onClick: undo }),
          button({ text: 'Redo', class: 'small', disabled: !redoStack.length, onClick: redo }),
          numberInput('Width', w, 3, 300, (n) => change(L.resizeRows(rows, n, rows.length))),
          numberInput('Height', rows.length, 3, 100, (n) => change(L.resizeRows(rows, w, n))),
          button({ text: 'Import Tiled / LDtk…', class: 'small', title: 'Bring in a level made in Tiled or LDtk',
            onClick: () => studio.commands.execute('level.import') }),
          button({
            text: 'Walls round the edge', class: 'small', title: 'Put the selected tile all round the edge', onClick: () => change(L.border(rows,
              letter)),
          }),
          ...['pencil', 'fill', 'picker'].map((id) => h('button', {
            type: 'button', class: `btn small${tool === id ? ' primary' : ''}`, text: { pencil: 'Paint', fill: 'Fill', picker: 'Pick' }[id],
            aria: { pressed: tool === id }, on: { click: () => { tool = id; draw(); canvas.focus(); } },
          })));
        const tiles = [{ ch: '.', kind: 'empty air', color: '', emoji: '' }, ...legend];
        fill(palette, ...tiles.map((e, i) => h('button', {
          type: 'button', class: `tile${e.ch === letter ? ' on' : ''}`, role: 'option',
          aria: { selected: e.ch === letter, label: `${e.kind || e.ch}, letter ${e.ch} (${i})` },
          title: `${e.kind || e.ch} (${e.ch})`, on: { click: () => { letter = e.ch; if (tool === 'picker') tool = 'pencil'; draw(); } },
        }, h('span', { class: 'chip', style: { background: e.color || 'transparent' }, text: e.emoji || '' }),
        h('span', { text: `${e.kind || e.ch}  ${e.ch}` }))));
        const unknown = L.unknownLetters(rows,
          legend).map((c) => `The letter "${c}" is not in the legend, so the game will stop with a message. Add it to the loadMap legend.`);
        const found = [...L.warnings(rows), ...unknown];
        fill(notes, ...found.map((t) => h('p', { class: 'warn', text: t })));
        drawCanvas();
        drawAuto();
      }

      // ---- auto-tiling: edges and corners that follow the neighbours ----
      const legendFile = (ch) => texts().find(([, text]) => AT.locateEntry(text, ch))?.[0];
      function editLegend(ch, patch) {
        const file = legendFile(ch);
        if (!file) { studio.toasts.show(`The letter "${ch}" is not in a loadMap legend, so there is nothing to change.`, { kind: 'error' }); return; }
        flush();
        studio.project.write(file, AT.setLegendProps(studio.project.readText(file), ch, patch));
        studio.emit('files');
        load();
      }
      function makePicture(e, auto) {
        const base = e.sprite && tilesSprite(e.sprite) && tilesSprite(e.sprite).frames.length === 1 ? tilesSprite(e.sprite) : null;
        const made = AT.tilesFor(base, e.color, auto.mode, { edge: auto.edge, width: 2 });
        const name = AT.tilesName(e.kind || e.ch);
        const path = `src/art/${(e.kind || 'tile').replace(/[^\w-]/g, '') || 'tile'}-tiles.js`;
        studio.project.write(path, made.file);
        editLegend(e.ch, { sprite: name });
        const how = `import ${name} from './${path.replace('src/', '')}' and give drawThings { ${name} } as its third argument.`;
        studio.toasts.show(`Made ${path} with ${made.sprite.frames.length} pictures. To use it in the game: ${how}`, { kind: 'success', ms: 12000 });
      }
      function drawAuto() {
        const e = entry(letter);
        if (!rows || !e || !e.kind) { fill(autoBox); return; }
        const auto = AT.autotileOf(e);
        const modeSelect = auto ? h('select', {
          aria: { label: 'Which shapes' }, on: { change: (ev) => editLegend(e.ch, { autotile: ev.target.value }) },
        }, h('option', { value: 'edges4', text: 'four sides', selected: auto.mode === 'edges4' }),
        h('option', { value: 'blob47', text: 'sides and corners', selected: auto.mode === 'blob47' })) : null;
        fill(autoBox, h('div', { class: 'art-label', text: `Auto-tiling for ${e.kind} (${e.ch})` }),
          h('label', { class: 'art-inline' }, h('input', {
            type: 'checkbox', checked: Boolean(auto), aria: { label: `Edges of ${e.kind} follow the neighbouring tiles` },
            on: { change: (ev) => editLegend(e.ch, { autotile: ev.target.checked ? 'blob47' : undefined }) },
          }), ' Edges follow the neighbours'),
          auto ? h('div', { class: 'level-auto-more' },
            h('label', { class: 'art-inline' }, 'Shapes ', modeSelect),
            h('label', { class: 'art-inline' }, 'Edge colour ', h('input', {
              type: 'color', value: /^#[0-9a-f]{6}$/i.test(auto.edge) ? auto.edge : '#24304a', aria: { label: 'Edge colour' },
              on: { change: (ev) => editLegend(e.ch, { edge: ev.target.value }) },
            })),
            h('label', { class: 'art-inline' }, 'Edge width ', h('input', {
              type: 'number', min: '1', max: '12', value: String(auto.width || 3), class: 'num', aria: { label: 'Edge width in game pixels' },
              on: { change: (ev) => editLegend(e.ch, { edgeWidth: Math.max(1, Math.min(12, Number(ev.target.value) || 3)) }) },
            })),
            h('label', { class: 'art-inline' }, h('input', {
              type: 'checkbox', checked: auto.open, aria: { label: 'The edge of the map counts as an edge' },
              on: { change: (ev) => editLegend(e.ch, { openEdge: ev.target.checked ? true : undefined }) },
            }), ' The map edge is an edge'),
            h('label', { class: 'art-inline' }, 'Joins with ', h('input', {
              type: 'text', value: auto.terrain === e.ch ? '' : auto.terrain, placeholder: 'only itself', size: '10',
              aria: { label: 'Terrain name: tiles with the same name join' },
              on: { change: (ev) => editLegend(e.ch, { terrain: ev.target.value.trim() || undefined }) },
            })),
            button({
              text: 'Make a picture for it', class: 'small', title: 'A sprite with a frame for every shape, drawn from this tile',
              onClick: () => makePicture(e, auto),
            })) : null);
      }

      const cellAt = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: Math.floor(((e.clientX - r.left) / r.width) * rows[0].length), y: Math.floor(((e.clientY - r.top) / r.height) * rows.length) };
      };
      const ok = (p) => p.x >= 0 && p.y >= 0 && p.y < rows.length && p.x < rows[0].length;
      function apply(p) {
        if (!ok(p)) return;
        cursor = p;
        if (tool === 'picker') { letter = rows[p.y][p.x]; tool = 'pencil'; draw(); return; }
        if (tool === 'fill') { change(L.fillTiles(rows, p.x, p.y, letter)); return; }
        change(L.setTile(rows, p.x, p.y, letter), { record: !drag });
      }
      canvas.addEventListener('pointerdown', (e) => {
        if (!rows) return;
        canvas.setPointerCapture(e.pointerId);
        if (tool === 'pencil') { undoStack.push(rows); redoStack.length = 0; drag = true; }
        apply(cellAt(e));
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!rows) return;
        const p = cellAt(e);
        if (!ok(p)) return;
        if (drag) apply(p); else { cursor = p; drawCanvas(); }
      });
      const stop = () => { if (drag) { drag = false; if (undoStack.length && undoStack.at(-1) === rows) undoStack.pop(); draw(); } };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
      canvas.addEventListener('keydown', (e) => {
        if (!rows) return;
        const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (move && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const clampTo = (v, max) => Math.max(0, Math.min(max, v));
          cursor = { x: clampTo(cursor.x + move[0], rows[0].length - 1), y: clampTo(cursor.y + move[1], rows.length - 1) };
          if (e.shiftKey) apply(cursor); else drawCanvas();
          const ch = rows[cursor.y][cursor.x];
          say(`column ${cursor.x + 1}, row ${cursor.y + 1}: ${entry(ch)?.kind || (ch === '.' ? 'empty' : ch)}`);
        } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); apply(cursor); } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          change(L.setTile(rows, cursor.x, cursor.y, '.'));
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
        } else if (/^[0-9]$/.test(e.key)) {
          const tile = [{ ch: '.' }, ...legend][Number(e.key)];
          if (tile) { letter = tile.ch; draw(); say(`${entry(tile.ch)?.kind || 'empty'} selected`); }
        }
      });

      studio.on('file-changed', (e) => {
        if (!target || drag) return;
        if (e.path === target.file && studio.project?.readText(target.file) !== lastWritten) load(); else draw();
      });
      const reset = () => { target = allLevels()[0] ?? null; load(); };
      studio.on('files', reset);
      studio.on('project', reset);
      new ResizeObserver(() => { if (rows && el.offsetParent !== null) drawCanvas(); }).observe(el);
      reset();
      return { el, focus: () => canvas.focus(), onShow: reset, dispose: flush };
    },
  };
}
