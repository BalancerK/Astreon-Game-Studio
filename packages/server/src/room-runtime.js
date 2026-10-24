// The room side of the gateway <-> room protocol, independent of what carries the messages (a worker thread's
// port or a child process's IPC channel). Not imported by games; `room-worker.js` and `room-process.js` use it.
//
// Gateway -> room messages:  {t:'open', id}  {t:'msg', id, ch, data}  {t:'close', id, reason}  {t:'control', data}  {t:'stop'}
// Room -> gateway messages:  {t:'ready'}  {t:'send', id, ch, data}  {t:'close', id, reason}  {t:'stats', stats}  {t:'fatal', error}  {t:'stopped'}
import { CHANNEL, createStats } from '../../transport/src/index.js';

/** A client as the room sees it: the normal Transport contract, carried over the message channel. */
class RemoteConnection {
  constructor(id, send) {
    this.id = id;
    this.send_ = send;
    this.state = 'open';
    this.onMessage = null;
    this.onClose = null;
    this.stats = createStats();
  }

  send(bytes, channel = CHANNEL.RELIABLE) {
    if (this.state !== 'open') return false;
    const copy = new Uint8Array(bytes); // own buffer so it can be transferred (Buffer#slice is only a view, so copy explicitly)
    this.stats.sentMessages++;
    this.stats.sentBytes += copy.length;
    this.send_({ t: 'send', id: this.id, ch: channel, data: copy }, [copy.buffer]);
    return true;
  }

  close(reason = 'closed') {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.send_({ t: 'close', id: this.id, reason });
    this.onClose?.(reason);
  }

  _deliver(bytes, channel) {
    if (this.state !== 'open') return;
    this.stats.receivedMessages++;
    this.stats.receivedBytes += bytes.length;
    this.onMessage?.(bytes, channel);
  }

  _remoteClosed(reason) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.onClose?.(reason);
  }
}

/**
 * Start hosting a room. Returns the function that must be called with every message from the gateway
 * (messages that arrive while the room is still starting are held and replayed in order).
 *
 * @param {object} o
 * @param {string} o.module Room module URL (exports `createRoom(options)`).
 * @param {object} [o.options]
 * @param {(message: object, transfer?: ArrayBuffer[]) => void} o.send Deliver a message to the gateway.
 * @param {(code: number) => void} o.exit End this thread or process.
 * @param {() => object} [o.extraStats] Added to every stats report (e.g. process memory).
 * @returns {(message: any) => Promise<void>}
 */
export function startRoomRuntime({ module, options = {}, send, exit, extraStats }) {
  const connections = new Map();
  let room = null;
  const held = [];

  const handle = async (m) => {
    if (!room) { held.push(m); return; }
    switch (m.t) {
      case 'open': {
        const conn = new RemoteConnection(m.id, send);
        connections.set(m.id, conn);
        room.attach(conn);
        break;
      }
      case 'msg':
        connections.get(m.id)?._deliver(new Uint8Array(m.data), m.ch);
        break;
      case 'close': {
        const conn = connections.get(m.id);
        connections.delete(m.id);
        conn?._remoteClosed(m.reason);
        break;
      }
      case 'control':
        room.control?.(m.data);
        break;
      case 'stop':
        try { await room.close?.(); } finally { send({ t: 'stopped' }); exit(0); }
        break;
      default:
        break;
    }
  };

  (async () => {
    try {
      const mod = await import(module);
      if (typeof mod.createRoom !== 'function') throw new Error(`room module ${module} must export createRoom(options)`);
      room = await mod.createRoom(options);
    } catch (e) {
      send({ t: 'fatal', error: String(e && e.stack ? e.stack : e) });
      exit(1);
      return;
    }
    const statsTimer = setInterval(() => {
      try { send({ t: 'stats', stats: { ...(room.stats?.() ?? {}), ...(extraStats?.() ?? {}) } }); } catch { /* the room may be mid-shutdown */ }
    }, 250);
    statsTimer.unref();
    send({ t: 'ready' });
    for (const m of held.splice(0)) await handle(m);
  })();

  return handle;
}
