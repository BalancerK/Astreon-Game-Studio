// This file is copied into every exported game. It runs the game's `create`, `update` and `render` the way the studio does, but on the page itself: a fixed
// 60 ticks a second whatever the screen's speed, the keys the game asks for, sound made from the game's recipes, and saved progress kept in this browser.
// It needs no server beyond ordinary file hosting.
import { createTouchControls, GamepadReader, createMouseControls } from './controls.js';

const config = window.GAME_CONFIG ?? {};
globalThis.__engineBuild = config.build ?? { name: 'release', debug: false };                     // which build this is (the kit's build())
globalThis.__engineSettings = { width: 480, height: 320, background: '#12161f', ...config.settings };   // the kit reads the screen size and background from here
const canvas = document.getElementById('game');
const g = canvas.getContext('2d');
const banner = document.getElementById('banner');
const overlay = document.getElementById('start');
const keys = new Set();
let mod = null;
let state = null;
let running = false;
let last = 0;
let accumulator = 0;
let stopped = false;

const show = (text) => { banner.textContent = text; banner.hidden = !text; };
const fail = (what, error) => {
  stopped = true;
  show(`${what}: ${error?.message ?? error}`);
  console.error(error);
};

// ---- sound: the game sends recipes; this page makes the noise ----
let audio = null;
async function playSound({ spec, volume }) {
  if (!config.hasSound) return;
  try {
    if (!audio) {
      const [{ synthesize }, { cleanSound }] = await Promise.all([import('./engine/audio/src/synth.js'), import('./engine/arcade/src/sound.js')]);
      audio = { context: new AudioContext(), synthesize, clean: cleanSound, cache: new Map() };
    }
    if (audio.context.state === 'suspended') await audio.context.resume();
    const clean = audio.clean(spec);
    if (!clean) return;
    const file = clean.file && (config.assets ?? []).some((a) => a.kind === 'sound' && a.path === clean.file) ? clean.file : null;
    if (clean.file && !file) return;
    const key = file ? `file:${file}` : JSON.stringify(clean);
    let buffer = audio.cache.get(key);
    if (!buffer && file) {
      buffer = await audio.context.decodeAudioData(await (await fetch(`./game/${file}`)).arrayBuffer());
      audio.cache.set(key, buffer);
    } else if (!buffer) {
      const pcm = audio.synthesize(clean);
      buffer = audio.context.createBuffer(1, pcm.data.length, pcm.sampleRate);
      buffer.copyToChannel(pcm.data, 0);
      audio.cache.set(key, buffer);
    }
    const source = audio.context.createBufferSource();
    const gain = audio.context.createGain();
    gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.8;
    source.buffer = buffer;
    source.connect(gain).connect(audio.context.destination);
    source.start();
  } catch (error) { console.warn('could not play a sound', error); }
}

// ---- music: one song at a time, looping ----
let song = null;
async function playMusic(m) {
  if (!config.hasSound) return;
  try {
    if (!audio) await playSound({ spec: null, volume: 0 });                  // start the audio machinery (nothing is played)
    if (!audio) return;
    if (m.action === 'stop') {
      if (song) { song.source.stop(); song = null; }
      return;
    }
    audio.music ??= await import('./engine/arcade/src/music.js');
    const { sequence } = await import('./engine/audio/src/synth.js');
    const clean = audio.music.cleanSong(m.spec);
    if (!clean || typeof m.name !== 'string') return;
    if (audio.context.state === 'suspended') await audio.context.resume();
    const volume = Math.max(0, Math.min(1, Number(m.volume) || 0)) * 0.7;
    if (song?.name === m.name) { song.gain.gain.value = volume; return; }
    const key = `music:${JSON.stringify(clean)}`;
    let buffer = audio.cache.get(key);
    if (!buffer) {
      const pcm = sequence({ bpm: clean.bpm, tracks: clean.tracks });
      buffer = audio.context.createBuffer(1, pcm.data.length, pcm.sampleRate);
      buffer.copyToChannel(pcm.data, 0);
      audio.cache.set(key, buffer);
    }
    if (song) song.source.stop();
    const source = audio.context.createBufferSource();
    const gain = audio.context.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.loop = !!m.loop;
    source.connect(gain).connect(audio.context.destination);
    source.start();
    song = { name: m.name, source, gain };
  } catch (error) { console.warn('could not play the music', error); }
}

