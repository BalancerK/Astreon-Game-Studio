// The hub: the start page and the project list. It is shown when no project is open, and any time from "Projects". Everything about a person's projects
// is here: start one from a template, open, copy, export, delete (to a bin that keeps it for 30 days), bring one back, import a zip.
import { h, fill, button, when, icon } from './dom.js';
import { TEMPLATES } from '../store/templates.js';
import { confirm, promptText } from './dialog.js';
import { StoreError } from '../store/project-store.js';

/** Give the person a file: the browser's own download. */
export function download(name, bytes, type = 'application/zip') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export class Hub {
  /** @param {import('../core/studio.js').Studio} studio @param {HTMLElement} root */
  constructor(studio, root) {
    this.studio = studio;
    this.el = h('div', { class: 'hub', hidden: true, role: 'region', aria: { label: 'Projects' } });
    root.append(this.el);
    this.visible = false;
    // opening a project (by any route) closes the start page; closing the project brings it back. Asking for it with a project open does not fire this.
    studio.on('project', () => { if (studio.project) this.hide(); else this.show(); });
  }

  async show() {
    this.visible = true;
    this.el.hidden = false;
    await this.render();
    (this.el.querySelector('[data-focus]') ?? this.el.querySelector('button'))?.focus();
  }

  hide() {
    this.visible = false;
    this.el.hidden = true;
  }

  async #newProject(templateId) {
    const t = TEMPLATES[templateId];
    const name = await promptText({
      title: 'Name your project', label: 'Project name', value: t.title, confirmLabel: 'Create',
      validate: (v) => (v.trim() ? null : 'Give it a name'),
    });
    if (name === undefined) return;
    try {
      await this.studio.createProject({ name, template: templateId });
      this.hide();
    } catch (error) {
      this.studio.toasts.show(`Could not make the project: ${error.message}`, { kind: 'error' });
    }
  }

  async #startGuide() {
    try {
      await this.studio.learn.start();
      this.hide();
    } catch (error) {
      this.studio.toasts.show(`Could not start the guide: ${error.message}`, { kind: 'error' });
    }
  }

  async #open(id) {
    try {
      await this.studio.openProject(id);
      this.hide();
    } catch (error) {
      this.studio.toasts.show(`Could not open the project: ${error.message}`, { kind: 'error' });
    }
  }

  async #import(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = file.name.replace(/\.zip$/i, '') || 'Imported project';
      const project = await this.studio.store.importZip(bytes, { name });
      this.studio.toasts.show(`Imported "${project.name}".`, { kind: 'success' });
      await this.#open(project.id);
    } catch (error) {
      const reason = error instanceof StoreError || error instanceof Error ? error.message : error;
      this.studio.toasts.show(`Could not import that file: ${reason}`, { kind: 'error', ms: 12000 });
    }
  }

  async render() {
    const s = this.studio;
    const projects = await s.store.list();
    const bin = await s.store.list({ deleted: true });
    s.knownProjects = projects;
    const fileInput = h('input', {
      type: 'file', accept: '.zip,application/zip', class: 'sr-only', tabIndex: -1, aria: { label: 'Choose a project zip file' },
      on: { change: () => this.#import(fileInput.files[0]) },
    });

    const projectRow = (p) => h('div', { class: 'row', tabIndex: 0, on: { keydown: (e) => { if (e.key === 'Enter') this.#open(p.id); } } },
      icon('folder', 16),
      h('span', { class: 'name', text: p.name }),
      h('span', { class: 'meta', text: `${p.fileCount} file${p.fileCount === 1 ? '' : 's'} · changed ${when(p.updatedAt)}` }),
      h('span', { class: 'actions', style: { opacity: '1' } },
        button({ text: 'Open', class: 'small primary', onClick: () => this.#open(p.id), 'data-focus': p === projects[0] ? '' : undefined }),
        button({
          label: `Make a copy of ${p.name}`, text: 'Copy', class: 'small',
          onClick: async () => { await s.store.duplicate(p.id); this.render(); },
        }),
        button({
          label: `Export ${p.name} as a zip file`, icon: 'download', class: 'small',
          onClick: async () => { const proj = await s.store.open(p.id); download(`${p.name}.zip`, proj.exportZip()); },
        }),
        button({ label: `Delete ${p.name}`, icon: 'trash', class: 'small danger', onClick: () => this.#delete(p) })));

    const binRow = (p) => h('div', { class: 'row' },
      h('span', { class: 'name', text: p.name }), h('span', { class: 'meta', text: `deleted ${when(p.deletedAt)}` }),
      h('span', { class: 'actions', style: { opacity: '1' } },
        button({ text: 'Bring back', class: 'small', onClick: async () => { await s.store.restoreProject(p.id); this.render(); } }),
        button({ text: 'Delete for good', class: 'small danger', onClick: () => this.#purge(p) })));

    fill(this.el, h('div', { class: 'hub-inner' },
      h('h1', { text: 'Astreon Studio' }),
      h('p', { class: 'lead', text: 'Make games that run in the browser. Your projects stay on this computer.' }),
      s.backendNote
        ? h('div', { class: 'toast error', role: 'alert', style: { maxWidth: 'none', marginBottom: '16px' }, text: s.backendNote })
        : null,
      s.project ? button({ text: `Back to “${s.project.name}”`, icon: 'chevron', class: 'primary', onClick: () => this.hide() }) : null,
      h('div', { class: 'hub-learn' },
        h('div', {}, h('h3', { text: 'New to making games?' }),
          h('p', { text: 'Follow the guided route: change a real game step by step, '
            + 'from a hero that runs and jumps to a level with spikes and a win message.' })),
        button({ text: 'Start the guided route', icon: 'chevron', class: 'primary', onClick: () => this.#startGuide() })),
      h('h2', { text: 'Start a project' }),
      h('div', { class: 'cards' }, Object.entries(TEMPLATES).map(([id, t]) => h('button', {
        type: 'button', class: 'card', 'data-focus': !projects.length && id === 'bounce' ? '' : undefined, on: { click: () => this.#newProject(id) },
      }, h('h3', { text: t.title }), h('p', { text: t.description })))),
      h('div', { style: { marginTop: '10px' } },
        button({ text: 'Import a project (zip)…', icon: 'upload', class: 'small', onClick: () => fileInput.click() }), fileInput),
      h('h2', { text: 'Your projects' }),
      projects.length
        ? h('div', { class: 'projects' }, projects.map(projectRow))
        : h('p', { class: 'lead', text: 'Nothing here yet. Pick a project above to begin.' }),
      bin.length ? [h('h2', { text: 'Recently deleted (kept for 30 days)' }), h('div', { class: 'projects' }, bin.map(binRow))] : null));
  }

  async #purge(p) {
    const ok = await confirm({
      title: 'Delete for good?', confirmLabel: 'Delete for good', danger: true,
      message: `"${p.name}" and its history will be gone and cannot be brought back.`,
    });
    if (!ok) return;
    await this.studio.store.purge(p.id);
    this.render();
  }

  async #delete(p) {
    const ok = await confirm({
      title: `Delete “${p.name}”?`, confirmLabel: 'Delete', danger: true,
      message: 'It is moved to “Recently deleted” and can be brought back for 30 days.',
    });
    if (!ok) return;
    if (this.studio.project?.id === p.id) await this.studio.closeProject();
    await this.studio.store.remove(p.id);
    const undo = async () => { await this.studio.store.restoreProject(p.id); this.render(); };
    this.studio.toasts.show(`Deleted “${p.name}”.`, { action: { label: 'Undo', run: undo } });
    await this.render();
  }
}
