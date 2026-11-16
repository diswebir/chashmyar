/** End-to-end offline tests: real local Git remotes + a fake GitHub CLI. */
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { testSigner } from './fixtures/test-updater-signature.mjs';

const signer = testSigner();
const signingEnv = { CHASHMYAR_UPDATER_PUBLIC_KEY: signer.publicKey, GITHUB_REPOSITORY: 'example/ChashmYar' };
const project = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'chashmyar-auto-release-test-'));
const repo = join(temp, 'repo');
const bare = join(temp, 'origin.git');
const stateFile = join(temp, 'fake-gh.json');
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
function command(cmd, args, { cwd = repo, env = {}, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}
function git(...args) { return (command('git', args).stdout || '').trimEnd(); }
function script(file, args = [], env = {}, allowFailure = false) {
  return command(process.execPath, [join(repo, file), ...args], { env: { GITHUB_OUTPUT: '', ...env }, allowFailure });
}
function auto(commandName, source, version, allowFailure = false) {
  return script('scripts/auto-release.mjs', [commandName], {
    RELEASE_SOURCE: source, RELEASE_VERSION: version || '', RELEASE_TAG: version ? `v${version}` : '',
    ...signingEnv,
    CHASHMYAR_TEST_GH: resolve(project, 'tests/fixtures/fake-auto-gh.cjs'),
    CHASHMYAR_FAKE_AUTO_GH_STATE: stateFile,
  }, allowFailure);
}
function plan(source) { return JSON.parse(auto('plan', source).stdout.trim().split(/\r?\n/).at(-1)); }
function fakeState() { return JSON.parse(readFileSync(stateFile, 'utf8')); }
function saveState(state) { writeFileSync(stateFile, JSON.stringify(state, null, 2)); }
function setFailure(failure) { const s = fakeState(); s.failOnce = failure; saveState(s); }
function checkFailed(result, message) { ok(result.status !== 0, `${message}; stdout=${result.stdout}, stderr=${result.stderr}`); }
function selectSource(source) { git('reset', '--hard'); git('checkout', '--detach', source); }
function makePe(machine, version) {
  const bytes = Buffer.alloc(768); bytes.write('MZ', 0); bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write('PE\0\0', 0x80, 'binary'); bytes.writeUInt16LE(machine, 0x84); bytes.write(version, 0xc0);
  if (machine === 0x8664) {
    bytes.write('CHASHMYAR_PORTABLE_UPDATER_V1', 0xe0);
    bytes.write(signer.publicKey.trim(), 0x120);
    bytes.write('CHASHMYAR_RELEASE_AUDIT_V1', 0x200);
  }
  return bytes;
}
function stageAssets(version) {
  mkdirSync(join(repo, 'release/windows'), { recursive: true });
  mkdirSync(join(repo, 'release/updater'), { recursive: true });
  for (const [name, bytes] of [[`ChashmYar_${version}_x64-setup.exe`, makePe(0x14c, version)], [`ChashmYar-${version}-portable.exe`, makePe(0x8664, version)]]) {
    writeFileSync(join(repo, 'release/windows', name), bytes);
    writeFileSync(join(repo, 'release/updater', `${name}.sig`), signer.sign(bytes, version, name));
  }
  script('scripts/stage-release.mjs', ['--tag', `v${version}`], signingEnv);
}
function prepareBuild(source, version, checkTamper = false) {
  script('scripts/version.mjs', ['set', version]);
  auto('stamp', source, version);
  if (checkTamper) {
    appendFileSync(join(repo, 'app.txt'), 'unexpected change\n');
    checkFailed(auto('verify-build', source, version, true), 'changed source is rejected after build');
    git('restore', '--worktree', 'app.txt');
  }
  auto('verify-build', source, version);
  stageAssets(version);
  // A separate publication runner checks out the source and applies the same
  // version. Reset only the index to simulate that clean runner's state.
  git('reset', '--mixed', 'HEAD');
}
function newMainCommit(label) {
  git('reset', '--hard');
  git('checkout', 'main');
  appendFileSync(join(repo, 'app.txt'), `${label}\n`);
  git('add', 'app.txt');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', `User push ${label}`);
  git('push', 'origin', 'main');
  const source = git('rev-parse', 'HEAD');
  git('checkout', '--detach', source);
  return source;
}
function mutationCount(state) {
  return state.calls.filter(a => a[0] === 'api' && a.includes('--method')
    && (a.includes('POST') || a.includes('PATCH'))).length;
}
function actualDigest(asset) {
  return 'sha256:' + crypto.createHash('sha256').update(Buffer.from(asset.contentBase64, 'base64')).digest('hex');
}

try {
  mkdirSync(temp, { recursive: true });
  command('git', ['init', '--bare', '--initial-branch=main', bare], { cwd: temp });
  command('git', ['clone', bare, repo], { cwd: temp });
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgSign', 'false');
  const inputs = ['.gitignore', '.gitattributes', 'package.json', 'package-lock.json',
    'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'scripts/version.mjs', 'scripts/stage-release.mjs', 'scripts/updater-signatures.mjs', 'scripts/auto-release.mjs'];
  for (const file of inputs) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    cpSync(join(project, file), join(repo, file));
  }
  writeFileSync(join(repo, 'LICENSE'), 'fixture license\n');
  writeFileSync(join(repo, 'THIRD_PARTY_NOTICES.txt'), 'fixture notices\n');
  writeFileSync(join(repo, 'app.txt'), 'A\n');
  script('scripts/version.mjs', ['set', '2.4.7']);
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'User push A');
  git('push', '-u', 'origin', 'main');
  const a = git('rev-parse', 'HEAD');
  git('checkout', '--detach', a);
  saveState({ calls: [], releases: {}, failOnce: null });

  const first = plan(a);
  eq(first.version, '2.4.7', 'without any tags, the first push uses the 2.4.7 baseline');
  eq(first.reason, 'new-baseline', 'first release allocates the baseline itself');
  // Match the real repository's current history, then probe collisions without
  // ever moving or overwriting the existing tag.
  git('tag', 'v2.4.6', a);
  git('push', 'origin', 'refs/tags/v2.4.6:refs/tags/v2.4.6');
  eq(plan(a).version, '2.4.7', 'a lower 2.4.6 tag still allocates baseline 2.4.7');
  git('tag', 'v2.4.7', a);
  eq(plan(a).version, '2.4.8', 'a manually occupied baseline advances the patch');
  eq(plan(a).reason, 'new-patch', 'occupied baseline reports a patch allocation');
  git('tag', 'v2.4.9', a);
  eq(plan(a).version, '2.4.10', 'a higher manual tag, not the baseline, determines the next patch');
  git('tag', 'v2.4.65535', a);
  checkFailed(auto('plan', a, undefined, true), 'patch overflow fails closed');
  git('tag', '-d', 'v2.4.7', 'v2.4.9', 'v2.4.65535');

  // A baseline at the component limit is usable once if still untagged; after
  // that it must not overflow. A newer minor baseline resolves the limit.
  script('scripts/version.mjs', ['set', '2.4.65535']);
  git('add', '--', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock');
  git('commit', '-m', 'Fixture maximum patch baseline');
  const maxPatchSource = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', maxPatchSource);
  git('tag', 'v2.4.65534', maxPatchSource);
  eq(plan(maxPatchSource).version, '2.4.65535', 'unreleased maximum patch baseline can be used once');
  git('tag', 'v2.4.65535', maxPatchSource);
  checkFailed(auto('plan', maxPatchSource, undefined, true), 'an occupied maximum patch is not incremented past 65535');
  script('scripts/version.mjs', ['set', '2.5.0']);
  git('add', '--', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock');
  git('commit', '-m', 'Fixture new minor baseline');
  const newMinorSource = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', newMinorSource);
  eq(plan(newMinorSource).version, '2.5.0', 'a newer minor baseline clears the previous patch limit');
  git('tag', '-d', 'v2.4.65534', 'v2.4.65535');
  git('update-ref', 'refs/remotes/origin/main', a);
  git('checkout', '--detach', a);

  // Noncanonical but valid source JSON can legitimately cause only one of
  // the five files to change after setting an already-current version.
  const subsetPkg = join(repo, 'package.json');
  writeFileSync(subsetPkg, JSON.stringify(JSON.parse(readFileSync(subsetPkg, 'utf8'))) + '\n');
  git('add', 'package.json'); git('commit', '-m', 'Fixture compact manifest');
  const subsetSource = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', subsetSource);
  script('scripts/version.mjs', ['set', '2.4.7']);
  auto('stamp', subsetSource, '2.4.7');
  eq(git('diff', '--cached', '--name-only'), 'package.json', 'stamping accepts a valid subset of changed version files');
  auto('verify-build', subsetSource, '2.4.7');
  git('reset', '--hard', a);
  git('update-ref', 'refs/remotes/origin/main', a);

  // An unchanged baseline used to fail because the old stamper demanded all
  // five manifests be modified. Conversely, accepting filenames alone would
  // allow unrelated manifest edits into a release: those must fail as well.
  const pkgPath = join(repo, 'package.json');
  const tamperedPkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  tamperedPkg.description += ' unexpected change';
  writeFileSync(pkgPath, JSON.stringify(tamperedPkg, null, 2) + '\n');
  checkFailed(auto('stamp', a, first.version, true), 'unrelated edits inside a version file are rejected');
  git('reset', '--hard', a);
  if (process.platform !== 'win32') {
    chmodSync(pkgPath, 0o755);
    checkFailed(auto('stamp', a, first.version, true), 'version-file permission changes are rejected');
    git('reset', '--hard', a);
  }
  prepareBuild(a, first.version, true);
  const firstTree = JSON.parse(readFileSync(join(repo, 'release/auto-release.json'), 'utf8')).tree;
  eq(firstTree, git('rev-parse', `${a}^{tree}`), 'same-version baseline keeps the exact original source tree');
  auto('publish', a, first.version);
  let state = fakeState();
  const releaseA = state.releases['v2.4.7'];
  ok(releaseA && releaseA.draft === false, 'signed assets are automatically published');
  eq(state.latestTag, 'v2.4.7', 'published release explicitly becomes Latest for the updater endpoint');
  ok(state.calls.some(c => c[0] === 'api' && c[1] === 'repos/example/ChashmYar/releases/latest'),
    'publication confirms the updater endpoint selects the intended release');
  eq(releaseA.assets.length, 8, 'exactly eight assets are published');
  ok(state.calls.some(c => c[0] === 'api' && c[1].endsWith('/releases') && c.includes('POST')
    && c.includes('draft=true')), 'release is staged as a draft after the remote tag is verified');
  ok(state.calls.some(c => c[0] === 'api' && /\/releases\/\d+$/.test(c[1])
    && c.includes('PATCH') && c.includes('draft=false')), 'draft is published automatically by verified ID');
  ok(state.calls.every(c => !c.includes('--clobber')), 'automation never clobbers release assets');
  ok(state.calls.every(c => !/\/releases\/tags\//.test(c[1] || '')), 'draft discovery does not use the published-only tag endpoint');
  eq(git('rev-parse', 'v2.4.7^{tree}'), firstTree, 'tagged source tree matches the build');
  eq(git('rev-parse', 'v2.4.7^{commit}^'), a, 'tag commit has the pushed commit as its parent');
  eq(git('ls-remote', '--heads', 'origin', 'refs/heads/main').split(/\s+/)[0], a, 'publication never commits back to main');

  // Model Windows checkout conversion: Git must normalize the CRLF working
  // files into the same release tree as the Linux publication checkout.
  const crlfRepo = join(temp, 'crlf-build');
  command('git', ['-c', 'core.autocrlf=true', 'clone', bare, crlfRepo], { cwd: temp });
  command('git', ['config', 'core.autocrlf', 'true'], { cwd: crlfRepo });
  command('git', ['checkout', '--detach', a], { cwd: crlfRepo });
  ok(readFileSync(join(crlfRepo, 'src-tauri/Cargo.toml'), 'utf8').includes('\r\n'), 'CRLF checkout simulates Windows line endings');
  const crlfEnv = { RELEASE_SOURCE: a, RELEASE_VERSION: '2.4.7', RELEASE_TAG: 'v2.4.7', GITHUB_OUTPUT: '' };
  command(process.execPath, ['scripts/version.mjs', 'set', '2.4.7'], { cwd: crlfRepo, env: crlfEnv });
  command(process.execPath, ['scripts/auto-release.mjs', 'stamp'], { cwd: crlfRepo, env: crlfEnv });
  eq(JSON.parse(readFileSync(join(crlfRepo, 'release/auto-release.json'), 'utf8')).tree, firstTree,
    'Windows-style checkout and Linux checkout produce the same tagged tree');

  // Asset bytes stay in fake state for downloads but must never appear in REST
  // metadata. Large real notices exposed a truncated fake-CLI stdout otherwise.
  const largePath = join(temp, 'large-fixture.bin');
  writeFileSync(largePath, Buffer.alloc(700_000, 0x61));
  state = fakeState();
  state.releases['large-fixture'] = { id: 90000, tag_name: 'large-fixture', draft: true,
    prerelease: false, body: '', assets: [] };
  saveState(state);
  const fakePath = resolve(project, 'tests/fixtures/fake-auto-gh.cjs');
  const fakeEnv = { CHASHMYAR_FAKE_AUTO_GH_STATE: stateFile };
  const largeUpload = command(process.execPath, [fakePath, 'api',
    'https://uploads.github.com/repos/example/ChashmYar/releases/90000/assets?name=large-fixture.bin',
    '--method', 'POST', '--header', 'Content-Type: application/octet-stream', '--input', largePath], { env: fakeEnv });
  const uploadMeta = JSON.parse(largeUpload.stdout);
  eq(uploadMeta.size, 700_000, 'fake GitHub uploads a large asset correctly');
  ok(!('contentBase64' in uploadMeta) && largeUpload.stdout.length < 2000, 'upload response omits asset bytes');
  const largeRead = command(process.execPath, [fakePath, 'api', 'repos/example/ChashmYar/releases/90000'], { env: fakeEnv });
  const readMeta = JSON.parse(largeRead.stdout);
  ok(!('contentBase64' in readMeta.assets[0]) && largeRead.stdout.length < 4000, 'release response omits asset bytes');
  const largeList = command(process.execPath, [fakePath, 'api',
    'repos/example/ChashmYar/releases?per_page=100&page=1'], { env: fakeEnv });
  ok(Array.isArray(JSON.parse(largeList.stdout)) && largeList.stdout.length < 10_000,
    'release-list response stays small for large assets');
  state = fakeState(); delete state.releases['large-fixture']; saveState(state);

  // Rerunning an already public version verifies it and performs no writes.
  selectSource(a);
  eq(plan(a).reason, 'resume-existing-tag', 'same source reuses its existing tag');
  prepareBuild(a, '2.4.7');
  const beforeRerun = mutationCount(fakeState());
  auto('publish', a, '2.4.7');
  state = fakeState();
  eq(mutationCount(state), beforeRerun, 'published release rerun does not mutate assets or release');
  ok(state.calls.some(c => c[1] === 'download' && c.includes('SHA256SUMS.txt')), 'published release checks its manifest');

  // A corrupted existing public release is reported, never overwritten.
  selectSource(a); prepareBuild(a, '2.4.7');
  state = fakeState();
  const originalDigest = state.releases['v2.4.7'].assets[0].digest;
  state.releases['v2.4.7'].assets[0].digest = 'sha256:' + '0'.repeat(64);
  const beforeCorrupt = mutationCount(state); saveState(state);
  checkFailed(auto('publish', a, '2.4.7', true), 'corrupted published digest is detected');
  state = fakeState(); eq(mutationCount(state), beforeCorrupt, 'corrupt public release is not overwritten');
  state.releases['v2.4.7'].assets[0].digest = originalDigest; saveState(state);

  const b = newMainCommit('B');
  const second = plan(b);
  eq(second.version, '2.4.8', 'new push increments the tag even though main keeps its baseline version');
  script('scripts/version.mjs', ['set', second.version]);
  const changedDuringBump = JSON.parse(readFileSync(pkgPath, 'utf8'));
  changedDuringBump.description += ' hidden change';
  writeFileSync(pkgPath, JSON.stringify(changedDuringBump, null, 2) + '\n');
  checkFailed(auto('stamp', b, second.version, true), 'extra manifest edits are rejected even when all five version files changed');
  git('reset', '--hard', b);
  prepareBuild(b, second.version);
  const secondTree = JSON.parse(readFileSync(join(repo, 'release/auto-release.json'), 'utf8')).tree;
  command('git', ['fetch', 'origin'], { cwd: crlfRepo });
  command('git', ['checkout', '--detach', b], { cwd: crlfRepo });
  const bumpedCrlfEnv = { RELEASE_SOURCE: b, RELEASE_VERSION: second.version, RELEASE_TAG: `v${second.version}`, GITHUB_OUTPUT: '' };
  command(process.execPath, ['scripts/version.mjs', 'set', second.version], { cwd: crlfRepo, env: bumpedCrlfEnv });
  command(process.execPath, ['scripts/auto-release.mjs', 'stamp'], { cwd: crlfRepo, env: bumpedCrlfEnv });
  eq(JSON.parse(readFileSync(join(crlfRepo, 'release/auto-release.json'), 'utf8')).tree, secondTree,
    'Windows-style checkout and Linux agree after a version bump too');
  state = fakeState(); state.staleLatestReads = 1; state.staleLatestTag = 'v2.4.7'; saveState(state);
  const beforeLatestReads = state.calls.filter(c => c[1] === 'repos/example/ChashmYar/releases/latest').length;
  auto('publish', b, second.version);
  state = fakeState();
  ok(state.releases['v2.4.8']?.draft === false, 'second push publishes a new version');
  ok(state.calls.filter(c => c[1] === 'repos/example/ChashmYar/releases/latest').length >= beforeLatestReads + 2,
    'Latest confirmation retries a temporarily stale GitHub response');
  selectSource(a);
  const stale = plan(a);
  ok(stale.skip && stale.reason === 'superseded-by-newer-source', 'out-of-order old push is skipped rather than rolling back');

  // Existing releases may span multiple REST pages; an automatic draft can be
  // older than the first page and still must be discovered exactly once.
  state = fakeState();
  for (let i = 0; i < 102; i++) state.releases[`fixture-${i}`] = {
    id: 1000 + i, tag_name: `unrelated-${i}`, draft: false, prerelease: false, body: '', assets: [],
  };
  saveState(state);
  // A network failure after tag creation is resumed with the same patch.
  const c = newMainCommit('C');
  const third = plan(c); eq(third.version, '2.4.9', 'third push is numbered sequentially');
  prepareBuild(c, third.version); setFailure('create');
  checkFailed(auto('publish', c, third.version, true), 'failed release creation does not publish');
  ok(git('ls-remote', '--tags', '--refs', 'origin', 'refs/tags/v2.4.9').length > 0, 'tag survived interrupted publication');
  selectSource(c);
  const resumed = plan(c); eq(resumed.version, '2.4.9', 'retry resumes the existing version instead of bumping again');
  eq(resumed.reason, 'resume-existing-tag', 'retry identifies the tag and source');
  prepareBuild(c, resumed.version); auto('publish', c, resumed.version);
  state = fakeState();
  ok(state.releases['v2.4.9']?.draft === false, 'interrupted creation can be resumed');
  ok(state.calls.some(ca => /\/releases\?per_page=100&page=2$/.test(ca[1] || '')), 'release discovery scans later pages');
  for (let i = 0; i < 102; i++) delete state.releases[`fixture-${i}`];
  saveState(state);

  // A release-list failure must not be mistaken for a missing draft.
  const d = newMainCommit('D'); const fourth = plan(d);
  eq(fourth.version, '2.4.10', 'fourth push increments patch');
  prepareBuild(d, fourth.version); setFailure('list');
  checkFailed(auto('publish', d, fourth.version, true), 'release listing failure aborts publication');
  ok(!fakeState().releases['v2.4.10'], 'list failure did not create or overwrite a release');
  // A partially uploaded matching draft can be completed without --clobber.
  selectSource(d); prepareBuild(d, fourth.version);
  state = fakeState(); state.delayDigestOnce = 'ChashmYar_2.4.10_x64-setup.exe'; saveState(state);
  setFailure('upload:ChashmYar-2.4.10-portable.exe');
  const delayedDigestRun = auto('publish', d, fourth.version, true);
  checkFailed(delayedDigestRun, 'upload failure leaves an unpublished draft');
  ok(/Waiting for GitHub SHA-256 digests/.test(delayedDigestRun.stdout), 'temporarily missing GitHub digest is retried');
  state = fakeState();
  eq(state.releases['v2.4.10'].draft, true, 'partial release remains private draft');
  eq(state.releases['v2.4.10'].assets.length, 1, 'only the first asset was uploaded');
  const draftTagLookup = command(process.execPath, [resolve(project, 'tests/fixtures/fake-auto-gh.cjs'),
    'api', 'repos/example/ChashmYar/releases/tags/v2.4.10'], {
    env: { CHASHMYAR_FAKE_AUTO_GH_STATE: stateFile }, allowFailure: true,
  });
  ok(draftTagLookup.status !== 0 && /HTTP 404/.test(draftTagLookup.stderr), 'fake models GitHub: REST by-tag does not return drafts');
  state = fakeState();
  state.releases['duplicate-draft'] = { ...state.releases['v2.4.10'], id: 98765 };
  const beforeDuplicate = mutationCount(state); saveState(state);
  selectSource(d); prepareBuild(d, '2.4.10');
  checkFailed(auto('publish', d, '2.4.10', true), 'duplicate releases claiming one tag are refused');
  state = fakeState(); eq(mutationCount(state), beforeDuplicate, 'ambiguous draft caused no upload or publish');
  delete state.releases['duplicate-draft']; saveState(state);
  const isDInstallerUpload = ca => ca[0] === 'api' && /uploads\.github\.com/.test(ca[1] || '')
    && /name=ChashmYar_2\.4\.10_x64-setup\.exe$/.test(ca[1] || '') && ca.includes('POST');
  const installerUploads = state.calls.filter(isDInstallerUpload).length;
  selectSource(d); eq(plan(d).version, '2.4.10', 'partial upload resumes the same version');
  prepareBuild(d, '2.4.10'); auto('publish', d, '2.4.10');
  state = fakeState();
  eq(state.releases['v2.4.10'].draft, false, 'completed draft becomes public automatically');
  eq(state.calls.filter(isDInstallerUpload).length, installerUploads, 'matching asset was not uploaded again');

  // A mismatched draft asset is never replaced or published.
  const e = newMainCommit('E'); const fifth = plan(e);
  eq(fifth.version, '2.4.11', 'fifth push increments patch');
  prepareBuild(e, fifth.version); setFailure('upload:ChashmYar-2.4.11-portable.exe');
  checkFailed(auto('publish', e, fifth.version, true), 'simulated partial upload fails');
  state = fakeState(); state.releases['v2.4.11'].assets[0].digest = 'sha256:' + 'f'.repeat(64);
  const beforeMismatch = mutationCount(state); saveState(state);
  selectSource(e); prepareBuild(e, '2.4.11');
  checkFailed(auto('publish', e, '2.4.11', true), 'mismatched draft asset is refused');
  state = fakeState(); eq(mutationCount(state), beforeMismatch, 'mismatched draft is neither overwritten nor published');
  eq(state.releases['v2.4.11'].draft, true, 'mismatched draft remains unpublished');
  state.releases['v2.4.11'].assets[0].digest = null; saveState(state);
  selectSource(e); prepareBuild(e, '2.4.11');
  const missingDigest = auto('publish', e, '2.4.11', true);
  ok(missingDigest.status !== 0 && /did not provide all asset SHA-256 digests/.test(missingDigest.stderr),
    'a permanently absent digest times out without publishing');
  state = fakeState(); eq(mutationCount(state), beforeMismatch, 'missing digest caused no upload or publish');
  state.releases['v2.4.11'].assets[0].digest = actualDigest(state.releases['v2.4.11'].assets[0]); saveState(state);
  selectSource(e); prepareBuild(e, '2.4.11'); setFailure('publish');
  checkFailed(auto('publish', e, '2.4.11', true), 'failed final PATCH leaves a verified draft');
  state = fakeState();
  eq(state.releases['v2.4.11'].assets.length, 8, 'all verified assets remain after publish failure');
  eq(state.releases['v2.4.11'].draft, true, 'failed PATCH did not publish the draft');
  const beforeRetryUploads = state.calls.filter(ca => ca[0] === 'api' && /uploads\.github\.com/.test(ca[1] || '')).length;
  // Even if GitHub keeps returning a stale Latest after PATCH, it may have
  // published already. Report failure clearly, then allow a read-only retry.
  state.staleLatestReads = 10; state.staleLatestTag = 'v2.4.10'; saveState(state);
  selectSource(e); prepareBuild(e, '2.4.11');
  const staleLatest = auto('publish', e, '2.4.11', true);
  checkFailed(staleLatest, 'an unconfirmed Latest endpoint fails rather than claiming success');
  ok(/may already be public/.test(staleLatest.stderr), 'failure explains that publication may have happened');
  state = fakeState();
  ok(state.releases['v2.4.11']?.draft === false, 'failed Latest confirmation does not pretend the release is still a draft');
  const beforeLatestRetry = mutationCount(state);
  selectSource(e); prepareBuild(e, '2.4.11'); auto('publish', e, '2.4.11');
  state = fakeState();
  eq(mutationCount(state), beforeLatestRetry, 'rechecking a now-visible Latest does not mutate the public release');
  eq(state.calls.filter(ca => ca[0] === 'api' && /uploads\.github\.com/.test(ca[1] || '')).length,
    beforeRetryUploads, 'verified assets are not uploaded twice after a failed final PATCH');

  git('tag', '-a', 'v2.4.14', e, '-m', 'manual external tag');
  git('push', 'origin', 'refs/tags/v2.4.14:refs/tags/v2.4.14');
  const f = newMainCommit('F');
  eq(plan(f).version, '2.4.15', 'all stable tags participate in numeric version allocation');
  prepareBuild(f, '2.4.15');
  const metaPath = join(repo, 'release/auto-release.json');
  const correctMeta = readFileSync(metaPath, 'utf8');
  const badMeta = JSON.parse(correctMeta); badMeta.tree = '0'.repeat(40);
  writeFileSync(metaPath, JSON.stringify(badMeta));
  checkFailed(auto('publish', f, '2.4.15', true), 'mismatched build tree cannot be tagged or published');
  ok(!git('ls-remote', '--tags', '--refs', 'origin', 'refs/tags/v2.4.15'), 'mismatched tree did not push a tag');
  writeFileSync(metaPath, correctMeta);
  git('reset', '--mixed', 'HEAD');
  // A competing manual tag appearing after allocation is never overwritten.
  git('tag', '-a', 'v2.4.15', f, '-m', 'competing external tag');
  git('push', 'origin', 'refs/tags/v2.4.15:refs/tags/v2.4.15');
  checkFailed(auto('publish', f, '2.4.15', true), 'a changed version allocation fails safely');
  ok(!fakeState().releases['v2.4.15'], 'tag collision created no release');
  git('reset', '--hard', f);
  git('tag', '-a', 'v2.4.16', f, '-m', 'ChashmYar automatic release\n\ninvalid metadata');
  checkFailed(auto('plan', f, undefined, true), 'a malformed automatic tag fails closed');
  git('tag', '-d', 'v2.4.16');

  // A competing writer can create a higher tag after the publish job checks
  // out, while it uploads the draft. Refreshing tags must catch this rather
  // than publish the older version and move GitHub's Latest marker backwards.
  const g = newMainCommit('G');
  eq(plan(g).version, '2.4.16', 'next version is allocated before the remote race');
  prepareBuild(g, '2.4.16');
  state = fakeState();
  state.injectRemoteTag = { bare, commit: g, tag: 'v2.4.17', onAsset: 'ChashmYar_2.4.16_x64-setup.exe' };
  saveState(state);
  const raced = auto('publish', g, '2.4.16', true);
  checkFailed(raced, 'a higher remote tag created during uploads prevents publication');
  ok(/stale after refreshing tags/.test(raced.stderr), 'the refreshed tag history explains the refusal');
  state = fakeState();
  eq(state.releases['v2.4.16'].draft, true, 'raced release remains a draft');
  eq(state.latestTag, 'v2.4.11', 'raced release does not displace the previous Latest');
  selectSource(g);
  git('checkout', '-b', 'unpublished-branch');
  appendFileSync(join(repo, 'app.txt'), 'not on main\n'); git('add', 'app.txt'); git('commit', '-m', 'Not pushed to main');
  const unpushed = git('rev-parse', 'HEAD');
  const notOnMain = plan(unpushed);
  ok(notOnMain.skip && notOnMain.reason === 'source-not-on-main', 'source not on main cannot publish');

  // A force-rewritten main that diverges from existing automatic releases is
  // refused; the force push exists only in this temporary local test remote.
  git('checkout', '--orphan', 'rewritten-main');
  git('commit', '-m', 'Rewritten history');
  git('push', '--force', 'origin', 'HEAD:refs/heads/main');
  const rewritten = git('rev-parse', 'HEAD');
  checkFailed(auto('plan', rewritten, undefined, true), 'divergent rewritten main requires human reconciliation');

  const workflow = readFileSync(join(project, '.github/workflows/release.yml'), 'utf8');
  ok(/branches:\s*\[main\]/.test(workflow) && /queue:\s*max/.test(workflow), 'workflow triggers main pushes and queues releases');
  ok(/contents:\s*write/.test(workflow) && /auto-release\.mjs publish/.test(workflow), 'dedicated job has write permission and publishes');
  ok(!/push:\s*\n\s*tags:/.test(workflow), 'workflow does not require a manually pushed tag');
  ok(existsSync(join(project, 'tests/fixtures/fake-auto-gh.cjs')), 'release tests use the offline fake GitHub CLI');
  console.log(`PASS: ${checks} automatic release assertions with local Git and fake GitHub`);
} finally { rmSync(temp, { recursive: true, force: true }); }
