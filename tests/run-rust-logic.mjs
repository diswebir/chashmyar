/** Cross-platform host tests for the two pure Rust modules; no Tauri/Windows required. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'chashmyar-logic-'));
try {
  for (const name of ['score', 'timer_rules']) {
    const executable = join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
    const compile = spawnSync('rustc', ['--edition=2021', '--test', `src-tauri/src/${name}.rs`, '-o', executable], { stdio: 'inherit' });
    if (compile.error || compile.status !== 0) throw compile.error ?? new Error(`${name}: rustc exited ${compile.status}`);
    const run = spawnSync(executable, [], { stdio: 'inherit' });
    if (run.error || run.status !== 0) throw run.error ?? new Error(`${name}: test exited ${run.status}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
