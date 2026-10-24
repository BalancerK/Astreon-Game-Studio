// The game's own thread. The project's code runs here, in a Worker, so that:
//   - a game stuck in an endless loop can be killed (worker.terminate()) instead of burning a processor core until the tab is closed;
//   - drawing goes to an OffscreenCanvas, so the page that holds the studio never waits for the game.
// New versions of the code are imported into this same worker; the game's state (plain data) stays where it is. The state is also copied out every half
// second, so after a hang the studio can start a fresh worker from the last copy.
//
// It also keeps the Time Machine: every tick goes through `timeline` (see timeline.js), which records the keys pressed and the values edited by hand, and a
// copy of the state once a second, so the studio can pause, go back, replay with new code, and export a recording that reproduces a bug.
import { Timeline, validPath, getPath, checkReplay, verifyReplay } from './timeline.js';

let FixedLoop = null;
let g = null;                // the 2D drawing context
let mod = null;              // the project's current code
let state = null;            // the game's state: plain data
let broken = false;          // the code threw: stop calling it until a new version arrives
let frame = 0;
let base = '';
let loop = null;
let timeline = new Timeline();
const physical = new Set();  // the keys really held down right now (the timeline's own set differs while paused or replaying)
let selection = null;        // the path of the thing the inspector wants outlined in the game
let watching = false;        // the studio's panels are open and want to know about the timeline and the state
let runNumber = 0;

// what the game prints reaches the studio's console (at most 40 lines a second, so a loop that prints cannot flood it)
let logBudget = 40;
setInterval(() => { logBudget = 40; }, 1000);
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    if (logBudget-- <= 0) return;
    const text = args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ');
    postMessage({ t: 'log', level, text: text.slice(0, 1000) });
  };
}

