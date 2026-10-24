import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../replay-run.js';
import { PATHWAYS, PREPARE } from '../../studio/app/learn/pathways.js';
import { TEMPLATES } from '../../studio/app/store/templates.js';
import { solutions } from '../../studio/test/solutions.js';
import { setSoundSink, setCanvasFactory, setProgressHost } from '../../packages/arcade/src/index.js';

/** A canvas context that accepts every call and remembers nothing: enough to run `render` without a browser. */
const fakeContext = () => new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });

test('after every mission, the project a student has is a game that really runs: it starts, plays, draws and reports', async () => {
  const sounds = [];
  const saved = [];
  setSoundSink((m) => sounds.push(m));
  setProgressHost({ send: (m) => saved.push(m), initial: null });
  setCanvasFactory(() => ({ getContext: fakeContext }));
  let files = { ...TEMPLATES.hero.files };
  const failures = [];
  for (const stage of PATHWAYS.hero.stages) {
    for (const mission of stage.missions) {
      if (mission.prepare) files = { ...files, ...PREPARE[mission.prepare](files) };
      files = solutions[mission.id](files, mission).files;
      const { mod, cleanup } = await loadGame(files);
      try {
        const game = mod.create();
        const keys = new Set();
        for (let tick = 0; tick < 480; tick++) {
          if (tick === 5) keys.add('Space');                    // leave the title screen, if there is one
          if (tick === 20) keys.add('ArrowRight');
          if (tick % 90 === 0) keys.delete('Space'); else if (tick % 90 === 3) keys.add('Space');
          mod.update(game, keys, 1 / 60);
        }
        mod.render(game, fakeContext(), 0);
        const summary = mod.summary?.(game);
        assert.ok(summary && typeof summary === 'object', 'summary reports something');
        JSON.parse(JSON.stringify(game));                       // the state is still plain data
      } catch (error) {
        failures.push(`${mission.id}: ${error.message}`);
      } finally { cleanup(); }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(sounds.length > 0, 'the sound missions play sounds through the kit');
  setProgressHost({ initial: null });
});
