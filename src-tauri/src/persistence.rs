//! Settings persistence in the existing tauri-plugin-store-compatible JSON
//! file, e.g. `%APPDATA%\com.chashmyar.desktop\chashmyar.settings.json`.
//! Explicit reading catches corrupt files that plugin-store silently ignores;
//! same-directory replacement avoids truncating the previous file on errors.

use tauri::{AppHandle, Manager};
use std::sync::atomic::{AtomicBool, Ordering};
use crate::coalesced_signal::CoalescedSignal;
use crate::engine::Shared;

static SETTINGS_WRITER: crate::settings_recovery::SettingsWriter =
    crate::settings_recovery::SettingsWriter::new();
static SAVE_SIGNAL: CoalescedSignal = CoalescedSignal::new();
static SAVE_WORKER_STARTED: AtomicBool = AtomicBool::new(false);

pub const STORE_FILE: &str = "chashmyar.settings.json";
fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join(STORE_FILE)).map_err(|err| err.to_string())
}

pub fn load(app: &AppHandle) -> crate::settings_recovery::Loaded {
    let mut loaded = match settings_path(app) {
        Ok(path) => crate::settings_recovery::load_file(&path),
        Err(err) => crate::settings_recovery::Loaded {
            settings: crate::settings_recovery::safe_defaults(),
            may_update_autostart: false,
            warning: Some(format!("settings directory unavailable: {err}; eye protection starts off")),
        },
    };
    if let Some(warning) = &loaded.warning { crate::diag::log(format!("settings recovery: {warning}")); }
    loaded.settings.eye.normalize_color_vision();
    loaded.settings.eye.normalize_display();
    // Existing 2.4.8-and-earlier preferences migrate exactly once.
    loaded.settings.system.migrate_widget_hover_delay();
    loaded
}

/// Save the latest state under a single writer lock. Never call with the
/// runtime mutex already held; native store I/O stays outside that mutex.
pub fn save_current(app: &AppHandle, shared: &Shared) {
    if let Err(err) = save_current_checked(app, shared) {
        crate::diag::log(format!("settings save failed: {err}"));
    }
}

/// The updater must not proceed when the most recent settings cannot be saved.
/// As with any filesystem write, hardware failures still require a backup.
pub fn save_current_checked(app: &AppHandle, shared: &Shared) -> Result<(), String> {
    let path = settings_path(app)?;
    let backup = SETTINGS_WRITER.save_latest(&path, || shared.lock().settings.clone())
        .map_err(|e| e.to_string())?;
    if let Some(backup) = backup { crate::diag::log(format!("settings backup before save: {}", backup.display())); }
    Ok(())
}

/// Coalesce bursts of edits on a background worker rather than synchronously
/// writing the same settings file on every slider or button event.
pub fn request_save(app: &AppHandle, shared: &Shared) {
    SAVE_SIGNAL.mark();
    if SAVE_WORKER_STARTED.swap(true, Ordering::AcqRel) { return; }
    let app = app.clone();
    let shared = shared.clone();
    let started = std::thread::Builder::new().name("chashmyar-settings".into()).spawn(move || {
        SAVE_SIGNAL.run_supervised(std::time::Duration::from_millis(180),
            std::time::Duration::from_secs(1), || save_current(&app, &shared),
            || crate::diag::log("settings writer panicked; retrying latest batch"));
    });
    if let Err(err) = started {
        SAVE_WORKER_STARTED.store(false, Ordering::Release);
        crate::diag::log(format!("settings writer could not start: {err}; a later edit or shutdown will retry"));
    }
}
