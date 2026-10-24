import { RealClock } from './clock.js';
import { LinkSimulator, createRng } from './link.js';

/**
 * Wrap any transport so its traffic suffers simulated latency, jitter, loss,
 * duplication, reordering and bandwidth limits. Handy for feeling (and testing)
 * prediction and interpolation on a fast local connection.
 *
 * Note: this adds conditions on top of the real link, and models the
 * reliable channel's head-of-line blocking like `LinkSimulator` does.
 *
 * @template {import('./types.js').Transport} T
 * @param {T} inner
 * @param {object} [o]
 * @param {import('./link.js').LinkConfig} [o.up] Conditions for what this side sends.
 * @param {import('./link.js').LinkConfig} [o.down] Conditions for what this side receives.
 * @param {import('./clock.js').Clock} [o.clock] Defaults to wall time.
 * @param {number} [o.seed]
 * @returns {import('./types.js').Transport & {inner: T, onOpen: (() => void) | null}}
 */
export function simulateLink(inner, { up = {}, down = {}, clock = new RealClock(), seed = 1 } = {}) {
  const rng = createRng(seed);
  const upLink = new LinkSimulator(clock, rng, up);
  const downLink = new LinkSimulator(clock, rng, down);
  const wrapper = {
    inner,
    onMessage: null,
    stats: inner.stats,
    get state() { return inner.state; },
    get onClose() { return inner.onClose; },
    set onClose(fn) { inner.onClose = fn; },
    get onOpen() { return inner.onOpen ?? null; },
    set onOpen(fn) { inner.onOpen = fn; },
    send(bytes, channel) {
      if (inner.state === 'closed') return false;
      const copy = bytes.slice();
      upLink.transmit(channel ?? 0, copy.length, () => inner.send(copy, channel));
      return true;
    },
    close(reason) { inner.close(reason); },
    links: { up: upLink, down: downLink },
  };
  inner.onMessage = (bytes, channel) => {
    const copy = bytes.slice();
    downLink.transmit(channel, copy.length, () => wrapper.onMessage?.(copy, channel));
  };
  return wrapper;
}
