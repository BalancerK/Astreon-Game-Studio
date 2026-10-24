// The Rig panel's logic: find the skeletons in a project (JSON files in the engine's skeleton format, see packages/skeleton2d), read one, say what is in it (bones, skins, animations and how
// long they run), and say which of its pictures are missing from the project. Pure functions and numbers, so it all runs in Node tests; the panel draws with the engine's renderer.
import { parseSkeleton } from '../../../packages/skeleton2d/src/index.js';

/** Where a new rig is written. */
export const RIG_DIR = 'rigs/';

/** Is this file probably a skeleton? Any JSON file in `rigs/`, or one whose name says skeleton. @param {string} path */
export const isRigPath = (path) => /\.json$/i.test(path) && (path.startsWith(RIG_DIR) || /skeleton/i.test(path.split('/').pop()));

/** The skeleton files of a project, in order. @param {string[]} paths */
export const findRigs = (paths) => paths.filter(isRigPath).sort();

/**
 * Read a skeleton file.
 * @param {string} text
 * @returns {{data: import('../../../packages/skeleton2d/src/index.js').SkeletonData | null, problem: string}}
 */
export function readRig(text) {
  try {
    return { data: parseSkeleton(text), problem: '' };
  } catch (error) {
    return { data: null, problem: String(error?.message ?? error) };
  }
}

/**
 * What is in a skeleton, as numbers and names.
 * @param {import('../../../packages/skeleton2d/src/index.js').SkeletonData} data
 * @returns {{name: string, bones: number, slots: number, skins: string[], animations: Array<{name: string, duration: number}>, events: string[], pictures: string[]}}
 */
export function summarize(data) {
  return {
    name: data.name,
    bones: data.bones.length,
    slots: data.slots.length,
    skins: [...data.skins.keys()],
    animations: [...data.animations.entries()].map(([name, a]) => ({ name, duration: Math.round(a.duration * 1000) / 1000 })),
    events: [...data.events.keys()],
    pictures: pictureNames(data),
  };
}

/** Every picture name the skeleton's attachments use (regions and meshes), once each, in order. @param {import('../../../packages/skeleton2d/src/index.js').SkeletonData} data @returns {string[]} */
export function pictureNames(data) {
  const out = new Set();
  for (const skin of data.skins.values()) {
    for (const bySlot of skin.attachments.values()) for (const a of bySlot.values()) if (a.type !== 'boundingbox' && a.path) out.add(a.path);
  }
  return [...out];
}

/** The names a project's pictures can be found by: `images/arm.png` answers to `images/arm` and to `arm`. @param {string[]} paths @returns {Map<string, string>} name to path */
export function pictureIndex(paths) {
  const found = new Map();
  for (const path of paths) {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) continue;
    const full = path.replace(/\.[^.]+$/, '');
    found.set(full, path);
    const base = full.split('/').pop();
    if (!found.has(base)) found.set(base, path);
  }
  return found;
}

/** Which of a skeleton's pictures the project does not have. @param {string[]} names @param {Map<string, string>} index @returns {string[]} */
export const missingPictures = (names, index) => names.filter((n) => !index.has(n.replace(/\.[^.]+$/, '')));

/** A colour for a picture that is missing, the same each time, as `#rrggbb` (so a rig can still be seen without its art). @param {string} name */
export function placeholderColour(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = (h % 360) / 60, c = 0.55, x = c * (1 - Math.abs((hue % 2) - 1)), m = 0.35;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue) % 6];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Make sure an animation name is one the skeleton has, else the first, else null. @param {ReturnType<typeof summarize>} sum @param {string | null} name */
export const animationOr = (sum, name) => (sum.animations.some((a) => a.name === name) ? name : sum.animations[0]?.name ?? null);

/** A small skeleton to start from: a body with a waving arm that bends (a weighted mesh), a head, and two animations. Pictures are `sample/body`, `sample/arm` and `sample/head`. */
export function sampleRig() {
  return {
    skeleton: { name: 'sample' },
    bones: [
      { name: 'root' }, { name: 'body', parent: 'root', y: -30, length: 40 },
      { name: 'head', parent: 'body', x: 58, length: 24 },
      { name: 'upper', parent: 'body', x: 30, y: 14, rotation: 20, length: 36 }, { name: 'lower', parent: 'upper', x: 36, length: 36 },
    ],
    slots: [
      { name: 'arm', bone: 'upper', attachment: 'arm' },
      { name: 'body', bone: 'body', attachment: 'body' },
      { name: 'head', bone: 'head', attachment: 'head' },
    ],
    skins: [{
      name: 'default',
      attachments: {
        body: { body: { type: 'region', path: 'sample/body', x: 20, width: 56, height: 44 } },
        head: { head: { type: 'region', path: 'sample/head', x: 12, width: 30, height: 30 } },
        arm: { arm: {
          type: 'mesh', path: 'sample/arm', uvs: [0, 0, 0, 1, 0.5, 0, 0.5, 1, 1, 0, 1, 1], triangles: [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4],
          // six points: the first two ride the upper arm, the middle two are shared by both bones, the last two ride the lower arm
          vertices: [
            1, 3, 0, -7, 1, 1, 3, 0, 7, 1,
            2, 3, 36, -7, 0.5, 4, 0, -7, 0.5, 2, 3, 36, 7, 0.5, 4, 0, 7, 0.5,
            1, 4, 36, -7, 1, 1, 4, 36, 7, 1,
          ],
        } },
      },
    }],
    events: { clap: {} },
    animations: {
      idle: {
        bones: {
          body: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.8, x: 0, y: 3 }, { time: 1.6, x: 0, y: 0 }] },
          head: { rotate: [{ time: 0, value: 0 }, { time: 0.8, value: 4 }, { time: 1.6, value: 0 }] },
        },
      },
      wave: {
        bones: {
          upper: { rotate: [{ time: 0, value: 0 }, { time: 0.3, value: -70 }, { time: 0.9, value: -40 }, { time: 1.2, value: 0 }] },
          lower: {
            rotate: [{ time: 0, value: 0 }, { time: 0.3, value: 30 }, { time: 0.6, value: -30 }, { time: 0.9, value: 30 }, { time: 1.2, value: 0 }],
          },
        },
        events: [{ time: 0.3, name: 'clap' }],
      },
    },
  };
}
