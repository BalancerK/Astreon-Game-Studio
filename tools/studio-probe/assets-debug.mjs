// Scratch: drop a picture and a sound into a project and see what the game's page does. Usage: node tools/studio-probe/assets-debug.mjs
import { createStaticServer } from '../static-server.js';
import { withChromePage } from '../cdp.js';

const root = decodeURIComponent(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, index: '/studio/index.html', allowDirs: ['packages', 'examples', 'studio'] });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await withChromePage(`http://localhost:${server.address().port}/studio/index.html`, async (page) => {
  await page.waitFor('window.studio', 15000);
  await page.eval('(async () => { await studio.createProject({ name: "dbg", template: "hero" }); })()');
  await page.waitFor('window.studio.runner.status === "running"', 15000);
  await page.eval(`(async () => {
    const wav = new Uint8Array(44 + 800); const dv = new DataView(wav.buffer);
    [...'RIFF'].forEach((ch, i) => { wav[i] = ch.charCodeAt(0); }); dv.setUint32(4, 36 + 800, true);
    [...'WAVEfmt '].forEach((ch, i) => { wav[8 + i] = ch.charCodeAt(0); }); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    [...'data'].forEach((ch, i) => { wav[36 + i] = ch.charCodeAt(0); }); dv.setUint32(40, 800, true); wav.fill(128, 44);
    studio.project.write('assets/boom.wav', wav);
    studio.project.write('src/main.js', studio.project.readText('src/main.js')
      .replace("'@': { kind: 'hero',", "'@': { kind: 'hero', image: 'assets/boom.png',")
      .replace("export function create() {", "sounds({ boom: { file: 'assets/boom.wav' } });\\nexport function create() {")
      .replace("} from '@engine/arcade';", "  sounds, play,\\n} from '@engine/arcade';")
      .replace("  const hero = first(game, 'hero');", "  const hero = first(game, 'hero');\\n  if (keys.has('KeyB') && !game.played) { game.played = true; play('boom'); }"));
  })()`);
  await page.sleep(1000);
  await page.eval('studio.run({ restart: true })');
  await page.sleep(2500);
  console.log('status', await page.eval('studio.runner.status'), 'diag', await page.eval('JSON.stringify([...studio.diagnostics.values()])'));
  await page.eval('studio.runner.key("KeyB", true)'); await page.sleep(800);
  console.log('sounds', await page.eval('studio.runner.stats.sounds'));
  await page.eval('studio.runner.watch(true)'); await page.sleep(800);
  console.log('hero', await page.eval('JSON.stringify(studio.runner.gameState?.state?.things?.find((t) => t.kind === "hero"))'));
  console.log('console', await page.eval('JSON.stringify((studio.consoleLines ?? studio.console?.lines ?? []).slice(-8))'));
  console.log('errors', page.errors.slice(0, 5));
});
server.close();
