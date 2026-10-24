// Saves on a server's disk, and an HTTP handler that lets browsers keep their saves there (`HttpStorage` is the client side).
import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { checksum } from './format.js';

const SAFE = /^[A-Za-z0-9_.-]{1,96}$/;

/** Saves as files in a directory. Writes go to a temporary file first and are renamed into place, so a crash never leaves half a save. */
export class FileStorage {
  constructor(dir) { this.dir = dir; this.ready = null; }
  #path(key) { if (!SAFE.test(key) || key.startsWith('.')) throw new Error(`"${key}" is not a usable key`); return join(this.dir, key); }
  #init() { return (this.ready ??= mkdir(this.dir, { recursive: true })); }
  async get(key) { await this.#init(); try { return await readFile(this.#path(key), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async set(key, text) {
    await this.#init();
    const path = this.#path(key), tmp = `${path}.tmp-${process.pid}`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  }
  async delete(key) { await this.#init(); await rm(this.#path(key), { force: true }); }
  async keys(prefix = '') { await this.#init(); return (await readdir(this.dir)).filter((f) => f.startsWith(prefix) && !f.includes('.tmp-')).sort(); }
}

/**
 * An HTTP handler for saves: `GET /` lists keys (`?prefix=`), `GET /key`, `PUT /key`, `DELETE /key`. Keys are checked, bodies are capped,
 * and each file has an ETag (its checksum): a `PUT` with `If-Match` that no longer matches is refused with 412, `If-None-Match: *`
 * only creates. Use it under a path of your server, after your own authentication: `userOf(req)` returns who the request is for (a
 * directory name), or null to refuse.
 * @param {{storageFor: (user: string) => {get: Function, set: Function, delete: Function, keys: Function}, userOf: (req: any) => string | null, maxBytes?: number}} o
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, path: string) => Promise<void>} path: the part of the URL after your mount point ('/' or '/key')
 */
export function createSaveHandler({ storageFor, userOf, maxBytes = 4_000_000 }) {
  const send = (res, code, body = '', headers = {}) => { res.writeHead(code, { 'cache-control': 'no-store', ...headers }); res.end(body); };
  return async (req, res, path) => {
    const user = userOf(req);
    if (!user || !SAFE.test(user)) return send(res, 401);
    const storage = storageFor(user);
    const url = new URL(req.url, 'http://x');
    const key = decodeURIComponent(path.replace(/^\//, ''));
    try {
      if (key === '') {
        if (req.method !== 'GET') return send(res, 405);
        return send(res, 200, JSON.stringify(await storage.keys(url.searchParams.get('prefix') ?? '')), { 'content-type': 'application/json' });
      }
      if (!SAFE.test(key) || key.startsWith('.')) return send(res, 400, 'bad key');
      if (req.method === 'GET') {
        const text = await storage.get(key);
        return text === null ? send(res, 404) : send(res, 200, text, { 'content-type': 'text/plain', etag: `"${checksum(text)}"` });
      }
      if (req.method === 'DELETE') { await storage.delete(key); return send(res, 204); }
      if (req.method === 'PUT') {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > maxBytes) return send(res, 413); chunks.push(c); }
        const text = Buffer.concat(chunks).toString('utf8');
        const current = await storage.get(key);
        const ifMatch = req.headers['if-match'], ifNone = req.headers['if-none-match'];
        if (ifNone === '*' && current !== null) return send(res, 412);
        if (ifMatch && (current === null || ifMatch !== `"${checksum(current)}"`)) return send(res, 412);
        await storage.set(key, text);
        return send(res, 204, '', { etag: `"${checksum(text)}"` });
      }
      return send(res, 405);
    } catch (e) { return send(res, 500, e.message); }
  };
}
