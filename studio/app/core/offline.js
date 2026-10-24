// Using the studio with no network, and installing it as an app. The studio's service worker (studio/sw.js) keeps the studio's files, and the game's frame keeps
// the engine's (studio/runner/sw.js); this is the page's side: it starts the worker, shows how far the keeping has got, offers the browser's "install" and says
// when a newer studio is ready. It only starts on a web host (or when asked with ?pwa=1 on this computer), so that changing the studio's own files while
// developing is never held up by a kept copy.
import { showDialog } from '../ui/dialog.js';
import { h } from '../ui/dom.js';

const KEY = 'studio-offline';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OfflineManager {
  /** @param {import('./studio.js').Studio} studio */
  constructor(studio) {
    this.studio = studio;
    this.state = 'off';                 // off, preparing, ready, partial
    this.reason = '';
    this.version = null;
    this.done = 0;
    this.total = 0;
    this.prompt = null;                 // the browser's install question, when it has one to ask
    this.registration = null;
    studio.runner.on('engine-offline', () => studio.emit('offline'));
  }

  /** Is the studio running as an installed app (no browser bar)? */
  get installed() { return matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true; }

  get engine() { return this.studio.runner.engineOffline; }

  #wanted() {
    const params = new URLSearchParams(location.search);
    if (params.get('pwa') === '0') { this.#forget(); return false; }
    if (params.get('pwa') === '1') { try { localStorage.setItem(KEY, '1'); } catch { /* private window */ } return true; }
    try { if (localStorage.getItem(KEY) === '1') return true; } catch { /* private window */ }
    return !LOCAL.has(location.hostname);
  }

  async #forget() {
    try { localStorage.removeItem(KEY); } catch { /* private window */ }
    if (!('serviceWorker' in navigator)) return;
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) if (k.startsWith('studio-')) await caches.delete(k);
  }

  async start() {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.prompt = e; this.studio.emit('offline'); });
    window.addEventListener('appinstalled',
      () => { this.prompt = null; this.studio.toasts.show('The studio is installed.', { kind: 'success' }); this.studio.emit('offline'); });
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { this.reason = 'This browser cannot keep the studio for offline use.'; return; }
    if (!this.#wanted()) {
      this.reason = 'Offline use is switched on when the studio is opened from a web address (or with ?pwa=1 added to the address).';
      return;
    }
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('message', (e) => this.#message(e.data));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !this.updated) {
        this.updated = true;
        this.studio.toasts.show('A newer studio is ready.', { kind: 'info', ms: 20_000, action: { label: 'Reload', run: () => location.reload() } });
      }
    });
    try {
      this.registration = await navigator.serviceWorker.register('./sw.js');
      this.state = 'preparing';
      await navigator.serviceWorker.ready;
      (navigator.serviceWorker.controller ?? this.registration.active)?.postMessage({ t: 'keep' });
      this.studio.emit('offline');
    } catch (error) {
      this.state = 'off';
      this.reason = `Offline use could not start: ${error.message}`;
      this.studio.emit('offline');
    }
  }

  #message(m) {
    if (m?.source !== 'studio-sw') return;
    if (m.t === 'progress') { this.state = 'preparing'; this.done = m.done; this.total = m.total; }
    else if (m.t === 'ready' || m.t === 'partial') {
      const first = this.state !== 'ready' && m.t === 'ready' && !this.announced;
      this.state = m.t === 'ready' ? 'ready' : 'partial';
      this.version = m.version;
      this.done = m.done;
      this.total = m.total;
      if (first) {
        this.announced = true;
        this.studio.toasts.show('The studio is kept on this computer now, so it opens and works with no network.', { kind: 'success', ms: 8000 });
      }
    }
    this.studio.emit('offline');
  }

  /** Ask the browser to install the studio as an app. */
  async install() {
    if (!this.prompt) return false;
    this.prompt.prompt();
    const choice = await this.prompt.userChoice.catch(() => null);
    this.prompt = null;
    this.studio.emit('offline');
    return choice?.outcome === 'accepted';
  }

  /** Say what is kept, and offer to install. */
  async dialog() {
    const s = this.studio;
    const line = (label, value) => h('p', {}, h('strong', { text: `${label}: ` }), value);
    const studioLine = this.state === 'ready' ? `kept (${this.total} files, version ${this.version})`
      : this.state === 'preparing' ? `being kept… ${this.done} of ${this.total || '?'} files`
        : this.state === 'partial' ? `partly kept (${this.done} of ${this.total}). Open the studio once with a good connection to finish.`
          : this.reason || 'not kept';
    const engine = this.engine;
    const engineLine = !engine ? 'not known yet (it is kept the first time a game runs)'
      : engine.complete ? 'kept' : `being kept… ${engine.done} of ${engine.total}`;
    const body = h('div', {},
      line('The studio', studioLine),
      line('The game engine', engineLine),
      line('Installed as an app',
        this.installed ? 'yes' : this.prompt ? 'not yet: use the Install button' : 'no (your browser offers this from its own menu, or not at all)'),
      h('p', { class: 'dim', text: 'Your projects are always kept in this browser and never leave it, online or offline.' }));
    const buttons = [{ label: 'Close', value: 'close' }];
    if (this.prompt) buttons.unshift({ label: 'Install the studio', value: 'install', primary: true });
    if (this.state === 'preparing' || this.state === 'partial') buttons.unshift({ label: 'Keep the rest now', value: 'keep' });
    const answer = await showDialog({ title: 'Offline use and installing', body, buttons });
    if (answer === 'install') await this.install();
    if (answer === 'keep') this.registration?.active?.postMessage({ t: 'keep' });
    s.emit('plugin-event', 'offline-dialog');
  }
}
