// The studio spike: a project kept in the browser, a code editor, and a game running in a frame on another origin. It answers three questions:
//   1. can edits reach the running game in well under a second WITHOUT losing the game's state?
//   2. does a game stuck in an endless loop leave the studio responsive, and can the studio notice and recover?
//   3. do projects survive closing the tab?
import { createEditor } from './editor.js';
import { STARTER } from './starter.js';

const $ = (id) => document.getElementById(id);
const frame = $('frame');

// ---- the project store: IndexedDB, so a project survives closing the tab ----
const db = await new Promise((resolve, reject) => {
  const open = indexedDB.open('studio-spike', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'path' });
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
const tx = (mode) => db.transaction('files', mode).objectStore('files');
const all = () => new Promise((resolve) => { const r = tx('readonly').getAll(); r.onsuccess = () => resolve(r.result); });
const put = (path, text) => new Promise((resolve) => { const r = tx('readwrite').put({ path, text }); r.onsuccess = resolve; });

let files = Object.fromEntries((await all()).map((f) => [f.path, f.text]));
if (!Object.keys(files).length) {
  files = { ...STARTER };
  for (const [path, text] of Object.entries(files)) await put(path, text);
}

// ---- the editor and its tabs ----
let active = 'src/main.js';
const editor = createEditor($('editor'), { value: files[active], onChange: (text) => change(active, text) });
function showTabs() {
  $('tabs').replaceChildren(...Object.keys(files).sort().map((path) => {
    const b = document.createElement('button');
    b.textContent = path;
    b.className = path === active ? 'on' : '';
    b.onclick = () => openFile(path);
    return b;
  }));
}
function openFile(path) {
  active = path;
  editor.value = files[path];
  showTabs();
}
showTabs();

// ---- messages to the console panel ----
function say(kind, text, where) {
  const row = document.createElement('div');
  row.className = `row ${kind}`;
  row.append(text);
  if (where?.file) {
    row.append(' ');
    const link = document.createElement('a');
    link.textContent = `${where.file}:${where.line ?? 1}`;
    link.onclick = () => { openFile(where.file); editor.goto(where.line ?? 1, where.column ?? 1); };
    row.append(link);
  }
  $('console').prepend(row);
  while ($('console').children.length > 50) $('console').lastChild.remove();
}
function setStatus(kind, text) {
  $('status').className = kind;
  $('status').textContent = text;
}

// ---- running the project in the frame on the other origin ----
const runnerOrigin = new URLSearchParams(location.search).get('runner')
  ?? `${location.protocol}//${location.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${location.port}`;
let ready = false;
let runNumber = 0;
const sent = new Map();
const report = { summary: null, latencies: [], errors: [], stuck: 0, frames: 0, applied: 0, maxGap: 0 };

function loadFrame() {
  ready = false;
  frame.src = `${runnerOrigin}/studio/spike/runner.html?studio=${encodeURIComponent(location.origin)}`;
}
function send(restart, from = files) {
  if (!ready) return;
  runNumber++;
  sent.set(runNumber, { at: performance.now(), files: { ...from } });
  frame.contentWindow.postMessage({ t: 'run', run: runNumber, files: from, restart }, runnerOrigin);
}

addEventListener('message', (event) => {
  if (event.origin !== runnerOrigin || event.source !== frame.contentWindow) return;
  const m = event.data;
  if (m.t === 'ready') {
    ready = true;
    setStatus('running', 'running');
    send(true, files);
  } else if (m.t === 'beat') {
    report.frames = m.frame;
    if (m.stateProblem) say('warn', m.stateProblem);
    if (m.summary) showSummary(m.summary);
  } else if (m.t === 'applied') {
    const run = sent.get(m.run);
    const ms = Math.round(performance.now() - run.at);
    report.latencies.push(ms);
    report.applied++;
    setStatus('running', 'running');
    $('latency').textContent = `updated in ${ms} ms${m.restarted ? ' (restarted)' : ' (kept your place)'}`;
    if (m.summary) showSummary(m.summary);
  } else if (m.t === 'hang') {
    report.stuck++;
    setStatus('stuck', 'game not responding');
    say('err', 'The game stopped responding, probably a loop that never ends. It was stopped.');
  } else if (m.t === 'recovered') {
    report.recovered = (report.recovered ?? 0) + 1;
    report.recoveredFromSnapshot = m.fromSnapshot;
    setStatus('running', 'running');
    say('info', 'Running the last version that worked' + (m.fromSnapshot ? ', from where it was a moment ago.' : '.') + ' Your edit is still in the editor.');
  } else if (m.t === 'error') {
    report.errors.push(m);
    setStatus('error', 'fix the error');
    const what = m.kind === 'load' ? 'Could not load the code' : 'The game stopped';
    say('err', `${what}: ${m.message}${m.kind === 'load' ? ' (the game is still running the last version that worked)' : ''}`, m);
  }
});
function showSummary(s) {
  report.summary = s;
  $('summary').textContent = JSON.stringify(s);
}

// a change in the editor: save it, and run it a moment after typing stops
let saveTimer = 0;
let runTimer = 0;
function change(path, text) {
  files[path] = text;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => put(path, text), 300);
  clearTimeout(runTimer);
  runTimer = setTimeout(() => send(false), 120);
}

$('restart').onclick = () => send(true);

// how long the studio itself was ever frozen (the answer to question 2 is this staying small while a game hangs)
let tickAt = performance.now();
setInterval(() => {
  const now = performance.now();
  report.maxGap = Math.max(report.maxGap, now - tickAt - 50);
  tickAt = now;
}, 50);

loadFrame();
say('info', 'Edit the code: the game updates as you type and keeps its place.');

window.__studio = {
  report,
  get files() { return files; },
  get ready() { return ready; },
  runnerOrigin,
  editor,
  setFile(path, text) { if (path === active) editor.value = text; files[path] = text; change(path, text); },
  restart() { send(true); },
  resetGap() { report.maxGap = 0; },
};

// open index.html?selftest=1 to run a scripted check of everything above and POST the result to /report (used by tools/studio-spike-compat.js)
if (new URLSearchParams(location.search).has('selftest')) {
  const { selftest } = await import('./selftest.js');
  let result;
  try {
    result = await selftest(window.__studio);
  } catch (e) {
    result = { error: String(e?.stack ?? e) };
  }
  await fetch('/report', { method: 'POST', body: JSON.stringify(result) });
}
