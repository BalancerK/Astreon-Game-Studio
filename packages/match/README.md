# @engine/match

A match layer: who has scored, who destroyed whom, assists, runs of kills, when a destroyed player comes back and where, how the match is won, control points, and the summary a results screen shows. It reads the game's **events** and nothing else, so a server and every player's browser count the same score. It came out of a competitive 3D game and does not know what a character, a weapon or a map is.

**May import:** `@engine/math`.

```js
import { createMatch, stepMatch, matchSummary, leading, respawnIn, POINTS } from '@engine/match';

const match = createMatch(world, {
  mode: 'tdm', killLimit: 25, timeLimitSeconds: 300, respawnSeconds: 5,      // 'dm' (everyone alone), 'tdm' (two teams) or 'cp' (control points)
  rules: {
    actors: (w) => w.players,                                                // everything that can score: { id, team, dead, x, z, name }
    spawns: (w) => w.spawns,                                                 // [x, z] places to start at
    respawn: (w, p, at) => { p.x = at[0]; p.z = at[1]; p.hp = p.maxHp; p.dead = false; },
    maxHealth: (p) => p.maxHp,                                               // the least damage that is an assist is a share of this
    isMelee: (weapon) => weapon === 'sword',                                 // close-up kills pay extra
  },
});

// every tick, after the world moved and said what happened:
const { respawned } = stepMatch(match, [
  { type: 'hit', attacker: 1, target: 2, dealt: 40, part: 'head', weapon: 'rifle' },
  { type: 'destroyed', target: 2, by: 1 },
]);
if (match.over) show(matchSummary(match, myId));       // { title: 'VICTORY' | 'DEFEAT' | 'DRAW', teams, rows: [{ id, name, points, kills, deaths, assists, ... mvp }] }
```

## What it does
- **Events it reads:** `shot` (`owner`, and `pellet: true` for the extra pellets of one shot), `hit` (`attacker`, `target`, `dealt`, `part`, `weapon`), `destroyed` (`target`, `by`), and `capture` (`point`, `team`, `name`, made by the control points). Anything else goes to `rules.onEvent` first, so a game adds its own (a parry, a flag).
- **Scoring:** a kill, a head shot, a close-up kill, an **assist** (damage in the last 10 seconds, at least 40 and 8% of the victim's health, not the killer's), runs of kills (called out at 3, 5, 7 and 10), quick kills, first blood, revenge, ending somebody's run, holding a control point. `POINTS`, `KINDS` and `PART_OF` are plain tables to spread and extend; `breakdown(row)` says how a score was made.
- **Respawns:** a destroyed actor comes back after `respawnSeconds` at the start furthest from its living enemies (`pickSpawn`).
- **Winning:** the first to the limit, or whoever leads when time is up; level is a draw (`winner` is null). In a team match the team counts; in control points a held point scores a second and kills break a tie.
- **Control points:** `controlPoints(map, a, b)` finds three fair ones (the middle, and one out on each flank) on open land from the map's heights and starts, the same on every machine; `stepPoints` moves them as actors stand on them (more help a little, a contested point is slower).
- **Modes:** `MODE_NAMES`, `isTeamMode`, `cleanMode`, `defaultLimit`, `limitWord`.
- The match is plain data (`scores`, `teamKills`, `teamPoints`, `respawns`, `hurt`, `awards`, `over`, `winner`), so it can be copied and sent; `match.rules` holds the functions you gave.

## Tests
`packages/match/test/match.test.js` plays matches over a tiny fake world: scoring, assists, respawns, winning, the summary, a game's own kind of award, and control points.
