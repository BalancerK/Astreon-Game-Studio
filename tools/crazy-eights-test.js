// Live check of the Crazy Eights tutorial game in a real browser, on both renderers: the page signs in as a guest, "Play against robots" finds a
// table, a whole game is played with real mouse clicks on the cards (an 8 asks for a suit, drawing and passing work), the game ends with the result
// on screen, and the account and the leaderboard remember it. Usage: node tools/crazy-eights-test.js [outDir]
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../examples/crazy-eights/server/server.js';
import { withChromePage } from './cdp.js';

const outDir = process.argv[2] ?? null;
if (outDir) mkdirSync(outDir, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let failed = false;
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };

for (const renderer of ['webgpu', 'webgl2']) {
  console.log(`--- ${renderer}`);
  const data = mkdtempSync(join(tmpdir(), 'ce-live-'));
  const server = await startServer({ root, port: 0, mode: 'inline', dataDir: data, tickMs: 50, roomOptions: { thinkMs: [60, 140], lingerMs: 120_000 } });
  try {
    await withChromePage(`${server.url}examples/crazy-eights/index.html?renderer=${renderer}`, async (page) => {
      const click = async (x, y) => { await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); };
      const clickEl = async (id) => { const r = JSON.parse(await page.eval(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`)); await click(r.x, r.y); };
      check('the menu opens with a guest account', await page.waitFor('document.getElementById("menu") && !document.getElementById("menu").hidden && /rating 1000/.test(document.getElementById("who").textContent)', 20_000), await page.eval('document.getElementById("who")?.textContent ?? ""'));
      check('and the leaderboard is empty', await page.eval('!document.getElementById("board-empty").hidden'));
      await clickEl('play-bots');
      check('"Play against robots" finds a table and the game starts', await page.waitFor('window.__client && window.__client.state === "playing" && window.__client.view', 20_000), String(await page.eval('window.__client?.state')));
      const info = JSON.parse(await page.eval('JSON.stringify({ players: window.__client.players.length, bots: window.__client.players.filter((p) => p.bot).length, hand: window.__client.view.hand.length })'));
      check('three robots and a hand of five', info.players === 4 && info.bots === 3 && info.hand === 5, JSON.stringify(info));
      await page.sleep(400);
      if (outDir) writeFileSync(join(outDir, `crazy-eights-${renderer}.png`), await page.screenshot());

      // play the whole game with real clicks
      let clicks = 0, suitsChosen = 0, draws = 0, passes = 0, refused = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 120_000) {
        const st = JSON.parse(await page.eval('JSON.stringify({ state: window.__client.state, myTurn: window.__client.myTurn, seq: window.__client.seq, L: window.__table.layout, legal: window.__client.legal.map((m) => m.move) })'));
        if (st.state === 'over') break;
        if (!st.myTurn) { await page.sleep(40); continue; }
        const L = st.L;
        const playable = L.hand.filter((h) => h.playable);
        if (L.suits) { const pick = L.suits[Math.floor(Math.random() * 4)]; await click(pick.x + pick.w / 2, pick.y + pick.h / 2); suitsChosen++; }
        else if (playable.length) {
          // prefer a card that is not an 8, so both kinds of play get used
          const h = playable.find((c) => c.card % 13 !== 7) ?? playable[0];
          await click(h.x + h.w * 0.5, h.y + h.h * 0.5);
        } else if (st.legal.includes('draw')) { await click(L.deck.x + L.deck.w / 2, L.deck.y + L.deck.h / 2); draws++; }
        else if (L.buttons.some((b) => b.id === 'pass')) { const b = L.buttons.find((x) => x.id === 'pass'); await click(b.x + b.w / 2, b.y + b.h / 2); passes++; }
        clicks++;
        // wait for the room to answer before looking again
        for (let i = 0; i < 100; i++) { await page.sleep(15); const now = JSON.parse(await page.eval('JSON.stringify({ seq: window.__client.seq, myTurn: window.__client.myTurn, pick: !!window.__table.layout.suits })')); if (now.seq !== st.seq || now.pick) break; if (i === 99) refused++; }
      }
      check('the game reaches its end', await page.eval('window.__client.state === "over"'), `${clicks} clicks, ${draws} draws, ${passes} passes, ${suitsChosen} suits chosen, ${refused} unanswered`);
      check('clicks were turned into moves (cards, draws)', clicks >= 4 && clicks - refused >= 4);
      const result = JSON.parse(await page.eval('JSON.stringify({ over: window.__client.over, hands: window.__client.view.hands ? Object.keys(window.__client.view.hands).length : 0 })'));
      check('a winner and everyone\'s hands are shown', result.over.winners.length === 1 && result.hands === 4);
      check('"Play again" and "Menu" are offered', await page.eval('!document.getElementById("after").hidden'));
      await page.sleep(300);
      if (outDir) writeFileSync(join(outDir, `crazy-eights-over-${renderer}.png`), await page.screenshot());
      await clickEl('leave');
      check('back at the menu the account shows the game and the leaderboard has the player', await page.waitFor('/1 games/.test(document.getElementById("who").textContent) && document.querySelectorAll("#board li").length === 1', 8000), await page.eval('document.getElementById("who").textContent'));
      check('no page errors', page.errors.filter((e) => !/willReadFrequently/.test(e)).length === 0, page.errors.slice(0, 2).join(' | '));
    });
  } catch (e) { failed = true; console.log('FAIL', e.stack ?? e.message); }
  finally { await server.close(); rmSync(data, { recursive: true, force: true }); }
}
process.exit(failed ? 1 : 0);
