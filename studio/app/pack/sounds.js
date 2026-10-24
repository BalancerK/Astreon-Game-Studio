// The free pack's sounds: recipes for the sound maker (layers of waves with a pitch, a fade and so on). The first eight are the sound maker's own starting sounds, and the
// rest are new. Made for this project and given away under CC0. Each one plays by name with `play('coin')` once it is in the project's sounds.
import { PRESETS } from '../paint/sound-model.js';

const L = (wave, freq, o = {}) => ({ wave, freq, gain: 0.5, decay: 0.1, ...o });

/** @type {{name: string, title: string, category: string, tags: string[], recipe: any}[]} */
export const SOUNDS = [
  { name: 'coin', title: 'Coin', category: 'Collect', tags: ['pickup', 'money', 'bling'], recipe: PRESETS.coin },
  { name: 'powerup', title: 'Power up', category: 'Collect', tags: ['pickup', 'bonus', 'rise'], recipe: PRESETS.powerup },
  { name: 'jump', title: 'Jump', category: 'Movement', tags: ['hop', 'platformer'], recipe: PRESETS.jump },
  { name: 'hit', title: 'Hit', category: 'Fighting', tags: ['hurt', 'impact', 'damage'], recipe: PRESETS.hit },
  { name: 'laser', title: 'Laser', category: 'Fighting', tags: ['shoot', 'space', 'zap'], recipe: PRESETS.laser },
  { name: 'explosion', title: 'Explosion', category: 'Fighting', tags: ['boom', 'bomb', 'big'], recipe: PRESETS.explosion },
  { name: 'click', title: 'Click', category: 'Menu', tags: ['button', 'tick'], recipe: PRESETS.click },
  { name: 'lose', title: 'Lose', category: 'Jingles', tags: ['fail', 'game over', 'sad'], recipe: PRESETS.lose },
  {
    name: 'win', title: 'Win', category: 'Jingles', tags: ['victory', 'level', 'happy', 'fanfare'],
    recipe: {
      duration: 0.9, seed: 1,
      layers: [L('square', 523, { decay: 0.08, length: 0.1 }), L('square', 659, { start: 0.1, decay: 0.08, length: 0.1 }), L('square', 784, { start: 0.2, decay: 0.08, length: 0.1 }),
        L('square', 1047, { start: 0.3, decay: 0.3, length: 0.4, gain: 0.55 }), L('triangle', 523, { start: 0.3, decay: 0.35, length: 0.45, gain: 0.5 })],
    },
  },
  {
    name: 'select', title: 'Select', category: 'Menu', tags: ['choose', 'button', 'blip'],
    recipe: { duration: 0.12, seed: 1, layers: [L('square', 660, { decay: 0.03, length: 0.05, gain: 0.4 }), L('square', 990, { start: 0.05, decay: 0.04, length: 0.06, gain: 0.4 })] },
  },
  {
    name: 'back', title: 'Back', category: 'Menu', tags: ['cancel', 'button', 'blip'],
    recipe: { duration: 0.14, seed: 1, layers: [L('square', 880, { freqEnd: 440, decay: 0.05, length: 0.1, gain: 0.35 })] },
  },
  {
    name: 'error', title: 'Error', category: 'Menu', tags: ['wrong', 'no', 'buzz', 'denied'],
    recipe: { duration: 0.3, seed: 1, layers: [L('saw', 140, { decay: 0.12, length: 0.12, gain: 0.45, lowpass: 1800 }), L('saw', 120, { start: 0.14, decay: 0.12, length: 0.14, gain: 0.45, lowpass: 1500 })] },
  },
  {
    name: 'pickup', title: 'Pick up', category: 'Collect', tags: ['grab', 'item', 'soft'],
    recipe: { duration: 0.2, seed: 1, layers: [L('sine', 520, { freqEnd: 780, decay: 0.07, length: 0.1, gain: 0.7 }), L('triangle', 1040, { start: 0.06, decay: 0.08, length: 0.1, gain: 0.35 })] },
  },
  {
    name: 'heal', title: 'Heal', category: 'Collect', tags: ['health', 'life', 'sparkle', 'magic'],
    recipe: {
      duration: 0.6, seed: 1,
      layers: [L('sine', 523, { decay: 0.1, length: 0.12, gain: 0.55 }), L('sine', 659, { start: 0.1, decay: 0.1, length: 0.12, gain: 0.55 }), L('sine', 784, { start: 0.2, decay: 0.1, length: 0.12, gain: 0.55 }),
        L('sine', 1047, { start: 0.3, decay: 0.25, length: 0.3, gain: 0.5 })],
    },
  },
  {
    name: 'door', title: 'Door', category: 'World', tags: ['open', 'wood', 'thud', 'creak'],
    recipe: { duration: 0.5, seed: 3, layers: [L('noise', 440, { lowpass: 700, lowpassEnd: 200, decay: 0.12, length: 0.15, gain: 0.8 }), L('sine', 90, { freqEnd: 50, decay: 0.15, length: 0.2, gain: 0.8 })] },
  },
  {
    name: 'splash', title: 'Splash', category: 'World', tags: ['water', 'swim', 'drop'],
    recipe: { duration: 0.6, seed: 4, layers: [L('noise', 440, { lowpass: 6000, lowpassEnd: 800, decay: 0.2, length: 0.4, gain: 0.7 }), L('sine', 300, { freqEnd: 120, decay: 0.1, length: 0.15, gain: 0.4 })] },
  },
  {
    name: 'step', title: 'Footstep', category: 'Movement', tags: ['walk', 'tap', 'run'],
    recipe: { duration: 0.1, seed: 5, layers: [L('noise', 440, { lowpass: 1200, decay: 0.03, length: 0.05, gain: 0.7 }), L('sine', 110, { freqEnd: 70, decay: 0.04, length: 0.06, gain: 0.4 })] },
  },
  {
    name: 'whoosh', title: 'Whoosh', category: 'Movement', tags: ['swing', 'dash', 'air', 'fast'],
    recipe: { duration: 0.4, seed: 6, layers: [L('noise', 440, { lowpass: 400, lowpassEnd: 7000, decay: 0.15, length: 0.3, gain: 0.7 })] },
  },
  {
    name: 'bounce', title: 'Bounce', category: 'Movement', tags: ['spring', 'boing', 'rubber'],
    recipe: { duration: 0.35, seed: 1, layers: [L('sine', 180, { freqEnd: 520, decay: 0.15, length: 0.25, gain: 0.8 }), L('triangle', 360, { freqEnd: 1040, decay: 0.12, length: 0.2, gain: 0.3 })] },
  },
  {
    name: 'blip', title: 'Blip', category: 'Menu', tags: ['beep', 'text', 'dialog', 'tiny'],
    recipe: { duration: 0.08, seed: 1, layers: [L('square', 740, { decay: 0.02, length: 0.04, gain: 0.35, duty: 0.25 })] },
  },
  {
    name: 'countdown', title: 'Countdown beep', category: 'Menu', tags: ['timer', 'ready', 'beep', 'start'],
    recipe: { duration: 0.3, seed: 1, layers: [L('sine', 880, { decay: 0.12, length: 0.18, gain: 0.8 })] },
  },
  {
    name: 'alarm', title: 'Alarm', category: 'World', tags: ['siren', 'danger', 'warning', 'beep'],
    recipe: {
      duration: 0.8, seed: 1,
      layers: [L('square', 880, { decay: 0.15, length: 0.18, gain: 0.35 }), L('square', 660, { start: 0.2, decay: 0.15, length: 0.18, gain: 0.35 }),
        L('square', 880, { start: 0.4, decay: 0.15, length: 0.18, gain: 0.35 }), L('square', 660, { start: 0.6, decay: 0.15, length: 0.18, gain: 0.35 })],
    },
  },
  {
    name: 'magic', title: 'Magic', category: 'Fighting', tags: ['spell', 'sparkle', 'cast', 'wand'],
    recipe: {
      duration: 0.8, seed: 7,
      layers: [L('saw', 300, { freqEnd: 1500, decay: 0.35, length: 0.5, gain: 0.35, lowpass: 5000 }), L('sine', 1200, { start: 0.2, freqEnd: 2400, decay: 0.2, length: 0.4, gain: 0.35 }),
        L('triangle', 1800, { start: 0.4, decay: 0.2, length: 0.3, gain: 0.25 })],
    },
  },
  {
    name: 'shoot', title: 'Shoot', category: 'Fighting', tags: ['gun', 'bullet', 'fire', 'pew'],
    recipe: { duration: 0.2, seed: 8, layers: [L('noise', 440, { lowpass: 5000, lowpassEnd: 600, decay: 0.05, length: 0.1, gain: 0.7 }), L('square', 600, { freqEnd: 120, decay: 0.06, length: 0.12, gain: 0.4, duty: 0.3 })] },
  },
  {
    name: 'thud', title: 'Thud', category: 'World', tags: ['drop', 'land', 'heavy', 'fall'],
    recipe: { duration: 0.3, seed: 9, layers: [L('sine', 90, { freqEnd: 40, decay: 0.12, length: 0.2, gain: 1 }), L('noise', 440, { lowpass: 500, decay: 0.04, length: 0.06, gain: 0.5 })] },
  },
  {
    name: 'ping', title: 'Ping', category: 'Menu', tags: ['notify', 'bell', 'ding', 'message'],
    recipe: { duration: 0.7, seed: 1, layers: [L('sine', 1319, { decay: 0.35, length: 0.6, gain: 0.7 }), L('sine', 2637, { decay: 0.2, length: 0.4, gain: 0.2 })] },
  },
];
