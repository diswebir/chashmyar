#!/usr/bin/env node
/** Stage and independently verify the signed GitHub Release assets. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parsePublicKey, verifyTauriSignature } from './updater-signatures.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
let verifyOnly = false, tag;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--verify' && !verifyOnly) verifyOnly = true;
  else if (args[i] === '--tag' && tag === undefined && args[i + 1]) tag = args[++i];
  else { console.error('Usage: node scripts/stage-release.mjs [--verify] [--tag vX.Y.Z]'); process.exit(1); }
}
const versionCheck = spawnSync(process.execPath, ['scripts/version.mjs', 'check', ...(tag === undefined ? [] : ['--tag', tag])], { cwd: root, stdio: 'inherit' });
if (versionCheck.error || versionCheck.status !== 0) process.exit(1);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const repo = process.env.GITHUB_REPOSITORY || 'diswebir/chashmyar';
const publicKey = process.env.CHASHMYAR_UPDATER_PUBLIC_KEY || '';
const installer = `ChashmYar_${version}_x64-setup.exe`;
const portable = `ChashmYar-${version}-portable.exe`;
const assets = [installer, portable, `${installer}.sig`, `${portable}.sig`, 'latest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];
const stage = join(root, 'release/staging');
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function expectedManifest(readSig) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY must be owner/repository');
  const base = `https://github.com/${repo}/releases/download/v${version}/`;
  return {
    version,
    notes: `ChashmYar ${version}`,
    platforms: {
      'windows-x86_64': { url: base + installer, signature: readSig(installer).trim() },
      'windows-x86_64-portable': { url: base + portable, signature: readSig(portable).trim() },
    },
  };
}
function verifyPE(path, name) {
  const buf = readFileSync(path);
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error(`${name}: not a PE/MZ executable`);
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 26 > buf.length || buf.toString('binary', pe, pe + 4) !== 'PE\0\0') throw new Error(`${name}: invalid PE signature`);
  const machine = buf.readUInt16LE(pe + 4);
  if (name === portable && machine !== 0x8664) throw new Error(`${name}: expected x64 application`);
  if (name === installer && machine !== 0x14c && machine !== 0x8664) throw new Error(`${name}: unexpected NSIS stub architecture`);
  if (name === portable) {
    // Catch stale/incorrect Cargo feature builds or a missing embedded key.
    // The installer is a compressed NSIS container, so this direct byte check
    // is applicable only to the standalone executable.
    if (!buf.includes(Buffer.from('CHASHMYAR_PORTABLE_UPDATER_V1')) || buf.includes(Buffer.from('CHASHMYAR_NSIS_UPDATER_V1'))) {
      throw new Error(`${name}: not a portable-updater build`);
    }
    if (!buf.includes(Buffer.from(publicKey.trim(), 'utf8'))) throw new Error(`${name}: expected updater public key is not embedded`);
  }
}
function verifyStage() {
  parsePublicKey(publicKey); // fail closed when the build or publication key is missing
  const expected = [...assets, 'SHA256SUMS.txt'].sort();
  const actual = readdirSync(stage).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Unexpected stage contents: ${actual.join(', ')}`);
  const lines = readFileSync(join(stage, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
  const hashes = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match || hashes.has(match[2])) throw new Error('Malformed or duplicate checksum entry');
    hashes.set(match[2], match[1]);
  }
  if (hashes.size !== assets.length) throw new Error('Checksum manifest must name every staged asset exactly once');
  for (const name of assets) {
    const file = join(stage, name);
    if (hashes.get(name) !== sha(file)) throw new Error(`Checksum mismatch for ${name}`);
  }
  const readSig = (name) => readFileSync(join(stage, `${name}.sig`), 'utf8');
  const manifest = JSON.parse(readFileSync(join(stage, 'latest.json'), 'utf8'));
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest(readSig))) throw new Error('Updater manifest differs from signed Release assets');
  for (const name of [installer, portable]) {
    const file = join(stage, name);
    verifyPE(file, name);
    verifyTauriSignature(readFileSync(file), readSig(name), publicKey, version, name);
  }
  console.log(`✓ Verified ${assets.length} signed Release assets and SHA256SUMS.txt for v${version}`);
}
try {
  parsePublicKey(publicKey);
  if (!verifyOnly) {
    const sources = new Map([
      [installer, join(root, 'release/windows', installer)],
      [portable, join(root, 'release/windows', portable)],
      [`${installer}.sig`, join(root, 'release/updater', `${installer}.sig`)],
      [`${portable}.sig`, join(root, 'release/updater', `${portable}.sig`)],
      ['LICENSE', join(root, 'LICENSE')],
      ['THIRD_PARTY_NOTICES.txt', join(root, 'THIRD_PARTY_NOTICES.txt')],
    ]);
    for (const [name, file] of sources) if (!existsSync(file)) throw new Error(`Missing ${name}: ${file}`);
    for (const name of [installer, portable]) {
      verifyPE(sources.get(name), name);
      verifyTauriSignature(readFileSync(sources.get(name)), readFileSync(sources.get(`${name}.sig`), 'utf8'), publicKey, version, name);
    }
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    for (const [name, file] of sources) copyFileSync(file, join(stage, name));
    const readSig = (name) => readFileSync(join(stage, `${name}.sig`), 'utf8');
    writeFileSync(join(stage, 'latest.json'), JSON.stringify(expectedManifest(readSig), null, 2) + '\n');
    const checksums = assets.map((name) => `${sha(join(stage, name))}  ${name}`).join('\n') + '\n';
    writeFileSync(join(stage, 'SHA256SUMS.txt'), checksums);
  }
  verifyStage();
} catch (error) {
  console.error('Release asset error:', error.message);
  process.exitCode = 1;
}
