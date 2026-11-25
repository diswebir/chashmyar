#!/usr/bin/env node
/**
 * Optional Linux-only structural comparison of two actual display.rs workers.
 * This exercises the non-Windows no-op display backend, NOT Win32, a GPU,
 * WebView2, CPU usage, power, latency, or a production workload.
 * Usage: node tests/host-thread-structure.mjs /path/to/2.4.11-source
 * Prerequisite: cargo plus the locked parking_lot 0.12.5 crate in the cache.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
if (process.platform !== 'linux' || !process.argv[2]) {
  console.error('Usage on Linux: node tests/host-thread-structure.mjs /path/to/2.4.11-source');
  process.exit(2);
}
const base = resolve(process.argv[2]);
const candidate = resolve('.');
const temp = mkdtempSync(join(tmpdir(), 'chashmyar-threads-'));
try {
  mkdirSync(join(temp, 'src'));
  writeFileSync(join(temp, 'Cargo.toml'), '[package]\nname="chashmyar-thread-structure"\nversion="0.0.0"\nedition="2021"\n[dependencies]\nparking_lot="=0.12.5"\n');
  function run(root, old) {
    const gamma = JSON.stringify(join(root, 'src-tauri/src/gamma_logic.rs'));
    const display = JSON.stringify(join(root, 'src-tauri/src/display.rs'));
    const source = `#![allow(dead_code)]
#[path = ${gamma}] mod gamma_logic;
#[path = ${display}] mod display;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} pub fn try_log_panic<T: AsRef<str>>(_: T) {} }
mod color_filter { pub fn panic_stop() {} }
fn threads() -> usize { std::fs::read_dir("/proc/self/task").unwrap().count() }
fn main() {
  let before = threads();
  display::set_target(4200, 50);
  ${old ? 'display::spawn_reassert_loop();' : ''}
  std::thread::sleep(std::time::Duration::from_millis(500));
  let after = threads();
  println!("{} {}", before, after);
}
`;
    writeFileSync(join(temp, 'src/main.rs'), source);
    const result = spawnSync('cargo', ['run', '--quiet', '--offline', '--release', '--manifest-path', join(temp, 'Cargo.toml')],
      { encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: join(temp, 'target'), CARGO_BUILD_JOBS: '1' } });
    if (result.status !== 0) throw new Error(result.stderr || `cargo exited ${result.status}`);
    const [before, after] = result.stdout.trim().split(/\s+/).map(Number);
    if (![before, after].every(Number.isFinite)) throw new Error(`unexpected output: ${result.stdout}`);
    return { before, after, added: after - before };
  }
  const old = run(base, true);
  const now = run(candidate, false);
  console.log(`2.4.11 host process: ${old.before} → ${old.after} threads (added ${old.added})`);
  console.log(`candidate host process: ${now.before} → ${now.after} threads (added ${now.added})`);
  if (old.added !== 2 || now.added !== 1) throw new Error('unexpected worker-thread structure');
  console.log('PASS: one fewer host Gamma/reassert thread; NOT a Windows performance benchmark.');
} finally { rmSync(temp, { recursive: true, force: true }); }
