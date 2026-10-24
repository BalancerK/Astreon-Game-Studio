# @engine/transport

The `Transport` / `Listener` contract, the in-memory network, and the network condition simulator.

**May import:** `@engine/core`, `@engine/protocol` (currently neither).

## Contract (`src/types.js`)
Two channels per connection: `CHANNEL.RELIABLE` (ordered, lossless) and `CHANNEL.UNRELIABLE` (may drop, duplicate, reorder). Unreliable payloads carry their own tick/sequence so receivers discard stale ones. `send` copies the bytes, so callers may reuse buffers. A WebSocket adapter maps both channels onto one ordered stream (head-of-line blocking is the cost; stale snapshots are simply dropped).

## In-memory network
```js
const net = new MemoryNetwork({ seed: 1, link: { latencyMs: 40, jitterMs: 20, loss: 0.1 } });
net.listen('game').onConnection = (conn) => { conn.onMessage = (bytes, channel) => {}; };
const client = net.connect('game');
client.send(bytes, CHANNEL.UNRELIABLE);
net.clock.advance(100); // VirtualClock: nothing happens until you advance time
```
`link` is one config for both directions or `{ up, down }`. Same seed = same behaviour, so network bugs reproduce.

## `LinkSimulator`
Latency, jitter, loss, duplication, reordering, bandwidth cap with tail-drop. **Reliable messages model TCP-style head-of-line blocking:** a lost attempt costs a retransmit delay and every later reliable message waits. Adapter-agnostic, so it can wrap real transports for local testing.

## WebSocket (own RFC 6455 implementation, zero dependencies)
```js
import { listenWebSocket } from '@engine/transport/node';   // server, Node only
import { connectWebSocket, CHANNEL } from '@engine/transport'; // client, any runtime with WebSocket

const l = await listenWebSocket({ port: 8080, allowedOrigins: ['https://mygame.example'] });
l.onConnection = (conn) => { conn.onMessage = (bytes, channel) => {}; };
const t = connectWebSocket('ws://localhost:8080/');
t.onOpen = () => t.send(bytes, CHANNEL.UNRELIABLE);
```
Each message is a binary frame whose first byte is the channel tag. Binary only (text frames are rejected with 1003); no permessage-deflate.

Protections: message size cap, per-IP and total connection caps, Origin allowlist, inbound rate limit (close 1008), ping/pong heartbeat with timeout, strict handshake validation. Backpressure: unreliable sends are dropped once a client's queue passes `softSendLimit`; the connection is closed at `hardSendLimit` (client not reading).

Not yet run against Autobahn|Testsuite (needs Docker); covered by RFC-derived unit tests, a randomized fragmentation/chunking property test and fuzzing.

## Browser to browser (WebRTC)
One player's browser can be the game server: the others connect to it directly, with the same `Transport` contract as a WebSocket client, so the same server code (rooms, delta snapshots, lag compensation) runs in the host's page. WebRTC data channels give the engine's two channels for real: reliable and ordered, and **unreliable and unordered** with no retransmits, which a WebSocket cannot.

```js
import { listenWebRTC, connectWebRTC, connectSignalingServer, CHANNEL } from '@engine/transport';

const signaling = connectSignalingServer('wss://signal.example.com/');        // or new LoopbackSignaling(), new BroadcastSignaling() (tabs of one site)

// the host (a player's browser)
const listener = await listenWebRTC(signaling, { maxPeers: 4, isPublic: true, name: 'Ana's game', iceServers: [{ urls: 'stun:stun.example.com:3478' }] });
showCode(listener.room);                                                       // "K7QXD"
listener.onConnection = (conn) => { conn.onMessage = (bytes, channel) => {}; conn.onClose = (why) => {}; };    // each player, like a WebSocket client

// a player
const t = connectWebRTC(signaling, 'K7QXD', { iceServers });
t.onOpen = () => t.send(hello, CHANNEL.RELIABLE);
t.onMessage = (bytes, channel) => {};
t.onClose = (why) => showMessage(why);                                         // "no such room", "room is full", "host left", "timed out connecting", ...
```
- **Signalling** is how two browsers find each other before they can talk directly: small JSON messages (offers, answers, candidates). `LoopbackSignaling` (one page or process), `BroadcastSignaling` (tabs of one site: open the game twice, no server) and `connectSignalingServer` (a server you run) are provided; anything with `host(options)` and `join(room)` works. The signalling connection is closed as soon as the players are connected: the game never passes through it.
- **The signalling server** is `createSignalingServer({ port, allowedOrigins, maxRooms })` from `@engine/transport/node`, or `npm run signaling -- --port 8081 --origins https://mygame.example`. It keeps no game state, relays only handshake messages (16 KB cap, rate limited), lists public rooms for a lobby (`connectSignalingServer(url).list()`), drops idle connections, and removes a room when its host leaves. Run it on any machine you like; put it behind TLS (`wss://`) for a public game.
- **No server at all**: `createInvitation()` makes a code for a friend, `acceptInvitation(code)` gives back an answer code, and the host's `accept(answer)` connects them; paste the codes through a chat or show them as QR codes. Every network candidate is inside the code, so it takes a few seconds to make.
- **Crossing the internet**: by default no STUN or TURN server is contacted, so players on the same network connect and nothing is sent to a third party. Give `iceServers` a STUN server to connect across most home routers (the STUN server learns the players' public addresses), and a TURN relay for the rest (a relay carries the game traffic, so it is yours to run).
- **Care taken**: message size limits both ways, text frames refused, a queue that grows without end closes the connection (the other end is not reading), unreliable messages are dropped rather than queued, a brief 'disconnected' is forgiven for 4 s, connections that never complete are given up on, rooms have a player limit, and room codes avoid look-alike characters.

Voice chat (`VoiceChat` in `@engine/audio`) can ride the same connection: send its packets on `CHANNEL.UNRELIABLE` with a message tag of your own.

Tested with real WebRTC in Chrome and Firefox (`node tools/webrtc-test.js [--firefox]`): thousands of messages in order, a 60 KB message intact, the unreliable channel, closing, a real signalling server, invitation codes, and the real delta-snapshot replication (`@engine/protocol`) between a host and a player. In Node the tests use a fake `RTCPeerConnection` (`test/fake-rtc.js`), which also shows how to test your own game's connection handling without a browser.

Not done: a host that leaves ends the game (no host migration), relays for players who cannot connect directly are not provided, and there is no encrypted signalling beyond what `wss://` gives (the data channels themselves are encrypted by WebRTC).

## Tests worth reading
`test/replication.test.js` runs the full server -> delta snapshot -> client -> ack loop under 30-60% loss, duplication and reordering, and checks every accepted snapshot against the server's state.
