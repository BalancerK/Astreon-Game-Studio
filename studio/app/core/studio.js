// The studio itself: the project that is open, which files are open, the console, the layout of each workspace, and the game running beside the code. The
// panels and the commands are views and actions on this object; it owns the state and the rules (what happens when a file is deleted, when the code changes,
// when saving fails).
import { Emitter } from '../util/emitter.js';
import { CommandRegistry } from './commands.js';
import { Settings } from './settings.js';
import { Prefs } from './prefs.js';
import { RunnerController, defaultRunnerOrigin } from './runner-controller.js';
import { WORKSPACES, workspaceById, DEFAULT_WORKSPACE, PANEL_IDS } from './workspaces.js';
import { ProjectStore, StoreError } from '../store/project-store.js';
import { TEMPLATES, DEFAULT_TEMPLATE } from '../store/templates.js';
import { isMac } from '../util/keys.js';
import { LearnController } from './learn-controller.js';
import { TimeMachine } from './time-machine.js';
import { Ship } from './ship.js';
import { PluginManager } from '../plugins/manager.js';
import { FolderLinker } from './folder.js';
import { EditorGroups } from './editor-groups.js';
import { OfflineManager } from './offline.js';
import { editorVars, accentVars, fontStack, ALL_VARS } from '../ui/themes.js';
import { assetsOf, assetKind } from '../store/assets.js';
import { settingsOf } from '../store/project-settings.js';
import { explain } from '../editing/friendly.js';
import { declaredNames, importedNames } from '../editing/complete.js';

const MAX_CONSOLE = 500;

