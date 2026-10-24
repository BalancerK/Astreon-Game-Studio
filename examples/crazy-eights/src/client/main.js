// The page: sign in as a guest, pick how to play, find a table, and play it. The table itself is drawn by `table.js`; the rules are in `../rules.js`
// and run on the server: a click here only ever asks the server for a move.
import { createRenderer, Atlas, Font } from '../../../../packages/render/src/index.js';
import { TurnClient } from '../../../../packages/turns/src/index.js';
import { connectWebSocket } from '../../../../packages/transport/src/index.js';
import { Api } from './api.js';
import { Table, makeCardSprites } from './table.js';

const $ = (id) => document.getElementById(id);
const api = new Api();

// ---- the picture ----
const atlas = new Atlas({ size: 1024 });
const sprites = makeCardSprites(atlas);
const font = new Font(atlas, { family: 'system-ui, sans-serif', size: 20, weight: 'bold', scale: devicePixelRatio || 1 });
const wanted = new URLSearchParams(location.search).get('renderer');   // ?renderer=webgl2 to choose
const renderer = await createRenderer({ atlas, prefer: wanted ? [wanted] : undefined });
$('stage').append(renderer.canvas);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.resize(w, h, devicePixelRatio || 1);
  table?.resize(w, h);
}
let table = null, client = null;
addEventListener('resize', resize); resize();

// ---- menus ----
const show = (id, on = true) => { $(id).hidden = !on; };
function say(text, bad = false) { const el = $('message'); el.textContent = text; el.className = bad ? 'bad' : ''; }
async function refreshAccount() {
  const me = await api.me();
  $('who').textContent = `${me.name} · rating ${me.rating} · ${me.games} games, ${me.wins} won${me.rank ? ` · #${me.rank}` : ''}`;
  $('name').value = me.name;
  const lb = await api.leaderboard(8);
  $('board').replaceChildren(...lb.top.map((e) => {
    const li = document.createElement('li');
    li.textContent = `${e.name} — ${e.rating}`;
    if (e.id === api.account.playerId) li.className = 'me';
    return li;
  }));
  $('board-empty').hidden = lb.top.length > 0;
}

let ticket = null, polling = null;
async function queue(mode) {
  say('');
  try { ticket = await api.queue(mode); } catch (e) { say(e.message, true); return; }
  show('buttons', false); show('searching');
  const t0 = Date.now();
  polling = setInterval(async () => {
    try {
      const r = await api.ticket(ticket);
      $('search-text').textContent = r.status === 'waiting' ? `Looking for players… ${Math.round((Date.now() - t0) / 1000)} s` : r.status;
      if (r.status === 'matched') { stopSearch(); connect({ url: r.url, token: r.token }); }
      else if (r.status !== 'waiting') {
        stopSearch();
        say(r.status === 'expired' ? 'Nobody was found: try again, or play against robots.' : (r.error ?? r.status), true);
      }
    } catch (e) { stopSearch(); say(e.message, true); }
  }, 600);
}
function stopSearch() { clearInterval(polling); polling = null; show('searching', false); show('buttons'); }
$('cancel').onclick = async () => { if (ticket) await api.cancel(ticket).catch(() => {}); stopSearch(); };
$('play-bots').onclick = () => queue('solo');
$('play-online').onclick = () => queue('table');
$('private').onclick = async () => {
  try {
    const t = await api.createPrivate();
    say(`Table code: ${t.code} (friends type it under "Join")`);
    connect({ url: t.url, token: t.token }, `Share this code: ${t.code}`);
  } catch (e) {
    say(e.message, true);
  }
};
$('join').onclick = async () => {
  try {
    const t = await api.join($('code').value.trim());
    connect({ url: t.url, token: t.token });
  } catch (e) {
    say(e.message, true);
  }
};
$('name').onchange = async () => { try { await api.setName($('name').value); await refreshAccount(); } catch (e) { say(e.message, true); } };

// ---- a table ----
function connect(info, hint = '') {
  client?.close();
  client = new TurnClient({
    createTransport: () => connectWebSocket(`${api.wsUrl(info.url)}?t=${info.token}`),
    getToken: () => info.token,
    name: api.account.name,
  });
  table = new Table({ client, sprites, font });
  table.hint = hint;
  table.resize(innerWidth, innerHeight);
  show('menu', false); show('ingame');
  client.onChange = () => {
    const over = client.state === 'over';
    show('after', over); $('rematch').disabled = false; $('rematch').textContent = 'Play again';
    if (over) $('rematch').textContent = client.players.find((p) => p.id === client.you)?.rematch ? 'Waiting for the others…' : 'Play again';
    if (client.state === 'closed') leave(client.closeReason && !/left/.test(client.closeReason) ? client.closeReason : '');
  };
  client.start();
  window.__table = table; window.__client = client;
}
function leave(reason = '') {
  if (client) client.onChange = null; // closing it must not call back into here
  client?.close(); client = null; table = null;
  show('ingame', false); show('after', false); show('menu'); say(reason, !!reason);
  refreshAccount().catch(() => {});
}
$('rematch').onclick = () => { client?.rematch(); $('rematch').textContent = 'Waiting for the others…'; };
$('leave').onclick = () => leave('');
$('menu-button').onclick = () => leave('');

// ---- input and the loop ----
const canvas = renderer.canvas;
canvas.addEventListener('pointermove', (e) => { if (table) table.pointer = { x: e.offsetX, y: e.offsetY }; });
canvas.addEventListener('pointerleave', () => { if (table) table.pointer = { x: -1, y: -1 }; });
canvas.addEventListener('pointerdown', (e) => { if (table) table.click(e.offsetX, e.offsetY); });
function frame(now) {
  if (table) {
    const batch = table.draw(now);
    renderer.render({ camera: table.camera, batch, clear: [0.09, 0.3, 0.2, 1] });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- start ----
try {
  await api.signIn();
  await refreshAccount();
  show('menu');
} catch (e) { say(`Could not reach the server: ${e.message}`, true); show('menu'); }
window.__ce = { api, get client() { return client; }, get table() { return table; } };
