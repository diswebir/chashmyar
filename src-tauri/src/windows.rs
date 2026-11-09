//! Multi-window topology.
//!
//! Five windows, one React bundle (`index.html`), routed by Tauri window label:
//!
//! | label            | role                                                  |
//! |------------------|-------------------------------------------------------|
//! | `main`           | settings & dashboard (declared in tauri.conf.json)     |
//! | `dimmer-overlay` | fullscreen, click-through, always-on-top dimmer        |
//! | `micro-bar`      | 2px progress strip pinned to the top edge              |
//! | `snooze-alert`   | 30-second pre-break OSD                                |
//! | `break-lock`     | fullscreen glassmorphic break lock screen              |

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub const MAIN: &str = "main";
pub const DIMMER: &str = "dimmer-overlay";
pub const MICRO: &str = "micro-bar";
pub const SNOOZE: &str = "snooze-alert";
pub const LOCK: &str = "break-lock";
pub const MICRO_BREAK: &str = "micro-break";

/// Height of the collapsed micro bar (logical pixels). The window only ever
/// occupies this thin strip while idle so every other click reaches the desktop.
pub const MICRO_COLLAPSED_HEIGHT: f64 = 4.0;
/// Height when the hover pill is expanded.
pub const MICRO_EXPANDED_HEIGHT: f64 = 62.0;

pub const SNOOZE_WIDTH: f64 = 452.0;
pub const SNOOZE_HEIGHT: f64 = 320.0;

/// Floating (draggable) micro widget capsule.
pub const MICRO_FLOATING_WIDTH: f64 = 276.0;
pub const MICRO_FLOATING_HEIGHT: f64 = 56.0;

/// 20-20-20 non-blocking coach card.
pub const MICRO_BREAK_WIDTH: f64 = 520.0;
pub const MICRO_BREAK_HEIGHT: f64 = 188.0;

struct MonitorInfo {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

fn primary_monitor(app: &AppHandle) -> MonitorInfo {
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.available_monitors().ok().and_then(|m| m.into_iter().next()));

    match monitor {
        Some(m) => {
            let scale = m.scale_factor();
            let PhysicalPosition { x, y } = *m.position();
            let PhysicalSize { width, height } = *m.size();
            MonitorInfo {
                x: x as f64 / scale,
                y: y as f64 / scale,
                width: width as f64 / scale,
                height: height as f64 / scale,
                scale,
            }
        }
        None => MonitorInfo {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
            scale: 1.0,
        },
    }
}

fn app_url() -> WebviewUrl {
    WebviewUrl::App("index.html".into())
}

/* -------------------------------------------------------------------------- */
/*                                  Creation                                  */
/* -------------------------------------------------------------------------- */

