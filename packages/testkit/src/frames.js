// Timing a page's frames from a script: a steady average over a window (after the time a page needs to compile its shaders), and the Chrome flags that make timing honest.

/** Chrome flags that stop the display's pace from capping the frame rate, so a frame's cost can be read from how many there are. */
export const UNTHROTTLED_ARGS = Object.freeze(['--disable-gpu-vsync', '--disable-frame-rate-limit']);

/**
 * Chrome flags that draw on the CPU (a software graphics card). It is far slower than any real card and balances work differently (it has no early depth test, for one), so it cannot say how fast a
 * game runs on a given card; it does show what scales with the picture (pixels, passes), and by how much, on a machine with no slow card to hand.
 */
export const CPU_RENDER_ARGS = Object.freeze(['--use-angle=swiftshader', '--use-gl=angle']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The average time of a page's animation frames over `seconds`, after `warmSeconds` (a page that compiles big shaders needs a long warm-up on a slow renderer: 45 s for a software one).
 * @param {{eval: (expression: string) => Promise<any>}} page from `withChromePage`
 * @param {{seconds?: number, warmSeconds?: number}} [o]
 * @returns {Promise<{frames: number, ms: number, fps: number}>}
 */
export async function measureFrames(page, { seconds = 10, warmSeconds = 0 } = {}) {
  if (warmSeconds > 0) await sleep(warmSeconds * 1000);
  const r = await page.eval(`new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < ${Math.round(seconds * 1000)}) requestAnimationFrame(tick); else resolve({ frames: n, ms: (performance.now() - t0) / n }); }; requestAnimationFrame(tick); })`);
  return { frames: r.frames, ms: r.ms, fps: 1000 / r.ms };
}
