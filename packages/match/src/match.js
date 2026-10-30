// A match: who is on which team, who has destroyed whom, how long is left, when a destroyed actor comes back and where. Deathmatch (every actor for itself), team deathmatch or control points (two
// teams), won by the first to the score limit, or whoever leads when the time is up. It reads the game's events and nothing else, so a server and the players' browsers keep the same score.
//
//   const rules = { actors: (w) => w.players, spawns: (w) => w.spawns, respawn: (w, p, at) => { p.x = at[0]; p.z = at[1]; p.dead = false; p.hp = p.maxHp; }, maxHealth: (p) => p.maxHp };
//   const match = createMatch(world, { mode: 'tdm', killLimit: 25, timeLimitSeconds: 300, respawnSeconds: 5, rules });
//   // every tick, after the world has moved and made its events ({ type: 'hit' | 'destroyed' | 'shot' | 'capture', ... }, see `stepMatch`):
//   const { respawned } = stepMatch(match, events);
//   if (match.over) show(matchSummary(match, myId));
import { isTeamMode } from './modes.js';
import { POINTS, PART_OF, MULTI_WINDOW, ASSIST_WINDOW, ASSIST_MIN, ASSIST_SHARE, streakBonus, multiBonus, shutdownBonus, streakName } from './scoring.js';
import { stepPoints } from './points.js';

/**
 * @typedef {object} MatchRules What the match needs to know about the game it is scoring (every one is optional).
 * @property {(world: any) => any[]} [actors] Everything that can score: `{ id, team, dead, x, z, name }` each (default `world.actors`).
 * @property {(world: any) => number[][]} [spawns] Places to come back at, `[x, z]` each (default `world.spawns`).
 * @property {(world: any, actor: any, at: number[]) => void} [respawn] Bring a destroyed actor back at `at` (default: nothing).
 * @property {(actor: any) => number} [maxHealth] How much damage an actor can take at most, for the assists (default 100).
 * @property {(weapon: string) => boolean} [isMelee] Whether a kill with this weapon is a close-quarters one (default none).
 * @property {(actor: any) => string} [label] A short word about an actor for the results screen (default empty).
 * @property {Record<string, number>} [points] The points for each kind of award (default `POINTS`; spread it to add the game's own kinds).
 * @property {Record<string, string>} [partOf] Which part of the score each kind of award belongs to (default `PART_OF`).
 * @property {(match: any, event: any, tools: {award: Function, scoreOf: Function}) => boolean} [onEvent] Called first for every event; return true if it was the game's own kind of event (a parry), which the match then leaves alone.
 * @property {string} [actorKind] What the winner or leader is called when it is one actor and not a team (`winner.kind`; default 'actor').
 * @property {number} [ticksPerSecond] How many simulation ticks make a second (default 60).
 */

/**
 * Start a match over a world. The world needs `tick` (the current tick) and whatever `rules` ask of it (by default `world.actors` and `world.spawns`; in control points `world.points`).
 * @param {any} world
 * @param {{mode?: 'dm' | 'tdm' | 'cp', killLimit?: number, timeLimitSeconds?: number, respawnSeconds?: number, rules?: MatchRules}} [o]
 */
export function createMatch(world, { mode = 'tdm', killLimit = 15, timeLimitSeconds = 300, respawnSeconds = 5, rules = {} } = {}) {
  const tps = rules.ticksPerSecond ?? 60;
  return {
    mode, killLimit, endsAt: timeLimitSeconds * tps, respawnTicks: respawnSeconds * tps, ticksPerSecond: tps,
    /** What the match asks of the game (see `MatchRules`). */
    rules: { actors: (w) => w.actors, spawns: (w) => w.spawns, respawn: () => {}, maxHealth: () => 100, isMelee: () => false, label: () => '', actorKind: 'actor', points: POINTS, partOf: PART_OF, ...rules },
    /** What each actor id has done: kills and deaths, the damage it dealt, the hits it landed (and how many to the head), shots fired, and its best run of kills without being destroyed. @type {Map<number, MatchScore>} */ scores: new Map(),
    /** Kills for each team. @type {Map<number, number>} */ teamKills: new Map(),
    /** Points for each team in control points (a point held scores one a second). @type {Map<number, number>} */ teamPoints: new Map(),
    /** Who comes back when: `{ id, at }`. @type {Array<{id: number, at: number}>} */ respawns: [],
    /** Damage done to an actor by an enemy lately, for the assists: `{ by, target, dmg, at }`. @type {Array<{by: number, target: number, dmg: number, at: number}>} */ hurt: [],
    /** The points handed out lately (the last 60), for the screens to call out: `{ tick, id, kind, points, n?, target? }`. @type {Array<any>} */ awards: [],
    firstBlood: false,
    over: false, winner: null, world,
  };
}

