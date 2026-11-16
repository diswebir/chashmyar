// Source/config safety checks, not a native updater or GitHub Actions test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capabilities = JSON.parse(read('src-tauri/capabilities/default.json'));
const updater = read('src-tauri/src/updater.rs');
const policy = read('src-tauri/src/update_policy.rs');
const engine = read('src-tauri/src/engine.rs');
const persistence = read('src-tauri/src/persistence.rs');
const main = read('src-tauri/src/main.rs');
const lib = read('src-tauri/src/lib.rs');
const portable = read('src-tauri/src/portable_replace.rs');
const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');
const card = read('src/components/UpdateCard.tsx');
const keyGuide = read('START_HERE_FA.md');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
const occurrences = (text, needle) => text.split(needle).length - 1;
const section = (text, begin, end) => {
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  assert.ok(start >= 0 && finish > start, `missing markers: ${begin} / ${end}`);
  return text.slice(start, finish);
};
const up = config.plugins.updater;
ok(config.bundle.createUpdaterArtifacts === true, 'Tauri signs updater artifacts');
ok(up.pubkey === '' && up.requireSignedVersion === true, 'no committed production key; signed version is mandatory');
ok(JSON.stringify(up.endpoints) === JSON.stringify(['https://github.com/diswebir/chashmyar/releases/latest/download/latest.json']), 'fixed HTTPS GitHub release endpoint');
ok(!up.dangerousInsecureTransportProtocol && !up.dangerousAcceptInvalidCerts && !up.dangerousAcceptInvalidHostnames && !up.allowDowngrades, 'no insecure transport or downgrades');
ok(up.windows.installMode === 'passive', 'installer restarts after consent via passive mode');
ok(!capabilities.permissions.some((x) => String(x).startsWith('updater:')), 'webviews cannot call updater plugin install permissions directly');
// Deliberate security review gate: a Dependabot bump must update this reviewed
// exact pin, verify upstream signature/install behavior and regenerate notices.
const cargo = read('src-tauri/Cargo.toml');
ok(/^tauri-plugin-updater\s*=\s*\{[^\r\n}]*\bversion\s*=\s*"=2\.14\.1"[^\r\n}]*\}/m.test(cargo), 'reviewed signature-verifying plugin is exactly pinned');
ok(/\[\[package\]\]\r?\nname = "tauri-plugin-updater"\r?\nversion = "2\.14\.1"\r?\n/.test(read('src-tauri/Cargo.lock')), 'locked updater matches the reviewed pin');
ok(updater.includes('option_env!("CHASHMYAR_UPDATER_PUBLIC_KEY")') && lib.includes('pubkey(updater::PUBLIC_KEY.trim())'), 'public key embedded in the binary');
ok(updater.includes('"unconfigured"') && updater.includes('PUBLIC_KEY.trim().is_empty()'), 'missing public key fails closed');
ok(updater.includes('Duration::from_secs(20)') && updater.includes('6 * 60 * 60'), 'automatic checks occur after startup and periodically');
ok(updater.includes('windows-x86_64-portable') && updater.includes('windows-x86_64'), 'portable and installed use different targets');
const download = section(updater, 'async fn check_and_download', 'fn notify_when_safe');
ok(download.indexOf('expected_download_url') < download.indexOf('update.download('), 'URL policy checked before downloading');
ok(download.indexOf('update.download(') < download.indexOf('valid_windows_payload') && download.indexOf('valid_windows_payload') < download.indexOf('phase = "ready"'), 'only verified PE download enters ready state');
ok(policy.includes('https://github.com/diswebir/chashmyar/releases/download') && policy.includes('0x8664'), 'download repository and x64 format are constrained');
ok(!download.includes('.install(') && !download.includes('install_and_start('), 'background check/download never installs');
const install = section(updater, 'pub fn install_ready_update', '\n}');
ok(install.includes('BREAK_TRANSITION.lock()') && install.indexOf('BREAK_TRANSITION.lock()') < install.indexOf('break_active'), 'break transition is serialized before installation');
const shutdown = section(engine, 'pub fn safe_shutdown(', '\n}');
ok(!shutdown.includes('BREAK_TRANSITION') && !shutdown.includes('enter_break(') && !shutdown.includes('leave_break(') && !shutdown.includes('emergency_unlock('), 'shutdown callback does not recursively take break-transition lock');
ok(!persistence.includes('BREAK_TRANSITION'), 'settings writer does not take the break-transition lock');
ok(install.indexOf('save_current_checked') < install.indexOf('install_and_start') && install.indexOf('save_current_checked') < install.indexOf('ready.update.install('), 'settings must save before either installation');
ok(install.includes('inner.ready = Some(ready)') && install.includes('settings_save'), 'verified download retained after settings write failure');
ok(install.includes('engine::safe_shutdown(&app)') && download.includes('engine::safe_shutdown(&for_shutdown)') && download.includes('cleanup_before_exit()'), 'both exit paths perform cleanup');
ok(download.indexOf('for_callback.store(true') < download.indexOf('cleanup_before_exit()'), 'installer callback records that Tauri cleanup has begun');
const afterCleanupFailure = section(install, 'if ready.shutdown_started.load(', '// Extraction/temp-file errors');
ok(afterCleanupFailure.includes('diag::fatal_box(') && afterCleanupFailure.includes('std::process::exit(1)') && !afterCleanupFailure.includes('app.'), 'post-cleanup launch failure uses an OS dialog and exits without Tauri APIs');
ok(install.includes('installer_prepare') && install.includes('inner.ready = Some(ready)'), 'pre-cleanup installer preparation failure retains the verified download');
ok(install.includes('ready.update.install(&ready.bytes)') && install.includes('install_and_start(&ready.bytes)'), 'only internal verified download bytes are installed');
ok(card.includes('data-testid="update-confirm"') && card.includes('data-testid="update-confirm-install"') && card.includes('call("install_ready_update")'), 'UI uses a separate confirmation action');
ok(main.indexOf('wait_before_startup()') < main.indexOf('chashmyar_lib::run()'), 'portable child waits before app initialization');
ok(portable.includes('ReplaceFileW(') && portable.includes('rollback_after_spawn_failure') && portable.includes('cleanup_after_successful_start'), 'portable retains a recovery backup and handles spawn failure');
ok(!portable.includes('cmd.exe') && !portable.includes('powershell.exe'), 'portable replacement does not use a command shell');
ok(release.includes('npm run build:win') && release.includes('npm run release:sign') && release.includes('scripts/stage-release.mjs') && release.includes('scripts/auto-release.mjs publish'), 'workflow builds, signs, verifies and publishes');
ok(occurrences(release, '${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}') === 2 && occurrences(release, '${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}') === 2, 'only build and sign receive private-key secrets');
ok(occurrences(release, '${{ vars.CHASHMYAR_UPDATER_PUBLIC_KEY }}') === 5, 'matching public key available in build, sign, stage, native audit and publish');
ok(!section(release, '  publish:', '\n          GH_TOKEN:').includes('secrets.TAURI_SIGNING_PRIVATE_KEY'), 'write-enabled publish job has no signing secret');
ok(!ci.includes('TAURI_SIGNING_PRIVATE_KEY'), 'pull-request CI does not receive the signing secret');
ok(read('scripts/stage-release.mjs').includes('CHASHMYAR_PORTABLE_UPDATER_V1') && read('scripts/stage-release.mjs').includes('verifyTauriSignature'), 'staging verifies flavour, key and signatures');
for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'CHASHMYAR_UPDATER_PUBLIC_KEY']) {
  ok(keyGuide.includes(name), `root Persian setup guide includes ${name}`);
}
ok(keyGuide.includes('signer generate --write-keys') && keyGuide.includes('updater.key.pub'), 'guide explains creation and the matching public-key file');
ok(keyGuide.includes('دستی') && keyGuide.includes('ویندوز') && keyGuide.includes('همان کلید'), 'guide includes first manual upgrade and real Windows testing with the same key');
ok(keyGuide.includes('docs/UPDATER_SIGNING_FA.md'), 'root guide links to the detailed signing guide');
console.log(`PASS: ${checks} updater security/source-policy checks (not a native updater test)`);
