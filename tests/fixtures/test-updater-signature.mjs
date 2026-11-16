// Ephemeral test-only Minisign-compatible signatures. No private key is
// persisted or used in releases. Production signing always uses Tauri CLI.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export function testSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const id = randomBytes(8);
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const pubPacket = Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64');
  const encodedPublicKey = Buffer.from(`untrusted comment: test-only public key\n${pubPacket}\n`).toString('base64');
  return {
    publicKey: encodedPublicKey,
    sign(data, version, filename) {
      const digest = createHash('blake2b512').update(data).digest();
      const signature = sign(null, digest, privateKey);
      const packet = Buffer.concat([Buffer.from('ED'), id, signature]).toString('base64');
      const comment = `timestamp:1\tfile:${filename}\tversion:${version}`;
      const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString('base64');
      return Buffer.from(`untrusted comment: test-only signature\n${packet}\ntrusted comment: ${comment}\n${global}\n`).toString('base64');
    },
  };
}
