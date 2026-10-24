import { canonicalJson, sha256Hex, sha256HexSync } from './hash.js';
import { validateManifest } from './manifest.js';

/**
 * A bundle is a manifest plus its files as text, plus an optional signature. The hash covers the manifest and
 * all files, so it identifies exactly what will run. The *client view* is the data clients need (`rules` and
 * `client`); it has its own hash, which the server advertises and clients verify before playing.
 *
 * @typedef {Object} Bundle
 * @property {import('./manifest.js').ModManifest} manifest
 * @property {Record<string, string>} files path -> text (the entry script, extra data files)
 * @property {{key: string, sig: string} | null} [signature] Ed25519: raw public key (hex) and signature over the bundle hash (hex).
 */

export const BUNDLE_LIMITS = Object.freeze({ files: 16, fileBytes: 128 * 1024, totalBytes: 256 * 1024 });

/** Canonical text of everything that defines what the bundle does (not the signature). */
export function bundleText(bundle) {
  return canonicalJson({ manifest: bundle.manifest, files: bundle.files });
}

/**
 * The SHA-256 of a whole bundle (manifest and files, in a canonical form): what a signature covers.
 *
 * @param {Bundle} bundle
 * @returns {string} SHA-256 hex of the bundle.
 */
export function hashBundle(bundle) {
  return sha256HexSync(bundleText(bundle));
}

/** What a client needs: ids, versions and the data to apply. No scripts. */
export function clientView(bundle) {
  const { id, version, rules = {}, client = {} } = bundle.manifest;
  return { id, version, rules, client };
}

/**
 * The SHA-256 of a bundle's client view: the hash a server advertises so clients can check what they download.
 *
 * @param {Bundle} bundle
 * @returns {string} The hash advertised to clients.
 */
export function hashClientView(bundle) {
  return sha256HexSync(canonicalJson(clientView(bundle)));
}

/**
 * Check a downloaded client view against the hash the server advertised. Uses native SHA-256 when available.
 * @param {any} view
 * @param {string} expectedHash
 */
export async function verifyClientView(view, expectedHash) {
  let text;
  try { text = canonicalJson(view); } catch { return false; }
  return (await sha256Hex(text)) === expectedHash;
}

/**
 * Validate structure and sizes. Returns problems rather than throwing, so tools can list all of them.
 * @param {any} bundle
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return { ok: false, errors: ['bundle must be an object'] };
  const m = validateManifest(bundle.manifest);
  const errors = [...m.errors];
  const files = bundle.files;
  if (files === null || typeof files !== 'object' || Array.isArray(files)) errors.push('files must be an object of path -> text');
  else {
    const names = Object.keys(files);
    if (names.length > BUNDLE_LIMITS.files) errors.push(`at most ${BUNDLE_LIMITS.files} files`);
    let total = 0;
    for (const name of names) {
      const text = files[name];
      if (typeof text !== 'string') { errors.push(`file "${name}" must be text`); continue; }
      if (text.length > BUNDLE_LIMITS.fileBytes) errors.push(`file "${name}" is too large (${text.length} > ${BUNDLE_LIMITS.fileBytes})`);
      total += text.length;
    }
    if (total > BUNDLE_LIMITS.totalBytes) errors.push(`bundle is too large (${total} > ${BUNDLE_LIMITS.totalBytes} bytes)`);
    if (m.ok && m.manifest.tier === 'script') {
      if (!(m.manifest.entry in files)) errors.push(`entry "${m.manifest.entry}" is not among the bundle files`);
    }
    if (m.ok && m.manifest.tier === 'data' && names.length > 0) errors.push('a data mod must not contain script files');
  }
  return { ok: errors.length === 0, errors };
}
