// Draws a sample level with auto-tiling (and every shape of the picture the painter makes) in a real Chrome and saves it as a picture, so it can be looked at.
// Usage: node tools/autotile-sheet.js out.png
import { writeFileSync } from 'node:fs';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const out = process.argv[2] ?? 'autotile-sheet.png';
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
try {
  await withChromePage(`http://localhost:${server.address().port}/studio/index.html`, async (page) => {
    await page.waitFor('!!document.body', 10_000);
    await page.eval(`(async () => {
      const k = await import('/packages/arcade/src/index.js');
      document.documentElement.style.background = '#12161f';
      document.body.innerHTML = '';
      document.body.style.cssText = 'margin:0;background:#12161f;color:#ddd;font:12px sans-serif;padding:8px';
      const level = ['###########', '#.........#', '#..####...#', '#..####.#.#', '#.....#.#.#', '#.###.#.#.#', '#.#.....#.#', '#.#######.#', '#.........#', '###########'];
      const make = (mode, edge, width) => {
        const game = k.newGame();
        k.loadMap(game, level, { '#': { kind: 'wall', color: '#3b4a6b', autotile: mode, ...(edge ? { edge, edgeWidth: width } : {}) } }, 24);
        return game;
      };
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap';
      for (const [title, mode, edge, width] of [['blob47', 'blob47'], ['edges4', 'edges4'], ['blob47, bright thin edge', 'blob47', '#8b8bff', 2]]) {
        const box = document.createElement('div');
        const c = document.createElement('canvas');
        c.width = 11 * 24; c.height = 10 * 24;
        const g = c.getContext('2d');
        g.fillStyle = '#12161f'; g.fillRect(0, 0, c.width, c.height);
        k.drawThings(g, make(mode, edge, width), {});
        box.append(c, title);
        row.append(box);
      }
      document.body.append(row);
      const sheet = document.createElement('div');
      sheet.style.cssText = 'margin-top:10px;display:flex;flex-wrap:wrap;gap:4px;width:1100px';
      const base = { w: 16, h: 16, palette: { a: '#4ade80', b: '#25a35a' }, frames: [Array.from({ length: 16 }, (_, y) => 'a'.repeat(16).split('').map((ch, x) => ((x + y) % 7 === 0 ? 'b' : ch)).join(''))] };
      const sprite = k.makeAutotileSprite(base, 'blob47', { width: 2 });
      sprite.frames.forEach((frame, i) => {
        const c = document.createElement('canvas');
        c.width = 48; c.height = 48;
        const g = c.getContext('2d');
        g.fillStyle = '#4a5268'; g.fillRect(0, 0, 48, 48);
        frame.forEach((r, y) => [...r].forEach((ch, x) => { if (sprite.palette[ch]) { g.fillStyle = sprite.palette[ch]; g.fillRect(x * 3, y * 3, 3, 3); } }));
        sheet.append(c);
      });
      document.body.append(document.createTextNode('The 47 pictures made from one 16 by 16 grass tile:'), sheet);
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    writeFileSync(out, await page.screenshot());
  }, { width: 1150, height: 520 });
} finally { server.close(); }