/// Builds every auxiliary window. Individual failures are logged and skipped so
/// a driver / remote-session quirk (e.g. refusing alpha-transparent windows)
/// can never stop the whole application from starting.
pub fn create_all(app: &AppHandle) -> tauri::Result<()> {
    let monitor = primary_monitor(app);
    crate::diag::log(format!(
        "primary monitor: {}x{} @ scale {} origin ({}, {})",
        monitor.width, monitor.height, monitor.scale, monitor.x, monitor.y
    ));

    macro_rules! build_window {
        ($label:expr, $builder:expr) => {
            match $builder.build() {
                Ok(window) => {
                    crate::diag::log(format!("window '{}' created", $label));
                    Some(window)
                }
                Err(err) => {
                    crate::diag::log(format!("window '{}' FAILED: {}", $label, err));
                    None
                }
            }
        };
    }

    /* ---------------------------- dimmer overlay --------------------------- */
    let overlay = build_window!(
        DIMMER,
        WebviewWindowBuilder::new(app, DIMMER, app_url())
            .title("ChashmYar Overlay")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .position(monitor.x, monitor.y)
            .inner_size(monitor.width, monitor.height)
    );
    if let Some(w) = &overlay {
        let _ = w.set_ignore_cursor_events(true);
        register_overlay(w);
    }

    /* -------------------------------- micro bar ---------------------------- */
    let micro = build_window!(
        MICRO,
        WebviewWindowBuilder::new(app, MICRO, app_url())
            .title("ChashmYar Micro Bar")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(true)
            .position(monitor.x, monitor.y)
            .inner_size(monitor.width, MICRO_COLLAPSED_HEIGHT)
    );
    if let Some(w) = &micro {
        let _ = w.set_ignore_cursor_events(false);
    }

    /* ------------------------------ snooze OSD ----------------------------- */
    let snooze = build_window!(
        SNOOZE,
        WebviewWindowBuilder::new(app, SNOOZE, app_url())
            .title("ChashmYar Alert")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .position(monitor.x + monitor.width - SNOOZE_WIDTH - 18.0, monitor.y + 14.0)
            .inner_size(SNOOZE_WIDTH, SNOOZE_HEIGHT)
    );
    if let Some(w) = &snooze {
        let _ = w.set_ignore_cursor_events(false);
    }

    /* ------------------------------- break lock ---------------------------- */
    let lock = build_window!(
        LOCK,
        WebviewWindowBuilder::new(app, LOCK, app_url())
            .title("ChashmYar Break")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .inner_size(monitor.width, monitor.height)
            .position(monitor.x, monitor.y)
    );
    if let Some(w) = &lock {
        let _ = w.set_ignore_cursor_events(false);
        #[cfg(windows)]
        {
            // Native Windows 10/11 acrylic behind the lock screen; the webview
            // adds its own `backdrop-filter` tint for the glassmorphic look.
            match window_vibrancy::apply_acrylic(w, Some(acrylic_tint(app))) {
                Ok(()) => crate::diag::log("acrylic applied to break-lock"),
                Err(err) => crate::diag::log(format!("acrylic unavailable ({err}) — CSS blur fallback")),
            }
        }
    }

    /* --------------------------- 20-20-20 coach ---------------------------- */
    let coach = build_window!(
        MICRO_BREAK,
        WebviewWindowBuilder::new(app, MICRO_BREAK, app_url())
            .title("ChashmYar Micro Break")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .position(monitor.x + (monitor.width - MICRO_BREAK_WIDTH) / 2.0, monitor.y + 16.0)
            .inner_size(MICRO_BREAK_WIDTH, MICRO_BREAK_HEIGHT)
    );
    if let Some(w) = &coach {
        let _ = w.set_ignore_cursor_events(false);
    }

    Ok(())
}

/* -------------------------------------------------------------------------- */
/*                  Capture-safe and system-wide dimmer layer                 */
/* -------------------------------------------------------------------------- */

use std::sync::atomic::{AtomicBool, Ordering};
static CAPTURE_EXCLUDED: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static OVERLAY_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// This reflects an accepted Windows affinity, not a guarantee that every
/// third-party or hardware recording method will honour it.
pub fn capture_exclusion_active() -> bool {
    CAPTURE_EXCLUDED.load(Ordering::Acquire)
}

/// Windows 10 2004+ provides EXCLUDEFROMCAPTURE. Older releases treat the same
/// value as WDA_MONITOR, which may produce an opaque black capture instead of
/// excluding the window. Detect the real build before ever setting the flag.
#[cfg(windows)]
fn can_exclude_from_capture() -> bool {
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(version: *mut OSVERSIONINFOW) -> i32;
    }
    let mut version = OSVERSIONINFOW::default();
    version.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    let ok = unsafe { RtlGetVersion(&mut version) } == 0;
    ok && crate::overlay_policy::exclusion_supported_windows(version.dwMajorVersion, version.dwBuildNumber)
}

#[cfg(windows)]
fn register_overlay(w: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };
    // Tauri and this application use different versions of the windows crate;
    // the transparent Win32 handle itself is ABI-identical.
    let hwnd = match w.hwnd() {
        Ok(value) => HWND(value.0 as _),
        Err(err) => { crate::diag::log(format!("dimmer HWND unavailable: {err}")); return; }
    };
    OVERLAY_HWND.store(hwnd.0 as isize, Ordering::Release);
    if !can_exclude_from_capture() {
        crate::diag::log("dimmer capture exclusion unavailable: Windows 10 2004 or later required");
        return;
    }
    let set = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) };
    let mut actual = 0u32;
    let excluded = set.is_ok()
        && unsafe { GetWindowDisplayAffinity(hwnd, &mut actual) }.is_ok()
        && actual == WDA_EXCLUDEFROMCAPTURE.0;
    CAPTURE_EXCLUDED.store(excluded, Ordering::Release);
    if excluded {
        crate::diag::log("dimmer requested exclusion from compatible screen captures");
    } else {
        crate::diag::log(format!("dimmer capture exclusion could not be confirmed: {set:?}, affinity={actual}"));
    }
}

