// Shows every panel of the studio in a given dock width, as pictures, so cramped layouts can be seen and fixed. It makes a project with a little of everything in it, puts each
// panel in the left slot of the Code workspace, and saves one picture of the slot for each panel.
// Usage: node tools/dock-sheet.js outDir [width] [panel ids...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticServer } from './static-server.js';
import { withChromePage } from './cdp.js';
import { SPRITES } from '../studio/app/pack/sprites.js';
import { serializeSprite } from '../studio/app/paint/sprite-model.js';
import * as sounds from '../studio/app/paint/sound-model.js';
import * as music from '../studio/app/paint/music-model.js';
import * as particles from '../studio/app/paint/particle-model.js';
import * as states from '../studio/app/paint/state-model.js';
import * as clips from '../studio/app/paint/clip-model.js';
import * as behaviors from '../studio/app/paint/behavior-model.js';
import * as ui from '../studio/app/paint/ui-model.js';
import { serializeScene } from '../studio/app/paint/scene-model.js';
import { serializeStoryFile, STARTER } from '../studio/app/paint/story-model.js';
import { serializeControls, newControls } from '../studio/app/paint/controls-model.js';
import * as kindsModel from '../studio/app/paint/kinds-model.js';
import * as sequences from '../studio/app/paint/sequence-model.js';
import { serializeLayers, newLayers } from '../studio/app/paint/layers-model.js';
import { serializeText, newTable } from '../studio/app/paint/text-model.js';

const out = process.argv[2] ?? 'dock-sheet';
const width = Number(process.argv[3] ?? 1500);
const only = process.argv.slice(4);
mkdirSync(out, { recursive: true });
const root = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const server = createStaticServer({ root, allowDirs: ['studio', 'packages'], index: '/studio/index.html' });
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const MAIN = `import { newGame, loadMap, clear, drawThings } from '@engine/arcade';
const LEVEL = [
  '#########',
  '#.......#',
  '#..###..#',
  '#@......#',
  '#########',
];
export function create() { const g = newGame(); loadMap(g, LEVEL, { '#': { kind: 'wall', color: '#3b4a6b', autotile: 'blob47' },
  '@': { kind: 'hero', emoji: '🙂' } }); return g; }
export function update() {}
export function render(g, ctx) { clear(ctx); drawThings(ctx, g); }
`;
const files = {
  'src/main.js': MAIN,
  'src/art/hero.js': serializeSprite(SPRITES.find((s) => s.name === 'hero').make()),
  'src/sounds.js': sounds.serializeSounds({ coin: sounds.preset('coin') }),
  'src/music.js': music.serializeSongs({ calm: music.PRESETS.calm() }),
  'src/particles.js': particles.serializeParticles({ fire: particles.preset('fire') }),
  'src/states.js': states.serializeStates({ hero: states.starterMachine() }),
  'src/clips.js': clips.serializeClips({ bob: clips.PRESETS.bob() }),
  'src/behaviors.js': behaviors.serializeBehaviors({ enemy: behaviors.STARTERS.enemy() }),
  'src/ui.js': ui.serializeUi({ hud: ui.STARTERS.hud() }),
  'scenes/cave.js': serializeScene({ w: 480, h: 320, things: [{ kind: 'coin', x: 40, y: 40, w: 16, h: 16, color: '#ffd23c' }] }),
  'src/dialogue.js': serializeStoryFile(STARTER),
  'src/controls.js': serializeControls(newControls()),
  'src/kinds.js': kindsModel.serializeKinds(kindsModel.addKind(kindsModel.addKind({}, 'door', 'door'), 'button', 'button')),
  'src/sequences.js': sequences.serializeSequences({ walk: sequences.PRESETS.walk() }),
  'src/layers.js': serializeLayers(newLayers()),
  'src/text.js': serializeText(newTable()),
};
const PANELS = ['files', 'search', 'history', 'learn', 'inspect', 'profiler', 'sprites', 'levels', 'scene2d', 'world', 'kinds', 'layers', 'lights',
  'sounds',
  'music',
  'text', 'states', 'clips', 'sequences', 'particles', 'behaviors', 'ui',
  'resources', 'tests', 'controls', 'story', 'backpack', 'ship', 'netlab', 'plugins', 'rules'];

try {
  await withChromePage(`http://localhost:${server.address().port}/studio/index.html`, async (page) => {
    const S = (expr) => page.eval(`(() => { const s = window.studio; return ${expr}; })()`);
    await page.waitFor('!!window.studio && !!document.getElementById("dock")', 20_000);
    await S('(s.createProject({ name: "Dock sheet", template: "blank" }), 1)');
    await page.waitFor('window.studio.project?.name === "Dock sheet"', 10_000);
    await S(`(${JSON.stringify(Object.entries(files))}.forEach(([p, t]) => s.project.write(p, t)), s.emit("files"), 1)`);
    for (const id of (only.length ? only : PANELS)) {
      await S(`(s.dock.show(${JSON.stringify(id)}), 1)`);
      await new Promise((r) => setTimeout(r, 450));
      writeFileSync(join(out, `${id}.png`), await page.screenshot());
    }
    console.log(`wrote ${only.length || PANELS.length} pictures to ${out}`);
  }, { width, height: 900 });
} finally { server.close(); }
process.exit(0);
