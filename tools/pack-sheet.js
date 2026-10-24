// Draws a contact sheet of the free pack's sprites (every frame, enlarged) in a real Chrome and saves it as a picture, so they can be looked at. Usage: node tools/pack-sheet.js out.png
import { writeFileSync } from 'node:fs';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const out = process.argv[2] ?? 'pack-sheet.png';
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
try {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    await page.waitFor('!!document.body', 10_000);
    await page.eval(`(async () => {
      const { SPRITES } = await import('/studio/app/pack/sprites.js');
      document.body.innerHTML = '';
      document.documentElement.style.cssText = 'background:#2a2f3d;height:100%';
      document.body.style.cssText = 'margin:0;background:#2a2f3d;height:100%;overflow:hidden';
      const scale = 4;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px;padding:8px;background:#2a2f3d';
      for (const item of SPRITES) {
        const s = item.make();
        const card = document.createElement('div');
        card.style.cssText = 'color:#ddd;font:11px sans-serif;text-align:center';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:2px';
        for (const frame of s.frames) {
          const c = document.createElement('canvas');
          c.width = s.w * scale; c.height = s.h * scale;
          c.style.cssText = 'background:#4a5268';
          const g = c.getContext('2d');
          frame.forEach((r, y) => [...r].forEach((ch, x) => { if (s.palette[ch]) { g.fillStyle = s.palette[ch]; g.fillRect(x * scale, y * scale, scale, scale); } }));
          row.append(c);
        }
        card.append(row, item.name);
        wrap.append(card);
      }
      document.body.append(wrap);
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(out, await page.screenshot());
  }, { width: 1420, height: 1100 });
} finally { server.close(); }
