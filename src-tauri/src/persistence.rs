//! Settings persistence through `tauri-plugin-store` (a plain JSON file in the
//! app data directory, e.g. `%APPDATA%\com.chashmyar.desktop\chashmyar.settings.json`).

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::coalesced_signal::CoalescedSignal;
use crate::engine::Shared;

static SAVE_LOCK: Mutex<()> = Mutex::new(());
static SAVE_SIGNAL: CoalescedSignal = CoalescedSignal::new();
static SAVE_WORKER_STARTED: AtomicBool = AtomicBool::new(false);

use crate::state::Settings;

pub const STORE_FILE: &str = "chashmyar.settings.json";
const KEY: &str = "settings";

pub fn load(app: &AppHandle) -> Settings {
    if let Ok(store) = app.store(STORE_FILE) {
        if let Some(value) = store.get(KEY) {
            if let Ok(mut settings) = serde_json::from_value::<Settings>(value) {
                settings.eye.normalize_color_vision();
                return settings;
            }
        }
    }
    Settings::default()
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
    let _writer = SAVE_LOCK.lock();
    let settings = shared.lock().settings.clone();
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    store.set(KEY, value);
    store.save().map_err(|e| e.to_string())
}

/// Coalesce bursts of edits on a background worker rather than synchronously
/// writing the same settings file on every slider or button event.
pub fn request_save(app: &AppHandle, shared: &Shared) {
    SAVE_SIGNAL.mark();
    if SAVE_WORKER_STARTED.swap(true, Ordering::AcqRel) { return; }
    let app = app.clone();
    let shared = shared.clone();
    std::thread::spawn(move || loop {
        SAVE_SIGNAL.wait_batch(std::time::Duration::from_millis(180));
        save_current(&app, &shared);
    });
}
