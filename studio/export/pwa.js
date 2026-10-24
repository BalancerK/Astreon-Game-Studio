// What makes an exported game installable and playable offline: a web app manifest, a service worker that keeps every file of the game, and an icon. The
// service worker's cache name holds a hash of the game, so a new export replaces the old files instead of mixing with them.

/** A short stable hash (FNV-1a) of some text, as 8 hex digits. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A simple square icon: the game's first letter on a coloured tile. */
export function iconSvg(title, color = '#4f46e5', letter = '') {
  const shown = escapeXml(letter ? [...letter][0] : [...String(title).trim()][0]?.toUpperCase() ?? 'G');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${escapeXml(color)}"/>`
    + `<text x="256" y="350" font-family="system-ui, sans-serif" font-size="300" font-weight="700" text-anchor="middle" fill="#fff">${shown}</text></svg>\n`;
}

/** The web app manifest as text. */
export function manifestJson(title, { color = '#12161f', orientation = 'landscape' } = {}) {
  const name = String(title).slice(0, 45) || 'Game';
  return `${JSON.stringify({
    name, short_name: name.slice(0, 12), start_url: './index.html', scope: './', display: 'standalone', orientation,
    background_color: color, theme_color: color, icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }, null, 2)}\n`;
}

/**
 * The service worker: it keeps every file of the game when installed, answers from the cache first, and removes caches of older exports.
 * @param {string} version a hash of the whole game
 * @param {string[]} paths the files to keep, relative to the page
 */
export function serviceWorkerJs(version, paths) {
  return `// Keeps this game working offline. Version ${version}.
const CACHE = 'game-${version}';
const FILES = ${JSON.stringify(['./', ...paths])};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('game-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
`;
}
