// Zip files, with no dependencies: a project is exported as one (so it can be kept, sent, or opened in any other tool) and imported from one.
// Writing stores files uncompressed (project files are small text); reading also understands the common "deflate" method, and refuses anything unsafe:
// paths that climb out of the project, encrypted or unsupported entries, damaged data, and archives that expand into far more than they say.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 checksum of some bytes (what zip files use to detect damage). */
export function crc32(bytes, start = 0xffffffff) {
  let c = start;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The name of a zip entry is safe if it stays inside the project: relative, no `..`, no backslashes or control characters. */
export function safeEntryName(name) {
  const unsafe = !name || name.length > 240 || name.startsWith('/') || name.includes('\\') || /[\u0000-\u001f]/.test(name) || /^[A-Za-z]:/.test(name);
  if (unsafe) return false;
  return name.split('/').every((part, i, all) => (part !== '' || i === all.length - 1) && part !== '.' && part !== '..');
}

/**
 * Make a zip file.
 * @param {Record<string, string | Uint8Array>} files path -> content
 * @param {{date?: Date}} [o] the modification time written for every file (default: 1 January 2000, so the same project always gives the same bytes)
 * @returns {Uint8Array}
 */
export function writeZip(files, { date = new Date(Date.UTC(2000, 0, 1)) } = {}) {
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!safeEntryName(path)) throw new Error(`"${path}" is not a safe file name for a zip`);
    const name = encoder.encode(path);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);   // bit 11: the name is UTF-8
    local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, SIG_CENTRAL, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true); central.setUint16(12, dosTime, true); central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true); central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const count = Object.keys(files).length;
  const centralSize = centrals.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_END, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function inflate(compressed, limit) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new Error('a file in the zip expands to more than it should: it was refused'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Read a zip file.
 * @param {Uint8Array} bytes
 * @param {{maxEntries?: number, maxEntryBytes?: number, maxTotalBytes?: number}} [o]
 * @returns {Promise<Map<string, Uint8Array>>} path -> content (folders are left out)
 */
export async function readZip(bytes, { maxEntries = 1000, maxEntryBytes = 8 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024 } = {}) {
  if (bytes.length < 22) throw new Error('this is not a zip file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (view.getUint32(i, true) === SIG_END) { end = i; break; }
  if (end < 0) throw new Error('this is not a zip file (no end record)');
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new Error('zip64 files are not supported');
  if (count > maxEntries) throw new Error(`the zip has ${count} files; at most ${maxEntries} are allowed`);
  const out = new Map();
  let total = 0;
  let at = centralOffset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG_CENTRAL) throw new Error('the zip is damaged (bad directory)');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    let name;
    try {
      name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new Error('a file name in the zip is not valid text');
    }
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;                                                       // a folder: nothing to keep
    if (!safeEntryName(name)) throw new Error(`the zip contains an unsafe path: "${name}"`);
    if (out.has(name)) throw new Error(`the zip lists "${name}" twice`);
    if (flags & 1) throw new Error(`"${name}" is encrypted, which is not supported`);
    if (size > maxEntryBytes) throw new Error(`"${name}" is larger than ${maxEntryBytes} bytes`);
    total += size;
    if (total > maxTotalBytes) throw new Error('the zip holds more than the allowed total size');
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`the zip is damaged (bad entry for "${name}")`);
    }
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) throw new Error(`the zip is damaged (cut short in "${name}")`);
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw, Math.max(size, 0) + 1);
    else throw new Error(`"${name}" uses a compression method (${method}) that is not supported`);
    if (data.length !== size) throw new Error(`"${name}" is damaged (wrong size)`);
    if (crc32(data) !== crc) throw new Error(`"${name}" is damaged (checksum mismatch)`);
    out.set(name, data);
  }
  return out;
}
