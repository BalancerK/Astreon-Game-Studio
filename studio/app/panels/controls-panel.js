// The Controls panel: what players can change in your game. List your actions (jump, fire, pause) and the keys each starts with; pick which settings the menu offers (volumes,
// text size, captions, less shake, high contrast) and what they start as; try the real settings menu in the preview with your keyboard or mouse; and read what the game
// still does not offer, found by reading its code. Kept in `src/controls.js`; the game reads it with `controls(...)`, `settings(...)` and `openSettingsMenu(...)`.
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as M from '../paint/controls-model.js';
import { accessibilityReport, accessibilityScore } from '../profile/accessibility.js';
import {
  controls as setActions, settings as setSettings, actionsList,
} from '../../../packages/arcade/src/settings.js';
import { held } from '../../../packages/arcade/src/control.js';
import { openSettingsMenu, closeSettingsMenu, settingsMenuOpen, stepSettingsMenu,
  drawSettingsMenu } from '../../../packages/arcade/src/settings-menu.js';
import { setProgressHost } from '../../../packages/arcade/src/progress.js';
import { label } from '../../../packages/arcade/src/draw.js';

const FILE = 'src/controls.js';
const VIEW = { w: 480, h: 320 };
const HINT = 'Players need to choose their own keys, set the volume and make the text bigger. Make a controls file, and the kit does the rest: '
  + 'a ready-made settings menu with a page for keys.';

