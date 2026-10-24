// The save file: a JSON envelope with the game's name and version, when it was saved, a few facts for the load screen, the sections each
// subsystem wrote (each with its own version), and a checksum so a half-written or damaged file is noticed instead of loaded.

/** The `format` field of every save file (`"engine-save"`). */
export const FORMAT = 'engine-save';
/** The version of the save file envelope this code writes and reads. */
export const FORMAT_VERSION = 1;

/** A failure with a code the game can act on: 'missing', 'corrupt', 'newer', 'game', 'migration', 'section', 'apply', 'storage'. */
export class SaveError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'SaveError'; this.code = code; if (cause) this.cause = cause; }
}

/** Two FNV-1a hashes with different seeds, as 16 hex digits: catches truncation and damage (it is not a defence against someone editing the file on purpose). */
export function checksum(text) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
    b ^= b >>> 13;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const body = (file) => { const { sum, ...rest } = file; return JSON.stringify(rest); };

async function pipe(stream, data) {
  const w = stream.writable.getWriter();
  (async () => { await w.write(data); await w.close(); })().catch(() => {}); // a damaged input fails the read below; this must not become an unhandled rejection
  const chunks = [];
  const r = stream.readable.getReader();
  for (;;) { const { value, done } = await r.read(); if (done) break; chunks.push(value); }
  let n = 0; for (const c of chunks) n += c.length;
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const toBase64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Seal a file object: add the checksum, and (with `compress`) gzip it into text prefixed `gz:`. @returns {Promise<string>} */
export async function encode(file, { compress = false } = {}) {
  const sealed = { ...file, sum: checksum(body(file)) };
  const text = JSON.stringify(sealed);
  if (!compress || typeof CompressionStream === 'undefined') return text;
  return `gz:${toBase64(await pipe(new CompressionStream('gzip'), new TextEncoder().encode(text)))}`;
}

/** Read and verify saved text. @returns {Promise<any>} the file object */
export async function decode(text) {
  let json = text;
  try {
    if (text.startsWith('gz:')) {
      if (typeof DecompressionStream === 'undefined') throw new SaveError('corrupt', 'this save is compressed and this environment cannot decompress it');
      json = new TextDecoder().decode(await pipe(new DecompressionStream('gzip'), fromBase64(text.slice(3))));
    }
    const file = JSON.parse(json);
    if (file?.format !== FORMAT) throw new SaveError('corrupt', 'not a save file');
    if (file.formatVersion > FORMAT_VERSION) throw new SaveError('newer', `this save uses file format ${file.formatVersion}; this engine reads up to ${FORMAT_VERSION}`);
    if (file.sum !== checksum(body(file))) throw new SaveError('corrupt', 'the checksum does not match: the file is damaged or incomplete');
    return file;
  } catch (e) {
    if (e instanceof SaveError) throw e;
    throw new SaveError('corrupt', `the save could not be read (${e.message})`, e);
  }
}
