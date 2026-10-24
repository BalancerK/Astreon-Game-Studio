/**
 * @typedef {Object} NetEntry
 * @property {{name: string, fields: string[]}} component A core component.
 * @property {Record<string, import('./codecs.js').Codec>} codecs Replicated fields and how to encode each.
 */

/** FNV-1a, 32-bit. @param {string} s */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The agreed list of replicated components and fields. Client and server must
 * build the identical schema; `hash` is compared in the handshake. Component
 * position in the list is its wire id (max 32), field order is its wire order.
 */
export class NetSchema {
  /** @param {NetEntry[]} entries */
  constructor(entries) {
    if (entries.length > 32) throw new RangeError('at most 32 replicated components');
    let col = 0;
    this.comps = entries.map((e, bit) => {
      const names = Object.keys(e.codecs);
      if (names.length > 32) throw new RangeError(`${e.component.name}: at most 32 replicated fields`);
      for (const n of names) {
        if (!e.component.fields.includes(n)) throw new Error(`${e.component.name} has no field "${n}"`);
      }
      return {
        component: e.component,
        bit,
        fields: names.map((name) => ({ name, codec: e.codecs[name], col: col++ })),
      };
    });
    /** Total replicated fields across components (row width). */
    this.fieldCount = col;
    const description = this.comps
      .map((c) => `${c.component.name}{${c.fields.map((f) => `${f.name}:${f.codec.name}`).join(',')}}`)
      .join(';');
    this.hash = fnv1a(description);
  }
}
