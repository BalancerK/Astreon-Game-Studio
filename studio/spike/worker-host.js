// The game's own thread. The project's code runs here, in a Worker, so that:
//   - a game stuck in an endless loop can be killed (worker.terminate()) instead of burning a processor core until the tab is closed;
//   - drawing goes to an OffscreenCanvas, so the page that holds the studio never waits for the game.
// New versions of the code are imported into this same worker; the game's state (plain data) stays where it is. The state is also copied out every half
// second, so after a hang the studio can start a fresh worker from the last copy.
import { FixedLoop } from '/packages/core/src/index.js';

let canvas = null;
let g = null;                // the 2D drawing context
let mod = null;              // the project's current code
let state = null;            // the game's state: plain data
let broken = false;          // the code threw: stop calling it until a new version arrives
let frame = 0;
let base = '';
const keys = new Set();

/** A stack trace as project file names (src/main.js:12:5). */
function where(error) {
  const m = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\d+/([^:)\\s]+):(\\d+):(\\d+)`).exec(String(error?.stack ?? ''));
  return m ? { file: m[1], line: Number(m[2]), column: Number(m[3]) } : {};
}
const fail = (kind, error) => postMessage({ t: 'error', kind, message: String(error?.message ?? error), ...where(error) });
const summary = () => { try { return mod?.summary?.(state) ?? null; } catch { return null; } };

async function load({ run, restart }) {
  const t0 = performance.now();
  let next;
  try {
    next = await import(`${base}${run}/src/main.js`);
  } catch (error) {
    fail('load', error);                         // the old code keeps running
    return;
  }
  for (const name of ['create', 'update', 'render']) {
    if (typeof next[name] !== 'function') {
      postMessage({ t: 'error', kind: 'load', message: `src/main.js must export a function called ${name}`, file: 'src/main.js', line: 1, column: 1 });
      return;
    }
  }
  mod = next;
  broken = false;
  const fresh = restart || state === null;
  if (fresh) {
    try {
      state = mod.create();
    } catch (error) {
      broken = true;
      fail('run', error);
      return;
    }
  }
  postMessage({ t: 'applied', run, ms: Math.round(performance.now() - t0), restarted: fresh, summary: summary() });
}

const loop = new FixedLoop({
  tickRate: 60,
  update(dt) {
    if (!mod || broken) return;
    try {
      mod.update(state, keys, dt);
    } catch (error) {
      broken = true;
      fail('run', error);
    }
  },
  render(alpha) {
    if (!mod || broken) return;
    try {
      mod.render(state, g, alpha);
    } catch (error) {
      broken = true;
      fail('run', error);
    }
  },
});

let last = performance.now();
function tick(now) {
  loop.advance((now - last) / 1000);
  last = now;
  frame++;
  const beat = { t: 'beat', frame };
  if (frame % 30 === 0) {
    beat.summary = summary();
    try {
      beat.state = state === null ? undefined : structuredClone(state);
    } catch {
      beat.stateProblem = 'the game state must be plain data (numbers, text, lists, objects) so it can be saved and rewound';
    }
  }
  postMessage(beat);
  schedule();
}
const schedule = () => (self.requestAnimationFrame ? self.requestAnimationFrame(tick) : setTimeout(() => tick(performance.now()), 16));

onmessage = (event) => {
  const m = event.data;
  if (m.t === 'init') {
    canvas = m.canvas;
    g = canvas.getContext('2d');
    base = m.base;
    state = m.state ?? null;                      // a state handed over from an earlier worker
    schedule();
  } else if (m.t === 'run') {
    load(m);
  } else if (m.t === 'key') {
    if (m.down) keys.add(m.code); else keys.delete(m.code);
  }
};
