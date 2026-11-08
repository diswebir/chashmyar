#!/usr/bin/env node
/** Keep the five release version fields in sync. Run from the project root. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = {
  pkg: 'package.json', lock: 'package-lock.json',
  tauri: 'src-tauri/tauri.conf.json', cargo: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
};
const path = (key) => join(root, files[key]);
const read = (key) => readFileSync(path(key), 'utf8');
const json = (key) => JSON.parse(read(key));
const saveJson = (key, obj) => writeFileSync(path(key), JSON.stringify(obj, null, 2) + '\n');
const cargoVersionPattern = /(^\[package\][\s\S]*?^version\s*=\s*")([^"\r\n]+)(")/m;
const cargoLockPattern = /(^\[\[package\]\]\r?\nname\s*=\s*"chashmyar"\r?\nversion\s*=\s*")([^"\r\n]+)(")/gm;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateVersion(version) {
  if (typeof version !== 'string' || !stableVersion.test(version)) {
    throw new Error(`Expected a stable version MAJOR.MINOR.PATCH (e.g. 2.3.2), got ${version}`);
  }
  if (version.split('.').some((n) => Number(n) > 65535)) {
    throw new Error('Windows version components must be no greater than 65535');
  }
}
function singleMatch(text, pattern, name) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${name} version, found ${matches.length}`);
  return matches[0][2];
}
function versions() {
  const pkg = json('pkg'), lock = json('lock'), tauri = json('tauri');
  return {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json root package': lock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': tauri.version,
    'src-tauri/Cargo.toml': singleMatch(read('cargo'), cargoVersionPattern, 'Cargo.toml'),
    'src-tauri/Cargo.lock': singleMatch(read('cargoLock'), cargoLockPattern, 'Cargo.lock'),
  };
}
function check(tag) {
  const all = versions();
  const v = all['package.json'];
  validateVersion(v);
  for (const [name, value] of Object.entries(all)) {
    if (value !== v) throw new Error(`Version mismatch: ${name} has ${value}, expected ${v}`);
  }
  if (tag !== undefined && tag !== `v${v}`) throw new Error(`Tag must be v${v}; got ${tag}`);
  console.log(`✓ Version ${v} is consistent${tag ? ` with tag ${tag}` : ''}`);
}
function setVersion(v) {
  validateVersion(v);
  // Parse and validate all inputs before writing any file.
  versions();
  const pkg = json('pkg'), lock = json('lock'), tauri = json('tauri');
  const cargo = read('cargo'), cargoLock = read('cargoLock');
  pkg.version = v; lock.version = v; lock.packages[''].version = v; tauri.version = v;
  const updatedCargo = cargo.replace(cargoVersionPattern, (_m, a, _old, b) => a + v + b);
  const updatedLock = cargoLock.replace(cargoLockPattern, (_m, a, _old, b) => a + v + b);
  saveJson('pkg', pkg); saveJson('lock', lock); saveJson('tauri', tauri);
  writeFileSync(path('cargo'), updatedCargo); writeFileSync(path('cargoLock'), updatedLock);
  check();
  console.log('Next: update CHANGELOG.md, test, commit, and create the matching v' + v + ' tag.');
}

try {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (command === 'check') {
    if (args.length !== 0 && !(args.length === 2 && args[0] === '--tag')) throw new Error('Usage: node scripts/version.mjs check [--tag v2.3.1]');
    check(args.length ? args[1] : undefined);
  } else if (command === 'set' && args.length === 1) setVersion(args[0]);
  else throw new Error('Usage: node scripts/version.mjs check [--tag vX.Y.Z] | set X.Y.Z');
} catch (error) {
  console.error('Version error:', error.message);
  process.exitCode = 1;
}
