import { describePacket } from '../../protocol/src/index.js';
import { tapTransport } from '../../transport/src/index.js';
import { TimeSeries } from './time-series.js';
import { PacketLog } from './packet-log.js';

/**
 * @typedef {Object} SeriesDef
 * @property {string} [label]
 * @property {string} [unit]
 * @property {() => number} read Current value (or a cumulative counter when `rate` is set).
 * @property {boolean} [rate] `read` is a running total: plot its change per second instead.
 * @property {number} [scale] Multiplier applied to the value (e.g. 1/1024 for bytes -> KB).
 * @property {string} [color]
 * @property {number | null} [warnAbove]
 * @property {number} [min]
 * @property {number | null} [max]
 * @property {number} [decimals]
 */

/**
 * The data side of the debug overlay: named series sampled on a timer, info lines, and a packet log.
 * No DOM here, so it is fully testable in Node.
 */
export class OverlayModel {
  /**
   * @param {object} [o]
   * @param {() => number} [o.now]
   * @param {number} [o.samples] History length per series.
   * @param {number} [o.packetCapacity]
   */
  constructor({ now = () => performance.now(), samples = 100, packetCapacity = 200 } = {}) {
    this.now = now;
    this.samples = samples;
    this.packets = new PacketLog(packetCapacity);
    /** @type {Map<string, {def: SeriesDef & {label: string, unit: string, scale: number, decimals: number}, data: TimeSeries, prevRaw: number, prevTime: number}>} */
    this.series = new Map();
    /** @type {{label: string, read: () => string}[]} */
    this.infos = [];
    this.startedAt = now();
  }

  /**
   * @param {string} name
   * @param {SeriesDef} def
   */
  addSeries(name, def) {
    this.series.set(name, {
      def: { label: name, unit: '', scale: 1, decimals: 1, ...def },
      data: new TimeSeries(this.samples),
      prevRaw: NaN,
      prevTime: NaN,
    });
    return this;
  }

  /** @param {string} label @param {() => string} read */
  addInfo(label, read) {
    this.infos.push({ label, read });
    return this;
  }

  /** Read every series once. Call at a steady interval (the overlay does, every 100 ms). */
  sample() {
    const t = this.now();
    for (const s of this.series.values()) {
      let v = NaN;
      try {
        const raw = s.def.read();
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          if (s.def.rate) {
            if (!Number.isNaN(s.prevRaw) && t > s.prevTime) v = ((raw - s.prevRaw) / ((t - s.prevTime) / 1000)) * s.def.scale;
            s.prevRaw = raw;
            s.prevTime = t;
          } else {
            v = raw * s.def.scale;
          }
        }
      } catch { /* a failing probe must never break the game */ }
      s.data.push(v);
    }
  }

  /** @returns {[string, string][]} Label/value pairs; failing readers show "?". */
  infoLines() {
    return this.infos.map(({ label, read }) => {
      try { return [label, String(read())]; } catch { return [label, '?']; }
    });
  }

  /**
   * Wrap a transport so every packet in or out is decoded and logged. Pass the returned wrapper to your client.
   * @template {import('../../transport/src/index.js').Transport} T
   * @param {T} transport
   */
  tap(transport) {
    return tapTransport(transport, (e) => {
      const d = describePacket(e.bytes);
      this.packets.add({ time: e.time, dir: e.dir, channel: e.channel, size: e.bytes.length, type: d.type, summary: d.summary });
    }, this.now);
  }
}
