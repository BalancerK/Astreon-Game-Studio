// Workspaces: the same panels arranged for different jobs. A person can rearrange any of them (the studio remembers each one's layout separately) and
// "Reset layout" returns to these. More workspaces (Art, Sound, Debug, Ship) arrive with the panels they need.

/** The panels that make things, in the order they appear in a group of tabs. A new panel is added here once and every workspace has it. */
const MAKERS = [
  'sprites', 'levels', 'scene2d', 'world', 'kinds', 'layers', 'lights', 'sounds', 'music', 'text', 'states', 'clips', 'sequences', 'particles',
    'behaviors',
    'ui',
    'resources',
    'tests',
    'controls',
  'story', 'backpack', 'ship', 'netlab', 'friend', 'plugins', 'rules', 'scene3d', 'environment', 'rig',
];
/** The group of tabs at the side of most workspaces: the project, then everything that makes things. */
const SIDE = ['files', 'search', 'history', 'learn', 'inspect', 'profiler', ...MAKERS];
const shipAt = MAKERS.indexOf('ship');
const without = (list, ...gone) => list.filter((p) => !gone.includes(p));
const firstThen = (first, list) => [...first, ...without(list, ...first)];

export const PANEL_IDS = ['files', 'search', 'editor', 'game', 'console', 'history', 'learn', 'time', 'inspect', 'profiler', ...MAKERS];

const tabs = (id, panels, active = panels[0]) => ({ type: 'tabs', id, panels, active });
const split = (id, dir, sizes, ...children) => ({ type: 'split', id, dir, sizes, children });

/** @type {{id: string, title: string, description: string, layout: () => any}[]} */
export const WORKSPACES = [
  {
    id: 'make',
    title: 'Make',
    description: 'The game big, with your files and messages beside it. For playing, trying ideas and changing numbers.',
    layout: () => split('s1', 'row', [0.2, 0.8],
      tabs('t1', SIDE, 'files'),
      split('s2', 'column', [0.72, 0.28], tabs('t2', ['game']), tabs('t3', ['console', 'editor', 'time'], 'console'))),
  },
  {
    id: 'code',
    title: 'Code',
    description: 'The code in the middle with the game beside it. For writing and fixing the rules.',
    layout: () => split('s1', 'row', [0.18, 0.5, 0.32],
      tabs('t1', SIDE, 'files'),
      split('s2', 'column', [0.76, 0.24], tabs('t2', ['editor']), tabs('t3', ['console', 'time'], 'console')),
      tabs('t4', ['game'])),
  },
  {
    id: 'learn',
    title: 'Learn',
    description: 'The guide beside your code and the game. For following the pathway: each step is a change you make to a real game.',
    layout: () => split('s1', 'row', [0.27, 0.43, 0.3],
      tabs('t1', ['learn', 'files', 'search', 'history', 'inspect', 'profiler']),
      split('s2', 'column', [0.76, 0.24], tabs('t2', ['editor', ...MAKERS], 'editor'), tabs('t3', ['console', 'time'], 'console')),
      tabs('t4', ['game'])),
  },
  {
    id: 'debug',
    title: 'Debug',
    description: 'The game with its Time Machine and an inspector of everything it remembers. For finding out why something happens.',
    layout: () => split('s1', 'row', [0.4, 0.34, 0.26],
      tabs('t1', firstThen(['inspect', 'profiler', 'netlab', 'files', 'search', 'history', 'learn'], SIDE), 'inspect'),
      split('s2', 'column', [0.7, 0.3], tabs('t2', ['game']), tabs('t3', ['time', 'console'], 'time')),
      tabs('t4', ['editor'])),
  },
  {
    id: 'art',
    title: 'Art',
    description: 'Paint sprites and levels and make sounds, with the game running beside them. For giving your game its own look and sound.',
    layout: () => split('s1', 'row', [0.48, 0.3, 0.22],
      tabs('t1', [...MAKERS.slice(0, shipAt), 'files', 'search', 'history', 'learn', 'inspect', 'profiler', ...MAKERS.slice(shipAt)], 'sprites'),
      split('s2', 'column', [0.68, 0.32], tabs('t2', ['game']), tabs('t3', ['console', 'time'], 'console')),
      tabs('t4', ['editor'])),
  },
  {
    id: 'scene',
    title: '3D',
    description: 'Build a 3D scene from blocks, saved as a file in your project. For placing things in space for a game to load.',
    layout: () => split('s1', 'row', [0.16, 0.58, 0.26],
      tabs('t1', without(SIDE, 'scene3d'), 'files'),
      tabs('t2', ['scene3d', 'editor'], 'scene3d'),
      split('s2', 'column', [0.6, 0.4], tabs('t3', ['game']), tabs('t4', ['console', 'time'], 'console'))),
  },
  {
    id: 'ship',
    title: 'Ship',
    description: 'Measure your game, hold it to limits, and export it as a web page. For getting it to players.',
    layout: () => split('s1', 'row', [0.46, 0.34, 0.2],
      tabs('t1', firstThen(['ship', 'files', 'search', 'history', 'learn', 'inspect', 'profiler'], SIDE), 'ship'),
      split('s2', 'column', [0.7, 0.3], tabs('t2', ['game']), tabs('t3', ['console', 'time'], 'console')),
      tabs('t4', ['editor'])),
  },
];

export const DEFAULT_WORKSPACE = 'code';

export const workspaceById = (id) => WORKSPACES.find((w) => w.id === id) ?? WORKSPACES.find((w) => w.id === DEFAULT_WORKSPACE);
