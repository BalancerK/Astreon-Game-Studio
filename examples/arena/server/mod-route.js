// Content-addressed delivery of mod client views: GET /mods/<id>/<sha256-of-view>. The hash in the URL is what the
// client verified against the WELCOME advertisement, so this route can be cached forever and cannot serve the wrong thing.

const PATH = /^\/mods\/([a-z][a-z0-9-]{0,31})\/([0-9a-f]{64})$/;

/**
 * @param {() => Map<string, any>} getViews hash -> client view (see ModManager.clientViews)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean} for createStaticServer's `handle`
 */
export function modRoute(getViews) {
  return (req, res) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/mods/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return true; }
    const m = PATH.exec(path);
    const view = m ? getViews().get(m[2]) : undefined;
    if (!view || view.id !== m[1]) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return true; }
    const body = JSON.stringify(view);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
