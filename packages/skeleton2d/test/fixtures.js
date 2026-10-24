import { parseSkeleton, Skeleton } from '../src/index.js';

/** A small rig used by the tests: a root, a hip with a torso and a two-bone arm, a head, an IK target, a weighted mesh cape, a bounding box, two skins, events and a few animations. */
export const RIG = {
  skeleton: { name: 'test-rig' },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', x: 0, y: -50, length: 10 },
    { name: 'torso', parent: 'hip', x: 0, y: 0, rotation: -90, length: 40 },
    { name: 'upper', parent: 'torso', x: 40, y: 0, rotation: 90, length: 30 },
    { name: 'lower', parent: 'upper', x: 30, y: 0, length: 30 },
    { name: 'hand-target', parent: 'root', x: 60, y: -80 },
    { name: 'head', parent: 'torso', x: 40, y: 0, rotation: 0, length: 20 },
  ],
  slots: [
    { name: 'torso', bone: 'torso', attachment: 'torso' },
    { name: 'arm', bone: 'upper', attachment: 'arm' },
    { name: 'cape', bone: 'torso', attachment: 'cape' },
    { name: 'glow', bone: 'head', attachment: 'glow', blend: 'additive', color: 'ffffff80' },
    { name: 'hit', bone: 'torso', attachment: 'hit' },
  ],
  ik: [{ name: 'arm-ik', bones: ['upper', 'lower'], target: 'hand-target', mix: 0, bend: 1 }],
  events: { footstep: { int: 1, float: 0.5, string: 'left' }, swing: {} },
  skins: [
    {
      name: 'default',
      attachments: {
        torso: { torso: { type: 'region', path: 'rig/torso', width: 40, height: 20, x: 20 } },
        arm: { arm: { type: 'region', path: 'rig/arm', width: 60, height: 10, x: 30 }, 'arm-alt': { type: 'region', path: 'rig/arm', width: 60, height: 20, x: 30 } },
        cape: { cape: { type: 'mesh', path: 'rig/cape', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], vertices: [0, -10, 0, 10, 40, 10, 40, -10], color: 'ff8000ff' } },
        glow: { glow: { type: 'region', path: 'rig/glow', width: 16, height: 16 } },
        hit: { hit: { type: 'boundingbox', vertices: [0, -10, 40, -10, 40, 10, 0, 10] } },
      },
    },
    { name: 'alt', attachments: { torso: { torso: { type: 'region', path: 'rig/torso-alt', width: 40, height: 20, x: 20 } } } },
  ],
  animations: {
    idle: { bones: { head: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 20 }, { time: 2, value: 0 }] } } },
    lean: { bones: { torso: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 30 }] }, hip: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 10, y: -5 }] } } },
    wave: { bones: { upper: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: -60 }, { time: 1, value: 0 }] } } },
    spin: { bones: { head: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 720 }] } } },
    step: { bones: { head: { rotate: [{ time: 0, value: 0, curve: 'stepped' }, { time: 1, value: 40 }] } } },
    ease: { bones: { head: { rotate: [{ time: 0, value: 0, curve: [0.42, 0, 0.58, 1] }, { time: 1, value: 100 }] } } },
    grow: { bones: { head: { scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: 2, y: 3 }], shear: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 10, y: 0 }] } } },
    swap: { slots: { arm: { attachment: [{ time: 0, name: 'arm' }, { time: 0.5, name: 'arm-alt' }, { time: 1, name: null }], color: [{ time: 0, color: 'ffffffff' }, { time: 1, color: 'ff000080' }] } } },
    flap: { deform: { default: { cape: { cape: [{ time: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] }, { time: 1, vertices: [0, 0, 0, 0, 10, 20, 10, 20] }] } } } },
    reorder: { drawOrder: [{ time: 0.5, offsets: [{ slot: 'torso', offset: 2 }] }, { time: 1 }] },
    reach: { ik: { 'arm-ik': [{ time: 0, mix: 0 }, { time: 1, mix: 1, bend: -1 }] } },
    walk: { bones: { hip: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 100, y: 0 }] } }, events: [{ time: 0.25, name: 'footstep' }, { time: 0.75, name: 'footstep', int: 2 }, { time: 1, name: 'swing' }] },
  },
};

/** @param {object} [patch] Fields to replace in the rig. */
export const makeData = (patch = {}) => parseSkeleton({ ...RIG, ...patch });
export const makeSkeleton = (patch) => new Skeleton(makeData(patch));
export const near = (assert, a, b, eps = 1e-4, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
