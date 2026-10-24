// The development server: serves the project as it is on disk (no bundling), keeps `/manifest.json` current as files change so the asset
// manager's `watchManifest` hot-reloads textures, models and data, and reloads the page when code, pages or styles change.
import http from 'node:http';
import { createReadStream, statSync, watch, readdirSync, realpathSync, existsSync } from 'node:fs';
import { readdir, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import { matchFiles, hashBytes, contentType } from './files.js';
import { readFileSync } from 'node:fs';

/**
 * Browsers cannot resolve `import '@engine/render'`; an import map tells them where it is. This lists the `@engine/*` packages installed in
 * the project's node_modules and maps each to a URL under `/@modules/`, which the dev server serves from there.
 * @returns {{imports: Record<string, string>, packages: Map<string, string>}}
 */
export function findImportMap(root) {
  const imports = {}, packages = new Map();
  for (const scope of ['@engine']) {
    const dir = join(root, 'node_modules', scope);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const real = realpathSync(join(dir, name));
      packages.set(`${scope}/${name}`, real);
      imports[`${scope}/${name}`] = `/@modules/${scope}/${name}/src/index.js`;
      imports[`${scope}/${name}/`] = `/@modules/${scope}/${name}/`;
    }
  }
  return { imports, packages };
}

const CLIENT = `<script>(()=>{const e=new EventSource('/__dev');e.onmessage=(m)=>{if(m.data==='reload')location.reload()};e.onerror=()=>{};})()</script>`;

/**
 * `handle(req, res)` runs first for every request: return true if it answered (your own API next to the pages).
 * `writable` lets pages (the scene editor) list, read, write and delete files in chosen folders: `[{ route: '/__scenes', dir: 'scenes', ext: '.json' }]`.
 * Names are checked, only that extension is touched, bodies are capped, JSON is validated, writes are atomic, and requests from other origins are refused.
 * @param {{root?: string, assets?: string[], port?: number, host?: string, publicPath?: string, liveReload?: boolean, writable?: Array<{route: string, dir: string, ext?: string, maxBytes?: number}>, handle?: (req: any, res: any) => boolean | void, log?: (msg: string) => void}} [o]
 * @returns {Promise<{server: http.Server, port: number, url: string, close(): Promise<void>, manifest(): any, changed(path?: string): void}>}
 */
