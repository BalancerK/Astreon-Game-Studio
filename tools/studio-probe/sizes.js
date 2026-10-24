// Screenshots of the studio at small window sizes (what a laptop split-screen or a tablet gives), to look for layout trouble. Usage: node tools/studio-probe/sizes.js outDir
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from '../static-server.js';
import { withChromePage } from '../cdp.js';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const root = decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, index: '/studio/index.html', allowDirs: ['packages', 'examples', 'studio'] });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
for (const [w, h] of [[1024, 700], [768, 1024], [390, 800]]) {
  await withChromePage(`http://localhost:${port}/studio/index.html`, async (page) => {
    await page.waitFor('window.studio', 15000);
    await page.sleep(500);
    writeFileSync(join(out, `hub-${w}.png`), await page.screenshot());
    await page.eval('(async () => { await studio.createProject({ name: "Size test", template: "hero" }); })()');
    await page.waitFor('window.studio.runner.status === "running"', 15000);
    await page.sleep(800);
    writeFileSync(join(out, `code-${w}.png`), await page.screenshot());
    await page.eval('studio.dock.show("game")'); await page.sleep(600);
    writeFileSync(join(out, `game-${w}.png`), await page.screenshot());
    const overflow = await page.eval('({ x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight })');
    console.log(`${w}x${h}: page overflows ${JSON.stringify(overflow)}`);
  }, { width: w, height: h });
}
server.close();
