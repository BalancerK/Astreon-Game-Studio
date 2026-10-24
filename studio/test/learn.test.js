import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberOf, rowsOf, countIn, functionBody, numberChanged, numberAtLeast, summaryMoved, allOf, levelIsValid, happened, matches } from '../app/learn/checks.js';
import { LearnSession } from '../app/learn/session.js';
import { PATHWAYS, PREPARE } from '../app/learn/pathways.js';
import { TEMPLATES } from '../app/store/templates.js';
import { solutions } from './solutions.js';

const MAIN = 'src/main.js';
const ok = (files, extra = {}) => ({ files, summary: null, ok: true, events: new Set(), ...extra });

test('reading code the way a person would: numbers, level rows, function bodies', () => {
  assert.equal(numberOf('const SPEED = 160; // fast', 'SPEED'), 160); assert.equal(numberOf('let JUMP=-5.5', 'JUMP'), -5.5); assert.equal(numberOf('const SPEEDY = 3', 'SPEED'), null);
  assert.equal(numberOf('const SPEED = fast', 'SPEED'), null); assert.equal(numberOf(undefined, 'X'), null);
  const src = "const LEVEL = [\n  '##',\n  \"#o\",\n];\nconst OTHER = ['x'];";
  assert.deepEqual(rowsOf(src), ['##', '#o']); assert.deepEqual(rowsOf(src, 'OTHER'), ['x']); assert.equal(rowsOf('const A = 1'), null); assert.equal(rowsOf('const LEVEL = []'), null);
  assert.equal(countIn(['#o', 'oo'], 'o'), 3); assert.equal(countIn(null, 'o'), 0);
  const code = 'export function create() {\n return 1;\n}\nexport function render(g) {\n g.x();\n}\nexport function summary() {}';
  assert.match(functionBody(code, 'render'), /g\.x\(\)/); assert.doesNotMatch(functionBody(code, 'render'), /summary/); assert.equal(functionBody(code, 'nope'), '');
});

test('checks: a number must change and be sensible; broken code never counts as done', () => {
  const start = { files: { [MAIN]: 'const SPEED = 160;' } };
  const c = numberChanged(MAIN, 'SPEED', 40);
  assert.equal(c({ ...ok({ [MAIN]: 'const SPEED = 160;' }), start }).done, false, 'unchanged');
  assert.equal(c({ ...ok({ [MAIN]: 'const SPEED = 400;' }), start }).done, true);
  assert.match(c({ ...ok({ [MAIN]: 'const SPEED = 4;' }), start }).note, /above 40/, 'a too-small number explains');
  assert.match(c({ ...ok({ [MAIN]: 'const SPEED = ;' }), start }).note, /Keep the line/);
  assert.match(c({ ...ok({ [MAIN]: 'const SPEED = 400;' }, { ok: false }), start }).note, /problem to fix/, 'a game with an error is not done');
  const j = numberAtLeast(MAIN, 'JUMP', 800);
  assert.equal(j({ ...ok({ [MAIN]: 'const JUMP = 800;' }), start: { files: { [MAIN]: 'const JUMP = 620;' } } }).done, true);
  assert.match(j({ ...ok({ [MAIN]: 'const JUMP = 700;' }), start: { files: { [MAIN]: 'const JUMP = 620;' } } }).note, /800 or more/);
  assert.equal(summaryMoved('x', 40)({ summary: { x: 100 }, start: { summary: { x: 32 } } }).done, true); assert.equal(summaryMoved('x', 40)({ summary: { x: 50 }, start: { summary: { x: 32 } } }).done, false);
  assert.equal(summaryMoved('x', 1)({ summary: null, start: { summary: null } }).done, false);
  assert.equal(happened('restore-point')({ events: new Set(['restore-point']) }).done, true); assert.equal(happened('x')({}).done, false);
  assert.equal(allOf(() => ({ done: true }), () => ({ done: false, note: 'not yet' }))({}).note, 'not yet'); assert.equal(matches(MAIN, /a/)(ok({ [MAIN]: 'a' })).done, true);
  const v = levelIsValid(MAIN, { columns: 3 });
  assert.equal(v(ok({ [MAIN]: "const LEVEL = ['###', '#@#', '###', '###'];" })).done, true);
  assert.match(v(ok({ [MAIN]: "const LEVEL = ['###', '#@', '###', '###'];" })).note, /same length/); assert.match(v(ok({ [MAIN]: "const LEVEL = ['###', '#.#', '###', '###'];" })).note, /exactly one @/);
  assert.match(v(ok({ [MAIN]: 'nothing' })).note, /list of rows/); assert.match(levelIsValid(MAIN, { columns: 9 })(ok({ [MAIN]: "const LEVEL = ['###', '#@#', '###', '###'];" })).note, /at least 9/);
});

