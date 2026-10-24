// How two browsers find each other before they can talk directly: small JSON messages (offers, answers, candidates) carried by something the two can both reach.
// A "provider" starts rooms (`host`) and enters them (`join`); three are here: in memory, between tabs of one site, and through a signalling server you run.
import { connectWebSocket } from '../ws/client.js';

/**
 * @typedef {object} HostSignaling The host's end of a room.
 * @property {string} room The code others join with.
 * @property {((peerId: string) => void) | null} onPeer Someone entered the room.
 * @property {((peerId: string) => void) | null} onPeerLeft Someone left it (or dropped).
 * @property {((peerId: string, message: object) => void) | null} onMessage A message from a peer.
 * @property {(peerId: string, message: object) => void} send
 * @property {(() => void) | null} onClose The room ended from outside (the signalling server went away).
 * @property {() => void} close End the room.
 *
 * @typedef {object} JoinSignaling A joiner's end.
 * @property {string} room @property {string} peerId The name the host sees. @property {((message: object) => void) | null} onMessage @property {(message: object) => void} send
 * @property {(() => void) | null} onClose The host left, or the connection to the signalling server was lost. @property {() => void} close
 *
 * @typedef {object} SignalingProvider
 * @property {(options?: {room?: string, maxPeers?: number, isPublic?: boolean, name?: string}) => Promise<HostSignaling>} host Start a room (a code is made if none is given).
 * @property {(room: string) => Promise<JoinSignaling>} join Enter a room; rejects if there is none.
 */

/** Characters for room codes: no 0 / O or 1 / I / L, which are mistaken for each other when read aloud. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A random room code. @param {number} [length] @param {() => number} [random] */
export function makeRoomCode(length = 5, random = Math.random) {
  let s = '';
  for (let i = 0; i < length; i++) s += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return s;
}

/** Is this a plausible room code (letters and digits, 3 to 16 of them)? @param {unknown} s */
export const isRoomCode = (s) => typeof s === 'string' && /^[A-Za-z0-9]{3,16}$/.test(s);

const later = (fn) => queueMicrotask(fn);

/**
 * Make `target[key]` a handler that can be set at any time: calls that arrive before it is set are kept and delivered, in order, the moment it is. Without this a message that comes in the
 * same breath as the answer to "may I join" could be lost, because the joiner has not had a chance to say where its messages should go.
 * @param {object} target @param {string} key @returns {(...args: any[]) => void} What to call when something arrives.
 */
function queuedHandler(target, key) {
  let handler = null;
  const queue = [];
  Object.defineProperty(target, key, { enumerable: true, get: () => handler, set(fn) { handler = fn; while (handler && queue.length) handler(...queue.shift()); } });
  return (...args) => { if (handler) handler(...args); else queue.push(args); };
}

/**
 * Rooms inside one JavaScript context: a host and its joiners in the same page or process. For tests, hot-seat setups and games that run the host in a worker next to the page.
 * @implements {SignalingProvider}
 */
export class LoopbackSignaling {
  constructor({ random = Math.random } = {}) { this.random = random; /** @type {Map<string, {host: any, peers: Map<string, any>, max: number}>} */ this.rooms = new Map(); this.next = 1; }

  async host({ room, maxPeers = 16 } = {}) {
    const code = room ?? makeRoomCode(5, this.random);
    if (!isRoomCode(code)) throw new Error('a room code is letters and digits, 3 to 16 of them');
    if (this.rooms.has(code)) throw new Error(`room ${code} is taken`);
    const entry = { host: null, peers: new Map(), max: maxPeers };
    const host = {
      room: code, onClose: null,
      send: (peerId, message) => { const p = entry.peers.get(peerId); if (p) later(() => p.deliver(structuredClone(message))); },
      close: () => { if (this.rooms.get(code) !== entry) return; this.rooms.delete(code); for (const p of entry.peers.values()) later(() => p.onClose?.()); entry.peers.clear(); },
    };
    host.fire = { peer: queuedHandler(host, 'onPeer'), left: queuedHandler(host, 'onPeerLeft'), message: queuedHandler(host, 'onMessage') };
    entry.host = host;
    this.rooms.set(code, entry);
    return host;
  }

