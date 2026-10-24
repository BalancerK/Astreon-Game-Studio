// The 3D Scene panel: the engine's scene editor (viewport with handles, hierarchy, inspector, undo) inside the studio. The scenes are files in the project
// (`scenes/<name>.json`), so a game can load them and git can see them. The editor is a page in a frame that asks this panel for its scenes through messages.
// It starts only when the panel is first shown, because it uses the graphics card.
import { h, fill } from '../ui/dom.js';
import { answer } from '../../scene3d/bridge.js';

export function scene3dPanel(studio) {
  return {
    id: 'scene3d',
    title: '3D scene',
    icon: 'plus',
    create() {
      const el = h('div', { class: 'panel-body scene3d', 'aria-label': '3D scene' });
      let frame = null;
      let state = 'idle';           // idle, loading, ready, failed
      const note = h('p', { class: 'ship-note', role: 'status' });

      const post = (message) => frame?.contentWindow?.postMessage({ source: 'studio', ...message }, location.origin);

      const onMessage = (e) => {
        if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin || e.data?.source !== 'scene3d') return;
        const m = e.data;
        if (m.t === 'ready') { state = 'ready'; note.textContent = ''; studio.emit('plugin-event', 'scene3d-ready'); }
        else if (m.t === 'failed') { state = 'failed'; note.textContent = `The 3D editor could not start: ${String(m.error).slice(0, 160)}`; }
        else if (m.t === 'request' && Number.isInteger(m.id)) {
          const project = studio.project;
          const reply = project ? answer(project, m.message) : { ok: false, error: 'Open a project first.' };
          if (reply.ok && m.message?.op === 'save') { studio.emit('files'); studio.emit('plugin-event', 'scene3d-saved'); }
          post({ t: 'reply', id: m.id, reply });
        }
      };
      window.addEventListener('message', onMessage);

      function stop() {
        frame?.remove();
        frame = null;
        state = 'idle';
      }

      function start() {
        if (frame || !studio.project) {
          if (!studio.project) note.textContent = 'Open a project first: the scenes are saved in it.';
          return;
        }
        note.textContent = 'Starting the 3D editor…';
        state = 'loading';
        frame = h('iframe', {
          class: 'scene3d-frame', title: '3D scene editor', src: new URL('../../scene3d/scene3d.html', import.meta.url).href,
          allow: 'fullscreen',
        });
        el.append(frame);
      }

      fill(el, note);
      studio.on('project', () => { stop(); if (el.offsetParent) start(); });
      return {
        el,
        focus: () => frame?.focus(),
        onShow: () => start(),
        dispose: () => { window.removeEventListener('message', onMessage); stop(); },
        get state() { return state; },
      };
    },
  };
}
