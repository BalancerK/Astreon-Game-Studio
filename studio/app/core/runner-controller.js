// The studio's end of the conversation with the game's frame. The frame is on another origin (see studio/runner), so everything it says is checked before it
// is believed. This class keeps count of runs, measures how long an edit took to reach the game, and turns messages into events.
import { Emitter } from '../util/emitter.js';
import { parseRunnerMessage } from './runner-protocol.js';
import { withSceneModules } from '../../export/scene-modules.js';
import { instrumentFiles } from '../profile/instrument.js';

/**
 * Where the game's frame lives. It must be a different origin from the studio (a different host name or port); in development the studio on `localhost` uses
 * `127.0.0.1` and the other way round. A deployed studio sets `window.STUDIO_CONFIG.runnerOrigin`.
 */
export function defaultRunnerOrigin(location = globalThis.location, config = globalThis.STUDIO_CONFIG) {
  if (config?.runnerOrigin) return config.runnerOrigin;
  const swapped = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname === '127.0.0.1' ? 'localhost' : null;
  if (!swapped) throw new Error('set STUDIO_CONFIG.runnerOrigin: the game must run on a different origin from the studio');
  return `${location.protocol}//${swapped}${location.port ? `:${location.port}` : ''}`;
}

export class RunnerController extends Emitter {
  /** @param {{origin: string, url?: string, engineRoot?: string}} o */
  constructor({ origin, url, engineRoot = '/packages' }) {
    super();
    this.origin = origin;
    this.url = url ?? new URL('../../runner/runner.html', import.meta.url);
    this.engineRoot = engineRoot;
    this.testId = 0;                    // the number of the last run of the project's tests
    this.frame = null;
    this.ready = false;
    this.status = 'starting';           // starting | running | error | stuck | stopped
    this.runNumber = 0;
    this.sent = new Map();
    this.assetsSent = new Map();         // asset path -> fingerprint of what the frame already has
    this.summary = null;
    this.perf = null;              // what the game's frames cost, as last measured by the worker
    this.timeline = null;          // the Time Machine's last report (see timeline.js)
    this.gameState = null;         // the game's state as last sent, for the inspector
    this.watching = false;
    this.muted = false;
    this.engineOffline = null;     // how much of the engine the frame has kept for offline use
    this.pickMode = false;
    this.overlayOn = false;
    this.profiling = false;         // the Profiler panel wants the cost of every frame
    this.boxesOn = false;
    this.projectId = 'untitled';
    this.frames = 0;
    this.pendingFiles = null;
    this.stats = { applied: 0, errors: 0, hangs: 0, sounds: 0, latencies: [] };
    this.onMessage = (event) => this.#message(event);
    addEventListener('message', this.onMessage);
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  #frameUrl() {
    const url = new URL(this.url);
    url.protocol = new URL(this.origin).protocol;
    url.host = new URL(this.origin).host;
    url.searchParams.set('studio', location.origin);
    url.searchParams.set('engine', this.engineRoot);
    return url.href;
  }

