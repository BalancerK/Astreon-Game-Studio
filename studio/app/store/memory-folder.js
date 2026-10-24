// A folder that lives in memory and behaves like the browser's directory handles (the part of them the studio uses). It is for tests and for trying the folder
// link without a real folder; the real thing (the person's own disk, or the browser's private file system) is used the same way.

class MemoryFile {
  constructor(fs, path) { this.kind = 'file'; this.fs = fs; this.path = path; this.name = path.split('/').pop(); }

  async getFile() {
    const f = this.fs.files.get(this.path);
    if (!f) { const e = new Error('gone'); e.name = 'NotFoundError'; throw e; }
    const bytes = f.bytes ?? new TextEncoder().encode(f.text);
    return {
      name: this.name, size: bytes.length, lastModified: f.modified,
      text: async () => f.text ?? new TextDecoder().decode(f.bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async createWritable() {
    const fs = this.fs;
    const path = this.path;
    let text = '';
    let bytes = null;
    return {
      write: async (t) => { if (typeof t === 'string') text += t; else bytes = new Uint8Array(t); },
      close: async () => { fs.files.set(path, bytes ? { bytes, modified: ++fs.clock } : { text, modified: ++fs.clock }); },
    };
  }
}

export class MemoryFolder {
  /** @param {Record<string, string>} [files] @param {{fs?: object, prefix?: string, name?: string}} [o] */
  constructor(files = {}, { fs = null, prefix = '', name = 'folder' } = {}) {
    this.kind = 'directory';
    this.name = name;
    this.prefix = prefix;
    this.fs = fs ?? { files: new Map(), clock: 1000 };
    if (!fs) for (const [path, content] of Object.entries(files)) this.edit(path, content);
  }

  async *entries() {
    const seen = new Set();
    for (const path of [...this.fs.files.keys()].sort()) {
      if (!path.startsWith(this.prefix)) continue;
      const rest = path.slice(this.prefix.length);
      const [first, ...more] = rest.split('/');
      if (more.length) {
        if (seen.has(first)) continue;
        seen.add(first);
        yield [first, new MemoryFolder({}, { fs: this.fs, prefix: `${this.prefix}${first}/`, name: first })];
      } else yield [first, new MemoryFile(this.fs, path)];
    }
  }

  async getFileHandle(name, { create = false } = {}) {
    const path = `${this.prefix}${name}`;
    if (!this.fs.files.has(path)) {
      if (!create) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; }
      this.fs.files.set(path, { text: '', modified: ++this.fs.clock });
    }
    return new MemoryFile(this.fs, path);
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const prefix = `${this.prefix}${name}/`;
    const exists = [...this.fs.files.keys()].some((p) => p.startsWith(prefix));
    if (!exists && !create) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; }
    return new MemoryFolder({}, { fs: this.fs, prefix, name });
  }

  async removeEntry(name) {
    const path = `${this.prefix}${name}`;
    if (!this.fs.files.delete(path)) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; }
  }

  /** The files (text, or bytes for pictures and sounds), for checking what is there. */
  snapshot() {
    const mine = [...this.fs.files].filter(([p]) => p.startsWith(this.prefix));
    return Object.fromEntries(mine.map(([p, f]) => [p.slice(this.prefix.length), f.bytes ?? f.text]));
  }

  /** Change a file from outside the studio, the way another program would. */
  edit(path, content) {
    const body = typeof content === 'string' ? { text: content } : { bytes: content };
    this.fs.files.set(`${this.prefix}${path}`, { ...body, modified: ++this.fs.clock });
  }

  delete(path) { this.fs.files.delete(`${this.prefix}${path}`); }
}
