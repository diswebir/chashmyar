// Tauri's public key and .sig files are base64-encoded Minisign text.  This
// independently verifies BOTH Ed25519 signatures and the signed version before
// a Release can be staged or published. It never reads a private key.
import { createHash, createPublicKey, verify } from 'node:crypto';

function decode64(value, what) {
  const s = String(value ?? '').trim();
  if (!s || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) {
    throw new Error(`Invalid ${what} base64`);
  }
  const b = Buffer.from(s, 'base64');
  if (b.toString('base64') !== s) throw new Error(`Non-canonical ${what} base64`);
  return b;
}
function decodeText(value, what) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(decode64(value, what)); }
  catch (e) { throw new Error(`Invalid ${what}: ${e.message}`); }
}
function linesOf(text) { return text.replace(/\r\n/g, '\n').trimEnd().split('\n'); }

export function parsePublicKey(encoded) {
  const lines = linesOf(decodeText(encoded, 'updater public key'));
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) throw new Error('Invalid Minisign public key');
  const raw = decode64(lines[1], 'Minisign public key');
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== 'Ed') throw new Error('Unsupported Minisign public key');
  // RFC 8410 SubjectPublicKeyInfo prefix for a raw Ed25519 public key.
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw.subarray(10)]);
  return { id: raw.subarray(2, 10), key: createPublicKey({ key: der, format: 'der', type: 'spki' }) };
}

export function verifyTauriSignature(data, encodedSignature, encodedPublicKey, version, filename) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !filename || /[\t\r\n/\\]/.test(filename)) throw new Error('Invalid version or filename');
  const publicKey = parsePublicKey(encodedPublicKey);
  const lines = linesOf(decodeText(encodedSignature, 'updater signature'));
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) {
    throw new Error('Invalid Minisign signature text');
  }
  const sig = decode64(lines[1], 'signature packet');
  const globalSig = decode64(lines[3], 'global signature');
  if (sig.length !== 74 || globalSig.length !== 64 || sig.subarray(0, 2).toString() !== 'ED') {
    throw new Error('Expected a modern prehashed Minisign signature');
  }
  if (!sig.subarray(2, 10).equals(publicKey.id)) throw new Error('Signing key does not match the embedded public key');
  const signed = sig.subarray(10);
  const digest = createHash('blake2b512').update(data).digest();
  if (!verify(null, digest, publicKey.key, signed)) throw new Error('Artifact signature is invalid');
  const comment = lines[2].slice('trusted comment: '.length);
  if (!verify(null, Buffer.concat([signed, Buffer.from(comment, 'utf8')]), publicKey.key, globalSig)) {
    throw new Error('Trusted comment signature is invalid');
  }
  const fields = comment.split('\t');
  const versions = fields.filter((s) => s.startsWith('version:'));
  const filenames = fields.filter((s) => s.startsWith('file:'));
  if (versions.length !== 1 || versions[0] !== `version:${version}`) throw new Error('Signed version does not match the Release');
  if (filenames.length !== 1 || filenames[0] !== `file:${filename}`) throw new Error('Signed filename does not match the Release asset');
}
