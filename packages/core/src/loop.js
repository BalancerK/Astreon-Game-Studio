/**
 * Fixed-timestep simulation loop. Runs identically on client and server:
 * the host feeds it elapsed time, it calls `update` at a constant rate and
 * `render` with an interpolation alpha. No timers or DOM inside, so it is
 * trivially testable and deterministic.
 */
export class FixedLoop {
  /**
   * @param {object} opts
   * @param {number} opts.tickRate Simulation ticks per second.
   * @param {(dt: number, tick: number) => void} opts.update Called once per fixed tick (dt in seconds).
   * @param {(alpha: number) => void} [opts.render] Called per frame; alpha in [0,1) between last two ticks.
   * @param {number} [opts.maxFrameTime] Cap on elapsed time per advance, in seconds (spiral-of-death guard).
   */
  constructor({ tickRate, update, render, maxFrameTime = 0.25 }) {
    this.tickRate = tickRate;
    this.dt = 1 / tickRate;
    this.update = update;
    this.render = render;
    this.maxFrameTime = maxFrameTime;
    this.tick = 0;
    this.accumulator = 0;
  }

  /**
   * Advance by `elapsed` seconds of real time.
   * @param {number} elapsed
   * @returns {number} Number of ticks simulated.
   */
  advance(elapsed) {
    this.accumulator += Math.min(elapsed, this.maxFrameTime);
    let steps = 0;
    while (this.accumulator >= this.dt) {
      this.update(this.dt, this.tick++);
      this.accumulator -= this.dt;
      steps++;
    }
    this.render?.(this.accumulator / this.dt);
    return steps;
  }
}