/** A stack trace as project file names (src/main.js:12:5). */
function where(error) {
  const m = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\d+/([^:)\\s]+):(\\d+):(\\d+)`).exec(String(error?.stack ?? ''));
  return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]) } : {};
}
const fail = (kind, error) => postMessage({ t: 'error', kind, message: String(error?.message ?? error), ...where(error) });
let summaryWarned = '';
const summary = () => {
  try {
    return mod?.summary?.(state) ?? null;
  } catch (error) {
    const said = String(error?.message ?? error);
    if (said !== summaryWarned) { summaryWarned = said; postMessage({ t: 'log', level: 'warn', text: `summary() stopped: ${said}` }); }
    return null;
  }
};

async function load({ run, restart, progress, assets, settings }) {
  globalThis.__engineProgress = progress ?? {};
  applySettings(settings);
  await loadAssets(assets ?? []);           // what this project saved last time (see the kit's loadProgress)
  const t0 = performance.now();
  let next;
  if (restart || state === null) { loadStart = t0; firstFrameMs = null; costs.length = 0; frameWork = 0; }
  try {
    next = await import(`${base}${run}/src/main.js`);
  } catch (error) {
    fail('load', error);                         // the old code keeps running
    return;
  }
  for (const name of ['create', 'update', 'render']) {
    if (typeof next[name] !== 'function') {
      const message = `src/main.js must export a function called ${name}`;
      postMessage({ t: 'error', kind: 'load', message, file: 'src/main.js', line: 1, column: 1 });
      return;
    }
  }
  mod = next;
  broken = false;
  runNumber = run;
  timeline.run = run;                            // a copy made by other code is not compared with what this code does
  const fresh = restart || state === null;
  if (fresh) {
    try {
      state = mod.create();
      timeline.reset(state);
    } catch (error) {
      broken = true;
      fail('run', error);
      return;
    }
  }
  postMessage({ t: 'applied', run, ms: Math.round(performance.now() - t0), restarted: fresh, summary: summary() });
}

// what each picture costs (the game's update ticks since the last picture, plus drawing it), for the Ship panel's web-health report
let frameWork = 0;
let loadStart = performance.now();
let firstFrameMs = null;
const costs = [];
function costStats() {
  if (!costs.length) return null;
  const sorted = [...costs].sort((a, b) => a - b);
  return { avg: costs.reduce((n, v) => n + v, 0) / costs.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted.at(-1), samples: costs.length };
}

// ---- the profiler: what each picture costs, split into the game's update, the game's drawing and everything else, with the number of draw calls and
// of things, and the times the game gave itself with the kit's `timed(name, fn)`. Only while the studio's Profiler panel is recording. ----
const DRAWS = new Set(['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage', 'fill', 'stroke', 'putImageData']);
let profiling = false;
let prof = null;            // what the frame being measured has used so far
const outbox = [];          // finished frames not yet sent
let gap = 0;                // how long since the last picture, as the browser sees it
let profG = null;           // the drawing context, counting what is drawn on it
const MARKS = 16;

const FNS = 40;
function freshFrame() { return { update: 0, render: 0, steps: 0, extra: 0, ticks: 0, draws: 0, marks: new Map(), fns: new Map() }; }

// A game that wants the mouse (the kit's mouseLook3d) says so once; the page then takes the mouse on a click and sends its movement as a held key.
let mouseAsked = false;
globalThis.__engineInput = { wantMouse() { if (!mouseAsked) { mouseAsked = true; postMessage({ t: 'wantMouse' }); } } };

// "Time every function": the studio rewrites the project's own code (for this run only) so each function calls this. A function's own time is what is
// left after the functions it called; a recursive function's total counts each level, its own time does not.
const fnStack = [];
globalThis.__pf = (name, fn) => {
  if (!prof) return fn();
  const entry = { start: performance.now(), child: 0 };
  fnStack.push(entry);
  try {
    return fn();
  } finally {
    fnStack.pop();
    const total = performance.now() - entry.start;
    if (fnStack.length) fnStack[fnStack.length - 1].child += total;
    if (prof) {
      const have = prof.fns.get(name) ?? (prof.fns.size < FNS ? { self: 0, total: 0, n: 0 } : null);
      if (have) {
        have.self += Math.max(0, total - entry.child);
        have.total += total;
        have.n++;
        prof.fns.set(name, have);
      }
    }
  }
};
function profileOn(on) {
  profiling = !!on;
  outbox.length = 0;
  prof = profiling ? freshFrame() : null;
  if (profiling) {
    globalThis.__engineProfile = {
      mark(name, ms) {
        if (!prof || !Number.isFinite(ms)) return;
        const key = String(name).replace(/[^\w .:-]/g, '').slice(0, 24) || 'mark';
        const have = prof.marks.get(key) ?? (prof.marks.size < MARKS ? { ms: 0, n: 0 } : null);
        if (!have) return;
        have.ms += ms;
        have.n++;
        prof.marks.set(key, have);
      },
    };
    if (!profG && g) {
      const wrappers = new Map();
      profG = new Proxy(g, {
        get(target, key) {
          const value = target[key];
          if (typeof value !== 'function') return value;
          if (!wrappers.has(key)) {
            wrappers.set(key, DRAWS.has(key) ? (...args) => { if (prof) prof.draws++; return value.apply(target, args); } : value.bind(target));
          }
          return wrappers.get(key);
        },
        set(target, key, value) { target[key] = value; return true; },
      });
    }
  } else delete globalThis.__engineProfile;
}
const r2 = (v) => Math.round(v * 100) / 100;
/** Close the frame being measured and queue it: [update, render, other, ticks, draws, things, gap, tick, marks, functions] (times in milliseconds). */
function finishFrame(renderMs, otherMs) {
  const f = prof;
  prof = freshFrame();
  const things = Array.isArray(state?.things) ? state.things.length : -1;
  const marks = [...f.marks].map(([name, v]) => [name, r2(v.ms), v.n]);
  const fns = [...f.fns].map(([name, v]) => [name, r2(v.self), r2(v.total), v.n]);
  const other = Math.max(0, f.steps - f.update) + otherMs;
  outbox.push([r2(f.update), r2(renderMs), r2(other), f.ticks, f.draws, things, r2(gap), timeline?.tick ?? 0, marks, fns]);
  if (outbox.length > 240) outbox.splice(0, outbox.length - 240);
}
const profiledUpdate = (s, keys, dt) => {
  const t = performance.now();
  try { mod.update(s, keys, dt); } finally { prof.update += performance.now() - t; }
};

function makeLoop() {
  return new FixedLoop({
    tickRate: 60,
    update() {
      if (!mod || broken || timeline.paused) return;
      const t = performance.now();
      try {
        timeline.step(state, profiling ? profiledUpdate : mod.update);
      } catch (error) {
        broken = true;
        fail('run', error);
      }
      frameWork += performance.now() - t;
      if (profiling) { prof.steps += performance.now() - t; prof.ticks++; }
    },
    render(alpha) {
      if (!mod || broken) return;
      const t = performance.now();
      let renderMs = 0;
      try {
        mod.render(state, profiling && profG ? profG : g, alpha);
        renderMs = performance.now() - t;
        outline();
        drawBoxes();
      } catch (error) {
        broken = true;
        fail('run', error);
        return;
      }
      if (profiling) finishFrame(renderMs, performance.now() - t - renderMs);
      costs.push(frameWork + (performance.now() - t));
      if (costs.length > 120) costs.shift();
      frameWork = 0;
      if (firstFrameMs === null) firstFrameMs = performance.now() - loadStart;
    },
  });
}

/** Draw a box round the thing the inspector has selected (the nearest object on its path that has x, y, w and h). */
// ---- looking at the game's things: click to pick one, show every box, and the numbers for the debug overlay ----
let overlayOn = false;
let showBoxes = false;

/** The box of something that looks like it is on the screen: x, y with a size (w and h, or width and height), or x, y with a radius (r or radius, a circle round x, y). */
function shapeOf(v) {
  const size = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0;
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  if (size(v.w, v.h)) return v;
  if (size(v.width, v.height)) return { x: v.x, y: v.y, w: v.width, h: v.height };
  const r = Number.isFinite(v.r) ? v.r : v.radius;
  return Number.isFinite(r) && r > 0 ? { x: v.x - r, y: v.y - r, w: r * 2, h: r * 2 } : null;
}

/** Everything in the state that looks like something on the screen: an object with x, y, w and h. In drawing order (later is on top). */
function boxesOf(root, limit = 2000) {
  const out = [];
  const walk = (value, path, depth) => {
    if (!value || typeof value !== 'object' || depth > 4 || out.length >= limit) return;
    const isList = Array.isArray(value);
    const box = isList ? null : shapeOf(value);
    if (box) out.push({ path, box });
    for (const key of Object.keys(value)) {
      if (key === 'camera') continue;
      walk(value[key], [...path, isList ? Number(key) : key], depth + 1);
    }
  };
  walk(root, [], 0);
  return out;
}

const cameraOf = () => (state?.camera && Number.isFinite(state.camera.x) && Number.isFinite(state.camera.y) ? state.camera : { x: 0, y: 0 });

/** The thing under a point of the screen: of those that contain it, the smallest (the most specific), and the one drawn last when they tie. */
function pickAt(x, y) {
  if (!state || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cam = cameraOf();
  const wx = x + Math.round(cam.x);
  const wy = y + Math.round(cam.y);
  let best = null;
  for (const hit of boxesOf(state)) {
    const b = hit.box;
    if (wx < b.x || wy < b.y || wx > b.x + b.w || wy > b.y + b.h) continue;
    const area = b.w * b.h;
    if (!best || area <= best.area) best = { path: hit.path, area };
  }
  return best?.path ?? null;
}

function drawBoxes() {
  if (!showBoxes || !state) return;
  const cam = cameraOf();
  g.save();
  g.translate(-Math.round(cam.x), -Math.round(cam.y));
  g.strokeStyle = 'rgba(74, 215, 255, 0.85)';
  g.lineWidth = 1;
  for (const { box } of boxesOf(state, 600)) g.strokeRect(Math.round(box.x) + 0.5, Math.round(box.y) + 0.5, box.w, box.h);
  g.restore();
}

/** What the overlay shows besides the speed: how many of each thing there are, and the values of the picked one. */
function debugInfo() {
  const counts = {};
  if (state && typeof state === 'object') {
    for (const [key, value] of Object.entries(state)) {
      if (!Array.isArray(value) || !value.length || typeof value[0] !== 'object') continue;
      if (value.some((v) => v && typeof v.kind === 'string')) for (const v of value) { const k = v?.kind ?? '?'; counts[k] = (counts[k] ?? 0) + 1; }
      else counts[key] = value.length;
    }
  }
  const info = { counts: Object.fromEntries(Object.entries(counts).slice(0, 14)) };
  const picked = selection && state ? getPath(state, selection) : null;
  if (picked && typeof picked === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(picked).slice(0, 14)) if (v === null || ['number', 'string',
      'boolean'].includes(typeof v)) fields[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    info.selected = { path: selection.join('.'), fields };
  }
  return info;
}

function outline() {
  if (!selection || !state) return;
  let box = null;
  for (let n = selection.length; n > 0 && !box; n--) {
    const o = getPath(state, selection.slice(0, n));
    if (o && typeof o === 'object' && [o.x, o.y, o.w, o.h].every(Number.isFinite)) box = o;
  }
  if (!box) return;
  const cam = state.camera && Number.isFinite(state.camera.x) && Number.isFinite(state.camera.y) ? state.camera : { x: 0, y: 0 };
  g.save();
  g.translate(-Math.round(cam.x), -Math.round(cam.y));
  g.strokeStyle = '#ffd23c';
  g.lineWidth = 2;
  g.setLineDash([5, 3]);
  g.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
  g.restore();
}

// ---- telling the studio about the timeline and the state (only while its panels are open) ----
let lastStatus = '';
function sendTimeline(force = false) {
  if (!watching) return;
  const status = timeline.status();
  const { tick, to, paused, mode, replayEnded } = status;
  const parts = [tick, to, paused, mode, status.snapshots.length, status.edits.length, status.diverged?.tick, replayEnded];
  const key = parts.join('|');
  if (!force && key === lastStatus) return;
  lastStatus = key;
  postMessage({ t: 'timeline', ...status });
}
function sendState() {
  if (!watching || state === null) return;
  let json;
  try { json = JSON.stringify(state); } catch { json = undefined; }
  if (json === undefined || json.length > 150_000) postMessage({ t: 'state', tick: timeline.tick, tooBig: true, bytes: json?.length ?? 0 });
  else postMessage({ t: 'state', tick: timeline.tick, state: JSON.parse(json) });
}
setInterval(() => { sendTimeline(); if (watching) sendState(); }, 150);

/** Make the timeline's keys agree with the keys really held (after a pause or a replay, when it was not listening). */
function syncKeys() {
  for (const code of [...timeline.held]) if (!physical.has(code)) timeline.key(false, code);
  for (const code of physical) if (!timeline.held.has(code)) timeline.key(true, code);
}

/** Do what the studio's time controls ask. */
function timeControl(m) {
  const update = mod?.update;
  const moveTo = (target) => { if (update && !broken && state !== null) state = timeline.seek(state, target, update); };
  try {
    switch (m.op) {
      case 'pause': timeline.paused = true; break;
      case 'play':
        if (timeline.tick < timeline.maxTick && timeline.mode === 'live') timeline.playLive();
        timeline.paused = false;
        timeline.replayEnded = false;
        syncKeys();
        break;
      case 'seek': timeline.paused = true; moveTo(m.tick); break;
      case 'step': {
        timeline.paused = true;
        const goal = timeline.tick + m.n;
        if (goal <= timeline.maxTick || m.n < 0) moveTo(goal);
        else if (update && !broken && state !== null) timeline.step(state, update);
        break;
      }
      case 'replay':
        if (!update || broken) break;
        timeline.startReplay();
        break;
      case 'export': postMessage({ t: 'replay', replay: timeline.exportReplay() }); break;
      default: break;
    }
  } catch (error) {
    broken = true;
    fail('run', error);
  }
  sendTimeline(true);
  sendState();
}

/** A recording from a file: the game goes to its first moment, paused, with the recording ready to run. */
function loadReplay(raw) {
  let replay;
  try { replay = checkReplay(raw); } catch (error) { postMessage({ t: 'verified', error: String(error.message).slice(0, 300) }); return; }
  const made = Timeline.fromReplay(replay);
  timeline = made.timeline;
  timeline.run = runNumber;
  state = made.state;
  let result;
  try { result = mod ? verifyReplay(replay, mod.update) : { ok: false, ticks: 0, divergedAt: null, checked: 0 }; } catch (error) {
    result = { ok: false, ticks: 0, divergedAt: null, checked: 0, error: String(error?.message ?? error).slice(0, 300) };
  }
  postMessage({ t: 'verified', ...result });
  sendTimeline(true);
  sendState();
}

let last = performance.now();
function tick(now) {
  gap = now - last;
  loop.advance((now - last) / 1000);
  last = now;
  frame++;
  const beat = { t: 'beat', frame, tick: timeline.tick };
  if (frame % 30 === 0) {
    beat.summary = summary();
    beat.perf = { frame: costStats(), heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null, firstFrameMs };
    try {
      beat.state = state === null ? undefined : structuredClone(state);
    } catch {
      beat.stateProblem = 'the game state must be plain data (numbers, text, lists, objects) so it can be saved and rewound';
    }
  }
  if (overlayOn && frame % 10 === 0) beat.debug = debugInfo();
  if (profiling && outbox.length && (frame % 6 === 0 || outbox.length > 60)) {
    beat.profile = { frames: outbox.splice(0, 120), heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null };
  }
  postMessage(beat);
  schedule();
}
const schedule = () => (self.requestAnimationFrame ? self.requestAnimationFrame(tick) : setTimeout(() => tick(performance.now()), 16));

/** A version that has not finished loading after ten seconds is given up on, so one stuck import cannot block every version after it. */
function withTimeout(promise, run) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      postMessage({ t: 'log', level: 'warn', text: `version ${run} took too long to load` });
      resolve();
    }, 10_000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The screen the game draws on: its size (the canvas is resized only when it changed) and background, which the kit reads. */
function applySettings(settings) {
  const s = { width: 480, height: 320, background: '#12161f', ...settings };
  globalThis.__engineSettings = s;
  if (g && (g.canvas.width !== s.width || g.canvas.height !== s.height)) { g.canvas.width = s.width; g.canvas.height = s.height; }
}

// ---- the project's pictures: loaded before the game's code runs, so `create` and `drawImage` can use them at once ----
let assetBase = '';
const pictures = new Map();          // path -> { hash, bitmap }
globalThis.__engineAssets = new Map();
async function loadAssets(list) {
  const wanted = new Set(list.filter((a) => a.kind === 'image').map((a) => a.path));
  for (const [path,
    entry] of pictures) if (!wanted.has(path)) { entry.bitmap.close?.(); pictures.delete(path); globalThis.__engineAssets.delete(path); }
  await Promise.all(list.filter((a) => a.kind === 'image' && pictures.get(a.path)?.hash !== a.hash).map(async (a) => {
    try {
      const response = await fetch(assetBase + a.path.split('/').map(encodeURIComponent).join('/'));
      if (!response.ok) throw new Error(`status ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      pictures.get(a.path)?.bitmap.close?.();
      pictures.set(a.path, { hash: a.hash, bitmap });
      globalThis.__engineAssets.set(a.path, bitmap);
    } catch (error) {
      console.warn(`The picture ${a.path} could not be loaded (${error.message}). It will be drawn as a pink and black square.`);
    }
  }));
}

