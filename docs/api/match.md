# @engine/match

A match layer: score, assists, streaks, respawns, win rules, control points and a results summary, from a game's events.

```
npm install @engine/match
```

Version 0.1.0. The package's own README ([packages/match](../../packages/match/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (31 of 31 documented)

| Name | Kind | Summary |
|---|---|---|
| [`ASSIST_MIN`](#assist_min) | constant | The least damage that makes an assist: the larger of this and a share of the victim armour, so a graze is not one. |
| [`ASSIST_SHARE`](#assist_share) | constant | The share of the victim's health that damage must reach for an assist (or `ASSIST_MIN`, if that is more). |
| [`ASSIST_WINDOW`](#assist_window) | constant | How many ticks back damage counts for an assist (10 seconds). |
| [`CAPTURE_SECONDS`](#capture_seconds) | constant | How many seconds one actor alone takes to capture a point (a held point scores one a second). |
| [`CONTESTED`](#contested) | constant | How much of the usual speed a point is taken at when the other team still has actors on it but fewer. |
| [`KINDS`](#kinds) | constant | What each kind of award is called on the screen, and which colour it takes: 'main' (the usual), 'gold' (a good one), 'red' (a big one) or 'dim' (a small one). |
| [`MODE_NAMES`](#mode_names) | constant | Every kind of match and what it is called. |
| [`MULTI_WINDOW`](#multi_window) | constant | How many ticks a kill still counts as part of a multi-kill after the one before it (5 seconds). |
| [`PART_OF`](#part_of) | constant | Which part of a pilot's score each kind of award belongs to, and the name of the field in the score that keeps that part (what the results screen shows as "how you earned it"). |
| [`POINTS`](#points) | constant | The points for each thing, one number each (the rest are built from these: see `streakBonus` and `multiBonus`). |
| [`POINT_RADIUS`](#point_radius) | constant | How wide a control point is, in metres. |
| [`STREAKS`](#streaks) | constant | The runs of kills that are called out, and what they are called. |
| [`awardLabel`](#awardlabel) | function | The words for an award as it is shown: "KILL", "DOUBLE KILL", "KILLING SPREE"... |
| [`breakdown`](#breakdown) | function | How a pilot's score was made, largest part first: `{ key, label, points, note, tone }` for each part that is more than nothing. |
| [`cleanMode`](#cleanmode) | function | The mode a room or an address asks for, or team deathmatch if it is not one we know. |
| [`controlPoints`](#controlpoints) | function | The control points of a map: one in the middle between where the two teams start and one far out on each flank, on open land, each as near as can be to equally far from both teams, so that neither starts with a point to itself. |
| [`createMatch`](#creatematch) | function | Start a match over a world. |
| [`defaultLimit`](#defaultlimit) | function | The score the match is played to when nothing else is asked for: kills, or points held for a second each in control points. |
| [`isTeamMode`](#isteammode) | function | Two teams play (rather than every mecha for itself). |
| [`leading`](#leading) | function | Who is ahead: the team in a team match, otherwise the actor. |
| [`limitWord`](#limitword) | function | What the limit counts, for the screens. |
| [`matchSummary`](#matchsummary) | function | What the results screen shows: how it ended for `viewerId`, the teams' kills, and a row for every actor, best first (the match's best player is marked). |
| [`multiBonus`](#multibonus) | function | The extra points for the nth kill in quick succession: 25 for a double, then 50, 75 and 100 for the largest. |
| [`multiName`](#multiname) | function | The name of the nth kill in quick succession. |
| [`pickSpawn`](#pickspawn) | function | The best place for an actor to start: the spawn point furthest from every living enemy (ties go to the earlier one in the list). |
| [`respawnIn`](#respawnin) | function | How many seconds until an actor is back (0 if it is not waiting). |
| [`shutdownBonus`](#shutdownbonus) | function | What ending a run of `streak` kills is worth: 50, and 10 more for each kill over 3 (up to 100). |
| [`stepMatch`](#stepmatch) | function | Take in what happened this tick: score the kills, queue the comebacks, bring back actors whose time is up, and decide whether the match is over. |
| [`stepPoints`](#steppoints) | function | One tick of the control points: a point with only one team on it moves toward that team (a second actor helps, up to three), a point with equal numbers of both is held where it is (more of one team moves it slowly their way), and a point the team has taken all the way scores for it every second. |
| [`streakBonus`](#streakbonus) | function | The extra points for a run of kills: 10 for the second in a row, 10 more for each after it, up to 50. |
| [`streakName`](#streakname) | function | The name of a run of kills if it is one that is called out, else null. |

## Functions

### `awardLabel`

```js
function awardLabel(a, kinds = KINDS)
```

The words for an award as it is shown: "KILL", "DOUBLE KILL", "KILLING SPREE"...

**Parameters**

| Name | Type | Description |
|---|---|---|
| `a` | `{kind: string, n?: number}` |  |
| `kinds` (optional) | `Record<string, {label: string}>` | a table with a game's own kinds added to `KINDS` |

<sub>src/scoring.js:39</sub>

### `breakdown`

```js
function breakdown(row)
```

How a pilot's score was made, largest part first: `{ key, label, points, note, tone }` for each part that is more than nothing. `row` is a pilot's row from the match summary.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `row` | `{pk?: number, pa?: number, ps?: number, pb?: number, pp?: number, kills?: number, heads?: number, blade?: number, assists?: number, bestStreak?: number, bestMulti?: number, revenges?: number, shutdowns?: number, firstBloods?: number}` |  |

<sub>src/scoring.js:52</sub>

### `cleanMode`

```js
function cleanMode(mode)
```

The mode a room or an address asks for, or team deathmatch if it is not one we know.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mode` | `unknown` |  |

<sub>src/modes.js:11</sub>

### `controlPoints`

```js
function controlPoints(map, a, b)
```

The control points of a map: one in the middle between where the two teams start and one far out on each flank, on open land, each as near as can be to equally far from both teams, so that
neither starts with a point to itself. A point is found by looking over the land round where it ought to be for a place that is mostly above the sea all the way round and not steep (on a map
without land to look at, the spawn points stand in). Pure: the same map and starts give the same points.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `map` | `{spawns: number[][], heightAt?: (x: number, z: number) => number, half?: number}` |  |
| `a` (optional) | `number[]` | where the first team starts (x, z; the first spawn point if left out) |
| `b` (optional) | `number[]` | where the second does (the spawn furthest from the first) |

**Returns** `Array<{x: number, z: number, r: number, control: number, owner: number, name: string}>`

<sub>src/points.js:24</sub>

### `createMatch`

```js
function createMatch(world, { mode = 'tdm', killLimit = 15, timeLimitSeconds = 300, respawnSeconds = 5, rules = {} } = {})
```

Start a match over a world. The world needs `tick` (the current tick) and whatever `rules` ask of it (by default `world.actors` and `world.spawns`; in control points `world.points`).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `world` | `any` |  |
| `o` (optional) | `{mode?: 'dm' \| 'tdm' \| 'cp', killLimit?: number, timeLimitSeconds?: number, respawnSeconds?: number, rules?: MatchRules}` |  |

<sub>src/match.js:33</sub>

### `defaultLimit`

```js
function defaultLimit(mode)
```

The score the match is played to when nothing else is asked for: kills, or points held for a second each in control points.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mode` | `string` |  |

<sub>src/modes.js:14</sub>

### `isTeamMode`

```js
function isTeamMode(mode)
```

Two teams play (rather than every mecha for itself).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mode` | `string` |  |

<sub>src/modes.js:8</sub>

### `leading`

```js
function leading(match)
```

Who is ahead: the team in a team match, otherwise the actor.

**Returns** `{kind: string, id: number, score: number, tie: boolean}` — `kind` is 'team' or the rules' `actorKind`

<sub>src/match.js:169</sub>

### `limitWord`

```js
function limitWord(mode)
```

What the limit counts, for the screens.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `mode` | `string` |  |

<sub>src/modes.js:17</sub>

### `matchSummary`

```js
function matchSummary(match, viewerId)
```

What the results screen shows: how it ended for `viewerId`, the teams' kills, and a row for every actor, best first (the match's best player is marked).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `match` | `ReturnType<typeof createMatch>` |  |
| `viewerId` | `number` |  |

**Returns** `{title: 'VICTORY' \| 'DEFEAT' \| 'DRAW' \| 'IN PROGRESS', mode: 'dm' \| 'tdm' \| 'cp', killLimit: number, seconds: number,   teams: Array<{team: number, kills: number, points: number, score: number, mine: boolean}> \| null,   rows: Array<MatchScore & {id: number, name: string, team: number, you: boolean, ally: boolean, mvp: boolean, kind: string}>}`

<sub>src/match.js:194</sub>

### `multiBonus`

```js
function multiBonus(n)
```

The extra points for the nth kill in quick succession: 25 for a double, then 50, 75 and 100 for the largest.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `n` | `number` |  |

<sub>src/scoring.js:20</sub>

### `multiName`

```js
function multiName(n)
```

The name of the nth kill in quick succession.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `n` | `number` |  |

<sub>src/scoring.js:29</sub>

### `pickSpawn`

```js
function pickSpawn(world, m, rules = {})
```

The best place for an actor to start: the spawn point furthest from every living enemy (ties go to the earlier one in the list).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `world` | `any` |  |
| `m` | `any` |  |
| `rules` (optional) | `MatchRules` |  |

<sub>src/match.js:74</sub>

### `respawnIn`

```js
function respawnIn(match, id)
```

How many seconds until an actor is back (0 if it is not waiting).

<sub>src/match.js:182</sub>

### `shutdownBonus`

```js
function shutdownBonus(streak)
```

What ending a run of `streak` kills is worth: 50, and 10 more for each kill over 3 (up to 100).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `streak` | `number` |  |

<sub>src/scoring.js:22</sub>

### `stepMatch`

```js
function stepMatch(match, events)
```

Take in what happened this tick: score the kills, queue the comebacks, bring back actors whose time is up, and decide whether the match is over. The events: `shot` (`owner`, `pellet` for the extra
pellets of one shot), `hit` (`attacker`, `target`, `dealt`, `part`, `weapon`), `destroyed` (`target`, `by`), `capture` (`point`, `team`, `name`, made by the control points), and anything the rules' `onEvent` takes.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `match` | `ReturnType<typeof createMatch>` |  |
| `events` | `any[]` |  |

**Returns** `{respawned: number[]}`

<sub>src/match.js:94</sub>

### `stepPoints`

```js
function stepPoints(match, events)
```

One tick of the control points: a point with only one team on it moves toward that team (a second actor helps, up to three), a point with equal numbers of both is held where it is (more of one team moves it slowly their way), and a point the
team has taken all the way scores for it every second. The first team is 1, the second 2.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `match` | `any` |  |
| `events` | `any[]` |  |

<sub>src/points.js:71</sub>

### `streakBonus`

```js
function streakBonus(streak)
```

The extra points for a run of kills: 10 for the second in a row, 10 more for each after it, up to 50.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `streak` | `number` |  |

<sub>src/scoring.js:18</sub>

### `streakName`

```js
function streakName(streak)
```

The name of a run of kills if it is one that is called out, else null.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `streak` | `number` |  |

<sub>src/scoring.js:27</sub>

## Constants

### `ASSIST_MIN`

```js
const ASSIST_MIN
```

The least damage that makes an assist: the larger of this and a share of the victim armour, so a graze is not one.

Value: `40`

<sub>src/scoring.js:13</sub>

### `ASSIST_SHARE`

```js
const ASSIST_SHARE
```

The share of the victim's health that damage must reach for an assist (or `ASSIST_MIN`, if that is more).

Value: `0.08`

<sub>src/scoring.js:15</sub>

### `ASSIST_WINDOW`

```js
const ASSIST_WINDOW
```

How many ticks back damage counts for an assist (10 seconds).

Value: `600`

<sub>src/scoring.js:11</sub>

### `CAPTURE_SECONDS`

```js
const CAPTURE_SECONDS
```

How many seconds one actor alone takes to capture a point (a held point scores one a second).

Value: `8`

<sub>src/points.js:7</sub>

### `CONTESTED`

```js
const CONTESTED
```

How much of the usual speed a point is taken at when the other team still has actors on it but fewer.

Value: `0.4`

<sub>src/points.js:14</sub>

### `KINDS`

```js
const KINDS
```

What each kind of award is called on the screen, and which colour it takes: 'main' (the usual), 'gold' (a good one), 'red' (a big one) or 'dim' (a small one).

Value: `Object.freeze({`

<sub>src/scoring.js:32</sub>

### `MODE_NAMES`

```js
const MODE_NAMES
```

Every kind of match and what it is called.

Value: `Object.freeze({ tdm: 'Team deathmatch', cp: 'Control points', dm: 'Deathmatch' }`

<sub>src/modes.js:5</sub>

### `MULTI_WINDOW`

```js
const MULTI_WINDOW
```

How many ticks a kill still counts as part of a multi-kill after the one before it (5 seconds).

Value: `300`

<sub>src/scoring.js:9</sub>

### `PART_OF`

```js
const PART_OF
```

Which part of a pilot's score each kind of award belongs to, and the name of the field in the score that keeps that part (what the results screen shows as "how you earned it").

Value: `Object.freeze({ kill: 'pk', head: 'pk', melee: 'pk', assist: 'pa', streak: 'ps',`

<sub>src/scoring.js:46</sub>

### `POINTS`

```js
const POINTS
```

The points for each thing, one number each (the rest are built from these: see `streakBonus` and `multiBonus`).

Value: `Object.freeze({ kill: 100, head: 25, melee: 25, assist: 40, firstBlood: 50, reve`

<sub>src/scoring.js:6</sub>

### `POINT_RADIUS`

```js
const POINT_RADIUS
```

How wide a control point is, in metres.

Value: `180`

<sub>src/points.js:5</sub>

### `STREAKS`

```js
const STREAKS
```

The runs of kills that are called out, and what they are called.

Value: `Object.freeze({ 3: 'KILLING SPREE', 5: 'RAMPAGE', 7: 'UNSTOPPABLE', 10: 'LEGENDA`

<sub>src/scoring.js:25</sub>

## Types

### `MatchRules`

What the match needs to know about the game it is scoring (every one is optional).

Type: `object`

| Name | Type | Description |
|---|---|---|
| `actors` (optional) | `(world: any) => any[]` | Everything that can score: `{ id, team, dead, x, z, name }` each (default `world.actors`). |
| `spawns` (optional) | `(world: any) => number[][]` | Places to come back at, `[x, z]` each (default `world.spawns`). |
| `respawn` (optional) | `(world: any, actor: any, at: number[]) => void` | Bring a destroyed actor back at `at` (default: nothing). |
| `maxHealth` (optional) | `(actor: any) => number` | How much damage an actor can take at most, for the assists (default 100). |
| `isMelee` (optional) | `(weapon: string) => boolean` | Whether a kill with this weapon is a close-quarters one (default none). |
| `label` (optional) | `(actor: any) => string` | A short word about an actor for the results screen (default empty). |
| `points` (optional) | `Record<string, number>` | The points for each kind of award (default `POINTS`; spread it to add the game's own kinds). |
| `partOf` (optional) | `Record<string, string>` | Which part of the score each kind of award belongs to (default `PART_OF`). |
| `onEvent` (optional) | `(match: any, event: any, tools: {award: Function, scoreOf: Function}) => boolean` | Called first for every event; return true if it was the game's own kind of event (a parry), which the match then leaves alone. |
| `actorKind` (optional) | `string` | What the winner or leader is called when it is one actor and not a team (`winner.kind`; default 'actor'). |
| `ticksPerSecond` (optional) | `number` | How many simulation ticks make a second (default 60). |

### `MatchScore`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `kills` | `number` |  |
| `deaths` | `number` |  |
| `damage` | `number` |  |
| `hits` | `number` |  |
| `heads` | `number` |  |
| `shots` | `number` |  |
| `streak` | `number` | Kills in a row now. |
| `bestStreak` | `number` | The most kills in a row so far. |
| `points` | `number` | What the player has earned (see scoring.js). |
| `assists` | `number` |  |
| `multi` | `number` | Kills in the current quick run. |
| `bestMulti` | `number` |  |
| `lastKill` | `number` | The tick of the last kill. |
| `killedBy` | `number` | Who destroyed the player last (-1 for nobody, or once got back at). |
| `revenges` | `number` |  |
| `shutdowns` | `number` |  |
| `firstBloods` | `number` |  |
| `blade` | `number` | Kills made close up. |
| `pk` | `number` |  |
| `pa` | `number` |  |
| `ps` | `number` |  |
| `pb` | `number` |  |
| `pp` | `number` | The points that came from kills, assists, streaks and multi kills, bonuses and points taken (they add up to `points`). |
