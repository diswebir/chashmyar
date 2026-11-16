#!/usr/bin/env node
/** Sign the portable EXE and collect Tauri's NSIS signature, without modifying
 * retained release/windows files. Only the public key is compiled into apps. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parsePublicKey, verifyTauriSignature } from './updater-signatures.mjs';

try {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const installer = `ChashmYar_${version}_x64-setup.exe`;
  const portable = `ChashmYar-${version}-portable.exe`;
  const publicKey = process.env.CHASHMYAR_UPDATER_PUBLIC_KEY || '';
  parsePublicKey(publicKey);
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('TAURI_SIGNING_PRIVATE_KEY is required');
  const installerExe = join('release/windows', installer);
  const portableExe = join('release/windows', portable);
  const nsisSig = join('src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis', `${installer}.sig`);
  for (const path of [installerExe, portableExe, nsisSig]) if (!existsSync(path)) throw new Error(`Missing ${path}`);
  const out = join('release/updater');
  mkdirSync(out, { recursive: true });
  copyFileSync(nsisSig, join(out, `${installer}.sig`));
  // Sign a disposable copy in release/updater; never overwrite the retained EXE.
  const work = join(out, portable);
  const sig = `${work}.sig`;
  copyFileSync(portableExe, work);
  try {
    const cli = join('node_modules', '@tauri-apps', 'cli', 'tauri.js');
    const result = spawnSync(process.execPath, [cli, 'signer', 'sign', work, '--app-version', version], { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error ?? new Error('Tauri portable signing failed');
    for (const [name, exe] of [[installer, installerExe], [portable, portableExe]]) {
      verifyTauriSignature(readFileSync(exe), readFileSync(join(out, `${name}.sig`), 'utf8'), publicKey, version, name);
    }
    console.log('✓ Both signatures match the configured public key, file names and version.');
  } finally { rmSync(work, { force: true }); }
} catch (error) {
  console.error('Updater signing error:', error.message);
  process.exitCode = 1;
}