export function controlsPanel(studio) {
  return {
    id: 'controls',
    title: 'Controls',
    icon: 'edit',
    create() {
      let c = null;                                      // the controls, or null when there is no file
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let capturing = null;                              // the action that is waiting for a key
      let creating = false;                              // ... and whether it is a new one (made from the first key pressed)
      let note = '';
      let game = {};
      let held_ = new Set();
      const tapped = new Set();                           // keys pressed since the last tick, even if let go again before it (a quick tap must count)
      let mouse = null;
      let timer = 0;

      const bar = h('div', { class: 'toolbar art-bar' });
      const actions = h('div', { class: 'controls-actions' });
      const offered = h('div', { class: 'controls-settings' });
      const view = h('canvas', { width: VIEW.w, height: VIEW.h, class: 'particle-view', tabindex: '0',
        aria: { label: 'Preview of the settings menu. Use the arrow keys, Enter and Esc, or the mouse.' } });
      const readout = h('div', { class: 'dim particle-count', role: 'status' });
      const report = h('div', { class: 'controls-report' });
      const empty = h('div', { class: 'empty' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const body = h('div', { class: 'controls-body' }, h('div', { class: 'controls-left' }, actions, offered), h('div', { class: 'particle-left' },
        view, readout));
      const el = h('div', { class: 'panel-body art controls', 'aria-label': 'Controls and settings' }, bar, body, report, help, empty);
      setProgressHost({ send: () => {}, initial: null });          // the preview must not save anything into the project's own progress

      // ---- the file ----
      function load() {
        problem = '';
        const raw = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = raw ?? '';
        try { c = raw ? M.parseControls(raw) : null; } catch (error) { c = null; problem = error.message; }
        apply();
        draw();
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem || !c) return;
        const out = M.serializeControls(c);
        if (out === lastWritten) return;
        lastWritten = out;
        studio.project.write(FILE, out);
        studio.emit('files');
      }
      const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); };
      function change(next, { redraw = true } = {}) {
        if (!next || next === c) return;
        c = next;
        save();
        apply();
        if (redraw) draw(); else drawReport();
      }

      // ---- the preview: the real menu ----
      function apply() {
        if (!c) return;
        setActions(c.actions);
        setProgressHost({ send: () => {}, initial: null });
        setSettings(c.settings);
        game = {};
        openSettingsMenu(game, { offer: c.offer });
      }
      function tick() {
        if (!el.isConnected || !el.offsetParent || !c) return;
        if (settingsMenuOpen(game)) {
          const m = mouse;
          mouse = null;
          if (stepSettingsMenu(game, new Set([...held_, ...tapped]), m) === 'back') { closeSettingsMenu(game); }
        }
        tapped.clear();
        paint();
      }
      function paint() {
        const g = view.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, VIEW.w, VIEW.h);
        label(g, 'Score: 120', 12, 24);
        label(g, 'This text follows the text size.', 12, 48, { size: 14, color: '#9aa3b5' });
        if (settingsMenuOpen(game)) drawSettingsMenu(g, game);
        else {
          label(g, 'The menu is closed. Press Enter, or the button below.', VIEW.w / 2, VIEW.h / 2, { size: 14, align: 'center', color: '#9aa3b5' });
        }
        const now = actionsList().filter((a) => held(held_, a.action)).map((a) => a.action);
        readout.textContent = now.length ? `Held now: ${now.join(', ')}` : 'Click the picture, then press keys to see which actions they do.';
      }
      view.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Escape'].includes(e.code)) e.preventDefault();
        held_.add(e.code);
        tapped.add(e.code);
        if (!settingsMenuOpen(game) && e.code === 'Enter' && c) openSettingsMenu(game, { offer: c.offer });
      });
      view.addEventListener('keyup', (e) => { held_.delete(e.code); });
      view.addEventListener('blur', () => { held_.clear(); });
      view.addEventListener('pointerdown', (e) => {
        view.focus();
        const box = view.getBoundingClientRect();
        mouse = { x: ((e.clientX - box.left) / box.width) * VIEW.w, y: ((e.clientY - box.top) / box.height) * VIEW.h, clicked: true };
      });

      // ---- key capture ----
      function onCapture(e) {
        if (!capturing) return;
        e.preventDefault();
        e.stopPropagation();
        const action = capturing;
        const isNew = creating;
        capturing = null;
        creating = false;
        document.removeEventListener('keydown', onCapture, true);
        if (e.code !== 'Escape') {
          const clash = M.clashes(c, action, e.code);
          note = clash.length ? `${M.keyName(e.code)} also starts ${clash.join(', ')}. That is allowed, but one key will do two things.` : '';
          change(isNew ? M.addAction(c, action, e.code) : M.addKey(c, action, e.code));
        } else draw();
      }
      function capture(action, isNew = false) {
        capturing = action;
        creating = isNew;
        document.addEventListener('keydown', onCapture, true);
        drawActions();
      }

      // ---- the parts ----
      function drawActions() {
        const named = [...M.BUILT_IN_NAMES, ...Object.keys(c.actions).filter((a) => !M.BUILT_IN_NAMES.includes(a))];
        const names = creating && !named.includes(capturing) ? [...named, capturing] : named;
        fill(actions, h('h4', { text: 'Actions and their keys' }), note ? h('p', { class: 'plugin-problem', role: 'status', text: note }) : null,
          ...names.map((name) => {
            const custom = !M.BUILT_IN_NAMES.includes(name);
            const keys = M.keysOf(c, name);
            return h('div', { class: 'controls-row' }, h('strong', { class: 'controls-name', text: name }), custom ? null : h('span',
              { class: 'dim', text: 'built in' }),
              ...keys.map((k) => h('span', { class: 'key-chip' }, M.keyName(k), keys.length > 1
                ? button({ text: '×', class: 'small ghost', aria: { label: `Remove ${M.keyName(k)} from ${name}` },
                  onClick: () => { note = ''; change(M.removeKey(c, name, k)); } }) : null)),
              keys.length < M.BINDING_LIMITS.codes ? button({
                text: capturing === name ? 'Press a key…' : 'Add a key', class: `small${capturing === name ? ' primary' : ''}`,
                aria: { label: `Add a key to ${name}` }, onClick: () => capture(name),
              }) : null,
              custom ? button({ text: 'Remove', class: 'small ghost', aria: { label: `Remove action ${name}` },
                onClick: () => change(M.removeAction(c, name)) })
                : name in c.actions ? button({ text: 'Usual keys', class: 'small ghost', onClick: () => change(M.removeAction(c, name)) }) : null);
          }));
      }
      function drawSettings() {
        fill(offered, h('h4', { text: 'Settings the menu offers' }),
          ...M.SETTING_NAMES.map((name) => {
            const spec = M.SETTING_SPEC[name];
            const on = c.offer.includes(name);
            const start = M.startOf(c, name);
            return h('div', { class: 'controls-row' },
              h('label', { class: 'art-inline' }, h('input', {
                type: 'checkbox', checked: on, aria: { label: `Offer ${spec.label}` }, on: { change: (e) => change(M.setOffered(c, name,
                  e.target.checked), { redraw: false }) },
              }), ` ${spec.label}`),
              spec.kind === 'flag'
                ? h('label', { class: 'art-inline' }, 'starts ', h('input', {
                  type: 'checkbox', checked: Boolean(start), aria: { label: `${spec.label} starts on` }, on: { change: (e) => change(M.setStart(c,
                    name, e.target.checked), { redraw: false }) },
                }))
                : h('label', { class: 'art-inline' }, 'starts at ', h('input', {
                  type: 'number', min: String(spec.min), max: String(spec.max), step: String(spec.step), value: String(start),
                    style: { width: '4.5em' }, aria: { label: `${spec.label} starts at` },
                  on: { change: (e) => change(M.setStart(c, name, Number(e.target.value)), { redraw: false }) },
                })));
          }));
      }
      function drawReport() {
        if (!c) { fill(report); return; }
        const items = accessibilityReport(studio.textFiles());
        const score = accessibilityScore(items);
        const group = (state, title) => {
          const list = items.filter((i) => i.state === state);
          if (!list.length) return null;
          return h('div', { class: 'controls-group' }, h('h4', { text: title }), ...list.map((i) => h('div', { class: `controls-item ${state}` },
            h('strong', { text: `${state === 'ok' ? '✓' : state === 'todo' ? '✗' : '•'} ${i.title}` }), h('div', { class: 'dim', text: i.detail }),
            ...i.where.map((w) => h('div', {}, h('button', { type: 'button', class: 'link', text: `${w.path}:${w.line}`,
              on: { click: () => studio.openFile?.(w.path) } }),
              h('code', { text: ` ${w.text}` }))))));
        };
        fill(report, h('h3', { text: 'What your game offers players' }),
          h('p', { class: score.of && score.done === score.of ? 'ship-verdict ok' : 'ship-verdict fail', role: 'status',
            text: score.of ? `${score.done} of ${score.of} basics are done.` : 'Nothing to check yet: the game does not read keys or play sounds.' }),
          group('todo', 'To do'), group('ok', 'Done'), group('check', 'Check by eye (a tool cannot know)'));
      }

      function draw() {
        const has = Boolean(c);
        fill(bar, c ? [button({ text: 'Add an action', icon: 'plus', class: 'small primary', onClick: addAction }),
          button({ text: 'Open the menu in the preview', class: 'small', onClick: () => { openSettingsMenu(game,
            { offer: c.offer }); view.focus(); } })] : null);
        body.hidden = !has;
        help.hidden = !has;
        empty.hidden = has;
        if (!has) {
          report.hidden = true;
          fill(empty, h('h3', { text: problem ? 'The controls file needs fixing' : 'No controls yet' }), h('p', { text: problem || HINT }),
            problem ? null : button({ text: 'Make the controls file', class: 'primary', onClick: () => change(M.newControls()) }));
          return;
        }
        report.hidden = false;
        drawActions();
        drawSettings();
        drawReport();
        const first = Object.keys(c.actions)[0] ?? 'jump';
        const names = 'controls, settings, held, openSettingsMenu, stepSettingsMenu, drawSettingsMenu, settingsMenuOpen';
        help.querySelector('pre').textContent = [
          "import setup from './controls.js';",
          `import { ${names} } from '@engine/arcade';`,
          '',
          'controls(setup.actions);       // your actions and their usual keys',
          'settings(setup.settings);      // loads what the player chose last time',
          '',
          `if (held(keys, '${first}')) { /* ... */ }      // follows the keys the player picked`,
          'openSettingsMenu(game, { offer: setup.offer });          // from your pause or title screen',
          'if (settingsMenuOpen(game)) stepSettingsMenu(game, keys, mouse);   // in update',
          'if (settingsMenuOpen(game)) drawSettingsMenu(g, game);               // in render',
        ].join('\n');
      }
      async function addAction() {
        const name = await promptText({
          title: 'Name the action', label: 'Name (for example fire or pause)', confirmLabel: 'Add it', validate: (v) => M.actionProblem(c, v.trim()),
        });
        if (name === undefined) return;
        capture(name.trim(), true);
      }

      timer = setInterval(tick, 1000 / 60);
      studio.on('file-changed',
        (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); else if (/\.js$/.test(e.path ?? '')) drawReport(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && !c) load(); else drawReport(); });
      load();
      return { el, focus: () => bar.querySelector('button')?.focus(), onShow: load,
        dispose: () => { clearInterval(timer); document.removeEventListener('keydown', onCapture, true); flush(); } };
    },
  };
}
