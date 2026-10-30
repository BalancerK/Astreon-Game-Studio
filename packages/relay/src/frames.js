// The frames a server broadcasts: for each frame the commands that were used, but only those that changed since the frame before (an unchanged seat is `null`), a checksum now and then so that a machine
// that has gone wrong is noticed, and a history so that frames lost on an unreliable link can be sent again.

/**
 * Make the log of a match's frames.
 * @param {{hashEvery?: number, keep?: number}} [o] `hashEvery` how many frames between checksums (60), `keep` how many frames of history (900)
 */
export function createFrameLog({ hashEvery = 60, keep = 900 } = {}) {
  /** @type {string[]} */ let lastSent = [];
  /** @type {any[]} */ let history = [];
  return {
    /**
     * Make the message for a played frame and keep it.
     * @param {number} frame @param {any[]} inputs the commands used, one for each seat (anything that can be written as JSON) @param {{changes?: any[], hash?: number}} [o] `changes` of who holds a seat from this frame; `hash` what
     * the state was before this frame (kept in the message only every `hashEvery` frames)
     * @returns {{t: 'f', f: number, i: any[], ch?: any[], h?: number}}
     */
    make(frame, inputs, { changes = [], hash } = {}) {
      const strings = inputs.map((c) => JSON.stringify(c));
      const msg = { t: /** @type {const} */ ('f'), f: frame, i: inputs.map((c, i) => (lastSent[i] === strings[i] ? null : c)) };
      lastSent = strings;
      if (changes.length) msg.ch = changes;
      if (hash !== undefined && frame % hashEvery === 0) msg.h = hash;
      history.push(msg);
      if (history.length > keep) history.shift();
      return msg;
    },
    /** Whether a frame carries a checksum (so the state need only be summed for those). @param {number} frame */
    wantsHash(frame) { return frame % hashEvery === 0; },
    /** The commands of the newest frame, as text, for a player who joins now (so that an unchanged seat in the next frame means the same to them). */
    get last() { return lastSent; },
    /** The frames from `from` on, to send again; null if `from` is older than the history (send the whole state instead). @param {number} from */
    since(from) { return history.length && from >= history[0].f ? history.filter((m) => m.f >= from) : null; },
    /** The frames kept. */
    get history() { return history; },
    /** Forget everything (a new match). */
    reset() { lastSent = []; history = []; },
  };
}
