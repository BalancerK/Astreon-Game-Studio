// Starting the studio: open the project database, build the window (menu bar, workspaces, panels, search, status bar), and show the hub if no project is open.
import { IdbBackend, MemoryBackend } from './store/backends.js';
import { Studio } from './core/studio.js';
import { registerCommands } from './core/studio-commands.js';
import { WORKSPACES } from './core/workspaces.js';
import { Toasts } from './ui/dialog.js';
import { Dock } from './ui/dock.js';
import { Palette } from './ui/palette.js';
import { Menubar } from './ui/menubar.js';
import { openContextMenu } from './ui/context-menu.js';
import { Hub } from './ui/hub.js';
import { h, fill } from './ui/dom.js';
import { filesPanel } from './panels/files-panel.js';
import { editorPanel } from './panels/editor-panel.js';
import { gamePanel } from './panels/game-panel.js';
import { consolePanel } from './panels/console-panel.js';
import { historyPanel } from './panels/history-panel.js';
import { learnPanel } from './panels/learn-panel.js';
import { timePanel } from './panels/time-panel.js';
import { inspectPanel } from './panels/inspect-panel.js';
import { spritePanel } from './panels/sprite-panel.js';
import { levelPanel } from './panels/level-panel.js';
import { soundPanel } from './panels/sound-panel.js';
import { textPanel } from './panels/text-panel.js';
import { statePanel } from './panels/state-panel.js';
import { clipPanel } from './panels/clip-panel.js';
import { layersPanel } from './panels/layers-panel.js';
import { worldPanel } from './panels/world-panel.js';
import { kindsPanel } from './panels/kinds-panel.js';
import { sequencePanel } from './panels/sequence-panel.js';
import { lightsPanel } from './panels/lights-panel.js';
import { particlePanel } from './panels/particle-panel.js';
import { behaviorPanel } from './panels/behavior-panel.js';
import { uiPanel } from './panels/ui-panel.js';
import { resourcesPanel } from './panels/resources-panel.js';
import { testsPanel } from './panels/tests-panel.js';
import { controlsPanel } from './panels/controls-panel.js';
import { storyPanel } from './panels/story-panel.js';
import { backpackPanel } from './panels/backpack-panel.js';
import { shipPanel } from './panels/ship-panel.js';
import { netlabPanel } from './panels/netlab-panel.js';
import { friendPanel } from './panels/friend-panel.js';
import { environmentPanel } from './panels/environment-panel.js';
import { rigPanel } from './panels/rig-panel.js';
import { pluginsPanel } from './panels/plugins-panel.js';
import { rulesPanel } from './panels/rules-panel.js';
import { scene3dPanel } from './panels/scene3d-panel.js';
import { searchPanel } from './panels/search-panel.js';
import { scenePanel } from './panels/scene-panel.js';
import { musicPanel } from './panels/music-panel.js';
import { profilerPanel } from './panels/profiler-panel.js';
import { symbolsOf } from './editing/code-index.js';

const $ = (id) => document.getElementById(id);

// ---- where projects are kept ----
let backend;
let backendNote = '';
try {
  backend = await IdbBackend.open('studio');
} catch (error) {
  backend = new MemoryBackend();
  backendNote = `This browser is not letting the studio save projects (${error.message}; a private window can cause this). `
    + 'You can still work, but everything is lost when this tab closes. Use File > Export project as zip to keep a copy.';
}
let storage = null;
try { storage = localStorage; storage.getItem('studio.probe'); } catch { storage = null; }

const toasts = new Toasts();
const studio = new Studio({ backend, storage, toasts, backendNote });
studio.knownProjects = [];

// ---- the window ----
const dock = new Dock($('dock'));
studio.dock = dock;
const PANELS = [
  filesPanel, editorPanel, gamePanel, consolePanel, historyPanel, learnPanel, timePanel, inspectPanel, spritePanel, levelPanel, soundPanel,
  shipPanel, netlabPanel, friendPanel, environmentPanel, rigPanel,
  pluginsPanel, rulesPanel, scene3dPanel, searchPanel, scenePanel, musicPanel, profilerPanel, textPanel, statePanel,
  clipPanel, worldPanel, kindsPanel, sequencePanel, layersPanel, lightsPanel, particlePanel, behaviorPanel, uiPanel, resourcesPanel, testsPanel,
    controlsPanel,
    storyPanel,
  backpackPanel,
];
for (const make of PANELS) dock.define(make(studio));

