# @engine/protocol

Binary codecs, quantization, delta snapshots with acks, handshake, inputs.

```
npm install @engine/protocol
```

Version 0.1.0. The package's own README ([packages/protocol](../../packages/protocol/README.md)) explains how the pieces fit together; this page lists every export.

## Contents (48 of 48 documented)

| Name | Kind | Summary |
|---|---|---|
| [`BinaryReader`](#class-binaryreader) | class | Bounds-checked little-endian reader. |
| [`BinaryWriter`](#class-binarywriter) | class | Little-endian binary writer over a growable buffer. |
| [`InputBatch`](#class-inputbatch) | class | Reusable input packet: the newest `count` inputs (resent redundantly to survive loss) plus the newest snapshot tick the client has received, which the server uses as the delta baseline. |
| [`InputSchema`](#class-inputschema) | class | Layout of one input sample. |
| [`MAX_INPUTS_PER_PACKET`](#max_inputs_per_packet) | constant | The most inputs one packet may carry (older unacknowledged ones are resent with newer ones). |
| [`MSG`](#msg) | constant | First byte of every packet. |
| [`MissingBaselineError`](#class-missingbaselineerror) | class | The decoder needs a baseline snapshot it does not have; ask the server for a full one. |
| [`NetSchema`](#class-netschema) | class | The agreed list of replicated components and fields. |
| [`PROTOCOL_VERSION`](#protocol_version) | constant | Bump when the wire format changes incompatibly. |
| [`ProtocolError`](#class-protocolerror) | class | Thrown for any malformed, truncated or out-of-range wire data. |
| [`REJECT`](#reject) | constant | Reasons a server refuses a connection: `VERSION_MISMATCH`, `SCHEMA_MISMATCH`, `SERVER_FULL`, `BAD_REQUEST`, … |
| [`Snapshot`](#class-snapshot) | class | Replicated world state at one tick, in quantized "stored" form, rows sorted by entity slot index. |
| [`SnapshotCodec`](#class-snapshotcodec) | class | Encodes/decodes snapshots as full state or as a delta against an acked baseline. |
| [`SnapshotHistory`](#class-snapshothistory) | class | Fixed ring of recent snapshots, looked up by tick. |
| [`codecs`](#codecs) | namespace |  |
| [`decodeHello`](#decodehello) | function | Read the first message a client sends: protocol version, the hashes of the schemas it was built with, and an optional token. |
| [`decodeInput`](#decodeinput) | function | Read a batch of inputs into `out` (whose schema says what a record holds). |
| [`decodeReject`](#decodereject) | function | Read a rejection: the reason code and a message. |
| [`decodeWelcome`](#decodewelcome) | function | Read the server's answer to a hello: the client id, tick rate, current tick and what to expect. |
| [`describePacket`](#describepacket) | function | Human-readable description of one packet, for packet inspectors and logs. |
| [`encodeHello`](#encodehello) | function | Client -> server. |
| [`encodeInput`](#encodeinput) | function | Write a batch of inputs (the newest few, so a lost packet costs nothing) into `w`. |
| [`encodeReject`](#encodereject) | function | Write a rejection (a reason code and a short message) into `w`. |
| [`encodeWelcome`](#encodewelcome) | function | Server -> client. |
| [`f32`](#f32) | constant | 32-bit floating point field (4 bytes, about 7 digits). |
| [`f64`](#f64) | constant | 64-bit floating point field (8 bytes, full precision). |
| [`fnv1a`](#fnv1a) | function | FNV-1a, 32-bit. |
| [`i16`](#i16) | constant | Signed 16-bit integer field (-32768 to 32767). |
| [`i32`](#i32) | constant | Signed 32-bit integer field (-2147483648 to 2147483647). |
| [`i8`](#i8) | constant | Signed 8-bit integer field (-128 to 127). |
| [`packetType`](#packettype) | function | Peek at a packet's type without consuming it. |
| [`peekSnapshotHeader`](#peeksnapshotheader) | function | Read just the header of a snapshot payload (what `SnapshotCodec.encode` writes first), without decoding entities. |
| [`q`](#q) | function | Float in [min, max] stored as an unsigned integer of `bits` (8, 16 or 32). |
| [`quantizationStep`](#quantizationstep) | function | Largest possible quantization error for a q codec of this range and width. |
| [`readSnapshotHeader`](#readsnapshotheader) | function | Read the start of a snapshot message and return `inputAck`: the last input sequence number the server applied for this client. |
| [`u16`](#u16) | constant | Unsigned 16-bit integer field (0 to 65535). |
| [`u32`](#u32) | constant | Unsigned 32-bit integer field (0 to 4294967295). |
| [`u8`](#u8) | constant | Unsigned 8-bit integer field (0 to 255). |
| [`writeSnapshotHeader`](#writesnapshotheader) | function | SNAPSHOT packet layout: `[MSG.SNAPSHOT][varuint inputAck][SnapshotCodec payload]`. |

## Functions

### `decodeHello`

```js
function decodeHello(r)
```

Read the first message a client sends: protocol version, the hashes of the schemas it was built with, and an optional token.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` |  |

<sub>src/messages.js:43</sub>

### `decodeInput`

```js
function decodeInput(r, out)
```

Read a batch of inputs into `out` (whose schema says what a record holds). Returns `out`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` |  |
| `out` | `InputBatch` |  |

**Returns** `InputBatch` — `out`

<sub>src/messages.js:183</sub>

### `decodeReject`

```js
function decodeReject(r)
```

Read a rejection: the reason code and a message.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` |  |

<sub>src/messages.js:103</sub>

### `decodeWelcome`

```js
function decodeWelcome(r)
```

Read the server's answer to a hello: the client id, tick rate, current tick and what to expect.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` |  |

<sub>src/messages.js:73</sub>

### `describePacket`

```js
function describePacket(bytes)
```

Human-readable description of one packet, for packet inspectors and logs. Never throws:
malformed packets are reported as type `INVALID`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |

**Returns** `{type: string, summary: string, fields: Record<string, any>}`

<sub>src/describe.js:14</sub>

### `encodeHello`

```js
function encodeHello(w, m)
```

Client -> server. `schemaHash` and `inputHash` pin the replicated-state and input layouts.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `import('./binary.js').BinaryWriter` |  |
| `m` | `{schemaHash: number, inputHash: number, token?: string}` |  |

<sub>src/messages.js:30</sub>

### `encodeInput`

```js
function encodeInput(w, b)
```

Write a batch of inputs (the newest few, so a lost packet costs nothing) into `w`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `import('./binary.js').BinaryWriter` |  |
| `b` | `InputBatch` |  |

<sub>src/messages.js:163</sub>

### `encodeReject`

```js
function encodeReject(w, reason, message = '')
```

Write a rejection (a reason code and a short message) into `w`.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `import('./binary.js').BinaryWriter` |  |
| `reason` | `number` | One of REJECT. |
| `message` (optional) | `string` |  |

<sub>src/messages.js:92</sub>

### `encodeWelcome`

```js
function encodeWelcome(w, m)
```

Server -> client. Lists the plugins (id, version, content hash) the client must load.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `import('./binary.js').BinaryWriter` | `session` is an unguessable token the client presents in HELLO (`token`) to resume this player after a disconnect; `resumed` says the server honoured such a token (same player, same state) rather than starting a new one. |
| `m` | `{clientId: number, tickRate: number, serverTick: number, plugins?: {id: string, version: string, hash: string}[], session?: string, resumed?: boolean}` |  |

<sub>src/messages.js:55</sub>

### `fnv1a`

```js
function fnv1a(s)
```

FNV-1a, 32-bit.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `s` | `string` |  |

<sub>src/schema.js:8</sub>

### `packetType`

```js
function packetType(bytes)
```

Peek at a packet's type without consuming it.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |

<sub>src/messages.js:200</sub>

### `peekSnapshotHeader`

```js
function peekSnapshotHeader(r)
```

Read just the header of a snapshot payload (what `SnapshotCodec.encode` writes first), without
decoding entities. For debugging tools and packet inspectors.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` | Positioned at the snapshot kind byte. |

**Returns** `{kind: 'full' \| 'delta', tick: number, baselineTick: number \| null, removed: number, changed: number}`

<sub>src/snapshot.js:108</sub>

### `q`

```js
function q(min, max, bits)
```

Float in [min, max] stored as an unsigned integer of `bits` (8, 16 or 32).
Error is at most (max - min) / (2^bits - 1) / 2. Out-of-range values clamp.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `min` | `number` |  |
| `max` | `number` |  |
| `bits` | `8\|16\|32` |  |

**Returns** `Codec`

<sub>src/codecs.js:75</sub>

### `quantizationStep`

```js
function quantizationStep(min, max, bits)
```

Largest possible quantization error for a q codec of this range and width.

<sub>src/codecs.js:94</sub>

### `readSnapshotHeader`

```js
function readSnapshotHeader(r)
```

Read the start of a snapshot message and return `inputAck`: the last input sequence number the server applied for this client.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` |  |

**Returns** `number` — inputAck

<sub>src/messages.js:223</sub>

### `writeSnapshotHeader`

```js
function writeSnapshotHeader(w, inputAck)
```

SNAPSHOT packet layout: `[MSG.SNAPSHOT][varuint inputAck][SnapshotCodec payload]`.
`inputAck` is the newest input sequence number the server has applied for this
client, which lets the client drop acknowledged inputs and reconcile its prediction.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `w` | `import('./binary.js').BinaryWriter` |  |
| `inputAck` | `number` |  |

<sub>src/messages.js:212</sub>

## Classes

### `class BinaryReader`

```js
class BinaryReader
```

Bounds-checked little-endian reader. Every overrun throws ProtocolError.

#### `BinaryReader.constructor`

```js
constructor(bytes)
```

| Name | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array` |  |

#### `BinaryReader.remaining`

```js
get remaining
```

#### `BinaryReader.u8`

```js
u8()
```

#### `BinaryReader.i8`

```js
i8()
```

#### `BinaryReader.u16`

```js
u16()
```

#### `BinaryReader.i16`

```js
i16()
```

#### `BinaryReader.u32`

```js
u32()
```

#### `BinaryReader.i32`

```js
i32()
```

#### `BinaryReader.f32`

```js
f32()
```

#### `BinaryReader.f64`

```js
f64()
```

#### `BinaryReader.varuint`

```js
varuint()
```

#### `BinaryReader.bytesRaw`

```js
bytesRaw(n)
```

| Name | Type | Description |
|---|---|---|
| `n` | `number` |  |

**Returns** `Uint8Array` — View into the packet.

#### `BinaryReader.string`

```js
string(maxLength = 1024)
```

| Name | Type | Description |
|---|---|---|
| `maxLength` (optional) | `number` | Max bytes accepted. |

<sub>src/binary.js:65</sub>

### `class BinaryWriter`

```js
class BinaryWriter
```

Little-endian binary writer over a growable buffer. `finish()` returns a view, not a copy.

#### `BinaryWriter.constructor`

```js
constructor(capacity = 1024)
```

| Name | Type | Description |
|---|---|---|
| `capacity` (optional) | `number` |  |

#### `BinaryWriter.reset`

```js
reset()
```

#### `BinaryWriter.finish`

```js
finish()
```

**Returns** `Uint8Array` — View of the written bytes (valid until the next write/reset).

#### `BinaryWriter.u8`

```js
u8(v)
```

#### `BinaryWriter.i8`

```js
i8(v)
```

#### `BinaryWriter.u16`

```js
u16(v)
```

#### `BinaryWriter.i16`

```js
i16(v)
```

#### `BinaryWriter.u32`

```js
u32(v)
```

#### `BinaryWriter.i32`

```js
i32(v)
```

#### `BinaryWriter.f32`

```js
f32(v)
```

#### `BinaryWriter.f64`

```js
f64(v)
```

#### `BinaryWriter.varuint`

```js
varuint(v)
```

Unsigned LEB128, up to 32 bits (1-5 bytes).

#### `BinaryWriter.bytesRaw`

```js
bytesRaw(b)
```

| Name | Type | Description |
|---|---|---|
| `b` | `Uint8Array` |  |

#### `BinaryWriter.string`

```js
string(s)
```

Length-prefixed UTF-8.

| Name | Type | Description |
|---|---|---|
| `s` | `string` |  |

<sub>src/binary.js:14</sub>

### `class InputBatch`

```js
class InputBatch
```

Reusable input packet: the newest `count` inputs (resent redundantly to
survive loss) plus the newest snapshot tick the client has received, which
the server uses as the delta baseline. Values are natural (dequantized).

#### `InputBatch.constructor`

```js
constructor(schema)
```

| Name | Type | Description |
|---|---|---|
| `schema` | `InputSchema` |  |

#### `InputBatch.clear`

```js
clear()
```

#### `InputBatch.push`

```js
push(subTick, values)
```

Append the next input (sequence = firstSeq + count).

| Name | Type | Description |
|---|---|---|
| `subTick` | `number` | 0-255: where within its tick the input was sampled. |
| `values` | `ArrayLike<number>` | One per schema field, in schema order. |

<sub>src/messages.js:130</sub>

### `class InputSchema`

```js
class InputSchema
```

Layout of one input sample. Fields are codecs, same idea as replicated state.
Example: `{ buttons: u16, moveX: q(-1, 1, 8), aim: q(0, 6.2832, 16) }`.

#### `InputSchema.constructor`

```js
constructor(fields)
```

| Name | Type | Description |
|---|---|---|
| `fields` | `Record<string, import('./codecs.js').Codec>` |  |

<sub>src/messages.js:112</sub>

### `class MissingBaselineError`

```js
class MissingBaselineError extends ProtocolError
```

The decoder needs a baseline snapshot it does not have; ask the server for a full one.

#### `MissingBaselineError.constructor`

```js
constructor(baselineTick)
```

| Name | Type | Description |
|---|---|---|
| `baselineTick` | `number` |  |

<sub>src/snapshot.js:9</sub>

### `class NetSchema`

```js
class NetSchema
```

The agreed list of replicated components and fields. Client and server must
build the identical schema; `hash` is compared in the handshake. Component
position in the list is its wire id (max 32), field order is its wire order.

#### `NetSchema.constructor`

```js
constructor(entries)
```

| Name | Type | Description |
|---|---|---|
| `entries` | `NetEntry[]` |  |

<sub>src/schema.js:19</sub>

### `class ProtocolError`

```js
class ProtocolError extends Error
```

Thrown for any malformed, truncated or out-of-range wire data. Never trust the network.

#### `ProtocolError.constructor`

```js
constructor(message)
```

| Name | Type | Description |
|---|---|---|
| `message` | `string` |  |

<sub>src/binary.js:2</sub>

### `class Snapshot`

```js
class Snapshot
```

Replicated world state at one tick, in quantized "stored" form, rows sorted
by entity slot index. Row r has id `ids[r]`, component presence bits
`masks[r]`, and `schema.fieldCount` values starting at `r * fieldCount`.

#### `Snapshot.constructor`

```js
constructor(schema, capacity)
```

| Name | Type | Description |
|---|---|---|
| `schema` | `import('./schema.js').NetSchema` |  |
| `capacity` | `number` | Max entities. |

#### `Snapshot.clear`

```js
clear()
```

#### `Snapshot.capture`

```js
capture(world, tick, ids, n)
```

Capture entities from a core World. `ids` must be live entity ids in
ascending slot-index order (e.g. from `world.query`, or interest management).

| Name | Type | Description |
|---|---|---|
| `world` | `{stores: Map<any, {data: Record<string, any>, present: Uint8Array}>}` |  |
| `tick` | `number` |  |
| `ids` | `Uint32Array` |  |
| `n` | `number` | Number of ids to use. |

#### `Snapshot.rowOf`

```js
rowOf(id)
```

**Returns** `number` — Row of the entity with this exact id, or -1.

#### `Snapshot.get`

```js
get(row, compBit, fieldName)
```

Natural (dequantized) value of one field.

<sub>src/snapshot.js:23</sub>

### `class SnapshotCodec`

```js
class SnapshotCodec
```

Encodes/decodes snapshots as full state or as a delta against an acked
baseline. Holds scratch buffers, so create one per schema and reuse it.

Delta layout (after a kind byte and tick): baseline tick, removed ids,
then only entities that changed: slot-index gap, generation, presence mask,
and per present component either all fields (new) or a changed-field mask
followed by just those fields.

#### `SnapshotCodec.constructor`

```js
constructor(schema, capacity)
```

| Name | Type | Description |
|---|---|---|
| `schema` | `import('./schema.js').NetSchema` |  |
| `capacity` | `number` | Max entities per snapshot (also the decode limit). |

#### `SnapshotCodec.encode`

```js
encode(w, cur, baseline)
```

| Name | Type | Description |
|---|---|---|
| `w` | `import('./binary.js').BinaryWriter` |  |
| `cur` | `Snapshot` |  |
| `baseline` | `Snapshot \| null` | Must be an acked snapshot the receiver still holds; null = full. |

#### `SnapshotCodec.decode`

```js
decode(r, getBaseline, out)
```

| Name | Type | Description |
|---|---|---|
| `r` | `import('./binary.js').BinaryReader` |  |
| `getBaseline` | `(tick: number) => Snapshot \| undefined` | Look up a held snapshot by tick. |
| `out` | `Snapshot` | Receives the result; must not be a held baseline. |

**Returns** `Snapshot` — `out`

<sub>src/snapshot.js:130</sub>

### `class SnapshotHistory`

```js
class SnapshotHistory
```

Fixed ring of recent snapshots, looked up by tick. The server keeps one per
client (or one shared) to find the acked baseline for deltas; the client
keeps one to decode incoming deltas.

Usage: `slot = h.acquire()`, fill it (capture/decode), then `h.commit(slot)`.
A slot that was acquired but never committed (e.g. decode threw) is never
returned by `get`, so a half-written snapshot can't become a baseline.
Acquiring evicts the oldest entry, so size the ring larger than the
longest ack lag you want to serve deltas for; beyond that, `get` returns
undefined and the sender falls back to a full snapshot.

#### `SnapshotHistory.constructor`

```js
constructor(schema, capacity, size = 32)
```

| Name | Type | Description |
|---|---|---|
| `schema` | `import('./schema.js').NetSchema` |  |
| `capacity` | `number` | Entities per snapshot. |
| `size` (optional) | `number` | Snapshots kept. |

#### `SnapshotHistory.acquire`

```js
acquire()
```

**Returns** `Snapshot` — The oldest slot, emptied and invalid until committed.

#### `SnapshotHistory.commit`

```js
commit(slot)
```

| Name | Type | Description |
|---|---|---|
| `slot` | `Snapshot` |  |

#### `SnapshotHistory.get`

```js
get(tick)
```

| Name | Type | Description |
|---|---|---|
| `tick` | `number` |  |

**Returns** `Snapshot \| undefined`

#### `SnapshotHistory.around`

```js
around(tick)
```

Committed snapshots closest to `tick` on each side, for interpolation.
`before.tick <= tick <= after.tick` when both exist; either may be undefined.

| Name | Type | Description |
|---|---|---|
| `tick` | `number` |  |

**Returns** `{before: Snapshot \| undefined, after: Snapshot \| undefined}`

#### `SnapshotHistory.latest`

```js
latest()
```

**Returns** `Snapshot \| undefined` — The most recently committed snapshot.

<sub>src/history.js:15</sub>

## Constants

### `MAX_INPUTS_PER_PACKET`

```js
const MAX_INPUTS_PER_PACKET
```

The most inputs one packet may carry (older unacknowledged ones are resent with newer ones).

Value: `16`

<sub>src/messages.js:14</sub>

### `MSG`

```js
const MSG
```

First byte of every packet.

Value: `Object.freeze({ HELLO: 1, WELCOME: 2, REJECT: 3, INPUT: 4, SNAPSHOT: 5, EVENT: 6`

<sub>src/messages.js:7</sub>

### `PROTOCOL_VERSION`

```js
const PROTOCOL_VERSION
```

Bump when the wire format changes incompatibly. Checked in the handshake.

Value: `1`

<sub>src/messages.js:4</sub>

### `REJECT`

```js
const REJECT
```

Reasons a server refuses a connection: `VERSION_MISMATCH`, `SCHEMA_MISMATCH`, `SERVER_FULL`, `BAD_REQUEST`, …

Value: `Object.freeze({ VERSION_MISMATCH: 1, SCHEMA_MISMATCH: 2, SERVER_FULL: 3, BAD_REQ`

<sub>src/messages.js:10</sub>

### `f32`

```js
const f32
```

32-bit floating point field (4 bytes, about 7 digits).

Value: `{`

<sub>src/codecs.js:45</sub>

### `f64`

```js
const f64
```

64-bit floating point field (8 bytes, full precision).

Value: `{`

<sub>src/codecs.js:58</sub>

### `i16`

```js
const i16
```

Signed 16-bit integer field (-32768 to 32767).

Value: `intCodec('i16', -32768, 32767, 'i16', 'i16')`

<sub>src/codecs.js:36</sub>

### `i32`

```js
const i32
```

Signed 32-bit integer field (-2147483648 to 2147483647).

Value: `intCodec('i32', -2147483648, 2147483647, 'i32', 'i32')`

<sub>src/codecs.js:38</sub>

### `i8`

```js
const i8
```

Signed 8-bit integer field (-128 to 127).

Value: `intCodec('i8', -128, 127, 'i8', 'i8')`

<sub>src/codecs.js:34</sub>

### `u16`

```js
const u16
```

Unsigned 16-bit integer field (0 to 65535).

Value: `intCodec('u16', 0, 65535, 'u16', 'u16')`

<sub>src/codecs.js:30</sub>

### `u32`

```js
const u32
```

Unsigned 32-bit integer field (0 to 4294967295).

Value: `intCodec('u32', 0, 4294967295, 'u32', 'u32')`

<sub>src/codecs.js:32</sub>

### `u8`

```js
const u8
```

Unsigned 8-bit integer field (0 to 255).

Value: `intCodec('u8', 0, 255, 'u8', 'u8')`

<sub>src/codecs.js:28</sub>

## Namespaces

### `codecs`

#### `codecs.f32`

```js
const f32
```

32-bit floating point field (4 bytes, about 7 digits).

Value: `{`

<sub>src/codecs.js:45</sub>

#### `codecs.f64`

```js
const f64
```

64-bit floating point field (8 bytes, full precision).

Value: `{`

<sub>src/codecs.js:58</sub>

#### `codecs.i16`

```js
const i16
```

Signed 16-bit integer field (-32768 to 32767).

Value: `intCodec('i16', -32768, 32767, 'i16', 'i16')`

<sub>src/codecs.js:36</sub>

#### `codecs.i32`

```js
const i32
```

Signed 32-bit integer field (-2147483648 to 2147483647).

Value: `intCodec('i32', -2147483648, 2147483647, 'i32', 'i32')`

<sub>src/codecs.js:38</sub>

#### `codecs.i8`

```js
const i8
```

Signed 8-bit integer field (-128 to 127).

Value: `intCodec('i8', -128, 127, 'i8', 'i8')`

<sub>src/codecs.js:34</sub>

#### `codecs.q`

```js
function q(min, max, bits)
```

Float in [min, max] stored as an unsigned integer of `bits` (8, 16 or 32).
Error is at most (max - min) / (2^bits - 1) / 2. Out-of-range values clamp.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `min` | `number` |  |
| `max` | `number` |  |
| `bits` | `8\|16\|32` |  |

**Returns** `Codec`

<sub>src/codecs.js:75</sub>

#### `codecs.quantizationStep`

```js
function quantizationStep(min, max, bits)
```

Largest possible quantization error for a q codec of this range and width.

<sub>src/codecs.js:94</sub>

#### `codecs.u16`

```js
const u16
```

Unsigned 16-bit integer field (0 to 65535).

Value: `intCodec('u16', 0, 65535, 'u16', 'u16')`

<sub>src/codecs.js:30</sub>

#### `codecs.u32`

```js
const u32
```

Unsigned 32-bit integer field (0 to 4294967295).

Value: `intCodec('u32', 0, 4294967295, 'u32', 'u32')`

<sub>src/codecs.js:32</sub>

#### `codecs.u8`

```js
const u8
```

Unsigned 8-bit integer field (0 to 255).

Value: `intCodec('u8', 0, 255, 'u8', 'u8')`

<sub>src/codecs.js:28</sub>

<sub>src/codecs.js:1</sub>

## Types

### `Codec`

A codec turns a number into a wire value and back. Values are held in
"stored" form (quantized integer for q-codecs, the number itself otherwise),
so change detection compares exact integers and never jitters.

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `name` | `string` | Canonical description (feeds the schema hash). |
| `quantize` | `(v: number) => number` | Natural value -> stored value. |
| `dequantize` | `(s: number) => number` | Stored value -> natural value. |
| `write` | `(w: import('./binary.js').BinaryWriter, s: number) => void` |  |
| `read` | `(r: import('./binary.js').BinaryReader) => number` |  |

### `NetEntry`

Type: `Object`

| Name | Type | Description |
|---|---|---|
| `component` | `{name: string, fields: string[]}` | A core component. |
| `codecs` | `Record<string, import('./codecs.js').Codec>` | Replicated fields and how to encode each. |
