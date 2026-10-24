/**
 * Transport contract. Every adapter (in-memory, WebSocket, WebTransport...)
 * implements `Transport` for one connection and `Listener` for a server.
 *
 * Channels:
 * - RELIABLE: ordered and lossless (handshake, spawn/despawn, chat).
 * - UNRELIABLE: may be dropped, duplicated or reordered (snapshots, inputs).
 *   Payloads must carry their own tick/sequence so stale or duplicate
 *   messages can be discarded. A WebSocket adapter maps both channels onto one
 *   ordered stream, so a lost packet delays later ones; newer snapshots
 *   supersede older ones, so receivers should just drop anything stale.
 *
 * `send` copies the bytes (or finishes with them) before returning, so callers
 * may reuse their buffer immediately.
 */
export const CHANNEL = Object.freeze({ RELIABLE: 0, UNRELIABLE: 1 });

/**
 * @typedef {0 | 1} Channel
 *
 * @typedef {Object} TransportStats
 * @property {number} sentMessages
 * @property {number} sentBytes
 * @property {number} receivedMessages
 * @property {number} receivedBytes
 *
 * @typedef {Object} Transport
 * @property {'connecting' | 'open' | 'closed'} state
 * @property {((bytes: Uint8Array, channel: Channel) => void) | null} onMessage Set by the owner.
 * @property {((reason: string) => void) | null} onClose Called once when the connection ends, from either side.
 * @property {TransportStats} stats
 * @property {(bytes: Uint8Array, channel?: Channel) => boolean} send False if the connection is closed.
 * @property {(reason?: string) => void} close
 *
 * @typedef {Object} Listener
 * @property {((connection: Transport) => void) | null} onConnection Called for each accepted client.
 * @property {() => void} close
 */

/**
 * A fresh set of transport counters (messages and bytes sent and received).
 *
 * @returns {TransportStats}
 */
export const createStats = () => ({ sentMessages: 0, sentBytes: 0, receivedMessages: 0, receivedBytes: 0 });

/** Optional extras some adapters add: `droppedMessages` (unreliable sends skipped under backpressure), `rttMs`. */
