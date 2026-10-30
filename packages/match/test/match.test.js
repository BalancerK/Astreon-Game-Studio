import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, stepMatch, leading, respawnIn, matchSummary, pickSpawn, controlPoints, stepPoints, POINT_RADIUS, CAPTURE_SECONDS,
  POINTS, KINDS, PART_OF, MULTI_WINDOW, ASSIST_WINDOW, streakBonus, multiBonus, shutdownBonus, streakName, multiName, awardLabel, breakdown,
  isTeamMode, cleanMode, defaultLimit, limitWord, MODE_NAMES,
} from '../src/index.js';

/** A tiny world: actors `{ id, team, name, x, z, dead }`, a few places to start, and a clock. */
function fixture(mode = 'tdm', { teams = [1, 1, 2, 2], respawnSeconds = 5, killLimit = 15, rules = {} } = {}) {
  const world = { tick: 0, actors: teams.map((team, i) => ({ id: i + 1, team: mode === 'dm' ? i + 1 : team, name: `P${i + 1}`, x: i * 10, z: 0, dead: false })), spawns: [[0, 0], [1000, 0], [2000, 0]] };
  const back = [];
  const match = createMatch(world, { mode, killLimit, respawnSeconds, rules: { respawn: (w, a, at) => { a.x = at[0]; a.z = at[1]; a.dead = false; back.push([a.id, at]); }, ...rules } });
  const by = (id) => world.actors.find((a) => a.id === id);
  /** `killer` destroys `target`, with an optional last blow: `{ part, weapon, dealt }`. */
  const kill = (killer, target, blow = {}) => {
    by(target).dead = true;
    return [{ type: 'hit', attacker: killer, target, dealt: blow.dealt ?? 100, part: blow.part ?? 'torso', weapon: blow.weapon ?? 'rifle' }, { type: 'destroyed', target, by: killer }];
  };
  const run = (events, ticks = 1) => { world.tick += ticks; return stepMatch(match, events); };
  return { world, match, by, kill, run, back };
}

test('scoring: the bonuses grow in steps and stop at their largest, and the names are the ones called out', () => {
  assert.deepEqual([1, 2, 3, 4, 6, 7, 20].map(streakBonus), [0, 10, 20, 30, 50, 50, 50]);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(multiBonus), [0, 25, 50, 75, 100, 100]);
  assert.deepEqual([3, 4, 5, 8, 20].map(shutdownBonus), [50, 60, 70, 100, 100]);
  assert.equal(streakName(3), 'KILLING SPREE'); assert.equal(streakName(4), null); assert.equal(multiName(2), 'DOUBLE KILL'); assert.equal(multiName(9), 'OVERKILL');
  assert.equal(awardLabel({ kind: 'streak', n: 4 }), '4 IN A ROW'); assert.equal(awardLabel({ kind: 'kill' }), 'KILL'); assert.equal(awardLabel({ kind: 'weird' }), 'WEIRD');
  assert.equal(awardLabel({ kind: 'parry' }, { ...KINDS, parry: { label: 'PARRY' } }), 'PARRY');
  assert.ok(Object.isFrozen(POINTS));
  for (const kind of Object.keys(KINDS)) assert.ok(kind in PART_OF, `${kind} has a part of the score`);
});

test('a kill scores, with a head shot and the first of the round added, a close-up kill is counted, and the parts add up to the total', () => {
  const f = fixture('dm', { teams: [0, 0, 0] });
  f.match.rules.isMelee = (w) => w === 'sword';
  f.run(f.kill(1, 2, { part: 'head' }));
  let s = f.match.scores.get(1);
  assert.equal(s.kills, 1); assert.equal(s.heads, 1); assert.equal(s.firstBloods, 1);
  assert.equal(s.points, POINTS.kill + POINTS.head + POINTS.firstBlood);
  f.by(2).dead = false;
  f.run(f.kill(3, 2, { weapon: 'sword' }));
  s = f.match.scores.get(3);
  assert.equal(s.blade, 1); assert.equal(s.points, POINTS.kill + POINTS.melee);
  assert.equal(s.points, s.pk + s.pa + s.ps + s.pb + s.pp);
});

test('revenge, runs of kills, quick kills and ending a run', () => {
  const f = fixture('dm', { teams: [0, 0, 0] });
  f.run(f.kill(1, 2)); f.by(2).dead = false;
  f.run(f.kill(2, 1));                                                                   // 2 destroys the one who destroyed it
  assert.equal(f.match.scores.get(2).revenges, 1);
  assert.ok(f.match.awards.some((a) => a.kind === 'revenge' && a.id === 2));
  const g = fixture('dm', { teams: [0, 0, 0, 0, 0] });
  for (const victim of [2, 3, 4]) g.run(g.kill(1, victim), 10);                           // three in a row inside the quick-kill window
  const s = g.match.scores.get(1);
  assert.equal(s.streak, 3); assert.equal(s.bestStreak, 3); assert.equal(s.multi, 3); assert.equal(s.bestMulti, 3);
  assert.ok(g.match.awards.some((a) => a.kind === 'multi' && a.n === 3) && g.match.awards.some((a) => a.kind === 'streak' && a.called));
  g.run(g.kill(5, 1));                                                                   // 5 ends that run
  assert.equal(g.match.scores.get(5).shutdowns, 1);
  assert.equal(g.match.scores.get(1).streak, 0);
  const total = g.match.scores.get(1);
  assert.equal(total.points, total.pk + total.pa + total.ps + total.pb + total.pp, 'the parts add up');
  const slow = fixture('dm', { teams: [0, 0, 0, 0] });
  slow.run(slow.kill(1, 2)); slow.run(slow.kill(1, 3), MULTI_WINDOW + 5);
  assert.equal(slow.match.scores.get(1).multi, 1, 'too late for a multi kill');
});

