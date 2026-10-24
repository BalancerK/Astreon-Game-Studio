# @engine/matchmaking

Getting players into games: queues that make fair matches, a directory of rooms with join codes and seat reservations, Elo ratings, and signed tokens so only matched players can enter a match's room. The queue and the directory are plain bookkeeping with no timers or network (you pass the clock and call `tick()`), so they are exact to test; `@engine/matchmaking/src/node.js` adds the Node pieces (tokens, HTTP service).

```js
import { Matchmaker, Lobby, updateRatings } from '@engine/matchmaking';
import { JoinTokens, MatchService } from '@engine/matchmaking/src/node.js';
```

## The queue: `Matchmaker`
```js
const mm = new Matchmaker({ modes: {
  duel:  { teams: 2, teamSize: 1 },
  squad: { teams: 2, teamSize: 4, minPlayers: 6, relaxAfterMs: 20_000 },   // after 20 s, start with 6 and say "fill 2 with bots"
}, now: () => Date.now() });

mm.enqueue({ mode: 'squad', players: [{ id: 'ann', rating: 1210 }, { id: 'bob', rating: 1180 }], region: 'eu' });   // a party of two
const { matches, expired } = mm.tick();   // call this every half second or so
```
- **Fair first, then fast**: a ticket accepts rating differences of `initialWindow` (100) at first, widening by `widenPerSecond` (25) up to `maxWindow` (800). Two tickets match only if each accepts the other.
- **Teams are balanced**: parties stay together on one team; the split minimises the difference between the teams' average ratings (`match.teamBalance`). A set of parties that cannot be split into full teams (3 + 3 + 2 into two teams of 4) is not used.
- **Regions**: the same region, or `any`.
- **Partial matches**: after `relaxAfterMs` a match may start with at least `minPlayers`; `match.needsFill` says how many seats are empty (bots, or let others join).
- **Patience has a limit**: after `maxWaitMs` (two minutes) the ticket comes back in `expired`.
- `cancel(ticketId)`, `ticketOf(playerId)`, `stats()` (queue sizes and the recent average wait per mode, for "about 12 s").

## Ratings
`updateRatings(teams)` is Elo for any number of teams, with draws, parties (a team moves together) and a faster start for new players. `expectedScore(a, b)` is the win chance.

## Rooms: `Lobby`
Register the rooms your server runs and keep their player counts up to date; the lobby lists them (fullest first, so games fill up instead of spreading thin), finds an open room for a quick-play player (`findOpen({ mode, size, rating, ratingWindow })`), **reserves seats** for players who are about to connect (`reserve`, `confirm`, expiry), and makes short **join codes** (`K7M2Q`: no look-alike characters, any case) for private rooms.

## On the server: tokens and the HTTP service
`JoinTokens` signs "this player may join this room until then" (HMAC-SHA256); `verify(token, { room })` says why a token is refused (`expired`, `wrong-room`, `bad-signature`, `used`…). Several keys can be listed to rotate secrets; `oneTime: true` makes each token work once.

`MatchService` is a `Matchmaker` plus a timer plus an HTTP handler:
```
POST   /queue         { "mode": "duel", "players": ["friend-id"], "region": "eu" }   ->  201 { "ticket": "t7" }
GET    /ticket/t7     ->  { "status": "waiting", "waitedMs": 3100, "estimatedWaitMs": 9000 }
                          { "status": "matched", "room": "m-m3", "url": "ws://…/ws/m-m3", "token": "…", "team": 1, "match": { … } }
DELETE /ticket/t7     ->  204
GET    /status        ->  queue sizes
```
You supply `userOf(req)` (who is calling: your login), `createRoom(match)` (make or choose the room, return its name and URL), and optionally `ratingOf(id)` and `canParty(req, ids)`. A caller can only read their own ticket. Players poll: it works through every proxy and costs nothing between polls.

The arena gateway shows it all together: `startArenaGateway({ matchmaking: { secret } })` mounts `/mm/*` and makes every room require `?t=<token>`; see `examples/arena/test/matchmaking.test.js` (queue, get matched, play together, ratings saved with `@engine/persist`).
