// The Editor panel: the files you have open as tabs, and the code of the one showing, in up to four editors side by side (or one above the other), with an
// explorer beside them if you want one. Typing saves the file (and the game updates a moment later). Drag a tab to put it somewhere else in its row, into
// another editor, or onto the edge of an editor to split it; drag a file from a list the same way; right click a tab for more. Which files are open where is
// kept by core/editor-groups.js (tested in Node); this draws it.
import { h, icon, fill, button } from '../ui/dom.js';
import { createEditor } from '../ui/code-editor.js';
import { createFileTree } from '../ui/file-tree.js';
import { makeDraggable, addDropTarget } from '../ui/pointer-drag.js';
import { openContextMenu } from '../ui/context-menu.js';
import { openFileMenu } from '../core/file-menu.js';
import { MAX_GROUPS } from '../core/editor-groups.js';
import { assetKind, mimeOf } from '../store/assets.js';
import { fontStack } from '../ui/themes.js';
import { symbolsOf } from '../editing/code-index.js';

const HINT = 'Pick a file in the Files panel, or press Ctrl+P to search for one.';
const base = (p) => p.slice(p.lastIndexOf('/') + 1);
const LONG_FILE = 60_000;                // characters: about 1,500 lines

/** The settings that shape how code looks and feels, as the editor wants them. */
const editorOptionsOf = (studio) => () => ({
  fontSize: studio.settings.get('fontSize'), tabSize: studio.settings.get('tabSize'), wrap: studio.settings.get('wrapLines'),
  fontFamily: fontStack(studio.settings.get('fontFamily')), lineHeightFactor: studio.settings.get('lineHeight'),
  ligatures: studio.settings.get('ligatures'), highlightLine: studio.settings.get('highlightLine'),
  indentGuides: studio.settings.get('indentGuides'), minimap: studio.settings.get('minimap'),
});

