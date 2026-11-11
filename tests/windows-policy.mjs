/** Source-integrity checks only. Native foreground, WebView2 buttons, popup
 * timing, GPU/HDR and capture still require an interactive Windows test. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

let checks = 0;
function ok(value, text) { assert.ok(value, text); checks++; }
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const win = read('src-tauri/src/windows.rs');
const taoState = read('src-tauri/vendor/tao/src/platform_impl/windows/window_state.rs');
const taoWindow = read('src-tauri/vendor/tao/src/platform_impl/windows/window.rs');
const cargo = read('src-tauri/Cargo.toml');
const lock = read('src-tauri/Cargo.lock');

function sliceBetween(source, start, end) {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `could not find ${start} ... ${end}`);
  return source.slice(i, j);
}
function builder(label) {
  return sliceBetween(win, `WebviewWindowBuilder::new(app, ${label}, app_url())`, '\n    );');
}
for (const label of ['SNOOZE', 'MICRO_BREAK']) {
  const b = builder(label);
  ok(b.includes('.focused(false)') && b.includes('.visible(false)'), `${label} starts hidden and unfocused`);
  ok(!b.includes('.focusable(false)'), `${label} retains deliberate keyboard/mouse focusability`);
}
const overlay = builder('DIMMER');
ok(overlay.includes('.focused(false)') && overlay.includes('.visible(false)'), 'overlay starts hidden/unfocused');
ok(overlay.includes('.focusable(false)'), 'click-through overlay is not an activation target');
const lockBuilder = builder('LOCK');
ok(!lockBuilder.includes('.focusable(false)'), 'strict lock remains focusable');
const lockShow = sliceBetween(win, 'pub fn show_lock(', 'pub fn hide_lock(');
ok(lockShow.includes('w.show()') && lockShow.includes('w.set_focus()'), 'strict break explicitly shows and focuses');
for (const [start, end] of [['fn show_snooze_inner(', 'pub fn show_snooze('], ['fn show_micro_break_inner(', 'pub fn show_micro_break(']]) {
  const body = sliceBetween(win, start, end);
  ok(body.includes('w.show()') && !body.includes('w.set_focus()'), `${start} uses Tao show without explicit activation`);
}
ok(cargo.includes('[patch.crates-io]') && cargo.includes('tao = { path = "vendor/tao" }'), 'locked build uses local patched Tao');
const taoLock = sliceBetween(lock, 'name = "tao"\n', '\n[[package]]');
ok(taoLock.includes('version = "0.37.2"') && !taoLock.includes('\nsource = '), 'Tao lock entry is the local 0.37.2 crate');
ok(taoWindow.includes('!attributes.focused && !attributes.visible'), 'only initially hidden/unfocused windows get the passive preference');
ok(taoState.includes('MARKER_PASSIVE_SHOW') && taoState.includes('ShowMode::WithoutActivation => SW_SHOWNA'), 'passive show uses SW_SHOWNA in the actual native path');
ok(taoState.includes('ShowMode::Normal => SW_SHOW'), 'regular focusable windows retain normal show');
ok(existsSync('src-tauri/vendor/tao/LICENSE') && existsSync('src-tauri/vendor/tao/CHASHMYAR_PATCH.md'), 'vendored Tao includes license and change notice');
ok(win.includes('p::EVENT_OBJECT_CREATE') && win.includes('p::EVENT_SYSTEM_CAPTURESTART'), 'earlier popup signals are registered');
ok(win.includes('OVERLAY_BURST_REQUESTED') && win.includes('SWP_ASYNCWINDOWPOS') && win.includes('SWP_NOACTIVATE'), 'overlay remains asynchronous and nonactivating');
ok(win.includes('WDA_EXCLUDEFROMCAPTURE') && win.includes('set_ignore_cursor_events(true)'), 'capture request and click-through behavior remain in place');
console.log(`PASS: ${checks} Windows source-policy assertions (not an interactive Windows test)`);