/**
 * @typedef {object} MatchScore
 * @property {number} kills @property {number} deaths @property {number} damage @property {number} hits @property {number} heads @property {number} shots
 * @property {number} streak Kills in a row now. @property {number} bestStreak The most kills in a row so far.
 * @property {number} points What the player has earned (see scoring.js). @property {number} assists @property {number} multi Kills in the current quick run. @property {number} bestMulti @property {number} lastKill The tick of the last kill.
 * @property {number} killedBy Who destroyed the player last (-1 for nobody, or once got back at). @property {number} revenges @property {number} shutdowns @property {number} firstBloods @property {number} blade Kills made close up.
 * @property {number} pk @property {number} pa @property {number} ps @property {number} pb @property {number} pp The points that came from kills, assists, streaks and multi kills, bonuses and points taken (they add up to `points`).
 */

const actorsOf = (match) => match.rules.actors(match.world);

/** Give a player points for something, and note it for the screens to call out. */
function award(match, id, kind, points, extra = {}) {
  const s = scoreOf(match, id);
  s.points += points; s[match.rules.partOf[kind]] += points;
  match.awards.push({ tick: match.world.tick, id, kind, points, ...extra });
  if (match.awards.length > 60) match.awards.shift();
}
const scoreOf = (match, id) => {
  if (!match.scores.has(id)) match.scores.set(id, { kills: 0, deaths: 0, damage: 0, hits: 0, heads: 0, shots: 0, streak: 0, bestStreak: 0, points: 0, assists: 0, multi: 0, bestMulti: 0, lastKill: -1e9, killedBy: -1, revenges: 0, shutdowns: 0, firstBloods: 0, blade: 0, pk: 0, pa: 0, ps: 0, pb: 0, pp: 0 });
  return match.scores.get(id);
};

/** The best place for an actor to start: the spawn point furthest from every living enemy (ties go to the earlier one in the list). @param {any} world @param {any} m @param {MatchRules} [rules] */
export function pickSpawn(world, m, rules = {}) {
  const spawns = (rules.spawns ?? ((w) => w.spawns))(world), actors = (rules.actors ?? ((w) => w.actors))(world);
  let best = spawns[0], bestScore = -1;
  for (const s of spawns) {
    let nearest = Infinity;
    for (const o of actors) {
      if (o === m || o.dead) continue;
      const d = Math.hypot(o.x - s[0], o.z - s[1]);
      if (o.team !== m.team) nearest = Math.min(nearest, d);
    }
    if (nearest > bestScore) { bestScore = nearest; best = s; }
  }
  return best;
}

/**
 * Take in what happened this tick: score the kills, queue the comebacks, bring back actors whose time is up, and decide whether the match is over. The events: `shot` (`owner`, `pellet` for the extra
 * pellets of one shot), `hit` (`attacker`, `target`, `dealt`, `part`, `weapon`), `destroyed` (`target`, `by`), `capture` (`point`, `team`, `name`, made by the control points), and anything the rules' `onEvent` takes.
 * @param {ReturnType<typeof createMatch>} match @param {any[]} events @returns {{respawned: number[]}}
 */
