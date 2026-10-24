// The Music panel: make a looping tune by clicking notes into a grid (a piano roll). Each track is one voice; the song is kept in `src/music.js` and a game plays it
// with `music(...)` and `playMusic('name')`. Click an empty cell to add a note, click a note to remove it; it all works from the keyboard too (arrows move the
// cursor, Space adds or removes). The logic is in paint/music-model.js.
import { h, button, fill } from '../ui/dom.js';
import { showDialog } from '../ui/dialog.js';
import * as M from '../paint/music-model.js';
import { History } from '../paint/sprite-model.js';

const FILE = 'src/music.js';
const LO = 36;                       // C2, the lowest key shown
const ROW = 12;                      // pixels a key is tall
const STEP = 14;                     // pixels a quarter beat is wide
const LABEL = 38;                    // room for the key names
const COLORS = ['#5ac8ff', '#ff9f43', '#4ade80', '#e84a5f', '#8b8bff', '#ffd23c', '#f472b6', '#2dd4bf'];

export function musicPanel(studio) {
  return {
    id: 'music',
    title: 'Music',
    icon: 'edit',
    create() {
      let songs = {};
      let current = null;
      let song = null;
      let history = null;
      let track = 0;
      let length = 4;                  // steps a new note lasts
      let cursor = { step: 0, pitch: 60 };
      let lastWritten = '';
      let problem = '';
      let note = '';
      let seed = 1;
      let ctx = null;
      let synth = null;
      let playing = null;              // { source, startedAt, seconds }
      const muted = new Set();

      const picker = h('select', { class: 'art-select', aria: { label: 'Song to edit' }, on: { change: () => choose(picker.value) } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const tracksEl = h('div', { class: 'music-tracks' });
      const canvas = h('canvas', {
        class: 'art-canvas music-canvas', tabIndex: 0, role: 'application',
        aria: { label: 'Note grid. Arrow keys move the cursor, Space adds or removes a note, comma and full stop change its length.' },
      });
      canvas.style.cursor = 'pointer';
      const playhead = h('div', { class: 'music-playhead', hidden: true, aria: { hidden: true } });
      const roll = h('div', { class: 'music-roll' }, canvas, playhead);
      const live = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
      const say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 20); };
      const notes = h('div', { class: 'level-notes', role: 'status' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'music-body' }, tracksEl, roll, notes);
      const el = h('div', { class: 'panel-body art music', 'aria-label': 'Music maker' }, toolbar, body, help, live, empty);

      const engineRoot = () => studio.engineRoot ?? '/packages';
      const high = () => Math.max(84, ...(song?.tracks.flatMap((t) => t.notes.map((n) => n.pitch + 2)) ?? [84]));
      const rows = () => high() - LO + 1;

      // ---------- the file ----------
      function load() {
        problem = '';
        note = '';
        const text = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = text ?? '';
        try {
          const out = text ? M.parseSongs(text) : { songs: {}, rounded: [] };
          songs = out.songs;
          if (out.rounded.length) note = `${out.rounded.join(', ')}: some notes did not fall on the grid and were moved to the nearest quarter beat.`;
        } catch (error) { songs = {}; problem = error.message; }
        if (!(current in songs)) current = Object.keys(songs)[0] ?? null;
        open();
      }
      function open() {
        song = current ? songs[current] : null;
        history = song ? new History(song) : null;
        track = Math.min(track, (song?.tracks.length ?? 1) - 1);
        redraw();
      }
      function flush() {
        if (!studio.project || problem) return;
        const text = M.serializeSongs(songs);
        if (text === lastWritten || !Object.keys(songs).length) return;
        lastWritten = text;
        studio.project.write(FILE, text);
        studio.emit('files');
      }
      function commit(next, { record = true } = {}) {
        if (!song || next === song) return;
        song = next;
        songs = { ...songs, [current]: song };
        if (record) history.push(song);
        flush();
        if (playing) startPlaying(playing.at ?? 0);
        redraw();
      }
      function choose(name) { current = name; track = 0; open(); }

      // ---------- looking ----------
      function drawRoll() {
        if (!song) return;
        const steps = M.songSteps(song);
        const n = rows();
        canvas.width = LABEL + steps * STEP;
        canvas.height = n * ROW;
        const g = canvas.getContext('2d');
        const css = getComputedStyle(el);
        const dim = css.getPropertyValue('--dim').trim() || '#8e98b0';
        g.fillStyle = css.getPropertyValue('--code-bg').trim() || '#0f131b';
        g.fillRect(0, 0, canvas.width, canvas.height);
        for (let p = high(); p >= LO; p--) {
          const y = (high() - p) * ROW;
          g.fillStyle = M.isBlackKey(p) ? 'rgba(120, 130, 160, .16)' : 'rgba(120, 130, 160, .05)';
          g.fillRect(LABEL, y, canvas.width - LABEL, ROW);
          g.fillStyle = M.isBlackKey(p) ? 'rgba(20, 24, 36, .9)' : 'rgba(235, 238, 248, .85)';
          g.fillRect(0, y, LABEL - 2, ROW - 1);
          if (p % 12 === 0) { g.fillStyle = '#12161f'; g.font = '9px sans-serif'; g.fillText(M.noteName(p), 3, y + ROW - 3); }
        }
        for (let s = 0; s <= steps; s++) {
          const bar = s % M.STEPS_PER_BAR === 0;
          const beat = s % M.STEPS_PER_BEAT === 0;
          g.strokeStyle = bar ? 'rgba(200, 210, 240, .45)' : beat ? 'rgba(160, 170, 200, .22)' : 'rgba(160, 170, 200, .08)';
          g.beginPath();
          g.moveTo(LABEL + s * STEP + 0.5, 0);
          g.lineTo(LABEL + s * STEP + 0.5, canvas.height);
          g.stroke();
        }
        song.tracks.forEach((t, i) => {
          if (i === track) return;
          g.globalAlpha = muted.has(i) ? 0.08 : 0.3;
          g.fillStyle = COLORS[i % COLORS.length];
          for (const nt of t.notes) g.fillRect(LABEL + nt.step * STEP + 1, (high() - nt.pitch) * ROW + 1, nt.len * STEP - 2, ROW - 2);
        });
        g.globalAlpha = 1;
        g.fillStyle = COLORS[track % COLORS.length];
        for (const nt of song.tracks[track].notes) g.fillRect(LABEL + nt.step * STEP + 1, (high() - nt.pitch) * ROW + 1, nt.len * STEP - 2, ROW - 2);
        // the cursor
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(LABEL + cursor.step * STEP + 1, (high() - cursor.pitch) * ROW + 1, length * STEP - 2, ROW - 2);
        g.lineWidth = 1;
        g.fillStyle = dim;
      }
      function drawTracks() {
        fill(tracksEl, song.tracks.map((t, i) => {
          const row = h('div', { class: `music-track${i === track ? ' on' : ''}` });
          const pick = h('button', {
            type: 'button', class: 'btn small music-pick', aria: { pressed: i === track, label: `Edit track ${i + 1}` }, text: `Track ${i + 1}`,
            style: { borderLeft: `4px solid ${COLORS[i % COLORS.length]}` },
            on: { click: () => { track = i; redraw(); say(`Track ${i + 1}, ${t.wave}`); } },
          });
          const wave = h('select', {
            aria: { label: `Voice of track ${i + 1}` }, on: { change: () => commit(M.setTrack(song, i, { wave: wave.value })) },
          },
            M.WAVES.map((w) => h('option', { value: w, text: w, selected: w === t.wave })));
          const vol = h('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: t.gain, aria: { label: `Volume of track ${i + 1}` },
            on: { change: () => commit(M.setTrack(song, i, { gain: Number(vol.value) })) },
          });
          const mute = h('input', {
            type: 'checkbox', checked: muted.has(i), aria: { label: `Silence track ${i + 1} while listening` },
            on: { change: () => { if (mute.checked) muted.add(i); else muted.delete(i); if (playing) startPlaying(playing.at ?? 0); drawRoll(); } },
          });
          row.append(pick, wave, vol, h('label', { class: 'art-inline' }, mute, ' mute'),
            button({
              label: `Remove track ${i + 1}`, text: '✕', class: 'small ghost', disabled: song.tracks.length <= 1,
              onClick: () => { track = Math.max(0, Math.min(track, song.tracks.length - 2)); commit(M.removeTrack(song, i)); },
            }));
          return row;
        }), button({
          text: 'Add a track', icon: 'plus', class: 'small', disabled: song.tracks.length >= M.SONG_LIMITS.tracks,
          onClick: () => { track = song.tracks.length; commit(M.addTrack(song, 'square')); },
        }));
      }
      const up = () => commit(M.transpose(song, track, 1));
      const down = () => commit(M.transpose(song, track, -1));
      const repeat = () => commit(M.repeatTrack(song, track, 1));
      const clear = () => commit(M.clearTrack(song, track));
      function drawToolbar() {
        const names = Object.keys(songs);
        fill(picker, names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = !names.length;
        const num = (label, value, min, max, onChange) => {
          const i = h('input', { type: 'number', min, max, value, aria: { label }, style: { width: '4.5em' } });
          i.addEventListener('change', () => { onChange(Number(i.value)); });
          return h('label', { class: 'art-inline' }, `${label} `, i);
        };
        const lengthSel = h('select', {
          class: 'art-select', aria: { label: 'Length of a new note' }, on: { change: () => { length = Number(lengthSel.value); drawRoll(); } },
        },
          M.LENGTHS.map(([t, v]) => h('option', { value: v, text: t, selected: v === length })));
        fill(toolbar,
          picker,
          button({ text: 'New song', icon: 'plus', class: 'small', onClick: newSong }),
          button({
            text: 'Free songs…', class: 'small', title: 'Songs that come with the studio: listen and add the ones you like',
            onClick: () => studio.commands.execute('assets.pack', { kind: 'song' }),
          }),
          song ? [
            button({
              text: playing ? 'Stop' : 'Play', icon: playing ? 'stop' : 'play', class: `small${playing ? '' : ' primary'}`,
              onClick: () => (playing ? stopPlaying() : startPlaying()),
            }),
            button({ text: 'Undo', class: 'small ghost', disabled: !history?.canUndo, onClick: undo }),
            button({ text: 'Redo', class: 'small ghost', disabled: !history?.canRedo, onClick: redo }),
            num('Tempo', song.bpm, M.SONG_LIMITS.bpm[0], M.SONG_LIMITS.bpm[1], (v) => commit(M.setTempo(song, v))),
            num('Bars', song.bars, 1, M.SONG_LIMITS.bars, (v) => commit(M.setBars(song, v))),
            h('label', { class: 'art-inline' }, 'Note ', lengthSel),
            button({ text: 'Surprise me', class: 'small', title: 'Make a new tune from the next idea', onClick: surprise }),
            button({ text: 'Repeat bar 1', class: 'small ghost', title: 'Copy the first bar to every bar', onClick: () => repeat() }),
            button({ text: 'Up', class: 'small ghost', title: 'Transpose this track up a semitone', onClick: () => up() }),
            button({ text: 'Down', class: 'small ghost', title: 'Transpose this track down a semitone', onClick: () => down() }),
            button({ text: 'Clear', class: 'small ghost', title: 'Take every note off this track', onClick: clear }),
            button({ text: 'Delete song', class: 'small ghost danger', onClick: removeSong }),
          ] : null);
      }
      function redraw() {
        const there = !!studio.project && !!song;
        body.hidden = !there;
        help.hidden = !there;
        empty.hidden = there;
        if (!there) {
          fill(empty, studio.project
            ? [h('h3', { text: problem ? 'This music file cannot be read' : 'No music yet' }),
              h('p', { text: problem || 'A song is a tune that loops: click notes into a grid, track by track. It is kept in src/music.js.' }),
              ...(problem ? [] : [button({ text: 'Make my first song', icon: 'plus', onClick: newSong })])]
            : [h('h3', { text: 'No project open' }), h('p', { text: 'Open a project to make music.' })]);
          drawToolbar();
          return;
        }
        drawToolbar();
        drawTracks();
        drawRoll();
        const bars = `${song.bars} bar${song.bars === 1 ? '' : 's'}`;
        const seconds = Math.round(M.songSeconds(song) * 10) / 10;
        notes.textContent = note || `${seconds} seconds, ${bars}. Notes that start together and last the same time make a chord.`;
        help.querySelector('pre').textContent = `import songs from './music.js';\nimport { music, playMusic, stopMusic } from '@engine/arcade';\n\n`
          + `music(songs);                 // once, at the top of the file\nplayMusic('${current}');   `
          + '// when the game starts; it loops, and playing it again does not restart it\n';
      }

      // ---------- doing things ----------
      async function newSong() {
        if (!studio.project) return;
        const first = Object.keys(songs).length ? 'chase' : 'calm';
        const name = h('input', { type: 'text', value: first, spellcheck: false, aria: { label: 'Name of the song' } });
        const start = h('select', { aria: { label: 'Start from' } },
          [['calm', 'A calm loop'], ['chase', 'A chase'], ['jingle', 'A short jingle'], ['surprise', 'A surprise tune'], ['empty', 'Nothing']]
            .map(([v, t]) => h('option', { value: v, text: t, selected: v === (Object.keys(songs).length ? 'chase' : 'calm') })));
        start.addEventListener('change', () => { if (M.PRESETS[start.value]) name.value = start.value; });
        const error = h('div', { class: 'error', role: 'alert' });
        const body = h('div', { class: 'settings-dialog' },
          h('label', { class: 'settings-field' }, h('span', { text: 'Name' }), name),
          h('label', { class: 'settings-field' }, h('span', { text: 'Start from' }), start), error);
        const answer = await showDialog({
          title: 'New song', body, initialFocus: () => { name.select(); return name; },
          buttons: [{ label: 'Cancel', value: false }, { label: 'Make it', value: true, primary: true }],
          beforeClose: (value) => {
            if (value !== true) return true;
            if (!/^[a-z][\w-]{0,31}$/i.test(name.value.trim())) {
              error.textContent = 'Use letters and numbers, starting with a letter.';
              return false;
            }
            return true;
          },
        });
        if (answer !== true) return;
        const next = start.value === 'surprise' ? M.surprise(seed++) : M.PRESETS[start.value] ? M.PRESETS[start.value]() : M.newSong();
        const made = M.freeName(songs, name.value.trim());
        problem = '';
        songs = { ...songs, [made]: next };
        current = made;
        track = 0;
        flush();
        open();
        canvas.focus();
        studio.emit('plugin-event', 'song-made');
      }
      function removeSong() {
        if (!current) return;
        const { [current]: _gone, ...rest } = songs;
        songs = rest;
        const text = Object.keys(songs).length ? M.serializeSongs(songs) : null;
        if (text) {
          lastWritten = text;
          studio.project.write(FILE, text);
        } else if (studio.project.has(FILE)) {
          lastWritten = '';
          studio.project.remove(FILE);
        }
        studio.emit('files');
        current = Object.keys(songs)[0] ?? null;
        open();
      }
      function surprise() {
        const next = M.surprise(seed++, { bars: song.bars, bpm: song.bpm, scale: ['pentatonic', 'major', 'minor'][seed % 3] });
        while (next.tracks.length < song.tracks.length) next.tracks.push({ ...song.tracks[next.tracks.length], notes: [] });
        const voices = next.tracks.map((t, i) => {
          const mine = song.tracks[i] ?? {};
          return { ...mine, ...t, wave: mine.wave ?? t.wave, gain: mine.gain ?? t.gain };
        });
        commit({ ...next, tracks: voices });
        say('A new tune');
      }
      const undo = () => {
        if (!history?.canUndo) return;
        song = history.undo();
        songs = { ...songs, [current]: song };
        flush();
        if (playing) startPlaying();
        redraw();
      };
      const redo = () => {
        if (!history?.canRedo) return;
        song = history.redo();
        songs = { ...songs, [current]: song };
        flush();
        if (playing) startPlaying();
        redraw();
      };

      // ---------- listening ----------
      async function ready() {
        synth ??= await import(`${engineRoot()}/audio/src/synth.js`);
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
      }
      async function blip(pitch) {
        try {
          await ready();
          const t = song.tracks[track];
          const layer = { wave: t.wave, freq: synth.noteFrequency(M.noteName(pitch)), decay: 0.12, gain: Math.max(0.2, t.gain), length: 0.28 };
          const pcm = synth.synthesize({ duration: 0.3, layers: [layer] });
          const buffer = ctx.createBuffer(1, pcm.data.length, pcm.sampleRate);
          buffer.copyToChannel(pcm.data, 0);
          const source = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.value = 0.5;
          source.buffer = buffer;
          source.connect(gain).connect(ctx.destination);
          source.start();
        } catch { /* a missing preview sound is not worth a message */ }
      }
      async function startPlaying() {
        if (!song) return;
        try {
          await ready();
          const kit = M.toKit({ ...song, tracks: song.tracks.map((t, i) => (muted.has(i) ? { ...t, notes: [] } : t)) });
          const pcm = synth.sequence({ bpm: kit.bpm, tracks: kit.tracks.map((t) => ({ ...t, notes: t.notes })) });
          const buffer = ctx.createBuffer(1, pcm.data.length, pcm.sampleRate);
          buffer.copyToChannel(pcm.data, 0);
          stopPlaying(false);
          const source = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.value = 0.7;
          source.buffer = buffer;
          source.loop = true;
          source.connect(gain).connect(ctx.destination);
          source.start();
          playing = { source, startedAt: ctx.currentTime, seconds: pcm.data.length / pcm.sampleRate };
          playhead.hidden = false;
          tick();
          drawToolbar();
        } catch (error) {
          studio.toasts.show(`Could not play that: ${error.message}`, { kind: 'error' });
        }
      }
      function stopPlaying(redrawBar = true) {
        if (playing) { try { playing.source.stop(); } catch { /* already stopped */ } }
        playing = null;
        playhead.hidden = true;
        if (redrawBar) drawToolbar();
      }
      function tick() {
        if (!playing) return;
        const at = ((ctx.currentTime - playing.startedAt) % playing.seconds) / playing.seconds;
        playhead.style.transform = `translateX(${LABEL + at * M.songSteps(song) * STEP}px)`;
        requestAnimationFrame(tick);
      }

      // ---------- the mouse and the keyboard ----------
      function cellOf(e) {
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) * (canvas.width / r.width);
        const y = (e.clientY - r.top) * (canvas.height / r.height);
        return { step: Math.floor((x - LABEL) / STEP), pitch: high() - Math.floor(y / ROW) };
      }
      function toggleAt(step, pitch) {
        const had = M.noteAt(song, track, step, pitch) >= 0;
        const next = M.toggleNote(song, track, step, pitch, length);
        if (next === song) return;
        commit(next);
        if (!had) blip(pitch);
        say(`${M.noteName(pitch)} ${had ? 'removed' : 'added'} at step ${step + 1}`);
      }
      canvas.addEventListener('pointerdown', (e) => {
        if (!song || e.button !== 0) return;
        canvas.focus();
        const c = cellOf(e);
        if (c.step < 0 || c.step >= M.songSteps(song)) return;
        cursor = { step: c.step, pitch: Math.max(LO, Math.min(high(), c.pitch)) };
        toggleAt(c.step, c.pitch);
      });
      canvas.addEventListener('keydown', (e) => {
        if (!song) return;
        const steps = M.songSteps(song);
        const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (move) {
          e.preventDefault();
          const big = e.shiftKey ? [4, 12] : [1, 1];
          cursor = {
            step: Math.max(0, Math.min(steps - 1, cursor.step + move[0] * big[0])),
            pitch: Math.max(LO, Math.min(high(), cursor.pitch + move[1] * big[1])),
          };
          drawRoll();
          const at = M.noteAt(song, track, cursor.step, cursor.pitch);
          say(`${M.noteName(cursor.pitch)}, step ${cursor.step + 1}${at >= 0 ? ', has a note' : ''}`);
          roll.scrollTo?.({
            left: Math.max(0, LABEL + cursor.step * STEP - roll.clientWidth / 2),
            top: Math.max(0, (high() - cursor.pitch) * ROW - roll.clientHeight / 2),
          });
        } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAt(cursor.step, cursor.pitch); }
        else if (e.key === ',' || e.key === '.') {
          e.preventDefault();
          const at = M.LENGTHS.findIndex(([, v]) => v === length);
          length = M.LENGTHS[Math.max(0, Math.min(M.LENGTHS.length - 1, at + (e.key === '.' ? 1 : -1)))][1];
          drawToolbar();
          drawRoll();
          say(`New notes are ${M.LENGTHS.find(([, v]) => v === length)[0]} long`);
        } else if (e.key === '[' || e.key === ']') {
          e.preventDefault();
          track = (track + (e.key === ']' ? 1 : song.tracks.length - 1)) % song.tracks.length;
          redraw();
          say(`Track ${track + 1}`);
        } else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (playing) stopPlaying(); else startPlaying(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      });

      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('files', () => { if (!studio.project?.has(FILE) && Object.keys(songs).length && lastWritten) load(); });
      studio.on('project', () => { current = null; stopPlaying(false); muted.clear(); load(); });
      load();
      return {
        el, focus: () => (song ? canvas.focus() : empty.querySelector('button')?.focus()), onShow: redraw,
        dispose: () => { stopPlaying(false); flush(); },
      };
    },
  };
}
