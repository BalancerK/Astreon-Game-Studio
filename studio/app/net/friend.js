// Playing with a friend, the page's side: the two browsers find each other with a pair of codes (no server, no account, nothing sent anywhere but to the friend), check they have the
// same game, agree when to start, and then pass along the little messages the game's lockstep makes (see the kit's netplay.js). The game itself runs in its own frame; this only carries
// its messages.
//
//   host:   const link = new FriendLink({ fingerprint });  const code = await link.invite();   // send `code` to the friend
//           await link.accept(answerCode);                                                      // the friend sent this back
//   friend: const link = new FriendLink({ fingerprint });  const answer = await link.join(code); // send `answer` back to the host
//   both:   link.on('ready', ({ me, players }) => ...);  link.on('message', ({ from, message }) => ...);  link.send(message);
import { Emitter } from '../util/emitter.js';
import { createInvitation, acceptInvitation, CHANNEL } from '../../../packages/transport/src/index.js';
import { cleanNetMessage } from '../core/runner-protocol.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const MAX_BYTES = 4000;

/** A short fingerprint of a project's files (their names and contents), to tell whether two people have the same game. @param {Record<string, string | Uint8Array>} files */
export function fingerprint(files) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const eat = (text) => {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
  };
  for (const path of Object.keys(files).sort()) {
    eat(path); eat('\0');
    const v = files[path];
    eat(typeof v === 'string' ? v : `bytes:${v?.length ?? 0}:${v?.[0] ?? 0}:${v?.[(v?.length ?? 1) - 1] ?? 0}`);
    eat('\u0001');
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Events: `'code'` (the invitation, for the host to send), `'answer'` (the answer, for the friend to send back), `'connected'` (the two browsers are joined; the game check is next),
 * `'mismatch'` (`{ mine, theirs }`: the friend has a different game), `'ready'` (`{ me, players }`: start the game now), `'message'` (`{ from, message }`),
 * `'closed'` (`reason`). Status is in `state`: 'idle', 'inviting', 'answering', 'connected', 'ready', 'closed'.
 */
export class FriendLink extends Emitter {
  /** @param {{fingerprint?: string, rtc?: object, iceServers?: object[]}} [o] `fingerprint`: of this project (see `fingerprint`); `rtc` and `iceServers`: as for the transport. */
  constructor({ fingerprint: mine = '', rtc, iceServers } = {}) {
    super();
    this.mine = mine; this.options = { ...(rtc ? { rtc } : {}), ...(iceServers ? { iceServers } : {}) };
    /** @type {'idle' | 'inviting' | 'answering' | 'connected' | 'ready' | 'closed'} */ this.state = 'idle';
    /** @type {number | null} 0 for the host, 1 for the friend. */ this.me = null;
    this.transport = null; this.invitation = null; this.held = []; this.released = false; this.peerFingerprint = null;
  }

  /** Host: make the invitation code. @returns {Promise<string>} */
  async invite() {
    if (this.state !== 'idle') throw new Error('this link is already in use');
    this.me = 0; this.state = 'inviting';
    this.invitation = await createInvitation(this.options);
    this.invitation.transport.then((t) => this.#open(t), (e) => this.#close(String(e?.message ?? e)));
    this.emit('code', this.invitation.code);
    return this.invitation.code;
  }

  /** Host: the friend's answer code arrived. Resolves once the two browsers are connected. @param {string} answerCode */
  async accept(answerCode) {
    if (this.state !== 'inviting') throw new Error('make an invitation first');
    await this.invitation.accept(answerCode);
  }

  /** Friend: use the host's invitation code. Resolves with the answer code to send back. @param {string} code @returns {Promise<string>} */
  async join(code) {
    if (this.state !== 'idle') throw new Error('this link is already in use');
    this.me = 1; this.state = 'answering';
    const { answer, transport } = await acceptInvitation(code, this.options);
    transport.then((t) => this.#open(t), (e) => this.#close(String(e?.message ?? e)));
    this.emit('answer', answer);
    return answer;
  }

  #open(t) {
    if (this.state === 'closed') { t.close('closed'); return; }
    this.transport = t; this.state = 'connected';
    t.onMessage = (bytes) => this.#incoming(bytes);
    t.onClose = (why) => this.#close(why);
    this.#raw({ t: 'hello', game: this.mine });
    this.emit('connected');
  }

  #raw(obj) { this.transport?.send(enc.encode(JSON.stringify(obj)), CHANNEL.RELIABLE); }

  #incoming(bytes) {
    if (bytes.length > MAX_BYTES) return;
    let m; try { m = JSON.parse(dec.decode(bytes)); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello' && typeof m.game === 'string' && m.game.length <= 40) {
      this.peerFingerprint = m.game;
      if (m.game !== this.mine) { this.#raw({ t: 'nope', game: this.mine }); this.#mismatch(m.game); return; }
      if (this.me === 0) this.#raw({ t: 'go' });
      return;
    }
    if (m.t === 'nope' && typeof m.game === 'string' && m.game.length <= 40) { this.#mismatch(m.game); return; }
    if (m.t === 'go' && this.me === 1 && this.state === 'connected') { this.#start(); this.#raw({ t: 'started' }); return; }
    if (m.t === 'started' && this.me === 0 && this.state === 'connected') { this.#start(); return; }
    const message = cleanNetMessage(m.m);
    if (m.t === 'game' && message) {
      const item = { from: this.me === 0 ? 1 : 0, message };
      if (this.released) this.emit('message', item); else this.held.push(item);
    }
  }

  #mismatch(theirs) {
    if (this.state === 'closed' || this.differs) return;
    this.differs = true;
    this.emit('mismatch', { mine: this.mine, theirs });
    setTimeout(() => this.close('the two games are different'), 100);                  // a moment, so the friend gets to hear about it too
  }

  #start() {
    this.state = 'ready';
    this.emit('ready', { me: this.me, players: 2 });
  }

  /** Call once the game has started on this computer: messages the friend sent in the meantime are delivered now, then the rest as they come. */
  release() {
    this.released = true;
    const held = this.held; this.held = [];
    for (const item of held) this.emit('message', item);
  }

  /** Send the friend one of the lockstep's messages. @param {object} message */
  send(message) {
    if (this.state !== 'ready' && this.state !== 'connected') return false;
    if (!cleanNetMessage(message)) return false;
    this.#raw({ t: 'game', m: message });
    return true;
  }

  /** Measure the delay to the friend, in milliseconds (null if it cannot be told yet). */
  async delay() { return (await this.transport?.measureRtt?.()) ?? null; }

  #close(reason) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.invitation?.cancel?.();
    this.emit('closed', reason);
  }

  /** Hang up. @param {string} [reason] */
  close(reason = 'closed') {
    const t = this.transport;
    this.#close(reason);
    t?.close(reason);
  }
}
