// The pathways the studio offers. A pathway is a list of stages; each stage is a list of missions (see session.js). Content lives in code, not in data
// files, because a mission's check is a function that reads the project.
import { STAGE_1 } from './stage1.js';
import { STAGE_2, LEVELS_FILE } from './stage2.js';
import { STAGE_3 } from './stage3.js';
import { STAGE_4, LEVEL_TWO_FILE } from './stage4.js';
import { STAGE_5 } from './stage5.js';
import { STAGE_6 } from './stage6.js';
import { STAGE_7 } from './stage7.js';
import { STAGE_8 } from './stage8.js';
import { STAGE_WALK, STAGE_GAME } from './stage9.js';

/** @type {Record<string, {id: string, title: string, blurb: string, template: string, stages: import('./session.js').Stage[]}>} */
export const PATHWAYS = {
  hero: {
    id: 'hero',
    title: 'Make a game',
    blurb: 'A guided route from your first running game to a whole game with your own art, levels and sounds, '
      + 'then how online games work and how to put yours on the web. You change a real project step by step.',
    template: 'hero',
    stages: [STAGE_1, STAGE_2, STAGE_3, STAGE_4, STAGE_5, STAGE_6, STAGE_7, STAGE_8],
  },
  world3d: {
    id: 'world3d',
    title: 'Make a 3D game',
    blurb: 'Walk round a 3D hall, change how it looks and feels, add gems and a jump, and learn to see what your game costs. '
      + 'A short route (twelve steps) on a real first-person game.',
    template: 'world3d',
    projectName: 'My 3D game',
    stages: [STAGE_WALK, STAGE_GAME],
  },
};

export const DEFAULT_PATHWAY = 'hero';

/**
 * Things the studio does when a mission begins. Each returns the files to add (never replacing a file that exists).
 * @type {Record<string, (files: Record<string, string>) => Record<string, string>>}
 */
export const PREPARE = {
  'add-levels-file': (files) => ('src/levels.js' in files ? {} : { 'src/levels.js': LEVELS_FILE }),
  'add-level-two': (files) => ('src/level2.js' in files ? {} : { 'src/level2.js': LEVEL_TWO_FILE }),
};
