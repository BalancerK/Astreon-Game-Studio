// Playing together with no server at all: the host makes a code, a friend pastes it and gets a code back, the host pastes that, and the two browsers are connected.
// The codes are long (they hold the whole handshake), so send them as text in a chat or an email, or show them as a QR code.
import { Negotiation } from './negotiate.js';

const PREFIX = 'ENGINE1.';
const MAX_CODE_CHARS = 24_000;

const toBase64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));
const fromBase64 = (s) => (typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'));

/** Pack a handshake into a code you can paste. @param {'offer' | 'answer'} kind @param {string} sdp */
export function encodeCode(kind, sdp) { return PREFIX + toBase64(JSON.stringify({ k: kind, sdp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/** Unpack a code. Throws an `Error` that says what is wrong with it. @param {string} code @param {'offer' | 'answer'} kind @returns {string} The handshake text. */
export function decodeCode(code, kind) {
  const text = String(code ?? '').trim().replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) throw new Error('that is not an invitation code (it should start with ENGINE1.)');
  if (text.length > MAX_CODE_CHARS) throw new Error('that code is too long to be an invitation');
  let obj;
  try { obj = JSON.parse(fromBase64(text.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new Error('that code is damaged (was it cut short when it was copied?)'); }
  if (!obj || typeof obj.sdp !== 'string' || !obj.sdp.startsWith('v=0')) throw new Error('that code does not hold a connection');
  if (obj.k !== kind) throw new Error(kind === 'offer' ? 'that is an answer code: paste it on the host\'s side' : 'that is an invitation: friends paste it on their side to get an answer code');
  return obj.sdp;
}

/**
 * Host side, step one: make an invitation. Send `code` to a friend; when they send back their answer code, give it to `accept`, which resolves with the open `Transport`.
 * One invitation connects one friend; make another for the next. Everything (every network candidate) is inside the code, so it takes a few seconds to make.
 * @param {import('./negotiate.js').RtcOptions} [options]
 * @returns {Promise<{code: string, accept: (answerCode: string) => Promise<import('./transport.js').RtcTransport>, cancel: () => void, transport: Promise<import('./transport.js').RtcTransport>}>}
 */
export async function createInvitation(options = {}) {
  let offered;
  const offer = new Promise((resolve) => { offered = resolve; });
  const n = new Negotiation({ offerer: true, send: (m) => offered(m), options: { connectTimeoutMs: 600_000, ...options, trickle: false } });   // people take minutes to paste codes
  n.start();
  const first = await Promise.race([offer, n.transport.then(() => null, (e) => { throw e; })]);
  if (!first) throw new Error('the invitation was not made');
  return {
    code: encodeCode('offer', first.sdp),
    accept: async (answerCode) => { await n.receive({ t: 'answer', sdp: decodeCode(answerCode, 'answer') }); return n.transport; },
    cancel: () => n.cancel('invitation cancelled'),
    transport: n.transport,
  };
}

/**
 * Friend's side: accept an invitation. Send `answer` back to the host; `transport` resolves with the open `Transport` once they have pasted it.
 * @param {string} code The host's invitation. @param {import('./negotiate.js').RtcOptions} [options]
 * @returns {Promise<{answer: string, transport: Promise<import('./transport.js').RtcTransport>, cancel: () => void}>}
 */
export async function acceptInvitation(code, options = {}) {
  const sdp = decodeCode(code, 'offer');
  let answered;
  const answer = new Promise((resolve) => { answered = resolve; });
  const n = new Negotiation({ offerer: false, send: (m) => answered(m), options: { connectTimeoutMs: 600_000, ...options, trickle: false } });
  await n.receive({ t: 'offer', sdp });
  const m = await Promise.race([answer, n.transport.then(() => null, (e) => { throw e; })]);
  if (!m) throw new Error('the invitation was not accepted');
  return { answer: encodeCode('answer', m.sdp), transport: n.transport, cancel: () => n.cancel('invitation cancelled') };
}
