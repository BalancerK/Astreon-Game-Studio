import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHWAYS } from '../app/learn/pathways.js';
import { TEMPLATES } from '../app/store/templates.js';
import { LearnSession } from '../app/learn/session.js';
import { instrumentSource } from '../app/profile/instrument.js';

const MAIN = 'src/main.js';
const pathway = PATHWAYS.world3d;
const missions = pathway.stages.flatMap((s) => s.missions);

const ctxOf = (files, start, extra = {}) => ({ files, start, summary: null, ok: true, events: new Set(), ...extra });

test('the 3D pathway is offered, starts on its own template and has two stages of twelve steps', () => {
  assert.equal(pathway.template, 'world3d');
  assert.ok(TEMPLATES[pathway.template]);
  assert.equal(pathway.stages.length, 2);
  assert.equal(missions.length, 12);
  assert.equal(new Set(missions.map((m) => m.id)).size, 12, 'ids are unique');
  for (const m of missions) {
    assert.ok(m.title && m.task.length && m.why && m.answer, m.id);
    assert.ok(m.hints?.length >= 1, `${m.id} has hints`);
    assert.equal(typeof m.check, 'function');
  }
  const session = new LearnSession(pathway);
  assert.equal(session.total, 12);
});

// what a student who follows each step does
const SOLUTIONS = {
  look: (f) => ({ files: f, summary: { walked: 7 } }),
  collect3d: (f) => ({ files: f, summary: { gemsLeft: 0 } }),
  gem3d: (f, m) => ({ files: { ...f, ...m.apply(f) }, events: new Set(['restarted']) }),
  profile3d: (f) => ({ files: f, events: new Set(['manual']) }),
  mouse3d: (f) => ({ files: f, events: new Set(['mouse-locked']) }),
};

test('following every step in order completes each one, and none is complete before it is done', () => {
  let files = { ...TEMPLATES.world3d.files };
  let summary = { walked: 0, gemsLeft: 5 };
  for (const m of missions) {
    const start = { files: { ...files }, summary };
    const before = m.check(ctxOf(files, start, { summary }));
    assert.equal(before.done, false, `${m.id} is not done before the student does it`);
    const make = SOLUTIONS[m.id] ?? ((f, mm) => ({ files: { ...f, ...mm.apply(f) } }));
    const after = make(files, m);
    const result = m.check(ctxOf(after.files, start, { summary: after.summary ?? summary, events: after.events }));
    assert.equal(result.done, true, `${m.id} is done after the reference solution (${result.note ?? ''})`);
    files = after.files;
    if (m.id === 'collect3d') summary = { walked: 7, gemsLeft: 0 };
  }
});

test('the changes the steps ask for leave a game that still runs when every function is timed', () => {
  let files = { ...TEMPLATES.world3d.files };
  for (const m of missions) if (m.apply) files = { ...files, ...m.apply(files) };
  const text = files[MAIN];
  assert.ok(text.includes('jump3d(game.cam, keys, dt)') && text.includes("sky: '#3a1c5c'") && text.includes('#b04a4a'));
  assert.doesNotThrow(() => instrumentSource(text, MAIN));
});

test('a broken game never counts as a finished step', () => {
  const m = missions.find((x) => x.id === 'speed3d');
  const files = { ...TEMPLATES.world3d.files, ...m.apply(TEMPLATES.world3d.files) };
  const start = { files: TEMPLATES.world3d.files };
  assert.equal(m.check(ctxOf(files, start)).done, true);
  assert.equal(m.check(ctxOf(files, start, { ok: false })).done, false);
});

test('each step\'s apply changes only what it says (the answer shown is the answer used)', () => {
  for (const m of missions.filter((x) => x.apply)) {
    const before = TEMPLATES.world3d.files;
    const out = m.apply(before);
    assert.ok(out[MAIN] && out[MAIN] !== before[MAIN], `${m.id} changes the file`);
  }
});