  /**
   * Make the iframe the game runs in. Its address is set BEFORE the sandbox: the game's address is another origin, so letting it keep its own origin is safe
   * (it needs it for its service worker), and a browser only knows that if the address is already there when the sandbox is read (else it warns).
   */
  createFrame(attributes = {}) {
    const frame = document.createElement('iframe');
    for (const [k, v] of Object.entries(attributes)) frame.setAttribute(k, v);
    frame.setAttribute('src', this.#frameUrl());
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    frame.setAttribute('allow', 'gamepad; fullscreen');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    this.frame = frame;
    this.ready = false;
    this.#setStatus('starting');
    return frame;
  }

  /** Use this iframe element for the game (made elsewhere). */
  attach(frame) {
    this.frame = frame;
    this.reload();
  }

  /** Load the frame from scratch (a new page, so a new game state). */
  reload() {
    if (!this.frame) return;
    this.ready = false;
    this.#setStatus('starting');
    this.frame.src = this.#frameUrl();
  }

  /**
   * Run (or hot-reload) the project's files in the game.
   * @param {Record<string, string>} files the text files of the project
   * @param {{restart?: boolean}} [o] restart: start the game over; otherwise the new code takes over and the game keeps its state
   */
  run(files, { restart = false, assets = [], settings = null } = {}) {
    this.pendingFiles = { files, restart, assets, settings };
    if (!this.ready) return;
    this.runNumber++;
    this.sent.set(this.runNumber, performance.now());
    for (const old of this.sent.keys()) if (old < this.runNumber - 20) this.sent.delete(old);
    // the pictures and sounds: a list of all of them, and the bytes of those the frame does not have yet
    const list = assets.map(({ path, kind, mime, hash }) => ({ path, kind, mime, hash }));
    const assetData = {};
    for (const a of assets) if (this.assetsSent.get(a.path) !== a.hash) { assetData[a.path] = a.bytes; this.assetsSent.set(a.path, a.hash); }
    for (const known of [...this.assetsSent.keys()]) if (!assets.some((a) => a.path === known)) this.assetsSent.delete(known);
    const withScenes = withSceneModules(files);
    // only the copy that runs is changed (scene modules, and timers when asked for); the project's files are not
    const sent = this.profileFunctions ? instrumentFiles(withScenes).files : withScenes;
    this.#post({ t: 'run', run: this.runNumber, files: sent, restart, project: this.projectId, assets: list, assetData, settings });
  }

  /** Is the game showing full screen? */
  get isFullscreen() { return !!this.frame && document.fullscreenElement === this.frame; }

  /**
   * Show the game full screen, or go back (a click, a key or the full-screen button gives the browser the permission it wants). The game keeps running and keeps
   * its keys: the frame is given the keyboard again once it fills the screen. Esc leaves full screen.
   * @returns {Promise<boolean>} whether the game is now full screen
   */
  async toggleFullscreen() {
    if (!this.frame) return false;
    try {
      if (this.isFullscreen) await document.exitFullscreen();
      else await this.frame.requestFullscreen();
    } catch (error) {
      this.emit('fullscreen-failed', error);
      return false;
    }
    this.frame.focus();
    return this.isFullscreen;
  }

  /** Stop the game (the frame stays). */
  stop() {
    this.pendingFiles = null;
    this.#post({ t: 'stop' });
    this.#setStatus('stopped');
  }

  /**
   * Send a message to the frame. A frame that is still loading (or reloading) has not said it is ready, and until it does it is not at the game's address: the browser would not
   * deliver the message, and would log an error about the origin. So nothing is sent before then (what matters is sent again when the frame says it is ready).
   */
  #post(message) {
    if (!this.frame?.contentWindow || !this.ready) return false;
    try {
      this.frame.contentWindow.postMessage(message, this.origin);
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /** Say whether the frame can be seen: a game that is not drawn is not "stuck". */
  visible(value) {
    this.isVisible = !!value;
    if (this.ready) this.#post({ t: 'visible', value: !!value });
  }

  key(code, down) {
    if (this.ready) this.#post({ t: 'key', code, down });
  }

  /** Silence the game's sound (or not). */
  mute(value) {
    this.muted = !!value;
    return this.ready && this.#post({ t: 'mute', value: this.muted });
  }

  /** Forget what this project's game saved (for trying it from the start). */
  resetProgress() { return this.ready && this.#post({ t: 'resetProgress' }); }

  /** Control the Time Machine: pause, play, seek (tick), step (n ticks, negative for back), replay (with the current code), export. */
  time(op, args = {}) { return this.ready && this.#post({ t: 'time', op, ...args }); }

  /** Ask to be told about the timeline and the game's state (while panels that show them are open). */
  watch(on) { this.watching = !!on; return this.ready && this.#post({ t: 'watch', on: !!on }); }

  /** Clicking a thing in the game picks it (the frame asks the game's worker which thing is there). */
  setPickMode(on) {
    this.pickMode = !!on;
    this.emit('debug-change');
    return this.ready && this.#post({ t: 'pickMode', on: this.pickMode });
  }

  /** The overlay of numbers on the game, and (with `boxes`) a box around every thing. */
  /** Start or stop measuring every frame (the Profiler panel does this while it is open). */
  setProfile(on) {
    this.profiling = !!on;
    return this.ready && this.#post({ t: 'profile', on: this.profiling });
  }

  /** Time every function of the project's code while the Profiler records (the game restarts with the same state: it is a hot reload). */
  setProfileFunctions(on) {
    if (!!on === !!this.profileFunctions) return;
    this.profileFunctions = !!on;
    this.emit('debug-change');
    const p = this.pendingFiles;
    if (p && this.ready) this.run(p.files, { restart: false, assets: p.assets, settings: p.settings });
  }

  setOverlay(on, boxes = this.boxesOn) {
    this.overlayOn = !!on;
    this.boxesOn = !!boxes;
    this.emit('debug-change');
    return this.ready && this.#post({ t: 'overlay', on: this.overlayOn, boxes: this.boxesOn });
  }

  /** Change one value in the running game's state, by hand. */
  edit(path, value) { return this.ready && this.#post({ t: 'edit', path, value }); }

  /** Outline the thing at this path (or nothing) in the game. */
  select(path) { return this.ready && this.#post({ t: 'select', path }); }

  /**
   * Run the project's test files in the runner's own worker (not the game's). Resolves with what each check did.
   * @param {Record<string, string>} files the project's text files
   * @param {string[]} paths the test files to run
   * @returns {Promise<{results: {file: string, name: string, ok: boolean, ms: number, error?: {message: string, expected?: string, actual?: string}}[], message?: string}>}
   */
  runTests(files, paths) {
    if (!this.ready) return Promise.resolve({ results: [], message: 'The game frame is not ready yet. Try again in a moment.' });
    const id = ++this.testId;
    return new Promise((resolve) => {
      const off = this.on('tests', (m) => {
        if (m.id !== id) return;
        clearTimeout(timer);
        off();
        resolve({ results: m.results, message: m.message });
      });
      const timer = setTimeout(() => { off(); resolve({ results: [], message: 'The tests did not answer.' }); }, 20_000);
      this.#post({ t: 'tests', id, files: withSceneModules(files), paths });
    });
  }

  /** Give the game a recording from a file; it goes to the start of it, paused. */
  loadReplay(replay) { return this.ready && this.#post({ t: 'loadReplay', replay }); }

  #message(event) {
    if (event.origin !== this.origin || !this.frame || event.source !== this.frame.contentWindow) return;
    const m = parseRunnerMessage(event.data);
    if (!m) return;
    switch (m.t) {
      case 'ready':
        this.ready = true;
        this.#setStatus('running');
        if (this.isVisible === false) this.#post({ t: 'visible', value: false });
        this.assetsSent.clear();                                 // a new page has none of them
        if (this.pendingFiles) this.run(this.pendingFiles.files,
          { restart: true, assets: this.pendingFiles.assets, settings: this.pendingFiles.settings });
        if (this.watching) this.#post({ t: 'watch', on: true });
        if (this.muted) this.#post({ t: 'mute', value: true });
        if (this.pickMode) this.#post({ t: 'pickMode', on: true });
        if (this.overlayOn) this.#post({ t: 'overlay', on: true, boxes: this.boxesOn });
        if (this.profiling) this.#post({ t: 'profile', on: true });
        this.emit('ready');
        break;
      case 'beat':
        this.frames = m.frame;
        if (m.perf) { this.perf = m.perf; this.emit('perf', m.perf); }
        if (m.profile?.frames.length) this.emit('profile', m.profile);
        if (m.summary !== undefined) { this.summary = m.summary; this.emit('summary', m.summary); }
        if (m.stateProblem) this.emit('log', { level: 'warn', text: m.stateProblem });
        break;
      case 'applied': {
        const ms = Math.round(performance.now() - (this.sent.get(m.run) ?? performance.now()));
        this.stats.applied++;
        this.stats.latencies.push(ms);
        if (this.stats.latencies.length > 100) this.stats.latencies.shift();
        if (m.summary !== undefined) this.summary = m.summary;
        this.#setStatus('running');
        this.emit('applied', { run: m.run, ms, restarted: m.restarted, summary: m.summary });
        break;
      }
      case 'error':
        this.stats.errors++;
        this.lastError = m;
        this.#setStatus('error');
        this.emit('error', m);
        break;
      case 'timeline': this.timeline = m; this.emit('timeline', m); break;
      case 'state': this.gameState = m; this.emit('state', m); break;
      case 'picked': this.emit('picked', m.path); break;
      case 'mouse': this.mouseLocked = !!m.locked; this.mouseProblem = m.problem ?? ''; this.emit('mouse', this.mouseLocked); break;
      case 'engine-offline': this.engineOffline = { complete: m.complete, done: m.done, total: m.total }; this.emit('engine-offline'); break;
      case 'overlay-key': this.setOverlay(!this.overlayOn); break;
      case 'fullscreen-key': this.toggleFullscreen(); break;
      case 'replay': this.emit('replay', m.replay); break;
      case 'played': this.stats.sounds++; this.emit('played'); break;
      case 'verified': this.emit('verified', m); break;
      case 'testResults': this.emit('tests', m); break;
      case 'hang':
        this.stats.hangs++;
        this.#setStatus('stuck');
        this.emit('hang');
        break;
      case 'recovered':
        this.#setStatus('running');
        this.emit('recovered', m);
        break;
      case 'log':
        this.emit('log', { level: m.level, text: m.text });
        break;
      default:
        break;
    }
  }

  dispose() {
    removeEventListener('message', this.onMessage);
  }
}
