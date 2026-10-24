// Hosting and joining a game between browsers: the two ends of a room.
import { Negotiation } from './negotiate.js';

/**
 * Start a room that browsers can join, and accept them one by one: every peer that completes the handshake arrives as a `Transport` in `onConnection`, exactly like a client of a WebSocket
 * server, so the same server code (rooms, replication, lag compensation) can run in the host's browser.
 *
 * ```js
 * const listener = await listenWebRTC(new ServerSignaling('wss://signal.example.com/'), { maxPeers: 4, isPublic: true, name: 'Ana\'s game' });
 * showCode(listener.room);                                  // "K7QXD": friends type this in
 * listener.onConnection = (conn) => { conn.onMessage = (bytes, channel) => {}; conn.onClose = (why) => {}; };
 * ```
 * @param {import('./signaling.js').SignalingProvider} signaling
 * @param {import('./negotiate.js').RtcOptions & {room?: string, maxPeers?: number, isPublic?: boolean, name?: string}} [options] `room`: ask for this code. `maxPeers`: how many players at once (default 8); more are told the room is full.
 * @returns {Promise<import('../types.js').Listener & {room: string, peers: Set<import('./transport.js').RtcTransport>, connections: Set<import('./transport.js').RtcTransport>, pending: number, close: () => void}>}
 */
export async function listenWebRTC(signaling, options = {}) {
  const maxPeers = options.maxPeers ?? 8;
  const hs = await signaling.host({ room: options.room, maxPeers, isPublic: options.isPublic, name: options.name });
  /** @type {Map<string, Negotiation>} */ const negotiations = new Map();
  /** @type {Set<import('./transport.js').RtcTransport>} */ const peers = new Set();
  let closed = false;
  const listener = {
    onConnection: null, room: hs.room, peers, connections: peers,
    get pending() { return negotiations.size; },
    close() {
      if (closed) return;
      closed = true;
      for (const n of negotiations.values()) n.cancel('host closed');
      negotiations.clear();
      for (const t of [...peers]) t.close('host closed');
      hs.close();
    },
  };
  hs.onPeer = (peerId) => {
    if (closed) return;
    if (negotiations.size + peers.size >= maxPeers) { hs.send(peerId, { t: 'full' }); return; }
    const n = new Negotiation({ offerer: true, peerId, send: (m) => hs.send(peerId, m), options });
    negotiations.set(peerId, n);
    n.start();
    n.transport.then((t) => {
      negotiations.delete(peerId);
      if (closed) { t.close('host closed'); return; }
      peers.add(t);
      t.watch('close', () => peers.delete(t));
      listener.onConnection?.(t);
    }, () => { negotiations.delete(peerId); });
  };
  hs.onMessage = (peerId, m) => { negotiations.get(peerId)?.receive(m); };
  // a player who has answered closes their signalling connection as soon as their side is open, a moment before ours is: that is not leaving. Only someone who goes before answering is dropped.
  hs.onPeerLeft = (peerId) => { const n = negotiations.get(peerId); if (n && !n.remoteSet && !n.answered) n.cancel('peer left'); };
  hs.onClose = () => listener.close();
  return listener;
}

/**
 * Join a room. Returns a `Transport` straight away, 'connecting' until the handshake is done (then `onOpen` fires), or 'closed' with a reason (`onClose`) if there is no such room, it is full, the
 * host leaves before the connection is made, or the network cannot be crossed.
 *
 * ```js
 * const t = connectWebRTC(new ServerSignaling('wss://signal.example.com/'), 'K7QXD');
 * t.onOpen = () => t.send(hello, CHANNEL.RELIABLE);
 * t.onMessage = (bytes, channel) => {};
 * t.onClose = (why) => showMessage(why);
 * ```
 * @param {import('./signaling.js').SignalingProvider} signaling @param {string} room @param {import('./negotiate.js').RtcOptions} [options]
 * @returns {import('./transport.js').RtcTransport}
 */
export function connectWebRTC(signaling, room, options = {}) {
  /** @type {import('./signaling.js').JoinSignaling | null} */ let js = null;
  const n = new Negotiation({ offerer: false, peerId: 'host', send: (m) => js?.send(m), options });
  signaling.join(room).then((s) => {
    if (n.done) { s.close(); return; }
    js = s;
    s.onMessage = (m) => { if (m?.t === 'full') n.cancel('room is full'); else n.receive(m); };
    s.onClose = () => { if (!n.done) n.cancel('host left'); };
  }, (e) => n.cancel(e?.message ?? 'could not join'));
  n.transport.then(() => js?.close(), () => js?.close());                 // the introduction is over: free the signalling connection
  return n.rtcTransport;
}
