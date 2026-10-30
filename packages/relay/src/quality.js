// How good a connection is, in one place for the lobby and the cockpit: from the round trip to the server (ms), how much it varies (ms), and how far ahead of what the server has confirmed the pilot is
// playing (ms: that is the lag a pilot feels, since everything beyond it is a guess).

/** @typedef {{bars: 0 | 1 | 2 | 3 | 4, label: string, tone: 'good' | 'fair' | 'poor' | 'lost'}} Quality */

/**
 * How good a connection is: bars (0 to 4), a word and a tone.
 * @param {{ping: number, jitter?: number, ahead?: number, lost?: boolean}} c
 * @returns {Quality}
 */
export function linkQuality({ ping, jitter = 0, ahead = 0, lost = false }) {
  if (lost || !Number.isFinite(ping)) return { bars: 0, label: 'LOST', tone: 'lost' };
  let bad = ping < 60 ? 0 : ping < 110 ? 1 : ping < 180 ? 2 : 3;
  bad += jitter > 50 ? 2 : jitter > 20 ? 1 : 0;
  bad += ahead > 300 ? 1 : 0;
  const bars = /** @type {0 | 1 | 2 | 3 | 4} */ (Math.max(1, 4 - Math.min(3, bad)));
  return bars === 4 ? { bars, label: 'EXCELLENT', tone: 'good' } : bars === 3 ? { bars, label: 'GOOD', tone: 'good' } : bars === 2 ? { bars, label: 'FAIR', tone: 'fair' } : { bars, label: 'POOR', tone: 'poor' };
}

/** The colour of a tone, for pages with their own style. */
export const TONE = Object.freeze({ good: '#6fcf97', fair: '#e0b84a', poor: '#e0594f', lost: '#e0594f' });
