// The runner's service worker: it answers requests under p/<run>/ (the project) and c/<run>/ (a copy used only to check syntax) from the Cache the runner
// page filled, so a project's files are real URLs: imports between files work, workers can load them, and error messages carry real file names and line
// numbers. Everything else (the engine's own files) goes to the network as usual.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!/\/studio\/spike\/[pc]\/\d+\//.test(url.pathname)) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit ?? new Response(`not in the project: ${url.pathname}`, { status: 404 })),
  );
});
