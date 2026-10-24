// A small signalling server for browser-to-browser games: it introduces peers and relays their handshake messages, and that is all. The game itself never passes through it.
// Run it anywhere you can run Node (a spare machine, a cheap VPS, the host's own PC on a LAN). Node only: `import { createSignalingServer } from '@engine/transport/node'`.
import { listenWebSocket } from '../ws/server.js';
import { CHANNEL } from '../types.js';
import { makeRoomCode, isRoomCode } from './signaling.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const frame = (obj) => enc.encode(JSON.stringify(obj));

/**
 * @typedef {object} SignalingServerOptions
 * @property {number} [port] 0 picks a free one. @property {string} [host]
 * @property {string[] | ((origin: string) => boolean)} [allowedOrigins] Which web pages may use it (browsers send an Origin). Unset allows all: set it for a public server.
 * @property {number} [maxRooms] @property {number} [maxPeersPerRoom] @property {number} [maxMessageBytes] Largest handshake message accepted (default 16 KB).
 * @property {number} [idleMs] A connection that has not hosted or joined within this long is dropped (default 10 s).
 * @property {number} [maxConnections] @property {number} [maxConnectionsPerIp] @property {number} [maxMessagesPerSecond] @property {number} [burstMessages] The WebSocket limits (see `listenWebSocket`); the defaults here are tight, because handshakes are short.
 * @property {() => number} [random]
 */

/**
 * Start a signalling server.
 * @param {SignalingServerOptions} [options]
 * @returns {Promise<{port: number, host: string, rooms: Map<string, any>, close: () => Promise<void>}>}
 */
export async function createSignalingServer({ maxRooms = 1000, maxPeersPerRoom = 32, maxMessageBytes = 16 * 1024, idleMs = 10_000, random = Math.random, maxConnections = 2048, maxConnectionsPerIp = 24, maxMessagesPerSecond = 60, burstMessages = 120, ...ws } = {}) {
  /** @type {Map<string, {host: any, peers: Map<string, any>, max: number, isPublic: boolean, name: string}>} */
  const rooms = new Map();
  let nextId = 1;
  const listener = await listenWebSocket({ maxPayload: maxMessageBytes, maxConnections, maxConnectionsPerIp, maxMessagesPerSecond, burstMessages, ...ws });
  const tell = (conn, obj) => conn.send(frame(obj), CHANNEL.RELIABLE);
  const refuse = (conn, reason) => { tell(conn, { t: 'error', reason }); conn.close(reason); };

  listener.onConnection = (conn) => {
    conn.role = 'new'; conn.room = null; conn.id = '';
    const idle = setTimeout(() => { if (conn.role === 'new') conn.close('idle'); }, idleMs);
    idle.unref?.();
    conn.onClose = () => {
      clearTimeout(idle);
      const room = conn.room && rooms.get(conn.room);
      if (!room) return;
      if (conn.role === 'host') { rooms.delete(conn.room); for (const p of room.peers.values()) p.close('host left'); }
      else if (conn.role === 'peer' && room.peers.delete(conn.id)) tell(room.host, { t: 'left', id: conn.id });
    };
    conn.onMessage = (bytes) => {
      let m;
      try { m = JSON.parse(dec.decode(bytes)); } catch { return refuse(conn, 'bad message'); }
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return refuse(conn, 'bad message');
      if (m.t === 'signal') return relay(conn, m);
      if (conn.role !== 'new') return refuse(conn, 'unexpected message');
      if (m.t === 'host') return openRoom(conn, m);
      if (m.t === 'join') return joinRoom(conn, m);
      if (m.t === 'list') {
        const list = [];
        for (const [code, r] of rooms) if (r.isPublic && list.length < 100) list.push({ room: code, name: r.name, peers: r.peers.size, max: r.max });
        tell(conn, { t: 'rooms', rooms: list });
        return undefined;
      }
      return refuse(conn, 'unknown request');
    };
  };

  function openRoom(conn, m) {
    if (rooms.size >= maxRooms) return refuse(conn, 'server is full');
    let code;
    if (m.room !== undefined && m.room !== null) {
      if (!isRoomCode(m.room)) return refuse(conn, 'a room code is letters and digits, 3 to 16 of them');
      code = String(m.room).toUpperCase();
      if (rooms.has(code)) return refuse(conn, 'room is taken');
    } else {
      for (let i = 0; i < 50 && (!code || rooms.has(code)); i++) code = makeRoomCode(5, random);
      if (rooms.has(code)) return refuse(conn, 'server is full');
    }
    const max = Math.max(1, Math.min(maxPeersPerRoom, Number.isInteger(m.max) ? m.max : 16));
    rooms.set(code, { host: conn, peers: new Map(), max, isPublic: m.public === true, name: typeof m.name === 'string' ? m.name.slice(0, 40) : '' });
    conn.role = 'host'; conn.room = code;
    tell(conn, { t: 'hosted', room: code });
    return undefined;
  }

  function joinRoom(conn, m) {
    const code = typeof m.room === 'string' ? m.room.toUpperCase() : '';
    const room = rooms.get(code);
    if (!room) return refuse(conn, 'no such room');
    if (room.peers.size >= room.max) return refuse(conn, 'room is full');
    conn.role = 'peer'; conn.room = code; conn.id = `p${nextId++}`;
    room.peers.set(conn.id, conn);
    tell(conn, { t: 'joined', room: code, id: conn.id });
    tell(room.host, { t: 'peer', id: conn.id });
    return undefined;
  }

  function relay(conn, m) {
    const room = conn.room && rooms.get(conn.room);
    if (!room || !m.data || typeof m.data !== 'object') return refuse(conn, 'bad message');
    if (conn.role === 'host') {
      const peer = room.peers.get(m.to);
      if (peer) tell(peer, { t: 'signal', data: m.data });
    } else if (conn.role === 'peer') tell(room.host, { t: 'signal', from: conn.id, data: m.data });
    else refuse(conn, 'unexpected message');
    return undefined;
  }

  return { port: listener.port, host: listener.host, rooms, close: () => listener.close() };
}
