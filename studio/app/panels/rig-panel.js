// The Rig panel: look at a 2D skeleton from the project, play its animations, try its outfits and see where its bones are, drawn by the engine's own renderer. Skeletons are JSON files
// in the engine's skeleton format (see packages/skeleton2d); the panel finds them in rigs/ and can start you off with a sample.
import { h, button, fill } from '../ui/dom.js';
import * as M from '../paint/rig-model.js';
import { RigPreview, RIG_VIEW } from '../paint/rig-preview.js';
import { assetKind, mimeOf } from '../store/assets.js';

const SNIPPET = [
  '// A game made with the engine (@engine/skeleton2d) plays the same file:',
  '//   const data = parseSkeleton(await (await fetch("rigs/sample.json")).json());',
  '//   const hero = new Skeleton(data), state = new AnimationState(data);',
  '//   state.setAnimation(0, "wave", { loop: true });',
  '//   each frame: state.update(dt); state.apply(hero); hero.updateWorldTransform(); drawSkeleton(hero, meshes, atlas);',
].join('\n');

export function rigPanel(studio) {
  return {
    id: 'rig',
    title: 'Rig',
    icon: 'play',
    create() {
      let current = null;                       // the path of the rig being looked at
      let sum = null;
      let problem = '';
      let timer = 0;
      let last = performance.now();
      let loading = 0;
      const preview = new RigPreview();
      const toolbar = h('div', { class: 'toolbar art-bar' });
      const stage = h('div', { class: 'rig-stage', style: { position: 'relative' } });
      const overlay = h('canvas', {
        width: RIG_VIEW.width, height: RIG_VIEW.height,
        style: { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' },
      });
      const info = h('p', { class: 'lab-explain', role: 'status' });
      const controls = h('div', { class: 'lab-controls' });
      const help = h('details', { class: 'art-help' }, h('summary', { text: 'How do I use this in my game?' }),
        h('pre', { class: 'learn-code', text: SNIPPET }));
      const el = h('div', { class: 'panel-body art lab', 'aria-label': 'Rig' }, toolbar, stage, info, controls, help);
      let showBones = false;
      const rigs = () => M.findRigs(studio.project?.list() ?? []);

      async function picture(name) {
        const index = M.pictureIndex(studio.project.list());
        const path = index.get(name.replace(/\.[^.]+$/, ''));
        const bytes = path ? studio.project.read(path) : null;
        if (!(bytes instanceof Uint8Array) || assetKind(path) !== 'image') return null;
        try { return await createImageBitmap(new Blob([bytes], { type: mimeOf(path) })); } catch { return null; }
      }

      async function open(path) {
        const mine = ++loading;
        current = path;
        sum = null;
        problem = '';
        const text = path && studio.project?.has(path) ? studio.project.readText(path) : '';
        const { data, problem: why } = text ? M.readRig(text) : { data: null, problem: path ? 'That file is empty.' : '' };
        if (data) {
          sum = M.summarize(data);
          const canvas = await preview.load(data, picture);
          if (mine !== loading) return;
          if (canvas) {
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', `The skeleton ${sum.name || path}, playing ${preview.animation ?? 'no animation'}`);
            canvas.style.cssText = 'width:100%;height:auto;display:block';
            stage.replaceChildren(canvas, overlay);
          } else problem = `The picture could not be made: ${preview.error}`;
        } else {
          preview.destroy();
          stage.replaceChildren();
          problem = why;
        }
        draw();
      }

      function draw() {
        const files = rigs();
        fill(toolbar,
          h('select', { aria: { label: 'The rig' }, on: { change: (e) => open(e.target.value || null) } },
            h('option', { value: '', text: files.length ? 'Choose a rig…' : 'No rigs yet' }),
            ...files.map((p) => h('option', { value: p, text: p, selected: p === current }))),
          button({ text: 'Add a sample rig', class: 'small', label: 'Add a sample rig', onClick: addSample }),
          button({ text: 'Reload', class: 'small ghost', label: 'Reload', onClick: () => open(current) }));
        if (!sum) {
          const hint = files.length ? 'Choose a rig to look at.'
            : 'Put a skeleton file (JSON) in a folder called rigs, or add the sample to see how it works.';
          info.textContent = problem || hint;
          fill(controls);
          return;
        }
        info.textContent = problem || `${sum.name || 'A skeleton'}: ${sum.bones} bones, ${sum.slots} slots, ${sum.animations.length} animations.`
          + (preview.missing?.length ? ` Missing pictures (drawn as coloured blocks): ${preview.missing.join(', ')}.` : '');
        const slider = (label, min, max, step, value, onInput, format = (v) => String(v)) => {
          const out = h('output', { text: format(value) });
          const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), aria: { label } });
          input.addEventListener('input', () => { out.textContent = format(Number(input.value)); onInput(Number(input.value)); });
          return h('label', { class: 'sound-slider' }, h('span', { text: label }), input, out);
        };
        const length = Math.max(0.1, sum.animations.find((a) => a.name === preview.animation)?.duration ?? 1);
        fill(controls,
          h('label', { class: 'state-line' }, 'Animation ', h('select', { aria: { label: 'Animation' }, on: { change: pick } },
            h('option', { value: '', text: '(setup pose)' }),
            ...sum.animations.map((a) => h('option', {
              value: a.name, text: `${a.name} (${a.duration}s)`, selected: a.name === preview.animation,
            })))),
          sum.skins.length > 1 ? h('label', { class: 'state-line' }, 'Outfit ', h('select', { aria: { label: 'Outfit' }, on: { change: dress } },
            ...sum.skins.map((s) => h('option', { value: s, text: s })))) : null,
          h('div', { class: 'toolbar' },
            button({ text: preview.paused ? 'Play' : 'Pause', class: 'small primary', label: preview.paused ? 'Play' : 'Pause', onClick: toggle }),
            button({ text: 'Restart', class: 'small', label: 'Restart', onClick: () => preview.play(preview.animation) })),
          slider('Moment', 0, length, 0.01, Math.min(length, preview.time % length || 0), scrub, (v) => `${v.toFixed(2)} s`),
          slider('Speed', 0.1, 3, 0.1, preview.speed, (v) => { preview.speed = v; }, (v) => `${v}×`),
          h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: preview.loop, on: { change: looping } }), ' Loop'),
          h('label', { class: 'state-line' }, h('input', { type: 'checkbox', checked: showBones, on: { change: bones } }), ' Show the bones'),
          h('p', { class: 'dim', role: 'status', id: 'rig-events' }));
      }

      const pick = (e) => { preview.play(e.target.value || null); draw(); };
      const dress = (e) => preview.setSkin(e.target.value);
      const toggle = () => { preview.paused = !preview.paused; draw(); };
      const scrub = (v) => { preview.paused = true; preview.seek(v); };
      const looping = (e) => { preview.loop = e.target.checked; preview.play(preview.animation); };
      const bones = (e) => { showBones = e.target.checked; };

      function addSample() {
        let n = 1;
        while (studio.project.has(`${M.RIG_DIR}sample${n > 1 ? n : ''}.json`)) n++;
        const path = `${M.RIG_DIR}sample${n > 1 ? n : ''}.json`;
        studio.project.write(path, `${JSON.stringify(M.sampleRig(), null, 2)}\n`);
        studio.emit('files');
        open(path);
      }

      function tick() {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!el.isConnected || !el.offsetParent || !preview.renderer) return;
        try {
          preview.frame(dt);
          const g = overlay.getContext('2d');
          if (showBones) preview.drawBones(g); else g.clearRect(0, 0, RIG_VIEW.width, RIG_VIEW.height);
          const events = el.querySelector('#rig-events');
          if (events) events.textContent = preview.events.length ? `Events: ${preview.events.slice(-5).join(', ')}` : '';
        } catch (error) { preview.error = String(error?.message ?? error); }
      }
      timer = setInterval(tick, 33);

      studio.on('files', () => {
        const files = rigs();
        if (current && !files.includes(current)) { current = null; sum = null; preview.destroy(); stage.replaceChildren(); }
        draw();
      });
      draw();
      el.rig = { preview, open };                                        // so a test can open a rig and read the picture in the same moment
      return {
        el, focus: () => toolbar.querySelector('select')?.focus(),
        dispose: () => { clearInterval(timer); preview.destroy(); },
        expose: { get preview() { return preview; } },
      };
    },
  };
}
