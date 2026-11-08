#!/usr/bin/env node
/** Build an over-inclusive, reproducible third-party notice inventory.
 * Includes locked Windows-target Cargo dependencies (including build deps) and
 * installed non-dev npm dependencies. MIT for this app does not relicense them.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const out = join(root, 'THIRD_PARTY_NOTICES.txt');
const checkOnly = process.argv.slice(2).includes('--check');
const fallbackDir = join(root, 'third-party/fallback-licenses');
const fallbacks = {
  'alloc-stdlib@0.3.0': ['alloc-stdlib-0.3.0.txt'],
  'selectors@0.38.0': ['selectors-mpl-2.0.txt'],
  'tauri-plugin@2.7.2': ['tauri-plugin-mit.txt', 'tauri-plugin-apache.txt'],
  'webview2-com@0.39.1': ['webview2-com.txt'],
  'webview2-com-macros@0.8.1': ['webview2-com-macros.txt'],
  'webview2-com-sys@0.39.1': ['webview2-com-sys.txt'],
};
const licenseName = /^(licen[sc]e|copying|notice)(?:[.\-_].*)?$/i;
const blocks = new Map();
const entries = [];

function textFile(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text || text.includes('\0')) throw new Error(`Unreadable license text: ${file}`);
  return text;
}
function addText(text) {
  const id = createHash('sha256').update(text).digest('hex').slice(0, 16);
  if (blocks.has(id) && blocks.get(id) !== text) throw new Error(`Notice digest collision: ${id}`);
  blocks.set(id, text);
  return id;
}
function localLicenseFiles(dir, explicitFile) {
  const names = readdirSync(dir).filter((name) => {
    const p = join(dir, name);
    return licenseName.test(name) && statSync(p).isFile();
  }).sort();
  const result = names.map((name) => ({ label: name, file: join(dir, name) }));
  if (explicitFile && existsSync(explicitFile) && !result.some((item) => item.file === explicitFile)) {
    result.push({ label: basename(explicitFile), file: explicitFile });
  }
  return result;
}
function collect(kind, name, version, license, source, vcs, licenseFiles) {
  if (!license) throw new Error(`${kind} ${name}@${version} does not declare a license; review it before release`);
  if (!licenseFiles.length) throw new Error(`${kind} ${name}@${version} has no license file; add a documented fallback before release`);
  const refs = licenseFiles.map(({ label, file }) => ({ label, id: addText(textFile(file)) }));
  entries.push({ kind, name, version, license, source: source || 'See package registry', vcs, refs });
}

try {
  const cargo = spawnSync('cargo', [
    'metadata', '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc',
    '--manifest-path', 'src-tauri/Cargo.toml',
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (cargo.error) throw cargo.error;
  if (cargo.status !== 0) throw new Error(`cargo metadata failed: ${cargo.stderr.trim()}`);
  const metadata = JSON.parse(cargo.stdout);
  for (const p of metadata.packages) {
    if (!p.source) continue; // This app is covered separately by LICENSE.
    const dir = dirname(p.manifest_path);
    let files = localLicenseFiles(dir, p.license_file);
    const key = `${p.name}@${p.version}`;
    if (!files.length && fallbacks[key]) {
      files = fallbacks[key].map((name) => ({ label: `fallback/${name}`, file: join(fallbackDir, name) }));
    }
    let vcs;
    const vcsFile = join(dir, '.cargo_vcs_info.json');
    if (existsSync(vcsFile)) {
      try { vcs = JSON.parse(readFileSync(vcsFile, 'utf8')).git?.sha1; } catch { /* Optional metadata. */ }
    }
    collect('Cargo', p.name, p.version, p.license || (p.license_file ? 'See included license file' : null),
      p.repository || `https://crates.io/crates/${p.name}/${p.version}`, vcs, files);
  }

  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  for (const [location, p] of Object.entries(lock.packages || {})) {
    if (!location || p.dev || p.devOptional || p.optional) continue;
    const dir = join(root, location);
    if (!existsSync(dir)) throw new Error(`${location} is missing; run npm ci first`);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
    collect('npm', manifest.name, manifest.version, manifest.license || p.license,
      manifest.homepage || repo || `https://www.npmjs.com/package/${manifest.name}`, undefined,
      localLicenseFiles(dir));
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  entries.sort((a, b) => compare(`${a.kind}:${a.name}@${a.version}`, `${b.kind}:${b.name}@${b.version}`));
  const lines = [
    'CHASHMYAR — THIRD-PARTY NOTICES',
    '',
    'ChashmYar source is offered under the MIT License in LICENSE. The components',
    'below are independently licensed by their respective copyright holders.',
    'This inventory includes all locked Windows-target Cargo metadata dependencies',
    '(including build dependencies) and installed non-dev npm dependencies; it may',
    'be over-inclusive and does not assert that every listed component is shipped.',
    'Multiple-license expressions are reproduced as declared by each package.',
    'Review obligations and applicable source offers before distributing binaries.',
    'Fallback files and provenance are documented in third-party/fallback-licenses.',
    '',
    '==================== COMPONENT INVENTORY ====================',
    '',
  ];
  for (const e of entries) {
    lines.push(`${e.kind}: ${e.name} ${e.version}`, `Declared license: ${e.license}`, `Source: ${e.source}`);
    if (e.vcs) lines.push(`Source revision: ${e.vcs}`);
    for (const ref of e.refs) lines.push(`License text: ${ref.id} (${ref.label})`);
    lines.push('');
  }
  lines.push('==================== LICENSE TEXTS ====================', '');
  for (const [id, text] of [...blocks.entries()].sort(([a], [b]) => compare(a, b))) {
    lines.push(`-------------------- ${id} --------------------`, text, '');
  }
  const content = lines.join('\n') + '\n';
  if (checkOnly) {
    if (!existsSync(out) || readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== content) {
      throw new Error('THIRD_PARTY_NOTICES.txt is out of date; run npm run licenses:generate and review/commit it');
    }
  } else writeFileSync(out, content);
  console.log(`✓ ${checkOnly ? 'Verified' : 'Generated'} notices: ${entries.length} components, ${blocks.size} distinct license texts`);
} catch (error) {
  console.error('Notices error:', error.message);
  process.exitCode = 1;
}