#[cfg(not(windows))]
fn register_overlay(_w: &WebviewWindow) {
    CAPTURE_EXCLUDED.store(false, Ordering::Release);
}

// The event listener only observes the event kind/window handle; it does not
// read names, keystrokes or contents. It stays out-of-context (no injection)
// and never takes the app runtime mutex or calls synchronous Tauri APIs.
static OVERLAY_EVENTS_STOPPED: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static OVERLAY_EVENTS_STARTED: AtomicBool = AtomicBool::new(false);
// Publishing/clearing the id and posting WM_QUIT use this tiny private lock.
// The hook thread clears it before exiting, preventing a recycled thread id
// from receiving our shutdown message. The callback never takes this lock.
#[cfg(windows)]
static OVERLAY_EVENT_THREAD: parking_lot::Mutex<Option<u32>> = parking_lot::Mutex::new(None);
#[cfg(windows)]
static OVERLAY_REASSERTING: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static OVERLAY_RECHECK_REQUESTED: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static OVERLAY_LAST_ABOVE: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
#[cfg(windows)]
static OVERLAY_LAST_RAISE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// The policy is portable/testable, but its IDs must match the Windows bindings.
#[cfg(windows)]
const _: () = {
    use crate::overlay_policy as p;
    use windows::Win32::UI::WindowsAndMessaging as w;
    assert!(p::EVENT_SYSTEM_ALERT == w::EVENT_SYSTEM_ALERT);
    assert!(p::EVENT_SYSTEM_FOREGROUND == w::EVENT_SYSTEM_FOREGROUND);
    assert!(p::EVENT_SYSTEM_MENUSTART == w::EVENT_SYSTEM_MENUSTART);
    assert!(p::EVENT_SYSTEM_MENUPOPUPSTART == w::EVENT_SYSTEM_MENUPOPUPSTART);
    assert!(p::EVENT_SYSTEM_DIALOGSTART == w::EVENT_SYSTEM_DIALOGSTART);
    assert!(p::EVENT_OBJECT_SHOW == w::EVENT_OBJECT_SHOW);
    assert!(p::EVENT_OBJECT_UNCLOAKED == w::EVENT_OBJECT_UNCLOAKED);
};

#[cfg(windows)]
unsafe extern "system" fn overlay_win_event(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    event: u32,
    hwnd: windows::Win32::Foundation::HWND,
    object_id: i32,
    child_id: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    use crate::overlay_policy::{overlay_event_action, OverlayEventAction};
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};
    let overlay = OVERLAY_HWND.load(Ordering::Acquire);
    let enabled = overlay != 0 && !OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire)
        && OVERLAY_TARGET.load(Ordering::Acquire);
    match overlay_event_action(
        event, enabled, !hwnd.0.is_null(),
        !hwnd.0.is_null() && hwnd.0 as isize == overlay, object_id, child_id,
    ) {
        OverlayEventAction::Ignore => return,
        OverlayEventAction::CheckTopLevelStack if unsafe { GetAncestor(hwnd, GA_ROOT) }.0 != hwnd.0 => return,
        OverlayEventAction::CheckTopLevelStack | OverlayEventAction::CheckStack => {}
    }
    // No sleeping or waiting for the 50ms fallback: request the Z-order change
    // as soon as the OS sends the event, asynchronously and without focus.
    raise_overlay_if_obscured();
}

