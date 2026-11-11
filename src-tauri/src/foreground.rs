//! Foreground window watcher used by the colour-safe whitelist.
//!
//! Every 1.5 s we resolve `GetForegroundWindow → GetWindowThreadProcessId →
//! QueryFullProcessImageNameW` plus `GetWindowTextW` and check the result
//! against the user's whitelist (default: `Figma.exe`, `Photoshop.exe`,
//! `Illustrator.exe`, or any window title containing `DevTools` / `Inspect`).

use std::time::Duration;
use tauri::AppHandle;

use crate::engine::{self, Shared};

#[derive(Debug, Clone, Default)]
pub struct ForegroundInfo {
    pub process: String,
    pub title: String,
}

#[cfg(windows)]
pub fn current() -> ForegroundInfo {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    let mut info = ForegroundInfo::default();
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return info;
        }

        let mut title = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title);
        if len > 0 {
            info.title = String::from_utf16_lossy(&title[..len as usize]);
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return info;
        }

        if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buffer = [0u16; 1024];
            let mut size = buffer.len() as u32;
            if QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut size,
            )
            .is_ok()
            {
                let full = String::from_utf16_lossy(&buffer[..size as usize]);
                info.process = full
                    .rsplit(['\\', '/'])
                    .next()
                    .unwrap_or(full.as_str())
                    .to_string();
            }
            let _ = CloseHandle(process);
        }
    }
    info
}

#[cfg(not(windows))]
pub fn current() -> ForegroundInfo {
    ForegroundInfo::default()
}

/// Returns the first whitelist entry that matches, if any.
pub fn matching_entry(whitelist: &[String], info: &ForegroundInfo) -> Option<String> {
    crate::foreground_match::matching_entry(whitelist, &info.process, &info.title)
}

/// Background poller: updates runtime state and triggers a full refresh when the
/// colour-safe decision flips (which starts/stops the 2 s gamma lerp).
pub fn spawn_watcher(app: AppHandle, shared: Shared) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1500));

        // No process/title lookup is needed while color-safe mode is off.
        // Enabling it is still picked up on the next normal 1.5 s tick.
        if !shared.lock().settings.eye.color_safe_enabled { continue; }
        let info = current();
        let mut changed = false;

        {
            let mut rt = shared.lock();
            rt.foreground_process = info.process.clone();
            rt.foreground_title = info.title.clone();

            let next = if rt.settings.eye.color_safe_enabled {
                matching_entry(&rt.settings.eye.color_safe_whitelist, &info)
            } else {
                None
            };

            if next != rt.whitelist_active {
                rt.whitelist_active = next;
                changed = true;
            }
        }

        if changed {
            engine::refresh(&app, &shared);
        }
    });
}
