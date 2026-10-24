// Saved progress: a small piece of plain data that outlives the game (a best score, the level you reached). In the studio it is kept for each project; the game
// asks for it at the start and hands it back to save. A game never touches storage itself, because a game runs in a worker that has no page to store in.

const LIMIT = 20_000;
let current = null;
let sink = (message) => { globalThis.postMessage?.(message); };

/**
 * What was saved last time, or an empty object when nothing was saved.
 * @returns {Object}
 */
export function loadProgress() {
  return structuredClone(globalThis.__engineProgress ?? current ?? {});
}

/**
 * Keep this (numbers, text, true/false, lists and objects of them; at most about 20 KB) for next time.
 * @param {Object} data for example `{ level: 3, best: 120 }`
 */
export function saveProgress(data) {
  const kept = current?.__settings;                       // the player's settings (see settings.js) are kept whatever the game saves
  if (kept !== undefined && data && typeof data === 'object' && data.__settings === undefined) data = { ...data, __settings: kept };
  const json = JSON.stringify(data);
  if (json === undefined || json.length > LIMIT) throw new Error(`saveProgress keeps plain data up to ${LIMIT / 1000} KB: numbers, text, lists and objects.`);
  current = JSON.parse(json);
  globalThis.__engineProgress = structuredClone(current);
  sink({ t: 'save', data: current });
}

/**
 * Where saved progress goes and where it is read from (for tests, or a host that is not the studio).
 * @param {{send?: (message: {t: 'save', data: object}) => void, initial?: object | null}} o
 */
export function setProgressHost({ send, initial = null } = {}) {
  if (send) sink = send;
  current = initial;
  globalThis.__engineProgress = initial === null ? undefined : structuredClone(initial);
}
