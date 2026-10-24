// A folder on this computer shaped like the browser's directory handle (the part the studio's folder link uses), so the command line reads and writes a
// project folder with exactly the same code and the same rules as the studio does: the same files are taken, the same ones are left out, and the same
// checks are made on pictures and sounds.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const notFound = (path) => Object.assign(new Error(`not found: ${path}`), { name: 'NotFoundError' });

class NodeFile {
  constructor(path, name) { this.kind = 'file'; this.path = path; this.name = name; }

  async getFile() {
    const info = await fs.stat(this.path).catch(() => { throw notFound(this.path); });
    return {
      name: this.name, size: info.size, lastModified: Math.round(info.mtimeMs),
      text: async () => fs.readFile(this.path, 'utf8'),
      arrayBuffer: async () => { const b = await fs.readFile(this.path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
    };
  }

  async createWritable() {
    const chunks = [];
    return {
      write: async (chunk) => { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)); },
      close: async () => { await fs.writeFile(this.path, Buffer.concat(chunks)); },
    };
  }
}

export class NodeFolder {
  /** @param {string} path a folder that exists (or will: `create` makes it) */
  constructor(path) { this.kind = 'directory'; this.path = path; this.name = path.split(/[\\/]/).filter(Boolean).pop() ?? path; }

  async *entries() {
    for (const e of await fs.readdir(this.path, { withFileTypes: true })) {
      if (e.isDirectory()) yield [e.name, new NodeFolder(join(this.path, e.name))];
      else if (e.isFile()) yield [e.name, new NodeFile(join(this.path, e.name), e.name)];
    }
  }

  async getFileHandle(name, { create = false } = {}) {
    const path = join(this.path, name);
    const exists = await fs.stat(path).then((s) => s.isFile(), () => false);
    if (!exists) {
      if (!create) throw notFound(path);
      await fs.mkdir(this.path, { recursive: true });
      await fs.writeFile(path, '');
    }
    return new NodeFile(path, name);
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const path = join(this.path, name);
    const exists = await fs.stat(path).then((s) => s.isDirectory(), () => false);
    if (!exists) {
      if (!create) throw notFound(path);
      await fs.mkdir(path, { recursive: true });
    }
    return new NodeFolder(path);
  }

  async removeEntry(name) {
    try { await fs.rm(join(this.path, name), { recursive: false }); } catch { throw notFound(name); }
  }
}