/// A private thread owns the required Windows message queue for WinEvent hooks.
/// Windows dispatches OUTOFCONTEXT events asynchronously; this reduces the
/// flash but cannot guarantee that no first frame is ever visible.
#[cfg(windows)]
fn start_overlay_event_hook() {
    if OVERLAY_EVENTS_STARTED.swap(true, Ordering::AcqRel) { return; }
    let spawned = std::thread::Builder::new().name("overlay-win-events".into()).spawn(|| {
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
        use crate::overlay_policy as p;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, PeekMessageW, TranslateMessage, MSG,
            PM_NOREMOVE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNTHREAD,
        };
        let mut msg = MSG::default();
        // Create the queue before publishing the ID so shutdown can post WM_QUIT.
        let _ = unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE) };
        let thread_id = unsafe { GetCurrentThreadId() };
        *OVERLAY_EVENT_THREAD.lock() = Some(thread_id);
        let ranges = [
            (p::EVENT_SYSTEM_ALERT, p::EVENT_SYSTEM_MENUPOPUPSTART),
            (p::EVENT_SYSTEM_DIALOGSTART, p::EVENT_SYSTEM_DIALOGSTART),
            (p::EVENT_OBJECT_SHOW, p::EVENT_OBJECT_SHOW),
            (p::EVENT_OBJECT_UNCLOAKED, p::EVENT_OBJECT_UNCLOAKED),
        ];
        let mut hooks = Vec::new();
        if !OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) {
            for (first, last) in ranges {
                let hook = unsafe { SetWinEventHook(first, last, None, Some(overlay_win_event),
                    0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNTHREAD) };
                if hook.is_invalid() {
                    crate::diag::log(format!("overlay WinEvent hook failed for {first:#x}..{last:#x}; polling remains active"));
                } else {
                    hooks.push(hook);
                }
            }
        }
        if !hooks.is_empty() {
            crate::diag::log(format!("overlay WinEvent listener ready ({} hooks)", hooks.len()));
        }
        while !hooks.is_empty() && !OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) {
            let result = unsafe { GetMessageW(&mut msg, None, 0, 0) }.0;
            if result < 0 {
                crate::diag::log("overlay WinEvent message loop failed; polling remains active");
                break;
            }
            if result == 0 {
                if !OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) {
                    crate::diag::log("overlay WinEvent message loop ended; polling remains active");
                }
                break; // WM_QUIT
            }
            unsafe { let _ = TranslateMessage(&msg); DispatchMessageW(&msg); }
        }
        for hook in hooks {
            if !unsafe { UnhookWinEvent(hook) }.as_bool() {
                crate::diag::log("overlay WinEvent unhook failed during listener shutdown");
            }
        }
        *OVERLAY_EVENT_THREAD.lock() = None;
    });
    if let Err(err) = spawned {
        crate::diag::log(format!("overlay WinEvent listener could not start: {err}; polling remains active"));
    }
}

#[cfg(not(windows))]
fn start_overlay_event_hook() {}

/// Ask the listener to unhook on its own thread before the application exits.
pub fn stop_overlay_event_hook() {
    OVERLAY_EVENTS_STOPPED.store(true, Ordering::Release);
    OVERLAY_TARGET.store(false, Ordering::Release);
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
        let result = {
            let thread_id = OVERLAY_EVENT_THREAD.lock();
            thread_id.map(|id| unsafe { PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)) })
        };
        if let Some(Err(err)) = result {
            crate::diag::log(format!("could not post overlay listener shutdown: {err}"));
        }
    }
}

/// Coalesce reentrant/concurrent scans without ever blocking the hook thread.
/// A second bounded pass catches an event that arrived during the first scan;
/// the 50 ms worker remains a fallback for any further events or API failure.
#[cfg(windows)]
fn raise_overlay_if_obscured() {
    if OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) || !OVERLAY_TARGET.load(Ordering::Acquire) { return; }
    OVERLAY_RECHECK_REQUESTED.store(true, Ordering::Release);
    for _ in 0..2 {
        if OVERLAY_REASSERTING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return; // the active scan will notice the pending request
        }
        struct ScanGuard;
        impl Drop for ScanGuard {
            fn drop(&mut self) { OVERLAY_REASSERTING.store(false, Ordering::Release); }
        }
        {
            let _guard = ScanGuard;
            OVERLAY_RECHECK_REQUESTED.store(false, Ordering::Release);
            scan_and_raise_overlay();
        }
        if !OVERLAY_RECHECK_REQUESTED.load(Ordering::Acquire) { break; }
    }
}

