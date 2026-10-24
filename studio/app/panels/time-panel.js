// The Time panel: the Time Machine's controls. Pause the game, drag back through what just happened, step one tick at a time, run it again with the code as
// it is now ("what if the jump were higher?"), and save what happened as a file that reproduces it anywhere.
import { h, button, fill, icon } from '../ui/dom.js';

const seconds = (ticks) => `${(ticks / 60).toFixed(1)} s`;

export function timePanel(studio) {
  return {
    id: 'time',
    title: 'Time',
    icon: 'history',
    create() {
      const tm = studio.timeMachine;
      const slider = h('input', {
        type: 'range', class: 'time-slider', min: '0', max: '0', value: '0', step: '1',
        aria: { label: 'Moment in the game, in ticks (sixty a second)' },
      });
      const marks = h('div', { class: 'time-marks', aria: { hidden: true } });
      const readout = h('span', { class: 'time-readout', role: 'status' });
      const note = h('div', { class: 'time-note', role: 'status', aria: { live: 'polite' } });
      const playBtn = button({ label: 'Pause the game', text: 'Pause', icon: 'stop', class: 'small primary', onClick: () => tm.toggle() });
      const stepper = (label, text, n) => button({ label, 'aria-label': label, text, class: 'small', onClick: () => tm.step(n) });
      const back = stepper('Step back one tick', '◀ 1', -1);
      const forward = stepper('Step forward one tick', '1 ▶', 1);
      const back10 = stepper('Go back ten ticks', '◀ 10', -10);
      const forward10 = stepper('Go forward ten ticks', '10 ▶', 10);
      const replayBtn = button({
        label: 'Run the recording again from here with the code as it is now', text: 'Replay with my code', class: 'small',
        onClick: () => tm.replay(),
      });
      const fileInput = h('input', {
        type: 'file', accept: '.json,application/json', hidden: true, aria: { label: 'Open a recording file' },
        on: { change: () => { if (fileInput.files[0]) tm.open(fileInput.files[0]); fileInput.value = ''; } },
      });
      const controls = h('div', { class: 'toolbar time-bar' }, back10, back, playBtn, forward, forward10, readout);
      const actions = h('div', { class: 'toolbar time-bar' }, replayBtn,
        button({ label: 'Save a recording of what happened', text: 'Save recording', icon: 'download', class: 'small', onClick: () => tm.save() }),
        button({ label: 'Open a recording file', text: 'Open recording', icon: 'upload', class: 'small', onClick: () => fileInput.click() }),
        fileInput);
      const track = h('div', { class: 'time-track' }, marks, slider);
      const el = h('div', { class: 'panel-body time', 'aria-label': 'Time Machine' }, controls, track, actions, note);

      let dragging = false;
      let frame = 0;
      slider.addEventListener('input', () => {
        dragging = true;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => tm.seek(Number(slider.value)));
      });
      slider.addEventListener('change', () => { dragging = false; });

      const noteFor = (s) => {
        if (!studio.project) return 'Open a project to use the Time Machine.';
        if (!s) return 'Waiting for the game…';
        if (s.diverged) {
          return `This game did not repeat itself exactly at ${seconds(s.diverged.tick)}. It probably uses Math.random() or the clock. `
            + 'Keep chance in the game state (the kit\'s random(game) does) so a recording can be reproduced.';
        }
        if (s.mode === 'replay') return 'Replaying what you did, with your current code…';
        if (s.replayEnded) return 'The replay is finished. It is paused at the end: compare it with what happened before (go back and look).';
        if (s.paused && s.tick < s.to) {
          return `Paused in the past, ${seconds(s.to - s.tick)} before now. Play goes on from here and forgets what came after; `
            + '"Replay with my code" runs it again, keeping your key presses.';
        }
        if (s.paused) return 'Paused. Drag the slider back, or step one tick at a time. Edits you make in the Inspector are recorded too.';
        return 'The game is recording. Pause it, then drag back to see what happened.';
      };

      function draw() {
        const s = studio.runner.timeline;
        const have = !!s && !!studio.project;
        for (const b of [back, back10, forward, forward10, replayBtn, slider]) b.disabled = !have;
        if (!have) { readout.textContent = ''; note.textContent = noteFor(null); return; }
        slider.min = String(s.from);
        slider.max = String(Math.max(s.to, s.from + 1));
        if (!dragging) slider.value = String(s.tick);
        playBtn.querySelector('span').textContent = s.paused ? 'Play' : 'Pause';
        playBtn.querySelector('svg')?.replaceWith(icon(s.paused ? 'play' : 'stop'));
        playBtn.setAttribute('title', s.paused ? 'Play the game' : 'Pause the game');
        readout.textContent = `${seconds(s.tick - s.from)} of ${seconds(s.to - s.from)}${s.paused ? ' (paused)' : ''}`;
        note.textContent = noteFor(s);
        note.classList.toggle('warn', !!s.diverged);
        const span = Math.max(1, s.to - s.from);
        const thin = s.snapshots.length > 200 ? Math.ceil(s.snapshots.length / 200) : 1;
        const at = (t) => ({ left: `${((t - s.from) / span) * 100}%` });
        fill(marks,
          ...s.snapshots.filter((_, i) => i % thin === 0).map((t) => h('span', { class: 'mark', style: at(t) })),
          ...s.edits.map((t) => h('span', { class: 'mark edit', title: 'A value was edited here', style: at(t) })));
      }

      studio.on('runner-timeline', draw);
      studio.on('project', draw);
      studio.on('verdict', () => {
        if (studio.timeMachine.lastVerdict?.ok) note.textContent = 'Recording reproduced exactly on this computer.';
      });
      draw();
      return { el, focus: () => slider.focus(), onShow: draw };
    },
  };
}
