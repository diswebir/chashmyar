//! `ChashmYar.exe --self-test` — an on-machine health check.
//!
//! Runs *before* Tauri starts, verifies every OS-level capability the app needs
//! and reports the result in a native message box plus the diagnostic log.
//! The current gamma ramp is saved and restored, so running it while the app is
//! warm-filtering does not change the screen.

use crate::diag;

struct Report {
    lines: Vec<(bool, String)>,
}

impl Report {
    fn new() -> Self {
        Self { lines: Vec::new() }
    }
    fn push(&mut self, ok: bool, label: &str) {
        diag::log(format!("self-test: {} — {}", if ok { "OK " } else { "FAIL" }, label));
        self.lines.push((ok, label.to_string()));
    }
    fn all_ok(&self) -> bool {
        self.lines.iter().all(|(ok, _)| *ok)
    }
}

pub fn is_self_test_mode() -> bool {
    std::env::args().any(|a| a == "--self-test")
}

/* --------------------------------- Windows --------------------------------- */

#[cfg(windows)]
fn webview2_present() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    // Microsoft Edge WebView2 Runtime client id, registered by both the 32- and
    // 64-bit installers — either location proving the runtime exists is enough.
    let subkeys = [
        w!("SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        w!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
    ];
    let value = w!("pv");
    for subkey in subkeys {
        let mut buffer = [0u16; 128];
        let mut size = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                subkey,
                value,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr() as *mut _),
                Some(&mut size),
            )
        };
        if status.is_ok() && size > 2 {
            return true;
        }
    }

    // Fallback: per-user install location.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let candidate = std::path::Path::new(&local)
            .join("Microsoft")
            .join("EdgeWebView")
            .join("Application");
        if candidate.exists() {
            return true;
        }
    }
    false
}

#[cfg(windows)]
fn probe_gamma() -> bool {
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC};
    use windows::Win32::UI::ColorSystem::{GetDeviceGammaRamp, SetDeviceGammaRamp};

    unsafe {
        let hdc = GetDC(None);
        if hdc.is_invalid() {
            return false;
        }

        // Preserve whatever the user's LUT currently is.
        let mut original = vec![0u16; 768];
        let had_ramp = GetDeviceGammaRamp(hdc, original.as_mut_ptr() as *mut c_void).as_bool();
        // Never write a test LUT if we cannot read the existing one to restore it.
        if !had_ramp {
            ReleaseDC(None, hdc);
            return false;
        }

        let identity: Vec<u16> = (0..=(255u16))
            .map(|i| i * 257)
            .collect::<Vec<u16>>()
            .into_iter()
            .cycle()
            .take(768)
            .collect();
        let ok = SetDeviceGammaRamp(hdc, identity.as_ptr() as *const c_void).as_bool();

        let restored = SetDeviceGammaRamp(hdc, original.as_ptr() as *const c_void).as_bool();
        ReleaseDC(None, hdc);
        ok && restored
    }
}

#[cfg(windows)]
fn probe_keyboard_hook() -> bool {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx, WH_KEYBOARD_LL,
    };

    unsafe extern "system" fn noop(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        CallNextHookEx(None, code, wparam, lparam)
    }

    // The hook must be created on the thread that owns the message loop; for a
    // capability probe installing and immediately removing it is enough.
    unsafe {
        match SetWindowsHookExW(WH_KEYBOARD_LL, Some(noop), None, 0) {
            Ok(hook) => {
                let _ = UnhookWindowsHookEx(hook);
                true
            }
            Err(_) => false,
        }
    }
}

/// Active display monitors (desktop monitors, not adapters).
#[cfg(windows)]
fn monitor_count() -> i32 {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

    unsafe { GetSystemMetrics(SM_CMONITORS) }
}

#[cfg(windows)]
fn display_count() -> u32 {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE,
    };

    let mut count = 0u32;
    let mut index = 0u32;
    unsafe {
        loop {
            let mut device = DISPLAY_DEVICEW::default();
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if !EnumDisplayDevicesW(PCWSTR::null(), index, &mut device, 0).as_bool() {
                break;
            }
            index += 1;
            if device.StateFlags & DISPLAY_DEVICE_ACTIVE != 0 {
                count += 1;
            }
        }
    }
    count
}

#[cfg(windows)]
fn message_box(text: &str, title: &str, error: bool) {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND,
    };

    let text = HSTRING::from(text);
    let title = HSTRING::from(title);
    let icon = if error { MB_ICONERROR } else { MB_ICONINFORMATION };
    let _ = unsafe { MessageBoxW(None, &text, &title, MB_OK | icon | MB_SETFOREGROUND) };
}

/* ---------------------------------- entry ---------------------------------- */

/// Runs the health check and exits.
pub fn run() -> ! {
    diag::init();
    diag::log("self-test requested");

    let mut report = Report::new();

    #[cfg(windows)]
    {
        report.push(webview2_present(), "WebView2 Runtime — نصب بودن موتور نمایش");
        let monitors = monitor_count();
        let adapters = display_count();
        report.push(
            monitors > 0 && adapters > 0,
            &format!("نمایشگر فعال شناسایی شد ({monitors} نمایشگر، {adapters} آداپتور)"),
        );
        report.push(probe_gamma(), "SetDeviceGammaRamp — کنترل دمای رنگ سخت‌افزاری");
        report.push(probe_keyboard_hook(), "WH_KEYBOARD_LL — قلاب کیبورد صفحه استراحت");

        let exe_ok = std::env::current_exe().map(|p| p.exists()).unwrap_or(false);
        report.push(exe_ok, "مسیر فایل اجرایی قابل خواندن است");
    }

    #[cfg(not(windows))]
    {
        report.push(true, "اجرای تست روی این سیستم‌عامل پشتیبانی نمی‌شود");
    }

    let mut text = String::from("چشم‌یار — نتیجه تست سلامت سیستم\r\n\r\n");
    for (ok, label) in &report.lines {
        text.push_str(if *ok { "✓  " } else { "✗  " });
        text.push_str(label);
        text.push_str("\r\n");
    }
    text.push_str("\r\n");
    text.push_str(&format!("لاگ: {}\r\n", diag::log_path().display()));
    text.push_str(if report.all_ok() {
        "همه بررسی‌ها موفق بود — برنامه آماده اجراست."
    } else {
        "برخی بررسی‌ها ناموفق بود؛ فایل لاگ را بفرستید تا بررسی شود."
    });

    #[cfg(windows)]
    message_box(&text, "ChashmYar — Self Test", !report.all_ok());

    std::process::exit(if report.all_ok() { 0 } else { 1 });
}
