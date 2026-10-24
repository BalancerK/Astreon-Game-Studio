// Read assets from a directory in Node (tests, servers, the build tool) through the same interface as `fetch`.
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** A `fetch`-like function that serves files below `root`. Paths that climb out of it are refused. */
export function fileFetch(root) {
  const base = resolve(root);
  return async (url) => {
    const path = resolve(join(base, decodeURIComponent(String(url).split('?')[0])));
    if (path !== base && !path.startsWith(base + sep)) return new Response('forbidden', { status: 403 });
    try { return new Response(await readFile(path), { status: 200 }); } catch (e) { return new Response('not found', { status: e.code === 'ENOENT' ? 404 : 500 }); }
  };
}
