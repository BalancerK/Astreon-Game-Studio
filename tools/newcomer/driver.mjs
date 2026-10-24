// A pretend person at the studio: starts the studio in a real Chrome and answers simple requests over HTTP on this machine (what is on the screen, click this,
// type that, press a key). It lets someone (or an agent) use the studio the way a beginner would, through what can be seen and clicked, and nothing else.
// Usage: node tools/newcomer/driver.mjs <outDir>      it writes <outDir>/port.txt when ready; POST /quit stops it.
//   GET  /screen                 what is visible: guide text, buttons, dialog, console, game numbers, open file; also saves a screenshot and gives its path
//   POST /click   {text}         click the button, tab, menu item or card whose words are these (a real mouse click)
//   POST /clickAt {x, y}         click a spot on the screen
//   POST /select  {find}         select this text in the code editor (like double-clicking a word): the next /type replaces it
//   POST /type    {text}         type into whatever has the keyboard
//   POST /key     {code}         press a key: Enter, Escape, Backspace, ArrowRight ... (hold a game key with /hold)
//   POST /hold    {code, ms}     hold a game key down for a while
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from '../static-server.js';
import { withChromePage } from '../cdp.js';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const root = decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, index: '/studio/index.html', allowDirs: ['packages', 'examples', 'studio'] });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const studioPort = server.address().port;

let shots = 0;
await withChromePage(`http://localhost:${studioPort}/studio/index.html`, async (page) => {
  await page.waitFor('window.studio', 20000);
  await page.sleep(500);

  const visibleText = `
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden]'); };
    const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();`;

  const screen = async () => {
    const info = JSON.parse(await page.eval(`(() => { ${visibleText}
      const s = window.studio;
      const buttons = [...document.querySelectorAll('button, [role=tab], [role=menuitem], .card, a[href], [role=option], summary')].filter(vis).map(labelOf).filter(Boolean);
      const dialog = document.querySelector('.dialog');
      const learn = document.querySelector('.learn');
      const editor = document.querySelector('.editor-host textarea');
      const lines = editor && vis(editor) ? editor.value.split('\\n').map((l, i) => (i + 1) + '  ' + l).slice(0, 90).join('\\n') : null;
      return JSON.stringify({
        hub: !!(document.querySelector('.hub') && vis(document.querySelector('.hub'))),
        guide: learn && vis(learn) ? learn.innerText : null,
        dialog: dialog && vis(dialog) ? dialog.innerText : null,
        toasts: [...document.querySelectorAll('.toasts .toast')].map((t) => t.innerText),
        buttons: [...new Set(buttons)].slice(0, 70),
        game: { status: s.runner.status, numbers: s.runner.summary ?? null },
        console: s.entries.slice(-6).map((e) => e.level + ': ' + e.text),
        openFile: s.activeFile, project: s.project?.name ?? null, code: lines,
        problems: [...s.diagnostics.entries()].map(([f, d]) => f + ': ' + d[0]?.message).slice(0, 3),
      });
    })()`));
    shots++;
    const file = join(out, `screen-${String(shots).padStart(3, '0')}.png`);
    writeFileSync(file, await page.screenshot());
    return { ...info, screenshot: file };
  };

  const clickPoint = async (x, y) => {
    await page.mouse('mouseMoved', x, y);
    await page.mouse('mousePressed', x, y);
    await page.mouse('mouseReleased', x, y);
    await page.sleep(350);
  };

  const find = (text) => page.eval(`(() => { ${visibleText}
    const want = ${JSON.stringify(text)}.toLowerCase();
    const all = [...document.querySelectorAll('button, [role=tab], [role=menuitem], .card, a[href], [role=option], summary, .row, label')].filter(vis);
    const exact = all.filter((el) => labelOf(el).toLowerCase() === want);
    const part = all.filter((el) => labelOf(el).toLowerCase().includes(want));
    const pick = exact[0] ?? part[0];
    if (!pick) return JSON.stringify({ found: false });
    pick.scrollIntoView({ block: 'nearest' });
    const r = pick.getBoundingClientRect();
    return JSON.stringify({ found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, label: labelOf(pick).slice(0, 60), matches: exact.length || part.length });
  })()`).then(JSON.parse);

  const handlers = {
    async '/screen'() { return screen(); },
    async '/click'({ text }) {
      const hit = await find(text);
      if (!hit.found) return { ok: false, error: `nothing on the screen says "${text}"` };
      await clickPoint(hit.x, hit.y);
      return { ok: true, clicked: hit.label, matches: hit.matches };
    },
    async '/clickAt'({ x, y }) { await clickPoint(Number(x), Number(y)); return { ok: true }; },
    async '/select'({ find: needle }) {
      const done = await page.eval(`(() => {
        const t = document.querySelector('.editor-host textarea');
        if (!t) return false;
        const i = t.value.indexOf(${JSON.stringify(needle)});
        if (i < 0) return false;
        t.focus();
        t.setSelectionRange(i, i + ${JSON.stringify(needle)}.length);
        return true;
      })()`);
      return done ? { ok: true } : { ok: false, error: 'that text is not in the open file' };
    },
    async '/type'({ text }) { await page.type(String(text)); await page.sleep(400); return { ok: true }; },
    async '/key'({ code }) { await page.key(String(code), 'down'); await page.key(String(code), 'up'); await page.sleep(300); return { ok: true }; },
    async '/hold'({ code, ms }) {
      await page.eval(`window.studio.runner.key(${JSON.stringify(String(code))}, true)`);
      await page.sleep(Math.min(5000, Number(ms) || 500));
      await page.eval(`window.studio.runner.key(${JSON.stringify(String(code))}, false)`);
      return { ok: true };
    },
  };

  let stop;
  const stopped = new Promise((r) => { stop = r; });
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const path = new URL(req.url, 'http://x').pathname;
      let body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { /* no body */ }
      if (path === '/quit') { res.end('{"ok":true}'); stop(); return; }
      const handler = handlers[path];
      if (!handler) { res.writeHead(404).end('{"error":"unknown request"}'); return; }
      try {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await handler(body), null, 1));
      } catch (error) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(error.message ?? error) }));
      }
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  writeFileSync(join(out, 'port.txt'), String(api.address().port));
  console.log(`READY http://127.0.0.1:${api.address().port}`);
  await stopped;
  api.close();
}, { width: 1400, height: 800 });
server.close();
process.exit(0);
