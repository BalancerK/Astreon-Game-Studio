// Which files are open, in which editor, in what order: up to four editors side by side (or one above the other), each with its own row of tabs. The same file
// may be open in more than one editor. This is the bookkeeping only, with no page in it (the Editor panel draws it), so it is tested in Node. Every change keeps
// the rules: no editor is empty while another has files, the one in focus always exists, and the sizes add up to one.

export const MAX_GROUPS = 4;
const MIN_SHARE = 0.15;

const clone = (g) => ({ files: [...g.files], active: g.active });

export class EditorGroups {
  constructor() {
    this.groups = [{ files: [], active: null }];
    this.focus = 0;
    this.direction = 'row';          // 'row': side by side; 'column': one above the other
    this.sizes = [1];
    this.recent = [];                // paths, the one used last first
  }

  // ---------- what is open ----------
  get current() { return this.groups[this.focus]; }

  get files() { return this.current.files; }

  get active() { return this.current.active; }

  /** The groups that have a path open, in order. */
  groupsWith(path) { return this.groups.map((g, i) => (g.files.includes(path) ? i : -1)).filter((i) => i >= 0); }

  /** Every file open anywhere (each once). */
  all() { return [...new Set(this.groups.flatMap((g) => g.files))]; }

  #touch(path) {
    this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, 50);
  }

  #normalize() {
    // an editor with nothing in it goes away (unless it is the only one)
    if (this.groups.length > 1 && this.groups.some((g) => !g.files.length)) {
      const focused = this.groups[this.focus];
      const groups = [];
      const sizes = [];
      this.groups.forEach((g, i) => { if (g.files.length) { groups.push(g); sizes.push(this.sizes[i] ?? 1); } });
      if (!groups.length) {
        this.groups = [{ files: [], active: null }];
        this.sizes = [1];
        this.focus = 0;
      } else {
        this.groups = groups;
        this.sizes = sizes;
        const at = groups.indexOf(focused);
        this.focus = at >= 0 ? at : Math.min(this.focus, groups.length - 1);
      }
    }
    const total = this.sizes.reduce((n, s) => n + s, 0) || 1;
    this.sizes = this.sizes.map((s) => s / total);
    if (this.groups.length === 1) this.sizes = [1];
    for (const g of this.groups) if (g.active && !g.files.includes(g.active)) g.active = g.files[g.files.length - 1] ?? null;
    this.focus = Math.max(0, Math.min(this.groups.length - 1, this.focus));
  }

  // ---------- opening and closing ----------
  /**
   * Show a file. If it is already open in the target editor its tab is chosen; otherwise, if it is open in another editor that one is chosen (the file is not
   * opened twice by accident); otherwise it gets a new tab, after the chosen one.
   * @param {string} path
   * @param {{group?: number, index?: number, duplicate?: boolean}} [o] `duplicate`: open it in this editor even though it is open in another
   */
  open(path, { group = this.focus, index, duplicate = false } = {}) {
    const g = this.groups[Math.max(0, Math.min(this.groups.length - 1, group))];
    if (!g.files.includes(path)) {
      const elsewhere = this.groupsWith(path);
      if (elsewhere.length && !duplicate) {
        this.focus = elsewhere.includes(this.focus) ? this.focus : elsewhere[0];
        this.current.active = path;
        this.#touch(path);
        return this.focus;
      }
      const at = index ?? (g.active ? g.files.indexOf(g.active) + 1 : g.files.length);
      g.files.splice(Math.max(0, Math.min(g.files.length, at)), 0, path);
    }
    g.active = path;
    this.focus = this.groups.indexOf(g);
    this.#touch(path);
    return this.focus;
  }

  /** Close a tab. The tab that takes over is the one that was after it, or else before it. */
  close(path, group = this.focus) {
    const g = this.groups[group];
    const at = g?.files.indexOf(path) ?? -1;
    if (at < 0) return;
    g.files.splice(at, 1);
    if (g.active === path) g.active = g.files[Math.min(at, g.files.length - 1)] ?? null;
    this.#normalize();
  }

  closeOthers(path, group = this.focus) {
    const g = this.groups[group];
    if (!g?.files.includes(path)) return;
    g.files = [path];
    g.active = path;
    this.#normalize();
  }

  closeToRight(path, group = this.focus) {
    const g = this.groups[group];
    const at = g?.files.indexOf(path) ?? -1;
    if (at < 0) return;
    g.files.length = at + 1;
    if (!g.files.includes(g.active)) g.active = path;
    this.#normalize();
  }

  closeAll(group = this.focus) {
    const g = this.groups[group];
    if (!g) return;
    g.files = [];
    g.active = null;
    this.#normalize();
  }

  /** The file was removed from the project: close it everywhere. */
  remove(path) {
    for (const g of this.groups) {
      g.files = g.files.filter((p) => p !== path);
      if (g.active === path) g.active = null;
    }
    this.recent = this.recent.filter((p) => p !== path);
    this.#normalize();
  }

  /** The file was renamed: keep its tabs. */
  rename(from, to) {
    for (const g of this.groups) {
      g.files = g.files.map((p) => (p === from ? to : p));
      if (g.active === from) g.active = to;
    }
    this.recent = this.recent.map((p) => (p === from ? to : p));
  }

  /** Close every tab whose file does not exist (after a restore point or a folder sync). */
  prune(exists) {
    for (const g of this.groups) g.files = g.files.filter((p) => exists(p));
    this.recent = this.recent.filter((p) => exists(p));
    this.#normalize();
  }

  // ---------- moving things about ----------
  /** Choose a tab in an editor (and make that editor the one in focus). */
  activate(path, group = this.focus) {
    const g = this.groups[group];
    if (!g?.files.includes(path)) return false;
    g.active = path;
    this.focus = group;
    this.#touch(path);
    return true;
  }

  focusGroup(i) {
    if (i < 0 || i >= this.groups.length) return false;
    this.focus = i;
    if (this.current.active) this.#touch(this.current.active);
    return true;
  }

  /** Put a tab somewhere else in its row. */
  reorder(group, from, to) {
    const g = this.groups[group];
    if (!g || from < 0 || from >= g.files.length) return;
    const [path] = g.files.splice(from, 1);
    g.files.splice(Math.max(0, Math.min(g.files.length, to)), 0, path);
  }

  /** Move a tab to another editor (at a place in its row). An editor left with no tabs goes away. */
  move(path, fromGroup, toGroup, index) {
    const from = this.groups[fromGroup];
    const to = this.groups[toGroup];
    if (!from || !to || !from.files.includes(path)) return;
    if (fromGroup === toGroup) {
      this.reorder(fromGroup, from.files.indexOf(path), index ?? from.files.length);
      this.activate(path, toGroup);
      return;
    }
    from.files.splice(from.files.indexOf(path), 1);
    if (from.active === path) from.active = from.files[from.files.length - 1] ?? null;
    if (!to.files.includes(path)) to.files.splice(Math.max(0, Math.min(to.files.length, index ?? to.files.length)), 0, path);
    to.active = path;
    const target = to;
    this.#normalize();
    this.focus = this.groups.indexOf(target);
    this.#touch(path);
  }

  /**
   * Open a file in a new editor beside (or above) an existing one.
   * @param {string} path
   * @param {number} group the editor to split next to
   * @param {'right' | 'left' | 'down' | 'up'} side
   * @param {{move?: boolean}} [o] `move`: take the tab out of the old editor as well (dragging a tab to an edge does this)
   * @returns {boolean} false when there are already as many editors as there can be
   */
  split(path, group, side, { move = false } = {}) {
    if (this.groups.length >= MAX_GROUPS || !this.groups[group]) return false;
    const direction = side === 'right' || side === 'left' ? 'row' : 'column';
    const before = side === 'left' || side === 'up';
    const source = this.groups[group];
    if (move && source.files.length === 1 && this.groups.length === 1) return false;     // nothing would be left behind
    this.direction = direction;
    const made = { files: [path], active: path };
    const at = before ? group : group + 1;
    this.groups.splice(at, 0, made);
    const share = this.sizes[group] / 2;
    this.sizes[group] = share;
    this.sizes.splice(at, 0, share);
    if (move) {
      const old = source;
      old.files = old.files.filter((p) => p !== path);
      if (old.active === path) old.active = old.files[old.files.length - 1] ?? null;
    }
    this.#normalize();
    this.focus = this.groups.indexOf(made);
    this.#touch(path);
    return true;
  }

  /** Join every editor into the first one. */
  unsplit() {
    if (this.groups.length < 2) return;
    const focused = this.current.active;
    const files = this.all();
    this.groups = [{ files, active: files.includes(focused) ? focused : files[0] ?? null }];
    this.sizes = [1];
    this.focus = 0;
  }

  /** Change the shares of the editors (each at least 15%, adding up to one). */
  resize(sizes) {
    if (!Array.isArray(sizes) || sizes.length !== this.groups.length || sizes.some((s) => !Number.isFinite(s))) return;
    let next = sizes.map((s) => Math.max(MIN_SHARE, s));
    const total = next.reduce((n, s) => n + s, 0);
    next = next.map((s) => s / total);
    this.sizes = next;
  }

  // ---------- remembering ----------
  serialize() {
    return { groups: this.groups.map(clone), focus: this.focus, direction: this.direction, sizes: [...this.sizes], recent: this.recent.slice(0, 20) };
  }

  /** Restore what was saved (the new form, or the old `{openFiles, activeFile}`), keeping only files that still exist. */
  load(saved, exists) {
    this.groups = [{ files: [], active: null }];
    this.sizes = [1];
    this.focus = 0;
    this.direction = 'row';
    this.recent = [];
    if (Array.isArray(saved?.groups) && saved.groups.length) {
      const groups = saved.groups.slice(0, MAX_GROUPS).map((g) => {
        const files = (Array.isArray(g.files) ? g.files : []).filter((p) => typeof p === 'string' && exists(p));
        return { files: [...new Set(files)], active: files.includes(g.active) ? g.active : files[0] ?? null };
      });
      this.groups = groups;
      const sane = Array.isArray(saved.sizes) && saved.sizes.length === groups.length && saved.sizes.every(Number.isFinite);
      this.sizes = sane ? saved.sizes : groups.map(() => 1 / groups.length);
      this.focus = Number.isInteger(saved.focus) ? saved.focus : 0;
      this.direction = saved.direction === 'column' ? 'column' : 'row';
      this.recent = (saved.recent ?? []).filter((p) => typeof p === 'string' && exists(p));
    } else if (Array.isArray(saved?.openFiles)) {
      const files = saved.openFiles.filter((p) => typeof p === 'string' && exists(p));
      this.groups = [{ files, active: files.includes(saved.activeFile) ? saved.activeFile : files[0] ?? null }];
    }
    if (!this.groups.length) this.groups = [{ files: [], active: null }];
    this.#normalize();
    this.resize(this.sizes);
  }
}
