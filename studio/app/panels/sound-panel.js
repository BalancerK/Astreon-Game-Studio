// The Sound maker: make the sounds for your game with sliders and listen as you go. A sound is a small recipe (layers of waves with a pitch, a volume and a
// fade) kept in `src/sounds.js`; the game plays it by name with `play('coin')`. Start from a ready-made sound and change it, or press "Surprise me".
import { h, button, fill } from '../ui/dom.js';
import { promptText } from '../ui/dialog.js';
import * as D from '../paint/sound-model.js';

const FILE = 'src/sounds.js';
const SLIDERS = [
  ['freq', 'Pitch (Hz)', 20, 4000, 1], ['gain', 'Volume', 0, 1, 0.01], ['decay', 'Fade-out (s)', 0.005, 1.5, 0.005],
  ['start', 'Starts at (s)', 0, 1, 0.01], ['length', 'Lasts (s)', 0.01, 2, 0.01],
];
const OPTIONAL = [
  ['freqEnd', 'Glides to (Hz)', 20, 4000, 1], ['lowpass', 'Muffle from (Hz)', 100, 12000, 10], ['lowpassEnd', 'Muffle to (Hz)', 100, 12000, 10],
];

/** Why a name cannot be used for a sound, or null. */
function nameProblem(name, taken) {
  if (!/^[a-z][\w-]{0,31}$/i.test(name)) return 'Use letters and numbers, starting with a letter';
  return taken(name) ? 'There is already a sound with that name' : null;
}