test('an assist goes to those who hurt the victim enough in the last ten seconds, not to the killer, a team mate that grazed, or anyone too long ago', () => {
  const f = fixture('tdm', { teams: [1, 1, 2, 2] });                                    // 1 and 2 are a team; 3 and 4 the other
  f.match.rules.maxHealth = () => 1000;
  const hit = (attacker, target, dealt) => ({ type: 'hit', attacker, target, dealt, part: 'torso', weapon: 'rifle' });
  f.run([hit(2, 3, 300), hit(4, 3, 20)]);                                                // 2 hurt a lot (3 is an enemy of 2); 4 is on 3's team so it does not count
  f.run(f.kill(1, 3));
  assert.equal(f.match.scores.get(2).assists, 1);
  assert.equal(f.match.scores.get(1).assists, 0, 'the killer gets the kill, not an assist');
  assert.equal(f.match.scores.get(4).assists, 0, 'a team mate of the victim does not help');
  const graze = fixture('tdm', { teams: [1, 1, 2, 2] });
  graze.match.rules.maxHealth = () => 1000;
  graze.run([hit(2, 3, 30)]); graze.run(graze.kill(1, 3));
  assert.equal(graze.match.scores.get(2).assists, 0, 'a graze (under 40 and under 8% of the armour) is not an assist');
  const old = fixture('tdm', { teams: [1, 1, 2, 2] });
  old.run([hit(2, 3, 300)]);
  old.run(old.kill(1, 3), ASSIST_WINDOW + 10);
  assert.equal(old.match.scores.get(2).assists, 0, 'too long ago');
  assert.equal(old.match.teamKills.get(1), 1);
});

test('a destroyed actor comes back after the wait, at the start furthest from its enemies, through the rules\' respawn', () => {
  const f = fixture('tdm', { teams: [1, 2], respawnSeconds: 5 });
  f.by(2).x = 0;                                                                         // the enemy stands at the first start
  f.run(f.kill(2, 1));                                                                   // actor 1 is destroyed
  assert.equal(respawnIn(f.match, 1), 5);
  f.run([], 120); assert.equal(respawnIn(f.match, 1), 3); assert.deepEqual(f.back, []);
  const r = f.run([], 180);
  assert.deepEqual(r.respawned, [1]);
  assert.deepEqual(f.back, [[1, [2000, 0]]], 'the furthest from the enemy: the last in the list');
  assert.equal(respawnIn(f.match, 1), 0); assert.equal(f.by(1).dead, false);
  assert.deepEqual(pickSpawn(f.world, f.by(1)), [2000, 0], 'on its own, with the default conventions of the world');
});

test('the match ends at the score limit or when time is up: the leader wins, level is a draw, and a team match counts the team', () => {
  const f = fixture('dm', { teams: [0, 0], killLimit: 2 });
  f.run(f.kill(1, 2)); assert.equal(f.match.over, false); f.by(2).dead = false;
  f.run(f.kill(1, 2));
  assert.equal(f.match.over, true); assert.deepEqual([f.match.winner.kind, f.match.winner.id], ['actor', 1]);
  const t = fixture('dm', { teams: [0, 0] }); t.run([], t.match.endsAt);
  assert.equal(t.match.over, true); assert.equal(t.match.winner, null, 'nobody scored: a draw');
  const team = fixture('tdm', { teams: [1, 1, 2, 2], killLimit: 2 });
  team.run(team.kill(1, 3)); team.by(3).dead = false; team.run(team.kill(2, 4));
  assert.equal(team.match.over, true); assert.deepEqual([team.match.winner.kind, team.match.winner.id], ['team', 1]);
  const named = fixture('dm', { teams: [0, 0], rules: { actorKind: 'pilot' } }); named.run(named.kill(1, 2));
  assert.equal(leading(named.match).kind, 'pilot');
});

