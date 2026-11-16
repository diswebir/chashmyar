// Verify the release build plan without compiling or producing an executable.
import assert from 'node:assert/strict';
import { makeWindowsBuildPlan } from '../scripts/build-windows.mjs';
import { testSigner } from './fixtures/test-updater-signature.mjs';

const key = testSigner().publicKey.trim();
const env = { CHASHMYAR_UPDATER_PUBLIC_KEY: `\n${key}\r\n`, TAURI_SIGNING_PRIVATE_KEY: 'never-logged-test-only' };
assert.throws(() => makeWindowsBuildPlan({}));
assert.throws(() => makeWindowsBuildPlan({ ...env, CHASHMYAR_UPDATER_PUBLIC_KEY: 'invalid' }));
assert.throws(() => makeWindowsBuildPlan({ ...env, TAURI_SIGNING_PRIVATE_KEY: '' }));
const plan = makeWindowsBuildPlan(env);
assert.equal(plan.length, 3);
for (const step of plan) {
  assert.equal(step.env.CHASHMYAR_UPDATER_PUBLIC_KEY, key, 'all subprocesses embed the exact trimmed public key');
  assert.equal(step.env.TAURI_SIGNING_PRIVATE_KEY, env.TAURI_SIGNING_PRIVATE_KEY);
  assert.ok(!step.args.join(' ').includes(env.TAURI_SIGNING_PRIVATE_KEY), 'private key is never a command-line argument');
}
const [nsis, portable, collect] = plan;
assert.ok(nsis.args.includes('--bundles') && nsis.args.includes('nsis') && nsis.args.includes('--locked'));
assert.equal(JSON.parse(nsis.args[nsis.args.indexOf('--config') + 1]).plugins.updater.pubkey, key);
assert.ok(portable.args.includes('--features') && portable.args.includes('portable') && portable.args.includes('--locked'));
assert.ok(collect.args.includes('scripts/collect-exe.mjs'));
console.log('PASS: signed Windows build plan fails closed, embeds one normalized public key in both builds, and keeps the private key out of arguments.');
