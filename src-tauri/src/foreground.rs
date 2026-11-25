//! Foreground window watcher used by the colour-safe whitelist.
//!
//! Every 1.5 s we try `GetForegroundWindow → GetWindowThreadProcessId →
//! QueryFullProcessImageNameW` plus `GetWindowTextW`. Sampling is outside the
//! runtime lock. Failed/partial lookups are unknown, not negative matches.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::AppHandle;

use crate::engine::{self, Shared};
use crate::foreground_match::Sample;

// Issue at lookup start, so a slower older sample cannot overwrite a newer
// sample or a settings edit. Wraparound is infeasible in a process lifetime.
static NEXT_SAMPLE: AtomicU64 = AtomicU64::new(1);
fn blank_sample() -> Sample {
    Sample { sequence: NEXT_SAMPLE.fetch_add(1, Ordering::SeqCst), process: None, title: None }
}

#[cfg(windows)]
pub fn current() -> Sample {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, GetLastError, SetLastError, ERROR_SUCCESS};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    let mut sample = blank_sample();
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return sample; }

        let mut title = [0u16; 512];
        SetLastError(ERROR_SUCCESS);
        let len = GetWindowTextW(hwnd, &mut title);
        if len > 0 {
            sample.title = Some(String::from_utf16_lossy(&title[..len as usize]));
        } else if GetLastError() == ERROR_SUCCESS {
            // Zero can be an ordinary empty title; an actual error is unknown.
            sample.title = Some(String::new());
        }

        let mut pid = 0u32;
        let thread_id = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if thread_id != 0 && pid != 0 {
            if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buffer = [0u16; 1024];
                let mut size = buffer.len() as u32;
                if QueryFullProcessImageNameW(
                    process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size,
                ).is_ok() {
                    let full = String::from_utf16_lossy(&buffer[..size as usize]);
                    sample.process = Some(full.rsplit(['\\', '/']).next()
                        .unwrap_or(full.as_str()).to_string());
                }
                let _ = CloseHandle(process);
            }
        }
        // Do not combine fields collected across a detected focus change.
        // Another focus change can still happen later; the next poll corrects it.
        if GetForegroundWindow() != hwnd {
            sample.process = None;
            sample.title = None;
        }
    }
    sample
}

#[cfg(not(windows))]
pub fn current() -> Sample { blank_sample() }

/// Re-evaluate a changed list/switch without waiting for the next poll. Call
/// only while holding the runtime lock; this performs no native lookup.
pub fn refresh_cached_match(rt: &mut crate::state::Runtime) {
    rt.foreground_cache.recompute(rt.settings.eye.color_safe_enabled,
        &rt.settings.eye.color_safe_whitelist);
}

/// Publish a sampled foreground under the lock and the *current* settings.
/// A failed newer lookup still advances the sample watermark.
pub fn cache_info(rt: &mut crate::state::Runtime, info: Sample) -> bool {
    rt.foreground_cache.observe(info, rt.settings.eye.color_safe_enabled,
        &rt.settings.eye.color_safe_whitelist)
}

/// Background poller: refresh when the colour-safe decision changes. A
/// transient missing HWND or a failed component read retains an existing match
/// until a complete nonmatch, explicit disable, or removal of that entry.
pub fn spawn_watcher(app: AppHandle, shared: Shared) {
    std::thread::spawn(move || {
        let mut last_quality = None;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            if !shared.lock().settings.eye.color_safe_enabled { continue; }
            let info = current();
            let quality = info.quality();
            let (accepted, changed) = {
                let mut rt = shared.lock();
                let previous = rt.foreground_cache.active().map(str::to_owned);
                let accepted = cache_info(&mut rt, info);
                let changed = rt.foreground_cache.active() != previous.as_deref();
                (accepted, changed)
            };
            if accepted && last_quality != Some(quality) {
                crate::diag::log(format!("foreground sample {quality} (no identity logged)"));
                last_quality = Some(quality);
            }
            if changed { engine::refresh(&app, &shared); }
        }
    });
}
