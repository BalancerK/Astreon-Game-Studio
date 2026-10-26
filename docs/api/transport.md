# @engine/transport

Reliable/unreliable channel contract, in-memory network + loss/latency simulator, own RFC 6455 WebSocket server and client.

```
npm install @engine/transport
```

Version 0.1.0. The package's own README ([packages/transport](../../packages/transport/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (46 of 46 documented)

| Name | Kind | Summary |
|---|---|---|
| [`BroadcastSignaling`](#class-broadcastsignaling) | class | Rooms between tabs and windows of one site, through a `BroadcastChannel`: open the game in two tabs and one hosts, the other joins, with no server at all. |
| [`CHANNEL`](#channel) | constant | Transport contract. |
| [`LinkSimulator`](#class-linksimulator) | class | One direction of a simulated network path. |
| [`LoopbackSignaling`](#class-loopbacksignaling) | class | Rooms inside one JavaScript context: a host and its joiners in the same page or process. |
| [`MAX_STREAM_MESSAGE`](#max_stream_message) | constant | The most a stream message may hold unless told otherwise: one mebibyte. |
| [`MemoryNetwork`](#class-memorynetwork) | class | In-process network for tests, tools and single-page demos. |
| [`MessageParser`](#class-messageparser) | class | Cuts the bytes that come out of a stream (in pieces of any size) into messages. |
| [`Negotiation`](#class-negotiation) | class | One end of a negotiation. |
| [`RELIABLE_LABEL`](#reliable_label) | constant | Label of the reliable, ordered data channel (id 0; both ends agree on the labels and ids in advance). |
| [`ROOM_ALPHABET`](#room_alphabet) | constant | Characters for room codes: no 0 / O or 1 / I / L, which are mistaken for each other when read aloud. |
| [`RealClock`](#class-realclock) | class | The real clock: `now()` from `performance.now()` and `schedule` with `setTimeout`. |
| [`RtcTransport`](#class-rtctransport) | class | A peer-to-peer connection as a `Transport`. |
| [`ServerSignaling`](#class-serversignaling) | class | Rooms on a signalling server (`createSignalingServer` in `@engine/transport/node`, which you run yourself): it only introduces peers and relays their handshake messages; the game itself never passes through it. |
| [`StreamError`](#class-streamerror) | class | Thrown by a parser when the other side sends something that is not a message (one that is too long). |
| [`UNRELIABLE_LABEL`](#unreliable_label) | constant | Label of the unreliable, unordered data channel (id 1). |
| [`VirtualClock`](#class-virtualclock) | class | Deterministic clock: events fire in (time, insertion) order as time is advanced. |
| [`acceptInvitation`](#acceptinvitation) | function | Friend's side: accept an invitation. |
| [`connectSignalingServer`](#connectsignalingserver) | function | A provider for a signalling server. |
| [`connectWebRTC`](#connectwebrtc) | function | Join a room. |
| [`connectWebSocket`](#connectwebsocket) | function | Connect to a server started with `listenWebSocket`. |
| [`connectWebTransport`](#connectwebtransport) | function | Connect to a server started with `listenWebTransport` (or any WebTransport server that takes a stream opened by the client as the reliable channel). |
| [`createInvitation`](#createinvitation) | function | Host side, step one: make an invitation. |
| [`createRng`](#createrng) | function | Small fast seeded PRNG (mulberry32) so simulated networks are reproducible. |
| [`createStats`](#createstats) | function | A fresh set of transport counters (messages and bytes sent and received). |
| [`createWtTransport`](#createwttransport) | function | Make a `Transport` from a WebTransport session and the bidirectional stream used as its reliable channel (the client and the server both use this). |
| [`decodeCode`](#decodecode) | function | Unpack a code. |
| [`encodeCode`](#encodecode) | function | Pack a handshake into a code you can paste. |
| [`encodeMessage`](#encodemessage) | function | A message ready to write to a stream. |
| [`isRoomCode`](#isroomcode) | function | Is this a plausible room code (letters and digits, 3 to 16 of them)? |
| [`listenWebRTC`](#listenwebrtc) | function | Start a room that browsers can join, and accept them one by one: every peer that completes the handshake arrives as a `Transport` in `onConnection`, exactly like a client of a WebSocket server, so the same server code (rooms, replication, lag compensation) can run in the host's browser. |
| [`makeRoomCode`](#makeroomcode) | function | A random room code. |
| [`openChannels`](#openchannels) | function | Create the two data channels on a peer connection. |
| [`simulateLink`](#simulatelink) | function | Wrap any transport so its traffic suffers simulated latency, jitter, loss, duplication, reordering and bandwidth limits. |
| [`tapTransport`](#taptransport) | function | Observe every packet crossing a transport, in both directions, without changing behaviour. |
| [`FrameParser`](#class-frameparser) | class (Node) | Incremental frame parser and message assembler. |
| [`MAX_HASH_CERT_DAYS`](#max_hash_cert_days) | constant (Node) | The longest a browser accepts a certificate trusted by hash: fourteen days. |
| [`OP`](#op) | constant (Node) | WebSocket frame opcodes (RFC 6455): continuation, text, binary, close, ping, pong. |
| [`WsError`](#class-wserror) | class (Node) | A protocol violation; `code` is the close code to send to the peer. |
| [`acceptKey`](#acceptkey) | function (Node) | Value for the Sec-WebSocket-Accept header. |
| [`certificateHash`](#certificatehash) | function (Node) | The SHA-256 hash of a certificate, as base64: what a page passes as `certificateHashes`. |
| [`createSelfSignedCert`](#createselfsignedcert) | function (Node) | Make a self-signed certificate and key that a page can trust by its hash. |
| [`createSignalingServer`](#createsignalingserver) | function (Node) | Start a signalling server. |
| [`encodeClose`](#encodeclose) | function (Node) | Close frame payload: 2-byte code + UTF-8 reason truncated to the 123 bytes allowed. |
| [`encodeFrame`](#encodeframe) | function (Node) | Build one unfragmented frame. |
| [`listenWebSocket`](#listenwebsocket) | function (Node) | Start a WebSocket server. |
| [`listenWebTransport`](#listenwebtransport) | function (Node) | Start a WebTransport server. |

## Functions

### `acceptInvitation`

```js
async function acceptInvitation(code, options = {})
```

Friend's side: accept an invitation. Send `answer` back to the host; `transport` resolves with the open `Transport` once they have pasted it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `code` | `string` | The host's invitation. |
| `options` (optional) | `import('./negotiate.js').RtcOptions` |  |

**Returns** `Promise<{answer: string, transport: Promise<import('./transport.js').RtcTransport>, cancel: () => void}>`

<sub>src/rtc/invite.js:52</sub>

### `connectSignalingServer`

```js
function connectSignalingServer(url, options)
```

A provider for a signalling server.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `url` | `string` |  |
| `options` (optional) | `ConstructorParameters<typeof ServerSignaling>[1]` |  |

<sub>src/rtc/signaling.js:246</sub>

### `connectWebRTC`

```js
function connectWebRTC(signaling, room, options = {})
```

Join a room. Returns a `Transport` straight away, 'connecting' until the handshake is done (then `onOpen` fires), or 'closed' with a reason (`onClose`) if there is no such room, it is full, the
host leaves before the connection is made, or the network cannot be crossed.

```js
const t = connectWebRTC(new ServerSignaling('wss://signal.example.com/'), 'K7QXD');
t.onOpen = () => t.send(hello, CHANNEL.RELIABLE);
t.onMessage = (bytes, channel) => {};
t.onClose = (why) => showMessage(why);
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `signaling` | `import('./signaling.js').SignalingProvider` |  |
| `room` | `string` |  |
| `options` (optional) | `import('./negotiate.js').RtcOptions` |  |

**Returns** `import('./transport.js').RtcTransport`

<sub>src/rtc/session.js:69</sub>

### `connectWebSocket`

```js
function connectWebSocket(url, { WebSocketImpl = globalThis.WebSocket, softSendLimit = 64 * 1024, protocols } = {})
```

Connect to a server started with `listenWebSocket`. Returns immediately;
`state` is 'connecting' until the socket opens, then `onOpen` fires.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `url` | `string` | e.g. `ws://localhost:8080/` |
| `o` (optional) | `object` |  |
| `o.WebSocketImpl` (optional) | `typeof WebSocket` |  |
| `o.softSendLimit` (optional) | `number` | Unreliable messages are dropped while this many bytes are buffered. |
| `o.protocols` (optional) | `string \| string[]` |  |

**Returns** `import('../types.js').Transport & {onOpen: (() => void) \| null, ws: WebSocket}`

<sub>src/ws/client.js:15</sub>

### `connectWebTransport`

```js
function connectWebTransport(url, { certificateHashes, WebTransportImpl = globalThis.WebTransport, maxMessageSize, statsEveryMs } = {})
```

Connect to a server started with `listenWebTransport` (or any WebTransport server that takes a stream opened by the client as the reliable channel). Returns at once; `state` is 'connecting'
until the session is up, then `onOpen` is called.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `url` | `string` | e.g. `https://game.example:8788/wt` |
| `o` (optional) | `{certificateHashes?: Array<string \| Uint8Array>, WebTransportImpl?: any, maxMessageSize?: number, statsEveryMs?: number}` | `certificateHashes` (SHA-256 of the server's certificate, base64) lets a page trust a self-signed certificate that is valid for up to two weeks, which is what `createSelfSignedCert` makes. |

**Returns** `import('../types.js').Transport & {onOpen: (() => void) \| null, rttMs: number, maxDatagramSize: number, session: any}`

<sub>src/wt/client.js:21</sub>

### `createInvitation`

```js
async function createInvitation(options = {})
```

Host side, step one: make an invitation. Send `code` to a friend; when they send back their answer code, give it to `accept`, which resolves with the open `Transport`.
One invitation connects one friend; make another for the next. Everything (every network candidate) is inside the code, so it takes a few seconds to make.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `options` (optional) | `import('./negotiate.js').RtcOptions` |  |

**Returns** `Promise<{code: string, accept: (answerCode: string) => Promise<import('./transport.js').RtcTransport>, cancel: () => void, transport: Promise<import('./transport.js').RtcTransport>}>`

<sub>src/rtc/invite.js:32</sub>

### `createRng`

```js
function createRng(seed)
```

Small fast seeded PRNG (mulberry32) so simulated networks are reproducible.

<sub>src/link.js:4</sub>

### `createStats`

```js
function createStats()
```

A fresh set of transport counters (messages and bytes sent and received).

**Returns** `TransportStats`

<sub>src/types.js:45</sub>

### `createWtTransport`

```js
function createWtTransport({ session, stream, maxMessageSize = MAX_STREAM_MESSAGE, statsEveryMs = 1000 })
```

Make a `Transport` from a WebTransport session and the bidirectional stream used as its reliable channel (the client and the server both use this).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` | `{session: WtSessionLike, stream: {readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>}, maxMessageSize?: number, statsEveryMs?: number}` |  |

**Returns** `import('../types.js').Transport & {rttMs: number, maxDatagramSize: number, session: WtSessionLike, stats: any}`

<sub>src/wt/transport.js:23</sub>

### `decodeCode`

```js
function decodeCode(code, kind)
```

Unpack a code. Throws an `Error` that says what is wrong with it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `code` | `string` |  |
| `kind` | `'offer' \| 'answer'` |  |

**Returns** `string` — The handshake text.

<sub>src/rtc/invite.js:15</sub>

### `encodeCode`

```js
function encodeCode(kind, sdp)
```

Pack a handshake into a code you can paste.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `kind` | `'offer' \| 'answer'` |  |
| `sdp` | `string` |  |

<sub>src/rtc/invite.js:12</sub>

### `encodeMessage`

```js
function encodeMessage(bytes)
```

A message ready to write to a stream.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |

**Returns** `Uint8Array`

<sub>src/wt/frame.js:12</sub>

### `isRoomCode`

```js
function isRoomCode(s)
```

Is this a plausible room code (letters and digits, 3 to 16 of them)?

**Parameters**

| Name | Type | Description |
|---|---|---|
| `s` | `unknown` |  |

<sub>src/rtc/signaling.js:35</sub>

### `listenWebRTC`

```js
async function listenWebRTC(signaling, options = {})
```

Start a room that browsers can join, and accept them one by one: every peer that completes the handshake arrives as a `Transport` in `onConnection`, exactly like a client of a WebSocket
server, so the same server code (rooms, replication, lag compensation) can run in the host's browser.

```js
const listener = await listenWebRTC(new ServerSignaling('wss://signal.example.com/'), { maxPeers: 4, isPublic: true, name: 'Ana\'s game' });
showCode(listener.room);                                  // "K7QXD": friends type this in
listener.onConnection = (conn) => { conn.onMessage = (bytes, channel) => {}; conn.onClose = (why) => {}; };
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `signaling` | `import('./signaling.js').SignalingProvider` |  |
| `options` (optional) | `import('./negotiate.js').RtcOptions & {room?: string, maxPeers?: number, isPublic?: boolean, name?: string}` | `room`: ask for this code. `maxPeers`: how many players at once (default 8); more are told the room is full. |

**Returns** `Promise<import('../types.js').Listener & {room: string, peers: Set<import('./transport.js').RtcTransport>, connections: Set<import('./transport.js').RtcTransport>, pending: number, close: () => void}>`

<sub>src/rtc/session.js:17</sub>

### `makeRoomCode`

```js
function makeRoomCode(length = 5, random = Math.random)
```

A random room code.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `length` (optional) | `number` |  |
| `random` (optional) | `() => number` |  |

<sub>src/rtc/signaling.js:28</sub>

### `openChannels`

```js
function openChannels(pc)
```

Create the two data channels on a peer connection. They are *negotiated*: both ends make them with the same ids, so neither has to wait for the other to announce them.
The unreliable one is truly unreliable (no retransmits, no ordering), which is what snapshots and inputs want and what a WebSocket cannot give.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `pc` | `RTCPeerConnection` |  |

**Returns** `{reliable: RTCDataChannel, unreliable: RTCDataChannel}`

<sub>src/rtc/transport.js:15</sub>

### `simulateLink`

```js
function simulateLink(inner, { up = {}, down = {}, clock = new RealClock(), seed = 1 } = {})
```

Wrap any transport so its traffic suffers simulated latency, jitter, loss,
duplication, reordering and bandwidth limits. Handy for feeling (and testing)
prediction and interpolation on a fast local connection.

Note: this adds conditions on top of the real link, and models the
reliable channel's head-of-line blocking like `LinkSimulator` does.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `inner` | `T` |  |
| `o` (optional) | `object` |  |
| `o.up` (optional) | `import('./link.js').LinkConfig` | Conditions for what this side sends. |
| `o.down` (optional) | `import('./link.js').LinkConfig` | Conditions for what this side receives. |
| `o.clock` (optional) | `import('./clock.js').Clock` | Defaults to wall time. |
| `o.seed` (optional) | `number` |  |

**Returns** `import('./types.js').Transport & {inner: T, onOpen: (() => void) \| null}`

<sub>src/simulate.js:21</sub>

### `tapTransport`

```js
function tapTransport(inner, tap, now = () => performance.now())
```

Observe every packet crossing a transport, in both directions, without changing behaviour.
Wrap outermost to see what the application sees (after any simulated link conditions).

`tap` is called synchronously with a view of the bytes: read or summarise them there, do not keep them.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `inner` | `T` |  |
| `tap` | `(event: {dir: 'in' \| 'out', bytes: Uint8Array, channel: import('./types.js').Channel, time: number}) => void` |  |
| `now` (optional) | `() => number` |  |

**Returns** `import('./types.js').Transport & {inner: T, onOpen: (() => void) \| null}`

<sub>src/tap.js:13</sub>

## Classes

### `class BroadcastSignaling`

```js
class BroadcastSignaling
```

Rooms between tabs and windows of one site, through a `BroadcastChannel`: open the game in two tabs and one hosts, the other joins, with no server at all. (A different site, device or
browser profile cannot be reached this way: use a signalling server or invitation codes.)
@implements {SignalingProvider}

#### `BroadcastSignaling.constructor`

```js
constructor({ BroadcastChannelImpl = globalThis.BroadcastChannel, random = Math.random, joinTimeoutMs = 1500, prefix = 'engine-rtc' } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{BroadcastChannelImpl?: typeof BroadcastChannel, random?: () => number, joinTimeoutMs?: number, prefix?: string}` |  |

#### `BroadcastSignaling.host`

```js
async host({ room, maxPeers = 16 } = {})
```

#### `BroadcastSignaling.join`

```js
async join(room)
```

<sub>src/rtc/signaling.js:96</sub>

### `class LinkSimulator`

```js
class LinkSimulator
```

One direction of a simulated network path.

**Properties**

| Name | Type | Description |
|---|---|---|
| `latencyMs` (optional) | `number` | One-way delay. |
| `jitterMs` (optional) | `number` | Extra random delay, uniform in [0, jitterMs]. |
| `loss` (optional) | `number` | Packet loss probability 0..1. |
| `duplicate` (optional) | `number` | Chance an unreliable packet is delivered twice. |
| `reorder` (optional) | `number` | Chance an unreliable packet is held back extra. |
| `reorderDelayMs` (optional) | `number` | How long a reordered packet is held (default 20). |
| `bandwidthBps` (optional) | `number` | Bits per second; 0 = unlimited. |
| `maxQueueMs` (optional) | `number` | Unreliable packets that would wait longer than this are tail-dropped (default 200). |
| `retransmitMs` (optional) | `number` | Delay per lost reliable attempt (default max(2 x latency, 100)). |

#### `LinkSimulator.constructor`

```js
constructor(clock, rng, config = {})
```

| Name | Type | Description |
|---|---|---|
| `clock` | `import('./clock.js').Clock` |  |
| `rng` | `() => number` |  |
| `config` (optional) | `LinkConfig` |  |

#### `LinkSimulator.transmit`

```js
transmit(channel, size, deliver)
```

Schedule delivery of one message according to the link conditions.
Reliable messages are never lost or reordered: a "lost" attempt costs a
retransmit delay and every later reliable message waits behind it
(head-of-line blocking, as on TCP/WebSocket).

| Name | Type | Description |
|---|---|---|
| `channel` | `import('./types.js').Channel` |  |
| `size` | `number` | Bytes (for bandwidth accounting). |
| `deliver` | `() => void` |  |

**Returns** `boolean` — False if the message was dropped.

<sub>src/link.js:29</sub>

### `class LoopbackSignaling`

```js
class LoopbackSignaling
```

Rooms inside one JavaScript context: a host and its joiners in the same page or process. For tests, hot-seat setups and games that run the host in a worker next to the page.
@implements {SignalingProvider}

#### `LoopbackSignaling.constructor`

```js
constructor({ random = Math.random } = {})
```

#### `LoopbackSignaling.host`

```js
async host({ room, maxPeers = 16 } = {})
```

#### `LoopbackSignaling.join`

```js
async join(room)
```

<sub>src/rtc/signaling.js:55</sub>

### `class MemoryNetwork`

```js
class MemoryNetwork
```

In-process network for tests, tools and single-page demos. Supports the same
listen/connect flow as a real server, with simulated latency, jitter, loss,
duplication, reordering and bandwidth limits per direction.

`link` accepts either one config used for both directions, or `{ up, down }`
(up = client to server). A client's `connect` may override it per connection.

#### `MemoryNetwork.constructor`

```js
constructor({ clock = new VirtualClock(), seed = 1, link = {} } = {})
```

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `object` |  |
| `o.clock` (optional) | `import('./clock.js').Clock` | Defaults to a new VirtualClock. |
| `o.seed` (optional) | `number` |  |
| `o.link` (optional) | `import('./link.js').LinkConfig \| {up?: import('./link.js').LinkConfig, down?: import('./link.js').LinkConfig}` |  |

#### `MemoryNetwork.listen`

```js
listen(address)
```

| Name | Type | Description |
|---|---|---|
| `address` | `string` |  |

**Returns** `import('./types.js').Listener`

#### `MemoryNetwork.connect`

```js
connect(address, link = this.link)
```

| Name | Type | Description |
|---|---|---|
| `address` | `string` |  |
| `link` (optional) | `typeof this.link` | Per-connection override. |

**Returns** `import('./types.js').Transport` — The client end; usable immediately.

<sub>src/memory.js:59</sub>

### `class MessageParser`

```js
class MessageParser
```

Cuts the bytes that come out of a stream (in pieces of any size) into messages.

#### `MessageParser.constructor`

```js
constructor({ maxMessageSize = MAX_STREAM_MESSAGE, onMessage })
```

| Name | Type | Description |
|---|---|---|
| `o` | `{maxMessageSize?: number, onMessage: (bytes: Uint8Array) => void}` |  |

#### `MessageParser.push`

```js
push(chunk)
```

| Name | Type | Description |
|---|---|---|
| `chunk` | `Uint8Array` |  |

<sub>src/wt/frame.js:23</sub>

### `class Negotiation`

```js
class Negotiation
```

One end of a negotiation. `send` carries signalling messages to the other end (`{t: 'offer' | 'answer' | 'ice', ...}`); `receive` takes what the other end sent.
The side that starts it (`offerer`) makes the data channels and the offer; the other answers. Candidates that arrive before the remote description are held until it is set.

#### `Negotiation.constructor`

```js
constructor({ offerer, send, peerId = '', options = {} })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.offerer` | `boolean` |  |
| `o.send` | `(message: object) => void` |  |
| `o.peerId` (optional) | `string` |  |
| `o.options` (optional) | `RtcOptions` |  |

#### `Negotiation.start`

```js
async start()
```

Start: make the offer and send it. Only for the offering side.

#### `Negotiation.receive`

```js
async receive(message)
```

| Name | Type | Description |
|---|---|---|
| `message` | `any` | What the other end sent. |

#### `Negotiation.cancel`

```js
cancel(reason = 'cancelled')
```

Stop and tear down (a transport that already opened is left alone).

<sub>src/rtc/negotiate.js:21</sub>

### `class RealClock`

```js
class RealClock
```

The real clock: `now()` from `performance.now()` and `schedule` with `setTimeout`. Tests swap it for a fake one.

#### `RealClock.now`

```js
now()
```

#### `RealClock.schedule`

```js
schedule(delayMs, fn)
```

<sub>src/clock.js:84</sub>

### `class RtcTransport`

```js
class RtcTransport
```

A peer-to-peer connection as a `Transport`. It is 'connecting' until both channels are open, 'open' while they are, and 'closed' for good when either closes, the connection fails, or
it stays 'disconnected' longer than `disconnectGraceMs` (a brief network blip is forgiven).

@implements {import('../types.js').Transport}

#### `RtcTransport.constructor`

```js
constructor(pc, channels, { peerId = '', maxMessageBytes = 64 * 1024, softSendLimit = 64 * 1024, hardSendLimit = 8 * 1024 * 1024, disconnectGraceMs = 4000, timers = globalThis } = {})
```

| Name | Type | Description |
|---|---|---|
| `pc` | `RTCPeerConnection` |  |
| `channels` | `{reliable: RTCDataChannel, unreliable: RTCDataChannel}` | From `openChannels`. |
| `o` (optional) | `object` |  |
| `o.peerId` (optional) | `string` | Who is on the other end (as the signalling named them). |
| `o.maxMessageBytes` (optional) | `number` | Larger messages are refused on send and close the connection on receipt. |
| `o.softSendLimit` (optional) | `number` | Unreliable messages are dropped while this many bytes are queued. |
| `o.hardSendLimit` (optional) | `number` | The connection is closed when this many bytes are queued on the reliable channel (the other end is not reading). |
| `o.disconnectGraceMs` (optional) | `number` |  |
| `o.timers` (optional) | `{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}` |  |

#### `RtcTransport.onMessage`

```js
get onMessage
```

#### `RtcTransport.onMessage`

```js
set onMessage(fn)
```

#### `RtcTransport.send`

```js
send(bytes, channel = CHANNEL.RELIABLE)
```

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |
| `channel` (optional) | `import('../types.js').Channel` |  |

**Returns** `boolean` — False if the connection is not open or the message was refused.

#### `RtcTransport.close`

```js
close(reason = 'closed')
```

| Name | Type | Description |
|---|---|---|
| `reason` (optional) | `string` |  |

#### `RtcTransport.watch`

```js
watch(what, fn)
```

Be told when this transport opens or closes, without touching `onOpen` / `onClose` (which belong to whoever uses it).

| Name | Type | Description |
|---|---|---|
| `what` | `'open' \| 'close'` |  |
| `fn` | `(reason?: string) => void` |  |

#### `RtcTransport.measureRtt`

```js
async measureRtt()
```

Ask the browser for the round-trip time of the selected network path. Sets `rttMs` and returns it, or returns null if nothing is available (yet, or in an environment without `getStats`).

**Returns** `Promise<number \| null>`

<sub>src/rtc/transport.js:28</sub>

### `class ServerSignaling`

```js
class ServerSignaling
```

Rooms on a signalling server (`createSignalingServer` in `@engine/transport/node`, which you run yourself): it only introduces peers and relays their handshake messages; the game
itself never passes through it. `list()` shows the public rooms for a lobby.
@implements {SignalingProvider}

#### `ServerSignaling.constructor`

```js
constructor(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 8000 } = {})
```

| Name | Type | Description |
|---|---|---|
| `url` | `string` | e.g. `wss://signal.example.com/` |
| `o` (optional) | `{WebSocketImpl?: typeof WebSocket, timeoutMs?: number}` |  |

#### `ServerSignaling.host`

```js
async host({ room, maxPeers = 16, isPublic = false, name = '' } = {})
```

#### `ServerSignaling.join`

```js
async join(room)
```

#### `ServerSignaling.list`

```js
async list()
```

The public rooms on the server: `[{ room, name, peers, max }]`.

<sub>src/rtc/signaling.js:167</sub>

### `class StreamError`

```js
class StreamError extends Error
```

Thrown by a parser when the other side sends something that is not a message (one that is too long).

<sub>src/wt/frame.js:20</sub>

### `class VirtualClock`

```js
class VirtualClock
```

Deterministic clock: events fire in (time, insertion) order as time is advanced.

#### `VirtualClock.constructor`

```js
constructor(start = 0)
```

| Name | Type | Description |
|---|---|---|
| `start` (optional) | `number` |  |

#### `VirtualClock.now`

```js
now()
```

#### `VirtualClock.pending`

```js
get pending
```

#### `VirtualClock.schedule`

```js
schedule(delayMs, fn)
```

#### `VirtualClock.runUntil`

```js
runUntil(time)
```

Run every event due at or before `time`, then set the clock to `time`.

#### `VirtualClock.advance`

```js
advance(ms)
```

| Name | Type | Description |
|---|---|---|
| `ms` | `number` |  |

#### `VirtualClock.runAll`

```js
runAll(maxEvents = 1e7)
```

Run until nothing is scheduled.

| Name | Type | Description |
|---|---|---|
| `maxEvents` (optional) | `number` | Guard against endless rescheduling. |

<sub>src/clock.js:12</sub>

## Constants

### `CHANNEL`

```js
const CHANNEL
```

Transport contract. Every adapter (in-memory, WebSocket, WebTransport...)
implements `Transport` for one connection and `Listener` for a server.

Channels:
- RELIABLE: ordered and lossless (handshake, spawn/despawn, chat).
- UNRELIABLE: may be dropped, duplicated or reordered (snapshots, inputs).
  Payloads must carry their own tick/sequence so stale or duplicate
  messages can be discarded. A WebSocket adapter maps both channels onto one
  ordered stream, so a lost packet delays later ones; newer snapshots
  supersede older ones, so receivers should just drop anything stale.

`send` copies the bytes (or finishes with them) before returning, so callers
may reuse their buffer immediately.

Value: `Object.freeze({ RELIABLE: 0, UNRELIABLE: 1 })`

<sub>src/types.js:16</sub>

### `MAX_STREAM_MESSAGE`

```js
const MAX_STREAM_MESSAGE
```

The most a stream message may hold unless told otherwise: one mebibyte.

Value: `1 << 20`

<sub>src/wt/frame.js:5</sub>

### `RELIABLE_LABEL`

```js
const RELIABLE_LABEL
```

Label of the reliable, ordered data channel (id 0; both ends agree on the labels and ids in advance).

Value: `'reliable'`

<sub>src/rtc/transport.js:5</sub>

### `ROOM_ALPHABET`

```js
const ROOM_ALPHABET
```

Characters for room codes: no 0 / O or 1 / I / L, which are mistaken for each other when read aloud.

Value: `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`

<sub>src/rtc/signaling.js:25</sub>

### `UNRELIABLE_LABEL`

```js
const UNRELIABLE_LABEL
```

Label of the unreliable, unordered data channel (id 1).

Value: `'unreliable'`

<sub>src/rtc/transport.js:7</sub>

## Node entry

These come from `@engine/transport/src/node.js` and use Node's built-in modules, so they are for servers and tools, not browsers.

```js
import { FrameParser, MAX_HASH_CERT_DAYS, OP } from '@engine/transport/src/node.js';
```

### `class FrameParser`

```js
class FrameParser
```

Incremental frame parser and message assembler. Feed it socket chunks with
`push`; it calls back with complete binary messages and control frames, and
throws `WsError` on any violation (the caller closes with `err.code`).

Text frames are rejected (1003): this transport is binary only. Extensions
(RSV bits) are never negotiated, so any RSV bit is a violation.

#### `FrameParser.constructor`

```js
constructor({ expectMasked, maxMessageSize, onMessage, onPing, onPong, onClose })
```

| Name | Type | Description |
|---|---|---|
| `o` | `object` |  |
| `o.expectMasked` | `boolean` | True on the server (clients must mask). |
| `o.maxMessageSize` | `number` | Largest accepted frame / assembled message. |
| `o.onMessage` | `(payload: Buffer) => void` |  |
| `o.onPing` (optional) | `(payload: Buffer) => void` |  |
| `o.onPong` (optional) | `(payload: Buffer) => void` |  |
| `o.onClose` (optional) | `(code: number, reason: string) => void` |  |

#### `FrameParser.buffered`

```js
get buffered
```

Bytes buffered waiting for the rest of a frame.

#### `FrameParser.push`

```js
push(chunk)
```

| Name | Type | Description |
|---|---|---|
| `chunk` | `Buffer` |  |

<sub>src/ws/frame.js:78</sub>

### `MAX_HASH_CERT_DAYS`

```js
const MAX_HASH_CERT_DAYS
```

The longest a browser accepts a certificate trusted by hash: fourteen days.

Value: `14`

<sub>src/wt/cert.js:11</sub>

### `OP`

```js
const OP
```

WebSocket frame opcodes (RFC 6455): continuation, text, binary, close, ping, pong.

Value: `Object.freeze({ CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: `

<sub>src/ws/frame.js:5</sub>

### `class WsError`

```js
class WsError extends Error
```

A protocol violation; `code` is the close code to send to the peer.

#### `WsError.constructor`

```js
constructor(code, message)
```

| Name | Type | Description |
|---|---|---|
| `code` | `number` |  |
| `message` | `string` |  |

<sub>src/ws/frame.js:8</sub>

### `acceptKey`

```js
function acceptKey(key)
```

Value for the Sec-WebSocket-Accept header.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `key` | `string` |  |

<sub>src/ws/server.js:11</sub>

### `certificateHash`

```js
function certificateHash(cert)
```

The SHA-256 hash of a certificate, as base64: what a page passes as `certificateHashes`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cert` | `string \| Buffer` | a PEM text, or the DER bytes |

**Returns** `string`

<sub>src/wt/cert.js:18</sub>

### `createSelfSignedCert`

```js
function createSelfSignedCert({ hosts = ['localhost', '127.0.0.1'], days = 13, openssl = 'openssl' } = {})
```

Make a self-signed certificate and key that a page can trust by its hash.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `o` (optional) | `{hosts?: string[], days?: number, openssl?: string}` | `hosts` are the names and addresses the server is reached by (an address is recognised by its shape); `days` is at most 13 |

**Returns** `{cert: string, privKey: string, hash: string, notBefore: Date, notAfter: Date, hosts: string[]}`

<sub>src/wt/cert.js:28</sub>

### `createSignalingServer`

```js
async function createSignalingServer({ maxRooms = 1000, maxPeersPerRoom = 32, maxMessageBytes = 16 * 1024, idleMs = 10_000, random = Math.random, maxConnections = 2048, maxConnectionsPerIp = 24, maxMessagesPerSecond = 60, burstMessages = 120, ...ws } = {})
```

Start a signalling server.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `options` (optional) | `SignalingServerOptions` |  |

**Returns** `Promise<{port: number, host: string, rooms: Map<string, any>, close: () => Promise<void>}>`

<sub>src/rtc/signal-server.js:25</sub>

### `encodeClose`

```js
function encodeClose(code, reason = '')
```

Close frame payload: 2-byte code + UTF-8 reason truncated to the 123 bytes allowed.

<sub>src/ws/frame.js:51</sub>

### `encodeFrame`

```js
function encodeFrame(opcode, payload, prefix = -1, mask = false)
```

Build one unfragmented frame. If `prefix >= 0` it is written as the first
payload byte (used for the channel tag) so no extra copy of `payload` is needed.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `opcode` | `number` |  |
| `payload` | `Uint8Array` |  |
| `prefix` (optional) | `number` |  |
| `mask` (optional) | `boolean` | Client frames must be masked. |

**Returns** `Buffer`

<sub>src/ws/frame.js:27</sub>

### `listenWebSocket`

```js
function listenWebSocket(options = {})
```

Start a WebSocket server. Resolves once listening.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `options` | `WsServerOptions` |  |

**Returns** `Promise<import('../types.js').Listener & {port: number, host: string, connections: Set<any>, close: () => Promise<void>}>`

<sub>src/ws/server.js:186</sub>

### `listenWebTransport`

```js
async function listenWebTransport(options = {})
```

Start a WebTransport server.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `options` (optional) | `WtServerOptions` |  |

**Returns** `Promise<{onConnection: ((connection: import('../types.js').Transport) => void) \| null, port: number, host: string, path: string, readonly certificateHash: string \| null, readonly certificateExpires: Date \| null,   onCertificate: ((hash: string, expires: Date) => void) \| null, connections: Set<any>, rotateCertificate: () => string \| null, close: () => Promise<void>}>`

<sub>src/wt/server.js:34</sub>

## Types

### `Channel`

Type: `0 \| 1`

| Name | Type | Description |
|---|---|---|
| `sentMessages` | `number` |  |
| `sentBytes` | `number` |  |
| `receivedMessages` | `number` |  |
| `receivedBytes` | `number` |  |
| `state` | `'connecting' \| 'open' \| 'closed'` |  |
| `onMessage` | `((bytes: Uint8Array, channel: Channel) => void) \| null` | Set by the owner. |
| `onClose` | `((reason: string) => void) \| null` | Called once when the connection ends, from either side. |
| `stats` | `TransportStats` |  |
| `send` | `(bytes: Uint8Array, channel?: Channel) => boolean` | False if the connection is closed. |
| `close` | `(reason?: string) => void` |  |
| `onConnection` | `((connection: Transport) => void) \| null` | Called for each accepted client. |
| `close` | `() => void` |  |

### `Clock`

Clocks schedule callbacks in milliseconds. `VirtualClock` only moves when
told to, which makes network tests instant and fully deterministic.
`RealClock` uses wall time for in-process demos.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `now` | `() => number` |  |
| `schedule` | `(delayMs: number, fn: () => void) => void` |  |

### `HostSignaling`

The host's end of a room.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `room` | `string` | The code others join with. |
| `onPeer` | `((peerId: string) => void) \| null` | Someone entered the room. |
| `onPeerLeft` | `((peerId: string) => void) \| null` | Someone left it (or dropped). |
| `onMessage` | `((peerId: string, message: object) => void) \| null` | A message from a peer. |
| `send` | `(peerId: string, message: object) => void` |  |
| `onClose` | `(() => void) \| null` | The room ended from outside (the signalling server went away). |
| `close` | `() => void` | End the room. |
| `room` | `string` |  |
| `peerId` | `string` | The name the host sees. |
| `onMessage` | `((message: object) => void) \| null` |  |
| `send` | `(message: object) => void` |  |
| `onClose` | `(() => void) \| null` | The host left, or the connection to the signalling server was lost. |
| `close` | `() => void` |  |
| `host` | `(options?: {room?: string, maxPeers?: number, isPublic?: boolean, name?: string}) => Promise<HostSignaling>` | Start a room (a code is made if none is given). |
| `join` | `(room: string) => Promise<JoinSignaling>` | Enter a room; rejects if there is none. |

### `JoinSignaling`

A joiner's end.

Type: `object`

| Name | Type | Description |
|---|---|---|
| `room` | `string` | The code others join with. |
| `onPeer` | `((peerId: string) => void) \| null` | Someone entered the room. |
| `onPeerLeft` | `((peerId: string) => void) \| null` | Someone left it (or dropped). |
| `onMessage` | `((peerId: string, message: object) => void) \| null` | A message from a peer. |
| `send` | `(peerId: string, message: object) => void` |  |
| `onClose` | `(() => void) \| null` | The room ended from outside (the signalling server went away). |
| `close` | `() => void` | End the room. |
| `room` | `string` |  |
| `peerId` | `string` | The name the host sees. |
| `onMessage` | `((message: object) => void) \| null` |  |
| `send` | `(message: object) => void` |  |
| `onClose` | `(() => void) \| null` | The host left, or the connection to the signalling server was lost. |
| `close` | `() => void` |  |
| `host` | `(options?: {room?: string, maxPeers?: number, isPublic?: boolean, name?: string}) => Promise<HostSignaling>` | Start a room (a code is made if none is given). |
| `join` | `(room: string) => Promise<JoinSignaling>` | Enter a room; rejects if there is none. |

### `LinkConfig`

One direction of a simulated network path.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `latencyMs` (optional) | `number` | One-way delay. |
| `jitterMs` (optional) | `number` | Extra random delay, uniform in [0, jitterMs]. |
| `loss` (optional) | `number` | Packet loss probability 0..1. |
| `duplicate` (optional) | `number` | Chance an unreliable packet is delivered twice. |
| `reorder` (optional) | `number` | Chance an unreliable packet is held back extra. |
| `reorderDelayMs` (optional) | `number` | How long a reordered packet is held (default 20). |
| `bandwidthBps` (optional) | `number` | Bits per second; 0 = unlimited. |
| `maxQueueMs` (optional) | `number` | Unreliable packets that would wait longer than this are tail-dropped (default 200). |
| `retransmitMs` (optional) | `number` | Delay per lost reliable attempt (default max(2 x latency, 100)). |

### `Listener`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `sentMessages` | `number` |  |
| `sentBytes` | `number` |  |
| `receivedMessages` | `number` |  |
| `receivedBytes` | `number` |  |
| `state` | `'connecting' \| 'open' \| 'closed'` |  |
| `onMessage` | `((bytes: Uint8Array, channel: Channel) => void) \| null` | Set by the owner. |
| `onClose` | `((reason: string) => void) \| null` | Called once when the connection ends, from either side. |
| `stats` | `TransportStats` |  |
| `send` | `(bytes: Uint8Array, channel?: Channel) => boolean` | False if the connection is closed. |
| `close` | `(reason?: string) => void` |  |
| `onConnection` | `((connection: Transport) => void) \| null` | Called for each accepted client. |
| `close` | `() => void` |  |

### `RtcOptions`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `iceServers` (optional) | `RTCIceServer[]` | STUN / TURN servers. Empty by default: peers on the same network find each other, and nothing is sent to a third party. Add a STUN server to connect across the internet through most routers. |
| `rtc` (optional) | `{RTCPeerConnection: typeof RTCPeerConnection}` | Where `RTCPeerConnection` comes from (default: the global one); tests pass a fake. |
| `connectTimeoutMs` (optional) | `number` | Give up on a peer that has not connected after this long (default 20 s). |
| `trickle` (optional) | `boolean` | Send candidates as they are found (default). `false` waits until all are in and puts them in the offer or answer, for codes that are copied by hand. |
| `maxMessageBytes` (optional) | `number` |  |
| `softSendLimit` (optional) | `number` |  |
| `hardSendLimit` (optional) | `number` |  |
| `disconnectGraceMs` (optional) | `number` | See `RtcTransport`. |
| `timers` (optional) | `{setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout}` |  |

### `SignalingProvider`

Type: `object`

| Name | Type | Description |
|---|---|---|
| `room` | `string` | The code others join with. |
| `onPeer` | `((peerId: string) => void) \| null` | Someone entered the room. |
| `onPeerLeft` | `((peerId: string) => void) \| null` | Someone left it (or dropped). |
| `onMessage` | `((peerId: string, message: object) => void) \| null` | A message from a peer. |
| `send` | `(peerId: string, message: object) => void` |  |
| `onClose` | `(() => void) \| null` | The room ended from outside (the signalling server went away). |
| `close` | `() => void` | End the room. |
| `room` | `string` |  |
| `peerId` | `string` | The name the host sees. |
| `onMessage` | `((message: object) => void) \| null` |  |
| `send` | `(message: object) => void` |  |
| `onClose` | `(() => void) \| null` | The host left, or the connection to the signalling server was lost. |
| `close` | `() => void` |  |
| `host` | `(options?: {room?: string, maxPeers?: number, isPublic?: boolean, name?: string}) => Promise<HostSignaling>` | Start a room (a code is made if none is given). |
| `join` | `(room: string) => Promise<JoinSignaling>` | Enter a room; rejects if there is none. |

### `Transport`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `sentMessages` | `number` |  |
| `sentBytes` | `number` |  |
| `receivedMessages` | `number` |  |
| `receivedBytes` | `number` |  |
| `state` | `'connecting' \| 'open' \| 'closed'` |  |
| `onMessage` | `((bytes: Uint8Array, channel: Channel) => void) \| null` | Set by the owner. |
| `onClose` | `((reason: string) => void) \| null` | Called once when the connection ends, from either side. |
| `stats` | `TransportStats` |  |
| `send` | `(bytes: Uint8Array, channel?: Channel) => boolean` | False if the connection is closed. |
| `close` | `(reason?: string) => void` |  |
| `onConnection` | `((connection: Transport) => void) \| null` | Called for each accepted client. |
| `close` | `() => void` |  |

### `TransportStats`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `sentMessages` | `number` |  |
| `sentBytes` | `number` |  |
| `receivedMessages` | `number` |  |
| `receivedBytes` | `number` |  |
| `state` | `'connecting' \| 'open' \| 'closed'` |  |
| `onMessage` | `((bytes: Uint8Array, channel: Channel) => void) \| null` | Set by the owner. |
| `onClose` | `((reason: string) => void) \| null` | Called once when the connection ends, from either side. |
| `stats` | `TransportStats` |  |
| `send` | `(bytes: Uint8Array, channel?: Channel) => boolean` | False if the connection is closed. |
| `close` | `(reason?: string) => void` |  |
| `onConnection` | `((connection: Transport) => void) \| null` | Called for each accepted client. |
| `close` | `() => void` |  |

### `WtSessionLike`

What a session of either implementation (the browser's `WebTransport`, or the Node package's) offers.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `closed` | `Promise<any>` |  |
| `close` | `(info?: {closeCode?: number, reason?: string}) => void` |  |
| `datagrams` | `{readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>, maxDatagramSize?: number}` |  |
| `getStats` (optional) | `() => Promise<any>` |  |
