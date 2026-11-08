/** Offline tests for version synchronization, release assets and safe draft creation. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'chashmyar-release-test-'));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.equal(a, b, message); checks++; };
const run = (script, args = [], env = {}) => spawnSync(process.execPath, [join(temp, script), ...args], {
  cwd: temp, encoding: 'utf8', env: { ...process.env, ...env },
});
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
  'scripts/version.mjs', 'scripts/stage-release.mjs', 'scripts/create-draft-release.mjs'];
try {
  for (const file of files) {
    mkdirSync(dirname(join(temp, file)), { recursive: true });
    cpSync(join(root, file), join(temp, file));
  }
  eq(run('scripts/version.mjs', ['check', '--tag', tag]).status, 0, 'matching versions pass');
  ok(run('scripts/version.mjs', ['check', '--tag', 'v99.0.0']).status !== 0, 'mismatched tag fails');
  const before = readFileSync(join(temp, 'package.json'), 'utf8');
  for (const bad of ['v2.0.0', '2.01.3', '2.3', '2.3.1-beta', '70000.0.0']) {
    ok(run('scripts/version.mjs', ['set', bad]).status !== 0, `invalid version ${bad} rejected`);
  }
  eq(readFileSync(join(temp, 'package.json'), 'utf8'), before, 'invalid version does not change files');
  eq(run('scripts/version.mjs', ['set', '42.3.2']).status, 0, 'setting version works');
  eq(run('scripts/version.mjs', ['check', '--tag', 'v42.3.2']).status, 0, 'all five version files agree');
  ok(readFileSync(join(temp, 'src-tauri/Cargo.lock'), 'utf8').replace(/\r\n/g, '\n').includes('name = "chashmyar"\nversion = "42.3.2"'), 'Cargo lock root version updated');
  eq(run('scripts/version.mjs', ['set', version]).status, 0, 'restored test fixture version');

  const makePE = (machine) => {
    const bytes = Buffer.alloc(256); bytes.write('MZ', 0); bytes.writeUInt32LE(0x80, 0x3c);
    bytes.write('PE\0\0', 0x80, 'binary'); bytes.writeUInt16LE(machine, 0x84); return bytes;
  };
  mkdirSync(join(temp, 'release/windows'), { recursive: true });
  writeFileSync(join(temp, `release/windows/ChashmYar_${version}_x64-setup.exe`), makePE(0x14c));
  writeFileSync(join(temp, `release/windows/ChashmYar-${version}-portable.exe`), makePE(0x8664));
  writeFileSync(join(temp, 'LICENSE'), 'fixture license\n');
  writeFileSync(join(temp, 'THIRD_PARTY_NOTICES.txt'), 'fixture notices\n');
  eq(run('scripts/stage-release.mjs', ['--tag', tag]).status, 0, 'stage expected assets');
  eq(run('scripts/stage-release.mjs', ['--verify', '--tag', tag]).status, 0, 'checksums and PE validate');
  const sums = readFileSync(join(temp, 'release/staging/SHA256SUMS.txt'), 'utf8').trim().split('\n');
  eq(sums.length, 4, 'checksums cover both EXEs and notices');
  const portable = join(temp, `release/staging/ChashmYar-${version}-portable.exe`);
  writeFileSync(portable, Buffer.from('corrupt'));
  ok(run('scripts/stage-release.mjs', ['--verify']).status !== 0, 'corrupt asset fails verification');
  eq(run('scripts/stage-release.mjs').status, 0, 'staging can be recreated');
  ok(run('scripts/stage-release.mjs', ['--tag', 'v99.0.0']).status !== 0, 'stage rejects mismatched tag');
  ok(run('scripts/stage-release.mjs', ['--invalid']).status !== 0, 'stage rejects unknown arguments');

  const stateFile = join(temp, 'fake-gh-state.json');
  const fakeEnv = {
    GITHUB_REPOSITORY: 'example/ChashmYar',
    CHASHMYAR_TEST_GH: resolve(root, 'tests/fixtures/fake-gh.cjs'),
    CHASHMYAR_FAKE_GH_STATE: stateFile,
  };
  const setMode = (mode) => writeFileSync(stateFile, JSON.stringify({ mode, calls: [], notes: 'maintainer notes' }));
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  setMode('missing');
  eq(run('scripts/create-draft-release.mjs', [tag], fakeEnv).status, 0, 'new draft is created');
  const create = state().calls.find((c) => c[1] === 'create');
  ok(create?.includes('--draft') && create.includes('--verify-tag'), 'create requires a pre-existing tag and remains draft');
  ok(create?.includes('release/staging/SHA256SUMS.txt') || create?.includes('release\\staging\\SHA256SUMS.txt'), 'checksum manifest is uploaded');
  setMode('draft');
  eq(run('scripts/create-draft-release.mjs', [tag], fakeEnv).status, 0, 'existing draft can be updated');
  ok(state().calls.some((c) => c[1] === 'upload' && c.includes('--clobber')), 'draft assets are replaced on rerun');
  eq(state().notes, 'maintainer notes', 'draft notes preserved');
  for (const mode of ['published', 'network-error']) {
    setMode(mode);
    ok(run('scripts/create-draft-release.mjs', [tag], fakeEnv).status !== 0, `${mode}: release action is refused`);
    eq(state().calls.filter((c) => c[1] === 'upload' || c[1] === 'create').length, 0, `${mode}: no mutation attempted`);
  }
  setMode('missing');
  ok(run('scripts/create-draft-release.mjs', ['v99.0.0'], fakeEnv).status !== 0, 'release rejects wrong tag before calling GitHub');
  eq(state().calls.length, 0, 'wrong tag never contacts GitHub');
  console.log(`PASS: ${checks} offline release/version safety assertions`);
} finally { rmSync(temp, { recursive: true, force: true }); }
