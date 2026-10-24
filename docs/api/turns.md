# @engine/turns

Turn-based and card games: rules as plain functions with hidden information and seeded randomness, a server room (tokens, robots, turn timers, rematch) and a client with reconnect.

```
npm install @engine/turns
```

Version 0.1.0. The package's own README ([packages/turns](../../packages/turns/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (12 of 12 documented)

| Name | Kind | Summary |
|---|---|---|
| [`MAX_CLIENT_MESSAGE`](#max_client_message) | constant | The largest message a room accepts from a player. |
| [`Match`](#class-match) | class | One game being played. |
| [`MoveError`](#class-moveerror) | class | A move the rules refuse (not allowed now, bad argument). |
| [`Rng`](#class-rng) | class | A small seeded random number generator whose position (`state`) can be saved and restored, so a game saved in the middle deals the same cards as one that never stopped. |
| [`TurnClient`](#class-turnclient) | class | The player's side of a turn-based game: connects to the room with a join token, keeps the latest `view`, `current` player and `legal` moves, sends moves (`move()` resolves when the room accepts it), and reconnects with a fresh token if the connection drops. |
| [`botMove`](#botmove) | function | The move a computer player makes: the game's `bot` if it has one, else a random legal move. |
| [`defineGame`](#definegame) | function | Check a game definition and fill in the defaults. |
| [`encode`](#encode) | function | A message as bytes for the wire. |
| [`parseClientMessage`](#parseclientmessage) | function | Read a message from a player, with checks: a bad one is `null`, never an exception. |
| [`parseServerMessage`](#parseservermessage) | function | Read a message from the room. |
| [`TurnRoom`](#class-turnroom) | class (Node) | A running table: checks join tokens, seats the players, starts the match, applies moves with the game's own rules, sends each player only what they may see, plays for robots and for players who are away, enforces turn limits, offers a rematch, and reports each result through `stats()`. |
| [`turnRoom`](#turnroom) | function (Node) | Turn a game definition into the `createRoom(options)` that the server's `RoomManager` loads (in a worker thread or a process of its own). |

## Functions

### `botMove`

```js
function botMove(match, player, random = match.rng)
```

The move a computer player makes: the game's `bot` if it has one, else a random legal move.

**Returns** `{move: string, arg?: any} \| null` — null when there is nothing to do

<sub>src/game.js:163</sub>

### `defineGame`

```js
function defineGame(def)
```

Check a game definition and fill in the defaults.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `def` | `GameDefinition` |  |

<sub>src/game.js:43</sub>

### `encode`

```js
function encode(msg)
```

A message as bytes for the wire.

<sub>src/protocol.js:11</sub>

### `parseClientMessage`

```js
function parseClientMessage(bytes)
```

Read a message from a player, with checks: a bad one is `null`, never an exception.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array \| ArrayBuffer` |  |

**Returns** `{t: 'hello', token: string, name?: string} \| {t: 'move', id: number, move: string, arg?: any} \| {t: 'rematch'} \| {t: 'ping', n: number} \| {t: 'leave'} \| null`

<sub>src/protocol.js:21</sub>

### `parseServerMessage`

```js
function parseServerMessage(data)
```

Read a message from the room.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `data` | `Uint8Array \| ArrayBuffer \| string` |  |

**Returns** `any \| null`

<sub>src/protocol.js:37</sub>

## Classes

### `class Match`

```js
class Match
```

One game being played.

#### `Match.constructor`

```js
constructor(game, { players, seed = 1, options = {}, now = 0 })
```

| Name | Type | Description |
|---|---|---|
| `game` | `GameDefinition` |  |
| `o` | `object` |  |
| `o.players` | `Array<string \| {id: string, name?: string, bot?: boolean}>` | In turn order. |
| `o.seed` (optional) | `number` | The random seed (the same seed and the same moves always give the same game). |
| `o.options` (optional) | `any` | Passed to `setup`. |
| `o.now` (optional) | `number` | When it starts (milliseconds), for the turn timer. |

#### `Match.move`

```js
move(player, move, arg, now = 0, { auto = false } = {})
```

Make a move. Never throws for a refused move: you get `{ ok: false, error }` and the game is unchanged.

| Name | Type | Description |
|---|---|---|
| `player` | `string` |  |
| `move` | `string` |  |
| `arg` (optional) | `any` |  |
| `now` (optional) | `number` |  |
| `o` (optional) | `{auto?: boolean}` |  |

**Returns** `{ok: true, seq: number, events: any[], current: string \| null, over: any} \| {ok: false, error: string}`

#### `Match.viewFor`

```js
viewFor(player)
```

What one player may see (`null`: a spectator).

#### `Match.eventsFor`

```js
static eventsFor(events, player)
```

The events of a move, as one player may see them: private events for others are left out.

#### `Match.legalMoves`

```js
legalMoves(player)
```

Every move `player` could make now.

#### `Match.turnLeftMs`

```js
turnLeftMs(now)
```

Milliseconds left in the current turn, or null if turns are not timed.

#### `Match.timeout`

```js
timeout(now)
```

If the current player has run out of time, play for them.

**Returns** `ReturnType<Match['move']> \| null` — the move that was made, or null if there was no need

#### `Match.save`

```js
save()
```

The whole game as plain data, to store and `Match.load` later (reconnecting after a crash, a game paused for a day).

#### `Match.load`

```js
static load(game, data)
```

| Name | Type | Description |
|---|---|---|
| `game` | `GameDefinition` |  |
| `data` | `any` |  |

<sub>src/game.js:53</sub>

### `class MoveError`

```js
class MoveError extends Error
```

A move the rules refuse (not allowed now, bad argument). Throw it from a move with `ctx.fail("why")`; the game is left as it was.

#### `MoveError.constructor`

```js
constructor(message)
```

<sub>src/game.js:7</sub>

### `class Rng`

```js
class Rng
```

A small seeded random number generator whose position (`state`) can be saved and restored, so a game saved in the middle
deals the same cards as one that never stopped. Integer maths only: the same seed gives the same numbers in every JavaScript
engine.

#### `Rng.constructor`

```js
constructor(seed = 1)
```

| Name | Type | Description |
|---|---|---|
| `seed` (optional) | `number` | Any whole number. |

#### `Rng.random`

```js
random()
```

The next number, 0 up to (not including) 1.

#### `Rng.int`

```js
int(n)
```

A whole number from 0 up to (not including) `n`.

#### `Rng.pick`

```js
pick(list)
```

A random element of a list.

#### `Rng.shuffle`

```js
shuffle(list)
```

Put a list in random order, in place (every order equally likely). Returns the list.

<sub>src/rng.js:9</sub>

### `class TurnClient`

```js
class TurnClient
```

The player's side of a turn-based game: connects to the room with a join token, keeps the latest `view`, `current` player
and `legal` moves, sends moves (`move()` resolves when the room accepts it), and reconnects with a fresh token if the
connection drops. It draws nothing: a page reads its fields and listens to `onEvents`.

**Properties**

| Name | Type | Description |
|---|---|---|
| `createTransport` | `() => import('../../transport/src/types.js').Transport` | Open a connection (called again to reconnect). |
| `getToken` | `() => string \| Promise<string>` | A join token for this room (called on every connect, so a reconnect can use a fresh one). |
| `name` (optional) | `string` | The name to show. |
| `reconnect` (optional) | `{maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number} \| null` | Backoff for reconnecting after an unexpected disconnect (default 6 tries from 300 ms); `null` never reconnects. |
| `now` (optional) | `() => number` | Milliseconds, for the turn countdown. |
| `setTimer` (optional) | `(ms: number, fn: () => void) => any` | Timer, replaceable in tests. |
| `moveTimeoutMs` (optional) | `number` | A move that gets no answer in this long fails (8000). |

#### `TurnClient.constructor`

```js
constructor({ createTransport, getToken, name, reconnect = {}, now = () => Date.now(), setTimer = (ms, fn) => setTimeout(fn, ms), moveTimeoutMs = 8000 })
```

| Name | Type | Description |
|---|---|---|
| `o` | `TurnClientOptions` |  |

#### `TurnClient.start`

```js
start()
```

Connect. Returns `this`.

#### `TurnClient.myTurn`

```js
get myTurn
```

Whose turn it is: is it yours?

#### `TurnClient.turnLeftMs`

```js
turnLeftMs()
```

Milliseconds left in the current turn (null when turns are not timed).

#### `TurnClient.nameOf`

```js
nameOf(id)
```

The name of a player.

#### `TurnClient.move`

```js
move(move, arg)
```

Make a move. Resolves when the room has accepted it (and the game has moved on); rejects with the room's reason if it was refused.

| Name | Type | Description |
|---|---|---|
| `move` | `string` |  |
| `arg` (optional) | `any` |  |

**Returns** `Promise<{ok: true, seq: number}>`

#### `TurnClient.rematch`

```js
rematch()
```

Vote for another game after this one.

#### `TurnClient.ping`

```js
ping()
```

Measure the round trip (see `pingMs`).

#### `TurnClient.close`

```js
close()
```

Leave on purpose: no reconnecting.

<sub>src/client.js:23</sub>

## Constants

### `MAX_CLIENT_MESSAGE`

```js
const MAX_CLIENT_MESSAGE
```

The largest message a room accepts from a player.

Value: `4096`

<sub>src/protocol.js:14</sub>

## Node entry

These come from `@engine/turns/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { TurnRoom, turnRoom } from '@engine/turns/src/node.js';
```

### `class TurnRoom`

```js
class TurnRoom
```

A running table: checks join tokens, seats the players, starts the match, applies moves with the game's own rules, sends
each player only what they may see, plays for robots and for players who are away, enforces turn limits, offers a rematch,
and reports each result through `stats()`. Normally created for you by `turnRoom(game)`.

#### `TurnRoom.constructor`

```js
constructor(game, options, { now = () => Date.now(), timer = false, onGameOver } = {})
```

| Name | Type | Description |
|---|---|---|
| `game` | `import('./game.js').GameDefinition` |  |
| `options` | `TurnRoomOptions` |  |
| `env` (optional) | `{now?: () => number, timer?: boolean, onGameOver?: (result: any, match: Match) => void}` | Tests give a clock and tick the room themselves. |

#### `TurnRoom.attach`

```js
attach(transport)
```

A new connection from the server (the room module contract).

| Name | Type | Description |
|---|---|---|
| `transport` | `import('@engine/transport').Transport` |  |

#### `TurnRoom.tick`

```js
tick()
```

Advance time: start the game when it is time, play for bots and absent players, enforce turn limits, close after the linger. The room calls this itself every 100 ms.

#### `TurnRoom.close`

```js
async close()
```

#### `TurnRoom.stats`

```js
stats()
```

Numbers for the server's room list: connected players, the phase, and the result of the last game (so the server can record it once).

#### `TurnRoom.control`

```js
control(data)
```

<sub>src/node.js:49</sub>

### `turnRoom`

```js
function turnRoom(game, defaults = {})
```

Turn a game definition into the `createRoom(options)` that the server's `RoomManager` loads (in a worker thread or a process
of its own). Export the result from a room module: `export const createRoom = turnRoom(myGame)`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `game` | `import('./game.js').GameDefinition` |  |
| `defaults` (optional) | `Partial<TurnRoomOptions>` |  |

**Returns** `(options?: TurnRoomOptions) => Promise<TurnRoom>` — the `createRoom` a room module exports

<sub>src/node.js:40</sub>

## Types

### `GameDefinition`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `player` | `string` | Who is moving. |
| `players` | `string[]` | Everyone, in turn order. |
| `random` | `Rng` | The match's random numbers (the same seed gives the same game). |
| `seq` | `number` | Moves made so far. |
| `now` | `number` | The time of the move (milliseconds). |
| `emit` | `(name: string, data?: any) => void` | Something everyone sees happened (`"drew"`, `"played"`): for animations and logs. |
| `emitTo` | `(player: string, name: string, data?: any) => void` | Something only one player sees (the card you drew). |
| `endTurn` | `(next?: string) => void` | Pass the turn to the next player, or to `next`. |
| `fail` | `(reason: string) => never` | Refuse the move. |
| `name` | `string` |  |
| `players` | `{min: number, max: number}` | How many may play. |
| `setup` | `(ctx: {players: string[], random: Rng, options: any}) => any` | The starting state. It must be plain JSON data. |
| `moves` | `Record<string, ((state: any, ctx: MoveContext, arg: any) => any) \| {move: (state: any, ctx: MoveContext, arg: any) => any, anyTime?: boolean}>` | Each move changes `state` in place (or returns a new one). Only the player whose turn it is may move, unless the move says `anyTime: true`. |
| `view` (optional) | `(state: any, player: string \| null, meta: {current: string \| null, over: any, players: string[], seq: number}) => any` | What `player` may see (`null`: a spectator). Hide other players' secrets here. Default: everything. |
| `endIf` (optional) | `(state: any, players: string[]) => ({winners: string[], scores?: Record<string, number>, reason?: string} \| null)` | Is the game over? |
| `legalMoves` (optional) | `(state: any, player: string, players: string[]) => Array<{move: string, arg?: any}>` | Every move `player` could make now (for bots, hints and tests). |
| `firstPlayer` (optional) | `(state: any, players: string[]) => string` | Who starts (default: the first in the list). |
| `isActive` (optional) | `(state: any, player: string) => boolean` | False for a player who is out: their turn is skipped. |
| `turnMs` (optional) | `number` | How long a turn may take; then `onTimeout` (or a legal move) is played for the player. |
| `onTimeout` (optional) | `(state: any, player: string, players: string[]) => ({move: string, arg?: any} \| null)` | What to play when time runs out. |
| `bot` (optional) | `(o: {view: any, legal: Array<{move: string, arg?: any}>, random: Rng, player: string}) => ({move: string, arg?: any} \| null)` | How a computer player chooses. |

### `MoveContext`

What a move can use.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `player` | `string` | Who is moving. |
| `players` | `string[]` | Everyone, in turn order. |
| `random` | `Rng` | The match's random numbers (the same seed gives the same game). |
| `seq` | `number` | Moves made so far. |
| `now` | `number` | The time of the move (milliseconds). |
| `emit` | `(name: string, data?: any) => void` | Something everyone sees happened (`"drew"`, `"played"`): for animations and logs. |
| `emitTo` | `(player: string, name: string, data?: any) => void` | Something only one player sees (the card you drew). |
| `endTurn` | `(next?: string) => void` | Pass the turn to the next player, or to `next`. |
| `fail` | `(reason: string) => never` | Refuse the move. |
| `name` | `string` |  |
| `players` | `{min: number, max: number}` | How many may play. |
| `setup` | `(ctx: {players: string[], random: Rng, options: any}) => any` | The starting state. It must be plain JSON data. |
| `moves` | `Record<string, ((state: any, ctx: MoveContext, arg: any) => any) \| {move: (state: any, ctx: MoveContext, arg: any) => any, anyTime?: boolean}>` | Each move changes `state` in place (or returns a new one). Only the player whose turn it is may move, unless the move says `anyTime: true`. |
| `view` (optional) | `(state: any, player: string \| null, meta: {current: string \| null, over: any, players: string[], seq: number}) => any` | What `player` may see (`null`: a spectator). Hide other players' secrets here. Default: everything. |
| `endIf` (optional) | `(state: any, players: string[]) => ({winners: string[], scores?: Record<string, number>, reason?: string} \| null)` | Is the game over? |
| `legalMoves` (optional) | `(state: any, player: string, players: string[]) => Array<{move: string, arg?: any}>` | Every move `player` could make now (for bots, hints and tests). |
| `firstPlayer` (optional) | `(state: any, players: string[]) => string` | Who starts (default: the first in the list). |
| `isActive` (optional) | `(state: any, player: string) => boolean` | False for a player who is out: their turn is skipped. |
| `turnMs` (optional) | `number` | How long a turn may take; then `onTimeout` (or a legal move) is played for the player. |
| `onTimeout` (optional) | `(state: any, player: string, players: string[]) => ({move: string, arg?: any} \| null)` | What to play when time runs out. |
| `bot` (optional) | `(o: {view: any, legal: Array<{move: string, arg?: any}>, random: Rng, player: string}) => ({move: string, arg?: any} \| null)` | How a computer player chooses. |

### `TurnClientOptions`

The player's side of a turn-based game: connects to the room with a join token, keeps the latest `view`, `current` player
and `legal` moves, sends moves (`move()` resolves when the room accepts it), and reconnects with a fresh token if the
connection drops. It draws nothing: a page reads its fields and listens to `onEvents`.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `createTransport` | `() => import('../../transport/src/types.js').Transport` | Open a connection (called again to reconnect). |
| `getToken` | `() => string \| Promise<string>` | A join token for this room (called on every connect, so a reconnect can use a fresh one). |
| `name` (optional) | `string` | The name to show. |
| `reconnect` (optional) | `{maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number} \| null` | Backoff for reconnecting after an unexpected disconnect (default 6 tries from 300 ms); `null` never reconnects. |
| `now` (optional) | `() => number` | Milliseconds, for the turn countdown. |
| `setTimer` (optional) | `(ms: number, fn: () => void) => any` | Timer, replaceable in tests. |
| `moveTimeoutMs` (optional) | `number` | A move that gets no answer in this long fails (8000). |
