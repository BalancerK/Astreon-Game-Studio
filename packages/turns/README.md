# @engine/turns

Turn-based and card games: the rules as plain functions, a room that runs them on a server, and a client. It handles the parts every such game needs: whose turn it is, hiding other players' secrets, refusing illegal moves, robots to fill seats, turn timers, and reconnecting. `examples/crazy-eights` is a complete game built on it (and the `multiplayer` template of `create-game`).

```js
import { defineGame, Match } from '@engine/turns';

export const race = defineGame({
  name: 'race', players: { min: 2, max: 3 }, turnMs: 20_000,
  setup: ({ players, random }) => ({ total: 0, secret: Object.fromEntries(players.map((p) => [p, random.int(100)])) }),
  moves: {
    add(G, ctx, n) { if (![1, 2, 3].includes(n)) ctx.fail('add 1, 2 or 3'); G.total += n; ctx.emit('added', { by: ctx.player, n }); if (G.total >= 10) G.winner = ctx.player; else ctx.endTurn(); },
  },
  view: (G, player) => ({ total: G.total, mine: G.secret[player] }),         // each player sees only their own secret
  endIf: (G) => (G.winner ? { winners: [G.winner] } : null),
  legalMoves: () => [1, 2, 3].map((n) => ({ move: 'add', arg: n })),         // for robots, hints and tests
});

const match = new Match(race, { players: ['ann', 'bob'], seed: 7 });
match.move('ann', 'add', 2);    // { ok: true, seq: 1, events: [...] }   a refused move is { ok: false, error } and changes nothing
match.viewFor('bob');           // what bob may see
match.save();                   // plain data; Match.load(race, data) carries on exactly where it stopped
```

## The rules: `defineGame`
`setup` makes the starting state (plain JSON), each entry of `moves` changes it in place, `view(state, player)` says what a player may see, `endIf` says whether and how it ended. A move can `ctx.emit` events for animations (everyone sees them), `ctx.emitTo(player, …)` for private ones (the card you drew), `ctx.endTurn(next?)` and `ctx.fail(reason)`. The random numbers (`ctx.random`) are seeded: the same seed and moves always give the same game, and a refused move does not use any. `turnMs` and `onTimeout` play for a slow player; `bot` says how a computer chooses (default: a random legal move); `isActive` skips players who are out. The rules know nothing about networks or screens, so they are tested like any function.

## On the server: `turnRoom`
```js
// room.js: what the server's RoomManager loads, in a thread or process of its own
import { turnRoom } from '@engine/turns/src/node.js';
export const createRoom = turnRoom(race);
```
Create a table with `manager.ensureRoom('t1', { expect: [{ id: 'ann' }, { id: 'bob' }], seats: 4 })`: only those players may join (with a `JoinTokens` token for that room, see `@engine/matchmaking`), the game starts when they are all there, robots take the other seats, and a player who is away gets a robot after `graceMs`. Without `expect`, players join until the table is full or `startWaitMs` has passed. After the game, players vote for a rematch; the room closes after `lingerMs`. `stats().lastResult` carries the finished game's result (winners, scores, players) so the server can record it once: ratings, a leaderboard (see `@engine/persist`).

## In the browser: `TurnClient`
```js
const client = new TurnClient({ createTransport: () => connectWebSocket(`${url}?t=${token}`), getToken: () => token });
client.onChange = () => draw(client.view, client.current, client.legal);     // legal: what you may do now
client.onEvents = (events) => animate(events);
client.start();
await client.move('add', 2);                                                 // resolves when accepted, rejects with the reason if refused
```
It keeps the latest view, reconnects with a fresh token after a drop, and reports `state` (`connecting`, `waiting`, `playing`, `over`, `reconnecting`, `closed`).

The wire format is one small JSON message per frame (`protocol.js`); the room checks every incoming message and limits how fast a player may send.
