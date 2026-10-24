// Which build is this? A game made for players (a release) and a game being worked on (a debug build) can behave differently: show the frame rate, skip the title screen,
// start on level 5. The studio's Ship panel makes builds from named profiles, and tells the game which one it is. In the studio itself the answer is a debug build.

/**
 * The build the game is running as.
 * @returns {{name: string, debug: boolean}} the profile's name ('dev' inside the studio) and whether it is a debug build
 */
export function build() {
  const b = globalThis.__engineBuild;
  return { name: typeof b?.name === 'string' ? b.name : 'dev', debug: b ? Boolean(b.debug) : true };
}