export class Studio extends Emitter {
  /**
   * @param {{backend: any, storage?: Storage | null, toasts: {show: Function}, runnerOrigin?: string, engineRoot?: string, mac?: boolean, backendNote?: string}} o
   */
  constructor({ backend, storage = null, toasts, runnerOrigin, engineRoot, mac = isMac(), backendNote = '' }) {
    super();
    this.mac = mac;
    this.toasts = toasts;
    this.prefs = new Prefs(storage);
    this.settings = new Settings(storage);
    this.commands = new CommandRegistry({ mac });
    this.commands.loadOverrides(this.prefs.get('keys', {}));
    this.commands.recent = this.prefs.get('recent', []);
    this.store = new ProjectStore(backend);
    this.backendNote = backendNote;               // set when projects could not be stored for real (the studio then says so)
    this.engineRoot = engineRoot ?? '/packages';
    this.runner = new RunnerController({ origin: runnerOrigin ?? defaultRunnerOrigin(), engineRoot });
    this.project = null;
    this.groups = new EditorGroups();             // which files are open, in which editor, in what order
    this.entries = [];
    this.nextEntry = 1;
    this.workspace = this.prefs.get('workspace', DEFAULT_WORKSPACE);
    this.lastDeleted = null;
    this.timers = {};
    this.cursor = { line: 1, column: 1 };
    this.dock = null;
    this.diagnostics = new Map();                 // file -> problems to underline in the editor, until the next run says they are gone
    this.highlights = new Map();                  // file -> lines the guide wants you to look at
    this.spriteApi = null;                        // set by the Sprites panel: open a sprite file in it
    this.searchApi = null;                        // set by the Search panel: open it on a text, or show where a name is used
    this.editorApi = null;                        // set by the code panel: what commands can ask the editor to do

    this.commands.on('run', () => this.prefs.set('recent', this.commands.recent));
    this.commands.on('change', () => this.prefs.set('keys', this.commands.overrides));
    this.commands.on('error', (error, id) => this.#problem(error, `"${this.commands.get(id)?.title ?? id}" did not work`));
    this.settings.on('change', () => { this.applySettings(); this.emit('settings'); });
    this.#wireRunner();
    this.runner.muted = this.prefs.get('muted', false);
    this.learn = new LearnController(this);
    this.timeMachine = new TimeMachine(this);
    this.ship = new Ship(this);
    this.plugins = new PluginManager(this);
    this.folder = new FolderLinker(this);
    this.offline = new OfflineManager(this);
    this.timers.snapshot = setInterval(() => this.#autoSnapshot(), 60_000);
  }

  // ---------- messages ----------
  /** Add a line to the console. */
  log(level, text, where = {}) {
    const entry = { id: this.nextEntry++, level, text, at: Date.now(), ...where };
    this.entries.push(entry);
    if (this.entries.length > MAX_CONSOLE) this.entries.splice(0, this.entries.length - MAX_CONSOLE);
    this.emit('console', entry);
    return entry;
  }

  clearConsole() {
    this.entries = [];
    this.emit('console', null);
  }

  /** Say something went wrong, in words a person can act on. */
  #problem(error, what) {
    const reason = error instanceof StoreError ? error.message : String(error?.message ?? error);
    this.toasts.show(`${what}: ${reason}`, { kind: 'error' });
    this.log('error', `${what}: ${reason}`);
  }

  // ---------- starting ----------
  async init() {
    await this.store.purgeOld(30).catch(() => {});
    this.applySettings();
    const last = await this.store.getMeta('last-project').catch(() => null);
    if (last) {
      try { await this.openProject(last); } catch { /* it is gone: the hub is shown */ }
    }
    this.emit('ready');
  }

  applySettings() {
    const root = document.documentElement;
    const theme = this.settings.get('theme');
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    // high contrast: asked for here, or by the system
    const more = theme === 'contrast' || (theme === 'system' && matchMedia('(prefers-contrast: more)').matches);
    root.dataset.theme = more ? 'contrast' : dark ? 'dark' : 'light';
    // the code colours and the accent colour: set on the page itself, so they sit on top of the interface theme (high contrast keeps its own)
    for (const name of ALL_VARS) root.style.removeProperty(name);
    const vars = { ...editorVars(this.settings.get('editorTheme')), ...(more ? {} : accentVars(this.settings.get('accent'), dark)) };
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.style.setProperty('--ui-scale', String(this.settings.get('uiScale') / 100));
    root.classList.toggle('reduce-motion', this.settings.get('reduceMotion'));
    if (!this.mediaWatcher) {
      this.mediaWatcher = matchMedia('(prefers-color-scheme: dark)');
      this.mediaWatcher.addEventListener('change', () => this.applySettings());
      matchMedia('(prefers-contrast: more)').addEventListener('change', () => this.applySettings());
    }
  }

  // ---------- projects ----------
  async createProject({ name, template = DEFAULT_TEMPLATE } = {}) {
    const t = TEMPLATES[template] ?? TEMPLATES[DEFAULT_TEMPLATE];
    const project = await this.store.create({ name: name || t.title, template, files: t.files });
    await project.snapshot({ label: 'Start' });
    await this.openProject(project.id);
    return project;
  }

  async openProject(id) {
    await this.closeProject();
    const project = await this.store.open(id);
    this.project = project;
    this.runner.projectId = project.id;
    project.on('change', (e) => this.#onProjectChange(e));
    project.on('save-state', (state, error) => { this.emit('save-state', state, error); if (state === 'error') this.#saveFailed(error); });
    project.on('rename', () => this.emit('project-name'));
    project.on('restore', () => { this.#pruneOpenFiles(); this.emit('files'); });
    const ui = (await this.store.getMeta(`ui:${id}`).catch(() => null)) ?? {};
    this.groups.load(ui, (p) => project.has(p));
    if (!this.groups.all().length) {
      const first = project.has('src/main.js') ? 'src/main.js' : project.list()[0];
      if (first) this.groups.open(first);
    }
    await this.store.setMeta('last-project', id).catch(() => {});
    this.clearConsole();
    this.log('system', `Opened "${project.name}"`);
    this.emit('project');
    this.emit('files');
    this.emit('active-file');
    await this.learn.load();
    await this.ship.load();
    await this.folder.load();
    this.run({ restart: true });
  }

  async closeProject() {
    if (!this.project) return;
    clearTimeout(this.timers.run);
    await this.project.flush().catch(() => {});
    await this.#saveUi(true);
    this.project = null;
    this.groups.load(null, () => false);
    this.learn.unload();
    this.folder.unlinkSilently?.();
    this.runner.stop();
    this.emit('project');
    this.emit('files');
    this.emit('active-file');
  }

  #saveFailed(error) {
    const reason = error?.message ?? error;
    this.toasts.show(`Could not save your work: ${reason}. It is safe in this tab; use File > Export to keep a copy.`, { kind: 'error', ms: 15000 });
    this.log('error', `Could not save: ${error?.message ?? error}`);
  }

  async #autoSnapshot() {
    if (!this.project) return;
    try {
      const made = await this.project.autoSnapshot({ minIntervalMs: this.settings.get('autoSnapshotMinutes') * 60_000 });
      if (made) this.emit('snapshots');
    } catch { /* a restore point that could not be made is not worth interrupting anyone */ }
  }

  /** Keep a restore point now. */
  async saveRestorePoint(label = '') {
    const made = await this.project.snapshot({ label: label || 'Saved by hand' });
    this.emit('snapshots');
    this.emit('restore-point');
    this.toasts.show(made ? 'Restore point saved.' : 'Nothing has changed since the last restore point.', { kind: made ? 'success' : 'info' });
    return made;
  }

  async restoreSnapshot(id) {
    await this.project.restore(id);
    this.emit('snapshots');
    this.log('system', 'Went back to an earlier restore point (what you had before was saved as a restore point too).');
    this.run({ restart: true });
  }

  /** Show a place in the code (a file, a line and a column), for example where an error happened. */
  goto(file, line = 1, column = 1) {
    if (file && this.project?.has(file)) this.openFile(file);
    this.dock?.show('editor');
    this.emit('goto', { line, column });
  }

  // ---------- files ----------
  #onProjectChange(e) {
    if (e.kind === 'remove') this.#pruneOpenFiles();
    if (e.kind === 'rename') this.groups.rename(e.from, e.path);
    if (e.kind !== 'write') this.emit('files');
    this.emit('file-changed', e);
    this.#saveUi();
    if (this.settings.get('autoRun')) this.#scheduleRun();
  }

  #pruneOpenFiles() {
    this.groups.prune((p) => !!this.project?.has(p));
    this.emit('active-file');
    this.emit('groups');
  }

  /** The files open in the editor that has the focus, and the one showing. */
  get openFiles() { return this.groups.files; }

  get activeFile() { return this.groups.active; }

  /** Show a file in the editor (in the one with the focus, or another: see `EditorGroups.open`). */
  openFile(path, options) {
    if (!this.project?.has(path)) return;
    this.groups.open(path, options);
    this.groupsChanged();
  }

  closeFile(path, group) {
    this.groups.close(path, group);
    this.groupsChanged();
  }

  /** Open a file in a new editor beside (or below) the one that has the focus. @param {'right' | 'left' | 'down' | 'up'} [side] */
  splitFile(path = this.activeFile, side = 'right') {
    if (!path || !this.project?.has(path)) return false;
    const ok = this.groups.split(path, this.groups.focus, side);
    if (!ok) this.toasts.show('There can be at most four editors side by side.', { kind: 'info' });
    this.groupsChanged();
    return ok;
  }

  /** Tell everyone the open files changed (the editor, the file lists, the status bar), and keep them for next time. */
  groupsChanged() {
    this.#saveUi();
    this.emit('groups');
    this.emit('active-file');
  }

  async newFile(path, content = '') {
    this.project.write(path, content);
    this.openFile(path);
    await this.project.flush().catch(() => {});
  }

  async renameFile(from, to) {
    await this.project.rename(from, to);
  }

  /** Delete a file; for a few seconds the toast offers to bring it back. */
  deleteFile(path) {
    const content = this.project.read(path);
    this.project.remove(path);
    this.lastDeleted = { path, content };
    this.toasts.show(`Deleted ${path}`, { action: { label: 'Undo', run: () => this.undoDelete() }, ms: 9000 });
  }

  undoDelete() {
    const d = this.lastDeleted;
    if (!d || this.project.has(d.path)) return;
    this.project.write(d.path, d.content);
    this.openFile(d.path);
    this.lastDeleted = null;
  }

  #saveUi(now = false) {
    clearTimeout(this.timers.ui);
    const write = () => {
      if (!this.project) return Promise.resolve();
      const saved = { ...this.groups.serialize(), openFiles: this.groups.all(), activeFile: this.groups.active };
      return this.store.setMeta(`ui:${this.project.id}`, saved).catch(() => {});
    };
    if (now) return write();
    this.timers.ui = setTimeout(write, 400);
    return Promise.resolve();
  }

  // ---------- the game ----------
  textFiles() { return this.#textFiles(); }

  /** What the folder link keeps in step: the text files, and the pictures and sounds (as bytes). */
  syncFiles() {
    const out = this.#textFiles();
    for (const [path, content] of Object.entries(this.project?.toFiles() ?? {})) {
      if (content instanceof Uint8Array && assetKind(path)) out[path] = content;
    }
    return out;
  }

  #textFiles() {
    const out = {};
    for (const [path, content] of Object.entries(this.project?.toFiles() ?? {})) if (typeof content === 'string') out[path] = content;
    return out;
  }

  #scheduleRun() {
    clearTimeout(this.timers.run);
    this.timers.run = setTimeout(() => this.run({ restart: false }), this.settings.get('autoRunDelay'));
  }

