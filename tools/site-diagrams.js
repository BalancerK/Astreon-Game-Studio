// Diagrams for the guides, drawn as inline SVG (they follow the light and dark theme). A guide includes one with a line `{{diagram:name}}`.
// The layers diagram is generated from the same list the package pages use, so it cannot drift from the code.
import { escapeHtml as e } from './site-md.js';

const fig = (w, h, body, caption, label) => `<figure class="diagram"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${e(label)}"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrow-fill"/></marker></defs>${body}</svg><figcaption>${caption}</figcaption></figure>`;
const box = (x, y, w, h, cls = '') => `<rect class="box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>`;
const text = (x, y, t, cls = '', anchor = 'middle') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${e(t)}</text>`;
const arrow = (d) => `<path class="arrow" d="${d}" marker-end="url(#ah)"/>`;

const CHIP_CLASS = { foundation: 'hi', simulation: '', presentation: '', content: '', multiplayer: 'srv' };

/** @param {{id: string, title: string, blurb: string, packages: string[]}[]} layers */
export function layersDiagram(layers) {
  const bandH = 66, gap = 10, left = 150, width = 780, order = [...layers].reverse();       // the foundation at the bottom
  let body = '';
  order.forEach((l, i) => {
    const y = 8 + i * (bandH + gap);
    body += box(6, y, width - 12, bandH, '') + text(20, y + 28, l.title, 'big', 'start') + text(20, y + 48, `${l.packages.length} packages`, 'dim', 'start');
    let x = left;
    for (const n of l.packages) {
      const w = Math.round(n.length * 7.6 + 22);
      body += `<a href="../packages/${n}.html">${box(x, y + 17, w, 32, CHIP_CLASS[l.id] || 'good')}${text(x + w / 2, y + 38, n)}</a>`;
      x += w + 8;
    }
  });
  const h = 8 + order.length * (bandH + gap);
  return fig(width, h, body, 'Five layers. A package may import only packages it is allowed to (and mostly only ones below it); a script checks this on every test run.', 'The five layers of the engine and the packages in each');
}

export function frameDiagram() {
  const body = [
    box(10, 40, 150, 70, ''), text(85, 70, 'Real time'), text(85, 92, 'elapsed since last frame', 'dim'),
    arrow('M160 75 H200'),
    box(200, 40, 150, 70, 'hi'), text(275, 70, 'Accumulator'), text(275, 92, 'collects the time', 'dim'),
    arrow('M350 75 H390'),
    box(390, 12, 170, 62, 'good'), text(475, 40, 'update(dt)'), text(475, 60, 'once per 1/60 s, repeated', 'dim'),
    box(390, 86, 170, 62, 'srv'), text(475, 114, 'render(alpha)'), text(475, 134, 'once per frame', 'dim'),
    arrow('M350 75 C372 75 372 43 390 43'), arrow('M350 75 C372 75 372 117 390 117'),
    text(640, 40, 'the rules:', 'dim', 'start'), text(640, 58, 'same step every time', 'dim', 'start'), text(640, 112, 'the picture:', 'dim', 'start'), text(640, 130, 'blend two states', 'dim', 'start'),
    `<path class="line" d="M560 43 H632" stroke-dasharray="4 4"/><path class="line" d="M560 117 H632" stroke-dasharray="4 4"/>`,
  ].join('');
  return fig(780, 160, body, 'The game never advances by a variable amount. Slow frames run several fixed updates; fast frames run none and just draw. <code>FixedLoop</code> is about twenty lines.', 'Fixed timestep loop: elapsed time goes into an accumulator, updates run at a fixed rate, rendering blends between updates');
}

export function netDiagram() {
  const cx = 150, sx = 630, top = 64, bottom = 380;
  let b = box(60, 8, 180, 40, 'hi') + text(cx, 33, 'Client (browser)', 'big') + box(540, 8, 180, 40, 'srv') + text(sx, 33, 'Server (Node)', 'big');
  b += `<path class="line" d="M${cx} ${top - 14} V${bottom}"/><path class="line" d="M${sx} ${top - 14} V${bottom}"/>`;
  const msg = (y1, y2, label, sub, right = true) => `${arrow(right ? `M${cx + 6} ${y1} L${sx - 8} ${y2}` : `M${sx - 6} ${y1} L${cx + 8} ${y2}`)}${text(390, (y1 + y2) / 2 - 7, label, '', 'middle')}${text(390, (y1 + y2) / 2 + 9, sub, 'dim', 'middle')}`;
  b += text(cx - 100, 96, '1. read input', 'dim', 'start') + text(cx - 100, 114, '2. move right now (predict)', 'dim', 'start');
  b += msg(120, 150, 'INPUT #41, #42', 'buttons and aim, plus the last snapshot I saw');
  b += text(sx + 16, 170, 'apply inputs in order,', 'dim', 'start') + text(sx + 16, 188, 'one step per tick', 'dim', 'start');
  b += msg(214, 254, 'SNAPSHOT (delta)', 'only what changed since the one you acked', false);
  b += text(cx - 100, 276, '3. server says I was here:', 'dim', 'start') + text(cx - 100, 294, '   replay inputs #43… on top', 'dim', 'start');
  b += text(cx - 100, 322, '4. other players: draw them', 'dim', 'start') + text(cx - 100, 340, '   slightly in the past, blended', 'dim', 'start');
  b += text(sx + 16, 270, 'the server decides what', 'dim', 'start') + text(sx + 16, 288, 'is true, and checks it', 'dim', 'start');
  return fig(780, 396, b, 'The loop of a real-time game. The client never waits for the server to feel responsive, and the server never believes the client about the outcome.', 'Sequence between client and server: inputs go up, delta snapshots come down');
}

export function deltaDiagram() {
  const row = (y, label, cells) => text(10, y + 22, label, 'dim', 'start') + cells.map(([v, cls], i) => `${box(150 + i * 92, y, 84, 34, cls)}${text(192 + i * 92, y + 22, v)}`).join('');
  const body = row(8, 'Last acked state', [['x=100', ''], ['y=40', ''], ['hp=90', ''], ['x=300', ''], ['y=12', '']])
    + row(60, 'State now', [['x=104', 'hi'], ['y=40', ''], ['hp=90', ''], ['x=300', ''], ['y=15', 'hi']])
    + arrow('M390 100 V128') + row(138, 'What is sent', [['x+4', 'good'], ['—', ''], ['—', ''], ['—', ''], ['y+3', 'good']]);
  return fig(780, 186, body, 'A delta snapshot sends only the fields that changed against a state the client has confirmed. If the client has lost its baseline, it asks for a full snapshot.', 'Delta snapshot: only changed fields are sent');
}

export const DIAGRAMS = { layers: (ctx) => layersDiagram(ctx.layers), frame: frameDiagram, net: netDiagram, delta: deltaDiagram };