/// Some context menus, notifications and other topmost windows are inserted
/// after the dimmer. Check a bounded stack and request a nonactivating async
/// re-order only if a visible window is actually above the overlay.
#[cfg(windows)]
fn scan_and_raise_overlay() {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, IsWindow, IsWindowVisible, SetWindowPos, GW_HWNDPREV, HWND_TOPMOST,
        SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
        SWP_NOSENDCHANGING, SWP_NOSIZE,
    };
    if OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) || !OVERLAY_TARGET.load(Ordering::Acquire) { return; }
    let raw = OVERLAY_HWND.load(Ordering::Acquire);
    if raw == 0 { return; }
    let hwnd = HWND(raw as _);
    if !unsafe { IsWindow(hwnd) }.as_bool() { return; }
    let Ok(mut above) = (unsafe { GetWindow(hwnd, GW_HWNDPREV) }) else { return; };
    // Hidden windows can sit in the Z-order above us. Walk past them, but cap
    // the scan so unusual system window stacks never monopolize this worker.
    for _ in 0..256 {
        if unsafe { IsWindowVisible(above) }.as_bool() {
            let now = unsafe { GetTickCount64() };
            if !crate::overlay_policy::should_request_overlay_raise(
                OVERLAY_LAST_ABOVE.load(Ordering::Relaxed),
                OVERLAY_LAST_RAISE_MS.load(Ordering::Relaxed), above.0 as isize, now,
            ) || OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire)
                || !OVERLAY_TARGET.load(Ordering::Acquire) { break; }
            let raised = unsafe { SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
                    | SWP_NOSENDCHANGING | SWP_ASYNCWINDOWPOS) };
            if raised.is_ok() {
                OVERLAY_LAST_ABOVE.store(above.0 as isize, Ordering::Relaxed);
                OVERLAY_LAST_RAISE_MS.store(now, Ordering::Relaxed);
            }
            break;
        }
        match unsafe { GetWindow(above, GW_HWNDPREV) } {
            Ok(next) if next.0 != above.0 => above = next,
            _ => break,
        }
    }
}

#[cfg(not(windows))]
fn raise_overlay_if_obscured() {}

/// A single physical rectangle covers all attached monitors, including those
/// left/above the primary display. Geometry is rechecked while active so a
/// monitor connected or moved later is not stuck with the old primary bounds.
#[cfg(windows)]
fn virtual_desktop_bounds() -> Option<(i32, i32, u32, u32)> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };
    let (x, y, width, height) = unsafe { (
        GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
        GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN),
    ) };
    crate::overlay_policy::valid_virtual_bounds(x, y, width, height)
}

#[cfg(not(windows))]
fn virtual_desktop_bounds() -> Option<(i32, i32, u32, u32)> { None }

fn fit_overlay(app: &AppHandle, w: &WebviewWindow, bounds: Option<(i32, i32, u32, u32)>) {
    if let Some((x, y, width, height)) = bounds {
        let _ = w.set_position(PhysicalPosition::new(x, y));
        let _ = w.set_size(PhysicalSize::new(width, height));
    } else {
        let monitor = primary_monitor(app);
        let _ = w.set_position(LogicalPosition::new(monitor.x, monitor.y));
        let _ = w.set_size(LogicalSize::new(monitor.width, monitor.height));
    }
}

/* -------------------------------------------------------------------------- */
/*                              Window controls                               */
/* -------------------------------------------------------------------------- */

pub fn get(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}

pub fn show(app: &AppHandle, label: &str) {
    if let Some(w) = get(app, label) {
        let _ = w.show();
    }
}

pub fn hide(app: &AppHandle, label: &str) {
    if let Some(w) = get(app, label) {
        let _ = w.hide();
    }
}

pub fn show_lock(app: &AppHandle) -> bool {
    let monitor = primary_monitor(app);
    if let Some(w) = get(app, LOCK) {
        let _ = w.set_position(LogicalPosition::new(monitor.x, monitor.y));
        let _ = w.set_size(LogicalSize::new(monitor.width, monitor.height));
        if let Err(err) = w.show() {
            crate::diag::log(format!("break window could not be shown: {err}"));
            return false;
        }
        let _ = w.set_always_on_top(true);
        let _ = w.unminimize();
        let _ = w.set_focus();
        true
    } else {
        crate::diag::log("break window unavailable; skipping global keyboard hook");
        false
    }
}

pub fn hide_lock(app: &AppHandle) {
    if let Some(w) = get(app, LOCK) {
        let _ = w.set_always_on_top(false);
        let _ = w.hide();
    }
}

