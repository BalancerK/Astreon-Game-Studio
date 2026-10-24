# Tutorial: a multiplayer card game

You will make a card game that strangers can play online: rules, a server that keeps cheaters honest, matchmaking, robots for empty seats, ratings, and a browser table. The finished game is `examples/crazy-eights`; `npx create-game my-cards --template multiplayer` gives you the same project to change.

## 1. The rules are a function (`@engine/turns`)
Describe the game as data and functions. Nothing here knows about screens or networks.
```js
export const game = defineGame({
  name: 'my-game', players: { min: 2, max: 4 },
  setup: ({ players, random }) => ({ deck: random.shuffle(newDeck()), hands: dealTo(players) }),
  moves: { play(G, ctx, arg) { if (!G.hands[ctx.player].includes(arg.card)) ctx.fail('you do not have that card'); /* … */ ctx.endTurn(); } },
  view: (G, player) => ({ hand: G.hands[player], counts: countsOf(G) }),   // never reveal other hands
  endIf: (G) => (someoneWon(G) ? { winners: [winner(G)] } : null),
  legalMoves: (G, player) => /* every move this player could make */,
});
```
Test it directly: `new Match(game, { players: ['ann', 'bob'], seed: 1 })`, call `match.move('ann', 'play', { card: 12 })`, look at `match.viewFor('bob')`. A refused move returns `{ ok: false, error }` and changes nothing. Let robots play 300 games in a test and check no move was ever illegal (see `examples/crazy-eights/test/rules.test.js`). Give the game a `bot({ view, legal })` and robots can fill empty seats.

## 2. One line makes it a table
```js
export const createRoom = turnRoom(game);   // src/room.js: what the server's RoomManager loads
```
The room checks join tokens, starts the match, applies each move with your rules, sends every player only their own view, plays for robots and for players who are away, and enforces turn time limits.

## 3. A server around it
`server/server.js` puts the page, an HTTP API and the WebSockets on one port: guest accounts (`@engine/persist`), `POST /mm/queue` for matchmaking (`@engine/matchmaking`: the queue makes a table with your rooms and gives each player a signed token), private tables with join codes, and after every game the ratings and the leaderboard. Players can only enter a table with a token made for it.

## 4. The table in the browser
`src/client/table.js` draws everything from the player's view with the engine's sprite renderer. A click never decides anything: it calls `client.move('play', { card })` and the room answers. The client keeps the latest view and `legal` moves, so the page highlights what can be played, and reconnects with the same seat if the connection drops.

## 5. Make it yours
Change `rules.js` (a new special card), then `table.js` (how it looks), or replace the game entirely with another `defineGame`. Before going online read the checklist in the template's README: set `JOIN_SECRET`, keep `--data`, use HTTPS.