export function stepMatch(match, events) {
  const { world, rules } = match, P = rules.points;
  const respawned = [];
  for (const m of actorsOf(match)) scoreOf(match, m.id);
  if (!match.over) {
    if (match.mode === 'cp') stepPoints(match, events);
    const lastHit = new Map();                                                              // the blow that came last this tick for each pair (what the kill was made with)
    for (const e of events) {
      if (rules.onEvent?.(match, e, { award, scoreOf })) continue;                           // (the game's own kinds: a blow turned back by a shield...)
      if (e.type === 'shot') { if (!e.pellet) scoreOf(match, e.owner).shots++; continue; }                 // (a shotgun's other pellets are one shot)
      if (e.type === 'hit') {
        const s = scoreOf(match, e.attacker);
        s.hits++; s.damage += e.dealt;
        if (e.part === 'head') s.heads++;
        lastHit.set(`${e.attacker}:${e.target}`, e);
        const foe = actorsOf(match).find((m) => m.id === e.target), me = actorsOf(match).find((m) => m.id === e.attacker);
        if (e.dealt > 0 && foe && me && foe.team !== me.team) {                                // (damage to an enemy is kept for ten seconds, for the assists)
          const entry = match.hurt.find((h) => h.by === e.attacker && h.target === e.target);
          if (entry) { entry.dmg += e.dealt; entry.at = world.tick; } else match.hurt.push({ by: e.attacker, target: e.target, dmg: e.dealt, at: world.tick });
        }
        continue;
      }
      if (e.type === 'capture') {                                                           // a point taken: points for each of the team's actors on it
        const p = (world.points ?? [])[e.point];
        if (p) for (const m of actorsOf(match)) if (!m.dead && m.team === e.team && Math.hypot(m.x - p.x, m.z - p.z) <= p.r) award(match, m.id, 'capture', P.capture, { name: e.name });
        continue;
      }
      if (e.type !== 'destroyed') continue;
      const dead = actorsOf(match).find((m) => m.id === e.target), killer = actorsOf(match).find((m) => m.id === e.by);
      if (!dead) continue;
      const lost = scoreOf(match, dead.id), wasOn = lost.streak;
      lost.deaths++; lost.streak = 0; lost.multi = 0;
      if (killer && killer !== dead && killer.team !== dead.team) {
        const won = scoreOf(match, killer.id), blow = lastHit.get(`${killer.id}:${dead.id}`);
        won.streak++; won.bestStreak = Math.max(won.bestStreak, won.streak);
        won.kills++;
        match.teamKills.set(killer.team, (match.teamKills.get(killer.team) ?? 0) + 1);
        award(match, killer.id, 'kill', P.kill, { target: dead.id });
        if (blow?.part === 'head') award(match, killer.id, 'head', P.head);
        if (blow && rules.isMelee(blow.weapon)) { won.blade++; award(match, killer.id, 'melee', P.melee); }
        if (!match.firstBlood) { match.firstBlood = true; won.firstBloods++; award(match, killer.id, 'firstBlood', P.firstBlood); }
        if (won.killedBy === dead.id) { won.killedBy = -1; won.revenges++; award(match, killer.id, 'revenge', P.revenge, { target: dead.id }); }
        if (wasOn >= 3) { won.shutdowns++; award(match, killer.id, 'shutdown', shutdownBonus(wasOn), { target: dead.id, n: wasOn }); }
        won.multi = world.tick - won.lastKill <= MULTI_WINDOW ? won.multi + 1 : 1; won.lastKill = world.tick; won.bestMulti = Math.max(won.bestMulti, won.multi);
        if (won.multi >= 2) award(match, killer.id, 'multi', multiBonus(won.multi), { n: won.multi });
        if (won.streak >= 2) award(match, killer.id, 'streak', streakBonus(won.streak), { n: won.streak, called: streakName(won.streak) !== null });
        lost.killedBy = killer.id;
        const least = Math.max(ASSIST_MIN, rules.maxHealth(dead) * ASSIST_SHARE);
        for (const h of match.hurt) {                                                      // everybody else who hurt the victim lately, and enough, helped
          if (h.target !== dead.id || h.by === killer.id || h.dmg < least || world.tick - h.at > ASSIST_WINDOW) continue;
          scoreOf(match, h.by).assists++; award(match, h.by, 'assist', P.assist, { target: dead.id });
        }
      }
      match.hurt = match.hurt.filter((h) => h.target !== dead.id && h.by !== dead.id);
      match.respawns.push({ id: dead.id, at: world.tick + match.respawnTicks });
    }
    if (match.hurt.length) match.hurt = match.hurt.filter((h) => world.tick - h.at <= ASSIST_WINDOW);
    const due = match.respawns.filter((r) => r.at <= world.tick);
    match.respawns = match.respawns.filter((r) => r.at > world.tick);
    for (const r of due) {
      const m = actorsOf(match).find((o) => o.id === r.id);
      if (!m) continue;
      rules.respawn(world, m, pickSpawn(world, m, rules));
      respawned.push(m.id);
    }
    const leader = leading(match);
    if (leader.score >= match.killLimit || world.tick >= match.endsAt) {
      match.over = true;
      match.winner = leader.tie ? null : leader;
    }
  }
  return { respawned };
}

