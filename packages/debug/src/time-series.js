/** Fixed-size ring of numbers (oldest overwritten). NaN marks "no data" and is ignored by statistics. */
export class TimeSeries {
  /** @param {number} [capacity] */
  constructor(capacity = 100) {
    this.capacity = capacity;
    this.values = new Float32Array(capacity);
    this.count = 0;
    this.next = 0;
  }

  get length() { return this.count; }

  push(v) {
    this.values[this.next] = v;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** @param {number} i 0 = oldest retained sample. */
  at(i) {
    const start = this.count < this.capacity ? 0 : this.next;
    return this.values[(start + i) % this.capacity];
  }

  clear() { this.count = 0; this.next = 0; }

  /**
   * @param {number} [n] Only the newest n samples.
   * @returns {{last: number, min: number, max: number, avg: number, samples: number}} NaN fields when there is no data.
   */
  stats(n = this.count) {
    const from = Math.max(0, this.count - n);
    let min = Infinity, max = -Infinity, sum = 0, samples = 0;
    for (let i = from; i < this.count; i++) {
      const v = this.at(i);
      if (v !== v) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      samples++;
    }
    return {
      last: this.count ? this.at(this.count - 1) : NaN,
      min: samples ? min : NaN,
      max: samples ? max : NaN,
      avg: samples ? sum / samples : NaN,
      samples,
    };
  }
}
