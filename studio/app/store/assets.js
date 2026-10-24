// Your own pictures and sounds in a project: which files are accepted, what they are called inside the project, and the checks that keep a wrong or hostile file
// out. A file is accepted by what it IS (its first bytes), not only by its name. Pure functions, tested in Node.

export const ASSET_DIR = 'assets/';
export const LIMITS = { image: 2_000_000, sound: 5_000_000, count: 60 };

const TYPES = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  wav: { kind: 'sound', mime: 'audio/wav' },
  mp3: { kind: 'sound', mime: 'audio/mpeg' },
  ogg: { kind: 'sound', mime: 'audio/ogg' },
};
// an SVG is accepted too: it is turned into a PNG (core/import-svg.js)
export const ACCEPT = [...Object.keys(TYPES), 'svg'].map((e) => `.${e}`).join(',');

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));

/** Do the first bytes say this is really a file of that extension? */
export function sniff(ext, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return false;
  switch (ext) {
    case 'png': return bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG';
    case 'jpg': case 'jpeg': return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'gif': return ascii(bytes, 0, 4) === 'GIF8';
    case 'webp': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
    case 'wav': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE';
    case 'mp3': return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'ogg': return ascii(bytes, 0, 4) === 'OggS';
    default: return false;
  }
}

/** A file name made safe for the assets folder: letters, numbers, spaces, dots, dashes and underscores. */
export function safeName(name) {
  const base = String(name).split(/[\\/]/).pop().normalize('NFKD').replace(/[^\w .-]+/g, '').replace(/^[ .-]+/, '').replace(/\s+/g, ' ').trim();
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).slice(0, 60).replace(/[ .-]+$/, '');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().slice(0, 5) : '';
  return stem && ext ? `${stem}.${ext}` : '';
}

/**
 * Decide what to do with one file the person chose.
 * @param {string} name the file's name on their computer
 * @param {Uint8Array} bytes
 * @param {(path: string) => boolean} taken is a path already in the project
 * @returns {{ok: true, path: string, kind: 'image' | 'sound', mime: string} | {ok: false, reason: string}}
 */
export function accept(name, bytes, taken = () => false) {
  const clean = safeName(name);
  if (!clean) return { ok: false, reason: `"${String(name).slice(0, 40)}" has no usable name.` };
  const ext = clean.slice(clean.lastIndexOf('.') + 1);
  const type = TYPES[ext];
  if (!type) return { ok: false, reason: `"${clean}": pictures (png, jpg, gif, webp, svg) and sounds (wav, mp3, ogg) can be imported.` };
  if (bytes.length > LIMITS[type.kind]) {
    const size = `${(bytes.length / 1e6).toFixed(1)} MB`;
    return { ok: false, reason: `"${clean}" is too big (${size}; a ${type.kind} can be up to ${LIMITS[type.kind] / 1e6} MB).` };
  }
  if (!sniff(ext, bytes)) return { ok: false, reason: `"${clean}" is not really a ${ext} file.` };
  let path = `${ASSET_DIR}${clean}`;
  const stem = clean.slice(0, clean.lastIndexOf('.'));
  for (let n = 2; taken(path); n++) path = `${ASSET_DIR}${stem}-${n}.${ext}`;
  return { ok: true, path, kind: type.kind, mime: type.mime };
}

/** What kind of asset is a project path, or null. */
export function assetKind(path) {
  if (!path.startsWith(ASSET_DIR)) return null;
  return TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]?.kind ?? null;
}

/** Does the name say a picture or a sound (wherever it is)? */
export const looksLikeAsset = (name) => !!TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];

export const mimeOf = (path) => TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]?.mime ?? 'application/octet-stream';

/** A quick fingerprint of some bytes, to tell whether a picture changed. */
export function fingerprint(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return `${bytes.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/**
 * The assets of a project as the game's page needs them.
 * @param {{list(): string[], read(p: string): string | Uint8Array | undefined}} project
 * @returns {{path: string, kind: 'image' | 'sound', mime: string, hash: string, bytes: Uint8Array}[]}
 */
export function assetsOf(project) {
  const out = [];
  for (const path of project.list()) {
    const kind = assetKind(path);
    const bytes = project.read(path);
    if (kind && bytes instanceof Uint8Array) out.push({ path, kind, mime: mimeOf(path), hash: fingerprint(bytes), bytes });
  }
  return out;
}