const palette = new Palette({
  recent: () => [...studio.commands.recent, ...studio.groups.recent.map((p) => `file:${p}`)],
  gotoLine: (line) => studio.emit('goto', { line, column: 1 }),
  items: () => {
    const items = studio.commands.list().map((c) => ({
      id: c.id, kind: c.category === 'Setting' ? 'setting' : 'command', title: c.title, detail: c.category === 'Setting' ? '' : c.category,
      keywords: c.keywords, shortcut: studio.commands.shortcutLabel(c.id), run: () => studio.commands.execute(c.id).catch(() => {}),
    }));
    for (const path of studio.project?.list() ?? []) {
      const slash = path.lastIndexOf('/');
      items.push({
        id: `file:${path}`, kind: 'file', title: path.slice(slash + 1), detail: slash > 0 ? path.slice(0, slash) : '', keywords: [path],
        run: () => { studio.openFile(path); dock.show('editor'); },
      });
    }
    const files = studio.textFiles();
    for (const path of Object.keys(files)) {
      if (!path.endsWith('.js')) continue;
      for (const s of symbolsOf(files, path)) {
        items.push({
          id: `symbol:${path}:${s.index}`, kind: 'symbol', title: s.name, detail: `${s.kind} · ${path}:${s.line}`, keywords: [path],
          run: () => studio.goto(path, s.line, s.column),
        });
      }
    }
    for (const p of studio.knownProjects) {
      if (p.id === studio.project?.id) continue;
      items.push({
        id: `project:${p.id}`, kind: 'project', title: p.name, detail: `${p.fileCount} files`,
        run: () => studio.openProject(p.id).then(() => hub.hide()),
      });
    }
    return items;
  },
});
const hub = new Hub(studio, $('main'));
registerCommands(studio, { palette, hub });

const menus = [
  {
    label: 'File',
    items: [
      'project.hub', 'separator', 'file.new', 'file.open', 'file.rename', 'file.delete', 'file.close', 'editor.close-others', 'editor.close-all',
      'separator',
      'project.rename', 'project.export', 'separator', 'file.import', 'assets.pack', 'level.import', 'file.svg-picture', 'art.slice',
        'project.settings',
      'folder.link', 'folder.status', 'folder.sync', 'folder.unlink', 'separator', 'project.close',
    ],
  },
  {
    label: 'Edit',
    items: [
      'history.save', 'history.show', 'goto.line', 'code.symbols', 'separator', 'edit.find', 'edit.replace', 'edit.find-next', 'edit.find-prev',
      'search.files', 'separator', 'code.definition', 'code.references', 'code.rename', 'separator',
      'edit.comment', 'edit.move-up', 'edit.move-down', 'edit.duplicate', 'edit.delete-line', 'separator', 'edit.suggest', 'edit.help',
    ],
  },
  {
    label: 'View',
    items: [
      ...WORKSPACES.map((w) => `workspace.${w.id}`), 'separator',
      'editor.split-right', 'editor.split-down', 'editor.unsplit', 'editor.explorer', 'view.maximize', 'separator',
      'panel.show.files', 'panel.show.search', 'panel.show.editor', 'panel.show.game', 'panel.show.console', 'panel.show.history',
      'panel.show.learn', 'panel.show.time', 'panel.show.inspect', 'panel.show.sprites', 'panel.show.levels', 'panel.show.scene2d',
      'panel.show.sounds', 'panel.show.music',
      'panel.show.ship', 'panel.show.netlab', 'panel.show.plugins', 'panel.show.rules', 'panel.show.scene3d',
      'view.reset-layout', 'separator', 'settings.open',
    ],
  },
  { label: 'Run', items: ['game.run', 'game.stop', 'game.reload'] },
  { label: 'Ship', items: ['ship.measure', 'ship.export', 'separator', 'workspace.ship', 'panel.show.ship'] },
  {
    label: 'Debug',
    items: [
      'time.toggle', 'time.back', 'time.forward', 'time.replay', 'separator', 'time.save', 'time.open', 'separator',
      'workspace.debug', 'panel.show.inspect', 'panel.show.profiler', 'panel.show.netlab',
    ],
  },
  {
    label: 'Help',
    items: ['learn.start', 'learn.toggle', 'separator', 'palette.open', 'help.shortcuts', 'studio.offline', 'studio.install', 'help.about'],
  },
];
new Menubar($('menubar'), studio.commands, menus);

// on a narrow screen the menu bar is hidden: one button opens every menu, one after the other, in a list
$('menu-btn').addEventListener('click', () => {
  const items = [];
  for (const menu of menus) {
    items.push({ label: menu.label.toUpperCase(), disabled: true });
    for (const id of menu.items) {
      if (id === 'separator') continue;
      const c = studio.commands.get(id);
      if (!c) continue;
      items.push({
        label: c.title, hint: studio.commands.shortcutOf(id) ? studio.commands.shortcutLabel(id) : undefined, disabled: !!c.enabled && !c.enabled(),
        run: () => studio.commands.execute(id).catch(() => {}),
      });
    }
  }
  const r = $('menu-btn').getBoundingClientRect();
  openContextMenu({ x: r.left, y: r.bottom + 2 }, items, { label: 'Menus', restore: $('menu-btn') });
});