export function soundPanel(studio) {
  return {
    id: 'sounds',
    title: 'Sounds',
    icon: 'edit',
    create() {
      let sounds = {};
      let current = null;                  // the name being edited
      let lastWritten = '';
      let saveTimer = 0;
      let problem = '';
      let ctx = null;
      let synth = null;
      let seed = 1;

      const picker = h('select',
        { class: 'art-select', aria: { label: 'Sound to edit' }, on: { change: () => { current = picker.value; draw(); } } });
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const shape = h('canvas',
        { class: 'sound-shape', width: 360, height: 70, aria: { label: 'The shape of the sound: how loud it is over time' } });
      const layersEl = h('div', { class: 'sound-layers' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }), h('pre', { class: 'learn-code' }));
      const empty = h('div', { class: 'empty' });
      const body = h('div', { class: 'sound-body' }, shape, layersEl);
      const el = h('div', { class: 'panel-body art sound', 'aria-label': 'Sound maker' }, toolbar, body, help, empty);

      const engineRoot = () => studio.engineRoot ?? '/packages';

      // ---- the file ----
      function load() {
        problem = '';
        const text = studio.project?.has(FILE) ? studio.project.readText(FILE) : null;
        lastWritten = text ?? '';
        try { sounds = text ? D.parseSounds(text) : {}; } catch (error) { sounds = {}; problem = error.message; }
        if (!(current in sounds)) current = Object.keys(sounds)[0] ?? null;
        draw();
      }
      function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 250);
      }
      function flush() {
        clearTimeout(saveTimer);
        if (!studio.project || problem) return;
        const text = D.serializeSounds(sounds);
        if (text === lastWritten) return;
        lastWritten = text;
        studio.project.write(FILE, text);
        studio.emit('files');
      }
      function edit(next) {
        if (!current || next === sounds[current]) return;
        sounds = { ...sounds, [current]: next };
        save();
        shapeOnly();
      }

      // ---- listening ----
      async function ready() {
        synth ??= await import(`${engineRoot()}/audio/src/synth.js`);
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
      }
      async function listen() {
        if (!current) return;
        try {
          await ready();
          const pcm = synth.synthesize(sounds[current]);
          const buffer = ctx.createBuffer(1, pcm.data.length, pcm.sampleRate);
          buffer.copyToChannel(pcm.data, 0);
          const src = ctx.createBufferSource();
          const gain = ctx.createGain();
          gain.gain.value = 0.8;
          src.buffer = buffer;
          src.connect(gain).connect(ctx.destination);
          src.start();
          drawShape(pcm.data);
        } catch (error) {
          studio.toasts.show(`Could not play that: ${error.message}`, { kind: 'error' });
        }
      }
      async function shapeOnly() {
        if (!current) return;
        try {
          synth ??= await import(`${engineRoot()}/audio/src/synth.js`);
          drawShape(synth.synthesize(sounds[current]).data);
        } catch { /* the preview line is optional */ }
      }
      function drawShape(data) {
        const g = shape.getContext('2d');
        g.fillStyle = '#12161f';
        g.fillRect(0, 0, shape.width, shape.height);
        const peaks = D.outline(data, shape.width / 3);
        g.fillStyle = '#8b8bff';
        peaks.forEach((p, i) => { const hgt = Math.max(1, p * (shape.height - 6)); g.fillRect(i * 3, (shape.height - hgt) / 2, 2, hgt); });
      }

      // ---- the controls ----
      const slider = (label, value, [min, max, step], onInput, onChange) => {
        const out = h('output', { text: String(Math.round(value * 1000) / 1000) });
        const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), aria: { label } });
        input.addEventListener('input',
          () => { out.textContent = String(Math.round(Number(input.value) * 1000) / 1000); onInput(Number(input.value)); });
        input.addEventListener('change', () => onChange?.());
        return h('label', { class: 'sound-slider' }, h('span', { text: label }), input, out);
      };

      function draw() {
        const names = Object.keys(sounds);
        fill(picker, ...names.map((n) => h('option', { value: n, text: n, selected: n === current })));
        picker.hidden = names.length === 0;                  // no sounds yet: nothing to choose from
        const s = current ? sounds[current] : null;
        body.hidden = !s;
        help.hidden = !s;
        empty.hidden = !!s;
        const presetPicker = h('select', { aria: { label: 'Start a new sound from' } },
          h('option', { value: '', text: 'New sound from…' }), ...Object.keys(D.PRESETS).map((n) => h('option', { value: n, text: n })), h('option',
            { value: '_blank', text: 'a blank beep' }));
        presetPicker.addEventListener('change', () => { if (presetPicker.value) newSound(presetPicker.value); });
        fill(toolbar, picker, presetPicker,
          button({
            text: 'Free sounds…', class: 'small', title: 'Sounds that come with the studio: listen and add the ones you like',
            onClick: () => studio.commands.execute('assets.pack', { kind: 'sound' }),
          }),
          s ? [button({ text: 'Play', icon: 'play', class: 'small primary', onClick: listen }),
            button({ text: 'Surprise me', class: 'small', title: 'A random variation of this sound',
              onClick: () => { edit(D.mutate(s, seed++, 0.5)); draw(); listen(); } }),
            button({ text: 'Rename', class: 'small ghost', onClick: rename }), button({ text: 'Delete', class: 'small ghost',
              onClick: remove })] : null);
        if (problem) { fill(empty, h('h3', { text: 'The sounds file needs fixing' }), h('p', { text: problem })); return; }
        if (!s) {
          fill(empty, h('h3', { text: 'No sounds yet' }),
            h('p', { text: 'Pick a ready-made sound to start from, then change it until it feels right.' }), 
            button({ text: 'Make a coin sound', class: 'primary', onClick: () => newSound('coin') }));
          return;
        }
        const layers = s.layers.map((layer, i) => h('fieldset', { class: 'sound-layer' },
          h('legend', { text: `Layer ${i + 1}` }),
          h('label', { class: 'sound-slider' }, h('span', { text: 'Wave' }), h('select', {
            aria: { label: `Layer ${i + 1} wave` }, on: { change: (e) => { edit(D.setLayerValue(sounds[current], i, 'wave',
              e.target.value)); listen(); } },
          }, ...D.WAVES.map((w) => h('option', { value: w, text: w, selected: layer.wave === w })))),
          ...SLIDERS.map(([k, label, min, max, step]) => slider(
            label, layer[k] ?? (k === 'start' ? 0 : k === 'length' ? s.duration : D.newLayer()[k] ?? 0), [min, max, step],
            (v) => edit(D.setLayerValue(sounds[current], i, k, v)), listen)),
          ...OPTIONAL.map(([k, label, min, max, step]) => {
            const on = layer[k] !== undefined;
            return h('div', { class: 'sound-optional' },
              h('label', {}, h('input', {
                type: 'checkbox', checked: on, aria: { label: `Layer ${i + 1}: use "${label}"` },
                on: { change: (e) => { edit(e.target.checked ? D.setLayerValue(sounds[current], i, k,
                  k === 'freqEnd' ? layer.freq / 2 : 2000) : D.clearLayerValue(sounds[current], i, k)); draw(); } },
              }), ` ${label}`),
              on ? slider(label, layer[k], [min, max, step], (v) => edit(D.setLayerValue(sounds[current], i, k, v)), listen) : null);
          }),
          button({ text: 'Remove this layer', class: 'small ghost', disabled: s.layers.length <= 1,
            onClick: () => { edit(D.removeLayer(sounds[current], i)); draw(); } })));
        fill(layersEl,
          slider('Whole sound lasts (s)', s.duration, [0.05, 3, 0.01], (v) => edit(D.setDuration(sounds[current], v)), listen),
          ...layers, button({ text: 'Add a layer', icon: 'plus', class: 'small', onClick: () => { edit(D.addLayer(sounds[current])); draw(); } }));
        help.querySelector('pre').textContent = `import soundList from './sounds.js';\nimport { sounds, play } from '@engine/arcade';\n\n`
          + `sounds(soundList);     // give your sounds their names, once\n\n`
          + `play('${current}');          // anywhere in update, for example when a coin is taken`;
        shapeOnly();
      }

      async function newSound(from) {
        const name = await promptText({
          title: 'Name the sound', label: 'Name (for example coin or jump)', value: D.freeName(sounds,
            from === '_blank' ? 'beep' : from), confirmLabel: 'Make it',
          validate: (v) => nameProblem(v.trim(), (n) => n in sounds),
        });
        if (name === undefined) { draw(); return; }
        sounds = { ...sounds, [name.trim()]: from === '_blank' ? D.newSound() : D.preset(from) };
        current = name.trim();
        flush();
        draw();
        listen();
      }
      async function rename() {
        const name = await promptText({
          title: 'Rename the sound', label: 'New name', value: current, confirmLabel: 'Rename',
          validate: (v) => nameProblem(v.trim(), (n) => n !== current && n in sounds),
        });
        if (name === undefined || name.trim() === current) return;
        const next = {};
        for (const [k, v] of Object.entries(sounds)) next[k === current ? name.trim() : k] = v;
        sounds = next;
        current = name.trim();
        flush();
        draw();
      }
      function remove() {
        const next = { ...sounds };
        delete next[current];
        sounds = next;
        current = Object.keys(sounds)[0] ?? null;
        flush();
        draw();
      }

      studio.on('file-changed', (e) => { if (e.path === FILE && studio.project?.readText(FILE) !== lastWritten) load(); });
      studio.on('project', load);
      studio.on('files', () => { if (!studio.project?.has(FILE) && Object.keys(sounds).length === 0) load(); });
      load();
      return { el, focus: () => picker.focus(), onShow: load, dispose: flush };
    },
  };
}