/** Who is ahead: the team in a team match, otherwise the actor. @returns {{kind: string, id: number, score: number, tie: boolean}} `kind` is 'team' or the rules' `actorKind` */
export function leading(match) {
  const solo = match.rules.actorKind;
  const rows = isTeamMode(match.mode)
    ? [...new Set(actorsOf(match).map((m) => m.team))].map((team) => ({ kind: 'team', id: team, score: (match.mode === 'cp' ? match.teamPoints : match.teamKills).get(team) ?? 0, kills: match.teamKills.get(team) ?? 0 }))
    : actorsOf(match).map((m) => ({ kind: solo, id: m.id, score: scoreOf(match, m.id).kills, kills: 0 }));
  const extra = match.mode === 'cp' ? 1 : 0;                                              // (points level in control points: the team with more kills leads)
  rows.sort((a, b) => b.score - a.score || extra * (b.kills - a.kills) || a.id - b.id);
  const top = rows[0] ?? { kind: solo, id: -1, score: 0, kills: 0 };
  const { kills, ...lead } = top;
  return { ...lead, tie: rows.length > 1 && rows[1].score === top.score && (!extra || rows[1].kills === kills) };
}

/** How many seconds until an actor is back (0 if it is not waiting). */
export function respawnIn(match, id) {
  const r = match.respawns.find((x) => x.id === id);
  return r ? Math.max(0, Math.ceil((r.at - match.world.tick) / match.ticksPerSecond)) : 0;
}

/**
 * What the results screen shows: how it ended for `viewerId`, the teams' kills, and a row for every actor, best first (the match's best player is marked).
 * @param {ReturnType<typeof createMatch>} match @param {number} viewerId
 * @returns {{title: 'VICTORY' | 'DEFEAT' | 'DRAW' | 'IN PROGRESS', mode: 'dm' | 'tdm' | 'cp', killLimit: number, seconds: number,
 *   teams: Array<{team: number, kills: number, points: number, score: number, mine: boolean}> | null,
 *   rows: Array<MatchScore & {id: number, name: string, team: number, you: boolean, ally: boolean, mvp: boolean, kind: string}>}}
 */
export function matchSummary(match, viewerId) {
  const { world } = match, actors = actorsOf(match), me = actors.find((m) => m.id === viewerId);
  const rows = actors.map((m) => ({ ...scoreOf(match, m.id), id: m.id, name: m.name, team: m.team, you: m.id === viewerId, ally: !!me && m.team === me.team, mvp: false, kind: match.rules.label(m) }))
    .sort((a, b) => b.points - a.points || b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || a.id - b.id);
  if (rows.length) rows[0].mvp = true;
  const mine = isTeamMode(match.mode) ? match.winner?.id === me?.team : match.winner?.id === viewerId;
  const teams = isTeamMode(match.mode)
    ? [...new Set(actors.map((m) => m.team))].sort((a, b) => (a === me?.team ? -1 : b === me?.team ? 1 : a - b)).map((team) => ({ team, kills: match.teamKills.get(team) ?? 0, points: match.teamPoints.get(team) ?? 0, score: (match.mode === 'cp' ? match.teamPoints : match.teamKills).get(team) ?? 0, mine: team === me?.team }))
    : null;
  return {
    title: !match.over ? 'IN PROGRESS' : match.winner === null ? 'DRAW' : mine ? 'VICTORY' : 'DEFEAT', mode: match.mode, killLimit: match.killLimit,
    seconds: Math.round(Math.min(world.tick, match.endsAt) / match.ticksPerSecond), teams, rows,
  };
}
