// The studio's service worker: it keeps every file the studio needs, so once the studio has been opened online it opens (and works) with no network.
// While online it always asks the network first, so a change to the studio shows on the next load and nothing old is ever served by mistake; the kept copy is
// used only when the network does not answer (offline, or slower than three seconds). The list of files and a version made from their contents come from
// offline-files.js, which the development server makes on the fly and `node tools/studio-offline.js write` writes for a web host.
let info = null;
try {
  importScripts('./offline-files.js');
  info = self.STUDIO_OFFLINE;
} catch { /* no list here (a copy of the studio published without one): nothing is kept, and the studio works online as usual */ }

const base = new URL('../', self.location.href).href;          // the top of the repository: the list holds paths from there
const CACHE = info ? `studio-${info.version}` : null;
const WAIT_MS = 3000;
const urlOf = (file) => base + file;
const say = async (message) => { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ source: 'studio-sw', ...message }); };

/** How much of the list is kept (all of it means the studio can start offline). */
async function status() {
  if (!info) return { version: null, done: 0, total: 0, complete: false };
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const done = info.files.filter((f) => have.has(urlOf(f))).length;
  return { version: info.version, done, total: info.files.length, complete: done === info.files.length };
}

async function keepAll() {
  if (!info) return;
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const missing = info.files.filter((f) => !have.has(urlOf(f)));
  let done = info.files.length - missing.length;
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map(async (file) => {
      try {
        const response = await fetch(urlOf(file), { cache: 'reload' });
        if (response.ok) { await cache.put(urlOf(file), response); done++; }
      } catch { /* the network went away: what is kept so far stays, and the next visit finishes the job */ }
    }));
    say({ t: 'progress', done, total: info.files.length });
  }
  const s = await status();
  say({ t: s.complete ? 'ready' : 'partial', ...s });
}

// Starting must never wait for the copying (the first visit would be slow): the page asks for it with a 'keep' message once it is up.
self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('studio-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.t === 'status') event.waitUntil(status().then((s) => event.source?.postMessage({ source: 'studio-sw', t: s.complete ? 'ready' : 'partial', ...s })));
  else if (event.data?.t === 'keep') event.waitUntil(keepAll());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!info || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, url));
});

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  const listed = info.files.includes((url.origin + url.pathname).slice(base.length));
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok && listed) cache.put(request, response.clone());                   // keep the copy up to date
    return response;
  });
  const kept = async () => (await cache.match(request, { ignoreSearch: true }))
    ?? (request.mode === 'navigate' ? await cache.match(urlOf('studio/index.html')) : undefined);
  fromNetwork.catch(() => {});                                                          // a late failure after the kept copy was used is not an error
  const slow = new Promise((resolve) => setTimeout(resolve, WAIT_MS)).then(async () => (await kept()) ?? fromNetwork);
  try {
    return await Promise.race([fromNetwork, slow]);
  } catch {
    return (await kept()) ?? Response.error();
  }
}
