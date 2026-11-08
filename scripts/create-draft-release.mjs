#!/usr/bin/env node
/** Create/update only a GitHub Release draft; never overwrite a published release. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const tag = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
if (process.argv.length !== 3 || !tag || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) {
  console.error('Usage: GITHUB_REPOSITORY=owner/repo node scripts/create-draft-release.mjs vX.Y.Z'); process.exit(1);
}
const check = spawnSync(process.execPath, ['scripts/stage-release.mjs', '--verify', '--tag', tag], { stdio: 'inherit' });
if (check.error || check.status !== 0) process.exit(1);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const paths = [
  `ChashmYar_${version}_x64-setup.exe`, `ChashmYar-${version}-portable.exe`,
  'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'SHA256SUMS.txt',
].map((name) => join('release/staging', name));

// The test override runs a local fake CLI, never a real GitHub request.
function gh(args) {
  const fake = process.env.CHASHMYAR_TEST_GH;
  const result = fake
    ? spawnSync(process.execPath, [fake, ...args], { encoding: 'utf8', env: process.env })
    : spawnSync('gh', args, { encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  return result;
}
function successful(result, action) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(`${action} failed: ${(result.stderr || '').trim()}`);
}
try {
  const view = gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft']);
  if (view.status === 0) {
    const data = JSON.parse(view.stdout);
    if (data.isDraft !== true) throw new Error(`${tag} is already published; refusing to replace its assets`);
    // Rerunning a draft updates assets but preserves the maintainer's release notes.
    successful(gh(['release', 'upload', tag, ...paths, '--repo', repo, '--clobber']), 'Uploading draft assets');
    console.log(`✓ Updated existing draft ${tag}; release notes were preserved.`);
  } else if (/release not found/i.test(view.stderr || '')) {
    const notes = [
      'Windows x64: choose the setup or portable executable. WebView2 Runtime is required.',
      'These binaries are unsigned and may trigger Windows SmartScreen.',
      'Check SHA256SUMS.txt and review THIRD_PARTY_NOTICES.txt before distribution.',
      'This draft must be reviewed and explicitly published by the maintainer.',
    ].join('\n');
    successful(gh([
      'release', 'create', tag, ...paths, '--repo', repo, '--verify-tag', '--draft',
      '--title', `ChashmYar ${tag}`, '--notes', notes, '--generate-notes',
    ]), 'Creating draft release');
    console.log(`✓ Created draft ${tag}; it is not public until you publish it.`);
  } else {
    throw new Error(`Cannot safely determine release state: ${(view.stderr || '').trim() || `gh exited ${view.status}`}`);
  }
} catch (error) {
  console.error('Draft release error:', error.message);
  process.exitCode = 1;
}
