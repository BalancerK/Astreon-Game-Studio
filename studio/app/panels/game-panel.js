// The Game panel: the game running in its frame (on another origin, in a worker: see studio/runner), with Run and Stop and a line saying what it is doing.
//
// The frame lives OUTSIDE the dock, in a layer of its own, and is laid over the panel's empty "slot". A frame that is moved in the page reloads, which would
// restart the game every time a panel is dragged or a tab is switched; this way the game keeps running while the layout changes around it.
import { h, button } from '../ui/dom.js';

const STATUS_TEXT = { starting: 'starting…', running: 'running', error: 'fix the error', stuck: 'not responding', stopped: 'stopped' };

/** A button that is either on or off, and shows which. */
function toggleButton(studio) {
  return (text, label, command, state) => {
    const b = h('button', {
      type: 'button', class: 'btn small ghost', text, title: label, dataset: { toggle: command },
      aria: { pressed: String(state()), label },
      on: { click: () => studio.commands.execute(command) },
    });
    b.__state = state;
    return b;
  };
}

export function gamePanel(studio) {
  return {
    id: 'game',
    title: 'Game',
    icon: 'play',
    create() {
      const toggle = toggleButton(studio);
      const status = h('span', { class: 'status', role: 'status', text: STATUS_TEXT.starting });
      const latency = h('span', { class: 'meta', style: { color: 'var(--dim)', fontSize: '12px' } });
      const slot = h('div', { class: 'game-slot', style: { flex: '1', minHeight: '0', background: '#0d1017' } });
      const summary = h('div', { class: 'summary', 'aria-label': 'Game status line' });
      const toolbar = h('div', { class: 'toolbar game-bar' },
        button({
          label: 'Run the game from the start', text: 'Run', icon: 'play', class: 'small primary', onClick: () => studio.commands.execute('game.run'),
        }),
        button({ label: 'Stop the game', text: 'Stop', icon: 'stop', class: 'small', onClick: () => studio.commands.execute('game.stop') }),
        h('button', {
          type: 'button', class: 'btn small ghost', text: studio.prefs.get('muted', false) ? 'Sound off' : 'Sound on',
          aria: { pressed: studio.prefs.get('muted', false), label: 'Mute the game\'s sound' },
          on: {
            click: (e) => {
              const muted = !studio.prefs.get('muted', false);
              studio.prefs.set('muted', muted);
              studio.runner.mute(muted);
              e.currentTarget.textContent = muted ? 'Sound off' : 'Sound on';
              e.currentTarget.setAttribute('aria-pressed', String(muted));
            },
          },
        }),
        button({
          label: 'Play the game full screen (Alt+Enter). Esc leaves.', text: 'Full screen', class: 'small ghost',
          onClick: () => studio.commands.execute('game.fullscreen'),
        }),
        toggle('Pick', 'Pick things by clicking them in the game (holding Alt while clicking does the same)', 'game.pick',
          () => studio.runner.pickMode),
        toggle('Debug', 'Show the numbers on the game (F3)', 'game.debug', () => studio.runner.overlayOn),
        status, latency);
      const el = h('div', { class: 'panel-body', 'aria-label': 'Game' }, toolbar, slot, summary);

      studio.on('debug-change', () => {
        for (const b of toolbar.querySelectorAll('[data-toggle]')) b.setAttribute('aria-pressed', String(b.__state()));
      });

      const frame = studio.runner.createFrame({ class: 'game-frame', title: 'The game', tabindex: '0' });
      Object.assign(frame.style, { position: 'fixed', zIndex: '5', display: 'none', left: '0', top: '0', width: '0', height: '0' });
      document.body.append(frame);

      /** Put the frame exactly over the slot, or hide it (and tell the game) when the slot cannot be seen. */
      let wasShown = null;
      const place = () => {
        const r = slot.getBoundingClientRect();
        const shown = slot.offsetParent !== null && !slot.closest('[hidden]') && r.width > 1 && r.height > 1;
        if (shown) {
          Object.assign(frame.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        } else {
          frame.style.display = 'none';
        }
        if (shown !== wasShown) { wasShown = shown; studio.runner.visible(shown); }
      };
      new ResizeObserver(place).observe(slot);
      addEventListener('resize', place);
      studio.dock.on('layout', () => queueMicrotask(place));
      // the slot is rebuilt with the dock; look again after any change to the page's structure around it
      new MutationObserver(() => requestAnimationFrame(place)).observe(document.getElementById('dock'), {
        childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'],
      });
      requestAnimationFrame(place);

      document.addEventListener('fullscreenchange', () => { place(); if (studio.runner.isFullscreen) frame.focus(); });
      studio.on('runner-status', (s) => { status.className = `status ${s}`; status.textContent = STATUS_TEXT[s] ?? s; });
      studio.on('runner-applied', (e) => { latency.textContent = `updated in ${e.ms} ms${e.restarted ? '' : ' (kept your place)'}`; });
      studio.on('runner-summary', () => { summary.textContent = studio.runner.summary == null ? '' : JSON.stringify(studio.runner.summary); });

      return { el, focus: () => frame.focus(), onShow: place };
    },
  };
}
