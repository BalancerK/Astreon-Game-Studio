// Minimal Chrome DevTools Protocol client (zero dependencies, uses Node's global WebSocket).
// Gives tests real key events, page evaluation and screenshots of a live page.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { guardBrowser } from './browser-guard.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBrowser } from './browser-test.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a page in headless Chrome and hand a controller to `fn`.
 * Controller: `eval(expr)`, `key(code, down|up)`, `type(text)`, `mouse(type, x, y, options)`, `touch(type, points)`, `screenshot()` -> PNG Buffer, `waitFor(expr, ms)`.
 *
 * @template T
 * @param {string} url
 * @param {(page: any) => Promise<T>} fn
 * @param {{width?: number, height?: number}} [o]
 * @returns {Promise<T>}
 */
export async function withChromePage(url, fn, { width = 1400, height = 800 } = {}) {
  const exe = findBrowser('chrome');
  if (!exe) throw new Error('Chrome not found');
  const profile = mkdtempSync(join(tmpdir(), 'engine-cdp-'));
  const proc = spawn(exe, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank',
  ], { stdio: 'ignore' });
  const guard = guardBrowser(proc, profile);                      // the browser never outlives this process, however it ends
  let ws;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 300 && !existsSync(portFile); i++) await sleep(100);                       // up to 30 s: a busy computer starts Chrome slowly
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (!target) await sleep(100);
    }
    if (!target) throw new Error('page target not found');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP connect failed')); });
    let id = 0;
    const pending = new Map();
    /** Uncaught exceptions and console.error output from the page, for diagnosing failures. */
    const errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      else if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) errors.push(`${m.params.entry.text}${m.params.entry.url ? ` (${m.params.entry.url})` : ''}`);
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url }); // after the listeners are attached, so load-time errors are captured

    const KEYS = { F3: [114, 'F3'], F5: [116, 'F5'], F9: [120, 'F9'], KeyD: [68, 'd'], KeyS: [83, 's'], KeyW: [87, 'w'], KeyA: [65, 'a'], ShiftLeft: [16, 'Shift'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Enter: [13, 'Enter'], Tab: [9, 'Tab'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], Space: [32, ' '], KeyJ: [74, 'j'], KeyZ: [90, 'z'] };
    const page = {
      errors, send,
      /** Change the size of the window (what a narrower screen would give). */
      setViewport(w, h) { return send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
      async eval(expression) {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
        return r.result.value;
      },
      /** A key press or release. `modifiers` holds the keys held with it: `{ ctrl, alt, shift, meta }`. Letters and digits (KeyK, Digit1) and F keys work without being listed. */
      async key(code, type = 'down', modifiers = {}) {
        let [vk, key] = KEYS[code] ?? [0, code];
        const letter = /^Key([A-Z])$/.exec(code), digit = /^Digit(\d)$/.exec(code), fkey = /^F(\d+)$/.exec(code);
        if (!KEYS[code] && letter) { vk = letter[1].charCodeAt(0); key = modifiers.shift ? letter[1] : letter[1].toLowerCase(); }
        else if (!KEYS[code] && digit) { vk = digit[1].charCodeAt(0); key = digit[1]; }
        else if (!KEYS[code] && fkey) { vk = 111 + Number(fkey[1]); key = code; }
        else if (code === 'Comma') { vk = 188; key = ','; }
        else if (code === 'Period') { vk = 190; key = '.'; }
        const mask = (modifiers.alt ? 1 : 0) | (modifiers.ctrl ? 2 : 0) | (modifiers.meta ? 4 : 0) | (modifiers.shift ? 8 : 0);
        await send('Input.dispatchKeyEvent', { type: type === 'down' ? 'rawKeyDown' : 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mask });
      },
      /** Typed text, as a soft keyboard or an IME would deliver it (goes to the focused field). */
      async type(text) { await send('Input.insertText', { text }); },
      /** A real mouse event: type is 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'. */
      async mouse(type, x, y, { button = 'left', clickCount = 1, deltaX = 0, deltaY = 0, buttons, modifiers = {} } = {}) {
        const bit = { left: 1, right: 2, middle: 4 }[button] ?? 0;
        // `buttons` is the set held down: the pressed one on a press, none on a release, and whatever you say (a drag) on a move
        await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? (buttons ? button : 'none') : button, buttons: buttons ?? (type === 'mousePressed' ? bit : 0), clickCount, deltaX, deltaY, modifiers: (modifiers.alt ? 1 : 0) | (modifiers.ctrl ? 2 : 0) | (modifiers.meta ? 4 : 0) | (modifiers.shift ? 8 : 0) });
      },
      /** A real touch event: type is 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel'; points are [x, y, id] (the ones that are down after the event). */
      async touch(type, points = []) {
        if (!page.touchEnabled) { await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); page.touchEnabled = true; }
        await send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
      },
      async waitFor(expression, ms = 10_000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (await page.eval(expression).catch(() => false)) return true; await sleep(100); }
        return false;
      },
      async screenshot() {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        return Buffer.from(r.data, 'base64');
      },
      sleep,
    };
    return await fn(page);
  } finally {
    try { ws?.close(); } catch { /* closing */ }
    guard.stop();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
}
