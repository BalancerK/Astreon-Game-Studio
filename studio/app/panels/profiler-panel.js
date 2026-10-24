// The Profiler panel: what every picture of the game costs. While it is open and recording, the game's frame measures each frame (its update, its drawing, the
// rest, the draw calls, the things, and any section you wrap in the kit's `timed('name', fn)`) and sends the numbers here. A chart shows the last fifteen seconds
// with the budget as a line; click a frame (or use the arrow keys) to see it and to take the Time Machine to that moment. The reading is in profile/profile-model.js.
import { h, button, fill } from '../ui/dom.js';
import * as P from '../profile/profile-model.js';
import { download } from '../ui/hub.js';

const COLORS = { update: '#5ac8ff', render: '#ff9f43', other: '#8e98b0', over: '#f87171' };
const BAR = 3;                                          // pixels a frame is wide in the chart
const HEIGHT = 150;

export function profilerPanel(studio) {
  return {
    id: 'profiler',
    title: 'Profiler',
    icon: 'history',
    create() {
      const buffer = new P.FrameBuffer();
      let recording = true;
      let frozen = false;
      let budget = P.BUDGETS[0].ms;
      let selected = null;                 // a frame number
      let pending = 0;
      let base = null;                     // a saved reading to compare with: the summary of an earlier recording

      const canvas = h('canvas', {
        class: 'art-canvas prof-chart', tabIndex: 0, role: 'application', height: HEIGHT,
        aria: { label: 'Frame times. Left and right arrows choose a frame, Enter takes the Time Machine to it.' },
      });
      canvas.style.cursor = 'pointer';
      const status = h('div', { class: 'prof-status', role: 'status' });
      const detail = h('div', { class: 'prof-detail', role: 'status', aria: { live: 'polite' } });
      const legend = h('div', { class: 'prof-legend', aria: { hidden: true } },
        ...[['update', 'Update'], ['render', 'Drawing'], ['other', 'Other']]
          .map(([k, t]) => h('span', {}, h('i', { style: { background: COLORS[k] } }), t)),
        h('span', {}, h('i', { class: 'line' }), 'Budget'));
      const cards = h('div', { class: 'prof-cards' });
      const hintList = h('ul', { class: 'prof-hints' });
      const marksEl = h('div', { class: 'prof-marks' });
      const fnsEl = h('div', { class: 'prof-fns' });
      const slowEl = h('div', { class: 'prof-slow' });
      const empty = h('div', { class: 'empty' }, h('h3', { text: 'Nothing measured yet' }),
        h('p', { text: 'Run the game with the Profiler open. It shows where the time goes: '
          + 'your update, your drawing, and any part you wrap in timed().' }));
      const gotoBtn = button({
        text: 'Go to this moment', icon: 'history', class: 'small', disabled: true, title: 'Pause the game at the tick of the chosen frame',
        onClick: goToMoment,
      });
      const recBtn = h('button', {
        type: 'button', class: 'btn small', aria: { pressed: true }, text: 'Record', on: { click: () => setRecording(!recording) },
      });
      const freezeBtn = h('button', {
        type: 'button', class: 'btn small', aria: { pressed: false }, text: 'Freeze', title: 'Stop the picture changing so you can look',
        on: { click: () => { frozen = !frozen; freezeBtn.setAttribute('aria-pressed', String(frozen)); if (!frozen) redraw(); } },
      });
      const budgetSel = h('select', {
        class: 'art-select', aria: { label: 'Budget for a frame' }, on: { change: () => { budget = Number(budgetSel.value); redraw(); } },
      },
        P.BUDGETS.map((b) => h('option', { value: String(b.ms), text: b.label })));
      const fnBtn = h('button', {
        type: 'button', class: 'btn small', aria: { pressed: false }, text: 'Time every function',
        title: 'Restart the game with a timer around each of your functions (the code you see is not changed)',
        on: { click: () => setFunctions(!studio.runner.profileFunctions) },
      });
      const saveBtn = button({
        text: 'Save reading', class: 'small ghost', title: 'Keep these numbers to compare the next recording with',
        onClick: () => {
          if (!buffer.frames.length) return;
          base = { ...P.summarize(buffer.frames, budget), fns: P.functionStats(buffer.frames) };
          redraw();
        },
      });
      const reportBtn = button({
        text: 'Download report', class: 'small ghost', title: 'A file with the numbers, the slowest frames and the busiest functions',
        onClick: () => {
          if (!buffer.frames.length) return;
          const report = P.reportOf(buffer.frames, budget, { name: studio.project?.name ?? '' });
          download('profile.json', new TextEncoder().encode(JSON.stringify(report, null, 2)), 'application/json');
        },
      });
      const toolbar = h('div', { class: 'toolbar art-bar' }, recBtn, freezeBtn,
        button({ text: 'Clear', class: 'small ghost', onClick: () => { buffer.clear(); selected = null; redraw(); } }), budgetSel, gotoBtn,
        fnBtn, saveBtn, reportBtn);
      const body = h('div', { class: 'prof-body' }, status, canvas, legend, detail, cards, hintList, fnsEl, marksEl, slowEl);
      const el = h('div', { class: 'panel-body art prof', 'aria-label': 'Profiler' }, toolbar, body, empty);

      const frameByN = (n) => buffer.frames.find((f) => f.n === n) ?? null;
      const fixed = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
      const describe = (f) => `Frame ${f.n}: ${fixed(P.totalOf(f))} ms. `
        + `Update ${fixed(f.update)}, drawing ${fixed(f.render)}, other ${fixed(f.other)}. `
        + `${f.ticks} update${f.ticks === 1 ? '' : 's'}, ${f.draws} draw calls${f.things >= 0 ? `, ${f.things} things` : ''}`
        + `${f.marks.length ? `. ${f.marks.map((m) => `${m.name} ${fixed(m.ms)} ms`).join(', ')}` : ''}.`;

      function setFunctions(on) {
        studio.runner.setProfileFunctions(on);
        if (on) studio.emit('plugin-event', 'profile-functions');
        fnBtn.setAttribute('aria-pressed', String(!!studio.runner.profileFunctions));
        buffer.clear();
        selected = null;
        redraw();
      }
      function setRecording(on) {
        recording = on;
        recBtn.setAttribute('aria-pressed', String(on));
        recBtn.textContent = on ? 'Record' : 'Record (off)';
        sync();
        redraw();
      }
      /** Measure only while this panel can be seen and recording is on: measuring is cheap but not free. */
      const visible = () => el.offsetParent !== null && el.clientWidth > 0;
      function sync() { studio.runner.setProfile(recording && visible()); }
      function goToMoment() {
        const f = frameByN(selected);
        if (!f) return;
        studio.timeMachine?.seek?.(f.tick);
        studio.dock.show('time');
      }
      function select(n) {
        selected = n;
        const f = frameByN(n);
        gotoBtn.disabled = !f;
        detail.textContent = f ? describe(f) : '';
        drawChart();
      }

      function drawChart() {
        const frames = buffer.frames;
        const width = Math.max(240, body.clientWidth - 4);
        canvas.width = width;
        const g = canvas.getContext('2d');
        const css = getComputedStyle(el);
        g.fillStyle = css.getPropertyValue('--code-bg').trim() || '#0f131b';
        g.fillRect(0, 0, width, HEIGHT);
        const shown = frames.slice(-Math.floor(width / BAR));
        const top = Math.max(budget * 2, ...shown.map((f) => Math.min(P.totalOf(f), budget * 6))) * 1.05;
        const y = (ms) => HEIGHT - Math.min(HEIGHT, (ms / top) * HEIGHT);
        shown.forEach((f, i) => {
          const x = i * BAR;
          let at = HEIGHT;
          for (const [k, v] of [['update', f.update], ['render', f.render], ['other', f.other]]) {
            const hgt = Math.max(0, (v / top) * HEIGHT);
            g.fillStyle = COLORS[k];
            g.fillRect(x, Math.max(0, at - hgt), BAR - 1, Math.min(hgt, at));
            at -= hgt;
          }
          if (P.totalOf(f) > budget) { g.fillStyle = COLORS.over; g.fillRect(x, 0, BAR - 1, 3); }
          if (f.n === selected) { g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.strokeRect(x - 0.5, 0.5, BAR, HEIGHT - 1); }
        });
        g.strokeStyle = 'rgba(255, 255, 255, .7)';
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(0, y(budget) + 0.5);
        g.lineTo(width, y(budget) + 0.5);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(255, 255, 255, .75)';
        g.font = '10px sans-serif';
        g.fillText(`${budget} ms`, 4, Math.max(10, y(budget) - 3));
        canvas.dataset.first = shown[0]?.n ?? '';
      }

      function redraw() {
        if (frozen) return;
        const frames = buffer.frames;
        empty.hidden = frames.length > 0;
        body.hidden = frames.length === 0;
        const seconds = Math.round(frames.length / 60);
        status.textContent = !recording ? 'Not recording.'
          : visible() ? `Recording: ${frames.length} frames kept (the last ${seconds} seconds).` : 'Open this panel to record.';
        if (!frames.length) return;
        const s = P.summarize(frames, budget);
        const marks = P.markStats(frames);
        const drops = P.memoryDrops(buffer.heap);
        drawChart();
        const diff = P.compare(s, base);
        const card = (title, value, note = '', change = '') => h('div', { class: 'prof-card' },
          h('div', { class: 'prof-n', text: value }), h('div', { class: 'prof-t', text: title }),
          note ? h('div', { class: 'dim', text: note }) : null, change ? h('div', { class: 'prof-delta', text: change }) : null);
        const share = (v) => `${Math.round((v / Math.max(0.0001, s.avg)) * 100)}%`;
        fill(cards,
          card('Average frame', `${fixed(s.avg)} ms`, `slowest ${fixed(s.max)} ms, 95% under ${fixed(s.p95)} ms`, P.delta(diff?.avg, ' ms', 2)),
          card('Over the budget', `${Math.round(s.overShare * 100)}%`, `${s.over} of ${s.frames} frames`,
            P.delta(diff && diff.overShare !== null ? diff.overShare * 100 : null, ' points', 0)),
          card('Frames a second', s.fps === null ? '–' : String(Math.round(s.fps)), s.longGaps ? `${s.longGaps} late frames` : 'steady',
            P.delta(diff?.fps, '', 0)),
          card('Update / drawing / other', `${share(s.update)} / ${share(s.render)} / ${share(s.other)}`,
            `${fixed(s.update)} / ${fixed(s.render)} / ${fixed(s.other)} ms`),
          card('Draw calls', String(Math.round(s.draws)), `most in one frame: ${s.drawsMax}`, P.delta(diff?.draws, '', 0)),
          card('Things', s.things === null ? '–' : String(Math.round(s.things)),
            s.thingsMax === null ? 'no list of things' : `most at once: ${s.thingsMax}`),
          card('Memory', buffer.heap.length ? `${fixed(buffer.heap.at(-1).mb, 1)} MB` : '–',
            buffer.heap.length ? `dropped ${drops} times` : 'not shown in this browser'));
        const advice = P.hints(s, { marks, drops, rhythmEvery: P.rhythm(frames, budget) });
        fill(hintList, advice.map((x) => h('li', { class: `prof-hint ${x.level}`, text: x.text })));
        fill(marksEl, marks.length
          ? [h('div', { class: 'art-label', text: 'Parts you timed' }), h('table', { class: 'shortcuts' },
            h('tr', {}, ...['Name', 'ms a frame', 'worst', 'calls a frame'].map((t) => h('th', { text: t, scope: 'col' }))),
            ...marks.map((m) => h('tr', {}, h('td', { text: m.name }), h('td', { text: fixed(m.perFrame) }), h('td', { text: fixed(m.max) }),
              h('td', { text: fixed(m.callsPerFrame, 1) }))))]
          : [h('p', { class: 'dim', text: 'To see where your own time goes, wrap work in timed(\'name\', () => ...) from @engine/arcade.' })]);
        const fns = P.functionStats(frames);
        const before = new Map((base?.fns ?? []).map((x) => [x.name, x.self]));
        fill(fnsEl, fns.length
          ? [h('div', { class: 'art-label', text: 'Your functions (own time: what is left after the functions each one calls)' }),
            h('table', { class: 'shortcuts' },
              h('tr', {}, ...['Function', 'ms a frame', 'with what it calls', 'worst', 'calls a frame', base ? 'against saved' : '']
                .map((t) => h('th', { text: t, scope: 'col' }))),
              ...fns.slice(0, 14).map((x) => h('tr', {}, h('td', { text: x.name }), h('td', { text: fixed(x.self) }),
                h('td', { text: fixed(x.total) }),
                h('td', { text: fixed(x.max) }), h('td', { text: fixed(x.callsPerFrame, 1) }),
                h('td', { text: before.has(x.name) ? `${x.self - before.get(x.name) >= 0 ? '+' : ''}${fixed(x.self - before.get(x.name))}` : '' }))))]
          : studio.runner.profileFunctions ? [h('p', { class: 'dim', text: 'Waiting for the game to run its functions…' })] : null);
        const slow = P.slowFrames(frames, budget);
        fill(slowEl, slow.length
          ? [h('div', { class: 'art-label', text: 'Slowest frames' }), ...slow.map((x) => h('button', {
            type: 'button', class: `prof-slow-row${x.frame.n === selected ? ' on' : ''}`,
            aria: { label: `${fixed(x.total)} milliseconds, ${x.cause.what}. ${describe(x.frame)}` },
            on: { click: () => { select(x.frame.n); redraw(); } },
          }, h('span', { class: 'prof-ms', text: `${fixed(x.total, 1)} ms` }),
          h('span', { text: `frame ${x.frame.n}: mostly ${x.cause.what} (${fixed(x.cause.ms, 1)} ms)` })))]
          : null);
      }
      const later = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; redraw(); }); };

      studio.runner.on('profile', (p) => {
        if (!recording) return;
        buffer.push(p.frames, p.heapMB);
        if (frozen) return;
        if (selected === null || frameByN(selected)) later(); else { selected = null; later(); }
      });
      studio.runner.on('ready', sync);
      studio.on('project', () => { buffer.clear(); selected = null; redraw(); });
      const pick = (e) => {
        const r = canvas.getBoundingClientRect();
        const i = Math.floor(((e.clientX - r.left) * (canvas.width / r.width)) / BAR);
        const first = Number(canvas.dataset.first);
        const f = frameByN(first + i);
        if (f) { select(f.n); canvas.focus(); }
      };
      canvas.addEventListener('pointerdown', pick);
      canvas.addEventListener('keydown', (e) => {
        const frames = buffer.frames;
        if (!frames.length) return;
        const at = frames.findIndex((f) => f.n === selected);
        const move = { ArrowLeft: -1, ArrowRight: 1, Home: -1e9, End: 1e9 }[e.key];
        if (move !== undefined) {
          e.preventDefault();
          select(frames[Math.max(0, Math.min(frames.length - 1, (at < 0 ? frames.length - 1 : at) + move))].n);
        }
        else if (e.key === 'Enter') { e.preventDefault(); goToMoment(); }
      });
      new ResizeObserver(() => { sync(); if (visible()) redraw(); }).observe(el);
      redraw();
      return {
        el, focus: () => canvas.focus(), onShow: () => { sync(); redraw(); },
        dispose: () => { studio.runner.setProfile(false); studio.runner.setProfileFunctions(false); },
      };
    },
  };
}