  /** Run the project in the game. `restart` starts the game over; otherwise the new code takes over and the game keeps its state. */
  run({ restart = true } = {}) {
    clearTimeout(this.timers.run);
    if (!this.project) return;
    const files = this.#textFiles();
    this.runner.run(files, { restart, assets: this.project ? assetsOf(this.project) : [], settings: settingsOf(files).settings });
  }

  #wireRunner() {
    const r = this.runner;
    r.on('status', (s) => this.emit('runner-status', s));
    r.on('summary', () => this.emit('runner-summary'));
    r.on('timeline', () => this.emit('runner-timeline'));
    r.on('state', () => this.emit('runner-state'));
    r.on('picked', (path) => {
      this.pickedInGame = path;
      if (path) this.dock?.show('inspect', { focus: false });
      queueMicrotask(() => this.emit('picked-in-game', path));
    });
    r.on('debug-change', () => this.emit('debug-change'));
    r.on('applied', (e) => { this.#setDiagnostics(new Map()); this.emit('runner-applied', e); this.emit('runner-summary'); });
    r.on('error', (m) => this.#reportError(m));
    r.on('hang', () => this.log('error', 'The game stopped responding, probably a loop that never ends, so it was stopped.'));
    r.on('recovered', (m) => {
      const from = m.fromSnapshot ? ', from where it was a moment ago' : '';
      this.log('system', `Running the last version that worked${from}. Your latest edit is still in the editor.`);
    });
    r.on('log', ({ level, text }) => this.log(level === 'log' ? 'info' : level, text));
  }

  /** An error from the game: say it in plain words, add what to try, and underline the place in the code. */
  async #reportError(m) {
    const where = m.file ? { file: m.file, line: m.line, column: m.column } : {};
    const what = m.kind === 'load' ? 'The code could not be loaded' : m.kind === 'worker' ? 'The game crashed' : 'The game stopped';
    const known = await this.#knownNames(m.file);
    const why = explain(m.message, known);
    const keeps = m.kind === 'load' ? ' (the game keeps running the last version that worked)' : '';
    const help = why.text ? `${why.text} ${why.hint}` : '';
    this.log('error', `${what}: ${why.message}${keeps}`, { ...where, ...(help ? { hint: help } : {}) });
    if (m.file && m.line) {
      const mine = new Map(this.diagnostics);
      mine.set(m.file, [{ line: m.line, column: m.column || 1, message: why.text || why.message, hint: why.text ? why.hint : '' }]);
      this.#setDiagnostics(mine);
    }
  }

  async #knownNames(file) {
    const names = new Set();
    for (const text of Object.values(this.#textFiles())) for (const n of declaredNames(text)) names.add(n);
    const own = file ? this.project?.readText?.(file) : '';
    for (const local of importedNames(own ?? '').keys()) names.add(local);
    try {
      const { API } = await import('../data/api-index.js');
      for (const p of Object.values(API.packages)) for (const e of p.exports) names.add(e.n);
    } catch { /* the suggestions just have fewer names */ }
    return [...names];
  }

  #setDiagnostics(map) {
    this.diagnostics = map;
    this.emit('diagnostics');
  }

  // ---------- workspaces and layouts ----------
  /** The saved layout of a workspace, or its default. */
  layoutFor(id) {
    return this.prefs.get(`layout.${id}`, null) ?? workspaceById(id).layout();
  }

  saveLayout(tree) {
    this.prefs.set(`layout.${this.workspace}`, tree);
  }

  setWorkspace(id) {
    if (!WORKSPACES.some((w) => w.id === id)) return;
    this.workspace = id;
    this.prefs.set('workspace', id);
    this.dock?.setLayout(this.layoutFor(id));
    this.emit('workspace');
  }

  resetLayout() {
    this.prefs.set(`layout.${this.workspace}`, null);
    this.dock?.setLayout(workspaceById(this.workspace).layout());
    this.emit('workspace');
  }

  dispose() {
    clearInterval(this.timers.snapshot);
    this.timeMachine.dispose();
    this.runner.dispose();
  }
}

export { PANEL_IDS };