// ---- pictures: loaded before the game starts, so `create` and `drawImage` can use them at once ----
async function loadPictures() {
  const pictures = new Map();
  globalThis.__engineAssets = pictures;
  await Promise.all((config.assets ?? []).filter((a) => a.kind === 'image').map(async (a) => {
    try {
      const response = await fetch(`./game/${a.path}`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      pictures.set(a.path, await createImageBitmap(await response.blob()));
    } catch (error) { console.warn(`The picture ${a.path} could not be loaded (${error.message})`); }
  }));
}

// ---- saved progress: this browser's own storage, kept apart for each game ----
const progressKey = `progress:${config.id ?? 'game'}`;
const readProgress = () => { try { return JSON.parse(localStorage.getItem(progressKey) ?? 'null') ?? null; } catch { return null; } };
const writeProgress = (data) => { try { localStorage.setItem(progressKey, JSON.stringify(data)); } catch { /* storage is full or blocked */ } };

async function boot() {
  try {
    if (config.hasKit) {
      const [sound, progress] = await Promise.all([import('./engine/arcade/src/sound.js'), import('./engine/arcade/src/progress.js')]);
      sound.setSoundSink((m) => (m.t === 'music' ? playMusic(m) : playSound(m)));
      progress.setProgressHost({ send: (m) => writeProgress(m.data), initial: readProgress() });
    }
    await loadPictures();
    mod = await import('./game/src/main.js');
    for (const name of ['create', 'update',
      'render']) if (typeof mod[name] !== 'function') throw new Error(`src/main.js must export a function called ${name}`);
    state = mod.create();
  } catch (error) {
    fail('The game could not start', error);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (pad.poll() && !running && !overlay.hidden) begin();                    // a controller button starts the game, like a key
  if (!running || stopped || !mod) { last = now; return; }
  accumulator += Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    while (accumulator >= 1 / 60) { mod.update(state, keys, 1 / 60); accumulator -= 1 / 60; }
    g.imageSmoothingEnabled = !globalThis.__engineSettings.pixelArt;
    mod.render(state, g, accumulator * 60);
  } catch (error) { fail('The game stopped', error); }
}

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();                   // the game's keys must not scroll the page
});
addEventListener('keyup', (e) => keys.delete(e.code));
const touch = createTouchControls(document,
  { press: (c) => keys.add(c), release: (c) => keys.delete(c), force: new URLSearchParams(location.search).has('touch') });
const pad = new GamepadReader({ press: (c) => keys.add(c), release: (c) => keys.delete(c) });
const mouse = createMouseControls(document, () => canvas, { press: (c) => keys.add(c), release: (c) => keys.delete(c) });
globalThis.__engineInput = { wantMouse: () => mouse.want(true) };               // a game that wants the mouse (a first-person view) says so
addEventListener('blur', () => {
  keys.clear(); touch.releaseAll(); pad.releaseAll(); mouse.releaseAll(); running = false; overlay.hidden = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); touch.releaseAll(); pad.releaseAll(); running = false; overlay.hidden = false; }
});

function begin() {
  if (stopped || !mod) return;
  overlay.hidden = true;
  running = true;
  last = performance.now();
  canvas.focus();
  if (audio?.context.state === 'suspended') audio.context.resume();
}
overlay.addEventListener('click', begin);
overlay.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') begin(); });
overlay.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); begin(); } });

if ('serviceWorker' in navigator && config.offline) navigator.serviceWorker.register('./sw.js').catch(() => {});
await boot();
if (!stopped) {
  g.imageSmoothingEnabled = !globalThis.__engineSettings.pixelArt;
  try { mod.render(state, g, 0); } catch (error) { fail('The game stopped', error); }
  overlay.hidden = false;
  overlay.focus();
}
requestAnimationFrame(frame);
