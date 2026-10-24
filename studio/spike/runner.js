// The runner: this page lives on a DIFFERENT origin from the studio, inside an iframe, so project code (yours, or a project somebody shared with you) can
// never touch the studio's own data. It stores the project's files where the service worker can serve them, checks them for mistakes, and runs the game in a
// Worker that it can kill if the game hangs.
const studioOrigin = new URLSearchParams(location.search).get('studio');
const stage = document.getElementById('stage');
const base = `${location.origin}/studio/spike/p/`;
const checkBase = `${location.origin}/studio/spike/c/`;
const post = (message) => parent.postMessage(message, studioOrigin);

let worker = null;
let lastBeat = performance.now();
let lastGood = null;       // { run, files } of the last version that ran for a while without hanging
let candidate = null;      // a version that has loaded but not yet proved itself: { run, files, since }
let snapshot = null;       // the last copy of the game's state that the worker sent
let frames = 0;

// ---- storing a project's files ----
/** Workers do not use the page's import map, so `@engine/x` becomes the engine file's own URL (on the same line, so line numbers stay true). */
function resolveImports(text) {
  return text.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])@engine\/([a-z0-9-]+)(\/[^'"]*)?\2/g,
    (_, lead, quote, pkg, rest) => `${lead}${quote}/packages/${pkg}${rest ?? '/src/index.js'}${quote}`);
}

/** Put a run's files in the cache: the real project under p/<run>/ and a copy that throws first, under c/<run>/, for checking syntax. */
async function store(run, files) {
  const cache = await caches.open('project');
  const put = (url, text) => cache.put(new Request(url), new Response(text, { headers: { 'content-type': 'text/javascript' } }));
  await Promise.all(Object.entries(files).flatMap(([path, text]) => {
    const source = resolveImports(text);
    return [put(`${base}${run}/${path}`, source), put(`${checkBase}${run}/${path}`, `throw 'parsed-ok';${source}`)];
  }));
  for (const request of await cache.keys()) {
    const n = Number(/\/[pc]\/(\d+)\//.exec(request.url)?.[1]);
    if (n < run - 1) await cache.delete(request);
  }
}

/**
 * Is every file of this run free of syntax errors? A module script reports the exact file, line and column of a syntax error (an import() or a worker does
 * not). The copies under c/ throw as their very first act, so after the whole project has been parsed nothing of it runs.
 * @returns {Promise<null | {message: string, file?: string, line?: number, column?: number}>} null if all is well
 */
function check(run) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${checkBase}${run}/src/main.js`;
    const finish = (result) => { removeEventListener('error', onError); script.remove(); resolve(result); };
    const onError = (e) => {
      if (String(e.message).includes('parsed-ok')) return finish(null);     // our own `throw`: the whole project parsed (browsers word it differently)
      const file = e.filename?.startsWith(checkBase) ? e.filename.replace(/^.*\/c\/\d+\//, '') : undefined;
      finish({ message: e.message.replace(/^Uncaught /, ''), file, line: e.lineno && file && e.lineno, column: e.colno });
    };
    addEventListener('error', onError);
    script.onerror = () => finish({ message: 'a file this project imports could not be found' });
    document.head.append(script);
    setTimeout(() => finish(null), 5000);
  });
}

// ---- the worker ----
function spawn(files, run, state) {
  worker?.terminate();
  stage.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 320;
  stage.append(canvas);
  const offscreen = canvas.transferControlToOffscreen();
  worker = new Worker('./worker-host.js', { type: 'module' });
  worker.onmessage = (event) => {
    const m = event.data;
    if (m.t === 'beat') {
      lastBeat = performance.now();
      frames = m.frame;
      if (m.state !== undefined) snapshot = m.state;
      if (candidate && m.frame - candidate.since >= 45) { lastGood = candidate; candidate = null; }      // it survived most of a second
      post({ t: 'beat', frame: m.frame, summary: m.summary, stateProblem: m.stateProblem });
    } else {
      if (m.t === 'applied') candidate = { run: m.run, files, since: frames };
      post(m);
    }
  };
  worker.onerror = (e) => post({ t: 'error', kind: 'worker', message: e.message || 'the game crashed' });
  lastBeat = performance.now();
  worker.postMessage({ t: 'init', canvas: offscreen, base, state }, [offscreen]);
  if (run) worker.postMessage({ t: 'run', run, restart: state === null });
}

let current = null;
async function run({ run: number, files, restart }) {
  await store(number, files);
  const problem = await check(number);
  if (problem) {
    post({ t: 'error', kind: 'load', ...problem });       // the game keeps running the last version that loaded
    return;
  }
  current = { run: number, files };
  if (!worker) spawn(files, number, null);
  else worker.postMessage({ t: 'run', run: number, restart });
}

// ---- the watchdog: a worker that stops sending beats is stuck; kill it and carry on from its last snapshot ----
setInterval(() => {
  if (!worker || document.visibilityState !== 'visible') { lastBeat = performance.now(); return; }
  if (performance.now() - lastBeat < 1500) return;
  post({ t: 'hang' });
  candidate = null;                                       // whatever was running did not survive
  const go = lastGood;
  spawn(go?.files, go?.run, snapshot);
  if (go) post({ t: 'recovered', run: go.run, fromSnapshot: snapshot !== null });
  lastBeat = performance.now();
}, 250);

addEventListener('message', (event) => {
  if (event.source !== parent || event.origin !== studioOrigin) return;
  const m = event.data;
  if (m?.t === 'run') run(m);
  else if (m?.t === 'key') worker?.postMessage(m);
});
for (const type of ['keydown', 'keyup']) addEventListener(type, (e) => worker?.postMessage({ t: 'key', down: type === 'keydown', code: e.code }));

await navigator.serviceWorker.register('./sw.js', { scope: './' });
await navigator.serviceWorker.ready;
if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
post({ t: 'ready', serviceWorker: true });
void frames;
