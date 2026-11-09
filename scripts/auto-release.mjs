#!/usr/bin/env node
/**
 * Automatic patch releases from a pushed main commit.
 *
 * plan    - choose a unique patch using the full tag history, or skip stale work
 * stamp        - stage only the five version files and record the exact Git tree
 * verify-build - ensure the source still matches that tree after building
 * publish      - verify the build, tag a version-only commit and publish safely
 *
 * The version commit is attached to the release tag, NOT pushed to main. That
 * keeps the contributor's local main fast-forwardable after each release.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION_FILES = [
  'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
].sort();
const META = join('release', 'auto-release.json');
const HEADER = 'ChashmYar automatic release';
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(cmd, args, { allowFailure = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: process.cwd(), encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFailure) {
    throw new Error(`${cmd} ${args[0] || ''} failed: ${(r.stderr || r.stdout || `exit ${r.status}`).trim()}`);
  }
  return r;
}
function git(...args) { return (run('git', args).stdout || '').trimEnd(); }
function gitLines(...args) { const s = git(...args); return s ? s.split(/\r?\n/) : []; }
function gh(args, allowFailure = false) {
  const fake = process.env.CHASHMYAR_TEST_GH;
  return fake
    ? run(process.execPath, [fake, ...args], { allowFailure })
    : run('gh', args, { allowFailure });
}
function sourceSha() {
  const s = (process.env.RELEASE_SOURCE || process.env.GITHUB_SHA || '').toLowerCase();
  if (!SHA.test(s)) throw new Error('RELEASE_SOURCE/GITHUB_SHA must be a full 40-character commit SHA');
  return s;
}
function versionEnv() {
  const v = process.env.RELEASE_VERSION || '';
  parseVersion(v);
  if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${v}`) throw new Error('Release tag and version differ');
  return v;
}
function repoEnv() {
  const r = process.env.GITHUB_REPOSITORY || '';
  if (!REPO.test(r)) throw new Error('GITHUB_REPOSITORY must be owner/repository');
  return r;
}
function parseVersion(v) {
  const match = SEMVER.exec(v);
  if (!match) throw new Error(`Not a stable MAJOR.MINOR.PATCH version: ${v}`);
  const parts = match.slice(1).map(Number);
  if (parts.some(n => !Number.isSafeInteger(n) || n > 65535)) throw new Error(`Windows version component exceeds 65535: ${v}`);
  return parts;
}
function compareVersions(a, b) {
  const aa = parseVersion(a), bb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
function isAncestor(a, b) {
  const r = run('git', ['merge-base', '--is-ancestor', a, b], { allowFailure: true });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`Cannot compare commit ancestry: ${(r.stderr || '').trim()}`);
}
function checkHead(source) {
  if (git('rev-parse', 'HEAD') !== source) throw new Error('Checkout HEAD is not the triggering source commit');
}
function versionAt(source) {
  const data = JSON.parse(git('show', `${source}:package.json`));
  parseVersion(data.version);
  return data.version;
}

/** Only our exact annotated-tag format is eligible for resume/staleness checks. */
function allTags() {
  const lines = gitLines('for-each-ref', '--format=%(refname:short)%09%(objecttype)%09%(subject)', 'refs/tags');
  const tags = [];
  for (const line of lines) {
    const [tag, objectType, subject] = line.split('\t');
    if (!tag?.startsWith('v') || !SEMVER.test(tag.slice(1))) continue;
    const version = tag.slice(1);
    parseVersion(version); // refuse out-of-range stable tags rather than reusing a lower version
    const entry = { tag, version };
    if (objectType === 'tag' && subject === HEADER) {
      const message = git('for-each-ref', '--format=%(contents)', `refs/tags/${tag}`).replace(/\r\n/g, '\n').trim();
      const match = /^ChashmYar automatic release\n\nSource-Commit: ([0-9a-f]{40})\nTree: ([0-9a-f]{40})$/.exec(message);
      if (!match) throw new Error(`Malformed automatic tag metadata: ${tag}`);
      const commit = git('rev-parse', `refs/tags/${tag}^{commit}`);
      const parents = git('rev-list', '--parents', '-n', '1', commit).split(/\s+/);
      const tree = git('rev-parse', `${commit}^{tree}`);
      if (parents.length !== 2 || parents[1] !== match[1] || tree !== match[2] || versionAt(commit) !== version) {
        throw new Error(`Automatic tag ${tag} does not match its source/tree/version`);
      }
      Object.assign(entry, { source: match[1], tree, commit });
    }
    tags.push(entry);
  }
  return tags.sort((a, b) => compareVersions(a.version, b.version));
}

