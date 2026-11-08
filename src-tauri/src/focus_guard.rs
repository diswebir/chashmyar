//! Break-screen focus enforcement (Ctrl+Alt+Del mitigation).
//!
//! User-mode hooks cannot swallow the Secure Attention Sequence, so instead of
//! fighting it we police the lock window every second: if the window is
//! minimised or no longer foreground we restore it, push it back to the top of
//! the Z-order and add a configurable time penalty to the running break.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::analytics;
use crate::engine::Shared;
use crate::state::Phase;

// Even values mean stopped; odd values identify one particular running guard.
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub const PENALTY_EVENT: &str = "break-penalty-applied";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PenaltyPayload {
    pub seconds: u32,
    pub total_penalties: u32,
    pub remaining_seconds: i64,
}

pub fn is_running() -> bool {
    GENERATION.load(Ordering::SeqCst) & 1 == 1
}

pub fn stop() {
    loop {
        let old = GENERATION.load(Ordering::SeqCst);
        if old & 1 == 0 { return; }
        if GENERATION.compare_exchange(old, old.wrapping_add(1), Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            return;
        }
    }
}

/// Raw HWND of the break-lock webview (version-agnostic via raw-window-handle).
pub fn lock_hwnd(app: &AppHandle) -> Option<isize> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let window = app.get_webview_window(crate::windows::LOCK)?;
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win) => Some(win.hwnd.get() as isize),
        _ => None,
    }
}

#[cfg(windows)]
fn is_foreground(hwnd: isize) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsIconic};

    unsafe {
        let handle = windows::Win32::Foundation::HWND(hwnd as _);
        let iconic = IsIconic(handle).as_bool();
        !iconic && GetForegroundWindow() == handle
    }
}

#[cfg(not(windows))]
fn is_foreground(_hwnd: isize) -> bool {
    true
}

#[cfg(windows)]
fn reassert(hwnd: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE,
        SWP_SHOWWINDOW, SW_RESTORE,
    };

    unsafe {
        let handle = windows::Win32::Foundation::HWND(hwnd as _);
        let _ = ShowWindow(handle, SW_RESTORE);
        let _ = SetWindowPos(
            handle,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let _ = SetForegroundWindow(handle);
    }
}

#[cfg(not(windows))]
fn reassert(_hwnd: isize) {}

/// Starts the 1000 ms enforcement loop for the current break.
pub fn spawn(app: AppHandle, shared: Shared) {
    let generation = loop {
        let old = GENERATION.load(Ordering::SeqCst);
        if old & 1 == 1 { return; }
        let next = old.wrapping_add(1);
        if GENERATION.compare_exchange(old, next, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            break next;
        }
    };
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut was_ok = false;
        let mut last_penalty = Instant::now() - Duration::from_secs(60);

        while GENERATION.load(Ordering::SeqCst) == generation {
            std::thread::sleep(Duration::from_millis(1000));

            if GENERATION.load(Ordering::SeqCst) != generation { break; }
            let Some(hwnd) = lock_hwnd(&app) else {
                continue;
            };

            let (on_break, penalty_enabled, penalty_seconds) = {
                let rt = shared.lock();
                (
                    matches!(rt.timer.phase, Phase::Break | Phase::LongBreak),
                    rt.settings.lock.focus_penalty_enabled,
                    rt.settings.lock.focus_penalty_seconds.max(5),
                )
            };

            if !on_break {
                break;
            }

            let ok = is_foreground(hwnd);

            // Grace period: Windows needs a moment to hand focus to the new window.
            if started.elapsed() < Duration::from_millis(2500) {
                was_ok = ok;
                continue;
            }

            if ok {
                was_ok = true;
                continue;
            }

            if GENERATION.load(Ordering::SeqCst) != generation { break; }
            reassert(hwnd);

            if penalty_enabled && was_ok && last_penalty.elapsed() > Duration::from_millis(2500) {
                last_penalty = Instant::now();
                let payload = {
                    let mut rt = shared.lock();
                    if GENERATION.load(Ordering::SeqCst) != generation || !matches!(rt.timer.phase, Phase::Break | Phase::LongBreak) {
                        None
                    } else {
                        let extra = i64::from(penalty_seconds);
                        rt.timer.remaining_seconds += extra;
                        rt.timer.total_seconds += extra;
                        rt.timer.penalty_pulse = rt.timer.penalty_pulse.wrapping_add(1);
                        rt.timer.penalties_this_break = rt.timer.penalties_this_break.wrapping_add(1);
                        Some(PenaltyPayload {
                            seconds: penalty_seconds,
                            total_penalties: rt.timer.penalties_this_break,
                            remaining_seconds: rt.timer.remaining_seconds,
                        })
                    }
                };
                if let Some(payload) = payload {
                    analytics::bump(&app, |r| r.penalty_count += 1);
                    let _ = app.emit(PENALTY_EVENT, payload);
                }
            }

            was_ok = false;
        }

        let _ = GENERATION.compare_exchange(generation, generation.wrapping_add(1), Ordering::SeqCst, Ordering::SeqCst);
    });
}
