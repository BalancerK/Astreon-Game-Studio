// The Sprite painter: draw pixel art for your game. A sprite is saved as a small file (`src/art/hero.js`) that your game imports, so the picture and the code
// stay together and a change shows in the running game as you paint. Everything works with the keyboard too: arrow keys move the cursor, Space paints.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as S from '../paint/sprite-model.js';
import { animationFrame } from '../../../packages/arcade/src/art.js';

const ART = /^src\/art\/([\w-]+)\.js$/;
const TOOLS = [['pencil', 'Pencil', 'P'], ['eraser', 'Eraser', 'E'], ['fill', 'Fill', 'F'], ['line', 'Line', 'L'], ['rect', 'Box', 'B'],
  ['picker', 'Pick colour', 'I']];
const SIZES = [8, 16, 24, 32, 48, 64];
const MODE_WORDS = { loop: 'round and round', once: 'once, then stops', reverse: 'backwards, round and round', pingpong: 'forwards and back again' };
const LIMITS = [0, 2, 4, 8, 16, 32];

export function spritePanel(studio) {
  return {
    id: 'sprites',
    title: 'Sprites',
    icon: 'edit',
    create() {
      let path = null;                    // the file being painted
      let sprite = null;
      let history = null;
      let frame = 0;
      let tool = 'pencil';
      let letter = 'b';                   // the colour being painted with
      let cursor = { x: 0, y: 0 };
      let drag = null;                    // a stroke in progress: { from, last, points }
      let lastWritten = '';
      let saveTimer = 0;
      let onion = true;
      let animation = '';
      let tiled = studio.prefs.get('sprite.tiled', false);
      let limit = studio.prefs.get('sprite.colorLimit', 0);

      const picker = h('select', { class: 'art-select', aria: { label: 'Sprite to paint' }, on: { change: () => open(picker.value) } });
      const canvas = h('canvas', {
        class: 'art-canvas', tabIndex: 0, role: 'application',
        aria: { label: 'Sprite canvas. Arrow keys move, Space paints, Delete erases, numbers pick colours, Control Z undoes.' },
      });
      const live = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const tools = h('div', { class: 'art-tools', role: 'radiogroup', aria: { label: 'Tools' } });
      const swatches = h('div', { class: 'art-palette', role: 'listbox', aria: { label: 'Colours' } });
      const colorInput = h('input', { type: 'color', class: 'art-color', aria: { label: 'Change the selected colour' } });
      const framesEl = h('div', { class: 'art-frames', role: 'listbox', aria: { label: 'Frames' } });
      const preview = h('canvas', { class: 'art-preview', width: 64, height: 64, aria: { label: 'Animation preview' } });
      const animEl = h('div', { class: 'art-anims' });
      const tilePreview = h('canvas', { class: 'art-preview', width: 96, height: 96,
        aria: { label: 'The frame repeated in a grid, to see how it tiles' } });
      const tileToggle = h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: tiled, aria: { label: 'Show the frame tiled' },
        on: { change: (e) => { tiled = e.target.checked; studio.prefs.set('sprite.tiled', tiled); tilePreview.hidden = !tiled; } } }),
          ' Show it tiled (for textures)');
      tilePreview.hidden = !tiled;
      const paletteEl = h('div', { class: 'art-palette-tools' });
      const paletteBox = h('details', { class: 'art-help' }, h('summary', { text: 'Palette tools' }), paletteEl);
      paletteBox.addEventListener('toggle', () => { if (sprite) drawPalette(); });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const side = h('div', { class: 'art-side' },
        h('div', { class: 'art-label', text: 'Colours' }), swatches, colorInput,
        h('div', { class: 'art-label', text: 'Frames' }), framesEl,
        paletteBox,
        h('div', { class: 'art-label', text: 'Preview' }), preview, animEl, tileToggle, tilePreview);
      const stage = h('div', { class: 'art-stage' }, tools, h('div', { class: 'art-canvas-wrap' }, canvas), side);
      const el = h('div', { class: 'panel-body art', 'aria-label': 'Sprite painter' }, toolbar, stage, help, live, empty);

      const say = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 20); };
      const files = () => studio.project?.list().filter((p) => ART.test(p)) ?? [];
      const nameOf = (p) => ART.exec(p)?.[1] ?? p;

      // ---- loading and saving ----
      function open(next) {
        flush();
        path = next;
        if (!path || !studio.project?.has(path)) { sprite = null; draw(); return; }
        try {
          sprite = S.parseSprite(studio.project.readText(path));
          lastWritten = studio.project.readText(path);
          history = new S.History(sprite);
          frame = 0;
          if (!(letter in sprite.palette)) letter = Object.keys(sprite.palette)[0] ?? '.';
        } catch (error) {
          sprite = null;
          fill(empty, h('h3', { text: nameOf(path) }), h('p', { text: error.message }),
            h('p', { text: 'Fix the file in the Editor panel, then come back.' }));
        }
        draw();
      }
      function commit(next) {
        if (next === sprite) return;
        sprite = next;
        history.push(sprite);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 250);
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!sprite || !path || !studio.project?.has(path)) return;
        const note = /^\/\/ (.*)/.exec(studio.project.readText(path) ?? '')?.[1];      // keep the file's own note (a licence, say)
        const text = S.serializeSprite(sprite, note);
        if (text !== lastWritten) { lastWritten = text; studio.project.write(path, text); }
      }

      // ---- drawing the canvas ----
      const cellSize = () => {
        const wrap = canvas.parentElement.getBoundingClientRect();
        return Math.max(3, Math.min(40, Math.floor(Math.min((wrap.width - 12) / sprite.w, (wrap.height - 12) / sprite.h)) || 8));
      };
      function paintTo(g, spr, f, cell, { grid = false, alpha = 1 } = {}) {
        g.globalAlpha = alpha;
        spr.frames[f].forEach((row, y) => {
          for (let x = 0; x < spr.w; x++) {
            const color = spr.palette[row[x]];
            if (!color) continue;
            g.fillStyle = color;
            g.fillRect(x * cell, y * cell, cell, cell);
          }
        });
        g.globalAlpha = 1;
        if (grid && cell >= 8) {
          g.strokeStyle = 'rgba(128,128,160,.25)';
          g.lineWidth = 1;
          g.beginPath();
          for (let x = 0; x <= spr.w; x++) { g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, spr.h * cell); }
          for (let y = 0; y <= spr.h; y++) { g.moveTo(0, y * cell + 0.5); g.lineTo(spr.w * cell, y * cell + 0.5); }
          g.stroke();
        }
      }
      function shapePoints() {
        if (!drag || !['line', 'rect'].includes(tool)) return [];
        return tool === 'line' ? S.linePoints(drag.from.x, drag.from.y, drag.last.x, drag.last.y) : S.rectPoints(drag.from.x, drag.from.y,
          drag.last.x, drag.last.y);
      }
      function drawCanvas() {
        const cell = cellSize();
        canvas.width = sprite.w * cell;
        canvas.height = sprite.h * cell;
        const g = canvas.getContext('2d');
        for (let y = 0; y < sprite.h; y++) {
          for (let x = 0; x < sprite.w; x++) {
            g.fillStyle = (x + y) % 2 ? '#2a2f40' : '#232838';
            g.fillRect(x * cell, y * cell, cell, cell);
          }
        }
        if (onion && frame > 0) paintTo(g, sprite, frame - 1, cell, { alpha: 0.3 });
        paintTo(g, sprite, frame, cell, { grid: true });
        const color = tool === 'eraser' ? 'rgba(255,255,255,.35)' : sprite.palette[letter] ?? '#fff';
        g.fillStyle = color;
        for (const [x, y] of shapePoints()) g.fillRect(x * cell, y * cell, cell, cell);
        g.strokeStyle = '#ffd23c';
        g.lineWidth = 2;
        g.strokeRect(cursor.x * cell + 1, cursor.y * cell + 1, cell - 2, cell - 2);
      }
      function thumb(f) {
        const scale = Math.max(1, Math.floor(44 / Math.max(sprite.w, sprite.h)));
        const c = h('canvas', { width: sprite.w * scale, height: sprite.h * scale, role: 'img', aria: { label: 'Frame picture' } });
        paintTo(c.getContext('2d'), sprite, f, scale);
        return c;
      }

      function draw() {
        const has = !!sprite;
        stage.hidden = !has;
        help.hidden = !has;
        empty.hidden = has;
        const list = files();
        fill(picker, ...list.map((p) => h('option', { value: p, text: nameOf(p), selected: p === path })));
        fill(toolbar, picker,
          button({ text: 'New sprite', icon: 'plus', class: 'small', onClick: newSprite }),
          button({
            text: 'Free pictures…', class: 'small', title: 'Characters, things to collect, scenery and tiles that come with the studio',
            onClick: () => studio.commands.execute('assets.pack', { kind: 'sprite' }),
          }),
          button({
            text: 'Slice a sheet…', icon: 'upload', class: 'small', title: 'Cut a picture with many frames into a sprite',
            onClick: () => studio.commands.execute('art.slice'),
          }),
          button({ text: 'Undo', class: 'small', disabled: !history?.canUndo, onClick: undo, 'aria-label': 'Undo' }),
          button({ text: 'Redo', class: 'small', disabled: !history?.canRedo, onClick: redo, 'aria-label': 'Redo' }),
          has ? [button({
            text: 'Flip', class: 'small', title: 'Mirror this frame left to right', onClick: () => commit(S.flipHorizontal(sprite, frame)),
          }),
            h('label', { class: 'art-inline' }, 'Size ', h('select', {
              aria: { label: 'Sprite size' }, on: { change: (e) => { const n = Number(e.target.value); commit(S.resize(sprite, n, n)); } },
            }, ...[...new Set([sprite.w, ...SIZES])].sort((a, b) => a - b).map((n) => h('option',
              { value: n, text: `${n}×${n}`, selected: n === sprite.w && n === sprite.h })))),
            h('label', { class: 'art-inline' },
              h('input', { type: 'checkbox', checked: onion, on: { change: (e) => { onion = e.target.checked; draw(); } } }),
              ' Onion skin')] : null);
        if (!has) {
          if (!path || !studio.project?.has(path)) {
            fill(empty, h('h3', { text: list.length ? 'Pick a sprite' : 'No sprites yet' }),
              h('p', { text: 'A sprite is pixel art for your game. Make one, and it is saved as a file in src/art that your code can import.' }),
              button({ text: 'Make my first sprite', class: 'primary', onClick: newSprite }));
          }
          return;
        }
        fill(tools, ...TOOLS.map(([id, name, key]) => h('button', {
          type: 'button', class: `btn small${tool === id ? ' primary' : ''}`, role: 'radio', aria: { checked: tool === id,
            label: `${name} (${key})` }, title: `${name} (${key})`,
          text: name, on: { click: () => { tool = id; draw(); canvas.focus(); } },
        })));
        fill(swatches, ...Object.entries(sprite.palette).map(([k, c], i) => h('button', {
          type: 'button', class: `swatch${k === letter ? ' on' : ''}`, role: 'option', aria: { selected: k === letter,
            label: `Colour ${i + 1}, ${c}` }, title: `${c} (${i + 1})`,
          style: { background: c }, on: { click: () => { letter = k; if (tool === 'eraser') tool = 'pencil'; draw(); } },
        })), button({ label: 'Add a colour', 'aria-label': 'Add a colour', text: '+', class: 'small', onClick: addColor }),
        button({ label: 'Remove the selected colour', 'aria-label': 'Remove the selected colour', text: '−', class: 'small',
          onClick: () => { commit(S.removeColor(sprite, letter)); letter = Object.keys(sprite.palette)[0] ?? '.'; draw(); } }));
        colorInput.value = /^#[0-9a-f]{6}$/i.test(sprite.palette[letter] ?? '') ? sprite.palette[letter] : '#ffffff';
        const frameButton = (_, f) => h('button', {
          type: 'button', class: `frame${f === frame ? ' on' : ''}`, role: 'option',
          aria: { selected: f === frame, label: `Frame ${f + 1}` }, title: `Frame ${f + 1}`,
          on: { click: () => { frame = f; draw(); } },
        }, thumb(f));
        const addFrame = () => { commit(S.addFrame(sprite, frame)); frame++; draw(); };
        const dropFrame = () => { commit(S.deleteFrame(sprite, frame)); frame = Math.min(frame, sprite.frames.length - 1); draw(); };
        fill(framesEl, ...sprite.frames.map(frameButton),
          button({ label: 'Add a frame (a copy of this one)', 'aria-label': 'Add a frame (a copy of this one)', text: '+', class: 'small',
            onClick: addFrame }),
          button({ label: 'Delete this frame', 'aria-label': 'Delete this frame', text: '−', class: 'small', onClick: dropFrame }));
        drawAnimations();
        drawPalette();
        drawCanvas();
        const name = nameOf(path);
        const make = `spawn(game, 'hero', { sprite: '${name}', w: ${sprite.w * 2}, h: ${sprite.h * 2} })`;
        const head = `import ${name} from './art/${name}.js';\n\nconst art = { ${name} };           // your sprites, by name\n\n`;
        help.querySelector('pre').textContent = head
          + `// when you make a thing:  ${make}\n// when you draw:           drawThings(g, game, art);`;
      }

      function drawPalette() {
        const keys = Object.keys(sprite.palette);
        const tidy = S.paletteProblems(sprite, limit);
        paletteBox.querySelector('summary').textContent = tidy.length ? `Palette tools (${tidy.length} to tidy)` : 'Palette tools';
        if (!paletteBox.open) { paletteEl.replaceChildren(); return; }                  // built when it is opened
        const name = (k) => `Colour ${keys.indexOf(k) + 1} (${sprite.palette[k]})`;
        const others = keys.filter((k) => k !== letter);
        const used = Object.keys(S.countLetters(sprite)).length;
        const pick = (label, run) => h('select', { aria: { label },
          on: { change: (e) => { const k = e.target.value; e.target.value = ''; if (k) run(k); } } },
          h('option', { value: '', text: label }), ...others.map((k) => h('option', { value: k, text: name(k) })));
        const problems = tidy;
        fill(paletteEl,
          h('div', { class: 'dim', role: 'status', text: `${used} of ${keys.length} colour${keys.length === 1 ? '' : 's'} used` }),
          pick('Swap the selected colour with…', (k) => { commit(S.swapColors(sprite, letter, k)); say(`Swapped ${name(letter)} and ${name(k)}`); }),
          pick('Merge the selected colour into…', (k) => {
            commit(S.mergeColors(sprite, letter, k));
            letter = k;
            say(`Merged into ${name(k)}`);
            draw();
          }),
          h('label', { class: 'state-line' }, 'Colour limit ', h('select', { aria: { label: 'Colour limit' }, on: { change: (e) => {
            limit = Number(e.target.value);
            studio.prefs.set('sprite.colorLimit', limit);
            draw();
          } } }, ...LIMITS.map((n) => h('option', { value: String(n), text: n ? `${n} colours` : 'no limit', selected: n === limit })))),
          S.duplicateColors(sprite).length ? button({ text: 'Merge colours that are the same', class: 'small',
            onClick: () => commit(S.mergeDuplicates(sprite)) }) : null,
          S.unusedColors(sprite).length ? button({ text: 'Remove colours nothing uses', class: 'small',
            onClick: () => commit(S.removeUnused(sprite)) }) : null,
          limit && used > limit ? button({ text: `Reduce to ${limit} colours`, class: 'small primary', onClick: () => commit(S.reduceColors(sprite,
            limit)) }) : null,
          ...problems.map((p) => h('div', { class: 'text-missing', text: p })));
        if (!(letter in sprite.palette)) letter = keys[0] ?? '.';
      }
      function paintTiled() {
        if (!tiled || !sprite) return;
        const g = tilePreview.getContext('2d');
        g.clearRect(0, 0, tilePreview.width, tilePreview.height);
        const scale = Math.max(1, Math.floor(tilePreview.width / (3 * Math.max(sprite.w, sprite.h))));
        for (let ty = 0; ty < 3; ty++) {
          for (let tx = 0; tx < 3; tx++) {
            g.save();
            g.translate(tx * sprite.w * scale, ty * sprite.h * scale);
            paintTo(g, sprite, frame, scale);
            g.restore();
          }
        }
      }

      function drawAnimations() {
        const names = Object.keys(sprite.animations);
        if (!names.includes(animation)) animation = names[0] ?? '';
        fill(animEl,
          ...names.map((n) => h('div', { class: `art-anim${n === animation ? ' on' : ''}` },
            h('button', {
              type: 'button', class: 'btn small ghost', text: `${n}: ${sprite.animations[n].frames.join(' ')} at ${sprite.animations[n].fps}/s`,
              on: { click: () => { animation = n; draw(); } },
            }),
            h('select', { aria: { label: `How ${n} plays` }, title: 'How it plays', on: { change: (e) => commit(S.setAnimationMode(sprite, n,
              e.target.value)) } },
              ...S.ANIMATION_MODES.map((m) => h('option', { value: m, text: MODE_WORDS[m], selected: (sprite.animations[n].mode ?? 'loop') === m }))),
            button({ label: `Delete animation ${n}`, 'aria-label': `Delete animation ${n}`, text: '×', class: 'small ghost',
              onClick: () => commit(S.removeAnimation(sprite, n)) }))),
          button({ text: 'Make an animation from all frames', class: 'small', onClick: makeAnimation }));
      }

      async function makeAnimation() {
        const name = await promptText({
          title: 'Name the animation', label: 'Name (for example run or idle)', confirmLabel: 'Make it',
          value: Object.keys(sprite.animations).length ? 'idle' : 'run',
          validate: (v) => (/^[a-z][\w-]{0,23}$/i.test(v.trim()) ? null : 'Use letters and numbers, starting with a letter'),
        });
        if (name === undefined) return;
        animation = name.trim();
        commit(S.setAnimation(sprite, animation, sprite.frames.map((_, i) => i), 8));
      }

      async function addColor() {
        const { sprite: next, letter: l } = S.addColor(sprite, '#ffffff');
        if (!l) { studio.toasts.show('A sprite can have up to 62 colours.', { kind: 'info' }); return; }
        letter = l;
        commit(next);
        colorInput.click();
      }

      async function newSprite() {
        if (!studio.project) return;
        const name = await promptText({
          title: 'New sprite', label: 'Name it (for example hero or coin)', value: files().length ? 'enemy' : 'hero', confirmLabel: 'Make it',
          validate: (v) => {
            if (!/^[a-z][\w-]{0,23}$/i.test(v.trim())) return 'Use letters and numbers, starting with a letter';
            return studio.project.has(`src/art/${v.trim()}.js`) ? 'There is already a sprite with that name' : null;
          },
        });
        if (name === undefined) return;
        flush();
        const file = `src/art/${name.trim()}.js`;
        studio.project.write(file, S.serializeSprite(S.newSprite(16, 16)));
        studio.emit('files');
        open(file);
        canvas.focus();
      }

      const undo = () => { if (history?.canUndo) { sprite = history.undo(); flush(); frame = Math.min(frame, sprite.frames.length - 1); draw(); } };
      const redo = () => { if (history?.canRedo) { sprite = history.redo(); flush(); frame = Math.min(frame, sprite.frames.length - 1); draw(); } };

      // ---- mouse, touch and keyboard on the canvas ----
      const cellAt = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: Math.floor(((e.clientX - r.left) / r.width) * sprite.w), y: Math.floor(((e.clientY - r.top) / r.height) * sprite.h) };
      };
      const ink = () => (tool === 'eraser' ? '.' : letter);
      const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < sprite.w && p.y < sprite.h;
      canvas.addEventListener('pointerdown', (e) => {
        if (!sprite) return;
        const p = cellAt(e);
        if (!inside(p)) return;
        canvas.setPointerCapture(e.pointerId);
        cursor = p;
        if (tool === 'picker') { pick(p); return; }
        if (tool === 'fill') { commit(S.floodFill(sprite, frame, p.x, p.y, ink())); return; }
        drag = { from: p, last: p };
        if (tool === 'pencil' || tool === 'eraser') commit(S.paintPoints(sprite, frame, [[p.x, p.y]], ink()));
        else drawCanvas();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!sprite) return;
        const p = cellAt(e);
        if (!inside(p)) return;
        cursor = p;
        if (!drag) { drawCanvas(); return; }
        if (tool === 'pencil' || tool === 'eraser') commit(S.paintPoints(sprite, frame, S.linePoints(drag.last.x, drag.last.y, p.x, p.y), ink()));
        drag.last = p;
        if (tool === 'line' || tool === 'rect') drawCanvas();
      });
      const finish = () => {
        if (!drag) return;
        if (tool === 'line' || tool === 'rect') commit(S.paintPoints(sprite, frame, shapePoints(), ink()));
        drag = null;
        draw();
      };
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);
      function pick(p) {
        const ch = sprite.frames[frame][p.y][p.x];
        if (ch !== '.' && ch !== ' ') { letter = ch; tool = 'pencil'; }
        draw();
      }
      canvas.addEventListener('keydown', (e) => {
        if (!sprite) return;
        const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (move && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          cursor = { x: Math.max(0, Math.min(sprite.w - 1, cursor.x + move[0])), y: Math.max(0, Math.min(sprite.h - 1, cursor.y + move[1])) };
          if (e.shiftKey) commit(S.setPixel(sprite, frame, cursor.x, cursor.y, ink())); else drawCanvas();
          const here = sprite.frames[frame][cursor.y][cursor.x];
          say(`x ${cursor.x + 1}, y ${cursor.y + 1}: ${here === '.' ? 'empty' : `colour ${here}`}`);
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (tool === 'fill') commit(S.floodFill(sprite, frame, cursor.x, cursor.y, ink()));
          else if (tool === 'picker') pick(cursor);
          else commit(S.setPixel(sprite, frame, cursor.x, cursor.y, ink()));
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          commit(S.setPixel(sprite, frame, cursor.x, cursor.y, '.'));
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          redo();
        } else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const k = Object.keys(sprite.palette)[Number(e.key) - 1];
          if (k) { letter = k; if (tool === 'eraser') tool = 'pencil'; draw(); say(`Colour ${e.key} selected`); }
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          const t = TOOLS.find(([, , key]) => key.toLowerCase() === e.key.toLowerCase());
          if (t) { tool = t[0]; draw(); say(`${t[1]} tool`); }
        }
      });
      colorInput.addEventListener('input', () => { if (sprite) commit(S.setColor(sprite, letter, colorInput.value)); });

      // ---- the animation preview ----
      let tick = 0;
      const loop = setInterval(() => {
        if (!sprite || el.offsetParent === null) return;
        const a = sprite.animations[animation];
        const frames = a ? a.frames : sprite.frames.map((_, i) => i);
        const fps = a ? a.fps : 4;
        tick += 100;
        const f = animationFrame({ frames, fps, mode: a?.mode }, tick / 1000);
        const g = preview.getContext('2d');
        g.clearRect(0, 0, preview.width, preview.height);
        const scale = Math.max(1, Math.floor(60 / Math.max(sprite.w, sprite.h)));
        g.save();
        g.translate(Math.floor((preview.width - sprite.w * scale) / 2), Math.floor((preview.height - sprite.h * scale) / 2));
        paintTo(g, sprite, f, scale);
        g.restore();
        paintTiled();
      }, 100);

      studio.on('file-changed', (e) => {
        if (e.path === path && studio.project?.readText(path) !== lastWritten && !drag) open(path);
        else if (ART.test(e.path ?? '')) draw();
      });
      studio.on('files',
        () => { if (path && !studio.project?.has(path)) { path = null; sprite = null; } if (!path) path = files()[0] ?? null; open(path); });
      studio.on('project', () => { path = files()[0] ?? null; open(path); });
      studio.spriteApi = { open: (file) => { flush(); path = file; open(file); } };          // for the sheet slicer: show the sprite it just made
      new ResizeObserver(() => { if (sprite && el.offsetParent !== null) drawCanvas(); }).observe(el);
      path = files()[0] ?? null;
      open(path);
      return { el, focus: () => canvas.focus(), onShow: () => { if (path) open(path); else draw(); },
        dispose: () => { clearInterval(loop); flush(); } };
    },
  };
}
