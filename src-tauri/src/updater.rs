//! Background signed updater. The webview never receives the updater plugin's
//! permissions or the downloaded bytes; installation requires an explicit IPC
//! command after the UI has asked the user. Portable and NSIS builds use
//! different signed assets and different install paths.
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{engine, update_policy, windows};

pub const PUBLIC_KEY: &str = match option_env!("CHASHMYAR_UPDATER_PUBLIC_KEY") {
    Some(key) => key,
    None => "",
};
const IS_PORTABLE: bool = cfg!(feature = "portable");
#[cfg(feature = "portable")]
const BUILD_MARKER: &str = "CHASHMYAR_PORTABLE_UPDATER_V1";
#[cfg(not(feature = "portable"))]
const BUILD_MARKER: &str = "CHASHMYAR_NSIS_UPDATER_V1";
const STATUS_EVENT: &str = "app://update-status";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    revision: u64,
    phase: &'static str,
    version: Option<String>,
    kind: &'static str,
    downloaded: u64,
    total: Option<u64>,
    error: Option<&'static str>,
    // Also lets release tooling distinguish the portable build from NSIS.
    build_marker: &'static str,
}

struct ReadyUpdate {
    update: Update,
    bytes: Vec<u8>,
    // Tauri's installer callback runs *before* ShellExecuteW. If that launch
    // fails afterwards, cleanup has already made the Tauri app unusable.
    shutdown_started: Arc<AtomicBool>,
}
struct Inner { status: UpdateStatus, ready: Option<ReadyUpdate> }
pub struct UpdateState(Mutex<Inner>);

impl UpdateState {
    pub fn new() -> Self {
        let phase = if !cfg!(windows) { "unsupported" }
            else if PUBLIC_KEY.trim().is_empty() { "unconfigured" }
            else { "idle" };
        Self(Mutex::new(Inner {
            status: UpdateStatus {
                revision: 0, phase, version: None,
                kind: if IS_PORTABLE { "portable" } else { "installed" },
                downloaded: 0, total: None, error: None, build_marker: BUILD_MARKER,
            },
            ready: None,
        }))
    }
}

fn publish(app: &AppHandle) {
    let status = app.state::<UpdateState>().0.lock().status.clone();
    let _ = app.emit(STATUS_EVENT, status);
}
fn fail(app: &AppHandle, reason: &'static str, detail: impl std::fmt::Display) {
    crate::diag::log(format!("update {reason}: {detail}"));
    {
        let state = app.state::<UpdateState>();
        let mut inner = state.0.lock();
        inner.ready = None;
        inner.status.revision += 1;
        inner.status.phase = "error";
        inner.status.error = Some(reason);
    }
    publish(app);
}

/// Run independently of webview visibility so tray-only sessions still check.
pub fn start_periodic_checks(app: AppHandle) {
    if !cfg!(windows) || PUBLIC_KEY.trim().is_empty() { return; }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            request_check(&app);
            std::thread::sleep(CHECK_INTERVAL);
        }
    });
}

fn request_check(app: &AppHandle) {
    {
        let state = app.state::<UpdateState>();
        let mut inner = state.0.lock();
        if matches!(inner.status.phase, "unconfigured" | "unsupported" | "checking" | "downloading" | "ready" | "installing" | "restartRequired") {
            return;
        }
        inner.ready = None;
        inner.status.revision += 1;
        inner.status.phase = "checking";
        inner.status.version = None;
        inner.status.downloaded = 0;
        inner.status.total = None;
        inner.status.error = None;
    }
    publish(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move { check_and_download(handle).await; });
}

