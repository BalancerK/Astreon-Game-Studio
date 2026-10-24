// The size of the game's screen and its background colour, as set in the project's settings. The page that runs the game puts them in
// `globalThis.__engineSettings`; without it (a test, another host) the usual 480 by 320 is used.

/**
 * How big the screen is and what colour its background is.
 * @returns {{width: number, height: number, background: string}}
 */
export function screen() {
  const s = globalThis.__engineSettings;
  return { width: s?.width ?? 480, height: s?.height ?? 320, background: s?.background ?? '#12161f' };
}