// Separate locks serialize window visibility against timer transitions. The
// runtime state is checked inside the window lock and released before any GUI
// call, so an old timer decision cannot reopen a dismissed warning.
static SNOOZE_WINDOW_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn show_snooze_inner(app: &AppHandle) {
    let monitor = primary_monitor(app);
    if let Some(w) = get(app, SNOOZE) {
        let _ = w.set_position(LogicalPosition::new(
            monitor.x + monitor.width - SNOOZE_WIDTH - 18.0,
            monitor.y + 14.0,
        ));
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    }
}

/// Explicit settings preview may be shown even without a real alert.
pub fn show_snooze(app: &AppHandle) {
    let _window = SNOOZE_WINDOW_LOCK.lock();
    show_snooze_inner(app);
}

pub fn show_snooze_if_valid(app: &AppHandle, shared: &crate::engine::Shared) {
    let _window = SNOOZE_WINDOW_LOCK.lock();
    let valid = {
        let rt = shared.lock();
        rt.timer.warning_visible && rt.timer.phase == crate::state::Phase::Work
    };
    if valid { show_snooze_inner(app); }
}

pub fn hide_snooze(app: &AppHandle) {
    let _window = SNOOZE_WINDOW_LOCK.lock();
    if let Some(w) = get(app, SNOOZE) { let _ = w.hide(); }
}

// Overlay calls can require the GUI event loop. A single worker applies only
// the newest requested state; no runtime mutex is held while it calls Tauri.
static OVERLAY_TARGET: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static OVERLAY_WORKER_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_overlay_target(visible: bool) {
    if !OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) {
        OVERLAY_TARGET.store(visible, Ordering::Release);
    }
}

pub fn ensure_overlay_worker(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire)
        || OVERLAY_WORKER_STARTED.swap(true, Ordering::AcqRel) { return; }
    start_overlay_event_hook();
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = false; // constructed hidden
        let mut last_bounds = None;
        let mut geometry_ticks = 0u8;
        loop {
            // Backup for windows that do not send accessibility events. Event
            // hooks handle normal menus sooner than this polling interval.
            std::thread::sleep(std::time::Duration::from_millis(50));
            if OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) { break; }
            let desired = OVERLAY_TARGET.load(Ordering::Acquire);
            if desired != last {
                sync_overlay(&app, desired);
                last = desired;
                last_bounds = if desired { virtual_desktop_bounds() } else { None };
                geometry_ticks = 0;
            }
            if desired {
                raise_overlay_if_obscured();
                geometry_ticks = geometry_ticks.saturating_add(1);
                if geometry_ticks >= 40 { // topology check every two seconds
                    geometry_ticks = 0;
                    let bounds = virtual_desktop_bounds();
                    if bounds != last_bounds {
                        if let Some(w) = get(&app, DIMMER) { fit_overlay(&app, &w, bounds); }
                        last_bounds = bounds;
                    }
                }
            }
        }
    });
}

/// Shows/hides the click-through dimmer overlay.
pub fn sync_overlay(app: &AppHandle, visible: bool) {
    if let Some(w) = get(app, DIMMER) {
        let _ = w.set_ignore_cursor_events(true);
        let already = w.is_visible().unwrap_or(false);
        if visible == already {
            return;
        }
        if visible {
            if OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) || !OVERLAY_TARGET.load(Ordering::Acquire) { return; }
            fit_overlay(app, &w, virtual_desktop_bounds());
            if OVERLAY_EVENTS_STOPPED.load(Ordering::Acquire) || !OVERLAY_TARGET.load(Ordering::Acquire) { return; }
            let _ = w.show();
            let _ = w.set_always_on_top(true);
        } else {
            let _ = w.hide();
        }
    }
}

