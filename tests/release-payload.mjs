// Cross-platform regression tests for the independent release-payload audit.
// These use synthetic reports/assets, not real Windows executables.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIT_MARKER, frontendManifest, validateReport } from '../scripts/verify-release-payload.mjs';

const dir = mkdtempSync(join(tmpdir(), 'chashmyar-payload-test-'));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const fails = (f, message) => { assert.throws(f, message); checks++; };
try {
  mkdirSync(join(dir, 'assets'));
  const index = '<!doctype html><div id="root"></div><script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css"><link rel="icon" href="/assets/icon.png">';
  writeFileSync(join(dir, 'index.html'), index);
  for (const [name, content] of [['main.js', 'console.log(42)'], ['main.css', 'body{color:black}'], ['icon.png', 'not-an-empty-icon']]) {
    writeFileSync(join(dir, 'assets', name), content);
  }
  const expectedAssets = frontendManifest(dir);
  ok(Object.keys(expectedAssets).length === 4, 'all files are inventoried');
  const expected = { version: '2.4.8', flavor: 'portable', publicKey: 'a-public-key', expectedAssets };
  const base = {
    marker: AUDIT_MARKER, ok: true, error: null, version: expected.version,
    configVersion: expected.version, flavor: expected.flavor, productionProtocol: true,
    updaterPublicKey: expected.publicKey, configPublicKey: expected.publicKey,
    assets: { ...expectedAssets },
  };
  ok(validateReport(base, expected) === 4, 'a matching production portable report is accepted');
  ok(validateReport({ ...base, flavor: 'installed' }, { ...expected, flavor: 'installed' }) === 4, 'an independently checked installer payload is accepted');
  for (const [label, changes] of [
    ['marker', { marker: 'old-binary' }], ['native failure', { ok: false, error: 'dev mode' }],
    ['development protocol', { productionProtocol: false }], ['Cargo version', { version: '2.4.7' }],
    ['config version', { configVersion: '2.4.7' }], ['wrong flavor', { flavor: 'installed' }],
    ['wrong runtime key', { updaterPublicKey: 'other' }], ['wrong config key', { configPublicKey: 'other' }],
    ['missing inventory', { assets: null }], ['empty inventory', { assets: {} }],
    ['missing JS', { assets: Object.fromEntries(Object.entries(expectedAssets).filter(([p]) => p !== '/assets/main.js')) }],
    ['extra asset', { assets: { ...expectedAssets, '/extra': '0'.repeat(64) } }],
    ['modified embedded CSS', { assets: { ...expectedAssets, '/assets/main.css': '0'.repeat(64) } }],
  ]) fails(() => validateReport({ ...base, ...changes }, expected), `${label} is rejected`);
  fails(() => validateReport(base, { ...expected, publicKey: '' }), 'an empty expected key is rejected');
  for (const [label, html] of [
    ['no root', index.replace('id="root"', 'id="not-root"')],
    ['missing JS', index.replace('/assets/main.js', '/assets/missing.js')],
    ['remote JS', index.replace('/assets/main.js', 'https://example.invalid/main.js')],
    ['parent traversal', index.replace('/assets/main.js', '/assets/../main.js')],
    ['no stylesheet', index.replace('rel="stylesheet"', 'rel="preload"')],
    ['no script', index.replace(/<script[^>]+><\/script>/, '')],
  ]) {
    writeFileSync(join(dir, 'index.html'), html);
    fails(() => frontendManifest(dir), `${label} is rejected`);
  }
  writeFileSync(join(dir, 'index.html'), index);
  writeFileSync(join(dir, 'assets/main.css'), '');
  fails(() => frontendManifest(dir), 'empty assets are rejected');
  const main = readFileSync('src-tauri/src/main.rs', 'utf8');
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8');
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  ok(main.indexOf('release_payload::handle_command') < main.indexOf('portable_replace::wait_before_startup'), 'audit runs before portable update and GUI startup');
  ok(lib.includes('.build(app_context())') && lib.includes('!tauri::is_dev()'), 'GUI and audit share a context and release builds fail closed');
  ok(workflow.indexOf('npm run verify:payload') > workflow.indexOf('node scripts/stage-release.mjs') && workflow.indexOf('npm run verify:payload') < workflow.indexOf('Upload verified build'), 'staged payloads are audited before upload');
  const nativeAudit = readFileSync('src-tauri/src/release_payload.rs', 'utf8');
  const compat = readFileSync('tests/rust-compat/src/lib.rs', 'utf8');
  ok(lib.includes('mod release_hash;') && nativeAudit.includes('crate::release_hash::sha256_hex(') && compat.includes('src-tauri/src/release_hash.rs'), 'compat tests compile the real hash helper used by the native audit');
  const appSpec = /^sha2\s*=\s*"([^"]+)"/m.exec(readFileSync('src-tauri/Cargo.toml', 'utf8'))?.[1];
  const testSpec = /^sha2\s*=\s*"([^"]+)"/m.exec(readFileSync('tests/rust-compat/Cargo.toml', 'utf8'))?.[1];
  ok(Boolean(appSpec) && appSpec === testSpec, 'application and hash regression test use the same sha2 constraint');
  const lockedDirectSha2 = (lock, packageName) => {
    const block = lock.split(/\r?\n\r?\n/).find((s) => s.startsWith(`[[package]]\nname = "${packageName}"`) || s.startsWith(`[[package]]\r\nname = "${packageName}"`));
    const ref = /^\s*"sha2(?: ([^"]+))?",?\s*$/m.exec(block || '');
    const versions = [...lock.matchAll(/\[\[package\]\]\r?\nname = "sha2"\r?\nversion = "([^"]+)"/g)].map((m) => m[1]);
    if (!ref) return undefined;
    return ref[1] && versions.includes(ref[1]) ? ref[1] : !ref[1] && versions.length === 1 ? versions[0] : undefined;
  };
  const appSha2 = lockedDirectSha2(readFileSync('src-tauri/Cargo.lock', 'utf8'), 'chashmyar');
  const testSha2 = lockedDirectSha2(readFileSync('tests/rust-compat/Cargo.lock', 'utf8'), 'chashmyar-compat-tests');
  ok(Boolean(appSha2) && appSha2 === testSha2, 'application and hash regression test lock the same sha2 version');
  console.log(`PASS: ${checks} release payload/negative-regression assertions (synthetic fixtures).`);
} finally { rmSync(dir, { recursive: true, force: true }); }