test('the summary: a row for every actor, best first with the best marked, how it ended for the viewer, the teams, and the game\'s own label', () => {
  const f = fixture('tdm', { teams: [1, 1, 2, 2], killLimit: 1, rules: { label: (a) => `L${a.id}` } });
  f.run(f.kill(1, 3));
  const mine = matchSummary(f.match, 2), theirs = matchSummary(f.match, 4);
  assert.equal(mine.title, 'VICTORY'); assert.equal(theirs.title, 'DEFEAT');
  assert.equal(mine.rows[0].id, 1); assert.equal(mine.rows[0].mvp, true); assert.equal(mine.rows.filter((r) => r.mvp).length, 1);
  assert.equal(mine.rows.length, 4); assert.equal(mine.rows.find((r) => r.id === 2).you, true); assert.equal(mine.rows.find((r) => r.id === 1).ally, true); assert.equal(mine.rows[0].kind, 'L1');
  assert.deepEqual(mine.teams.map((t) => [t.team, t.score, t.mine]), [[1, 1, true], [2, 0, false]]);
  assert.equal(matchSummary(fixture('dm').match, 1).title, 'IN PROGRESS');
  assert.equal(matchSummary(fixture('dm').match, 1).teams, null);
});

test('a game\'s own kind of event and award: the rules can take an event first, and add to the points and the parts of the score', () => {
  const f = fixture('dm', { teams: [0, 0], rules: { points: { ...POINTS, parry: 20 }, partOf: { ...PART_OF, parry: 'pb' }, onEvent: (match, e, { award }) => { if (e.type !== 'parry') return false; award(match, e.by, 'parry', 20, { target: e.target }); return true; } } });
  f.run([{ type: 'parry', by: 2, target: 1 }]);
  const s = f.match.scores.get(2);
  assert.equal(s.points, 20); assert.equal(s.pb, 20);
  assert.equal(f.match.awards.at(-1).kind, 'parry');
  assert.equal(breakdown({ pk: 100, pa: 40, ps: 0, pb: 20, pp: 0, kills: 1, assists: 1 }).map((p) => p.key).join(), 'pk,pa,pb');
});

test('shots count once however many pellets, hits count damage and heads, and the awards list keeps the last sixty', () => {
  const f = fixture('dm', { teams: [0, 0, 0] });
  f.run([{ type: 'shot', owner: 1 }, { type: 'shot', owner: 1, pellet: true }, { type: 'shot', owner: 1, pellet: true }, { type: 'hit', attacker: 1, target: 2, dealt: 30, part: 'head', weapon: 'x' }, { type: 'hit', attacker: 1, target: 2, dealt: 12, part: 'torso', weapon: 'x' }]);
  const s = f.match.scores.get(1);
  assert.deepEqual([s.shots, s.hits, s.heads, s.damage], [1, 2, 1, 42]);
  const g = fixture('dm', { teams: [0, 0], killLimit: 1000 });
  for (let i = 0; i < 70; i++) { g.by(2).dead = false; g.run(g.kill(1, 2)); }
  assert.equal(g.match.awards.length, 60);
});

test('modes: which are team matches, what they are called, the limit they start at and what it counts', () => {
  assert.deepEqual(Object.keys(MODE_NAMES).sort(), ['cp', 'dm', 'tdm']);
  assert.deepEqual(['dm', 'tdm', 'cp'].map(isTeamMode), [false, true, true]);
  assert.equal(cleanMode('cp'), 'cp'); assert.equal(cleanMode('nonsense'), 'tdm'); assert.equal(cleanMode(7), 'tdm');
  assert.deepEqual(['dm', 'tdm', 'cp'].map(defaultLimit), [15, 25, 200]); assert.equal(limitWord('cp'), 'points'); assert.equal(limitWord('tdm'), 'kills');
});

test('control points: three fair ones on open land, taken by standing on them, scored every second, and the actors on a taken point are paid', () => {
  const map = { spawns: [[-1000, 0], [1000, 0], [0, 900], [0, -900]], heightAt: () => 5, half: 3000 };
  const pts = controlPoints(map, [-1000, 0], [1000, 0]);
  assert.equal(pts.length, 3); assert.deepEqual(pts.map((p) => p.name), ['A', 'B', 'C']);
  const unfair = (p) => Math.abs(Math.hypot(p.x + 1000, p.z) - Math.hypot(p.x - 1000, p.z));
  assert.ok(pts.every((p) => unfair(p) < 150), 'nobody starts with a point to itself');
  assert.deepEqual(controlPoints(map, [-1000, 0], [1000, 0]), pts, 'the same map gives the same points');
  const f = fixture('cp', { teams: [1, 2] });
  f.world.points = pts.map((p) => ({ ...p })); const p = f.world.points[1];
  f.by(1).x = p.x; f.by(1).z = p.z; f.by(2).x = 5000; f.by(2).z = 5000;
  const events = [];
  for (let t = 0; t < CAPTURE_SECONDS * 60 + 130; t++) { f.world.tick++; const ev = []; stepPoints(f.match, ev); events.push(...ev); }
  assert.equal(p.owner, 1); assert.equal(p.control, 1);
  assert.deepEqual(events.map((e) => [e.type, e.team, e.name]), [['capture', 1, 'B']]);
  assert.ok((f.match.teamPoints.get(1) ?? 0) >= 1, 'a held point scores for its team');
  f.run([{ type: 'capture', point: 1, team: 1, name: 'B' }]);
  assert.equal(f.match.scores.get(1).pp, POINTS.capture, 'the actor on it is paid');
  assert.equal(f.match.scores.get(2).pp, 0);
  assert.ok(POINT_RADIUS > 0);
});