// workspace buttons
const drawWorkspaces = () => fill($('workspaces'), WORKSPACES.map((w) => h('button', {
  type: 'button', text: w.title, title: w.description, aria: { pressed: studio.workspace === w.id }, on: { click: () => studio.setWorkspace(w.id) },
})));
studio.on('workspace', drawWorkspaces);
drawWorkspaces();

$('search-btn').addEventListener('click', () => palette.toggle());
$('skip-link').addEventListener('click', (e) => {
  e.preventDefault();
  studio.dock.focus(document.querySelector('.dock-body > .panel-body:not([hidden])')?.dataset.panel);
});
$('search-kbd').textContent = studio.commands.shortcutLabel('palette.open');
studio.commands.on('change', () => { $('search-kbd').textContent = studio.commands.shortcutLabel('palette.open'); });

// the layout of the current workspace, remembered whenever it changes
studio.offline.start();                                         // the studio kept for offline use, on a web host (see core/offline.js)
await studio.plugins.load();                                    // their panels must be known before a saved layout is read
dock.setLayout(studio.layoutFor(studio.workspace));
dock.on('layout', (tree) => studio.saveLayout(tree));

// ---- the keyboard ----
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const modal = document.querySelector('.overlay:not(.hub)');
  if (modal && !palette.isOpen) return;                                              // a question is open: it has the keyboard
  if (palette.isOpen && !/^(k|p)$/i.test(e.key)) return;                              // the search box has it, except for its own toggle
  if (studio.commands.handleKey(e)) e.preventDefault();
}, true);

// ---- the status bar ----
const drawStatus = () => {
  const p = studio.project;
  fill($('st-project'), p ? p.name : 'No project');
  const state = p?.saveState ?? 'saved';
  $('st-save').className = `save ${state}`;
  const saveText = {
    saved: 'All changes saved', saving: 'Saving…', error: 'Could not save! Your work is only in this tab. File > Export keeps a copy.',
  };
  const gameText = { starting: 'starting', running: 'running', error: 'needs a fix', stuck: 'not responding', stopped: 'stopped' };
  $('st-save').textContent = p ? saveText[state] : '';
  $('st-game').textContent = p ? `Game: ${gameText[studio.runner.status] ?? studio.runner.status}` : '';
  $('st-cursor').textContent = studio.activeFile ? `${studio.activeFile}  Ln ${studio.cursor.line}, Col ${studio.cursor.column}` : '';
};
const drawGuide = () => {
  const s = studio.learn.session;
  const chip = $('st-guide');
  const learn = document.querySelector('[data-panel=learn]');
  const seen = !!learn && !learn.hidden && learn.offsetParent !== null;
  chip.hidden = !(s && s.enabled && s.started && !s.finished) || seen;
  if (!chip.hidden) chip.textContent = `Guide: step ${s.progress.index + 1} of ${s.total}. Click to open it`;
};
$('st-guide').addEventListener('click', () => studio.dock.show('learn'));
for (const ev of ['learn', 'layout', 'project', 'active-file']) studio.on(ev, drawGuide);
studio.dock.on?.('layout', drawGuide);
const drawFolder = () => {
  const f = studio.folder;
  const chip = $('st-folder');
  chip.hidden = !f.handle;
  if (!f.handle) return;
  const text = {
    synced: `Folder: ${f.name}`, syncing: `Folder: ${f.name} (syncing…)`, 'needs-permission': `Folder: ${f.name} (click to reconnect)`,
    error: `Folder: ${f.name} (problem: ${f.error})`,
  }[f.status] ?? `Folder: ${f.name}`;
  chip.textContent = text;
  chip.className = `folder ${f.status}`;
  chip.title = f.lastSync ? `Last in step ${new Date(f.lastSync).toTimeString().slice(0, 8)}. Click for details.` : 'Click for details.';
};
$('st-folder').addEventListener('click', () => {
  if (studio.folder.status === 'needs-permission') studio.folder.reconnect();
  else studio.commands.execute('folder.status');
});
studio.on('folder', drawFolder);
for (const ev of ['project', 'project-name', 'save-state', 'runner-status', 'cursor', 'active-file']) studio.on(ev, drawStatus);
$('st-project').addEventListener('click', () => hub.show());
drawStatus();
studio.on('project', async () => { studio.knownProjects = await studio.store.list().catch(() => []); });

// ---- go ----
await studio.init();
studio.knownProjects = await studio.store.list().catch(() => []);
if (!studio.project) hub.show();
else dock.focus('editor');

window.studio = studio;                 // for tests, and for curious people with the console open
window.studioUi = { dock, palette, hub };
