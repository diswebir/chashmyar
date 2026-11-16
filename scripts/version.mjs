#!/usr/bin/env node
/** Keep the five release version fields in sync. Run from the project root. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const files = {
  pkg: 'package.json', lock: 'package-lock.json',
  tauri: 'src-tauri/tauri.conf.json', cargo: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
};
const path = (key) => join(root, files[key]);
const read = (key) => readFileSync(path(key), 'utf8');
const json = (key) => JSON.parse(read(key));
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
// This is also used by auto-release to independently validate the indexed
// release tree against the original committed contents, not merely filenames.
export const VERSION_FILES = Object.values(files).sort();
export function versionedContents(contents, v) {
  validateVersion(v);
  const pkg = JSON.parse(contents[files.pkg]);
  const lock = JSON.parse(contents[files.lock]);
  const tauri = JSON.parse(contents[files.tauri]);
  const cargo = contents[files.cargo], cargoLock = contents[files.cargoLock];
  if (typeof pkg.version !== 'string' || typeof lock.version !== 'string'
      || typeof lock.packages?.['']?.version !== 'string' || typeof tauri.version !== 'string') {
    throw new Error('Missing version field in a JSON manifest or lockfile');
  }
  singleMatch(cargo, cargoVersionPattern, 'Cargo.toml');
  singleMatch(cargoLock, cargoLockPattern, 'Cargo.lock');
  pkg.version = v; lock.version = v; lock.packages[''].version = v; tauri.version = v;
  const jsonText = (object) => JSON.stringify(object, null, 2) + '\n';
  return {
    [files.pkg]: jsonText(pkg),
    [files.lock]: jsonText(lock),
    [files.tauri]: jsonText(tauri),
    [files.cargo]: cargo.replace(cargoVersionPattern, (_m, a, _old, b) => a + v + b),
    [files.cargoLock]: cargoLock.replace(cargoLockPattern, (_m, a, _old, b) => a + v + b),
  };
}
function setVersion(v) {
  // Compute every result before writing anything. Source and worktree may use
  // different newline conventions, but Git normalizes the staged tree.
  const contents = Object.fromEntries(Object.keys(files).map(key => [files[key], read(key)]));
  const updated = versionedContents(contents, v);
  for (const [name, content] of Object.entries(updated)) writeFileSync(join(root, name), content);
  check();
  console.log('Version files updated. Normal releases are tagged automatically after a successful main push.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command = 'check', ...args] = process.argv.slice(2);
    if (command === 'check') {
      if (args.length !== 0 && !(args.length === 2 && args[0] === '--tag')) throw new Error('Usage: node scripts/version.mjs check [--tag vX.Y.Z]');
      check(args.length ? args[1] : undefined);
    } else if (command === 'set' && args.length === 1) setVersion(args[0]);
    else throw new Error('Usage: node scripts/version.mjs check [--tag vX.Y.Z] | set X.Y.Z');
  } catch (error) {
    console.error('Version error:', error.message);
    process.exitCode = 1;
  }
}
