/**
 * Observe every packet crossing a transport, in both directions, without changing behaviour.
 * Wrap outermost to see what the application sees (after any simulated link conditions).
 *
 * `tap` is called synchronously with a view of the bytes: read or summarise them there, do not keep them.
 *
 * @template {import('./types.js').Transport} T
 * @param {T} inner
 * @param {(event: {dir: 'in' | 'out', bytes: Uint8Array, channel: import('./types.js').Channel, time: number}) => void} tap
 * @param {() => number} [now]
 * @returns {import('./types.js').Transport & {inner: T, onOpen: (() => void) | null}}
 */
export function tapTransport(inner, tap, now = () => performance.now()) {
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
      const ok = inner.send(bytes, channel);
      if (ok) tap({ dir: 'out', bytes, channel: channel ?? 0, time: now() });
      return ok;
    },
    close(reason) { inner.close(reason); },
  };
  inner.onMessage = (bytes, channel) => {
    tap({ dir: 'in', bytes, channel, time: now() });
    wrapper.onMessage?.(bytes, channel);
  };
  return wrapper;
}
