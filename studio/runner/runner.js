// The runner: this page lives on a DIFFERENT origin from the studio, inside an iframe, so project code (yours, or a project somebody shared with you) can
// never touch the studio's own data. It stores the project's files where the service worker can serve them, checks them for mistakes, and runs the game in a
// Worker that it can kill if the game hangs.
import { createTouchControls, GamepadReader, createMouseControls } from './controls.js';
import { resolveImports } from './resolve-imports.js';

const params = new URLSearchParams(location.search);
const studioOrigin = params.get('studio');
const engineRoot = params.get('engine') ?? '/packages';
const stage = document.getElementById('stage');
const base = new URL('./p/', location.href).href;
const checkBase = new URL('./c/', location.href).href;
const assetBase = new URL('./a/', location.href).href;
const testBase = new URL('./t/', location.href).href;
/** The address of an asset: every part of the path is encoded, so a name with a space keeps one address for putting, finding and fetching. */
const assetUrl = (path) => assetBase + path.split('/').map(encodeURIComponent).join('/');
const ASSET_PATH = /^assets\/[\w][\w .-]{0,79}$/;
const post = (message) => parent.postMessage(message, studioOrigin);
let projectId = 'untitled';   // which project is running (for its saved progress)
let muted = false;

let worker = null;
let lastBeat = performance.now();
let lastGood = null;       // { run, files } of the last version that ran for a while without hanging
let candidate = null;      // a version that has loaded but not yet proved itself: { run, files, since }
let snapshot = null;       // the last copy of the game's state that the worker sent
let current = null;        // the newest version that passed the syntax check
let frame = 0;             // the worker's frame counter, from its heartbeat
let visible = true;        // the studio says when the frame cannot be seen (a hidden tab): a game that is not drawn is not stuck
const runs = new Map();    // run number -> its files, so a version that loads can be remembered as the last good one

