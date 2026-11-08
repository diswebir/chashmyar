//! Strict break-time input locking.
//!
//! During a break a low-level keyboard hook (`WH_KEYBOARD_LL`) swallows the
//! shell-switching shortcuts that would let a user leak out of the lock screen:
//! Alt+Tab, Alt+Esc, Alt+F4, the Windows keys, Ctrl+Esc and Ctrl+Shift+Esc.
//!
//! The emergency fail-safe is a *pure modifier* hold (Ctrl + Shift) sampled with
//! `GetAsyncKeyState` on a 100 ms timer. Because no character key is involved it
//! works identically with Persian, Arabic, Cyrillic or any other keyboard layout
//! — the old Ctrl+Shift+U shortcut silently died whenever the active layout did
//! not map U to `u`.
//!
//! Ctrl+Alt+Del cannot be intercepted by any user-mode hook (Secure Attention
//! Sequence); that is a Windows platform guarantee.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;

static ACTIVE: AtomicBool = AtomicBool::new(false);
static HOOK: AtomicIsize = AtomicIsize::new(0);
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static LIFECYCLE: Mutex<()> = Mutex::new(());

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, PeekMessageW, PM_NOREMOVE, HC_ACTION, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
        WM_QUIT,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;

    const VK_TAB_U: u16 = 0x09;
    const VK_ESCAPE_U: u16 = 0x1B;
    const VK_F4_U: u16 = 0x73;
    const VK_LWIN_U: u16 = 0x5B;
    const VK_RWIN_U: u16 = 0x5C;
    const VK_APPS_U: u16 = 0x5D;
    const VK_MENU_U: u16 = 0x12;
    const VK_CONTROL_U: u16 = 0x11;

    pub(super) fn down(vk: u16) -> bool {
        unsafe { (GetAsyncKeyState(i32::from(vk)) as u16 & 0x8000) != 0 }
    }

    /// `true` means: swallow the key.
    fn should_block(vk: u16) -> bool {
        let alt = down(VK_MENU_U);
        let ctrl = down(VK_CONTROL_U);

        match vk {
            // Windows / Start menu keys
            VK_LWIN_U | VK_RWIN_U | VK_APPS_U => true,
            VK_TAB_U => alt,
            VK_ESCAPE_U => alt || ctrl,
            VK_F4_U => alt,
            _ => false,
        }
    }

    unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && ACTIVE.load(Ordering::SeqCst) {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if should_block(info.vkCode as u16) {
                return LRESULT(1); // consumed: return non-zero without chaining
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn activate() {
        let generation = {
            let _guard = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
            if ACTIVE.swap(true, Ordering::SeqCst) { return; }
            GENERATION.fetch_add(1, Ordering::SeqCst) + 1
        };
        std::thread::spawn(move || unsafe {
            // Ensure the message queue exists before publishing the thread ID;
            // otherwise a very early PostThreadMessage(WM_QUIT) can be lost.
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            let hook = {
                let _guard = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
                if !ACTIVE.load(Ordering::SeqCst) || GENERATION.load(Ordering::SeqCst) != generation { return; }
                match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0) {
                    Ok(hook) => {
                        HOOK.store(hook.0 as isize, Ordering::SeqCst);
                        HOOK_THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
                        hook
                    }
                    Err(err) => {
                        crate::diag::log(format!("keyboard hook unavailable: {err}"));
                        ACTIVE.store(false, Ordering::SeqCst);
                        return;
                    }
                }
            };
            while ACTIVE.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == generation {
                let ret = GetMessageW(&mut msg, None, 0, 0);
                if ret.0 <= 0 { break; }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(hook);
            let _guard = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
            if HOOK.compare_exchange(hook.0 as isize, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                HOOK_THREAD.store(0, Ordering::SeqCst);
            }
        });
    }

    pub fn release() {
        let _guard = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
        if !ACTIVE.swap(false, Ordering::SeqCst) { return; }
        GENERATION.fetch_add(1, Ordering::SeqCst);
        let tid = HOOK_THREAD.swap(0, Ordering::SeqCst);
        if tid != 0 {
            unsafe { let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)); }
        }
    }

}

#[cfg(windows)]
pub use imp::{activate, release};

#[cfg(not(windows))]
pub fn activate() {}

#[cfg(not(windows))]
pub fn release() {}

/* -------------------------------------------------------------------------- */
/*                        Emergency hold (layout-proof)                       */
/* -------------------------------------------------------------------------- */

const VK_CONTROL: u16 = 0x11;
const VK_SHIFT: u16 = 0x10;

#[cfg(windows)]
fn modifiers_held() -> bool {
    imp::down(VK_CONTROL) && imp::down(VK_SHIFT)
}

#[cfg(not(windows))]
fn modifiers_held() -> bool {
    false
}

/// Samples the physical Ctrl/Shift state 10× per second while a break is armed.
/// The accumulated hold is published in the snapshot, so the lock window only
/// has to render a ring — it never needs key events of its own.
pub fn spawn_emergency_watcher(app: tauri::AppHandle, shared: crate::engine::Shared) {
    use crate::state::Phase;
    use std::time::Duration;

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(100));

        let (armed, target_ms) = {
            let rt = shared.lock();
            let on_break = matches!(rt.timer.phase, Phase::Break | Phase::LongBreak);
            (
                on_break && rt.settings.lock.emergency_unlock,
                rt.settings.lock.emergency_hold_seconds.clamp(2, 30) * 1000,
            )
        };

        if !armed {
            let changed = {
                let mut rt = shared.lock();
                let was = rt.emergency_hold_ms;
                rt.emergency_hold_ms = 0;
                was != 0
            };
            if changed {
                crate::engine::refresh(&app, &shared);
            }
            continue;
        }

        let held = modifiers_held();
        let mut fire = false;
        let changed = {
            let mut rt = shared.lock();
            let next = if held {
                (rt.emergency_hold_ms + 100).min(target_ms)
            } else {
                0
            };
            let moved = next.rem_euclid(100) == 0 && next != rt.emergency_hold_ms;
            rt.emergency_hold_ms = next;
            if next >= target_ms {
                fire = true;
            }
            moved
        };

        if changed {
            crate::engine::refresh(&app, &shared);
        }
        if fire {
            crate::engine::emergency_unlock(&app, &shared);
        }
    });
}
