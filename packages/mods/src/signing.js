// Optional provenance: Ed25519 signatures over a bundle's hash. Node only.
// A signature says WHO published a bundle, not that it is safe: the sandbox is what limits damage.
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from 'node:crypto';

/** SPKI prefix of an Ed25519 public key (the raw key is the last 32 bytes). */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Make an Ed25519 key pair for signing mod bundles.
 *
 * @returns {{publicKey: string, privateKey: string}} Raw public key as hex; private key as PKCS8 PEM.
 */
export function generateSigningKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return { publicKey: spki.subarray(spki.length - 32).toString('hex'), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

/**
 * Sign a bundle hash.
 * @param {string} bundleHash hex
 * @param {{publicKey: string, privateKey: string}} key
 * @returns {{key: string, sig: string}}
 */
export function signHash(bundleHash, key) {
  const sig = sign(null, Buffer.from(bundleHash, 'utf8'), createPrivateKey(key.privateKey));
  return { key: key.publicKey, sig: sig.toString('hex') };
}

/**
 * Check a bundle signature: true only for a well-formed, valid signature over exactly this hash. A signature says who
 * published a bundle, not that it is safe.
 *
 * @param {string} bundleHash
 * @param {{key: string, sig: string} | null | undefined} signature
 * @returns {boolean} True only for a well-formed, valid signature.
 */

export function verifySignature(bundleHash, signature) {
  if (!signature || typeof signature.key !== 'string' || typeof signature.sig !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(signature.key) || !/^[0-9a-f]{128}$/.test(signature.sig)) return false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(signature.key, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(bundleHash, 'utf8'), pub, Buffer.from(signature.sig, 'hex'));
  } catch {
    return false;
  }
}