async fn check_and_download(app: AppHandle) {
    let for_shutdown = app.clone();
    let shutdown_started = Arc::new(AtomicBool::new(false));
    let for_callback = Arc::clone(&shutdown_started);
    let target = if IS_PORTABLE { "windows-x86_64-portable" } else { "windows-x86_64" };
    let builder = app.updater_builder()
        .target(target)
        .timeout(Duration::from_secs(45))
        .on_before_exit(move || {
            // Tauri's Windows installer exits with std::process::exit, bypassing
            // normal RunEvent::Exit. Preserve settings and release OS hooks first.
            for_callback.store(true, Ordering::Release);
            engine::safe_shutdown(&for_shutdown);
            for_shutdown.cleanup_before_exit();
        });
    let updater = match builder.build() {
        Ok(u) => u,
        Err(e) => { fail(&app, "check", e); return; }
    };
    let mut update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            {
                let state = app.state::<UpdateState>();
                let mut inner = state.0.lock();
                inner.status.revision += 1;
                inner.status.phase = "upToDate";
                inner.status.error = None;
            }
            publish(&app);
            return;
        }
        Err(e) => { fail(&app, "check", e); return; }
    };
    let expected = update_policy::expected_download_url(&update.version, IS_PORTABLE);
    if expected.as_deref() != Some(update.download_url.as_str()) {
        fail(&app, "manifest", "unexpected version, repository or asset URL");
        return;
    }
    {
        let state = app.state::<UpdateState>();
        let mut inner = state.0.lock();
        inner.status.revision += 1;
        inner.status.phase = "downloading";
        inner.status.version = Some(update.version.clone());
    }
    publish(&app);

    // The pinned updater does not copy the builder timeout into Update::timeout.
    update.timeout = Some(Duration::from_secs(180));
    let progress_app = app.clone();
    let mut transferred = 0u64;
    let mut last_event = Instant::now() - Duration::from_secs(1);
    // download() verifies the Ed25519 signature and signed version before
    // returning bytes. Neither the manifest's SHA nor TLS alone is trusted.
    let bytes = match update.download(|chunk, total| {
        transferred = transferred.saturating_add(chunk as u64);
        if last_event.elapsed() >= Duration::from_millis(300) {
            {
                let state = progress_app.state::<UpdateState>();
                let mut inner = state.0.lock();
                inner.status.revision += 1;
                inner.status.downloaded = transferred;
                inner.status.total = total;
            }
            publish(&progress_app);
            last_event = Instant::now();
        }
    }, || {}).await {
        Ok(bytes) => bytes,
        Err(e) => { fail(&app, "download", e); return; }
    };
    if !update_policy::valid_windows_payload(&bytes, IS_PORTABLE) {
        fail(&app, "payload", "signed payload is not the expected Windows PE format");
        return;
    }
    {
        let state = app.state::<UpdateState>();
        let mut inner = state.0.lock();
        inner.status.revision += 1;
        inner.status.phase = "ready";
        inner.status.downloaded = bytes.len() as u64;
        inner.status.total = Some(bytes.len() as u64);
        inner.status.error = None;
        inner.ready = Some(ReadyUpdate { update, bytes, shutdown_started });
    }
    publish(&app);
    notify_when_safe(app);
}

/// A passive in-app card works even for a standalone EXE, for which native
/// Windows toast registration is not guaranteed. It never runs over a break lock.
fn notify_when_safe(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            let ready = app.state::<UpdateState>().0.lock().status.phase == "ready";
            if !ready { return; }
            let on_break = app.try_state::<engine::Shared>().map(|s| {
                matches!(s.lock().timer.phase, crate::state::Phase::Break | crate::state::Phase::LongBreak)
            }).unwrap_or(false);
            if !on_break && windows::show_update_notice(&app) { break; }
            if app.get_webview_window(windows::UPDATE_ALERT).is_none() { return; }
            std::thread::sleep(Duration::from_secs(5));
        }
        std::thread::sleep(Duration::from_secs(14));
        windows::hide(&app, windows::UPDATE_ALERT);
    });
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    app.state::<UpdateState>().0.lock().status.clone()
}

#[tauri::command]
pub fn check_for_updates(app: AppHandle) -> UpdateStatus {
    request_check(&app);
    update_status(app)
}

#[tauri::command(async)]
pub fn update_open_details(app: AppHandle) {
    windows::hide(&app, windows::UPDATE_ALERT);
    if let Some(shared) = app.try_state::<engine::Shared>() {
        if matches!(shared.lock().timer.phase, crate::state::Phase::Break | crate::state::Phase::LongBreak) { return; }
    }
    let _ = app.emit_to(windows::MAIN, "app://open-updates", ());
    windows::focus_main(&app);
}

#[tauri::command(async)]
pub fn update_dismiss_notice(app: AppHandle) { windows::hide(&app, windows::UPDATE_ALERT); }

