# @engine/relay

Online play for games where **every machine plays the whole game** and **a server has the last word on every input**: the input relay on the server, the frames it broadcasts, the window that keeps late commands useful, and the rollback client that plays at once and takes corrections. It is the networking of a competitive 3D game (Mecha Strike) with the game taken out. The server does not need to simulate more than the game's own step function; the players only ever send commands.

**May import:** `@engine/client` (its `RollbackSession`).

## How it fits together
```
player's machine                         server
OnlineRollback ── in {f, c} ──────────►  InputRelay.receive(seat, f, c)
  plays frame F at once, guessing                keeps the command for frame F (late: used for the next)
  the others' commands                   relay.step(play) every frame the window allows
                  ◄── f {f, i, ch, h} ── createFrameLog().make(...)   only the commands that changed, a checksum now and then
  takes the commands that were really used, plays again from the first wrong guess
```
The server plays frame F only when F is `window` frames old (`stepWindow`), which gives commands from slow connections time to arrive; the client delays its own commands by the same reasoning, never more than it needs.

## The server half
```js
import { InputRelay, createFrameLog, neededWindow, stepWindow, createTokenBucket } from '@engine/relay';

const relay = new InputRelay({
  seats,                                                    // [{ kind: 'human' | 'bot', pilot: 'id', team }, ...]
  codec: { normalize, encode, decode },                     // a command, made sound / written as plain data / read back
  think: (seat, frame) => bots[seat].think(world),          // the command of a computer-driven seat
  onChange: (changes) => applyToMyCopy(changes),            // a seat changed hands: apply it to the server's own game at once
  hooks: { human: (seat) => dropBot(seat), bot: (seat, frame) => makeBot(seat, frame) },
});
const frames = createFrameLog();

relay.receive(seat, frame, encoded);                        // what a player's machine sent (late ones are used a frame later; too far ahead is ignored)
const { frame, inputs, events, changes } = relay.step((commands, changes) => game.step(commands, changes));
broadcast(frames.make(frame, inputs, { changes, hash: frames.wantsHash(frame) ? game.checksum() : undefined }));
// when the window allows: room.window follows the worst connection: stepWindow(room, neededWindow(links.map((l) => ({ rtt: l.rtt, jitter: l.jitter }))), now)
```
- `relay.seatBot(seat)` / `relay.seatHuman(seat, pilot, name)` hand a seat over from the next frame (a player left, a newcomer drops in); `relay.record({ seat, ...anything })` records a change of the game's own (a new build for the next life) so every machine applies it at the same frame; `relay.freeSeats(team)`.
- `createFrameLog().since(from)` gives the frames to send again to a machine that lost datagrams (`null` when it is too long ago: send the whole state).
- `createTokenBucket({ rate, burst })` limits how much one connection may ask of the server.

## The client half
```js
import { OnlineRollback } from '@engine/relay';

const online = new OnlineRollback({ seats, you: mySeat, send, sendFast, game: {
  base: () => makeGame(config),                             // the state at frame 0, the same on every machine
  step: (state, commands, changes, frame) => { applyChanges(state, changes); return playFrame(state, commands); },   // returns the frame's events
  clone, checksum, serialize, revive,                       // copy, sum, write as plain data, read back
  normalize, encode, decode,                                // the same codec as the server's
}, onEvents: (events, frame) => showEffects(events) });
// for each message from the server: online.message(msg, now); every rendered frame: online.tick(now, () => readMyKeys()); read online.state
```
It estimates the server's clock from pings, adapts its input delay, catches up or asks for the whole state when it falls far behind, asks again for frames a datagram lost, and asks for the state when a checksum says its game went wrong (`lastMismatch` says where).

## Also here
`pack` / `unpack` (messages as bytes: plain objects with a text `t`, written as JSON), `linkQuality` (bars and a label from ping, jitter and how far ahead the player is playing) and `TONE`, `describeDifferences` (where two states differ), and the constants `WINDOW` (6), `MAX_WINDOW` (20), `TICK_MS`, `MAX_AHEAD`.

## Tests
`packages/relay/test/relay.test.js`: the relay's rules over a toy game, and three machines and a bot over a network with delay and jitter that end up in the server's state, notice a damaged game, ask again for lost frames and shrink a lead that grew.
