// Linking the open project to a folder on the computer, so git, other editors and backups can see its files (the browser's File System Access API: Chrome and
// Edge). The planning is in store/folder-sync.js; this is the part that talks to the folder, remembers the link with the project, and keeps both sides in step:
// the studio's edits go to the folder a moment after you stop typing, and the folder is looked at every few seconds for changes made by other programs.
import {
  plan, readFolder, writeFile, removeFile, isDirectoryHandle, without, conflictCopies, ignoreMatcher, cleanAssetDirs, toFolderPath, only,
} from '../store/folder-sync.js';
import { showDialog } from '../ui/dialog.js';

const PUSH_DELAY_MS = 800;
const POLL_MS = 2500;

export class FolderLinker {
  /** @param {import('./studio.js').Studio} studio */
  constructor(studio) {
    this.studio = studio;
    this.handle = null;
    this.baseline = {};
    this.assetDirs = [];                 // folders whose pictures and sounds come in too, as assets/<folder>/…
    this.ignore = [];                    // patterns for files the link does not touch
    this.cache = new Map();
    this.status = 'off';                 // off, synced, syncing, needs-permission, error
    this.lastSync = 0;
    /** What the folder has that the link leaves out, with the reason: `["path (reason)"]`. */
    this.leftOut = [];
    this.fileCount = 0;
    this.error = '';
    this.busy = false;
    this.applying = false;
    this.pending = false;
    this.timers = {};
    const later = () => {
      if (!this.handle || this.applying) return;
      clearTimeout(this.timers.push);
      this.timers.push = setTimeout(() => this.sync(), PUSH_DELAY_MS);
    };
    studio.on('file-changed', later);
    studio.on('files', later);
    this.timers.poll = setInterval(() => { if (this.handle && document.visibilityState === 'visible') this.sync(); }, POLL_MS);
  }

  get name() { return this.handle?.name ?? ''; }

  get supported() { return typeof window.showDirectoryPicker === 'function'; }

