// Minimal dev static file server (zero dependencies). Serves only allowlisted
// top-level directories and file types, never dotfiles or node_modules.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/**
 * @param {object} o
 * @param {string} o.root Repo root.
 * @param {string[]} [o.allowDirs] Top-level directories that may be served.
 * @param {string} [o.index] Path served for `/`.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => boolean} [o.handle] Return true if handled.
 * @param {Record<string, () => string>} [o.generated] JavaScript made when asked for, by path (for example the studio's list of offline files).
 * @returns {http.Server}
 */
export function createStaticServer({ root, allowDirs = ['packages', 'examples'], index = '/', handle, generated = {} }) {
  const base = resolve(root);
  return http.createServer((req, res) => {
    if (handle?.(req, res)) return;
    const made = generated[new URL(req.url, 'http://x').pathname];
    if (made && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = made();
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (path === '/' && index !== '/') {
      // Redirect instead of serving the page at `/`: relative URLs in the page (./main.js) must resolve next to it.
      res.writeHead(302, { Location: index + new URL(req.url, 'http://x').search }).end();
      return;
    }
    if (path === '/') path = index;
    if (path.includes('\0') || path.includes('\\') || path.split('/').some((s) => s === '..' || s.startsWith('.') || s === 'node_modules')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const top = path.split('/')[1];
    const file = resolve(join(base, path));
    const type = MIME[extname(file).toLowerCase()];
    if (!allowDirs.includes(top) || !type || !file.startsWith(base + sep)) { res.writeHead(404).end('not found'); return; }
    let st;
    try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
    if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
}