const session = (saved, clock) => new LearnSession(PATHWAYS.hero, saved, { now: () => clock?.t ?? 0 });

test('a session walks through missions, remembers the start, gives hints in order, and the answer last', () => {
  const clock = { t: 0 };
  const s = session(null, clock);
  assert.equal(s.total, 41); assert.equal(s.mission.id, 'play'); assert.equal(s.atStageStart, true); assert.equal(s.stage.id, 'move');
  assert.equal(s.evaluate(ok({})), false, 'nothing is checked before the mission has begun');
  s.begin({ [MAIN]: 'x' }, { x: 32 });
  assert.deepEqual(s.progress.start.files, { [MAIN]: 'x' }); assert.equal(s.started, true);
  assert.equal(s.hasMoreHints, true); assert.deepEqual(s.shownHints(), []); assert.equal(s.hint(), true); assert.equal(s.shownHints().length, 1); assert.equal(s.hint(), true); assert.equal(s.hint(), false, 'no more hints: the answer is next');
  s.showAnswer(); assert.equal(s.progress.answerShown, true);
  const changes = []; s.on('change', (k) => changes.push(k));
  assert.equal(s.evaluate(ok({}, { summary: { x: 200 } })), true); assert.deepEqual(changes, ['done']); assert.equal(s.completedNow, true); assert.deepEqual(s.progress.done, ['play']);
  assert.equal(s.evaluate(ok({})), true, 'once done it stays done');
  assert.equal(s.next(), true); assert.equal(s.mission.id, 'speed'); assert.equal(s.progress.start, null, 'a new mission starts with nothing remembered'); assert.equal(s.progress.hints, 0); assert.equal(s.atStageStart, false);
  assert.equal(s.back(), true); assert.equal(s.mission.id, 'play'); assert.equal(s.completedNow, true, 'a mission done earlier is still done');
});

test('guidance, never gates: skip, go back, turn off, start again; progress survives saving and loading', () => {
  const s = session(null);
  s.begin({}, null); s.next({ skip: true });
  assert.deepEqual(s.progress.skipped, ['play']); assert.equal(s.outline()[0].missions[0].state, 'skipped'); assert.equal(s.outline()[0].missions[1].state, 'current');
  s.setOn(false); assert.equal(s.enabled, false); assert.equal(s.evaluate(ok({})), false, 'a guide that is off does not check');
  const copy = session(JSON.parse(JSON.stringify(s.save())));
  assert.equal(copy.mission.id, 'speed'); assert.deepEqual(copy.progress.skipped, ['play']); assert.equal(copy.enabled, false);
  copy.setOn(true); copy.restart(); assert.equal(copy.mission.id, 'play'); assert.deepEqual(copy.progress.done, []); assert.equal(copy.enabled, true);
  assert.equal(session({ index: 999 }).mission.id, PATHWAYS.hero.stages.at(-1).missions.at(-1).id, 'a saved place past the end is brought back inside');
  assert.equal(session({ index: -4 }).mission.id, 'play');
  const last = session({ index: 40 }); assert.equal(last.next(), false); assert.equal(last.finished, true); assert.equal(last.back(), true); assert.equal(last.finished, false);
});

test('a nudge appears only after a quiet moment, and any activity resets the wait', () => {
  const clock = { t: 0 }; const s = session(null, clock);
  assert.equal(s.needsNudge(), false, 'not started'); s.begin({}, null);
  clock.t = 30_000; assert.equal(s.needsNudge(), false); clock.t = 46_000; assert.equal(s.needsNudge(), true);
  s.hint(); assert.equal(s.needsNudge(), false, 'asking for a hint is activity');
  clock.t = 100_000; assert.equal(s.needsNudge(), true); s.progress.start.summary = { x: 1 }; s.evaluate(ok({}, { summary: { x: 999 } })); assert.equal(s.needsNudge(), false, 'done: no nudge');
});

