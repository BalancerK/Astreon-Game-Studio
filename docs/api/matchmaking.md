# @engine/matchmaking

Getting players into games: fair queues with parties and widening skill windows, balanced teams, Elo ratings, a room directory with join codes and seat reservations, signed join tokens and an HTTP match service.

```
npm install @engine/matchmaking
```

Version 0.1.0. The package's own README ([packages/matchmaking](../../packages/matchmaking/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (7 of 7 documented)

| Name | Kind | Summary |
|---|---|---|
| [`Lobby`](#class-lobby) | class | The directory of rooms: what exists, what mode each plays, how many seats are free, short join codes for sharing a room, and seat reservations (a matched player has a few seconds to connect; until then the seat is theirs). |
| [`Matchmaker`](#class-matchmaker) | class | The matchmaking queue. |
| [`expectedScore`](#expectedscore) | function | The chance (0 to 1) that a side rated `a` beats a side rated `b`: 400 points apart means about 10 to 1. |
| [`partition`](#partition) | function | Split tickets into teams of at most `teamSize`, parties kept together, with the teams' average ratings as close as possible. |
| [`updateRatings`](#updateratings) | function | New ratings after a match between two or more teams. |
| [`JoinTokens`](#class-jointokens) | class (Node) | Signed, expiring tokens that say "this player may join this room". |
| [`MatchService`](#class-matchservice) | class (Node) | The matchmaking service: a `Matchmaker`, a timer that ticks it, and an HTTP handler. |

## Functions

### `expectedScore`

```js
function expectedScore(a, b, scale = 400)
```

The chance (0 to 1) that a side rated `a` beats a side rated `b`: 400 points apart means about 10 to 1.

<sub>src/rating.js:4</sub>

### `partition`

```js
function partition(items, teams, teamSize)
```

Split tickets into teams of at most `teamSize`, parties kept together, with the teams' average ratings as close as possible.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `items` | `Array<{size: number, rating: number}>` |  |

**Returns** `number[][] \| null` — for each team the indexes into `items`, or null if the parties cannot be placed.

<sub>src/matchmaker.js:44</sub>

### `updateRatings`

```js
function updateRatings(teams, { k, scale = 400, floor = 100 } = {})
```

New ratings after a match between two or more teams.
With more than two teams each pair counts once and a player's change is the average over their opponents, so a four-team free-for-all
is fair to everyone. Rating points are zero-sum between equal-sized teams.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `teams` | `Array<{players: Array<{id: string, rating: number, games?: number}>, place: number}>` | `place` 1 is the winner; equal places are a draw. |
| `o` (optional) | `{k?: number \| ((player: {games?: number}) => number), scale?: number, floor?: number}` | `k`: the most a rating can move in one match (default 32, or 40 for a player's first 10 games and 24 after 100); `floor`: the lowest rating (default 100). |

**Returns** `Map<string, {before: number, after: number, delta: number}>` — by player id

<sub>src/rating.js:17</sub>

## Classes

### `class Lobby`

```js
class Lobby
```

The directory of rooms: what exists, what mode each plays, how many seats are free, short join codes for sharing a room, and
seat reservations (a matched player has a few seconds to connect; until then the seat is theirs). Pure bookkeeping: you tell
it what happens and give it the clock.

#### `Lobby.constructor`

```js
constructor({ now = () => Date.now(), reservationMs = 15_000, codeLength = 5, random = Math.random } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.now` (optional) | `() => number` | Milliseconds. |
| `o.reservationMs` (optional) | `number` | How long a reserved seat is held (15 000). |
| `o.codeLength` (optional) | `number` | Characters in a join code (5: about 28 million codes). |
| `o.random` (optional) | `() => number` | A 0..1 generator, for codes (default `Math.random`). |

#### `Lobby.register`

```js
register(info)
```

Add a room, or replace what is known about it.

#### `Lobby.update`

```js
update(id, patch)
```

Change some fields (the player count, whether it is joinable). Unknown rooms are ignored.

#### `Lobby.remove`

```js
remove(id)
```

Forget a room, its reservations and its codes.

#### `Lobby.get`

```js
get(id)
```

#### `Lobby.freeSeats`

```js
freeSeats(id)
```

Seats nobody has and nobody is holding.

#### `Lobby.reserve`

```js
reserve(id, playerIds)
```

Hold seats for players who are about to connect.

| Name | Type | Description |
|---|---|---|
| `id` | `string` |  |
| `playerIds` | `string[]` |  |

**Returns** `{ok: true, expiresAt: number} \| {ok: false, reason: 'unknown' \| 'closed' \| 'full'}`

#### `Lobby.confirm`

```js
confirm(id, playerId)
```

A player connected: their reservation becomes a seat (count them with `update(id, { players })` as you see fit).

**Returns** `boolean` — true if they had one

#### `Lobby.release`

```js
release(id, playerId)
```

Give a held seat back.

#### `Lobby.hasReservation`

```js
hasReservation(id, playerId)
```

#### `Lobby.createCode`

```js
createCode(id)
```

A short code for sharing the room ("K7M2Q"). Codes are unique; asking again returns the same one.

#### `Lobby.resolveCode`

```js
resolveCode(code)
```

The room a code belongs to (any case, spaces and dashes ignored), or null.

#### `Lobby.list`

```js
list({ mode, region, joinable = true, minFree = 0 } = {})
```

Public rooms that can be listed, filtered and sorted.

| Name | Type | Description |
|---|---|---|
| `f` (optional) | `{mode?: string, region?: string, joinable?: boolean, minFree?: number}` |  |

**Returns** `Array<RoomInfo & {free: number}>` — fullest first (so games fill up rather than spreading thin)

#### `Lobby.findOpen`

```js
findOpen({ mode, size = 1, region = 'any', rating, ratingWindow = Infinity })
```

The room a quick-play player should go to: public, joinable, with room for the whole party, and a rating close to theirs;
among those, the fullest. Null means make a new room.

| Name | Type | Description |
|---|---|---|
| `q` | `{mode: string, size?: number, region?: string, rating?: number, ratingWindow?: number}` |  |

<sub>src/lobby.js:26</sub>

### `class Matchmaker`

```js
class Matchmaker
```

The matchmaking queue. Players (alone or in parties) `enqueue` for a mode; `tick()` turns the queue into matches: similar
ratings and even teams first, looser rules the longer someone has waited, a partly filled match after `relaxAfterMs`, and
tickets that waited too long come back as expired. No timers, network or randomness inside: you pass the clock and call
`tick()`.

#### `Matchmaker.constructor`

```js
constructor({ modes, now = () => Date.now(), defaultRating = 1000 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.modes` | `Record<string, ModeConfig>` | The game modes players can queue for. |
| `o.now` (optional) | `() => number` | Milliseconds; give it your own clock in tests and replays. |
| `o.defaultRating` (optional) | `number` | Rating of a player who has none (1000). |

#### `Matchmaker.enqueue`

```js
enqueue({ mode, players, region = 'any', meta = null, id })
```

Join the queue. A party is one ticket with several players.

| Name | Type | Description |
|---|---|---|
| `o` | `{mode: string, players: Array<string \| {id: string, rating?: number}>, region?: string, meta?: any, id?: string}` |  |

**Returns** `Ticket`

#### `Matchmaker.cancel`

```js
cancel(ticketId)
```

Leave the queue.

**Returns** `boolean` — false if there was no such ticket (already matched, expired or cancelled)

#### `Matchmaker.ticketOf`

```js
ticketOf(playerId)
```

The ticket a player is waiting with, or null.

#### `Matchmaker.get`

```js
get(ticketId)
```

#### `Matchmaker.stats`

```js
stats()
```

How many tickets and players wait, per mode.

#### `Matchmaker.window`

```js
window(ticket, now = this.now())
```

The rating difference a ticket accepts now: it grows with the waiting.

#### `Matchmaker.tick`

```js
tick()
```

Make the matches that can be made, and give up on tickets that waited too long.

**Returns** `{matches: Match[], expired: Ticket[]}`

<sub>src/matchmaker.js:78</sub>

## Node entry

These come from `@engine/matchmaking/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { JoinTokens, MatchService } from '@engine/matchmaking/src/node.js';
```

### `class JoinTokens`

```js
class JoinTokens
```

Signed, expiring tokens that say "this player may join this room". Anyone can read one; no one can make or change one without the secret.

#### `JoinTokens.constructor`

```js
constructor({ secret, ttlMs = 30_000, now = () => Date.now(), oneTime = false })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.secret` | `string \| Record<string, string>` | A secret (at least 16 characters), or `{ keyId: secret }` for several: the first one signs, all of them verify (rotate by adding a new first key and removing the old one later). |
| `o.ttlMs` (optional) | `number` | How long a token works (30 000). |
| `o.now` (optional) | `() => number` |  |
| `o.oneTime` (optional) | `boolean` | Each token works once (a stolen or replayed one is refused). |

#### `JoinTokens.issue`

```js
issue({ player, room, extra = null, ttlMs = this.ttlMs })
```

A token for a player to enter a room. `extra` rides along (their team, for example) and is covered by the signature.

#### `JoinTokens.verify`

```js
verify(token, { room } = {})
```

Check a token. Never throws.

| Name | Type | Description |
|---|---|---|
| `token` | `string` |  |
| `expect` (optional) | `{room?: string}` | The room it must be for (leave out to accept any). |

**Returns** `{ok: true, player: string, room: string, expiresAt: number, extra: any} \| {ok: false, reason: 'malformed' \| 'unknown-key' \| 'bad-signature' \| 'expired' \| 'wrong-room' \| 'used'}`

<sub>src/node.js:10</sub>

### `class MatchService`

```js
class MatchService
```

The matchmaking service: a `Matchmaker`, a timer that ticks it, and an HTTP handler.

  POST   /queue        { mode, players?: [ids], region?, meta? }  ->  201 { ticket }
  GET    /ticket/<id>  ->  { status: 'waiting' | 'matched' | 'expired' | 'cancelled', ... }  (matched: { room, token, team, match })
  DELETE /ticket/<id>  ->  204
  GET    /status       ->  { modes: { duel: { tickets, players, estimatedWaitMs } } }

`userOf(req)` says who is calling (your login check); a caller may only queue as themselves, and as a party only players `canParty` allows.

#### `MatchService.constructor`

```js
constructor({ modes, tokens, createRoom, userOf, ratingOf, canParty = () => false, tickMs = 500, resultTtlMs = 120_000, now = () => Date.now(), log = () => {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.modes` | `Record<string, import('./matchmaker.js').ModeConfig>` |  |
| `o.tokens` | `JoinTokens` |  |
| `o.createRoom` | `(match: import('./matchmaker.js').Match) => Promise<{room: string, [k: string]: any}>` | Make (or find) the room for a match; return its name and anything the client needs to connect (`url`). |
| `o.userOf` | `(req: any) => string \| null \| Promise<string \| null>` | The caller's player id, or null to refuse. |
| `o.ratingOf` (optional) | `(playerId: string) => number \| Promise<number>` | A player's rating (default: the matchmaker's default). |
| `o.canParty` (optional) | `(req: any, ids: string[]) => boolean \| Promise<boolean>` | May this caller queue these other players with them (default: no parties)? |
| `o.tickMs` (optional) | `number` | How often the queue is turned into matches (500). |
| `o.resultTtlMs` (optional) | `number` | How long a finished ticket's outcome can still be read (120 000). |
| `o.now` (optional) | `() => number` |  |
| `o.log` (optional) | `(msg: string) => void` |  |

#### `MatchService.start`

```js
start()
```

Start ticking.

#### `MatchService.stop`

```js
stop()
```

#### `MatchService.tick`

```js
async tick()
```

Turn the queue into matches now (the timer calls this; tests can too).

#### `MatchService.handle`

```js
async handle(req, res, path)
```

The HTTP handler. `path` is the part of the URL after where you mounted it (`/queue`, `/ticket/t1`...).

**Returns** `Promise<void>`

<sub>src/node.js:70</sub>

## Types

### `Match`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `teams` (optional) | `number` | Teams in a match (2). |
| `teamSize` (optional) | `number` | Players per team (1). |
| `minPlayers` (optional) | `number` | The fewest players a match may start with once `relaxAfterMs` has passed (default: a full match only). |
| `relaxAfterMs` (optional) | `number` | After this long the oldest ticket may be matched into a partly filled match (default: never). |
| `maxWaitMs` (optional) | `number` | After this long a ticket gives up and is returned as expired (default 120 000). |
| `initialWindow` (optional) | `number` | Rating difference allowed at first (100). |
| `widenPerSecond` (optional) | `number` | How much that grows each second of waiting (25). |
| `maxWindow` (optional) | `number` | The widest it gets (800). |
| `id` | `string` |  |
| `mode` | `string` |  |
| `players` | `Array<{id: string, rating: number}>` | One for a solo player, more for a party (kept on one team). |
| `rating` | `number` | The party's average rating. |
| `region` | `string` | A region name, or `"any"`. |
| `enqueuedAt` | `number` |  |
| `meta` | `any` | Whatever the game attached. |
| `id` | `string` |  |
| `mode` | `string` |  |
| `teams` | `Array<{players: Array<{id: string, rating: number, ticket: string}>, rating: number}>` |  |
| `tickets` | `Ticket[]` |  |
| `ratingSpread` | `number` | Highest minus lowest ticket rating. |
| `teamBalance` | `number` | How far apart the best and worst teams' average ratings are. |
| `waitedMs` | `number` | How long the oldest ticket waited. |
| `needsFill` | `number` | Slots left empty: fill them with bots or let others join. |
| `region` | `string` |  |

### `ModeConfig`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `teams` (optional) | `number` | Teams in a match (2). |
| `teamSize` (optional) | `number` | Players per team (1). |
| `minPlayers` (optional) | `number` | The fewest players a match may start with once `relaxAfterMs` has passed (default: a full match only). |
| `relaxAfterMs` (optional) | `number` | After this long the oldest ticket may be matched into a partly filled match (default: never). |
| `maxWaitMs` (optional) | `number` | After this long a ticket gives up and is returned as expired (default 120 000). |
| `initialWindow` (optional) | `number` | Rating difference allowed at first (100). |
| `widenPerSecond` (optional) | `number` | How much that grows each second of waiting (25). |
| `maxWindow` (optional) | `number` | The widest it gets (800). |
| `id` | `string` |  |
| `mode` | `string` |  |
| `players` | `Array<{id: string, rating: number}>` | One for a solo player, more for a party (kept on one team). |
| `rating` | `number` | The party's average rating. |
| `region` | `string` | A region name, or `"any"`. |
| `enqueuedAt` | `number` |  |
| `meta` | `any` | Whatever the game attached. |
| `id` | `string` |  |
| `mode` | `string` |  |
| `teams` | `Array<{players: Array<{id: string, rating: number, ticket: string}>, rating: number}>` |  |
| `tickets` | `Ticket[]` |  |
| `ratingSpread` | `number` | Highest minus lowest ticket rating. |
| `teamBalance` | `number` | How far apart the best and worst teams' average ratings are. |
| `waitedMs` | `number` | How long the oldest ticket waited. |
| `needsFill` | `number` | Slots left empty: fill them with bots or let others join. |
| `region` | `string` |  |

### `RoomInfo`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `id` | `string` |  |
| `mode` | `string` |  |
| `capacity` | `number` | Seats in the room. |
| `players` | `number` | Players in it now. |
| `region` | `string` | A region name or `"any"`. |
| `joinable` | `boolean` | False while the room is starting, ending or locked. |
| `isPrivate` | `boolean` | Private rooms are not listed or offered by `findOpen`; only a code finds them. |
| `rating` | `number` | Average rating of the players in it (for matching new players to it). |
| `meta` | `any` | Whatever the game attached (a map name, a server address). |

### `Ticket`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `teams` (optional) | `number` | Teams in a match (2). |
| `teamSize` (optional) | `number` | Players per team (1). |
| `minPlayers` (optional) | `number` | The fewest players a match may start with once `relaxAfterMs` has passed (default: a full match only). |
| `relaxAfterMs` (optional) | `number` | After this long the oldest ticket may be matched into a partly filled match (default: never). |
| `maxWaitMs` (optional) | `number` | After this long a ticket gives up and is returned as expired (default 120 000). |
| `initialWindow` (optional) | `number` | Rating difference allowed at first (100). |
| `widenPerSecond` (optional) | `number` | How much that grows each second of waiting (25). |
| `maxWindow` (optional) | `number` | The widest it gets (800). |
| `id` | `string` |  |
| `mode` | `string` |  |
| `players` | `Array<{id: string, rating: number}>` | One for a solo player, more for a party (kept on one team). |
| `rating` | `number` | The party's average rating. |
| `region` | `string` | A region name, or `"any"`. |
| `enqueuedAt` | `number` |  |
| `meta` | `any` | Whatever the game attached. |
| `id` | `string` |  |
| `mode` | `string` |  |
| `teams` | `Array<{players: Array<{id: string, rating: number, ticket: string}>, rating: number}>` |  |
| `tickets` | `Ticket[]` |  |
| `ratingSpread` | `number` | Highest minus lowest ticket rating. |
| `teamBalance` | `number` | How far apart the best and worst teams' average ratings are. |
| `waitedMs` | `number` | How long the oldest ticket waited. |
| `needsFill` | `number` | Slots left empty: fill them with bots or let others join. |
| `region` | `string` |  |
