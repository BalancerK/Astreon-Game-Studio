// The Network lab: a tiny online game running over a pretend network that you control. Steer with the arrow keys, then make the network worse (lag, jitter, lost
// packets) and switch the engine's tricks on and off (prediction, easing, interpolation) to see why online games are built the way they are.
import { h, button, fill } from '../ui/dom.js';
import { NetLab, ARENA } from '../../netlab/lab.js';
import { drawGraph } from '../../../packages/debug/src/graph.js';

const SLIDERS = [
  ['latencyMs', 'Lag each way', 0, 400, 10, 'ms', 'How long a packet takes to cross. The round trip is twice this.'],
  ['jitterMs', 'Jitter', 0, 150, 5, 'ms', 'Extra random delay, so packets arrive unevenly and sometimes out of order.'],
  ['loss', 'Lost packets', 0, 40, 1, '%', 'How many packets never arrive at all.'],
];
const TRICKS = [
  ['prediction', 'Prediction', 'Move at once and guess what the server will say, instead of waiting for it.'],
  ['smoothing', 'Smooth corrections', 'When the guess was wrong, slide to the truth instead of jumping.'],
  ['interpolation', 'Interpolation', 'Draw the bot a little in the past, between two snapshots, so it moves smoothly.'],
];
const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1],
  KeyS: [0, 1] };