  async join(room) {
    const entry = this.rooms.get(String(room).toUpperCase()) ?? this.rooms.get(room);
    if (!entry) throw new Error(`no room ${room}`);
    if (entry.peers.size >= entry.max) throw new Error(`room ${room} is full`);
    const peerId = `p${this.next++}`;
    const peer = {
      room: entry.host.room, peerId, onClose: null,
      send: (message) => { if (entry.peers.has(peerId)) later(() => entry.host.fire.message(peerId, structuredClone(message))); },
      close: () => { if (!entry.peers.delete(peerId)) return; later(() => entry.host.fire.left(peerId)); },
    };
    peer.deliver = queuedHandler(peer, 'onMessage');
    entry.peers.set(peerId, peer);
    later(() => entry.host.fire.peer(peerId));
    return peer;
  }
}

/**
 * Rooms between tabs and windows of one site, through a `BroadcastChannel`: open the game in two tabs and one hosts, the other joins, with no server at all. (A different site, device or
 * browser profile cannot be reached this way: use a signalling server or invitation codes.)
 * @implements {SignalingProvider}
 */
export class BroadcastSignaling {
  /** @param {{BroadcastChannelImpl?: typeof BroadcastChannel, random?: () => number, joinTimeoutMs?: number, prefix?: string}} [o] */
  constructor({ BroadcastChannelImpl = globalThis.BroadcastChannel, random = Math.random, joinTimeoutMs = 1500, prefix = 'engine-rtc' } = {}) {
    if (!BroadcastChannelImpl) throw new Error('no BroadcastChannel available');
    this.BC = BroadcastChannelImpl; this.random = random; this.joinTimeoutMs = joinTimeoutMs; this.prefix = prefix;
  }

  async host({ room, maxPeers = 16 } = {}) {
    const code = room ?? makeRoomCode(5, this.random);
    if (!isRoomCode(code)) throw new Error('a room code is letters and digits, 3 to 16 of them');
    const bc = new this.BC(`${this.prefix}:${code}`), peers = new Set();
    // is there already a host? ask, and wait briefly for an answer
    const taken = await new Promise((resolve) => {
      const probe = new this.BC(`${this.prefix}:${code}`);
      const timer = setTimeout(() => { probe.close(); resolve(false); }, 120);
      probe.onmessage = (ev) => { if (ev.data?.t === 'here') { clearTimeout(timer); probe.close(); resolve(true); } };
      probe.postMessage({ t: 'who' });
    });
    if (taken) { bc.close(); throw new Error(`room ${code} is taken`); }
    const host = {
      room: code, onClose: null,
      send: (peerId, message) => bc.postMessage({ t: 'msg', to: peerId, from: 'host', data: message }),
      close: () => { bc.postMessage({ t: 'host-bye' }); bc.close(); },
    };
    const firePeer = queuedHandler(host, 'onPeer'), fireLeft = queuedHandler(host, 'onPeerLeft'), fireMessage = queuedHandler(host, 'onMessage');
    bc.onmessage = (ev) => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'who') bc.postMessage({ t: 'here' });
      else if (m.t === 'hello' && typeof m.from === 'string') {
        if (peers.size >= maxPeers && !peers.has(m.from)) { bc.postMessage({ t: 'full', to: m.from }); return; }
        peers.add(m.from); bc.postMessage({ t: 'welcome', to: m.from }); firePeer(m.from);
      } else if (m.t === 'msg' && m.to === 'host' && peers.has(m.from)) fireMessage(m.from, m.data);
      else if (m.t === 'bye' && peers.delete(m.from)) fireLeft(m.from);
    };
    return host;
  }

  async join(room) {
    const bc = new this.BC(`${this.prefix}:${String(room).toUpperCase()}`);
    const peerId = `t${Math.floor(this.random() * 1e9).toString(36)}`;
    const peer = {
      room, peerId, onClose: null,
      send: (message) => bc.postMessage({ t: 'msg', to: 'host', from: peerId, data: message }),
      close: () => { bc.postMessage({ t: 'bye', from: peerId }); bc.close(); },
    };
    const fire = queuedHandler(peer, 'onMessage');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { bc.close(); reject(new Error(`no room ${room}`)); }, this.joinTimeoutMs);
      bc.onmessage = (ev) => {
        const m = ev.data;
        if (!m || typeof m !== 'object') return;
        if (m.t === 'welcome' && m.to === peerId) { clearTimeout(timer); resolve(); }
        else if (m.t === 'full' && m.to === peerId) { clearTimeout(timer); bc.close(); reject(new Error(`room ${room} is full`)); }
        else if (m.t === 'msg' && m.to === peerId) fire(m.data);
        else if (m.t === 'host-bye') { peer.onClose?.(); bc.close(); }
      };
      bc.postMessage({ t: 'hello', from: peerId });
    });
    return peer;
  }
}