  #set(status, error = '') {
    this.status = status;
    this.error = error;
    this.studio.emit('folder');
  }

  /** The project opened: pick up its link, if it has one. */
  async load() {
    this.#forget();
    const id = this.studio.project?.id;
    const saved = id ? await this.studio.store.getMeta(`folder:${id}`).catch(() => null) : null;
    if (!saved || !isDirectoryHandle(saved.handle)) { this.studio.emit('folder'); return; }
    this.handle = saved.handle;
    this.baseline = saved.baseline ?? {};
    this.assetDirs = cleanAssetDirs(saved.assetDirs);
    this.ignore = (saved.ignore ?? []).slice(0, 200);
    const permission = await this.handle.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt');
    if (permission === 'granted') await this.sync();
    else this.#set('needs-permission');
  }

  #forget() {
    this.handle = null;
    this.baseline = {};
    this.assetDirs = [];
    this.ignore = [];
    this.cache = new Map();
    this.status = 'off';
    this.error = '';
  }

  /** Ask the person for a folder, then link it. */
  async pick() {
    if (!this.studio.project) return false;
    if (!this.supported) {
      this.studio.toasts.show('This browser cannot link a folder. Chrome and Edge can; File > Export keeps a copy anywhere else.', { kind: 'info' });
      return false;
    }
    try {
      return await this.link(await window.showDirectoryPicker({ mode: 'readwrite', id: 'studio-project' }));
    } catch (error) {
      if (error?.name !== 'AbortError') this.studio.toasts.show(`Could not open that folder: ${error.message}`, { kind: 'error' });
      return false;
    }
  }

  /** Link a directory handle to the open project. Asks which side is the starting point when both already have files. */
  async link(handle) {
    const st = this.studio;
    if (!st.project) return false;
    if (!isDirectoryHandle(handle)) throw new Error('That is not a folder.');
    if ((await handle.requestPermission?.({ mode: 'readwrite' })) === 'denied') {
      st.toasts.show('The studio needs permission to write to that folder.', { kind: 'error' });
      return false;
    }
    const { files, skipped, skippedPaths } = await readFolder(handle);
    this.leftOut = skipped;
    const mine = without(st.syncFiles(), skippedPaths);
    let mode = 'merge';
    if (files.size && Object.keys(mine).length) {
      const answer = await showDialog({
        title: `Link to the folder "${handle.name}"?`,
        body: `The folder already has ${files.size} files and the project has ${Object.keys(mine).length}. How should they start out?\n\n`
          + 'Merge keeps everything: files only on one side are copied across, '
          + 'and if a file differs, yours stays and the folder\'s copy is saved in a "conflicts" folder.',
        buttons: [
          { label: 'Cancel', value: false },
          { label: 'Use the folder\'s files', value: 'folder', danger: true },
          { label: 'Merge', value: 'merge', primary: true },
        ],
      });
      if (!answer) return false;
      mode = answer;
    } else if (files.size && !Object.keys(mine).length) mode = 'folder';
    this.handle = handle;
    this.baseline = {};
    this.cache = new Map();
    await this.#run(plan(mine, files, {}, { mode }), files);
    if (skipped.length) st.log('warn',
      `Folder link left out ${skipped.length} files: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`);
    st.log('system', `Linked the project to the folder "${handle.name}". Changes now go both ways.`);
    st.emit('plugin-event', 'folder-linked');
    return true;
  }

  async reconnect() {
    if (!this.handle) return;
    const permission = await this.handle.requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
    if (permission === 'granted') await this.sync(); else this.#set('needs-permission');
  }

  /** The project closed: stop watching (the link is kept with the project, for when it is opened again). */
  unlinkSilently() {
    this.#forget();
    this.studio.emit('folder');
  }

  unlink() {
    const id = this.studio.project?.id;
    if (id) this.studio.store.setMeta(`folder:${id}`, null).catch(() => {});
    this.#forget();
    this.studio.log('system', 'Unlinked the folder. Its files stay where they are.');
    this.studio.emit('folder');
  }

  /** Bring the project and the folder up to date with each other. */
  async sync() {
    const st = this.studio;
    if (!this.handle || !st.project) return;
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    try {
      const permission = await this.handle.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt');
      if (permission && permission !== 'granted') { this.#set('needs-permission'); return; }
      const skip = ignoreMatcher(this.ignore);
      const { files, skipped, skippedPaths } = await readFolder(this.handle, this.cache, { ignore: skip, assetDirs: this.assetDirs });
      this.#noteLeftOut(skipped);
      const keep = (path) => !skip(toFolderPath(path, this.assetDirs)) && !skippedPaths.has(path);
      await this.#run(plan(only(st.syncFiles(), keep), files, only(this.baseline, keep)), files);
    } catch (error) {
      this.#set('error', String(error?.message ?? error).slice(0, 200));
    } finally {
      this.busy = false;
      if (this.pending) { this.pending = false; setTimeout(() => this.sync(), 50); }
    }
  }

  /** Do what a plan says, remember where both sides now agree, and say what is worth saying. */
  async #run(p, folderFiles) {
    const st = this.studio;
    this.#set('syncing');
    this.applying = true;
    try {
      for (const op of p.ops) {
        if (op.side === 'folder') {
          const at = toFolderPath(op.path, this.assetDirs);
          if (op.text === null) await removeFile(this.handle, at); else await writeFile(this.handle, at, op.text);
        } else if (op.text === null) {
          if (st.project.has(op.path)) st.project.remove(op.path);
        } else st.project.write(op.path, op.text);
      }
    } finally {
      this.applying = false;
    }
    this.baseline = p.baseline;
    this.cache = new Map([...folderFiles].filter(([path]) => !p.ops.some((o) => o.side === 'folder' && o.path === path)));
    const id = st.project.id;
    await this.#saveLink(id);
    const toProject = p.ops.filter((o) => o.side === 'project').length;
    if (toProject) { st.emit('files'); st.log('system', `Folder sync: ${toProject} file${toProject === 1 ? '' : 's'} came from the folder.`); }
    if (p.conflicts.length) {
      st.toasts.show(`Changed in both places: ${p.conflicts.join(', ')}. Your version was kept; the folder's is in the "conflicts" folder.`,
        { kind: 'info', ms: 12000 });
      st.log('warn', `Folder sync kept your version of ${p.conflicts.join(', ')}; the folder's version is saved under conflicts/.`);
    }
    if (p.heldBack.length) {
      st.toasts.show(`${p.heldBack.length} files looked deleted all at once, so nothing was deleted. Check the folder, then sync again.`,
        { kind: 'error', ms: 12000 });
      st.log('warn', `Folder sync did not delete ${p.heldBack.length} files that vanished from one side at once.`);
    }
    this.lastSync = Date.now();
    this.fileCount = Object.keys(this.baseline).length;
    this.#set('synced');
  }

  /** Keep the link with the project: the folder, what both sides agreed on, and the choices made in the window. */
  #saveLink(id) {
    const { handle, baseline, assetDirs, ignore } = this;
    return this.studio.store.setMeta(`folder:${id}`, { handle, baseline, assetDirs, ignore }).catch(() => {});
  }

  /** Remember what is left out, and say so in the console when it changes (not at every look). */
  #noteLeftOut(skipped) {
    const same = skipped.length === this.leftOut.length && skipped.every((s, i) => s === this.leftOut[i]);
    this.leftOut = skipped;
    if (same || !skipped.length) return;
    const shown = skipped.slice(0, 5).join(', ');
    this.studio.log('warn', `Folder link leaves out ${skipped.length} files: ${shown}${skipped.length > 5 ? '…' : ''}`);
  }

  /**
   * Change what the link brings in and leaves alone, then sync.
   * @param {{assetDirs?: string[], ignore?: string[]}} o `assetDirs`: folders (like `art`) whose pictures and sounds come in as `assets/art/…`;
   *   `ignore`: patterns (see `ignoreMatcher`) for files neither side's copy of is touched
   */
  async configure({ assetDirs = this.assetDirs, ignore = this.ignore } = {}) {
    this.assetDirs = cleanAssetDirs(assetDirs);
    this.ignore = ignore.map((s) => String(s).trim()).filter(Boolean).slice(0, 200);
    this.cache = new Map();
    this.leftOut = [];
    const id = this.studio.project?.id;
    if (id && this.handle) await this.#saveLink(id);
    await this.sync();
  }

  /** Files changed in both places, as `{copy, original}`: the project's version stayed, the folder's was saved as `copy`. */
  conflicts() { return this.studio.project ? conflictCopies(this.studio.project.list()) : []; }

  /** Settle one conflict: `folder` takes the folder's version, `mine` keeps the project's. Either way the saved copy goes away. */
  resolve(copy, take) {
    const st = this.studio;
    const found = this.conflicts().find((c) => c.copy === copy);
    if (!found || !st.project.has(copy)) return false;
    if (take === 'folder') st.project.write(found.original, st.project.read(copy));
    st.project.remove(copy);
    st.emit('files');
    this.sync();
    return true;
  }

  dispose() { clearInterval(this.timers.poll); clearTimeout(this.timers.push); }
}
