# {{title}}

A complete multiplayer card game (Crazy Eights) to learn from and change into your own: the rules, a server with accounts and matchmaking, and a browser client. Play against robots, find other players, or make a private table and give friends the code.

```
npm install
npm run dev        # starts the server and prints the address: open it (play against robots, or open it in two windows to meet yourself)
npm test           # the rules, and a whole game through the server over real WebSockets
npm run build      # the page, bundled and hashed, in dist/
npm run start:built   # the server serving dist/, keeping accounts and ratings in ./data
```

## How it fits together
| File | What it is |
|---|---|
| `src/rules.js` | **The whole game** as plain functions: the starting state, each move, what a player may see, who has won, what is legal, how a robot chooses. No screen, no network. Change this to change the game. |
| `src/cards.js` | Cards as numbers 0 to 51. |
| `src/room.js` | One line that turns the rules into a table the server can run (in its own thread or process). |
| `server/server.js` | The server: guest accounts, queueing for a game, private tables with codes, ratings after every game, the leaderboard, and the page itself, all on one port. |
| `server/main.js` | Starts it: `--port`, `--data <folder>` (keep accounts and ratings), `--mode process\|worker\|inline`, `--root`. |
| `src/client/` | The browser side: `api.js` (talks to the server), `table.js` (draws the table and turns clicks into move requests), `main.js` (menus and the loop). |
| `test/` | Tests for the rules (including 300 robot-vs-robot games) and for the server. |

The server is **authoritative**: a click in the browser only *asks* for a move; the table on the server checks it against the rules, and sends every player only what they may see (your own hand, and how many cards the others hold). A cheating client can ask for anything and gets refused.

## Make it your own
1. **Change the rules.** In `src/rules.js` each move is `(state, ctx, arg) => …`: change the state, `ctx.emit("played", …)` for animations, `ctx.endTurn()` to pass the turn, `ctx.fail("why")` to refuse. Add a move and the table, the robots and the tests can use it. Try a new special card.
2. **Change how it looks.** `src/client/table.js` draws everything from the player's view with the engine's sprite renderer.
3. **A different game.** Replace `rules.js` with another `defineGame({ … })` (a trick-taking game, a board game, a word game: anything with turns), adjust `table.js`, keep the server.

## Before you put it online
- Set `JOIN_SECRET` to a long random string (it signs the tokens that let players into tables; without it a new one is made at every start, so tokens stop working when the server restarts).
- Run with `--data data` and back that folder up: it holds accounts (a hash of each player's secret, never the secret), ratings and the leaderboard.
- Put it behind HTTPS (`wss://` is then used automatically by the page's address); the server itself speaks plain HTTP.
- Guest accounts are the simplest start. `GuestAccounts.link()` (from `@engine/persist`) can tie them to a login from outside.