const enc = new TextEncoder(), dec = new TextDecoder();
const frame = (obj) => enc.encode(JSON.stringify(obj));

/**
 * Rooms on a signalling server (`createSignalingServer` in `@engine/transport/node`, which you run yourself): it only introduces peers and relays their handshake messages; the game
 * itself never passes through it. `list()` shows the public rooms for a lobby.
 * @implements {SignalingProvider}
 */
export class ServerSignaling {
  /** @param {string} url e.g. `wss://signal.example.com/` @param {{WebSocketImpl?: typeof WebSocket, timeoutMs?: number}} [o] */
  constructor(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 8000 } = {}) { this.url = url; this.WebSocketImpl = WebSocketImpl; this.timeoutMs = timeoutMs; }

  #open() {
    const t = connectWebSocket(this.url, { WebSocketImpl: this.WebSocketImpl });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { t.close('timed out'); reject(new Error('the signalling server did not answer')); }, this.timeoutMs);
      t.onOpen = () => { clearTimeout(timer); resolve(t); };
      t.onClose = (reason) => { clearTimeout(timer); reject(new Error(`could not reach the signalling server (${reason})`)); };
    });
  }

  /** Wait for a message of this kind (or an error) on a transport. Whatever arrives right behind it, before the caller can set up its own handler, is kept in `rest`. */
  #expect(t, kind) {
    return new Promise((resolve, reject) => {
      const rest = [];
      let found = false;
      const timer = setTimeout(() => { t.close('timed out'); reject(new Error('the signalling server did not answer')); }, this.timeoutMs);
      t.onMessage = (bytes) => {
        if (found) { rest.push(bytes); return; }
        let m; try { m = JSON.parse(dec.decode(bytes)); } catch { return; }
        if (m.t === kind) { clearTimeout(timer); found = true; resolve({ m, rest }); } else if (m.t === 'error') { clearTimeout(timer); reject(new Error(m.reason ?? 'refused')); t.close('refused'); }
      };
      t.onClose = (reason) => { clearTimeout(timer); reject(new Error(`signalling connection closed (${reason})`)); };
    });
  }

  async host({ room, maxPeers = 16, isPublic = false, name = '' } = {}) {
    const t = await this.#open();
    t.send(frame({ t: 'host', room, max: maxPeers, public: isPublic, name }));
    const { m: hosted, rest } = await this.#expect(t, 'hosted');
    const host = {
      room: hosted.room, onClose: null,
      send: (peerId, message) => t.send(frame({ t: 'signal', to: peerId, data: message })),
      close: () => t.close('room closed'),
    };
    const firePeer = queuedHandler(host, 'onPeer'), fireLeft = queuedHandler(host, 'onPeerLeft'), fireMessage = queuedHandler(host, 'onMessage');
    const dispatch = (bytes) => {
      let m; try { m = JSON.parse(dec.decode(bytes)); } catch { return; }
      if (m.t === 'peer') firePeer(m.id); else if (m.t === 'left') fireLeft(m.id); else if (m.t === 'signal') fireMessage(m.from, m.data);
    };
    t.onMessage = dispatch;
    for (const b of rest) dispatch(b);
    t.onClose = () => host.onClose?.();
    return host;
  }

  async join(room) {
    const t = await this.#open();
    t.send(frame({ t: 'join', room }));
    const { m: joined, rest } = await this.#expect(t, 'joined');
    const peer = {
      room: joined.room, peerId: joined.id, onClose: null,
      send: (message) => t.send(frame({ t: 'signal', to: 'host', data: message })),
      close: () => t.close('left'),
    };
    const fire = queuedHandler(peer, 'onMessage');
    const dispatch = (bytes) => {
      let m; try { m = JSON.parse(dec.decode(bytes)); } catch { return; }
      if (m.t === 'signal') fire(m.data);
    };
    t.onMessage = dispatch;
    for (const b of rest) dispatch(b);
    t.onClose = () => peer.onClose?.();
    return peer;
  }

  /** The public rooms on the server: `[{ room, name, peers, max }]`. */
  async list() {
    const t = await this.#open();
    t.send(frame({ t: 'list' }));
    const { m: r } = await this.#expect(t, 'rooms');
    t.close('done');
    return r.rooms;
  }
}

/** A provider for a signalling server. @param {string} url @param {ConstructorParameters<typeof ServerSignaling>[1]} [options] */
export const connectSignalingServer = (url, options) => new ServerSignaling(url, options);
