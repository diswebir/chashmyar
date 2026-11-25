#![cfg(not(windows))]
//! Exercises the real foreground policy and Runtime glue with synthetic samples.
//! The host test does not call Win32, inspect real windows or change a display.
extern crate self as tauri;
#[derive(Clone)] pub struct AppHandle;

#[path = "../../../src-tauri/src/state.rs"] mod state;
#[path = "../../../src-tauri/src/foreground.rs"] mod foreground;
#[path = "../../../src-tauri/src/foreground_match.rs"] mod foreground_match;
#[path = "../../../src-tauri/src/color_vision.rs"] mod color_vision;
#[path = "../../../src-tauri/src/screen_handoff.rs"] mod screen_handoff;
mod diag { pub fn log<T: AsRef<str>>(_: T) {} }
mod analytics { pub fn epoch() -> u64 { 0 } }
mod display { pub const NEUTRAL_KELVIN: u32 = 6500; pub fn current_kelvin() -> u32 { NEUTRAL_KELVIN } }
mod windows { pub fn capture_exclusion_active() -> bool { false } }
mod color_filter {
    pub fn status() -> super::color_vision::Status { super::color_vision::Status::Off }
    pub fn screen_status() -> super::color_vision::Status { super::color_vision::Status::Off }
    pub fn screen_covers_overlay() -> bool { false }
}
mod engine {
    pub type Shared = std::sync::Arc<parking_lot::Mutex<super::state::Runtime>>;
    pub fn refresh(_: &super::AppHandle, _: &Shared) {}
}
use foreground_match::Sample;
use std::sync::{Arc, mpsc};

fn sample(sequence: u64, process: Option<&str>, title: Option<&str>) -> Sample {
    Sample { sequence, process: process.map(str::to_owned), title: title.map(str::to_owned) }
}
fn runtime() -> state::Runtime {
    let mut settings = state::Settings::default();
    settings.eye.enabled = true;
    settings.eye.schedule_enabled = false;
    settings.eye.color_safe_enabled = true;
    settings.eye.kelvin = 3200;
    settings.eye.brightness = 80;
    settings.eye.color_safe_whitelist = vec!["Figma.exe".into(), "DevTools".into()];
    state::Runtime::new(settings)
}

#[test]
fn missing_data_and_list_edits_preserve_then_release_the_real_snapshot() {
    let mut rt = runtime();
    foreground::cache_info(&mut rt, sample(1, Some("figma.exe"), Some("Design")));
    assert_eq!(rt.snapshot().eye.target_kelvin, 6500);
    foreground::cache_info(&mut rt, sample(2, None, Some("")));
    rt.settings.eye.color_safe_whitelist.retain(|v| v != "DevTools");
    foreground::refresh_cached_match(&mut rt);
    assert_eq!(rt.snapshot().eye.whitelisted_app.as_deref(), Some("Figma.exe"));
    foreground::cache_info(&mut rt, sample(3, None, None));
    assert!(rt.snapshot().eye.whitelisted);
    rt.settings.eye.color_safe_whitelist.clear();
    foreground::refresh_cached_match(&mut rt);
    let snap = rt.snapshot();
    assert!(!snap.eye.whitelisted);
    assert_eq!((snap.eye.target_kelvin, snap.eye.effective_brightness), (3200, 80));
}

#[test]
fn slow_old_lookup_cannot_overwrite_a_newer_sample_or_concurrent_settings() {
    let rt = Arc::new(parking_lot::Mutex::new(runtime()));
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let old_rt = Arc::clone(&rt);
    let old = std::thread::spawn(move || {
        let stale = sample(10, Some("figma.exe"), Some("Design"));
        ready_tx.send(()).unwrap();
        release_rx.recv().unwrap();
        let mut rt = old_rt.lock();
        assert!(!foreground::cache_info(&mut rt, stale));
        foreground::refresh_cached_match(&mut rt);
    });
    ready_rx.recv().unwrap();
    {
        let mut rt = rt.lock();
        assert!(foreground::cache_info(&mut rt, sample(11, Some("chrome.exe"), Some("DevTools"))));
        rt.settings.eye.color_safe_whitelist.retain(|v| v != "Figma.exe");
        foreground::refresh_cached_match(&mut rt);
    }
    release_tx.send(()).unwrap();
    old.join().unwrap();
    assert_eq!(rt.lock().snapshot().eye.whitelisted_app.as_deref(), Some("DevTools"));
}
