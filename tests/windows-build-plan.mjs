// Verify the release build plan without compiling or producing an executable.
import assert from 'node:assert/strict';
import { makeWindowsBuildPlan } from '../scripts/build-windows.mjs';
import { testSigner } from './fixtures/test-updater-signature.mjs';

const key = testSigner().publicKey.trim();
const env = { CHASHMYAR_UPDATER_PUBLIC_KEY: `\n${key}\r\n`, TAURI_SIGNING_PRIVATE_KEY: 'never-logged-test-only', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'test-password-only' };
assert.throws(() => makeWindowsBuildPlan({}));
assert.throws(() => makeWindowsBuildPlan({ ...env, CHASHMYAR_UPDATER_PUBLIC_KEY: 'invalid' }));
assert.throws(() => makeWindowsBuildPlan({ ...env, TAURI_SIGNING_PRIVATE_KEY: '' }));
const plan = makeWindowsBuildPlan(env);
assert.equal(plan.length, 3);
for (const step of plan) {
  assert.equal(step.env.CHASHMYAR_UPDATER_PUBLIC_KEY, key, 'all subprocesses embed the exact trimmed public key');
  assert.ok(!step.args.join(' ').includes(env.TAURI_SIGNING_PRIVATE_KEY), 'private key is never a command-line argument');
  assert.ok(!step.args.join(' ').includes(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD), 'private-key password is never a command-line argument');
}
const [nsis, portable, collect] = plan;
assert.equal(nsis.env.TAURI_SIGNING_PRIVATE_KEY, env.TAURI_SIGNING_PRIVATE_KEY, 'installer bundling can sign');
for (const step of [portable, collect]) {
  assert.equal(step.env.TAURI_SIGNING_PRIVATE_KEY, undefined, 'unused signing secret is not propagated');
  assert.equal(step.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, undefined, 'unused signing password is not propagated');
}
assert.equal(nsis.cmd, process.execPath);
assert.ok(nsis.args.includes('build') && nsis.args.includes('--bundles') && nsis.args.includes('nsis') && nsis.args.includes('--locked'));
assert.equal(JSON.parse(nsis.args[nsis.args.indexOf('--config') + 1]).plugins.updater.pubkey, key);
assert.equal(portable.cmd, process.execPath, 'portable must use Tauri CLI, not plain Cargo');
assert.ok(portable.args[0].endsWith('tauri.js') && portable.args.includes('build') && portable.args.includes('--no-bundle'));
assert.ok(portable.args.includes('--features') && portable.args.includes('portable') && portable.args.includes('--locked'));
assert.equal(JSON.parse(portable.args[portable.args.indexOf('--config') + 1]).plugins.updater.pubkey, key);
assert.ok(collect.args.includes('scripts/collect-exe.mjs'));
console.log('PASS: installer and portable use the production Tauri CLI, share the normalized key, and avoid exposing unused signing secrets.');
