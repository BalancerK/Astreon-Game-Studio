// Plugins in the studio: installing them, showing their panels, running their commands, and answering the few things they may ask. A plugin's code never runs in
// the studio's own page: each panel and each plugin's background work runs in a sandboxed frame (see studio/plugins/sandbox.js) with no network and no storage,
// and everything it asks for passes through `#answer`, which first checks the request and then the permission the person gave when installing.
import { h } from '../ui/dom.js';
import { confirm } from '../ui/dialog.js';
import { download } from '../ui/hub.js';
import { writeZip } from '../store/zip.js';
import { parseManifest, checkManifest, parseRequest, permissionFor, checkFiles, describePermissions, safePath,
  LIMITS } from '../../plugins/protocol.js';
import { sandboxDocument, THEME_VARIABLES } from '../../plugins/sandbox.js';

const KEY = 'plugins';
const RUN_TIMEOUT_MS = 20_000;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';

export class PluginManager {
  /** @param {import('../core/studio.js').Studio} studio */
  constructor(studio) {
    this.studio = studio;
    /** @type {Map<string, {manifest: any, code: string, enabled: boolean, installedAt: number}>} */
    this.plugins = new Map();
    this.frames = new Set();                   // every frame a plugin runs in, with what it is for
    this.background = new Map();               // plugin id -> its hidden frame's binding
    this.undo = new Map();                     // plugin id -> things to undo when it is turned off
    this.failed = new Map();                   // plugin id -> why it stopped
    addEventListener('message', (e) => this.#onMessage(e));
    let timer = 0;
    studio.on('file-changed', (e) => { clearTimeout(timer); timer = setTimeout(() => this.#broadcast('files-changed', { path: e?.path }), 150); });
    studio.on('files', () => this.#broadcast('files-changed', {}));
  }

  /** Read the installed plugins and start the ones that are on. */
  async load() {
    const saved = await this.studio.store.getMeta(KEY).catch(() => null);
    for (const entry of Array.isArray(saved) ? saved : []) {
      try {
        const manifest = checkManifest(parseManifest(entry.code));
        this.plugins.set(manifest.id, { manifest, code: entry.code, enabled: entry.enabled !== false, installedAt: entry.installedAt ?? Date.now() });
      } catch { /* a stored plugin that no longer reads is left out */ }
    }
    for (const p of this.plugins.values()) if (p.enabled) this.#activate(p);
    this.studio.emit('plugins');
  }

  #save() {
    const list = [...this.plugins.values()].map((p) => ({ code: p.code, enabled: p.enabled, installedAt: p.installedAt }));
    return this.studio.store.setMeta(KEY, list).catch(() => {});
  }

  /**
   * Install (or update) a plugin from its source. Asks first, in plain words, what it wants to be allowed to do.
   * @returns {Promise<{id: string, name: string} | null>} null if the person said no
   */
  async install(code, { ask = true } = {}) {
    if (typeof code !== 'string' || code.length > LIMITS.code) throw new Error(`A plugin must be text of at most ${LIMITS.code / 1000} KB.`);
    const manifest = checkManifest(parseManifest(code));
    const old = this.plugins.get(manifest.id);
    const newAsks = manifest.permissions.filter((p) => !old?.manifest.permissions.includes(p));
    if (ask && (!old || newAsks.length)) {
      const lines = describePermissions({ permissions: old ? newAsks : manifest.permissions }).map((l) => `• ${l}`).join('\n');
      const ok = await confirm({
        title: `${old ? 'Update' : 'Install'} "${manifest.name}"?`, confirmLabel: old ? 'Update' : 'Install',
        message: `${manifest.description ? `${manifest.description}\n\n` : ''}It asks to be able to:\n${lines}\n\n`
          + 'A plugin runs in a closed box: it cannot reach the internet or anything else on your computer, only what is listed here.',
      });
      if (!ok) return null;
    }
    if (old) this.#deactivate(old);
    const plugin = { manifest, code, enabled: true, installedAt: old?.installedAt ?? Date.now() };
    this.plugins.set(manifest.id, plugin);
    this.failed.delete(manifest.id);
    this.#activate(plugin);
    await this.#save();
    this.studio.log('system', `${old ? 'Updated' : 'Installed'} the plugin "${manifest.name}".`);
    this.studio.emit('plugin-event', 'installed');
    this.studio.emit('plugins');
    return { id: manifest.id, name: manifest.name };
  }

  async remove(id) {
    const p = this.plugins.get(id);
    if (!p) return;
    this.#deactivate(p);
    this.plugins.delete(id);
    await this.studio.store.setMeta(`plugin-state:${id}`, null).catch(() => {});
    await this.#save();
    this.studio.emit('plugins');
  }

  async setEnabled(id, on) {
    const p = this.plugins.get(id);
    if (!p || p.enabled === !!on) return;
    p.enabled = !!on;
    if (on) this.#activate(p); else this.#deactivate(p);
    await this.#save();
    this.studio.emit('plugins');
  }

  // ---- what a plugin adds to the studio ----
  #activate(p) {
    const { manifest } = p;
    const undo = [];
    const reg = (command) => { this.studio.commands.register(command); undo.push(() => this.studio.commands.unregister(command.id)); };
    const prefix = `plugin.${manifest.id}`;
    for (const panel of manifest.panels) {
      const id = `plugin:${manifest.id}:${panel.id}`;
      this.studio.dock?.define({ id, title: panel.title, icon: 'edit', create: () => this.#panelView(p, panel, id) });
      undo.push(() => this.studio.dock?.undefine(id));
      reg({ id: `${prefix}.show.${panel.id}`, title: `Show ${panel.title}`, category: 'Plugins', keywords: [manifest.name],
        run: () => this.studio.dock.show(id) });
    }
    for (const c of manifest.commands) {
      reg({ id: `${prefix}.cmd.${c.id}`, title: `${manifest.name}: ${c.title}`, category: 'Plugins',
        run: () => this.#run(p, 'command', c.id, []).catch((e) => this.#problem(p, e)) });
    }
    for (const x of manifest.exporters) {
      reg({ id: `${prefix}.export.${x.id}`, title: `${x.title}`, category: 'Export', keywords: [manifest.name, 'plugin'],
        enabled: () => !!this.studio.project, run: () => this.#export(p, x) });
    }
    for (const x of manifest.importers) {
      reg({ id: `${prefix}.import.${x.id}`, title: `${x.title}`, category: 'Import', keywords: [manifest.name, 'plugin'],
        run: () => this.#import(p, x) });
    }
    this.undo.set(manifest.id, undo);
  }

  #deactivate(p) {
    for (const fn of this.undo.get(p.manifest.id) ?? []) { try { fn(); } catch { /* already gone */ } }
    this.undo.delete(p.manifest.id);
    this.background.delete(p.manifest.id);
    for (const b of [...this.frames]) if (b.p === p) { b.frame.remove(); this.frames.delete(b); }
  }

  #panelView(p, panel, id) {
    const frame = this.#frame(p, { panel: panel.id, title: panel.title });
    return {
      el: h('div', { class: 'panel-body plugin-body', 'data-plugin-panel': id }, frame.frame),
      focus: () => frame.frame.focus(),
      dispose: () => this.frames.delete(frame),
    };
  }

  /** Make the sandboxed frame for a plugin and remember what it is for. */
  #frame(p, { panel = null, title = p.manifest.name } = {}) {
    const frame = h('iframe', {
      class: 'plugin-frame', title: `${title} (plugin: ${p.manifest.name})`, sandbox: 'allow-scripts', srcdoc: sandboxDocument(), tabIndex: 0,
      style: panel ? { width: '100%', height: '100%', border: '0' } : { display: 'none' },
    });
    const binding = { p, frame, panel, ready: false, calls: 0, runs: new Map(), nextRun: 1, readyPromise: null, windowStart: performance.now() };
    binding.readyPromise = new Promise((resolve) => { binding.resolveReady = resolve; });
    this.frames.add(binding);
    if (!panel) document.body.append(frame);
    return binding;
  }

  #theme() {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(THEME_VARIABLES.map((k) => [k, style.getPropertyValue(k).trim()]).filter(([, v]) => v));
  }

  #send(binding, message) {
    try { binding.frame.contentWindow?.postMessage({ v: 1, ...message }, '*'); } catch { /* the frame is gone */ }
  }

  #broadcast(name, data) {
    for (const b of this.frames) {
      if (name === 'files-changed' && !b.p.manifest.permissions.includes('files.read')) continue;
      if (b.ready) this.#send(b, { t: 'event', name, data });
    }
  }

  #problem(p, error) {
    const text = String(error?.message ?? error).slice(0, 300);
    this.failed.set(p.manifest.id, text);
    this.studio.log('error', `The plugin "${p.manifest.name}" stopped: ${text}`);
    this.studio.emit('plugins');
  }

  async #onMessage(event) {
    if (!event.source) return;
    const binding = [...this.frames].find((b) => b.frame.contentWindow === event.source);
    if (!binding) return;
    const m = event.data;
    if (!m || typeof m !== 'object' || m.v !== 1) return;
    if (m.t === 'hello') {
      this.#send(binding, { t: 'init', code: binding.p.code, panel: binding.panel, theme: this.#theme() });
    } else if (m.t === 'ready') {
      binding.ready = true;
      binding.resolveReady();
      if (binding.panel) this.studio.emit('plugin-event', 'panel-ready');
      this.studio.emit('plugins');
    } else if (m.t === 'failed') {
      this.#problem(binding.p, m.message);
    } else if (m.t === 'log') {
      this.studio.log(['info', 'warn', 'error'].includes(m.level) ? m.level : 'info', `[${binding.p.manifest.name}] ${String(m.text).slice(0, 500)}`);
    } else if (m.t === 'result') {
      const waiting = binding.runs.get(m.id);
      if (waiting) { binding.runs.delete(m.id); if (m.ok) waiting.resolve(m.result); else waiting.reject(new Error(String(m.error).slice(0, 300))); }
    } else if (m.t === 'call') {
      const request = parseRequest(m);
      if (!request) return;
      let reply;
      try { reply = { ok: true, result: await this.#answer(binding, request) }; } catch (error) { reply = { ok: false,
        error: String(error?.message ?? error).slice(0, 300) }; }
      this.#send(binding, { t: 'reply', id: request.id, ...reply });
    }
  }

  /** Do what a plugin asked, if it is allowed to. */
  async #answer(binding, { method, args }) {
    const p = binding.p;
    const now = performance.now();
    if (now - binding.windowStart > 1000) { binding.windowStart = now; binding.calls = 0; }
    if (++binding.calls > 300) throw new Error('Too many requests a second: slow down.');
    const need = permissionFor(method);
    if (need && !p.manifest.permissions.includes(need)) {
      throw new Error(`This plugin did not ask for permission to ${method.split('.')[0] === 'files' ? 'use files' : 'do that'} (${need}).`);
    }
    const st = this.studio;
    switch (method) {
      case 'files.list': return st.project ? st.project.list().filter((f) => typeof st.project.read(f) === 'string') : [];
      case 'files.read': {
        if (!st.project) throw new Error('No project is open.');
        if (!safePath(args[0]) || typeof st.project.read(args[0]) !== 'string') {
          throw new Error(`There is no text file called "${String(args[0]).slice(0, 60)}".`);
        }
        return st.project.readText(args[0]);
      }
      case 'files.write': {
        if (!st.project) throw new Error('No project is open.');
        if (!safePath(args[0]) || typeof args[1] !== 'string' || args[1].length > 2_000_000) {
          throw new Error('That is not a file name and text the studio can keep.');
        }
        st.project.write(args[0], args[1]);
        st.emit('files');
        return true;
      }
      case 'files.remove': {
        if (!st.project || !safePath(args[0]) || !st.project.has(args[0])) throw new Error('There is no such file.');
        st.project.remove(args[0]);
        st.emit('files');
        return true;
      }
      case 'game.summary': return st.runner.summary ?? null;
      case 'ui.toast': st.toasts.show(`${p.manifest.name}: ${String(args[0]).slice(0, 200)}`,
        { kind: ['info', 'success', 'error'].includes(args[1]) ? args[1] : 'info' }); return true;
      case 'log': st.log(['info', 'warn', 'error'].includes(args[0]) ? args[0] : 'info',
        `[${p.manifest.name}] ${String(args[1]).slice(0, 500)}`); return true;
      case 'state.get': return (await st.store.getMeta(`plugin-state:${p.manifest.id}`).catch(() => null)) ?? {};
      case 'state.set': {
        const json = JSON.stringify(args[0] ?? {});
        if (json === undefined || json.length > LIMITS.state) {
          throw new Error(`A plugin may keep up to ${LIMITS.state / 1000} KB of its own settings.`);
        }
        await st.store.setMeta(`plugin-state:${p.manifest.id}`, JSON.parse(json));
        return true;
      }
      default: throw new Error('Unknown request.');
    }
  }

  /** Ask a plugin to run one of its commands, exporters or importers (in its hidden frame). */
  async #run(p, kind, command, args) {
    let binding = this.background.get(p.manifest.id);
    if (!binding) {
      binding = this.#frame(p);
      this.background.set(p.manifest.id, binding);
    }
    await Promise.race([binding.readyPromise, new Promise((_, no) => setTimeout(() => no(new Error('The plugin did not start.')), 5000))]);
    const id = binding.nextRun++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { binding.runs.delete(id); reject(new Error('The plugin took too long.')); }, RUN_TIMEOUT_MS);
      binding.runs.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.#send(binding, { t: 'run', id, kind, command, args });
    });
  }

  async #export(p, x) {
    try {
      const files = checkFiles(await this.#run(p, 'exporter', x.id, []));
      const name = `${slug(this.studio.project?.name ?? 'project')}-${slug(x.id)}.zip`;
      download(name, writeZip(files));
      this.studio.log('system', `${x.title}: made ${name} (${Object.keys(files).length} files).`);
      this.studio.emit('plugin-event', `exported:${p.manifest.id}`);
    } catch (error) { this.#problem(p, error); this.studio.toasts.show(`Could not export: ${error.message}`, { kind: 'error' }); }
  }

  async #import(p, x) {
    const input = h('input', { type: 'file', accept: x.accept || '' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        if (file.size > LIMITS.fileBytes) throw new Error('That file is too big.');
        const files = checkFiles(await this.#run(p, 'importer', x.id, [file.name, await file.text()]));
        const project = await this.studio.store.create({ name: file.name.replace(/\.[^.]+$/, '') || 'Imported', template: 'blank', files });
        await this.studio.openProject(project.id);
      } catch (error) { this.#problem(p, error); this.studio.toasts.show(`Could not import: ${error.message}`, { kind: 'error' }); }
    });
    input.click();
  }

  /** Run something of a plugin from outside (tests, the plugin list's own buttons). */
  call(id, kind, command, args = []) {
    const p = this.plugins.get(id);
    if (!p?.enabled) return Promise.reject(new Error('That plugin is not on.'));
    return this.#run(p, kind, command, args);
  }

  /** Is this plugin running (its hidden frame answered)? */
  isReady(id) { return !!this.background.get(id)?.ready; }
}