test('a broken check can never trap a student', () => {
  const p = { id: 't', title: 't', stages: [{ id: 's', title: 's', intro: '', done: '', missions: [{ id: 'm', title: 'm', task: [], watch: [], check: () => { throw new Error('boom'); }, why: '' }] }] };
  const s = new LearnSession(p); s.begin({}, null);
  assert.equal(s.evaluate(ok({})), false); assert.equal(s.next({ skip: true }), false); assert.equal(s.finished, true);
});

// ---- the content: every mission can be completed, and is not complete before ----
test('the pathway content: following the reference solution completes every mission in order, and no mission is complete before it is done', () => {
  const session1 = new LearnSession(PATHWAYS.hero);
  let files = { ...TEMPLATES.hero.files };
  const seen = [];
  for (let i = 0; i < session1.total; i++) {
    const m = session1.mission;
    seen.push(m.id);
    const prepared = m.prepare ? PREPARE[m.prepare](files) : {};
    assert.ok(!m.prepare || PREPARE[m.prepare], `${m.id}: prepare is known`);
    files = { ...files, ...prepared };
    session1.begin(files, { x: 32, coinsLeft: 99 });
    const before = ok(files, { summary: { x: 32, coinsLeft: 99 } });
    assert.equal(session1.mission.check({ ...before, start: session1.progress.start }).done, false, `${m.id} must not be done at its start`);
    const solved = solutions[m.id](files, m);
    const ctx = ok(solved.files, { summary: solved.summary ?? { x: 32, coinsLeft: 99 }, events: solved.events ?? new Set() });
    if (solved.events?.has('restarted')) {
      const edited = m.check({ ...ctx, events: new Set(), start: session1.progress.start });
      assert.equal(edited.done, false, `${m.id}: an edit alone is not enough, the game has to be started again`);
      assert.match(edited.note ?? '', /Run button/);
    }
    assert.equal(session1.evaluate(ctx), true, `${m.id}: the reference solution completes it (${session1.note})`);
    files = solved.files;
    for (const h of m.hints ?? []) assert.ok(h.length > 10, `${m.id} hints say something`);
    assert.ok(m.answer && m.why && m.task.length, `${m.id} has an answer, a why and a task`);
    session1.next();
  }
  assert.equal(seen.length, 41); assert.deepEqual(seen, Object.keys(solutions).filter((k) => seen.includes(k)), 'every mission was visited, in order'); assert.equal(session1.finished, true);
  assert.equal(new Set(seen).size, 41, 'mission ids are unique');
});

test('the answers shown to a student, applied for them, complete the mission too', () => {
  for (const stage of PATHWAYS.hero.stages) {
    for (const m of stage.missions.filter((x) => x.apply)) {
      const start = { ...TEMPLATES.hero.files };
      const after = { ...start, ...m.apply(start) };
      assert.equal(m.check({ ...ok(after), start: { files: start } }).done, true, `${m.id}: "apply" does what the answer says`);
      assert.notEqual(after[MAIN], start[MAIN]);
    }
  }
});

test('the template that stage 1 starts from runs the way the missions assume', async () => {
  const text = TEMPLATES.hero.files[MAIN];
  assert.equal(numberOf(text, 'SPEED'), 160); assert.equal(numberOf(text, 'JUMP'), 620);
  const rows = rowsOf(text); assert.equal(rows.length, 10); assert.ok(rows.every((r) => r.length === rows[0].length)); assert.equal(countIn(rows, '@'), 1);
  assert.match(text, /'@': \{ kind: 'hero', w: 24, h: 30 \}/); assert.match(text, /game\.score\+\+/);
  assert.equal(PATHWAYS.hero.template, 'hero'); assert.ok(TEMPLATES[PATHWAYS.hero.template]);
});

test('if the game was not reporting yet when a mission began, the first report becomes the starting point', () => {
  const s = session(null);
  s.begin({}, null);
  assert.equal(s.evaluate(ok({}, { summary: { x: 32 } })), false, 'the first report is only remembered');
  assert.deepEqual(s.progress.start.summary, { x: 32 });
  assert.equal(s.evaluate(ok({}, { summary: { x: 200 } })), true);
});
