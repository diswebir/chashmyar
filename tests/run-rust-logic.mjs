/** Cross-platform host tests for the two pure Rust modules; no Tauri/Windows required. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'chashmyar-logic-'));
try {
  const modules = [
    ['score', 'src-tauri/src/score.rs'],
    ['timer_rules', 'src-tauri/src/timer_rules.rs'],
    ['overlay_policy', 'src-tauri/src/overlay_policy.rs'],
    ['gamma_logic', 'src-tauri/src/gamma_logic.rs'],
    ['coalesced_signal', 'src-tauri/src/coalesced_signal.rs'],
    ['foreground_match', 'src-tauri/src/foreground_match.rs'],
    ['passive_show_policy', 'src-tauri/vendor/tao/src/platform_impl/windows/passive_show_policy.rs'],
  ];
  for (const [name, source] of modules) {
    const executable = join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
    const compile = spawnSync('rustc', ['--edition=2021', '--test', source, '-o', executable], { stdio: 'inherit' });
    if (compile.error || compile.status !== 0) throw compile.error ?? new Error(`${name}: rustc exited ${compile.status}`);
    const run = spawnSync(executable, [], { stdio: 'inherit' });
    if (run.error || run.status !== 0) throw run.error ?? new Error(`${name}: test exited ${run.status}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
