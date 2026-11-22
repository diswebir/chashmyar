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
const popupLayer = read('src-tauri/src/popup_layer.rs');
const colorFilter = read('src-tauri/src/color_filter.rs');
const colorVision = read('src-tauri/src/color_vision.rs');
const engine = read('src-tauri/src/engine.rs');
const state = read('src-tauri/src/state.rs');
const persistence = read('src-tauri/src/persistence.rs');
const commands = read('src-tauri/src/commands.rs');

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
for (const label of ['micro', 'snooze', 'coach', 'update_notice']) {
  ok(sliceBetween(win, `if let Some(w) = &${label}`, '\n    }').includes('protect_notification_layer(app, w);'), `${label} registers same-thread popup protection`);
}
ok(popupLayer.includes('WM_WINDOWPOSCHANGING') && popupLayer.includes('WM_SHOWWINDOW') && popupLayer.includes('pos.insert_after = filter'), 'own popup is ordered below the overlay before show/activation completes');
ok(popupLayer.includes('DefSubclassProc') && popupLayer.includes('RemoveWindowSubclass') && !popupLayer.includes('WM_MOUSEACTIVATE'), 'notification focus/input remains on the normal window-proc path');
ok(win.includes('popup_layer::set_filter_enabled(visible)') && win.includes('popup_layer::set_filter_enabled(false)'), 'popup protection follows filter state and shutdown');
for (const [start, end] of [['fn show_snooze_inner(', 'pub fn show_snooze('], ['fn show_micro_break_inner(', 'pub fn show_micro_break(']]) {
  ok(!sliceBetween(win, start, end).includes('w.set_always_on_top(true)'), `${start} does not re-promote above overlay after show`);
}
// These are source wiring checks, not proof of native screen effects.
ok(cargo.includes('"Win32_UI_Magnification"'), 'Windows Magnification bindings are enabled');
for (const api of ['MagInitialize', 'MagGetFullscreenColorEffect', 'MagSetFullscreenColorEffect', 'MagGetFullscreenTransform', 'MagUninitialize']) {
  ok(colorFilter.includes(api), `${api} is wired in the native worker`);
}
ok(colorFilter.includes('#[cfg(all(windows, not(test)))]') && colorFilter.includes('#[cfg(test)]'), 'native backend is isolated from standalone fake-driver tests');
const colorTarget = sliceBetween(engine, 'crate::color_filter::set_target(', ');');
ok(colorTarget.includes('color_vision_profile') && colorTarget.includes('color_vision_strength') && colorTarget.includes('paused_by_whitelist'), 'vision target uses saved settings and color-safe state');
ok(!colorTarget.includes('eye.enabled') && colorTarget.includes('screen,'), 'colour vision stays independent while screen target shares the same worker');
ok(engine.includes('cover_windows_menus && rt.settings.eye.enabled && !paused_by_whitelist'), 'optional fullscreen dimmer follows eye switch and color-safe');
const handoff = read('src-tauri/src/screen_handoff.rs');
const gamma = read('src-tauri/src/display.rs');
ok(engine.includes('display::hold_neutral_for_fullscreen') && engine.includes('ScreenTarget::new(handoff.request_screen, brightness, target)'), 'opt-in sends warmth and dimming to one matrix only through the gamma handoff');
ok(handoff.includes('NeutralState::Ready') && handoff.includes('overlay_hidden') && win.includes('overlay_hidden_confirmed()'), 'handoff waits for neutral gamma and a confirmed hidden overlay');
ok(gamma.includes('MAY_HAVE_OWN_WARMTH') && gamma.includes('result.all') && gamma.includes('FULLSCREEN_NEUTRAL_ACK'), 'partial-device failures cannot be mistaken for a safe neutral reset');
ok(colorFilter.includes('failed_unowned_screen') && colorFilter.includes('!SCREEN_COVERED.load(Ordering::SeqCst)'), 'unowned screen failures do not retry behind the handoff');
ok(engine.includes('!crate::color_filter::screen_covers_overlay()') && colorFilter.includes('controller.owns_screen_effect() || pending_screen'), 'overlay handoff tracks ownership and pending native writes');
ok(state.includes('cover_windows_menus: false') && state.includes('read_cover_windows_menus'), 'fullscreen mode is opt-in and malformed saved values fail closed');
ok(state.includes('color_vision_profile: "off".into()') && state.includes('color_vision_strength: 60'), 'saved-settings default is opt-in');
ok(state.includes('crate::color_filter::status().as_str()'), 'native worker status enters the serialized snapshot');
ok(persistence.includes('settings.eye.normalize_color_vision()') && commands.match(/normalize_color_vision\(\)/g)?.length >= 2, 'load, full update and patch normalize vision settings');
ok(engine.includes('crate::color_filter::stop_and_restore()') && read('src-tauri/src/display.rs').includes('crate::color_filter::panic_stop()'), 'normal shutdown and panic request restoration');
ok(colorVision.includes('same_matrix(&current, &last)') && colorVision.includes('same_matrix(&current, &IDENTITY)'), 'policy checks observed and last-owned matrices before writes');
console.log(`PASS: ${checks} Windows source-policy assertions (not an interactive Windows test)`);
