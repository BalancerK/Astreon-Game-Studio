// Every action of the studio, as commands. Menus, the search box, shortcuts and (later) lessons all run these, so each action is findable and has one name.
// A command that cannot be used right now says so with `enabled` and is then hidden from the search and does nothing when its shortcut is pressed.
import { PANEL_IDS, WORKSPACES } from './workspaces.js';
import { SCHEMA } from './settings.js';
import { pathProblem } from '../store/project-store.js';
import { confirm, promptText } from '../ui/dialog.js';
import { openSettings, openShortcuts } from '../ui/settings-dialog.js';
import { importAssets } from './import-assets.js';
import { editProjectSettings } from '../ui/project-settings-dialog.js';
import { ACCEPT } from '../store/assets.js';
import { download } from '../ui/hub.js';
import { goToDefinition, findUses, renameSymbol } from './refactor.js';
import { makePictureFromSvg } from './import-svg.js';
import { openSliceDialog } from './slice-dialog.js';
import { svgStem } from '../store/svg.js';
import { nameAt } from '../editing/code-index.js';
import { openFolderDialog } from './folder-dialog.js';
import { openPackDialog } from './pack-dialog.js';
import { pickMapFile } from './import-map.js';

const PANEL_TITLES = {
  files: 'Files', search: 'Search', editor: 'Editor', game: 'Game', console: 'Console', history: 'History', learn: 'Learn', time: 'Time',
  inspect: 'Inspector', profiler: 'Profiler',
  sprites: 'Sprites', levels: 'Level painter', scene2d: 'Scene', music: 'Music', sounds: 'Sounds', ship: 'Ship', netlab: 'Network lab',
  plugins: 'Plugins',
  rules: 'Rules', scene3d: '3D scene',
};
const capital = (text) => text[0].toUpperCase() + text.slice(1);

/**
 * @param {import('./studio.js').Studio} studio
 * @param {{palette: import('../ui/palette.js').Palette, hub: import('../ui/hub.js').Hub}} ui
 */
