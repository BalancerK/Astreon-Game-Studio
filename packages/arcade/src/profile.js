// Timing parts of your game. Wrap a piece of work in `timed('name', () => ...)` and the studio's Profiler panel shows how long it takes in every frame, next to
// the time the game spends updating and drawing. Outside the studio (or with the Profiler not recording) it does nothing but run your function, so it can stay
// in the game you ship.

/**
 * Run a function and, when the studio's Profiler is recording, add how long it took to the frame's time under `name`. The function's result is returned.
 * @template T
 * @param {string} name for example 'enemies' or 'pathfinding' (up to 24 characters)
 * @param {() => T} fn
 * @returns {T}
 */
export function timed(name, fn) {
  const sink = globalThis.__engineProfile;
  if (!sink) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    sink.mark(name, performance.now() - start);
  }
}
