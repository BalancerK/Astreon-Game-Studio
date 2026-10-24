// The runner's service worker. It answers requests under p/<run>/ (the project), c/<run>/ (a copy used only to check syntax), t/<id>/ (the project for a run of its
// tests) and a/ (the project's pictures and
// sounds) from the Cache the runner page filled, so a project's files are real URLs: imports between files work, workers can load them, and error messages
// carry real file names and line numbers.
// It also keeps the engine's files and the runner's own, so the studio can run games with no network: everything else is asked of the network first and the
// kept copy is used only when the network does not answer (see studio/sw.js, which does the same for the studio itself).
let info = null;
try {
  importScripts('../offline-files.js');
  info = self.STUDIO_OFFLINE;
} catch { /* no list here: nothing is kept */ }

const base = new URL('../../', self.location.href).href;       // the top of the repository
const mine = (f) => f.startsWith('packages/') || f.startsWith('studio/runner/');
const files = info ? info.files.filter(mine) : [];
const CACHE = info ? `runner-static-${info.version}` : null;
const WAIT_MS = 3000;
const say = async (message) => {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ source: 'runner-sw', ...message });
};

async function status() {
  if (!info) return { done: 0, total: 0, complete: false };
  const have = new Set((await (await caches.open(CACHE)).keys()).map((r) => r.url));
  const done = files.filter((f) => have.has(base + f)).length;
  return { done, total: files.length, complete: done === files.length };
}

async function keepAll() {
  if (!info) return;
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const missing = files.filter((f) => !have.has(base + f));
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map(async (file) => {
      try {
        const response = await fetch(base + file, { cache: 'reload' });
        if (response.ok) await cache.put(base + file, response);
      } catch { /* offline: the next visit finishes the job */ }
    }));
  }
  say({ t: 'status', ...(await status()) });
}

// Starting must never wait for the copying: the page asks for it with a 'keep' message once it is up.
self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('runner-static-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.t === 'status') event.waitUntil(status().then((s) => event.source?.postMessage({ source: 'runner-sw', t: 'status', ...s })));
  else if (event.data?.t === 'keep') event.waitUntil(keepAll().catch(() => {}));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (/\/runner\/([pct]\/\d+|a)\//.test(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? new Response(`not in the project: ${url.pathname}`, { status: 404 })));
    return;
  }
  if (!info || request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!files.includes((url.origin + url.pathname).slice(base.length))) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  fromNetwork.catch(() => {});
  const kept = () => cache.match(request, { ignoreSearch: true });
  const slow = new Promise((resolve) => setTimeout(resolve, WAIT_MS)).then(async () => (await kept()) ?? fromNetwork);
  try {
    return await Promise.race([fromNetwork, slow]);
  } catch {
    return (await kept()) ?? Response.error();
  }
}