// Geometry updates may originate in separate webviews; serialize native calls.
static WIDGET_GEOMETRY_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Collapses / expands the docked micro bar between its 4px strip and the pill.
/// In floating mode the window keeps its compact capsule geometry.
pub fn set_micro_expanded(app: &AppHandle, expanded: bool) {
    let _geometry = WIDGET_GEOMETRY_LOCK.lock();
    let monitor = primary_monitor(app);
    let floating = widget_mode(app) == crate::state::WidgetMode::Floating;

    if let Some(w) = get(app, MICRO) {
        if floating {
            // The capsule keeps whatever the user dragged it to: expand/collapse
            // is purely a content-side concern in floating mode.
            let _ = expanded;
            let _ = w.set_always_on_top(true);
            let _ = w.set_ignore_cursor_events(false);
            return;
        } else {
            let height = if expanded {
                MICRO_EXPANDED_HEIGHT
            } else {
                MICRO_COLLAPSED_HEIGHT
            };
            let _ = w.set_size(LogicalSize::new(monitor.width, height));
            let _ = w.set_position(LogicalPosition::new(monitor.x, monitor.y));
        }
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.set_always_on_top(true);
        let _ = expanded;
    }
}

fn widget_mode(app: &AppHandle) -> crate::state::WidgetMode {
    app.try_state::<crate::engine::Shared>()
        .map(|s| s.lock().settings.system.widget_mode)
        .unwrap_or(crate::state::WidgetMode::Docked)
}

/// Physical `(x, y)` of the floating capsule.
fn widget_position(app: &AppHandle) -> (i32, i32) {
    let monitor = primary_monitor(app);
    let scale = monitor.scale.max(0.5);
    let min_x = (monitor.x * scale).round() as i32;
    let min_y = (monitor.y * scale).round() as i32;
    let max_x = min_x + ((monitor.width - MICRO_FLOATING_WIDTH) * scale).max(0.0) as i32;
    let max_y = min_y + ((monitor.height - MICRO_FLOATING_HEIGHT) * scale).max(0.0) as i32;
    let (stored_x, stored_y, has_position) = app
        .try_state::<crate::engine::Shared>()
        .map(|s| {
            let rt = s.lock();
            (rt.settings.system.widget_x, rt.settings.system.widget_y, rt.settings.system.widget_position_set)
        })
        .unwrap_or((0, 0, false));

    if has_position {
        // Preserve a position on any attached monitor, not only the primary.
        if let Ok(monitors) = app.available_monitors() {
            for m in monitors {
                let origin = *m.position();
                let size = *m.size();
                let right = origin.x.saturating_add(size.width as i32);
                let bottom = origin.y.saturating_add(size.height as i32);
                if stored_x >= origin.x && stored_x < right && stored_y >= origin.y && stored_y < bottom {
                    let widget_w = (MICRO_FLOATING_WIDTH * m.scale_factor()).ceil() as i32;
                    let widget_h = (MICRO_FLOATING_HEIGHT * m.scale_factor()).ceil() as i32;
                    return (
                        stored_x.clamp(origin.x, (right - widget_w).max(origin.x)),
                        stored_y.clamp(origin.y, (bottom - widget_h).max(origin.y)),
                    );
                }
            }
        }
        // If a monitor was unplugged, recover the capsule to the visible screen.
        (stored_x.clamp(min_x, max_x), stored_y.clamp(min_y, max_y))
    } else {
        (max_x, (min_y + (48.0 * scale) as i32).clamp(min_y, max_y))
    }
}

/// Tint for the native acrylic behind the break screen, following the theme.
fn acrylic_tint(app: &AppHandle) -> (u8, u8, u8, u8) {
    let theme = app
        .try_state::<crate::engine::Shared>()
        .map(|s| s.lock().settings.system.theme)
        .unwrap_or(crate::state::Theme::Light);
    match theme {
        crate::state::Theme::Light => (246, 248, 252, 205),
        crate::state::Theme::Dark => (15, 23, 42, 170),
    }
}

/// Keep the native title bar and tray in the same language as the webviews.
pub fn apply_language(app: &AppHandle) {
    let language = app.try_state::<crate::engine::Shared>()
        .map(|s| s.lock().settings.system.language)
        .unwrap_or(crate::state::Language::Fa);
    if let Some(main) = get(app, MAIN) {
        let _ = main.set_title(if language == crate::state::Language::En {
            "ChashmYar — Eye Care and Focus"
        } else {
            "چشم‌یار — محافظ چشم و تمرکز"
        });
    }
    crate::tray::sync_language(app, language);
}