/// Called only after explicit user confirmation in the main window.
#[tauri::command(async)]
pub fn install_ready_update(app: AppHandle) -> Result<(), String> {
    // Prevent the timer from starting a strict break between the check and
    // the process shutdown/restart. This mutex is never held during download.
    // The installer callback and portable exit event call safe_shutdown; it
    // must never acquire BREAK_TRANSITION, directly or indirectly. Tauri posts
    // the portable exit event asynchronously; it can run before this returns.
    let _transition = engine::BREAK_TRANSITION.lock();
    if let Some(shared) = app.try_state::<engine::Shared>() {
        if matches!(shared.lock().timer.phase, crate::state::Phase::Break | crate::state::Phase::LongBreak) {
            return Err("break_active".into());
        }
    }
    let ready = {
        let state = app.state::<UpdateState>();
        let mut inner = state.0.lock();
        if inner.status.phase != "ready" { return Err("not_ready".into()); }
        let ready = inner.ready.take().ok_or("not_ready")?;
        inner.status.revision += 1;
        inner.status.phase = "installing";
        inner.status.error = None;
        ready
    };
    publish(&app);
    // Do not replace/launch anything if the settings file cannot be flushed.
    // Keep the already verified download so the user can retry after fixing I/O.
    let saved = app.try_state::<engine::Shared>()
        .ok_or_else(|| "settings state is unavailable".to_string())
        .and_then(|shared| crate::persistence::save_current_checked(&app, shared.inner()));
    if let Err(e) = saved {
        crate::diag::log(format!("update settings save failed: {e}"));
        let state = app.state::<UpdateState>();
        let mut inner = state.0.lock();
        inner.status.revision += 1;
        inner.status.phase = "ready";
        inner.status.error = Some("settings_save");
        inner.ready = Some(ready);
        drop(inner);
        publish(&app);
        return Err("settings_save".into());
    }
    if IS_PORTABLE {
        #[cfg(all(windows, feature = "portable"))]
        {
            if let Err(e) = crate::portable_replace::install_and_start(&ready.bytes) {
                crate::diag::log(format!("portable update failed: {e}"));
                let state = app.state::<UpdateState>();
                let mut inner = state.0.lock();
                inner.status.revision += 1;
                inner.status.phase = "ready";
                inner.status.error = Some("portable_install");
                inner.ready = Some(ready);
                drop(inner);
                publish(&app);
                return Err("portable_install".into());
            }
            engine::safe_shutdown(&app);
            app.exit(0);
            return Ok(());
        }
        #[cfg(not(all(windows, feature = "portable")))]
        { let _ = ready; return Err("unsupported".into()); }
    }
    // Only pass the in-memory bytes returned by Update::download above. The
    // pinned 2.14.1 updater also re-verifies them in install(); never accept
    // bytes or a signature from a webview, temp file, or separate IPC.
    match ready.update.install(&ready.bytes) {
        Ok(()) => Ok(()), // Windows normally exits in the plugin instead.
        Err(e) => {
            crate::diag::log(format!("installer launch failed: {e}"));
            if ready.shutdown_started.load(Ordering::Acquire) {
                // Tauri 2.14.1 invokes the callback before ShellExecuteW, not
                // after it. Once cleanup_before_exit has run, its documented
                // contract forbids further Tauri API use. An OS dialog remains
                // visible even though all webviews have been hidden, then exit.
                crate::diag::fatal_box(
                    "اجرای نصب‌کننده ناموفق بود. چشم‌یار بسته می‌شود؛ دوباره آن را اجرا و تلاش کنید.\n\nInstaller could not start. ChashmYar will close; reopen it and try again."
                );
                std::process::exit(1);
            }
            // Extraction/temp-file errors happen before cleanup: keep the
            // verified bytes and the live UI so a retry needs no re-download.
            let state = app.state::<UpdateState>();
            let mut inner = state.0.lock();
            inner.status.revision += 1;
            inner.status.phase = "ready";
            inner.status.error = Some("installer_prepare");
            inner.ready = Some(ready);
            drop(inner);
            publish(&app);
            Err("installer_prepare".into())
        }
    }
}