export function netlabPanel(studio) {
  return {
    id: 'netlab',
    title: 'Network lab',
    icon: 'play',
    create() {
      let lab = new NetLab();
      let running = false;
      let lastFrame = 0;
      let turnedPredictionOff = false;
      const held = new Set();
      const say = (name) => studio.emit('lab-event', name);

      const canvas = h('canvas', {
        class: 'lab-canvas', width: ARENA.w, height: ARENA.h, tabIndex: 0, role: 'application',
        aria: { label: 'The lab. Click here, then steer with the arrow keys or W A S D. G makes the server push you.' },
      });
      const graphs = h('canvas',
        { class: 'lab-graphs', width: ARENA.w, height: 150, aria: { label: 'Graphs of the guess error, the round trip and the lag' } });
      const readout = h('div', { class: 'lab-readout', role: 'status' });
      const packetList = h('div', { class: 'lab-packets', role: 'list', aria: { label: 'The latest packets' } });
      const explain = h('p', { class: 'lab-explain', role: 'status' });
      const controls = h('div', { class: 'lab-controls' });
      const bar = h('div', { class: 'toolbar art-bar' });
      const left = h('div', { class: 'lab-left' }, canvas, graphs);
      const right = h('div', { class: 'lab-right' }, controls, readout, explain, h('div', { class: 'art-label', text: 'Packets' }), packetList);
      const el = h('div', { class: 'panel-body art lab', 'aria-label': 'Network lab' }, bar, h('div', { class: 'lab-stage' }, left, right));

      function drawControls() {
        const s = lab.settings;
        fill(controls,
          ...SLIDERS.map(([key, text, min, max, step, unit, help]) => {
            const value = key === 'loss' ? Math.round(s.loss * 100) : s[key];
            const out = h('output', { text: `${value} ${unit}` });
            const input = h('input', {
              type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), aria: { label: text },
            });
            input.addEventListener('input', () => {
              const v = Number(input.value);
              out.textContent = `${v} ${unit}`;
              lab.set({ [key]: key === 'loss' ? v / 100 : v });
              if (key === 'latencyMs' && v >= 150) say('lab-lag');
              if (key === 'loss' && v >= 10) say('lab-loss');
              explain.textContent = help;
            });
            return h('label', { class: 'sound-slider' }, h('span', { text }), input, out);
          }),
          ...TRICKS.map(([key, text, help]) => h('label', { class: 'lab-trick' },
            h('input', {
              type: 'checkbox', checked: s[key], aria: { label: text },
              on: {
                change: (e) => {
                  lab.set({ [key]: e.target.checked });
                  explain.textContent = `${text}: ${help} ${e.target.checked ? '(on)' : '(off)'}`;
                  if (key === 'prediction') {
                    if (!e.target.checked) {
                      turnedPredictionOff = true;
                      say('lab-predict-off');
                    } else if (turnedPredictionOff) say('lab-predict-on');
                  }
                },
              },
            }), h('span', { text: ` ${text}` }), h('small', { text: help }))));
      }

      function drawBar() {
        fill(bar,
          button({
            text: running ? 'Pause' : 'Start the lab', icon: running ? 'stop' : 'play', class: `small${running ? '' : ' primary'}`,
            onClick: () => { running = !running; if (running) say('lab-start'); drawBar(); canvas.focus(); },
          }),
          button({ text: 'Push me (the server does)', class: 'small', title: 'The server moves you; your guess cannot know',
            onClick: () => { lab.gust(1, 0); say('lab-gust'); canvas.focus(); } }),
          button({ text: 'Start over', class: 'small ghost',
            onClick: () => { const settings = { ...lab.settings }; lab = new NetLab(settings); drawControls(); } }));
      }

      function drawWorld() {
        const g = canvas.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, ARENA.w, ARENA.h);
        const c = lab.client;
        const s = lab.server;
        const ring = (p, r, color, dashed) => {
          g.beginPath();
          g.setLineDash(dashed ? [4, 3] : []);
          g.strokeStyle = color;
          g.lineWidth = 2;
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        };
        ring(s.player, 11, 'rgba(255,255,255,.7)', true);                        // where the server really has you
        g.strokeStyle = 'rgba(255,210,60,.5)';
        g.beginPath(); g.moveTo(c.shown.x, c.shown.y); g.lineTo(s.player.x, s.player.y); g.stroke();
        g.fillStyle = '#5ac8ff';
        g.beginPath(); g.arc(c.shown.x, c.shown.y, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4ade80';
        g.beginPath(); g.arc(c.bot.x, c.bot.y, 8, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#9aa3b8';
        g.font = '12px system-ui';
        g.fillText('dashed ring: where the server has you   blue: what you see   green: the bot, as you see it', 8, ARENA.h - 8);
        if (!running) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, ARENA.w,
          ARENA.h); g.fillStyle = '#fff'; g.font = '18px system-ui'; g.textAlign = 'center'; g.fillText('Press "Start the lab"', ARENA.w / 2,
          ARENA.h / 2); g.textAlign = 'left'; }
      }

      function drawGraphs() {
        const g = graphs.getContext('2d');
        g.fillStyle = '#0f131b';
        g.fillRect(0, 0, graphs.width, graphs.height);
        const row = (series, y, color, text, max) => {
          const range = drawGraph(g, series, { x: 6, y, w: graphs.width - 12, h: 38 }, { color, max });
          g.fillStyle = '#9aa3b8'; g.font = '11px system-ui'; g.fillText(`${text} (up to ${Math.round(range.max)})`, 10, y + 11);
        };
        row(lab.errorSeries, 4, '#ff9f43', 'wrong guess when a snapshot arrives, px', null);
        row(lab.rttSeries, 56, '#7fd4ff', 'round trip, ms', null);
        row(lab.lagSeries, 108, '#c4a1ff', 'picture behind your input, px', null);
      }

      function drawReadout() {
        const r = lab.report();
        const n = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');
        fill(readout,
          h('div', { text: `Round trip ${n(r.rtt.avg)} ms` }), h('div', { text: `Wrong guesses ${r.mispredictions}` }),
          h('div', { text: `Lost: ${r.sent.lost} sent, ${r.received.lost} received` }),
          h('div', { text: `${r.bytesPerSecond.out} bytes/s up, ${r.bytesPerSecond.in} down` }));
      }

      const PACKET_HELP = {
        INPUT: 'INPUT: the keys you hold, sent every tick. 7 bytes: a type, a counter and two small numbers.',
        SNAPSHOT: 'SNAPSHOT: the server\'s truth, sent every tick. 25 bytes: a tick, the last input it used, and four positions. '
          + 'The counter lets you redo the inputs it has not seen yet.',
      };
      function drawPackets() {
        const entries = lab.packets.entries(9);
        fill(packetList, ...entries.map((e) => h('button', {
          type: 'button', class: `packet ${e.dir}`, role: 'listitem', title: PACKET_HELP[e.type],
          on: { click: () => { explain.textContent = PACKET_HELP[e.type]; say('lab-packets'); } },
        }, h('span', { text: e.dir === 'out' ? '→' : '←' }), h('span', { text: e.type }),
        h('span', { text: `${e.size} B` }), h('span', { text: e.detail }))));
      }

      // ---- the loop: only while the panel can be seen and the lab is started ----
      let slow = 0;
      function frame(now) {
        requestAnimationFrame(frame);
        if (el.offsetParent === null) { lastFrame = now; return; }
        const dt = Math.min(100, now - (lastFrame || now));
        lastFrame = now;
        if (running) {
          let dx = 0; let dy = 0;
          for (const code of held) { const k = KEYS[code]; if (k) { dx += k[0]; dy += k[1]; } }
          lab.steer(dx, dy);
          lab.advance(dt);
        }
        drawWorld();
        if (++slow % 6 === 0) { drawGraphs(); drawReadout(); drawPackets(); }
      }
      requestAnimationFrame(frame);

      canvas.addEventListener('keydown', (e) => {
        if (KEYS[e.code]) { held.add(e.code); e.preventDefault(); } else if (e.code === 'KeyG') { lab.gust(1,
          0); say('lab-gust'); e.preventDefault(); }
      });
      canvas.addEventListener('keyup', (e) => { held.delete(e.code); });
      canvas.addEventListener('blur', () => held.clear());

      drawBar();
      drawControls();
      drawGraphs();
      drawReadout();
      return { el, focus: () => canvas.focus(), expose: { get lab() { return lab; } } };
    },
  };
}