export function registerCommands(studio, { palette, hub }) {
  const reg = (command) => studio.commands.register(command);
  const hasProject = () => !!studio.project;
  const hasFile = () => hasProject() && !!studio.activeFile;

  registerProjectCommands();
  registerFileCommands();
  registerLearnCommands();
  registerTimeCommands();
  registerShipCommands();
  registerFolderCommands();
  registerEditCommands();
  registerEditorCommands();
  registerRunCommands();
  registerViewCommands();
  registerSettingCommands();
  registerHelpCommands();

  // ---- project ----
  function registerProjectCommands() {
    reg({
      id: 'project.hub', title: 'Projects…', category: 'Project', keywords: ['open', 'switch', 'new', 'start page', 'home'],
      run: () => hub.show(),
    });
    reg({ id: 'project.new', title: 'New project…', category: 'Project', keywords: ['create', 'start'], run: () => hub.show() });
    reg({
      id: 'project.rename', title: 'Rename project…', category: 'Project', enabled: hasProject,
      async run() {
        const name = await promptText({
          title: 'Rename project', label: 'Project name', value: studio.project.name,
          validate: (v) => (v.trim() ? null : 'Give it a name'),
        });
        if (name !== undefined) await studio.project.setName(name);
      },
    });
    reg({
      id: 'project.export', title: 'Export project as zip', category: 'Project', keywords: ['download', 'save a copy', 'backup'], enabled: hasProject,
      async run() {
        await studio.project.flush();
        download(`${studio.project.name}.zip`, studio.project.exportZip());
      },
    });
    reg({ id: 'project.close', title: 'Close project', category: 'Project', enabled: hasProject, run: () => studio.closeProject() });
  }

  // ---- files and history ----
  function registerFileCommands() {
    const nameProblem = (value, ...allowed) => {
      const name = value.trim();
      if (allowed.includes(name)) return null;
      return pathProblem(name) ?? (studio.project.has(name) ? 'There is already a file with that name' : null);
    };
    reg({
      id: 'file.new', title: 'New file…', category: 'File', shortcut: 'Alt+N', keywords: ['create', 'add'], enabled: hasProject,
      async run(dir) {
        const path = await promptText({
          title: 'New file', label: 'File name (use a folder like src/ship.js to put it in a folder)',
          value: typeof dir === 'string' && dir ? `${dir}/new.js` : 'src/new.js',
          confirmLabel: 'Create',
          validate: (v) => nameProblem(v),
        });
        if (path !== undefined) await studio.newFile(path.trim());
      },
    });
    reg({
      id: 'file.rename', title: 'Rename file…', category: 'File', shortcut: 'F2', keywords: ['move'], enabled: hasFile,
      async run(path = studio.activeFile) {
        const to = await promptText({
          title: 'Rename file', label: `New name for ${path}`, value: path, confirmLabel: 'Rename',
          validate: (v) => (v.trim() === path ? 'That is the same name' : nameProblem(v)),
        });
        if (to !== undefined) await studio.renameFile(path, to.trim());
      },
    });
    reg({
      id: 'file.delete', title: 'Delete file…', category: 'File', keywords: ['remove'], enabled: hasFile,
      async run(path = studio.activeFile) {
        const ok = await confirm({
          title: `Delete ${path}?`, confirmLabel: 'Delete', danger: true,
          message: 'You can undo this for a few seconds, and it stays in your earlier restore points.',
        });
        if (ok) studio.deleteFile(path);
      },
    });
    reg({
      id: 'file.close', title: 'Close file', category: 'File', shortcut: 'Alt+W',
      enabled: () => !!studio.activeFile, run: () => studio.closeFile(studio.activeFile),
    });
    reg({
      id: 'file.open', title: 'Open file…', category: 'File', shortcut: 'Mod+P', keywords: ['quick open', 'go to file', 'find file'],
      enabled: hasProject, run: () => palette.open('/'),
    });
    reg({
      id: 'goto.line', title: 'Go to line…', category: 'Edit', shortcut: 'Mod+G',
      enabled: () => !!studio.activeFile, run: () => palette.open(':'),
    });
    reg({
      id: 'search.files', title: 'Search in all files…', category: 'Edit', shortcut: 'Mod+Shift+F',
      keywords: ['find in files', 'grep', 'look for', 'replace in files'],
      enabled: hasProject, run: () => studio.searchApi ? studio.searchApi.open(studio.editorApi?.selectedText?.() ?? '') : studio.dock.show('search'),
    });
    reg({
      id: 'code.symbols', title: 'Go to a function or name in any file…', category: 'Edit', shortcut: 'Mod+Shift+O',
      keywords: ['symbol', 'outline', 'function', 'jump'],
      enabled: hasProject, run: () => palette.open('#'),
    });
    reg({
      id: 'history.save', title: 'Save a restore point', category: 'Edit', shortcut: 'Mod+S',
      keywords: ['snapshot', 'checkpoint', 'backup'], enabled: hasProject,
      async run() {
        const label = await promptText({ title: 'Save a restore point', label: 'Name it (optional)', value: '', confirmLabel: 'Save' });
        if (label !== undefined) await studio.saveRestorePoint(label.trim());
      },
    });
    reg({
      id: 'history.show', title: 'Show history', category: 'View', keywords: ['restore', 'undo', 'earlier', 'versions'],
      run: () => studio.dock.show('history'),
    });
  }

  // ---- the guided pathway ----
  function registerLearnCommands() {
    reg({
      id: 'learn.start', title: 'Start the guided pathway', category: 'Help',
      keywords: ['learn', 'tutorial', 'lesson', 'guide', 'beginner', 'course'],
      run: () => studio.learn.start(),
    });
    reg({
      id: 'learn.start3d', title: 'Start the 3D game pathway', category: 'Help',
      keywords: ['learn', 'tutorial', '3d', 'first person', 'gems', 'guide'],
      run: () => studio.learn.start('world3d'),
    });
    reg({
      id: 'learn.toggle', title: 'Turn the guide on or off', category: 'Help', keywords: ['learn', 'tutorial', 'pathway', 'hide'],
      enabled: () => !!studio.learn.session,
      run: () => studio.learn.setEnabled(!studio.learn.session.enabled),
    });
    reg({
      id: 'learn.hint', title: 'Give me a hint', category: 'Help', keywords: ['learn', 'stuck', 'help'],
      enabled: () => !!studio.learn.session?.enabled && studio.learn.session.hasMoreHints,
      run: () => studio.learn.hint(),
    });
  }

  // ---- a folder on the computer ----
  function registerFolderCommands() {
    reg({
      id: 'folder.link', title: 'Link this project to a folder…', category: 'File', keywords: ['git', 'disk', 'sync', 'open folder',
        'save to computer', 'vscode'],
      enabled: () => hasProject() && !studio.folder.handle, run: () => studio.folder.pick(),
    });
    reg({
      id: 'project.settings', title: 'Project settings…', category: 'File',
      keywords: ['title', 'size', 'resolution', 'screen', 'aspect', 'icon', 'background', 'portrait'],
      enabled: hasProject, run: () => editProjectSettings(studio),
    });
    reg({ id: 'file.import', title: 'Import pictures and sounds…', category: 'File', keywords: ['image', 'png', 'sound', 'wav', 'upload', 'asset'],
      enabled: hasProject, run: () => pickAssets(studio) });
    reg({
      id: 'assets.pack', title: 'Free pictures, sounds and music…', category: 'File',
      keywords: ['asset', 'assets', 'library', 'free', 'sprites', 'sprite', 'sounds', 'music', 'pack', 'cc0', 'tiles', 'characters', 'download'],
      enabled: hasProject, run: (args) => openPackDialog(studio, args ?? {}),
    });
    reg({
      id: 'level.import', title: 'Import a level from Tiled or LDtk…', category: 'File',
      keywords: ['tiled', 'ldtk', 'tmj', 'map', 'level', 'import', 'tilemap', 'entities', 'objects'],
      enabled: hasProject, run: () => pickMapFile(studio),
    });
    reg({
      id: 'art.slice', title: 'Slice a sprite sheet…', category: 'File',
      keywords: ['spritesheet', 'sprite sheet', 'frames', 'cut', 'grid', 'tiles', 'animation'],
      enabled: hasProject, run: () => openSliceDialog(studio, /^assets\//.test(studio.activeFile ?? '') ? studio.activeFile : undefined),
    });
    reg({
      id: 'file.svg-picture', title: 'Make a picture from this SVG…', category: 'File', keywords: ['svg', 'drawing', 'vector', 'png', 'convert'],
      enabled: () => hasFile() && /\.svg$/i.test(studio.activeFile),
      run: () => makePictureFromSvg(studio, studio.project.readText(studio.activeFile), svgStem(studio.activeFile), { replace: true }),
    });
    reg({ id: 'studio.offline', title: 'Offline use and installing…', category: 'Help',
      keywords: ['install', 'app', 'pwa', 'no internet', 'offline'], run: () => studio.offline.dialog() });
    reg({ id: 'studio.install', title: 'Install the studio as an app', category: 'Help', keywords: ['pwa', 'desktop', 'offline'],
      enabled: () => !!studio.offline.prompt, run: () => studio.offline.install() });
    reg({ id: 'folder.status', title: 'Folder link: status, conflicts and what is left out…', category: 'File',
      keywords: ['folder', 'conflicts', 'sync'],
      enabled: () => !!studio.folder.handle, run: () => openFolderDialog(studio.folder) });
    reg({ id: 'folder.sync', title: 'Sync with the folder now', category: 'File', enabled: () => !!studio.folder.handle,
      run: () => studio.folder.reconnect() });
    reg({ id: 'folder.unlink', title: 'Unlink the folder', category: 'File', enabled: () => !!studio.folder.handle,
      run: () => studio.folder.unlink() });
  }

  // ---- shipping ----
  function registerShipCommands() {
    reg({
      id: 'ship.measure', title: 'Measure my game (web health)', category: 'Ship', keywords: ['performance', 'size', 'budget', 'speed', 'report'],
      enabled: hasProject, run: () => { studio.dock.show('ship'); return studio.ship.measure(); },
    });
    reg({
      id: 'ship.export', title: 'Export as a web game (.zip)', category: 'Ship', keywords: ['publish', 'build', 'upload', 'itch', 'pwa', 'install',
        'offline', 'share'],
      enabled: hasProject, run: () => { studio.dock.show('ship'); return studio.ship.exportZip({ title: studio.project.name }); },
    });
  }

  // ---- the Time Machine ----
  function registerTimeCommands() {
    const tm = studio.timeMachine;
    const live = () => hasProject() && !!studio.runner.timeline;
    reg({
      id: 'time.toggle', title: 'Pause or play the game', category: 'Debug', shortcut: 'F8', keywords: ['freeze', 'time machine', 'stop'],
      enabled: live, run: () => tm.toggle(),
    });
    reg({
      id: 'time.back', title: 'Step back one tick', category: 'Debug', shortcut: 'Alt+ArrowLeft', keywords: ['rewind', 'previous'],
      enabled: live, run: () => tm.step(-1),
    });
    reg({
      id: 'time.forward', title: 'Step forward one tick', category: 'Debug', shortcut: 'Alt+ArrowRight', keywords: ['next', 'advance'],
      enabled: live, run: () => tm.step(1),
    });
    reg({
      id: 'time.replay', title: 'Replay from here with my code', category: 'Debug', keywords: ['what if', 'again', 'rerun', 'time machine'],
      enabled: live, run: () => tm.replay(),
    });
    reg({
      id: 'time.save', title: 'Save a recording…', category: 'Debug', keywords: ['share a bug', 'replay file', 'export', 'time machine'],
      enabled: live, run: () => tm.save(),
    });
    reg({
      id: 'time.open', title: 'Open a recording…', category: 'Debug', keywords: ['replay file', 'import', 'bug report', 'time machine'],
      run() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => { if (input.files[0]) tm.open(input.files[0]); });
        input.click();
      },
    });
  }

  // ---- the editors and their tabs ----
  function registerEditorCommands() {
    const g = () => studio.groups;
    const changed = () => studio.groupsChanged();
    const anyOpen = () => hasProject() && !!studio.activeFile;
    const many = () => hasProject() && g().groups.length > 1;
    const cycleTab = (step) => {
      const files = g().files;
      if (files.length < 2) return;
      g().activate(files[(files.indexOf(g().active) + step + files.length) % files.length]);
      changed();
      studio.editorApi?.focusEditor?.();
    };
    const focusGroup = (step) => {
      g().focusGroup((g().focus + step + g().groups.length) % g().groups.length);
      changed();
      studio.editorApi?.focusEditor?.();
    };
    reg({
      id: 'editor.split-right', title: 'Split the editor to the right', category: 'View', shortcut: 'Mod+\\',
      keywords: ['side by side', 'two editors', 'duplicate'],
      enabled: anyOpen, run: () => studio.splitFile(studio.activeFile, 'right'),
    });
    reg({
      id: 'editor.split-down', title: 'Split the editor downwards', category: 'View', keywords: ['one above the other', 'two editors'],
      enabled: anyOpen, run: () => studio.splitFile(studio.activeFile, 'down'),
    });
    reg({
      id: 'view.maximize', title: 'Make this panel fill the window (and back)', category: 'View', shortcut: 'Mod+Shift+Enter',
      keywords: ['zoom', 'full screen', 'focus mode', 'bigger'],
      enabled: hasProject, run: () => studio.dock?.maximize(),
    });
    reg({ id: 'editor.unsplit', title: 'Join the editors into one', category: 'View', enabled: many, run: () => { g().unsplit(); changed(); } });
    reg({
      id: 'editor.focus-next', title: 'Go to the next editor', category: 'View', shortcut: 'Alt+Shift+ArrowRight', enabled: many,
      run: () => focusGroup(1),
    });
    reg({
      id: 'editor.focus-previous', title: 'Go to the previous editor', category: 'View', shortcut: 'Alt+Shift+ArrowLeft', enabled: many,
      run: () => focusGroup(-1),
    });
    reg({
      id: 'editor.move-other', title: 'Move this file to the other editor', category: 'View', enabled: () => many() && anyOpen(),
      run: () => { g().move(studio.activeFile, g().focus, (g().focus + 1) % g().groups.length); changed(); },
    });
    reg({
      id: 'editor.next-tab', title: 'Next tab', category: 'View', shortcut: 'Alt+PageDown', keywords: ['switch file'], enabled: anyOpen,
      run: () => cycleTab(1),
    });
    reg({
      id: 'editor.previous-tab', title: 'Previous tab', category: 'View', shortcut: 'Alt+PageUp', keywords: ['switch file'], enabled: anyOpen,
      run: () => cycleTab(-1),
    });
    // a browser keeps Ctrl+Tab for its own tabs; in the installed app (no browser tabs) it reaches the studio, so it works there
    reg({
      id: 'editor.next-tab-ctrl', title: 'Next tab (Ctrl+Tab, in the installed app)', category: 'View', shortcut: 'Ctrl+Tab', enabled: anyOpen,
      run: () => cycleTab(1),
    });
    reg({
      id: 'editor.previous-tab-ctrl', title: 'Previous tab (Ctrl+Shift+Tab, in the installed app)', category: 'View', shortcut: 'Ctrl+Shift+Tab',
      enabled: anyOpen, run: () => cycleTab(-1),
    });
    reg({
      id: 'editor.close-others', title: 'Close the other tabs', category: 'File', enabled: () => anyOpen() && g().files.length > 1,
      run: () => { g().closeOthers(studio.activeFile); changed(); },
    });
    reg({
      id: 'editor.close-right', title: 'Close the tabs to the right', category: 'File',
      enabled: () => anyOpen() && g().files.indexOf(g().active) < g().files.length - 1,
      run: () => { g().closeToRight(studio.activeFile); changed(); },
    });
    reg({ id: 'editor.close-all', title: 'Close all tabs', category: 'File', enabled: anyOpen, run: () => { g().closeAll(); changed(); } });
    reg({
      id: 'editor.explorer', title: 'Show or hide the explorer beside the code', category: 'View', shortcut: 'Mod+B',
      keywords: ['sidebar', 'file tree', 'files'],
      enabled: hasProject, run: () => { studio.dock?.show('editor'); studio.editorApi?.toggleExplorer?.(); },
    });
    reg({
      id: 'editor.reveal', title: 'Show this file in the explorer', category: 'View', shortcut: 'Mod+Shift+E', enabled: anyOpen,
      run: () => { studio.dock?.show('editor'); studio.editorApi?.showInExplorer?.(studio.activeFile); },
    });
  }

  // ---- writing code ----
  function registerEditCommands() {
    const inEditor = () => !!studio.editorApi?.usable();
    const edits = [
      ['edit.find', 'Find…', 'Mod+F', 'find', ['search', 'look for']],
      ['edit.replace', 'Find and replace…', 'Mod+H', 'replace', ['substitute', 'change all']],
      ['edit.find-next', 'Find next', 'F3', 'findNext', []],
      ['edit.find-prev', 'Find previous', 'Shift+F3', 'findPrev', []],
      ['edit.comment', 'Comment or uncomment lines', 'Mod+/', 'toggleComment', ['toggle comment', 'disable lines']],
      ['edit.move-up', 'Move line up', 'Alt+ArrowUp', 'moveUp', []],
      ['edit.move-down', 'Move line down', 'Alt+ArrowDown', 'moveDown', []],
      ['edit.duplicate', 'Copy line down', 'Shift+Alt+ArrowDown', 'duplicate', ['duplicate line']],
      ['edit.delete-line', 'Delete line', 'Mod+Shift+K', 'deleteLine', ['remove line']],
      ['edit.suggest', 'Show suggestions', 'Mod+Space', 'suggest', ['autocomplete', 'complete']],
      ['edit.help', 'Show help for this word', 'Mod+I', 'help', ['docs', 'documentation', 'what is this', 'signature']],
    ];
    const here = () => !!studio.editorApi?.usable();
    reg({
      id: 'code.definition', title: 'Go to where this name is declared', category: 'Edit', shortcut: 'F12',
      keywords: ['definition', 'declaration', 'jump', 'source'],
      enabled: here, run: () => goToDefinition(studio),
    });
    reg({
      id: 'code.references', title: 'Find everywhere this name is used', category: 'Edit', shortcut: 'Shift+F12',
      keywords: ['references', 'usages', 'uses', 'who calls'],
      enabled: here, run: () => findUses(studio),
    });
    reg({
      id: 'code.rename', title: 'Rename this name everywhere…', category: 'Edit', shortcut: 'Mod+F2',
      keywords: ['refactor', 'change name', 'rename variable', 'rename function'],
      enabled: () => here() && !!nameAt(studio.editorApi.caret().text, studio.editorApi.caret().index), run: () => renameSymbol(studio),
    });
    for (const [id, title, shortcut, action, keywords] of edits) {
      reg({ id, title, category: 'Edit', shortcut, keywords, enabled: inEditor, run: () => studio.editorApi.action(action) });
    }
  }

  // ---- the game ----
  function registerRunCommands() {
    reg({
      id: 'game.run', title: 'Run the game', category: 'Run', shortcut: 'Mod+Enter', keywords: ['play', 'start', 'restart'],
      enabled: hasProject, run: () => studio.run({ restart: true }),
    });
    reg({
      id: 'game.fullscreen', title: 'Play the game full screen (Esc leaves)', category: 'Run', shortcut: 'Alt+Enter',
      keywords: ['fullscreen', 'full screen', 'maximize', 'big', 'testing', 'mouse'],
      enabled: hasProject, run: () => studio.runner.toggleFullscreen(),
    });
    reg({
      id: 'game.pick', title: 'Pick things by clicking them in the game', category: 'Run', keywords: ['select', 'inspect', 'click', 'crosshair'],
      enabled: hasProject, run: () => studio.runner.setPickMode(!studio.runner.pickMode),
    });
    reg({
      id: 'game.debug', title: 'Show or hide the numbers on the game', category: 'Run', shortcut: 'F3', keywords: ['overlay', 'fps', 'debug',
        'counts'],
      enabled: hasProject, run: () => studio.runner.setOverlay(!studio.runner.overlayOn),
    });
    reg({
      id: 'game.boxes', title: 'Show or hide a box around every thing', category: 'Run', keywords: ['hitbox', 'bounds', 'collision', 'debug'],
      enabled: hasProject, run: () => studio.runner.setOverlay(true, !studio.runner.boxesOn),
    });
    reg({ id: 'game.stop', title: 'Stop the game', category: 'Run', enabled: hasProject, run: () => studio.runner.stop() });
    reg({
      id: 'game.reload', title: 'Reload the game frame', category: 'Run', keywords: ['fix', 'stuck', 'reset'],
      run: () => { studio.runner.reload(); studio.run({ restart: true }); },
    });
  }

  // ---- view: workspaces, panels, layout ----
  function registerViewCommands() {
    WORKSPACES.forEach((w, i) => reg({
      id: `workspace.${w.id}`, title: `${w.title} workspace`, category: 'View', description: w.description, keywords: ['layout', 'arrange'],
      shortcut: `Alt+${i + 1}`, run: () => studio.setWorkspace(w.id),
    }));
    reg({
      id: 'view.reset-layout', title: 'Reset panel layout', category: 'View', keywords: ['arrange', 'default'],
      run: () => studio.resetLayout(),
    });
    for (const id of PANEL_IDS) {
      reg({
        id: `panel.show.${id}`, title: `Show ${PANEL_TITLES[id]}`, category: 'View', keywords: ['panel', 'open'],
        run: () => studio.dock.show(id),
      });
    }
    reg({
      id: 'panel.close', title: 'Close this panel', category: 'View', keywords: ['hide'],
      enabled: () => !!studio.dock?.focusedPanel, run: () => studio.dock.close(studio.dock.focusedPanel),
    });
    const cycle = (step) => {
      const panels = [...document.querySelectorAll('.dock-body > .panel-body:not([hidden])')];
      if (!panels.length) return;
      const now = panels.findIndex((p) => p.contains(document.activeElement));
      studio.dock.focus(panels[(now + step + panels.length) % panels.length].dataset.panel);
    };
    reg({ id: 'focus.next', title: 'Move to the next panel', category: 'View', shortcut: 'F6', run: () => cycle(1) });
    reg({ id: 'focus.previous', title: 'Move to the previous panel', category: 'View', shortcut: 'Shift+F6', run: () => cycle(-1) });
  }

  // ---- settings, each one also reachable from the search ----
  function registerSettingCommands() {
    reg({
      id: 'settings.open', title: 'Settings…', category: 'View', shortcut: 'Mod+,', keywords: ['preferences', 'options'],
      run: () => openSettings(studio),
    });
    const settings = studio.settings;
    const setting = (name, suffix, title, run) => reg({ id: `setting.${name}.${suffix}`, title, category: 'Setting', run });
    for (const [name, def] of Object.entries(SCHEMA)) {
      if (def.type === 'choice') {
        for (const choice of def.choices) setting(name, choice, `${def.label}: ${capital(choice)}`, () => settings.set(name, choice));
      } else if (def.type === 'boolean') {
        setting(name, 'toggle', `Toggle: ${def.label}`, () => settings.set(name, !settings.get(name)));
      } else {
        const step = def.step ?? 1;
        setting(name, 'up', `Increase: ${def.label}`, () => settings.set(name, settings.get(name) + step));
        setting(name, 'down', `Decrease: ${def.label}`, () => settings.set(name, settings.get(name) - step));
      }
    }
  }

  // ---- help ----
  function registerHelpCommands() {
    reg({
      id: 'palette.open', title: 'Search everything…', category: 'Help', shortcut: 'Mod+K', keywords: ['command palette', 'find', 'go to'],
      run: () => palette.toggle(),
    });
    reg({
      id: 'palette.alt', title: 'Search everything (alternative shortcut)', category: 'Help', shortcut: 'Mod+Shift+P',
      run: () => palette.toggle(),
    });
    reg({
      id: 'help.shortcuts', title: 'Keyboard shortcuts…', category: 'Help', shortcut: 'F1',
      keywords: ['keys', 'hotkeys', 'help', 'change shortcut'],
      run: () => openShortcuts(studio),
    });
    reg({
      id: 'help.about', title: 'About the studio', category: 'Help',
      run: () => studio.toasts.show(
        'Astreon Studio, made with Astreon Engine (early version). Your projects are saved in this browser; export a zip to keep a copy elsewhere.',
          { ms: 9000 },
      ),
    });
  }
}

/** Ask the person for pictures and sounds (a file chooser made on the spot, so the menu and the palette can open it too). */
function pickAssets(studio) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT;
  input.addEventListener('change', () => importAssets(studio, [...input.files]));
  input.click();
}
