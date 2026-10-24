// Hot reload: watch for a changed manifest and let the manager swap the assets whose files changed.

/**
 * Polls a manifest URL and reloads what changed. The build tool's dev server writes a new manifest when files change; so does a rebuild.
 * @param {import('./manager.js').AssetManager} manager
 * @param {{url: string, every?: number, onReload?: (paths: string[]) => void, fetch?: typeof fetch, setInterval?: Function, clearInterval?: Function}} o
 * @returns {{stop(): void, check(): Promise<string[]>}}
 */
export function watchManifest(manager, { url, every = 1000, onReload, fetch: f = manager.fetch, setInterval: si = globalThis.setInterval, clearInterval: ci = globalThis.clearInterval } = {}) {
  let busy = false, etag = null;
  const check = async () => {
    if (busy) return [];
    busy = true;
    try {
      const res = await f(url, { headers: etag ? { 'if-none-match': etag } : {}, cache: 'no-store' });
      if (res.status === 304 || !res.ok) return [];
      etag = res.headers?.get?.('etag') ?? null;
      const changed = await manager.update(await res.json());
      if (changed.length) onReload?.(changed);
      return changed;
    } catch { return []; } finally { busy = false; }
  };
  const timer = si(check, every);
  timer?.unref?.();
  return { stop: () => ci(timer), check };
}

/**
 * The manifest a built page carries (`<script id="asset-manifest" type="application/json">`): `{ manifest, base }` for `new AssetManager({ base, manifest })`.
 * Without it (running from source) you get an empty manifest and the paths are used as they are.
 * @param {{getElementById(id: string): {textContent: string} | null}} [doc]
 */
export function inlineManifest(doc = globalThis.document) {
  const el = doc?.getElementById?.('asset-manifest');
  if (!el) return { manifest: { assets: {} }, base: '' };
  const m = JSON.parse(el.textContent);
  return { manifest: m, base: m.base ?? m.publicPath ?? '' };
}
