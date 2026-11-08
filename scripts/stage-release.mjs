#!/usr/bin/env node
/** Stage the exact GitHub Release assets or verify an already staged set. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
const installer = `ChashmYar_${version}_x64-setup.exe`;
const portable = `ChashmYar-${version}-portable.exe`;
const assets = [installer, portable, 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];
const stage = join(root, 'release/staging');
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function verifyPE(path, name) {
  const buf = readFileSync(path);
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error(`${name}: not a PE/MZ executable`);
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 26 > buf.length || buf.toString('binary', pe, pe + 4) !== 'PE\0\0') throw new Error(`${name}: invalid PE signature`);
  const machine = buf.readUInt16LE(pe + 4);
  if (name === portable && machine !== 0x8664) throw new Error(`${name}: expected x64 application`);
  if (name === installer && machine !== 0x14c && machine !== 0x8664) throw new Error(`${name}: unexpected NSIS stub architecture`);
}
function verify() {
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
  verifyPE(join(stage, installer), installer);
  verifyPE(join(stage, portable), portable);
  console.log(`✓ Verified ${assets.length} release assets and SHA256SUMS.txt for v${version}`);
}
try {
  if (!verifyOnly) {
    const sources = new Map([
      [installer, join(root, 'release/windows', installer)],
      [portable, join(root, 'release/windows', portable)],
      ['LICENSE', join(root, 'LICENSE')],
      ['THIRD_PARTY_NOTICES.txt', join(root, 'THIRD_PARTY_NOTICES.txt')],
    ]);
    for (const [name, file] of sources) if (!existsSync(file)) throw new Error(`Missing ${name}: ${file}`);
    verifyPE(sources.get(installer), installer); verifyPE(sources.get(portable), portable);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    for (const [name, file] of sources) copyFileSync(file, join(stage, name));
    const checksums = assets.map((name) => `${sha(join(stage, name))}  ${name}`).join('\n') + '\n';
    writeFileSync(join(stage, 'SHA256SUMS.txt'), checksums);
  }
  verify();
} catch (error) {
  console.error('Release asset error:', error.message);
  process.exitCode = 1;
}
