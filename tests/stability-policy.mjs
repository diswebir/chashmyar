/** Source wiring checks only; native behavior is tested separately with fake
 * drivers. They do not substitute for an interactive Windows/GPU test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
function section(s, a, b) {
  const x = s.indexOf(a), y = s.indexOf(b, x + a.length);
  assert.ok(x >= 0 && y > x, `missing ${a} ... ${b}`);
  return s.slice(x, y);
}
const cmd = read('src-tauri/src/commands.rs');
const tray = read('src-tauri/src/tray.rs');
const engine = read('src-tauri/src/engine.rs');
const reset = section(cmd, 'pub fn reset_gamma(', '#[tauri::command(async)]\npub fn open_creator_website');
const toggle = section(tray, '"eye-toggle" => {', '"timer-toggle" => {');
assert.ok(!reset.includes('display::restore_gamma('), 'reset must not perform a stale out-of-band neutral write');
assert.ok(!toggle.includes('display::restore_gamma('), 'tray toggle must not perform a stale out-of-band neutral write');
assert.ok(reset.includes('engine::refresh_neutral_if_off') && toggle.includes('engine::refresh_neutral_if_off'), 'explicit off goes through the serialized current-state decision');
assert.ok(engine.includes('rt.settings.eye.enabled') && engine.includes('gamma_logic::transition_for_explicit_off'), 'the latest state decides whether a fast neutral transition is still appropriate');
const display = read('src-tauri/src/display.rs');
assert.ok(display.includes('catch_unwind(gamma_worker_loop)') && !display.includes('fn spawn_reassert_loop'), 'one supervised Gamma worker owns interpolation and reassertion');
assert.ok(display.includes('primary_readback') && display.includes('hint only'), 'primary readback remains a diagnostic hint');
const persistence = read('src-tauri/src/persistence.rs');
assert.ok(persistence.includes('settings_recovery::load_file') && persistence.includes('SETTINGS_WRITER.save_latest'), 'saved settings use recovery and serialized replacement policy');
assert.ok(engine.includes('FILTER_TRACE') && engine.includes('color_safe_paused'), 'filter decisions reach the privacy-preserving log');
const remove = section(cmd, 'pub fn whitelist_remove(', '#[tauri::command(async)]\npub fn whitelist_reset_defaults');
assert.ok(!remove.includes('rt.whitelist_active = None;') && remove.includes('foreground::refresh_cached_match'), 'removing an unrelated whitelist entry must not drop an active match');
assert.ok(read('src-tauri/src/timer.rs').includes('pause_after.saturating_add(30)'), 'corrupted idle threshold must not overflow');
const lib = read('src-tauri/src/lib.rs');
assert.ok(lib.indexOf('display::spawn_watchdog()') > 0 && lib.indexOf('display::spawn_watchdog()') < lib.indexOf('display::gamma_supported_probe()'), 'arm crash watchdog before the first display write');
const watchdog = section(display, 'pub fn run_watchdog_mode() -> ! {', '#[cfg(not(windows))]\npub fn run_watchdog_mode()');
assert.ok(watchdog.includes('watchdog_should_restore(wait.0)') && watchdog.includes('exiting without touching gamma'), 'failed/unexpected parent wait must not restore a live screen');
console.log('PASS: 12 stability source-wiring assertions (not a Windows runtime test)');
