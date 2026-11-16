#!/usr/bin/env node
/**
 * On Windows, audit the exact staged portable EXE and the application EXE
 * extracted from the staged NSIS installer. Each executable reports hashes of
 * its real Tauri Context.assets() without starting the GUI. Compare every hash
 * to the Vite output and check build flavor, version and both updater keys.
 * This is a release gate, not a substitute for an interactive WebView2 test.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePublicKey } from './updater-signatures.mjs';

export const AUDIT_MARKER = 'CHASHMYAR_RELEASE_AUDIT_V1';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Inventory the current built frontend, including referenced entry assets. */
export function frontendManifest(dir) {
  const files = {};
  const walk = (folder, prefix = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.isFile()) {
        const bytes = readFileSync(path);
        if (!bytes.length) throw new Error(`Empty frontend asset: ${relative}`);
        files[`/${relative}`] = sha(bytes);
      } else throw new Error(`Unexpected non-file frontend entry: ${relative}`);
    }
  };
  walk(dir);
  if (!files['/index.html']) throw new Error('Frontend index.html is missing');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  if (!/\bid\s*=\s*["']root["']/.test(html)) throw new Error('Frontend index has no React root');
  let scripts = 0, styles = 0;
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag);
    const isStyle = /^<link\b/i.test(tag) && /\brel\s*=\s*["']stylesheet["']/i.test(tag);
    const ref = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if ((isScript || isStyle) && !ref) throw new Error('Frontend script or stylesheet has no local reference');
    if (!ref) continue;
    // Do not let a remote URL or parent path pass as an embedded asset.
    if (!/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(ref) || ref.split('/').includes('..')) {
      throw new Error(`Frontend reference is not a local absolute asset path: ${ref}`);
    }
    if (!files[ref]) throw new Error(`Referenced frontend asset is missing: ${ref}`);
    if (isScript && /\.m?js$/i.test(ref)) scripts++;
    if (isStyle && /\.css$/i.test(ref)) styles++;
  }
  if (!scripts || !styles) throw new Error('Frontend index must reference embedded JavaScript and CSS');
  return files;
}

/** Validate a report produced by the native executable; never log key values. */
export function validateReport(report, { version, flavor, publicKey, expectedAssets }) {
  if (!report || report.marker !== AUDIT_MARKER || report.ok !== true) {
    throw new Error(`Native payload audit failed: ${report?.error || 'invalid or missing report'}`);
  }
  if (report.productionProtocol !== true) throw new Error('Tauri production protocol is not enabled');
  if (report.version !== version || report.configVersion !== version) throw new Error('Executable version does not match the release');
  if (report.flavor !== flavor) throw new Error(`Wrong executable flavor (expected ${flavor})`);
  if (!publicKey || report.updaterPublicKey !== publicKey || report.configPublicKey !== publicKey) {
    throw new Error('Executable updater key or configuration does not match the release public key');
  }
  const assets = report.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) throw new Error('Native asset inventory is missing');
  const actualNames = Object.keys(assets).sort(), expectedNames = Object.keys(expectedAssets).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error('Executable frontend asset inventory differs from dist');
  for (const name of expectedNames) {
    if (!/^[a-f0-9]{64}$/.test(assets[name]) || assets[name] !== expectedAssets[name]) {
      throw new Error(`Executable embedded asset differs from dist: ${name}`);
    }
  }
  return actualNames.length;
}

function sevenZipExecutable(env) {
  if (env.CHASHMYAR_7ZIP) {
    if (!existsSync(env.CHASHMYAR_7ZIP)) throw new Error('CHASHMYAR_7ZIP does not point to an existing 7z.exe');
    return env.CHASHMYAR_7ZIP;
  }
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
    const path = join(base, '7-Zip', '7z.exe');
    if (existsSync(path)) return path;
  }
  // Also allow 7z.exe on PATH; the GitHub Windows runner includes 7-Zip.
  return '7z.exe';
}

function runCheck(exe, flavor, temp, expected, env) {
  const image = readFileSync(exe);
  if (!image.includes(Buffer.from(AUDIT_MARKER))) {
    throw new Error(`${basename(exe)} cannot perform the native payload audit; refuse to launch it`);
  }
  const imageHash = sha(image);
  const reportPath = join(temp, `${flavor}-report.json`);
  const childEnv = { ...env };
  delete childEnv.TAURI_SIGNING_PRIVATE_KEY;
  delete childEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  const run = spawnSync(exe, ['--verify-release-payload', reportPath], {
    encoding: 'utf8', env: childEnv, windowsHide: true, timeout: 90_000,
  });
  let report;
  if (existsSync(reportPath)) {
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
    catch { throw new Error(`${flavor}: malformed native audit report`); }
  }
  if (run.error || run.status !== 0) {
    throw new Error(`${flavor}: native audit exited ${run.status ?? run.signal ?? 'without a status'}: ${report?.error || run.error?.message || 'no valid report'}`);
  }
  const count = validateReport(report, { ...expected, flavor });
  if (sha(readFileSync(exe)) !== imageHash) throw new Error(`${flavor}: executable changed during the audit`);
  console.log(`✓ ${flavor}: production Tauri context, version, updater key and ${count} embedded assets verified`);
}

function main() {
  if (process.platform !== 'win32') throw new Error('The release-payload audit must run on Windows x64');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const publicKey = (process.env.CHASHMYAR_UPDATER_PUBLIC_KEY || '').trim();
  parsePublicKey(publicKey);
  const expected = { version, publicKey, expectedAssets: frontendManifest('dist') };
  const staging = resolve('release/staging');
  const installer = join(staging, `ChashmYar_${version}_x64-setup.exe`);
  const portable = join(staging, `ChashmYar-${version}-portable.exe`);
  const temp = mkdtempSync(join(tmpdir(), 'chashmyar-payload-'));
  try {
    const setupHash = sha(readFileSync(installer));
    const extract = spawnSync(sevenZipExecutable(process.env), ['x', '-y', `-o${temp}`, installer, 'chashmyar.exe'], {
      encoding: 'utf8', windowsHide: true, timeout: 120_000,
    });
    if (extract.error || extract.status !== 0) {
      throw new Error(`Cannot extract NSIS payload with 7-Zip: ${extract.error?.message || (extract.stderr || extract.stdout || `exit ${extract.status}`).trim().slice(-700)}`);
    }
    const installedApp = join(temp, 'chashmyar.exe');
    if (!existsSync(installedApp)) throw new Error('NSIS installer does not contain chashmyar.exe at the expected location');
    runCheck(installedApp, 'installed', temp, expected, process.env);
    runCheck(portable, 'portable', temp, expected, process.env);
    if (sha(readFileSync(installer)) !== setupHash) throw new Error('NSIS installer changed during the audit');
    console.log('✓ Both staged release flavors passed the independent native payload audit.');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error('Release payload error:', error.message); process.exitCode = 1; }
}
