// Certificates for WebTransport servers, Node only. A page can only open a WebTransport session to a server whose certificate it trusts: either an ordinary one from a certificate authority, or (for a
// game server with no domain of its own) a self-signed one whose SHA-256 hash the page is told, as long as it is valid for at most 14 days and uses an elliptic curve key. This makes such a certificate
// with the `openssl` program (present on Linux and macOS, and with Git on Windows) and gives its hash.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';

/** The longest a browser accepts a certificate trusted by hash: fourteen days. */
export const MAX_HASH_CERT_DAYS = 14;

/**
 * The SHA-256 hash of a certificate, as base64: what a page passes as `certificateHashes`.
 * @param {string | Buffer} cert a PEM text, or the DER bytes
 * @returns {string}
 */
export function certificateHash(cert) {
  const der = typeof cert === 'string' ? new X509Certificate(cert).raw : cert;
  return createHash('sha256').update(der).digest('base64');
}

/**
 * Make a self-signed certificate and key that a page can trust by its hash.
 * @param {{hosts?: string[], days?: number, openssl?: string}} [o] `hosts` are the names and addresses the server is reached by (an address is recognised by its shape); `days` is at most 13
 * @returns {{cert: string, privKey: string, hash: string, notBefore: Date, notAfter: Date, hosts: string[]}}
 */
export function createSelfSignedCert({ hosts = ['localhost', '127.0.0.1'], days = 13, openssl = 'openssl' } = {}) {
  if (!(days >= 1 && days < MAX_HASH_CERT_DAYS)) throw new RangeError(`a certificate trusted by hash may last at most ${MAX_HASH_CERT_DAYS - 1} days`);
  const isAddress = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');
  const san = hosts.map((h) => `${isAddress(h) ? 'IP' : 'DNS'}:${h}`).join(',');
  const dir = mkdtempSync(join(tmpdir(), 'wt-cert-'));
  try {
    execFileSync(openssl, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-days', String(days), '-subj', `/CN=${hosts[0]}`, '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
    const cert = readFileSync(join(dir, 'cert.pem'), 'utf8'), privKey = readFileSync(join(dir, 'key.pem'), 'utf8');
    const x = new X509Certificate(cert);
    return { cert, privKey, hash: certificateHash(cert), notBefore: new Date(x.validFrom), notAfter: new Date(x.validTo), hosts };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