/// Re-applies theme-dependent native decoration (acrylic tint) to every window.
pub fn apply_theme(app: &AppHandle) {
    let theme = app.try_state::<crate::engine::Shared>()
        .map(|s| s.lock().settings.system.theme)
        .unwrap_or(crate::state::Theme::Light);
    if let Some(main) = get(app, MAIN) {
        let native = match theme {
            crate::state::Theme::Light => tauri::Theme::Light,
            crate::state::Theme::Dark => tauri::Theme::Dark,
        };
        let _ = main.set_theme(Some(native));
    }
    #[cfg(windows)]
    {
        if let Some(w) = get(app, LOCK) {
            let _ = window_vibrancy::apply_acrylic(w, Some(acrylic_tint(app)));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = acrylic_tint(app);
    }
}

/// Movement events update the live position immediately; a single background
/// worker flushes the latest value so even a short drag is saved on disk.
static WIDGET_POSITION_DIRTY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn remember_widget_position(app: &AppHandle, position: PhysicalPosition<i32>) {
    use std::sync::atomic::Ordering;
    let Some(shared) = app.try_state::<crate::engine::Shared>() else { return };
    {
        let mut rt = shared.lock();
        if rt.settings.system.widget_mode != crate::state::WidgetMode::Floating { return; }
        if rt.settings.system.widget_position_set && rt.settings.system.widget_x == position.x
            && rt.settings.system.widget_y == position.y { return; }
        rt.settings.system.widget_x = position.x;
        rt.settings.system.widget_y = position.y;
        rt.settings.system.widget_position_set = true;
    }
    WIDGET_POSITION_DIRTY.store(true, Ordering::Release);
}

pub fn spawn_widget_position_saver(app: AppHandle, shared: crate::engine::Shared) {
    use std::sync::atomic::Ordering;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(700));
        if WIDGET_POSITION_DIRTY.swap(false, Ordering::AcqRel) {
            crate::persistence::request_save(&app, &shared);
            crate::engine::refresh(&app, &shared);
        }
    });
}

/// Applies docked/floating geometry to the micro widget.
pub fn apply_widget_mode(app: &AppHandle) {
    let _geometry = WIDGET_GEOMETRY_LOCK.lock();
    let monitor = primary_monitor(app);
    let floating = widget_mode(app) == crate::state::WidgetMode::Floating;

    if let Some(w) = get(app, MICRO) {
        if floating {
            let (x, y) = widget_position(app);
            let _ = w.set_size(LogicalSize::new(MICRO_FLOATING_WIDTH, MICRO_FLOATING_HEIGHT));
            let _ = w.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = w.set_size(LogicalSize::new(monitor.width, MICRO_COLLAPSED_HEIGHT));
            let _ = w.set_position(LogicalPosition::new(monitor.x, monitor.y));
        }
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.set_always_on_top(true);
    }
}

/* ---------------------------- 20-20-20 coach ------------------------------ */

static EXERCISE_WINDOW_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn show_micro_break_inner(app: &AppHandle) {
    let monitor = primary_monitor(app);
    if let Some(w) = get(app, MICRO_BREAK) {
        let _ = w.set_position(LogicalPosition::new(
            monitor.x + (monitor.width - MICRO_BREAK_WIDTH) / 2.0,
            monitor.y + 16.0,
        ));
        let _ = w.set_size(LogicalSize::new(MICRO_BREAK_WIDTH, MICRO_BREAK_HEIGHT));
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    }
}

pub fn show_micro_break(app: &AppHandle) {
    let _window = EXERCISE_WINDOW_LOCK.lock();
    show_micro_break_inner(app);
}

pub fn show_micro_break_if_active(app: &AppHandle, shared: &crate::engine::Shared) {
    let _window = EXERCISE_WINDOW_LOCK.lock();
    let active = { shared.lock().timer.micro_break_active };
    if active { show_micro_break_inner(app); }
}

pub fn hide_micro_break(app: &AppHandle) {
    let _window = EXERCISE_WINDOW_LOCK.lock();
    if let Some(w) = get(app, MICRO_BREAK) { let _ = w.hide(); }
}

pub fn hide_micro_break_if_finished(app: &AppHandle, shared: &crate::engine::Shared) {
    let _window = EXERCISE_WINDOW_LOCK.lock();
    let active = { shared.lock().timer.micro_break_active };
    if !active { if let Some(w) = get(app, MICRO_BREAK) { let _ = w.hide(); } }
}

pub fn focus_main(app: &AppHandle) {
    if let Some(w) = get(app, MAIN) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
