/**
 * Voice limiting: a mix can only carry so many sounds at once, and a machine gun should not fill every slot with the same shot.
 * `VoicePool` decides whether a new sound may start and which running one gives way (the least important, then the oldest).
 * Pure bookkeeping: it never touches Web Audio.
 */

/**
 * @typedef {Object} VoiceEntry
 * @property {number} id
 * @property {string} key Which sound it is (for the per-sound limit)
 * @property {number} priority Higher survives longer
 * @property {number} startedAt
 */

/**
 * Decides which sounds may play. A mix can carry only so many voices at once, and a machine gun should not take every slot with
 * the same shot: `request` says whether a new sound may start and which running one has to give way (the least important, then the
 * oldest). Pure bookkeeping, it never touches Web Audio.
 */
export class VoicePool {
  /**
   * @param {object} [o]
   * @param {number} [o.max] Voices playing at once (default 48)
   */
  constructor({ max = 48 } = {}) {
    if (!(max >= 1)) throw new Error('max must be at least 1');
    this.max = max;
    /** @type {Map<number, VoiceEntry>} */
    this.active = new Map();
    this.nextId = 1;
  }

  get size() { return this.active.size; }

  /** The entry that should give way first among `entries`: lowest priority, then oldest. */
  static #weakest(entries) {
    let best = null;
    for (const e of entries) if (!best || e.priority < best.priority || (e.priority === best.priority && e.startedAt < best.startedAt)) best = e;
    return best;
  }

  /**
   * Ask to start a sound.
   * @param {object} o
   * @param {string} o.key
   * @param {number} [o.priority]
   * @param {number} [o.maxPerSound] At most this many copies of one sound at a time (default: no limit)
   * @param {number} [o.now] Time in seconds (for "oldest")
   * @returns {{granted: boolean, id: number, steal: VoiceEntry | null}} If `steal` is set, stop that voice; if not granted, do not play.
   */
  request({ key, priority = 0, maxPerSound = Infinity, now = 0 }) {
    let steal = null;
    const same = [...this.active.values()].filter((e) => e.key === key);
    if (same.length >= maxPerSound) {
      const weakest = VoicePool.#weakest(same);
      if (weakest.priority > priority) return { granted: false, id: 0, steal: null }; // every copy matters more than this one
      steal = weakest;
    } else if (this.active.size >= this.max) {
      const weakest = VoicePool.#weakest(this.active.values());
      if (weakest.priority > priority) return { granted: false, id: 0, steal: null };
      steal = weakest;
    }
    if (steal) this.active.delete(steal.id);
    const id = this.nextId++;
    this.active.set(id, { id, key, priority, startedAt: now });
    return { granted: true, id, steal };
  }

  /** A voice ended or was stopped. */
  release(id) { return this.active.delete(id); }

  clear() { this.active.clear(); }
}
