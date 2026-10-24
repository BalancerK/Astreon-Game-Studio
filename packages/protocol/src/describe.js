import { BinaryReader, ProtocolError } from './binary.js';
import { MSG, REJECT, decodeHello, decodeWelcome, decodeReject } from './messages.js';
import { peekSnapshotHeader } from './snapshot.js';

const REJECT_NAMES = Object.fromEntries(Object.entries(REJECT).map(([k, v]) => [v, k]));

/**
 * Human-readable description of one packet, for packet inspectors and logs. Never throws:
 * malformed packets are reported as type `INVALID`.
 *
 * @param {Uint8Array} bytes
 * @returns {{type: string, summary: string, fields: Record<string, any>}}
 */
export function describePacket(bytes) {
  try {
    if (bytes.length === 0) throw new ProtocolError('empty packet');
    const r = new BinaryReader(bytes);
    const type = r.u8();
    switch (type) {
      case MSG.HELLO: {
        const h = decodeHello(new BinaryReader(bytes));
        return { type: 'HELLO', summary: `protocol v${h.version}, schema ${h.schemaHash.toString(16)}`, fields: h };
      }
      case MSG.WELCOME: {
        const w = decodeWelcome(new BinaryReader(bytes));
        return { type: 'WELCOME', summary: `client ${w.clientId}, ${w.tickRate} Hz, server tick ${w.serverTick}, ${w.plugins.length} plugin(s)${w.resumed ? ', RESUMED session' : ''}`, fields: w };
      }
      case MSG.REJECT: {
        const x = decodeReject(new BinaryReader(bytes));
        return { type: 'REJECT', summary: `${REJECT_NAMES[x.reason] ?? x.reason}: ${x.message}`, fields: x };
      }
      case MSG.INPUT: {
        const ackTick = r.varuint(), firstSeq = r.varuint(), count = r.u8();
        const last = firstSeq + Math.max(0, count - 1);
        return { type: 'INPUT', summary: `seq ${firstSeq}${count > 1 ? `..${last}` : ''} (${count}), snapshot ack ${ackTick}`, fields: { ackTick, firstSeq, count } };
      }
      case MSG.SNAPSHOT: {
        const inputAck = r.varuint();
        const s = peekSnapshotHeader(r);
        const detail = s.kind === 'delta' ? `delta vs ${s.baselineTick}, ${s.changed} changed, ${s.removed} removed` : `full, ${s.changed} entities`;
        return { type: 'SNAPSHOT', summary: `tick ${s.tick} ${detail}, input ack ${inputAck}`, fields: { inputAck, ...s } };
      }
      case MSG.EVENT: {
        const kind = r.u8();
        return { type: 'EVENT', summary: `game event ${kind}, ${bytes.length - 2} payload bytes`, fields: { kind } };
      }
      default:
        return { type: 'UNKNOWN', summary: `message type ${type}, ${bytes.length} bytes`, fields: { type } };
    }
  } catch (e) {
    return { type: 'INVALID', summary: e instanceof ProtocolError ? e.message : String(e), fields: {} };
  }
}
