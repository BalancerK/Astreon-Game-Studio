// The arena's menus, built from @engine/ui: a pause menu, a settings screen (sound, controls, display) and a room browser.
import { Button, menuScreen, settingsScreen, roomBrowser } from '../../../packages/ui/src/index.js';

const SETTINGS_KEY = 'arena3d.settings', BINDINGS_KEY = 'arena3d.bindings';
const DEFAULTS = { master: 1, sfx: 1, music: 0.6, uiScale: 1, debug: false, post: true, shadows: 2 };

const read = (key) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: settings last for this visit only */ } };

/**
 * @param {object} o
 * @param {import('../../../packages/ui/src/ui.js').Ui} o.ui
 * @param {import('../../../packages/input/src/core.js').InputCore} o.input
 * @param {{lock: () => Promise<boolean>}} o.mouse
 * @param {() => any} o.getSound The sound engine wrapper, once the browser let it start (or null).
 * @param {(value?: boolean) => boolean} o.debug Reads (no argument) or sets the debug overlay.
 * @param {() => void} o.onScale Called after the interface size changed.
 */
export function createArenaMenus({ ui, input, mouse, getSound, debug, onScale }) {
  const settings = { ...DEFAULTS, ...read(SETTINGS_KEY) };
  if (settings.debug) debug(true);
  const save = () => write(SETTINGS_KEY, settings);

  /** Apply the saved volumes to the sound engine (call again when it starts). */
  function applyAudio() {
    const audio = getSound()?.audio;
    if (!audio) return;
    audio.setVolume('master', settings.master); audio.setVolume('sfx', settings.sfx); audio.setVolume('music', settings.music);
  }
  const volume = (label, key) => ({ type: 'slider', label, get: () => settings[key], set: (v) => { settings[key] = v; save(); applyAudio(); } });

  function openSettings() {
    const screen = settingsScreen(ui, {
      title: 'Settings',
      tabs: [
        { title: 'Sound', rows: [volume('Master volume', 'master'), volume('Effects', 'sfx'), volume('Music', 'music'), { type: 'label', text: 'M mutes everything, N mutes the music.' }] },
        {
          title: 'Controls',
          rows: [
            { type: 'bindings', input, actions: [{ action: 'jump', label: 'Jump' }, { action: 'run', label: 'Run' }, { action: 'fire', label: 'Fire' }], onChange: () => write(BINDINGS_KEY, input.serialize()) },
            { type: 'label', text: 'Movement and looking are set by the game. Click a control, then press the new one.' },
          ],
        },
        {
          title: 'Display',
          rows: [
            { type: 'choice', label: 'Interface size', options: [{ value: 0.85, label: 'Small' }, { value: 1, label: 'Normal' }, { value: 1.25, label: 'Large' }], get: () => settings.uiScale, set: (v) => { settings.uiScale = v; save(); onScale(); } },
            { type: 'choice', label: 'Shadows', options: [{ value: 0, label: 'Off' }, { value: 1, label: 'Normal' }, { value: 2, label: 'Detailed (3 maps)' }], get: () => settings.shadows, set: (v) => { settings.shadows = v; save(); } },
            { type: 'toggle', label: 'Bloom and tone mapping', get: () => settings.post, set: (v) => { settings.post = v; save(); } },
            { type: 'toggle', label: 'Debug overlay (F3)', get: () => debug(), set: (v) => { debug(v); settings.debug = v; save(); } },
          ],
        },
      ],
    });
    return ui.push(screen);
  }

  async function fetchRooms() {
    const res = await fetch('/rooms');
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();
    return (json.rooms ?? []).map((r) => ({ name: r.name, players: r.players, max: r.maxPlayers }));
  }

  function openRooms() {
    const here = new URLSearchParams(location.search).get('room') ?? 'lobby';
    const screen = roomBrowser(ui, {
      title: `Rooms (you are in "${here}")`, name: null, fetchRooms,
      onJoin: (room) => { const p = new URLSearchParams(location.search); p.set('room', room); location.assign(`${location.pathname}?${p}`); },
    });
    return ui.push(screen);
  }

  function open() {
    if (ui.isOpen) return null;
    ui.noteDevice(input.lastDevice);
    const resume = () => { ui.closeAll(); if (input.lastDevice === 'mouse' || input.lastDevice === 'keyboard') mouse.lock(); };
    const menu = menuScreen(ui, {
      title: 'Paused', subtitle: `room "${new URLSearchParams(location.search).get('room') ?? 'lobby'}"`,
      items: [
        { text: 'Resume', variant: 'primary', onClick: resume },
        { text: 'Rooms', onClick: openRooms },
        { text: 'Settings', onClick: openSettings },
      ],
    });
    return ui.push(menu);
  }

  const menuButton = new Button('Menu', { onClick: open, anchor: 'top-right', offsetX: -12, offsetY: 12 });
  ui.hud.add(menuButton);

  return { settings, save, applyAudio, open, openSettings, openRooms, menuButton, BINDINGS_KEY };
}