let ready = Promise.resolve();
let loads = Promise.resolve();
async function init(m) {
  ({ FixedLoop } = await import(`${m.engineRoot}/core/src/index.js`));
  loop = makeLoop();
  g = m.canvas.getContext('2d');
  base = m.base;
  assetBase = m.assetBase ?? '';
  state = m.state ?? null;                        // a state handed over from an earlier worker
  if (state !== null) timeline.reset(state);      // its history is gone with that worker: the recording starts again from here
  schedule();
}

// messages are handled in order, and none before the engine has been loaded
onmessage = (event) => {
  const m = event.data;
  if (m.t === 'init') ready = init(m);
  else ready.then(() => {
    // one version is loaded at a time, in order: a slow one must not land after a newer one
    if (m.t === 'run') loads = loads.then(() => withTimeout(load(m), m.run)).catch((error) => fail('load', error));
    else if (m.t === 'key') {
      if (m.down) physical.add(m.code); else physical.delete(m.code);
      timeline.key(m.down, m.code);
    } else if (m.t === 'time') timeControl(m);
    else if (m.t === 'watch') { watching = !!m.on; lastStatus = ''; sendTimeline(true); sendState(); }
    else if (m.t === 'progress') globalThis.__engineProgress = m.progress ?? {};
    else if (m.t === 'select') { selection = validPath(m.path) ? m.path : null; }
    else if (m.t === 'pick') postMessage({ t: 'picked', path: pickAt(Number(m.x), Number(m.y)) });
    else if (m.t === 'overlay') { overlayOn = !!m.on; showBoxes = !!m.boxes; }
    else if (m.t === 'profile') profileOn(m.on);
    else if (m.t === 'edit') {
      if (state !== null && validPath(m.path) && timeline.edit(state, m.path, m.value)) { sendTimeline(true); sendState(); }
    } else if (m.t === 'loadReplay') loads = loads.then(() => loadReplay(m.replay)).catch((error) => fail('load', error));
  });
};