export async function serve({ root = '.', assets = [], port = 8080, host = '127.0.0.1', liveReload = true, writable = [], handle, log = () => {} } = {}) {
  const base = resolve(root);
  const hashCache = new Map(); // path -> {key, hash}
  let manifestText = null, manifestTag = null;
  const clients = new Set();

  const buildManifest = () => {
    const out = {};
    for (const f of matchFiles(base, assets)) {
      const st = statSync(join(base, f)), key = `${st.mtimeMs}:${st.size}`;
      let h = hashCache.get(f);
      if (!h || h.key !== key) { h = { key, hash: hashBytes(readFileSync(join(base, f))) }; hashCache.set(f, h); }
      out[f] = { url: f, hash: h.hash, bytes: st.size };
    }
    manifestText = JSON.stringify({ version: 1, assets: out, bundles: {}, publicPath: '' });
    manifestTag = `"${hashBytes(manifestText, 16)}"`;
  };
  const changed = (path = '') => {
    manifestText = null;
    if (/\.(html|js|mjs|css)$/i.test(path)) for (const c of clients) c.write('data: reload\n\n');
  };

  const watcher = (() => {
    try {
      let timer = null; const pending = new Set();
      const w = watch(base, { recursive: true }, (_ev, name) => {
        if (!name || /(^|[\\/])(\.|node_modules)/.test(name)) return;
        pending.add(name.split(sep).join('/'));
        clearTimeout(timer);
        timer = setTimeout(() => { for (const p of pending) { log(`changed: ${p}`); changed(p); } pending.clear(); }, 40);
      });
      w.on('error', () => {});
      return w;
    } catch { return null; } // recursive watching is not available everywhere; changes are then picked up by the next request
  })();

  const importMap = findImportMap(base);
  const mapTag = Object.keys(importMap.imports).length ? `<script type="importmap">${JSON.stringify({ imports: importMap.imports })}</script>` : '';
  const NAME = /^[A-Za-z0-9_-]{1,64}$/;
  const folders = writable.map((w) => ({ route: w.route.replace(/\/$/, ''), dir: resolve(base, w.dir), ext: w.ext ?? '.json', maxBytes: w.maxBytes ?? 4_000_000 }));
  const handleFolder = async (f, req, res, rest) => {
    const send = (code, body = '', type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return send(403, 'cross-origin request refused', 'text/plain');
    try {
      if (rest === '' || rest === '/') {
        if (req.method !== 'GET') return send(405);
        await mkdir(f.dir, { recursive: true });
        const names = (await readdir(f.dir)).filter((n) => n.endsWith(f.ext) && NAME.test(n.slice(0, -f.ext.length))).sort();
        return send(200, JSON.stringify(names.map((n) => ({ name: n.slice(0, -f.ext.length), bytes: statSync(join(f.dir, n)).size }))));
      }
      const name = decodeURIComponent(rest.replace(/^\//, ''));
      if (!NAME.test(name)) return send(400, 'bad name', 'text/plain');
      const file = join(f.dir, name + f.ext);
      if (req.method === 'GET') { try { return send(200, await readFile(file, 'utf8')); } catch (e) { return e.code === 'ENOENT' ? send(404, 'not found', 'text/plain') : send(500, e.message, 'text/plain'); } }
      if (req.method === 'DELETE') { await rm(file, { force: true }); return send(204); }
      if (req.method === 'PUT') {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > f.maxBytes) return send(413, 'too large', 'text/plain'); chunks.push(c); }
        const text = Buffer.concat(chunks).toString('utf8');
        if (f.ext === '.json') { try { JSON.parse(text); } catch (e) { return send(400, `not valid JSON (${e.message})`, 'text/plain'); } }
        await mkdir(f.dir, { recursive: true });
        const tmp = `${file}.tmp-${process.pid}`;
        await writeFile(tmp, text, 'utf8'); await rename(tmp, file);
        log(`saved ${name}${f.ext}`);
        return send(204);
      }
      return send(405);
    } catch (e) { return send(500, e.message, 'text/plain'); }
  };

  const server = http.createServer((req, res) => {
    if (handle?.(req, res)) return;
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (path.startsWith('/@modules/')) {
      const m = /^\/@modules\/(@[a-z0-9-]+\/[a-z0-9-]+)\/(.+)$/.exec(path);
      const dir = m && importMap.packages.get(m[1]);
      const file = dir && resolve(dir, m[2]);
      let st; try { st = file && file.startsWith(dir + sep) && statSync(file); } catch { st = null; }
      if (!st || !st.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': contentType(file), 'content-length': st.size, 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
      return;
    }
    const folder = folders.find((f) => path === f.route || path.startsWith(`${f.route}/`));
    if (folder) { handleFolder(folder, req, res, path.slice(folder.route.length)); return; }
    if (path === '/__dev' && liveReload) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (path === '/manifest.json') {
      if (manifestText === null) buildManifest();
      if (req.headers['if-none-match'] === manifestTag) { res.writeHead(304, { etag: manifestTag }).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', etag: manifestTag, 'cache-control': 'no-cache' }).end(manifestText); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (path.endsWith('/')) path += 'index.html';
    if (path.includes('\0') || path.includes('\\') || path.split('/').some((s) => s === '..' || (s.startsWith('.') && s !== '') || s === 'node_modules')) { res.writeHead(403).end('forbidden'); return; }
    const file = resolve(join(base, path));
    if (!file.startsWith(base + sep)) { res.writeHead(403).end('forbidden'); return; }
    let st;
    try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
    if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
    const type = contentType(file);
    if ((liveReload || mapTag) && extname(file).toLowerCase() === '.html') {
      let html = readFileSync(file, 'utf8');
      if (mapTag) html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}${mapTag}`) : mapTag + html;
      const body = !liveReload ? html : /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${CLIENT}</body>`) : html + CLIENT;
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }).end(req.method === 'HEAD' ? undefined : body); return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(port, host, r); });
  const actual = server.address().port;
  return {
    server, port: actual, url: `http://${host}:${actual}/`,
    manifest: () => { if (manifestText === null) buildManifest(); return JSON.parse(manifestText); },
    changed,
    close: () => new Promise((r) => { watcher?.close(); for (const c of clients) c.end(); server.close(() => r()); server.closeAllConnections?.(); }),
  };
}