function planRelease(source) {
  // Re-fetching is performed by checkout(fetch-depth: 0) in each job. Do not
  // publish a push removed from main by a force-push or a deleted branch.
  const main = git('rev-parse', 'refs/remotes/origin/main');
  if (!isAncestor(source, main)) return { skip: true, reason: 'source-not-on-main', source };
  const tags = allTags();
  const autos = tags.filter(t => t.source);
  const matching = autos.filter(t => t.source === source);
  if (matching.length > 1) throw new Error('More than one automatic tag claims the same source commit');
  const latestAuto = autos.at(-1);
  if (latestAuto && latestAuto.source !== source) {
    if (isAncestor(source, latestAuto.source)) return { skip: true, reason: 'superseded-by-newer-source', source };
    if (!isAncestor(latestAuto.source, source)) throw new Error('Automatic release history diverged from main; reconcile the history before publishing');
  }
  if (matching.length === 1) {
    const found = matching[0];
    if (tags.some(t => compareVersions(t.version, found.version) > 0)) {
      return { skip: true, reason: 'superseded-by-newer-tag', source };
    }
    return { skip: false, reason: 'resume-existing-tag', source, version: found.version, tag: found.tag, tree: found.tree };
  }
  let latest = versionAt(source);
  for (const t of tags) if (compareVersions(t.version, latest) > 0) latest = t.version;
  const [major, minor, patch] = parseVersion(latest);
  if (patch >= 65535) throw new Error('Patch version is 65535; choose a new major/minor baseline before releasing');
  const version = `${major}.${minor}.${patch + 1}`;
  return { skip: false, reason: 'new-patch', source, version, tag: `v${version}` };
}
function writeOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const allowed = ['skip', 'reason', 'source', 'version', 'tag'];
  const lines = allowed.filter(k => values[k] !== undefined).map(k => `${k}=${values[k]}`);
  if (lines.some(s => /[\r\n]/.test(s))) throw new Error('Invalid output');
  appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}
