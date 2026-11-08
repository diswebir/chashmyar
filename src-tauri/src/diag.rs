//! Lightweight startup / runtime diagnostics.
//!
//! Everything is appended to `%LOCALAPPDATA%\ChashmYar\startup.log` so a user can
//! send a single file when something misbehaves. The log is rotated (truncated)
//! on every launch and never grows past ~256 KB.

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

fn base_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

pub fn log_dir() -> PathBuf {
    LOG_DIR
        .get_or_init(|| {
            let dir = base_dir().join("ChashmYar");
            let _ = std::fs::create_dir_all(&dir);
            dir
        })
        .clone()
}

pub fn log_path() -> PathBuf {
    log_dir().join("startup.log")
}

/// Truncates the log and writes a fresh header.
pub fn init() {
    let path = log_path();
    let _ = std::fs::write(
        &path,
        format!(
            "ChashmYar v{} — diagnostic log\nstarted: {}\nexe: {}\n---\n",
            env!("CARGO_PKG_VERSION"),
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            std::env::current_exe()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "?".into()),
        ),
    );
    log("diagnostics initialised");
}

pub fn log(message: impl AsRef<str>) {
    let path = log_path();
    // Cheap rotation guard.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 262_144 {
            let _ = std::fs::write(&path, "log rotated\n");
        }
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(
            file,
            "[{}] {}",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            message.as_ref()
        );
    }
}

/// Last-resort native message box for failures that happen before/while the
/// webview exists (a GUI-subsystem binary has no console to print to).
pub fn fatal_box(message: &str) {
    log(format!("FATAL: {message}"));
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND,
        };
        let text = HSTRING::from(message);
        let title = HSTRING::from("ChashmYar — خطای اجرا");
        let _ = unsafe { MessageBoxW(None, &text, &title, MB_OK | MB_ICONERROR | MB_SETFOREGROUND) };
    }
}

/// Opens the log folder in Explorer (used by the settings panel).
pub fn reveal_log_folder() {
    let dir = log_dir();
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer.exe").arg(dir).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
    }
}
