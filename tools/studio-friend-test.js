// Live check, in two real Chrome browsers, of "Play with a friend": the host makes an invitation, the friend answers, both browsers start the two-player Coin duel in
// their game workers and trade keys. Each player's keys must move the right square on BOTH computers, and the two games must never disagree.
// Usage: node tools/studio-friend-test.js
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://localhost:${port}/studio/index.html`;

/** Open the studio, start the duel game, show the panel. */
async function setup(page) {
  const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
  const P = (expr) => page.eval(`(() => { const p = document.querySelector('[aria-label="Play with a friend"]'); return p ? (${expr}) : null; })()`);
  await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000);
  await S('(s.createProject({ name: "Duel", template: "duel" }), 1)');
  await page.waitFor('window.studio.project?.name === "Duel"', 10_000);
  await S('(s.dock.show("friend"), s.dock.show("game"), 1)');
  await page.waitFor('window.studio.runner.status === "running"', 15_000);
  const click = (label) => P(`(() => { const b = [...p.querySelectorAll("button")].find((x) => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
  const type = (label, text) => P(`(() => { const t = p.querySelector('textarea[aria-label=${JSON.stringify(label)}]'); t.value = ${JSON.stringify(text)}; return 1; })()`);
  const code = () => P('p.querySelector("textarea[readonly]")?.value ?? ""');
  return { S, P, click, type, code };
}
const state = (A) => A.S('(s.runner.watch(true), JSON.stringify(s.runner.gameState?.state ?? null))').then(() => sleep(400)).then(() => A.S('JSON.stringify(s.runner.gameState?.state ?? null)')).then(JSON.parse);

try {
  await withChromePage(url, async (pageA) => withChromePage(url, async (pageB) => {
    const A = await setup(pageA), B = await setup(pageB);
    check('both studios start the duel alone first', (await A.S('s.runner.status')) === 'running' && (await B.S('s.runner.status')) === 'running');
    check('host makes an invitation', await A.click('Make an invitation') && await pageA.waitFor('!!document.querySelector("[aria-label=\\"Play with a friend\\"] textarea[readonly]")', 15_000));
    const invitation = await A.code();
    await B.type('Invitation code from the host', invitation);
    check('friend joins and gets an answer', await B.click('Join') && await pageB.waitFor('!!document.querySelector("[aria-label=\\"Play with a friend\\"] textarea[readonly]")', 15_000));
    await A.type('Answer code from your friend', await B.code());
    await A.click('Connect');
    check('both browsers connect and start the game', await pageA.waitFor('window.studio.runner.netState != null', 30_000)
      && await pageB.waitFor('window.studio.runner.netState != null', 30_000));
    // A holds right (player 1 = red), B holds left (player 2 = blue)
    await A.S('(s.runner.key("ArrowRight", true), 1)');
    await B.S('(s.runner.key("ArrowLeft", true), 1)');
    await sleep(1500);
    await A.S('(s.runner.key("ArrowRight", false), 1)');
    await B.S('(s.runner.key("ArrowLeft", false), 1)');
    await sleep(500);
    const a = await state(A), b = await state(B);
    check('on the host\'s screen red moved right and blue moved left', a?.players[0].x > 150 && a?.players[1].x < 330, JSON.stringify(a?.players));
    check('on the friend\'s screen too', b?.players[0].x > 150 && b?.players[1].x < 330, JSON.stringify(b?.players));
    check('neither side saw the games disagree', (await A.S('s.runner.netState?.desync')) === null && (await B.S('s.runner.netState?.desync')) === null);
    check('the host can stop and the friend\'s link closes', await A.click('Stop') && await pageB.waitFor('window.studio.runner.netState == null', 8000));
    const errs = [...pageA.errors, ...pageB.errors].filter((e) => !/willReadFrequently|favicon/.test(e));
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  }, { width: 1500, height: 900 }), { width: 1500, height: 900 });
} finally { server.close(); }
process.exit(failed ? 1 : 0);