function samePaths(a, b) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
function requireVersionCheck(tag) {
  run(process.execPath, ['scripts/version.mjs', 'check', '--tag', tag]);
}
function stageVersionTree(source, version) {
  checkHead(source);
  requireVersionCheck(`v${version}`);
  const staged = gitLines('diff', '--cached', '--name-only');
  const unstaged = gitLines('diff', '--name-only');
  const untracked = gitLines('ls-files', '--others', '--exclude-standard');
  if (staged.length || untracked.length || !samePaths(unstaged, VERSION_FILES)) {
    throw new Error(`Expected only the five modified version files; staged=${staged.join(',')} unstaged=${unstaged.join(',')} untracked=${untracked.join(',')}`);
  }
  git('add', '--', ...VERSION_FILES);
  if (!samePaths(gitLines('diff', '--cached', '--name-only'), VERSION_FILES) || gitLines('diff', '--name-only').length) {
    throw new Error('Version staging included unexpected changes');
  }
  const tree = git('write-tree');
  if (!SHA.test(tree)) throw new Error('Invalid Git tree identifier');
  return tree;
}
function makeStamp(source, version) {
  const tag = `v${version}`;
  const tree = stageVersionTree(source, version);
  const existing = allTags().find(t => t.tag === tag);
  if (existing && (!existing.source || existing.source !== source || existing.tree !== tree)) {
    throw new Error(`Existing tag ${tag} does not match this exact source tree`);
  }
  const metadata = { schema: 1, source, version, tag, tree };
  mkdirSync('release', { recursive: true });
  writeFileSync(META, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`✓ Versioned build tree ${tree} for ${tag}`);
}
function verifyBuild(source, version) {
  const metadata = JSON.parse(readFileSync(META, 'utf8'));
  checkHead(source);
  requireVersionCheck(`v${version}`);
  if (metadata.schema !== 1 || metadata.source !== source || metadata.version !== version
      || metadata.tag !== `v${version}` || !SHA.test(metadata.tree || '')
      || !samePaths(gitLines('diff', '--cached', '--name-only'), VERSION_FILES)
      || gitLines('diff', '--name-only').length || gitLines('ls-files', '--others', '--exclude-standard').length
      || git('write-tree') !== metadata.tree) {
    throw new Error('The source or staged build tree changed during the build');
  }
  console.log(`✓ Build still matches source tree ${metadata.tree}`);
}
function fileSha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function expectedAssets(version) {
  return [
    `ChashmYar_${version}_x64-setup.exe`, `ChashmYar-${version}-portable.exe`,
    'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'SHA256SUMS.txt',
  ];
}
function localAssets(version) {
  return new Map(expectedAssets(version).map(name => {
    const path = join('release', 'staging', name);
    return [name, { path, size: statSync(path).size, digest: `sha256:${fileSha(path)}` }];
  }));
}
// GitHub's /releases/tags/{tag} endpoint returns *published* releases only.
// Listing with the write-enabled token is necessary to discover existing
// drafts; scan every page and reject ambiguous tags instead of guessing.
function findRelease(repo, tag) {
  const found = [];
  for (let page = 1; page <= 100; page++) {
    const r = gh(['api', `repos/${repo}/releases?per_page=100&page=${page}`]);
    const releases = JSON.parse(r.stdout);
    if (!Array.isArray(releases) || releases.length > 100) throw new Error('Invalid GitHub releases listing');
    found.push(...releases.filter(release => release?.tag_name === tag));
    if (found.length > 1) throw new Error(`Multiple releases claim ${tag}; refusing ambiguous changes`);
    if (releases.length < 100) return found[0] || null;
  }
  throw new Error('GitHub release listing exceeds the 10,000-release safety limit');
}
function getReleaseById(repo, id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid GitHub release ID');
  const release = JSON.parse(gh(['api', `repos/${repo}/releases/${id}`]).stdout);
  if (release?.id !== id) throw new Error('GitHub returned a different release ID');
  return release;
}
function marker(source, tree) { return `<!-- chashmyar-auto-release source=${source} tree=${tree} -->`; }
function validateIdentity(release, tag, expectedMarker) {
  if (!release || !Number.isSafeInteger(release.id) || release.id <= 0 || release.tag_name !== tag
      || ![true, false].includes(release.draft) || release.prerelease !== false
      || typeof release.body !== 'string' || !release.body.includes(expectedMarker)) {
    throw new Error(`Existing ${tag} release is not the matching automatic release; refusing changes`);
  }
  if (!Array.isArray(release.assets)) throw new Error('Release asset list is invalid');
}
function assetMap(release, names, { local, allowMissing = false, allowPending = false } = {}) {
  const result = new Map();
  for (const asset of release.assets) {
    if (!names.includes(asset.name) || result.has(asset.name)) throw new Error(`Unexpected/duplicate release asset: ${asset.name}`);
    if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Release asset is incomplete: ${asset.name}`);
    }
    const pending = asset.digest === null || asset.digest === undefined;
    if ((!pending || !allowPending) && !/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')) {
      throw new Error(`Release asset lacks a valid SHA-256 digest: ${asset.name}`);
    }
    if (local) {
      const expected = local.get(asset.name);
      if (!expected || asset.size !== expected.size || (!pending && asset.digest !== expected.digest)) {
        throw new Error(`Draft asset differs from this build: ${asset.name}; refusing to overwrite it`);
      }
    }
    result.set(asset.name, asset);
  }
  if (!allowMissing && result.size !== names.length) throw new Error('Release does not contain all five verified assets');
  return result;
}
// GitHub may return a null digest briefly after accepting an upload. Wait only
// for missing digests; mismatches, malformed metadata and API errors fail now.
function readyDraft(repo, id, tag, expectedMarker, names, local, allowMissing) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const release = getReleaseById(repo, id);
    validateIdentity(release, tag, expectedMarker);
    if (!release.draft) throw new Error('Release became public before verification finished');
    const assets = assetMap(release, names, { local, allowMissing, allowPending: true });
    const pending = [...assets.values()].filter(asset => asset.digest === null || asset.digest === undefined);
    if (!pending.length) return { release, assets };
    if (attempt === 0) console.log(`Waiting for GitHub SHA-256 digests: ${pending.map(a => a.name).join(', ')}`);
    if (attempt < 23 && !process.env.CHASHMYAR_TEST_GH) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
  }
  throw new Error('GitHub did not provide all asset SHA-256 digests in time; release remains a draft');
}
function verifyPublishedManifest(repo, tag, release, names) {
  const assets = assetMap(release, names);
  const temp = mkdtempSync(join(tmpdir(), 'chashmyar-release-manifest-'));
  try {
    gh(['release', 'download', tag, '--repo', repo, '--dir', temp, '--pattern', 'SHA256SUMS.txt']);
    const file = join(temp, 'SHA256SUMS.txt');
    if (`sha256:${fileSha(file)}` !== assets.get('SHA256SUMS.txt').digest) throw new Error('Published checksum manifest digest mismatch');
    const checks = new Map();
    for (const line of readFileSync(file, 'utf8').trim().split(/\r?\n/)) {
      const m = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
      if (!m || checks.has(m[2])) throw new Error('Published checksum manifest is malformed');
      checks.set(m[2], `sha256:${m[1]}`);
    }
    const otherNames = names.filter(n => n !== 'SHA256SUMS.txt');
    if (checks.size !== otherNames.length) throw new Error('Published checksum manifest has incorrect entries');
    for (const name of otherNames) if (checks.get(name) !== assets.get(name).digest) throw new Error(`Published asset digest mismatch: ${name}`);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function verifyRemoteTag(tag) {
  const expected = git('rev-parse', `refs/tags/${tag}`);
  const lines = gitLines('ls-remote', '--tags', '--refs', 'origin', `refs/tags/${tag}`);
  if (lines.length !== 1 || lines[0].split(/\s+/)[0] !== expected) throw new Error(`Remote tag ${tag} is missing or changed`);
}
function publish(source, version) {
  const tag = `v${version}`, repo = repoEnv();
  const metadata = JSON.parse(readFileSync(META, 'utf8'));
  if (metadata.schema !== 1 || metadata.source !== source || metadata.version !== version
      || metadata.tag !== tag || !SHA.test(metadata.tree || '')) throw new Error('Build metadata does not match this workflow');
  run(process.execPath, ['scripts/stage-release.mjs', '--verify', '--tag', tag]);
  const local = localAssets(version);
  const tree = stageVersionTree(source, version);
  if (tree !== metadata.tree) throw new Error('Build tree and release tag tree differ');
  const plan = planRelease(source);
  if (plan.skip) { console.log(`✓ No publication: ${plan.reason}`); return; }
  if (plan.tag !== tag) throw new Error(`Version allocation changed; expected ${plan.tag}, not ${tag}`);
  const found = allTags().find(t => t.tag === tag);
  if (found) {
    if (!found.source || found.source !== source || found.tree !== tree) throw new Error(`Existing tag ${tag} belongs to another source`);
  } else {
    // Never update main or force a tag. A detached, version-only commit makes
    // GitHub's source archive byte-identical to the tree that was built.
    const config = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
    git(...config, '-c', 'commit.gpgsign=false', 'commit', '-m', `chore(release): ${tag}`, '-m', `Source-Commit: ${source}`);
    const message = `${HEADER}\n\nSource-Commit: ${source}\nTree: ${tree}`;
    git(...config, '-c', 'tag.gpgSign=false', 'tag', '-a', tag, '-m', message);
    git('push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`); // never --force
  }
  verifyRemoteTag(tag);
  // Check repository access separately: a tag endpoint 404 must not be used to
  // hide a missing repository or unavailable credentials.
  gh(['api', `repos/${repo}`]);
  let release = findRelease(repo, tag);
  const expectedMarker = marker(source, tree);
  const names = expectedAssets(version);
  if (release) {
    validateIdentity(release, tag, expectedMarker);
    release = getReleaseById(repo, release.id);
    validateIdentity(release, tag, expectedMarker);
    if (!release.draft) {
      verifyPublishedManifest(repo, tag, release, names);
      console.log(`✓ ${tag} is already public and its existing assets are intact; nothing was overwritten.`);
      return;
    }
  } else {
    const notes = [expectedMarker, '', `Automatically built from main commit ${source}.`,
      'Windows x64 installer and portable; Microsoft Edge WebView2 Runtime is required.',
      'These binaries are unsigned and may trigger SmartScreen. Verify SHA256SUMS.txt.',
      'Automated tests do not replace testing on an actual Windows system.'].join('\n');
    // POST returns the new ID immediately, even if the releases listing is
    // eventually consistent. The remote tag was independently verified above.
    release = JSON.parse(gh(['api', `repos/${repo}/releases`, '--method', 'POST',
      '--raw-field', `tag_name=${tag}`, '--raw-field', `name=ChashmYar ${tag}`,
      '--raw-field', `body=${notes}`, '--field', 'draft=true', '--field', 'prerelease=false',
      '--field', 'generate_release_notes=true']).stdout);
    validateIdentity(release, tag, expectedMarker);
    if (!release.draft) throw new Error('New release was unexpectedly public before verification');
  }
  const releaseId = release.id;
  for (const name of names) {
    // Address the verified release ID directly rather than letting a tag-based
    // CLI lookup choose between drafts. Never clobber an existing asset.
    const { assets: present } = readyDraft(repo, releaseId, tag, expectedMarker, names, local, true);
    if (!present.has(name)) {
      const url = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
      gh(['api', url, '--method', 'POST', '--header', 'Content-Type: application/octet-stream',
        '--input', local.get(name).path]);
    }
  }
  ({ release } = readyDraft(repo, releaseId, tag, expectedMarker, names, local, false));
  verifyRemoteTag(tag);
  // Recheck uniqueness. A short retry tolerates a newly created release taking
  // a moment to appear in GitHub's listing; errors never cause publication.
  let listed = null;
  for (let attempt = 0; attempt < 5 && !listed; attempt++) {
    listed = findRelease(repo, tag);
    if (!listed && attempt < 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  if (!listed || listed.id !== releaseId) throw new Error('Cannot confirm a unique matching release before publication');
  validateIdentity(listed, tag, expectedMarker);
  if (!listed.draft) throw new Error('Release was published externally before verification finished');
  release = getReleaseById(repo, releaseId);
  validateIdentity(release, tag, expectedMarker);
  if (!release.draft) throw new Error('Release was published externally before verification finished');
  assetMap(release, names, { local });
  // Publish the precise ID automatically after the five uploaded hashes match.
  // Supplying tag_name prevents GitHub's edit API from clearing the tag.
  gh(['api', `repos/${repo}/releases/${releaseId}`, '--method', 'PATCH',
    '--raw-field', `tag_name=${tag}`, '--field', 'draft=false', '--field', 'prerelease=false']);
  release = getReleaseById(repo, releaseId);
  validateIdentity(release, tag, expectedMarker);
  if (release.draft) throw new Error('GitHub did not publish the release');
  assetMap(release, names, { local });
  console.log(`✓ Published ${tag} with five verified assets: ${release.html_url || ''}`);
}

try {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !['plan', 'stamp', 'verify-build', 'publish'].includes(command)) {
    throw new Error('Usage: node scripts/auto-release.mjs plan|stamp|verify-build|publish');
  }
  const source = sourceSha();
  if (command === 'plan') {
    checkHead(source);
    requireVersionCheck(`v${versionAt(source)}`);
    const plan = planRelease(source);
    writeOutputs(plan);
    console.log(JSON.stringify(plan));
  } else if (command === 'stamp') {
    makeStamp(source, versionEnv());
  } else if (command === 'verify-build') {
    verifyBuild(source, versionEnv());
  } else {
    publish(source, versionEnv());
  }
} catch (error) {
  console.error('Automatic release error:', error.message);
  process.exitCode = 1;
}
