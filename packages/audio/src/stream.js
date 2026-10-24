/**
 * Streaming music. `load` decodes a whole file into memory: a five-minute song is about 50 MB of samples and a wait before it can start. A streamed track plays through the browser's media
 * element instead, which decodes a little ahead of where it is, starts at once and costs almost nothing in memory, and is still routed through the engine's `music` bus (so volume, mute,
 * effects, ducking and cross-fades all apply). Use it for long music and ambience; keep short effects as sounds.
 */

/**
 * A track being streamed. It looks like a voice to the engine (`playing`, `stop(fade)`, `setVolume`), and adds what a long track needs: `pause`, `resume`, `seek`, `currentTime`, `duration`.
 */
export class StreamedTrack {
  /**
   * @param {import('./engine.js').AudioEngine} engine @param {string} url
   * @param {{volume?: number, fade?: number, bus?: string, loop?: boolean, element?: HTMLMediaElement, createElement?: () => HTMLMediaElement, crossOrigin?: string | null, onEnded?: () => void, onError?: (e: any) => void}} [o]
   */
  constructor(engine, url, { volume = 1, fade = 0, bus = 'music', loop = true, element, createElement, crossOrigin = 'anonymous', onEnded = null, onError = null } = {}) {
    const ctx = engine.context;
    this.engine = engine; this.url = url; this.bus = bus; this.volume = volume; this.loop = loop;
    this.onEnded = onEnded; this.onError = onError;
    this.element = element ?? (createElement ?? (() => globalThis.document.createElement('audio')))();
    const el = this.element;
    if (crossOrigin !== null && 'crossOrigin' in el) el.crossOrigin = crossOrigin;
    el.preload = 'auto'; el.loop = loop; el.src = url;
    this.source = ctx.createMediaElementSource(el);
    this.gain = ctx.createGain();
    this.gain.gain.value = fade > 0 ? 0 : volume;
    this.source.connect(this.gain); this.gain.connect(engine.buses.get(bus).node);
    this.stopped = false; this.failed = false; this.blocked = false;
    this.endedHandler = () => { if (!this.loop) { this.#release(); this.onEnded?.(); } };
    this.errorHandler = (e) => { this.failed = true; this.onError?.(e); };
    el.addEventListener('ended', this.endedHandler); el.addEventListener('error', this.errorHandler);
    this.start();
    if (fade > 0) this.setVolume(volume, fade);
  }

  /** Begin (or retry) playback: browsers may refuse until the page has had a gesture, in which case `blocked` is true and the engine retries at the next gesture. */
  start() {
    let p;
    try { p = this.element.play(); } catch (e) { this.failed = true; this.onError?.(e); return; }
    if (p?.then) p.then(() => { this.blocked = false; }, (e) => { if (e?.name === 'NotAllowedError') this.blocked = true; else { this.failed = true; this.onError?.(e); } });
  }

  /** True while the track is on (paused counts: it is still the current track). */
  get playing() { return !this.stopped && !this.failed; }
  get paused() { return !!this.element.paused; }
  /** Where it is, in seconds. */
  get currentTime() { return this.element.currentTime; }
  /** How long it is, in seconds (NaN until the browser knows). */
  get duration() { return this.element.duration; }
  pause() { this.element.pause(); }
  resume() { this.start(); }
  /** Jump to a time in seconds. */
  seek(seconds) { this.element.currentTime = Math.max(0, seconds); }
  /** Change the volume now or over `time` seconds. */
  setVolume(v, time = 0) {
    this.volume = v;
    const g = this.gain.gain, now = this.engine.context.currentTime;
    g.cancelScheduledValues?.(now); g.setValueAtTime(g.value, now);
    if (time > 0) g.linearRampToValueAtTime(v, now + time); else g.setValueAtTime(v, now);
  }
  /** Fade out over `fade` seconds and stop. */
  stop(fade = 0) {
    if (this.stopped) return;
    this.stopped = true;
    if (fade > 0) {
      const g = this.gain.gain, now = this.engine.context.currentTime;
      g.cancelScheduledValues?.(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade);
      this.timer = setTimeout(() => this.#release(), fade * 1000 + 30);
      this.timer?.unref?.();
    } else this.#release();
  }
  #release() {
    clearTimeout(this.timer);
    this.stopped = true;
    try { this.element.pause(); } catch { /* already gone */ }
    this.element.removeEventListener('ended', this.endedHandler); this.element.removeEventListener('error', this.errorHandler);
    this.source.disconnect(); this.gain.disconnect();
    if ('src' in this.element) { this.element.removeAttribute?.('src'); this.element.load?.(); }
  }
}
