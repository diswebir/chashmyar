// Cross-check the independent verifier against the locked Tauri CLI with
// disposable test keys, including a password-protected key like the guide.
// No key is used by a release, printed, committed, or kept after the test.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyTauriSignature } from '../scripts/updater-signatures.mjs';

const temp = mkdtempSync(join(tmpdir(), 'chashmyar-test-key-'));
const cli = resolve('node_modules/@tauri-apps/cli/tauri.js');
function run(args, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`Tauri signer failed with status ${result.status}`);
}
try {
  const signatures = [];
  for (const [label, password] of [['empty', ''], ['protected', 'disposable-test-password-only']]) {
    const dir = join(temp, label); mkdirSync(dir);
    const keyPath = join(dir, 'test-only.key');
    // The password argument is a public fixture value only, never a real secret.
    run(['signer', 'generate', '--ci', '--password', password, '--write-keys', keyPath]);
    const privateKey = readFileSync(keyPath, 'utf8');
    const publicKey = readFileSync(`${keyPath}.pub`, 'utf8');
    const name = 'ChashmYar-2.4.7-portable.exe';
    const file = join(dir, name);
    const payload = Buffer.from('disposable test payload');
    writeFileSync(file, payload);
    const env = { TAURI_SIGNING_PRIVATE_KEY: privateKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
    run(['signer', 'sign', file, '--app-version', '2.4.7'], env);
    const signature = readFileSync(`${file}.sig`, 'utf8');
    verifyTauriSignature(payload, signature, publicKey, '2.4.7', name);
    assert.throws(() => verifyTauriSignature(Buffer.from('tampered'), signature, publicKey, '2.4.7', name));
    assert.throws(() => verifyTauriSignature(payload, signature, publicKey, '2.4.8', name));
    assert.throws(() => verifyTauriSignature(payload, signature, publicKey, '2.4.7', 'other.exe'));
    signatures.push({ signature, publicKey, payload, name });
    if (password) {
      const wrong = spawnSync(process.execPath, [cli, 'signer', 'sign', file, '--app-version', '2.4.7'], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, ...env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'wrong-test-password' },
      });
      assert.equal(wrong.error, undefined, 'wrong-password test must finish');
      assert.notEqual(wrong.status, 0, 'wrong password must not sign');
    }
  }
  assert.throws(() => verifyTauriSignature(signatures[0].payload, signatures[0].signature,
    signatures[1].publicKey, '2.4.7', signatures[0].name), 'a different public key must be rejected');
  console.log('PASS: Tauri CLI signatures with empty and protected test keys verified; wrong password/key and altered bytes, version or filename rejected.');
} finally { rmSync(temp, { recursive: true, force: true }); }
