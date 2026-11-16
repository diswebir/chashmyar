#!/usr/bin/env node
// Signed NSIS build, followed by a separate portable-feature build. The
// public key is merged into Tauri's build configuration in memory; no tracked
// source or private-key file is created or changed by this script.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePublicKey } from './updater-signatures.mjs';

export function makeWindowsBuildPlan(environment) {
  const publicKey = (environment.CHASHMYAR_UPDATER_PUBLIC_KEY || '').trim();
  parsePublicKey(publicKey);
  if (!environment.TAURI_SIGNING_PRIVATE_KEY) throw new Error('TAURI_SIGNING_PRIVATE_KEY must be set for signed Windows builds');
  // option_env! embeds this exact value in both binaries. Trim a possible
  // trailing newline from a copied .pub file, as the plugin's decoder is strict.
  const env = { ...environment, CHASHMYAR_UPDATER_PUBLIC_KEY: publicKey };
  const cli = join('node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const config = JSON.stringify({ plugins: { updater: { pubkey: publicKey } } });
  return [
    { cmd: process.execPath, args: [cli, 'build', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--config', config, '--ci', '--', '--locked'], env },
    { cmd: 'cargo', args: ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--target', 'x86_64-pc-windows-msvc', '--release', '--locked', '--features', 'portable'], env },
    { cmd: process.execPath, args: ['scripts/collect-exe.mjs'], env },
  ];
}

function main() {
  try {
    for (const { cmd, args, env } of makeWindowsBuildPlan(process.env)) {
      const result = spawnSync(cmd, args, { stdio: 'inherit', env });
      if (result.error || result.status !== 0) throw result.error ?? new Error(`${cmd} failed (${result.status})`);
    }
  } catch (error) {
    // Never include environment values or command arguments here: the private
    // signing key is only supplied to the child through its environment.
    console.error('Windows build error:', error.message);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
