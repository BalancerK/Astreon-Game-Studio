// The page a plugin runs in. It is loaded into a frame with `sandbox="allow-scripts"` (so the page has no origin of its own: no storage, no cookies, no way to
// touch the studio's page) and with a content security policy that forbids every network request, so a plugin can show things and ask the studio for things,
// but cannot send anything anywhere. Its only door is `parent.postMessage`, which the studio checks (protocol.js). This file holds that page and the small
// library (`studio`) the plugin's code is given.

// The library inside the frame. It is plain JavaScript in a string, so it must not contain a backtick or a dollar followed by a brace.
const SDK = String.raw`
(() => {
  const post = (m) => parent.postMessage({ v: 1, ...m }, '*');
  const pending = new Map();
  const listeners = new Map();
  const handlers = { command: new Map(), exporter: new Map(), importer: new Map() };
  let next = 1;
  let panelFn = null;
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    post({ t: 'call', id, method, args });
  });
  const root = document.getElementById('root');
  const studio = {
    root,
    files: {
      list: () => call('files.list'),
      read: (path) => call('files.read', path),
      write: (path, text) => call('files.write', path, text),
      remove: (path) => call('files.remove', path),
    },
    ui: { toast: (text, kind) => call('ui.toast', String(text), kind) },
    log: (level, text) => call('log', level, String(text)),
    state: { get: () => call('state.get'), set: (data) => call('state.set', data) },
    game: { summary: () => call('game.summary') },
    on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    panel: (fn) => { panelFn = fn; },
    command: (id, fn) => handlers.command.set(id, fn),
    exporter: (id, fn) => handlers.exporter.set(id, fn),
    importer: (id, fn) => handlers.importer.set(id, fn),
  };
  const fail = (message) => {
    root.textContent = 'This plugin stopped: ' + message;
    root.className = 'plugin-error';
    post({ t: 'failed', message });
  };
  addEventListener('error', (e) => fail(e.message));
  addEventListener('unhandledrejection', (e) => fail(String(e.reason && e.reason.message || e.reason)));
  addEventListener('message', async (event) => {
    if (event.source !== parent) return;
    const m = event.data;
    if (!m || m.v !== 1) return;
    if (m.t === 'init') {
      for (const [k, v] of Object.entries(m.theme || {})) document.documentElement.style.setProperty(k, String(v));
      try {
        const url = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
        const mod = await import(url);
        const activate = mod.default || mod.activate;
        if (typeof activate === 'function') await activate(studio);
        if (m.panel && panelFn) await panelFn(root);
        post({ t: 'ready' });
      } catch (e) { fail(String(e && e.message || e)); }
    } else if (m.t === 'reply') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    } else if (m.t === 'event') {
      for (const fn of listeners.get(m.name) || []) { try { fn(m.data); } catch (e) { post({ t: 'log', level: 'error', text: String(e && e.message || e) }); } }
    } else if (m.t === 'run') {
      const fn = handlers[m.kind] && handlers[m.kind].get(m.command);
      if (!fn) { post({ t: 'result', id: m.id, ok: false, error: 'This plugin did not set up "' + m.command + '".' }); return; }
      try { post({ t: 'result', id: m.id, ok: true, result: await fn(...(m.args || [])) }); } catch (e) { post({ t: 'result', id: m.id, ok: false, error: String(e && e.message || e) }); }
    }
  });
  post({ t: 'hello' });
})();
`;

const STYLE = `
:root { --bg: #12161f; --panel: #181d29; --panel2: #1d2330; --line: #2a3144; --fg: #dde2f0; --dim: #8e98b0; --accent: #8b8bff; --accent-fg: #0b0e15; --good: #4ade80; --warn: #fbbf24; --bad: #f87171; --code-bg: #0f131b; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: 13.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
#root { padding: 10px 12px; }
h1, h2, h3 { margin: 0 0 6px; } p { margin: 0 0 8px; } small, .dim { color: var(--dim); }
button { font: inherit; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel2); color: inherit; cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
input, select, textarea { font: inherit; padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--code-bg); color: inherit; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--line); } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
code, pre { font: 12.5px ui-monospace, Consolas, monospace; background: var(--code-bg); border-radius: 4px; } pre { padding: 8px; overflow: auto; }
.plugin-error { color: var(--bad); }
`;

/** The whole page, as text for a frame's `srcdoc`. */
export function sandboxDocument() {
  const csp = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head><body><div id="root"></div><script>${SDK.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

/** The colours of the studio's own look that a plugin panel is given, so it matches. */
export const THEME_VARIABLES = ['--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--accent', '--accent-fg', '--good', '--warn', '--bad', '--code-bg'];