export function editorPanel(studio) {
  return {
    id: 'editor',
    title: 'Editor',
    icon: 'edit',
    create() {
      const editorOptions = editorOptionsOf(studio);
      const groups = studio.groups;
      const panes = [];
      const area = h('div', { class: 'editor-groups' });
      const dropMark = h('div', { class: 'editor-drop', hidden: true, aria: { hidden: true } });
      const side = h('div', { class: 'editor-side', hidden: true });
      const sideSep = h('div', {
        class: 'editor-sep v', role: 'separator', tabIndex: 0, aria: { orientation: 'vertical', label: 'Resize the explorer' },
      });
      const el = h('div', { class: 'panel-body editor-root', 'aria-label': 'Code editor' }, side, sideSep, area, dropMark);
      sideSep.hidden = true;

      // ---------- the explorer ----------
      const tree = createFileTree(studio, {
        label: 'Explorer',
        onOpen: (path) => { studio.openFile(path); focusEditor(); },
        onContext: (row, x, y, from) => openFileMenu(studio, row, { x, y }, from),
      });
      side.append(h('div', { class: 'editor-side-head' }, h('span', { text: 'Files' }),
        h('span', { class: 'grow' }),
        button({ label: 'New file', icon: 'plus', class: 'small ghost', onClick: () => studio.commands.execute('file.new') }),
        button({ label: 'Hide the explorer', icon: 'close', class: 'small ghost', onClick: () => setExplorer(false) })), tree.el);
      let explorer = studio.prefs.get('editor.explorer', false);
      let explorerWidth = studio.prefs.get('editor.explorerWidth', 200);
      function setExplorer(on, { focus = false } = {}) {
        explorer = !!on;
        studio.prefs.set('editor.explorer', explorer);
        side.hidden = !explorer;
        sideSep.hidden = !explorer;
        side.style.width = `${explorerWidth}px`;
        if (explorer) { tree.refresh(); if (studio.activeFile) tree.reveal(studio.activeFile, { focus }); }
        for (const p of panes) p.explorerBtn.setAttribute('aria-pressed', String(explorer));
        if (!explorer && focus) focusEditor();
      }
      sideSep.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const start = e.clientX;
        const width = explorerWidth;
        const move = (ev) => { explorerWidth = Math.max(120, Math.min(420, width + ev.clientX - start)); side.style.width = `${explorerWidth}px`; };
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          studio.prefs.set('editor.explorerWidth', explorerWidth);
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
      sideSep.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        explorerWidth = Math.max(120, Math.min(420, explorerWidth + step));
        side.style.width = `${explorerWidth}px`;
        studio.prefs.set('editor.explorerWidth', explorerWidth);
      });
      sideSep.addEventListener('dblclick', () => { explorerWidth = 200; side.style.width = '200px'; studio.prefs.set('editor.explorerWidth', 200); });

      // ---------- one editor (a row of tabs, the path, and the code) ----------
      function makePane(index) {
        const tablist = h('div', { class: 'editor-tabs', role: 'tablist', aria: { label: 'Open files' } });
        const explorerBtn = button({
          label: 'Show or hide the explorer', icon: 'folder', class: 'small ghost', onClick: () => setExplorer(!explorer, { focus: !explorer }),
        });
        explorerBtn.setAttribute('aria-pressed', String(explorer));
        const listBtn = button({ label: 'All open files', icon: 'chevron', class: 'small ghost', onClick: () => listMenu(pane) });
        const splitBtn = button({ label: 'Split the editor to the right', text: '⫿', class: 'small ghost', onClick: () => splitPane(pane, 'right') });
        const strip = h('div', { class: 'editor-strip' }, explorerBtn, tablist, listBtn, splitBtn);
        const crumbs = h('nav', { class: 'editor-crumbs', aria: { label: 'Where this file is' } });
        const host = h('div', { class: 'editor-host' });
        const empty = h('div', { class: 'empty' }, h('h3', { text: 'No file open' }), h('p', { text: HINT }));
        const body = h('div', { class: 'editor-pane-body' }, crumbs, host, empty);
        const pane = {
          index, strip, tablist, crumbs, host, empty, explorerBtn, listBtn, splitBtn, shown: null, preview: null, views: new Map(), editor: null,
        };
        pane.el = h('div', { class: 'editor-group', dataset: { group: String(index) } }, strip, body);
        pane.editor = createEditor(host, {
          ...editorOptions(), label: 'Code', loadApi: () => import('../data/api-index.js').then((m) => m.API),
          onChange: (text) => {
            if (!pane.shown || !studio.project) return;
            try {
              studio.project.write(pane.shown, text);
            } catch (error) { studio.toasts.show(`Could not keep that change: ${error.message}`, { kind: 'error' }); }
          },
          onCursor: (line, column) => {
            if (groups.focus !== pane.index) return;
            studio.cursor = { line, column };
            studio.emit('cursor');
            symbolSoon(pane);
          },
        });
        const focusThis = () => { if (groups.focus !== pane.index) { groups.focusGroup(pane.index); studio.groupsChanged(); } };
        pane.el.addEventListener('focusin', focusThis);
        pane.el.addEventListener('pointerdown', focusThis, true);
        addDropTarget({
          el: pane.el, accepts: (item) => item.type === 'tab' || item.type === 'file',
          over: (item, x, y) => showDrop(pane, item, x, y), out: () => { dropMark.hidden = true; },
          drop: (item, x, y) => dropOn(pane, item, x, y),
        });
        return pane;
      }

      function drawTabs(pane) {
        const g = groups.groups[pane.index];
        const names = g.files.map(base);
        // the tabs are only built again when something about them changed: a press on a tab (which only moves the focus) must not replace it under the finger
        const sig = JSON.stringify([pane.index, g.files, g.active, g.files.map((p) => (studio.diagnostics.get(p) ?? []).length > 0)]);
        pane.listBtn.hidden = g.files.length < 2;
        pane.splitBtn.hidden = groups.groups.length >= MAX_GROUPS;
        if (sig === pane.tabSig) return;
        pane.tabSig = sig;
        fill(pane.tablist, g.files.map((path, at) => {
          const on = path === g.active;
          const dup = names.filter((n) => n === base(path)).length > 1;
          const bad = (studio.diagnostics.get(path) ?? []).length > 0;
          const tab = h('div', {
            class: `editor-tab${on ? ' on' : ''}`, role: 'tab', aria: { selected: on }, tabIndex: on ? 0 : -1, title: path, dataset: { path },
            on: {
              click: () => { groups.activate(path, pane.index); studio.groupsChanged(); },
              keydown: (e) => tabKey(e, pane, path, at),
              auxclick: (e) => { if (e.button === 1) { e.preventDefault(); studio.closeFile(path, pane.index); } },
              contextmenu: (e) => { e.preventDefault(); tabMenu(pane, path, e.clientX, e.clientY, tab); },
            },
          }, h('span', { class: 'tab-name', text: base(path) }),
          dup ? h('span', { class: 'tab-dir', text: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' }) : null,
          bad ? h('span', { class: 'dot-error', title: 'This file has a problem', aria: { label: 'has a problem' } }) : null,
          h('button', {
            type: 'button', class: 'dock-close', tabIndex: -1, 'aria-label': `Close ${path}`,
            on: { click: (e) => { e.stopPropagation(); studio.closeFile(path, pane.index); } },
          }, icon('close', 12)));
          makeDraggable(tab, { payload: () => ({ type: 'tab', path, group: pane.index, index: at }), label: () => base(path) });
          return tab;
        }));
        pane.tablist.querySelector('.editor-tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }

      function tabKey(e, pane, path, at) {
        const g = groups.groups[pane.index];
        const to = (j) => {
          e.preventDefault();
          const next = g.files[(j + g.files.length) % g.files.length];
          groups.activate(next, pane.index);
          studio.groupsChanged();
          pane.tablist.querySelector('[aria-selected=true]')?.focus();
        };
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {       // move the tab itself
          e.preventDefault();
          groups.reorder(pane.index, at, at + (e.key === 'ArrowRight' ? 1 : -1));
          studio.groupsChanged();
          pane.tablist.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
        } else if (e.key === 'ArrowRight') to(at + 1);
        else if (e.key === 'ArrowLeft') to(at - 1);
        else if (e.key === 'Home') to(0);
        else if (e.key === 'End') to(g.files.length - 1);
        else if (e.key === 'Delete') { e.preventDefault(); studio.closeFile(path, pane.index); }
        else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          tabMenu(pane, path, r.left, r.bottom, e.currentTarget);
        }
      }

      function tabMenu(pane, path, x, y, from) {
        const g = groups.groups[pane.index];
        const at = g.files.indexOf(path);
        const many = groups.groups.length > 1;
        const full = groups.groups.length >= MAX_GROUPS;
        openContextMenu({ x, y }, [
          { label: 'Close', run: () => studio.closeFile(path, pane.index) },
          { label: 'Close the others', disabled: g.files.length < 2, run: () => { groups.closeOthers(path, pane.index); studio.groupsChanged(); } },
          {
            label: 'Close the ones to the right', disabled: at >= g.files.length - 1,
            run: () => { groups.closeToRight(path, pane.index); studio.groupsChanged(); },
          },
          { label: 'Close all', run: () => { groups.closeAll(pane.index); studio.groupsChanged(); } },
          'separator',
          { label: 'Split to the right', disabled: full, run: () => splitPane(pane, 'right', path) },
          { label: 'Split down', disabled: full, run: () => splitPane(pane, 'down', path) },
          { label: 'Move to the other editor', disabled: !many, run: () => moveTo(pane, path, (pane.index + 1) % groups.groups.length) },
          'separator',
          { label: 'Show in the explorer', run: () => { setExplorer(true); tree.reveal(path); } },
          { label: 'Copy the path', run: () => navigator.clipboard?.writeText(path).catch(() => {}) },
        ], { label: `Tab ${path}`, restore: from });
      }

      function listMenu(pane) {
        const g = groups.groups[pane.index];
        const r = pane.listBtn.getBoundingClientRect();
        openContextMenu({ x: r.left, y: r.bottom }, g.files.map((p) => ({
          label: p, checked: p === g.active, run: () => { groups.activate(p, pane.index); studio.groupsChanged(); },
        })), { label: 'Open files', restore: pane.listBtn });
      }

      function splitPane(pane, side2, path = groups.groups[pane.index].active) {
        if (!path) return;
        if (!groups.split(path, pane.index, side2)) studio.toasts.show(`There can be at most ${MAX_GROUPS} editors.`, { kind: 'info' });
        studio.groupsChanged();
      }
      function moveTo(pane, path, to) {
        groups.move(path, pane.index, to);
        studio.groupsChanged();
      }

      // ---------- dragging tabs and files ----------
      /** Where a drag would land: on a row of tabs (before which tab), on the edge of an editor (a split), or in the middle (into this editor). */
      function zoneAt(pane, item, x, y) {
        const strip = pane.strip.getBoundingClientRect();
        const box = pane.el.getBoundingClientRect();
        if (y < strip.bottom) {
          const tabs = [...pane.tablist.querySelectorAll('.editor-tab')];
          let index = tabs.length;
          for (let i = 0; i < tabs.length; i++) {
            const r = tabs[i].getBoundingClientRect();
            if (x < r.left + r.width / 2) { index = i; break; }
          }
          const ref = tabs[index]?.getBoundingClientRect() ?? tabs.at(-1)?.getBoundingClientRect() ?? strip;
          return { kind: 'tabs', index, mark: { left: (tabs[index] ? ref.left : ref.right) - 1, top: strip.top, width: 3, height: strip.height } };
        }
        const fx = (x - box.left) / box.width;
        const fy = (y - box.top) / box.height;
        if (groups.groups.length < MAX_GROUPS) {
          const horizontal = Math.min(fx, 1 - fx) < Math.min(fy, 1 - fy);
          const edge = horizontal ? (fx < 0.25 ? 'left' : fx > 0.75 ? 'right' : null) : (fy < 0.25 ? 'up' : fy > 0.75 ? 'down' : null);
          if (edge) {
            const m = { left: box.left, top: box.top, width: box.width, height: box.height };
            if (edge === 'left') m.width /= 2;
            if (edge === 'right') { m.left += box.width / 2; m.width /= 2; }
            if (edge === 'up') m.height /= 2;
            if (edge === 'down') { m.top += box.height / 2; m.height /= 2; }
            return { kind: 'edge', side: edge, mark: m };
          }
        }
        return { kind: 'center', mark: { left: box.left, top: box.top, width: box.width, height: box.height } };
      }
      function showDrop(pane, item, x, y) {
        const z = zoneAt(pane, item, x, y);
        if (item.type === 'tab' && z.kind === 'center' && item.group === pane.index) { dropMark.hidden = true; return false; }
        const r = el.getBoundingClientRect();
        dropMark.hidden = false;
        dropMark.style.left = `${z.mark.left - r.left}px`;
        dropMark.style.top = `${z.mark.top - r.top}px`;
        dropMark.style.width = `${z.mark.width}px`;
        dropMark.style.height = `${z.mark.height}px`;
        dropMark.classList.toggle('line', z.kind === 'tabs');
        return true;
      }
      function dropOn(pane, item, x, y) {
        dropMark.hidden = true;
        const z = zoneAt(pane, item, x, y);
        const own = item.type === 'tab';
        if (z.kind === 'tabs') {
          if (own) groups.move(item.path, item.group, pane.index, z.index > item.index && item.group === pane.index ? z.index - 1 : z.index);
          else groups.open(item.path, { group: pane.index, index: z.index, duplicate: true });
        } else if (z.kind === 'edge') {
          if (!groups.split(item.path, pane.index, z.side, { move: own })) groups.split(item.path, pane.index, z.side);
        } else if (own) groups.move(item.path, item.group, pane.index);
        else groups.open(item.path, { group: pane.index, duplicate: true });
        studio.groupsChanged();
      }

      // ---------- showing a file ----------
      function showFile(pane) {
        const path = groups.groups[pane.index]?.active ?? null;
        const text = path && studio.project ? studio.project.read(path) : undefined;
        const isText = typeof text === 'string';
        if (pane.shown) pane.views.set(pane.shown, pane.editor.getViewState());
        if (pane.preview) { const old = pane.preview; setTimeout(() => URL.revokeObjectURL(old), 3000); pane.preview = null; }
        pane.host.hidden = !path || !isText;
        pane.empty.hidden = !!path && isText;
        if (path && !isText) fill(pane.empty, ...preview(pane, path, text));
        else if (!path) fill(pane.empty, h('h3', { text: 'No file open' }), h('p', { text: HINT }));
        pane.shown = isText ? path : null;
        pane.showing = path;
        pane.symbol = null;
        if (isText) {
          pane.editor.value = text;
          pane.editor.setViewState(pane.views.get(path));
          markProblems(pane);
          markHighlights(pane);
        }
        drawCrumbs(pane);
        symbolSoon(pane);
      }

      /** What to show for a file that is not text: a picture or sound can be seen and heard, and the way to use it is spelled out. */
      function preview(pane, path, bytes) {
        const kind = assetKind(path);
        if (!kind || !(bytes instanceof Uint8Array)) {
          return [h('h3', { text: path }), h('p', { text: 'This file is not text, so it cannot be edited here.' })];
        }
        pane.preview = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
        const kb = `${Math.max(1, Math.round(bytes.length / 1024))} KB`;
        const how = kind === 'image'
          ? `Give a thing this picture:  image: '${path}'   (or draw it with drawImage(g, '${path}', x, y)).`
          : `Use this sound:  sounds({ name: { file: '${path}' } })  and then  play('name').`;
        return [h('h3', { text: base(path) }),
          h('p', { class: 'dim', text: `${kind === 'image' ? 'Picture' : 'Sound'}, ${kb}` }),
          kind === 'image'
            ? h('img', { class: 'asset-preview', src: pane.preview, alt: `Preview of ${path}` })
            : h('audio', { src: pane.preview, controls: true, 'aria-label': `Listen to ${path}` }),
          h('p', { class: 'asset-how', text: how }),
          kind === 'image' ? button({ text: 'Slice into frames…', class: 'small', onClick: () => studio.commands.execute('art.slice') }) : null];
      }

      /** Work out which function the cursor is in a moment after the typing or moving stops (so typing never waits for it). */
      function symbolSoon(pane) {
        clearTimeout(pane.symbolTimer);
        pane.symbolTimer = setTimeout(() => {
          const now = pane.shown && groups.focus === pane.index ? enclosing(pane) : null;
          if (now?.name !== pane.symbol?.name || now?.kind !== pane.symbol?.kind) { pane.symbol = now; drawCrumbs(pane); }
        }, 200);
      }

      /** The path as pieces you can click (each opens a list of what is beside it), and where in the file the cursor is. */
      function drawCrumbs(pane) {
        const path = groups.groups[pane.index]?.active;
        if (!path) { fill(pane.crumbs); pane.crumbs.hidden = true; return; }
        pane.crumbs.hidden = false;
        const parts = path.split('/');
        const out = [];
        parts.forEach((part, i) => {
          const dir = parts.slice(0, i).join('/');
          const last = i === parts.length - 1;
          if (i) out.push(h('span', { class: 'crumb-sep', text: '›', aria: { hidden: true } }));
          const b = h('button', {
            type: 'button', class: `crumb${last ? ' last' : ''}`, text: part, title: last ? path : `${parts.slice(0, i + 1).join('/')}/`,
            on: { click: () => crumbMenu(pane, dir, b) },
          });
          out.push(b);
        });
        const sym = pane.shown && groups.focus === pane.index ? pane.symbol : null;
        if (sym) {
          out.push(h('span', { class: 'crumb-sep', text: '›', aria: { hidden: true } }));
          const b = h('button', {
            type: 'button', class: 'crumb symbol', text: `${sym.name}${sym.kind === 'function' ? '()' : ''}`, title: 'Go to a name in this file',
            on: { click: () => symbolMenu(pane, b) },
          });
          out.push(b);
        }
        fill(pane.crumbs, out);
      }
      /** The top-level function or class the cursor is in: the nearest line above it that starts one (a cheap look at the lines, not a full reading). */
      function enclosing(pane) {
        if (!/\.m?js$/.test(pane.shown ?? '')) return null;
        const line = studio.cursor?.line ?? 1;
        const lines = pane.editor.value.split('\n');
        for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
          const m = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(function\b\s*\*?|class\b)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
          if (m) return { name: m[2], kind: m[1].startsWith('class') ? 'class' : 'function' };
        }
        return null;
      }
      function crumbMenu(pane, dir, from) {
        const prefix = dir ? `${dir}/` : '';
        const names = new Map();
        for (const p of studio.project?.list() ?? []) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash < 0) names.set(rest, { path: p, dir: false });
          else names.set(rest.slice(0, slash), { dir: true, path: prefix + rest.slice(0, slash) });
        }
        const rect = from.getBoundingClientRect();
        const sorted = [...names].sort(([a, x], [b, y]) => (x.dir === y.dir ? a.localeCompare(b) : x.dir ? -1 : 1));
        const items = sorted.map(([name, v]) => ({
          label: v.dir ? `${name}/` : name,
          run: () => { if (v.dir) { setExplorer(true); tree.reveal(v.path); } else studio.openFile(v.path, { group: pane.index }); },
        }));
        openContextMenu({ x: rect.left, y: rect.bottom }, items.length ? items : [{ label: '(empty)', disabled: true }],
          { label: `Files in ${dir || 'the project'}`, restore: from });
      }
      function symbolMenu(pane, from) {
        const rect = from.getBoundingClientRect();
        const list = symbolsOf({ [pane.shown]: pane.editor.value }, pane.shown);
        openContextMenu({ x: rect.left, y: rect.bottom },
          list.map((s) => ({ label: `${s.name}  ·  line ${s.line}`, run: () => studio.emit('goto', { line: s.line, column: s.column }) })),
          { label: 'Names in this file', restore: from });
      }

      const markProblems = (pane) => pane.editor.setDiagnostics(pane.shown ? studio.diagnostics.get(pane.shown) ?? [] : []);
      const markHighlights = (pane) => pane.editor.setHighlights(pane.shown ? studio.highlights.get(pane.shown) ?? [] : []);

      // ---------- making the page match the groups ----------
      let separators = [];
      function applySizes() {
        el.classList.toggle('stacked', groups.direction === 'column');
        area.style.flexDirection = groups.direction === 'column' ? 'column' : 'row';
        panes.forEach((p, i) => { p.el.style.flex = `${groups.sizes[i] ?? 1} 1 0`; });
        separators.forEach((sep, i) => sep.setAttribute('aria-valuenow', String(Math.round((groups.sizes[i] ?? 0) * 100))));
      }
      function makeSplitter(i) {
        const vertical = groups.direction === 'row';
        const sep = h('div', {
          class: `editor-sep ${vertical ? 'v' : 'h'}`, role: 'separator', tabIndex: 0,
          aria: { orientation: vertical ? 'vertical' : 'horizontal', label: 'Resize the editors', valuemin: 15, valuemax: 85, valuenow: 50 },
        });
        sep.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const total = vertical ? area.clientWidth : area.clientHeight;
          const start = vertical ? e.clientX : e.clientY;
          const sizes = [...groups.sizes];
          // a very long file is laid out again at every step, which is slow: while the bar moves its text waits, and comes back when it is let go
          if (panes.some((p) => p.shown && p.editor.value.length > LONG_FILE)) area.classList.add('resizing');
          const move = (ev) => {
            const d = ((vertical ? ev.clientX : ev.clientY) - start) / Math.max(1, total);
            const next = [...sizes];
            next[i] = Math.max(0.15, Math.min(sizes[i] + sizes[i + 1] - 0.15, sizes[i] + d));
            next[i + 1] = sizes[i] + sizes[i + 1] - next[i];
            groups.sizes = next;
            applySizes();
          };
          const up = () => {
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', up);
            area.classList.remove('resizing');
            groups.resize(groups.sizes);
            studio.groupsChanged();
          };
          addEventListener('pointermove', move);
          addEventListener('pointerup', up);
        });
        sep.addEventListener('keydown', (e) => {
          const d = (vertical ? { ArrowLeft: -0.03, ArrowRight: 0.03 } : { ArrowUp: -0.03, ArrowDown: 0.03 })[e.key];
          if (d === undefined) return;
          e.preventDefault();
          const next = [...groups.sizes];
          next[i] = Math.max(0.15, Math.min(next[i] + next[i + 1] - 0.15, next[i] + d));
          next[i + 1] = groups.sizes[i] + groups.sizes[i + 1] - next[i];
          groups.resize(next);
          applySizes();
          studio.groupsChanged();
        });
        sep.addEventListener('dblclick', () => {
          groups.resize(groups.sizes.map(() => 1 / groups.sizes.length));
          applySizes();
          studio.groupsChanged();
        });
        return sep;
      }

      let layoutKey = '';
      function sync() {
        while (panes.length < groups.groups.length) panes.push(makePane(panes.length));
        while (panes.length > groups.groups.length) {
          const gone = panes.pop();
          gone.el.remove();
          if (gone.preview) URL.revokeObjectURL(gone.preview);
        }
        const key = `${panes.length}:${groups.direction}`;
        if (key !== layoutKey) {
          layoutKey = key;
          separators = [];
          const nodes = [];
          panes.forEach((p, i) => { if (i) { const sep = makeSplitter(i - 1); separators.push(sep); nodes.push(sep); } nodes.push(p.el); });
          fill(area, nodes);
        }
        applySizes();
        panes.forEach((pane, i) => {
          const g = groups.groups[i];
          pane.index = i;
          pane.el.dataset.group = String(i);
          pane.el.classList.toggle('focused', i === groups.focus && panes.length > 1);
          pane.explorerBtn.hidden = i > 0;                    // one explorer button is enough
          drawTabs(pane);
          const stale = pane.showing !== g.active;
          const unloaded = g.active && studio.project && !pane.shown && typeof studio.project.read(g.active) === 'string';
          if (stale || unloaded) showFile(pane);
          else drawCrumbs(pane);
        });
        if (explorer) tree.refresh();
      }

      function focusEditor() {
        const pane = panes[groups.focus];
        if (pane?.shown) pane.editor.focus(); else pane?.tablist.querySelector('[tabindex="0"]')?.focus();
      }

      // ---------- what the rest of the studio can ask of the editor ----------
      const focused = () => panes[groups.focus];
      studio.editorApi = {
        usable: () => !!focused()?.shown && focused().host.offsetParent !== null,
        action: (name) => { focused().editor.focus(); return focused().editor.action(name); },
        /** The file, its text and where the cursor is (for commands that need to know what name it is on). */
        caret: () => (focused()?.shown
          ? { path: focused().shown, text: focused().editor.value, index: focused().editor.textarea.selectionStart } : null),
        selectedText: () => {
          const ta = focused()?.editor.textarea;
          if (!ta || !focused().shown) return '';
          const size = ta.selectionEnd - ta.selectionStart;
          return size > 0 && size < 200 ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
        },
        toggleExplorer: () => setExplorer(!explorer, { focus: !explorer }),
        showInExplorer: (path) => { setExplorer(true); tree.reveal(path); },
        focusEditor,
      };
      // Ctrl+click (Cmd+click) on a name goes to where it is declared
      area.addEventListener('click', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !focused()?.shown) return;
        setTimeout(() => { studio.commands.execute('code.definition').catch(() => {}); }, 0);
      });

      // the file changed from outside the editor (going back to a restore point, typing in the other editor): show it
      studio.on('file-changed', (e) => {
        for (const pane of panes) {
          if (e.path !== pane.shown) continue;
          const text = studio.project?.readText(pane.shown);
          if (text === undefined || text === pane.editor.value) continue;
          const view = pane.editor.getViewState();
          pane.editor.value = text;
          pane.editor.setViewState(view);
        }
      });
      let shownProject = null;
      studio.on('project', () => {
        if (studio.project?.id !== shownProject) { for (const p of panes) p.views.clear(); shownProject = studio.project?.id ?? null; }
      });
      for (const ev of ['groups', 'project', 'files']) studio.on(ev, sync);
      studio.on('active-file', () => { if (explorer && studio.activeFile) tree.reveal(studio.activeFile, { focus: false }); });
      studio.on('diagnostics', () => { for (const p of panes) { markProblems(p); drawTabs(p); } });
      studio.on('highlights', () => { for (const p of panes) markHighlights(p); });
      studio.on('goto', ({ line, column }) => queueMicrotask(() => focused()?.editor.goto(line, column)));
      studio.on('settings', () => {
        for (const p of panes) {
          p.editor.setOptions(editorOptions());
        }
      });
      sync();
      setExplorer(explorer);
      return {
        el,
        focus: () => focusEditor(),
        editor: panes[0].editor,
        dispose: () => { for (const p of panes) if (p.preview) URL.revokeObjectURL(p.preview); },
      };
    },
  };
}
