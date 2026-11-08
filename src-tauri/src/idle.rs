//! Idle detection through Win32 `GetLastInputInfo`.
//!
//! The Pomodoro engine polls this every 2 seconds during a Work phase:
//! * `idle >= idle_pause_seconds` (default 180 s) → auto-pause (`PausedIdle`).
//! * `idle >= idle_reset_seconds` (default 300 s) → the absence counts as a
//!   completed *natural break*: the cycle restarts at full length and the
//!   snooze budget is refunded.

/// Seconds since the last keyboard/mouse input anywhere in the session.
#[cfg(windows)]
pub fn idle_seconds() -> u32 {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount64() as u32;
            // dwTime is a 32-bit tick count -> wrapping_sub is correct here.
            now.wrapping_sub(info.dwTime) / 1000
        } else {
            0
        }
    }
}

/// Development fallback (non-Windows hosts).
#[cfg(not(windows))]
pub fn idle_seconds() -> u32 {
    0
}

pub fn is_user_present() -> bool {
    idle_seconds() < 2
}
