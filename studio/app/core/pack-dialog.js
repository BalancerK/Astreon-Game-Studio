// The free pack window: look through the pictures, sounds and songs that come with the studio, listen to the sounds and music, watch the pictures move, and put the ones
// you like into your project with one click. What is in the pack, how to search it and how an item is put in are in ../pack/pack.js.
import { h, button, fill } from '../ui/dom.js';
import { showDialog } from '../ui/dialog.js';
import { KINDS, PACK_LICENSE, categoriesOf, dataOf, installItem, searchPack } from '../pack/pack.js';
import { toKit } from '../paint/music-model.js';

const SCALE = 4;

/** Draw one frame of a sprite on a canvas, enlarged. */
function paint(canvas, sprite, frame) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  sprite.frames[frame % sprite.frames.length].forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = sprite.palette[ch];
      if (color) { g.fillStyle = color; g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE); }
    });
  });
}

/**
 * Open the window. Resolves when it is closed.
 * @param {import('./studio.js').Studio} studio
 * @param {{kind?: 'sprite' | 'sound' | 'song', query?: string}} [o] which tab to start on, and what to search for
 */
export function openPackDialog(studio, { kind = 'sprite', query = '' } = {}) {
  let tab = kind;
  let category = '';
  let text = query;
  let ctx = null;
  let synth = null;
  let playing = null;                                                    // { id, source } while a sound or a song is playing
  const added = new Map();                                                // id -> the name it was given in the project
  const frames = [];                                                      // pictures that move: { canvas, sprite }
  let tick = 0;
  const timer = setInterval(() => { tick++; for (const f of frames) paint(f.canvas, f.sprite, tick); }, 330);

  const tabs = h('div', { class: 'pack-tabs', role: 'tablist' });
  const search = h('input', {
    type: 'search', class: 'pack-search', placeholder: 'Search: gem, spooky, jump…', value: text, spellcheck: false,
    'aria-label': 'Search the free pack',
  });
  const cats = h('select', { class: 'art-select', 'aria-label': 'Group' });
  const grid = h('div', { class: 'pack-grid', role: 'list' });
  const status = h('div', { class: 'pack-status', role: 'status' });
  const body = h('div', { class: 'pack-dialog' }, tabs, h('div', { class: 'pack-bar' }, search, cats), grid, status,
    h('p', { class: 'dim pack-licence', text: `Everything here is ${PACK_LICENSE}` }));

  async function ready() {
    synth ??= await import(`${studio.engineRoot ?? '/packages'}/audio/src/synth.js`);
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }
  function stop() { try { playing?.source.stop(); } catch { /* it had ended */ } playing = null; }
  async function play(item) {
    if (playing?.id === item.id) { stop(); draw(); return; }
    stop();
    try {
      await ready();
      const data = dataOf(item.id);
      const pcm = item.kind === 'sound'
        ? synth.synthesize(data)
        : synth.sequence({ bpm: toKit(data).bpm, tracks: toKit(data).tracks.map((t) => ({ ...t, notes: t.notes })) });
      const buffer = ctx.createBuffer(1, pcm.data.length, pcm.sampleRate);
      buffer.copyToChannel(pcm.data, 0);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = item.kind === 'sound' ? 0.8 : 0.6;
      source.buffer = buffer;
      source.loop = item.kind === 'song';
      source.connect(gain).connect(ctx.destination);
      source.onended = () => { if (playing?.source === source) { playing = null; draw(); } };
      source.start();
      playing = { id: item.id, source };
      draw();
    } catch (error) {
      studio.toasts.show(`Could not play that: ${error.message}`, { kind: 'error' });
    }
  }
  function add(item) {
    try {
      const out = installItem(studio.project, item.id);
      studio.project.write(out.path, out.text);
      studio.emit('files');
      added.set(item.id, out.name);
      studio.toasts.show(`Added "${out.name}" to your project. Use it with ${out.how}`, { kind: 'info', ms: 7000 });
      studio.log?.('system', `Added "${out.name}" from the free pack (${out.path}).`);
      draw();
    } catch (error) {
      studio.toasts.show(`Could not add that: ${error.message}`, { kind: 'error' });
    }
  }
  function card(item) {
    const done = added.get(item.id);
    const thumb = item.kind === 'sprite' ? (() => {
      const sprite = dataOf(item.id);
      const canvas = h('canvas', { class: 'pack-thumb', width: sprite.w * SCALE, height: sprite.h * SCALE, role: 'img', 'aria-label': item.title });
      paint(canvas, sprite, 0);
      if (sprite.frames.length > 1) frames.push({ canvas, sprite });
      return canvas;
    })() : button({
      text: playing?.id === item.id ? '■' : '▶', class: 'pack-play', onClick: () => play(item),
      'aria-label': `${playing?.id === item.id ? 'Stop' : 'Play'} ${item.title}`,
    });
    return h('div', { class: 'pack-card', role: 'listitem' }, thumb,
      h('div', { class: 'pack-title', text: item.title }), h('div', { class: 'pack-cat dim', text: item.category }),
      button({
        text: done ? `Added (${done}) · again` : 'Add to my project', class: `small${done ? ' ghost' : ' primary'}`,
        'aria-label': `Add ${item.title} to my project`, onClick: () => add(item),
      }));
  }
  function draw() {
    tabs.replaceChildren(...Object.entries(KINDS).map(([k, label]) => h('button', {
      type: 'button', class: `btn small${tab === k ? ' on' : ''}`, role: 'tab', 'aria-selected': String(tab === k),
      text: `${label} (${searchPack('', { kind: k }).length})`,
      onclick: () => { tab = k; category = ''; stop(); draw(); },
    })));
    const groups = categoriesOf(tab);
    fill(cats, h('option', { value: '', text: 'Everything' }), ...groups.map((c) => h('option', { value: c, text: c, selected: c === category })));
    cats.value = category;
    frames.length = 0;
    const list = searchPack(text, { kind: tab, category: category || null });
    fill(grid, ...list.map(card));
    const what = KINDS[tab].toLowerCase();
    status.textContent = list.length ? `${list.length} ${what}${text ? ` for "${text}"` : ''}` : `Nothing matches "${text}". Try a shorter word.`;
  }
  search.addEventListener('input', () => { text = search.value; draw(); });
  cats.addEventListener('change', () => { category = cats.value; draw(); });
  draw();
  const done = showDialog({
    title: 'Free pictures, sounds and music', body, buttons: [{ label: 'Done', value: true, primary: true }], initialFocus: () => search,
  })
    .finally(() => { clearInterval(timer); stop(); ctx?.close?.().catch(() => {}); });
  return done;
}