/** Put a run's files in the cache: the real project under p/<run>/ and a copy that throws first, under c/<run>/, for checking syntax. */
async function store(run, files, assets = [], assetData = {}) {
  const cache = await caches.open('project');
  const put = (url, text) => cache.put(new Request(url), new Response(text, { headers: { 'content-type': 'text/javascript' } }));
  await Promise.all(Object.entries(files).flatMap(([path, content]) => {
    const source = resolveImports(typeof content === 'string' ? content : '', engineRoot);
    return [put(`${base}${run}/${path}`, source), put(`${checkBase}${run}/${path}`, `throw 'parsed-ok';${source}`)];
  }));
  const wanted = new Set(assets.map((a) => assetUrl(a.path)));
  for (const a of assets) {
    const bytes = assetData[a.path];
    if (bytes) await cache.put(new Request(assetUrl(a.path)), new Response(bytes, { headers: { 'content-type': a.mime } }));
  }
  for (const request of await cache.keys()) {
    if (request.url.startsWith(assetBase)) { if (!wanted.has(request.url)) await cache.delete(request); continue; }
    const n = Number(/\/[pc]\/(\d+)\//.exec(request.url)?.[1]);
    if (n < run - 1) await cache.delete(request);
  }
}

/**
 * Is every file of this run free of syntax errors? A module script reports the exact file, line and column of a syntax error (an import() or a worker does
 * not). The copies under c/ throw as their very first act (the text 'parsed-ok'), so after the whole project has been parsed nothing of it runs.
 * @returns {Promise<null | {message: string, file?: string, line?: number, column?: number}>} null if all is well
 */
function check(run) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${checkBase}${run}/src/main.js`;
    const finish = (result) => { removeEventListener('error', onError); script.remove(); resolve(result); };
    const onError = (e) => {
      // our own `throw`: the whole project parsed (browsers word it differently)
      if (String(e.message).includes('parsed-ok')) return finish(null);
      const file = e.filename?.startsWith(checkBase) ? e.filename.replace(/^.*\/c\/\d+\//, '') : undefined;
      finish({ message: String(e.message).replace(/^Uncaught /, ''), file, line: file ? e.lineno : undefined, column: e.colno });
    };
    addEventListener('error', onError);
    script.onerror = () => finish({ message: 'a file this project imports could not be found' });
    document.head.append(script);
    setTimeout(() => finish(null), 5000);
  });
}

// ---- the project's tests: run in a worker of their own, never in the game's ----
const TEST_PATH = /^[\w][\w./ -]{0,118}\.js$/;
const TEST_LIMIT_MS = 15_000;
async function storeTests(id, files) {
  const cache = await caches.open('project');
  await Promise.all(Object.entries(files).map(([path, content]) => cache.put(new Request(`${testBase}${id}/${path}`),
    new Response(resolveImports(typeof content === 'string' ? content : '', engineRoot), { headers: { 'content-type': 'text/javascript' } }))));
  for (const request of await cache.keys()) {
    if (request.url.startsWith(testBase) && Number(/\/t\/(\d+)\//.exec(request.url)?.[1]) < id) await cache.delete(request);
  }
}
async function runTests({ id, files, paths }) {
  const wanted = paths.filter((p) => typeof p === 'string' && TEST_PATH.test(p) && !p.includes('..')).slice(0, 60);
  try {
    await storeTests(id, files);
    const tester = new Worker('./test-host.js', { type: 'module' });
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ message: 'The tests took too long, so they were stopped.', results: [] }), TEST_LIMIT_MS);
      const end = (value) => { clearTimeout(timer); resolve(value); };
      tester.onmessage = (event) => end(event.data ?? { results: [] });
      tester.onerror = (event) => end({ message: `The tests stopped: ${event.message || 'a file could not be loaded'}`, results: [] });
      tester.postMessage({ base: `${testBase}${id}/`, paths: wanted, engineRoot });
    });
    tester.terminate();
    post({ t: 'testResults', id, results: outcome.results ?? [], message: outcome.message });
  } catch (error) {
    post({ t: 'testResults', id, results: [], message: String(error?.message ?? error) });
  }
}

// ---- the worker ----
function stop() {
  worker?.terminate();
  worker = null;
  stage.replaceChildren();
}

function spawn(files, run, state) {
  stop();
  const canvas = document.createElement('canvas');
  canvas.width = currentSettings.width;
  canvas.height = currentSettings.height;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The game. It is drawn on a canvas; play it with the arrow keys, Space, X and Enter, or with a gamepad.');
  stage.append(canvas);
  const offscreen = canvas.transferControlToOffscreen();
  worker = new Worker('./worker-host.js', { type: 'module' });
  worker.onmessage = (event) => {
    const m = event.data;
    if (m.t === 'beat') {
      lastBeat = performance.now();
      if (overlay.on) updateOverlay(m);
      frame = m.frame;
      if (m.state !== undefined) snapshot = m.state;
      if (candidate && frame - candidate.since >= 45) { lastGood = candidate; candidate = null; }      // it survived most of a second
      post({ t: 'beat', frame: m.frame, summary: m.summary, perf: m.perf, stateProblem: m.stateProblem, profile: m.profile });
    } else if (m.t === 'wantMouse') {
      mouse.want(true);
    } else if (m.t === 'picked') {
      post({ t: 'picked', path: m.path });
    } else if (m.t === 'sound') {
      playSound(m);
    } else if (m.t === 'music') {
      playMusic(m);
    } else if (m.t === 'save') {
      writeProgress(m.data);
    } else {
      if (m.t === 'applied') candidate = { run: m.run, files: runs.get(m.run) ?? files, since: frame };
      post(m);
    }
  };
  worker.onerror = (e) => post({ t: 'error', kind: 'worker', message: e.message || 'the game crashed' });
  lastBeat = performance.now();
  frame = 0;
  worker.postMessage({ t: 'init', canvas: offscreen, base, assetBase, engineRoot, state }, [offscreen]);
  if (run) worker.postMessage({ t: 'run', run, restart: state === null, progress: readProgress() ?? {}, assets: currentAssets,
    settings: currentSettings });
}

// ---- sound: the game sends recipes; this page makes the sound (a worker has no speakers) ----
let audio = null;                       // { context, synthesize, clean }
let audioLoading = null;
const bufferCache = new Map();
let soundBudget = 30;
setInterval(() => { soundBudget = 30; }, 1000);
async function loadAudio() {
  audioLoading ??= (async () => {
    const [{ synthesize, sequence }, { cleanSound }, { cleanSong }] = await Promise.all([
      import(`${engineRoot}/audio/src/synth.js`), import(`${engineRoot}/arcade/src/sound.js`), import(`${engineRoot}/arcade/src/music.js`),
    ]);
    audio = { context: new AudioContext(), synthesize, sequence, clean: cleanSound, cleanSong };
  })().catch(() => { audioLoading = null; });
  await audioLoading;
}
const wake = () => { audio?.context.state === 'suspended' && audio.context.resume().catch(() => {}); loadAudio(); };
async function playSound({ spec, volume }) {
  if (muted || soundBudget-- <= 0) return;
  await loadAudio();
  if (!audio) return;
  const clean = audio.clean(spec);
  if (!clean) return;
  const asset = clean.file ? currentAssets.find((a) => a.path === clean.file && a.kind === 'sound') : null;
  if (clean.file && !asset) return;                                  // not a sound this project has
  const key = asset ? `file:${asset.path}:${asset.hash}` : JSON.stringify(clean);
  let buffer = bufferCache.get(key);
  if (!buffer && asset) {
    try {
      const response = await fetch(assetUrl(asset.path));
      buffer = await audio.context.decodeAudioData(await response.arrayBuffer());
    } catch { return; }                                              // a sound file the browser cannot decode is silent
    bufferCache.set(key, buffer);
  } else if (!buffer) {
    const pcm = audio.synthesize(clean);
    buffer = audio.context.createBuffer(1, pcm.data.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.data, 0);
    bufferCache.set(key, buffer);
  }
  if (bufferCache.size > 60) bufferCache.delete(bufferCache.keys().next().value);
  const source = audio.context.createBufferSource();
  const gain = audio.context.createGain();
  gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.8;
  source.buffer = buffer;
  source.connect(gain).connect(audio.context.destination);
  source.start();
  post({ t: 'played' });
}

// ---- music: one song at a time, looping; starting another fades the first ----
let song = null;                        // { name, source, gain, volume }
const musicLevel = () => (muted ? 0 : (song?.volume ?? 0) * 0.7);
function stopMusicNow(fade = 0.15) {
  if (!song) return;
  const { source, gain } = song;
  song = null;
  try {
    const t = audio.context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fade);
    source.stop(t + fade + 0.02);
  } catch { /* already stopped */ }
}
async function playMusic(m) {
  await loadAudio();
  if (!audio) return;
  if (m.action === 'stop') { stopMusicNow(); return; }
  const clean = audio.cleanSong(m.spec);
  if (!clean || typeof m.name !== 'string') return;
  const volume = Math.max(0, Math.min(1, Number(m.volume) || 0));
  if (song?.name === m.name) {                                         // already playing: keep going, maybe at another volume
    song.volume = volume;
    song.gain.gain.value = musicLevel();
    return;
  }
  const key = `music:${JSON.stringify(clean)}`;
  let buffer = bufferCache.get(key);
  if (!buffer) {
    const pcm = audio.sequence({ bpm: clean.bpm, tracks: clean.tracks });
    buffer = audio.context.createBuffer(1, pcm.data.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.data, 0);
    bufferCache.set(key, buffer);
  }
  stopMusicNow();
  const source = audio.context.createBufferSource();
  const gain = audio.context.createGain();
  source.buffer = buffer;
  source.loop = !!m.loop;
  source.connect(gain).connect(audio.context.destination);
  song = { name: m.name, source, gain, volume };
  gain.gain.setValueAtTime(0, audio.context.currentTime);
  gain.gain.linearRampToValueAtTime(musicLevel(), audio.context.currentTime + 0.1);
  source.onended = () => { if (song?.source === source) song = null; };
  source.start();
  post({ t: 'played' });
}

// ---- saved progress: kept for each project, in this page's own storage (another origin from the studio) ----
const progressKey = () => `progress:${projectId}`;
function readProgress() {
  try { return JSON.parse(localStorage.getItem(progressKey()) ?? 'null') ?? undefined; } catch { return undefined; }
}
function writeProgress(data) {
  try {
    const json = JSON.stringify(data);
    if (json !== undefined && json.length <= 20_000) localStorage.setItem(progressKey(), json);
  } catch { /* storage is full or blocked: the game goes on without saving */ }
}

let pickMode = false;       // clicking a thing in the game picks it (holding Alt picks too)
let overlay = { on: false, boxes: false };
let currentSettings = { width: 480, height: 320, background: '#12161f' };
let currentAssets = [];     // the pictures and sounds of the version that is running: [{path, kind, mime, hash}]
let queue = Promise.resolve();
/** Runs are handled one at a time, in the order they came, so a slow syntax check can never let an older version overtake a newer one. */
function run(message) {
  queue = queue.then(() => runNow(message)).catch((error) => post({ t: 'error', kind: 'load', message: String(error?.message ?? error) }));
  return queue;
}

async function runNow({ run: number, files, restart, assets, assetData, settings }) {
  currentSettings = cleanSettings(settings);
  runs.set(number, files);
  for (const old of runs.keys()) if (old < number - 3) runs.delete(old);
  await store(number, files, assets, assetData);
  if (restart) stopMusicNow();
  const problem = await check(number);
  if (problem) {
    post({ t: 'error', kind: 'load', ...problem });       // the game keeps running the last version that loaded
    return;
  }
  current = { run: number, files };
  currentAssets = assets;
  if (!worker) spawn(files, number, snapshot);
  else worker.postMessage({ t: 'run', run: number, restart, progress: readProgress() ?? {}, assets, settings: currentSettings });
}

// ---- the watchdog: a worker that stops sending beats is stuck; kill it and carry on from its last snapshot ----
setInterval(() => {
  if (!worker || !visible || document.visibilityState !== 'visible') { lastBeat = performance.now(); return; }
  if (performance.now() - lastBeat < 1500) return;
  post({ t: 'hang' });
  candidate = null;                                       // whatever was running did not survive
  const go = lastGood;
  spawn(go?.files, go?.run, snapshot);
  post({ t: 'recovered', run: go?.run ?? 0, fromSnapshot: snapshot !== null && !!go });
  lastBeat = performance.now();
}, 250);

/** The screen size and background the studio sent, kept inside safe limits (this page does not trust what it is sent). */
function cleanSettings(raw) {
  const size = (v, fallback) => (Number.isFinite(v) ? Math.max(120, Math.min(1920, Math.round(v))) : fallback);
  const colour = typeof raw?.background === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.background) ? raw.background : '#12161f';
  return { width: size(raw?.width, 480), height: size(raw?.height, 320), background: colour };
}

/** The list of pictures and sounds the studio sent, with anything odd left out (this page does not trust what it is sent). */
function cleanAssets(list) {
  if (!Array.isArray(list)) return [];
  const fine = (a) => a && ASSET_PATH.test(a.path) && !a.path.includes('..') && (a.kind === 'image' || a.kind === 'sound')
    && typeof a.hash === 'string' && /^audio\/|^image\//.test(a.mime);
  return list.slice(0, 60).filter(fine).map((a) => ({ path: a.path, kind: a.kind, mime: a.mime, hash: String(a.hash).slice(0, 40) }));
}
function cleanAssetData(data, list) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const a of list) if (data[a.path] instanceof Uint8Array || data[a.path] instanceof ArrayBuffer) out[a.path] = data[a.path];
  return out;
}

addEventListener('message', (event) => {
  if (event.source !== parent || event.origin !== studioOrigin) return;
  const m = event.data;
  if (!m || typeof m !== 'object') return;
  if (m.t === 'run' && Number.isInteger(m.run) && m.files && typeof m.files === 'object') {
    m.settings = cleanSettings(m.settings);
    m.assets = cleanAssets(m.assets);
    m.assetData = cleanAssetData(m.assetData, m.assets);
    if (typeof m.project === 'string') projectId = m.project.replace(/[^\w-]/g, '').slice(0, 64) || 'untitled';
    if (m.restart) snapshot = null;
    run(m);
  } else if (m.t === 'tests' && Number.isInteger(m.id) && m.files && typeof m.files === 'object' && Array.isArray(m.paths)) {
    runTests(m);
  } else if (m.t === 'key' && typeof m.code === 'string') worker?.postMessage({ t: 'key', down: !!m.down, code: m.code.slice(0, 40) });
  else if (m.t === 'profile') worker?.postMessage({ t: 'profile', on: !!m.on });
  else if (m.t === 'pickMode') { pickMode = !!m.on; stage.style.cursor = pickMode ? 'crosshair' : ''; }
  else if (m.t === 'overlay') {
    overlay = { on: !!m.on, boxes: !!m.boxes };
    dbg.hidden = !overlay.on;
    worker?.postMessage({ t: 'overlay', on: overlay.on, boxes: overlay.boxes });
  } else if (m.t === 'mute') { muted = !!m.value; if (song) song.gain.gain.value = musicLevel(); }
  else if (m.t === 'resetProgress') {
    try { localStorage.removeItem(progressKey()); } catch { /* nothing to forget */ }
    worker?.postMessage({ t: 'progress', progress: null });
  }
  else if (m.t === 'visible') { visible = !!m.value; lastBeat = performance.now(); }
  else if (['time', 'watch', 'select', 'edit', 'loadReplay'].includes(m.t)) worker?.postMessage(m);               // the worker checks them again
  else if (m.t === 'stop') { stop(); stopMusicNow(); candidate = null; lastGood = null; snapshot = null; }
});
const sendKey = (code, down) => worker?.postMessage({ t: 'key', down, code });
const touch = createTouchControls(document, { press: (c) => { wake(); sendKey(c, true); }, release: (c) => sendKey(c, false) });
const pad = new GamepadReader({ press: (c) => { wake(); sendKey(c, true); }, release: (c) => sendKey(c, false) });
const mouse = createMouseControls(document, () => stage.querySelector('canvas'),
  {
    press: (c) => { wake(); sendKey(c, true); }, release: (c) => sendKey(c, false),
    onLock: (locked, problem) => post({ t: 'mouse', locked, problem }),
  });
globalThis.__mouse = mouse;               // for the studio's own tests
(function pollPad() { requestAnimationFrame(pollPad); pad.poll(); })();
addEventListener('blur', () => { touch.releaseAll(); pad.releaseAll(); mouse.releaseAll(); });
// ---- looking at the game: click a thing to pick it (the studio shows it in the Inspector), and a small overlay of numbers ----
const dbg = document.getElementById('dbg');
let fpsFrames = 0;
let fpsAt = performance.now();
let fps = 0;
let lastPerf = null;
let lastSummary = null;
function updateOverlay(beat) {
  const now = performance.now();
  fpsFrames++;
  if (now - fpsAt >= 500) { fps = Math.round((fpsFrames * 1000) / (now - fpsAt)); fpsFrames = 0; fpsAt = now; }
  if (beat.perf) lastPerf = beat.perf;
  if (beat.summary !== undefined) lastSummary = beat.summary;
  if (beat.frame % 10 !== 0 && dbg.textContent) return;
  const f = lastPerf?.frame;
  const cost = f ? `${f.avg.toFixed(2)} ms (95%: ${f.p95.toFixed(2)})` : '...';
  const heap = lastPerf?.heapMB ? `   ${Math.round(lastPerf.heapMB)} MB` : '';
  const lines = [`${fps} fps   frame ${cost}${heap}`];
  const counts = Object.entries(beat.debug?.counts ?? {}).map(([k, n]) => `${String(k).slice(0, 20)} ${Number(n) || 0}`);
  if (counts.length) lines.push(counts.join(', '));
  if (lastSummary && typeof lastSummary === 'object') {
    lines.push(Object.entries(lastSummary).slice(0,
      8).map(([k, v]) => `${String(k).slice(0, 20)} ${String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 24)}`).join('  '));
  }
  const sel = beat.debug?.selected;
  if (sel) lines.push(`picked ${String(sel.path).slice(0, 40)}: ${Object.entries(sel.fields ?? {}).map(([k, v]) => `${String(k).slice(0,
    14)} ${String(v).slice(0, 18)}`).join('  ')}`);
  dbg.textContent = lines.join('\n');
}
stage.addEventListener('pointerdown', (e) => {
  if (!(pickMode || e.altKey) || !worker) return;
  const canvas = stage.querySelector('canvas');
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  const { width, height } = currentSettings;
  const scale = Math.min(r.width / width, r.height / height);                         // the picture fits the frame without stretching
  const x = (e.clientX - r.left - (r.width - width * scale) / 2) / scale;
  const y = (e.clientY - r.top - (r.height - height * scale) / 2) / scale;
  if (x < 0 || y < 0 || x > width || y > height) return;
  e.preventDefault();
  worker.postMessage({ t: 'pick', x, y });
});

for (const type of ['keydown', 'keyup']) {
  addEventListener(type, (e) => {
    if (type === 'keydown' && e.code === 'F3') { e.preventDefault(); post({ t: 'overlay-key' }); return; }
    if (type === 'keydown' && e.code === 'Enter' && e.altKey) { e.preventDefault(); post({ t: 'fullscreen-key' }); return; }
    wake();                                                              // sound may start only after a key or a click in this page
    worker?.postMessage({ t: 'key', down: type === 'keydown', code: e.code });
    if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();                // the game's keys must not scroll the page
  });
}

await navigator.serviceWorker.register('./sw.js', { scope: './' });
await navigator.serviceWorker.ready;
if (!navigator.serviceWorker.controller) {
  await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
}
// keep the engine's files for offline use (after starting, so it never slows the first game down), and tell the studio how far that is
navigator.serviceWorker.addEventListener('message', (e) => {
  if (e.data?.source === 'runner-sw') post({ t: 'engine-offline', complete: !!e.data.complete, done: e.data.done, total: e.data.total });
});
navigator.serviceWorker.controller.postMessage({ t: 'keep' });
post({ t: 'ready' });
