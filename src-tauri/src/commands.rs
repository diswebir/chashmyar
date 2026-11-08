//! Every IPC command exposed to the webviews (`invoke(...)` from React).

use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::analytics::{self, AnalyticsSummary};
use crate::engine::{self, BreakEnd, Shared};
use crate::state::{Phase, Settings, Snapshot, WidgetMode};
use crate::{display, engine as _engine, locker, persistence, windows};

fn store_and_refresh(app: &AppHandle, shared: &State<'_, Shared>) -> Snapshot {
    persistence::request_save(app, shared.inner());
    engine::refresh(app, shared.inner())
}

/* -------------------------------- snapshots -------------------------------- */

#[tauri::command(async)]
pub fn get_snapshot(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn update_settings(app: AppHandle, shared: State<'_, Shared>, settings: Settings) -> Snapshot {
    let (mode_changed, theme_changed, language_changed);
    {
        let mut rt = shared.lock();
        mode_changed = rt.settings.system.widget_mode != settings.system.widget_mode;
        theme_changed = rt.settings.system.theme != settings.system.theme;
        language_changed = rt.settings.system.language != settings.system.language;
        rt.settings = settings;
        if rt.timer.phase == Phase::Idle || (rt.timer.phase == Phase::Work && !rt.timer.running && !rt.timer.paused) {
            rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
            rt.timer.remaining_seconds = rt.timer.total_seconds;
        }
    }
    if mode_changed { windows::apply_widget_mode(&app); }
    if theme_changed { windows::apply_theme(&app); }
    if language_changed { windows::apply_language(&app); }
    store_and_refresh(&app, &shared)
}

/// Update only the fields sent by the caller, atomically under the state lock.
/// This avoids stale webviews overwriting a dragged widget's saved position or
/// reverting unrelated settings changed in another window.
#[tauri::command(async)]
pub fn patch_settings(app: AppHandle, shared: State<'_, Shared>, patch: serde_json::Value) -> Result<Snapshot, String> {
    let (theme_changed, language_changed);
    {
        let mut rt = shared.lock();
        let mut current = serde_json::to_value(&rt.settings).map_err(|e| e.to_string())?;
        let groups = patch.as_object().ok_or("settings patch must be an object")?;
        for (group, updates) in groups {
            let target = current.get_mut(group).and_then(|v| v.as_object_mut())
                .ok_or_else(|| format!("unknown settings group: {group}"))?;
            let fields = updates.as_object().ok_or("settings section must be an object")?;
            for (key, value) in fields {
                // Placement and autostart have dedicated commands/side effects.
                if group == "system" && matches!(key.as_str(), "widgetMode" | "widgetX" | "widgetY" | "widgetPositionSet" | "autostart") {
                    return Err(format!("use the dedicated command for {key}"));
                }
                if !target.contains_key(key) { return Err(format!("unknown setting: {group}.{key}")); }
                target.insert(key.clone(), value.clone());
            }
        }
        let mut next: Settings = serde_json::from_value(current).map_err(|e| e.to_string())?;
        next.timer.work_minutes = next.timer.work_minutes.clamp(1, 180);
        next.timer.break_minutes = next.timer.break_minutes.clamp(1, 90);
        next.timer.long_break_minutes = next.timer.long_break_minutes.clamp(1, 120);
        next.timer.cycles_before_long_break = next.timer.cycles_before_long_break.clamp(1, 12);
        next.timer.pre_break_alert_seconds = next.timer.pre_break_alert_seconds.clamp(1, 300);
        next.timer.max_snooze = next.timer.max_snooze.min(10);
        next.timer.snooze_options = next.timer.snooze_options.into_iter().take(3).map(|n| n.clamp(1, 60)).collect();
        if next.timer.snooze_options.is_empty() { next.timer.snooze_options = vec![3, 5, 8]; }
        next.timer.idle_pause_seconds = next.timer.idle_pause_seconds.clamp(30, 3600);
        next.timer.idle_reset_seconds = next.timer.idle_reset_seconds.clamp(60, 7200);
        next.timer.micro_break_seconds = next.timer.micro_break_seconds.clamp(5, 120);
        next.lock.emergency_hold_seconds = next.lock.emergency_hold_seconds.clamp(2, 30);
        next.lock.rotate_seconds = next.lock.rotate_seconds.clamp(10, 300);
        next.lock.focus_penalty_seconds = next.lock.focus_penalty_seconds.clamp(5, 300);
        next.system.widget_hover_delay_ms = next.system.widget_hover_delay_ms.min(1500);
        theme_changed = next.system.theme != rt.settings.system.theme;
        language_changed = next.system.language != rt.settings.system.language;
        rt.settings = next;
        if rt.timer.phase == Phase::Idle || (rt.timer.phase == Phase::Work && !rt.timer.running && !rt.timer.paused) {
            rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes) * 60;
            rt.timer.remaining_seconds = rt.timer.total_seconds;
        }
    }
    if theme_changed { windows::apply_theme(&app); }
    if language_changed { windows::apply_language(&app); }
    Ok(store_and_refresh(&app, &shared))
}

/* ------------------------------ eye protection ----------------------------- */

#[tauri::command(async)]
pub fn set_kelvin(app: AppHandle, shared: State<'_, Shared>, kelvin: u32) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings.eye.kelvin = kelvin.clamp(2700, 6500);
        rt.settings.eye.profile = "custom".into();
    }
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn set_brightness(app: AppHandle, shared: State<'_, Shared>, brightness: u32) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings.eye.brightness = brightness.clamp(10, 100);
        rt.settings.eye.profile = "custom".into();
    }
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn set_eye_enabled(app: AppHandle, shared: State<'_, Shared>, enabled: bool) -> Snapshot {
    shared.lock().settings.eye.enabled = enabled;
    let snapshot = store_and_refresh(&app, &shared);
    crate::tray::sync_eye_check(&app, enabled);
    snapshot
}

#[tauri::command(async)]
pub fn apply_profile(app: AppHandle, shared: State<'_, Shared>, profile: String) -> Snapshot {
    {
        let mut rt = shared.lock();
        let (kelvin, brightness) = match profile.as_str() {
            "reading" => (3900, 88),
            "nightCoding" => (3000, 72),
            "daylight" => (6500, 100),
            _ => (rt.settings.eye.kelvin, rt.settings.eye.brightness),
        };
        rt.settings.eye.profile = profile;
        rt.settings.eye.kelvin = kelvin;
        rt.settings.eye.brightness = brightness;
        rt.settings.eye.enabled = true;
    }
    let snapshot = store_and_refresh(&app, &shared);
    crate::tray::sync_eye_check(&app, true);
    snapshot
}

/* ------------------------- colour-safe whitelist (v2) ---------------------- */

#[tauri::command(async)]
pub fn set_color_safe(app: AppHandle, shared: State<'_, Shared>, enabled: bool) -> Snapshot {
    shared.lock().settings.eye.color_safe_enabled = enabled;
    if !enabled {
        shared.lock().whitelist_active = None;
    }
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn whitelist_add(app: AppHandle, shared: State<'_, Shared>, entry: String) -> Snapshot {
    let cleaned = entry.trim().to_string();
    if !cleaned.is_empty() {
        let mut rt = shared.lock();
        let exists = rt
            .settings
            .eye
            .color_safe_whitelist
            .iter()
            .any(|e| e.eq_ignore_ascii_case(&cleaned));
        if !exists {
            rt.settings.eye.color_safe_whitelist.push(cleaned);
        }
    }
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn whitelist_remove(app: AppHandle, shared: State<'_, Shared>, entry: String) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings
            .eye
            .color_safe_whitelist
            .retain(|e| !e.eq_ignore_ascii_case(entry.trim()));
        rt.whitelist_active = None;
    }
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn whitelist_reset_defaults(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings.eye.color_safe_whitelist =
            crate::state::EyeSettings::default().color_safe_whitelist;
    }
    store_and_refresh(&app, &shared)
}

/* ----------------------------------- timer --------------------------------- */

#[tauri::command(async)]
pub fn timer_start(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    let _transition = engine::BREAK_TRANSITION.lock();
    let on_break = { matches!(shared.lock().timer.phase, Phase::Break | Phase::LongBreak) };
    if on_break { return engine::refresh(&app, shared.inner()); }
    let (pending, interrupted, exercise_skipped) = {
        let mut rt = shared.lock();
        let interrupted = rt.timer.phase == Phase::Work && rt.work_session_elapsed_seconds > 0;
        let exercise_skipped = rt.timer.micro_break_active && !rt.micro_break_is_preview;
        let pending = rt.take_focus();
        rt.timer.phase = Phase::Work;
        rt.timer.running = true;
        rt.timer.paused = false;
        rt.timer.idle_paused = false;
        rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
        rt.timer.remaining_seconds = rt.timer.total_seconds;
        rt.timer.snooze_count = 0;
        rt.timer.warning_visible = false;
        rt.timer.micro_break_active = false;
        rt.timer.micro_break_remaining = 0;
        rt.micro_break_is_preview = false;
        rt.work_elapsed_seconds = 0;
        rt.work_session_elapsed_seconds = 0;
        (pending, interrupted, exercise_skipped)
    };
    if let Some((date, seconds, epoch)) = pending { analytics::add_focus_seconds(&app, &date, seconds, epoch); }
    if interrupted || exercise_skipped {
        analytics::bump(&app, |r| {
            if interrupted { r.work_sessions_ended_early = r.work_sessions_ended_early.saturating_add(1); }
            if exercise_skipped { r.observed_exercises_skipped = r.observed_exercises_skipped.saturating_add(1); }
        });
    }
    windows::hide_snooze(&app);
    windows::hide_micro_break(&app);
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn timer_pause(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    {
        let mut rt = shared.lock();
        // Pausing is a *freeze*: the remaining time is preserved verbatim so the
        // user can resume exactly where they stopped.
        if rt.timer.running {
            rt.timer.paused = true;
        }
    }
    engine::refresh(&app, shared.inner())
}

/// Single entry point used by every play/pause affordance in the UI: it works
/// out whether to start, pause or resume, so no window can accidentally restart
/// a paused session from zero (the old floating-widget bug).
pub(crate) fn toggle_timer_shared(app: &AppHandle, shared: &Shared) {
    let mut fresh = false;
    {
        let mut rt = shared.lock();
        if rt.timer.running && !rt.timer.paused {
            rt.timer.paused = true;
        } else if rt.timer.phase != Phase::Idle && (rt.timer.remaining_seconds > 0 || matches!(rt.timer.phase, Phase::Break | Phase::LongBreak)) {
            rt.timer.running = true;
            rt.timer.paused = false;
            rt.timer.idle_paused = false;
        } else if rt.timer.phase == Phase::Work && rt.timer.remaining_seconds <= 0 {
            // A finished session may be waiting for the ticker transition.
            rt.timer.running = true;
            rt.timer.paused = false;
            rt.timer.idle_paused = false;
        } else {
            rt.timer.phase = Phase::Work;
            rt.timer.running = true;
            rt.timer.paused = false;
            rt.timer.idle_paused = false;
            rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
            rt.timer.remaining_seconds = rt.timer.total_seconds;
            rt.timer.snooze_count = 0;
            rt.timer.warning_visible = false;
            rt.timer.micro_break_active = false;
            rt.timer.micro_break_remaining = 0;
            rt.work_elapsed_seconds = 0;
            rt.focus_seconds = 0;
            rt.work_session_elapsed_seconds = 0;
            rt.micro_break_is_preview = false;
            fresh = true;
        }
    }
    if fresh {
        windows::hide_snooze(app);
        windows::hide_micro_break(app);
    }
}

#[tauri::command(async)]
pub fn timer_toggle(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    toggle_timer_shared(&app, shared.inner());
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn timer_resume(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    {
        let mut rt = shared.lock();
        if rt.timer.phase != Phase::Idle { rt.timer.running = true; }
        rt.timer.paused = false;
        rt.timer.idle_paused = false;
    }
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn timer_reset(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    // Reset and break entry/exit must not race the global keyboard hook.
    let _transition = engine::BREAK_TRANSITION.lock();
    let blocked = {
        let rt = shared.lock();
        matches!(rt.timer.phase, Phase::Break | Phase::LongBreak) && rt.settings.lock.strict_lock
    };
    if blocked { return engine::refresh(&app, shared.inner()); }
    let (pending, interrupted, skipped_break, skipped_exercise) = {
        let mut rt = shared.lock();
        let interrupted = rt.timer.phase == Phase::Work && rt.work_session_elapsed_seconds > 0;
        let skipped_break = matches!(rt.timer.phase, Phase::Break | Phase::LongBreak);
        let skipped_exercise = rt.timer.micro_break_active && !rt.micro_break_is_preview;
        let pending = rt.take_focus();
        rt.timer.phase = Phase::Idle;
        rt.timer.running = false;
        rt.timer.paused = false;
        rt.timer.idle_paused = false;
        rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
        rt.timer.remaining_seconds = rt.timer.total_seconds;
        rt.timer.snooze_count = 0;
        rt.timer.warning_visible = false;
        rt.timer.micro_break_active = false;
        rt.timer.micro_break_remaining = 0;
        rt.micro_break_is_preview = false;
        rt.work_elapsed_seconds = 0;
        rt.work_session_elapsed_seconds = 0;
        rt.break_counts_cycle = false;
        (pending, interrupted, skipped_break, skipped_exercise)
    };
    if let Some((date, seconds, epoch)) = pending { analytics::add_focus_seconds(&app, &date, seconds, epoch); }
    if interrupted || skipped_break || skipped_exercise {
        analytics::bump(&app, |r| {
            if interrupted { r.work_sessions_ended_early = r.work_sessions_ended_early.saturating_add(1); }
            if skipped_break { r.observed_breaks_skipped = r.observed_breaks_skipped.saturating_add(1); }
            if skipped_exercise { r.observed_exercises_skipped = r.observed_exercises_skipped.saturating_add(1); }
        });
    }
    locker::release();
    crate::focus_guard::stop();
    windows::hide_snooze(&app);
    windows::hide_micro_break(&app);
    windows::hide_lock(&app);
    engine::refresh(&app, shared.inner())
}

/* ---------------------------------- snooze --------------------------------- */

#[tauri::command(async)]
pub fn snooze(app: AppHandle, shared: State<'_, Shared>, minutes: u32) -> Snapshot {
    let mut applied = false;
    {
        let mut rt = shared.lock();
        let budget = rt.timer.snooze_count < rt.settings.timer.max_snooze;
        // One warning is one choice, even if clicks race or the preview is open.
        if budget && rt.timer.phase == Phase::Work && rt.timer.warning_visible {
            let extra = i64::from(minutes.clamp(1, 60)) * 60;
            rt.timer.remaining_seconds += extra;
            rt.timer.total_seconds += extra;
            rt.timer.snooze_count += 1;
            rt.timer.warning_visible = false;
            applied = true;
        }
    }
    if applied {
        analytics::bump(&app, |r| r.snooze_used_count += 1);
    }
    windows::hide_snooze(&app);
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn dismiss_warning(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    shared.lock().timer.warning_visible = false;
    windows::hide_snooze(&app);
    engine::refresh(&app, shared.inner())
}

/* ------------------------------ break / lock ------------------------------- */

#[tauri::command(async)]
pub fn emergency_unlock(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    engine::emergency_unlock(&app, shared.inner());
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn end_break_early(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    let allowed = {
        let rt = shared.lock();
        matches!(rt.timer.phase, Phase::Break | Phase::LongBreak) && !rt.settings.lock.strict_lock
    };
    if allowed { engine::leave_break(&app, shared.inner(), BreakEnd::Early); }
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn start_break_now(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    engine::enter_break(&app, shared.inner(), true);
    engine::refresh(&app, shared.inner())
}

/* --------------------------- 20-20-20 micro break -------------------------- */

#[tauri::command(async)]
pub fn dismiss_micro_break(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    let skipped = {
        let mut rt = shared.lock();
        let skipped = rt.timer.micro_break_active && !rt.micro_break_is_preview;
        rt.timer.micro_break_active = false;
        rt.timer.micro_break_remaining = 0;
        rt.micro_break_is_preview = false;
        rt.work_elapsed_seconds = 0;
        skipped
    };
    if skipped { analytics::bump(&app, |r| r.observed_exercises_skipped = r.observed_exercises_skipped.saturating_add(1)); }
    windows::hide_micro_break(&app);
    engine::refresh(&app, shared.inner())
}

#[tauri::command(async)]
pub fn start_micro_break_now(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    {
        let mut rt = shared.lock();
        // This control is a preview; do not alter an already running reminder.
        if !rt.timer.micro_break_active {
            rt.timer.micro_break_active = true;
            rt.micro_break_is_preview = true;
            rt.timer.micro_break_total = rt.settings.timer.micro_break_seconds.max(5);
            rt.timer.micro_break_remaining = rt.timer.micro_break_total;
        }
    }
    windows::show_micro_break_if_active(&app, shared.inner());
    engine::refresh(&app, shared.inner())
}

/* ------------------------------- analytics --------------------------------- */

#[tauri::command(async)]
pub fn analytics_get(app: AppHandle) -> AnalyticsSummary {
    analytics::summary(&app)
}

#[tauri::command(async)]
pub fn analytics_today(app: AppHandle) -> analytics::DailyRecord {
    analytics::record(&app)
}

#[tauri::command(async)]
pub fn analytics_reset(app: AppHandle, shared: State<'_, Shared>) {
    // Also discards pending pre-reset partial minutes.
    analytics::reset_all(&app, shared.inner());
}

/* --------------------------------- windows --------------------------------- */

#[tauri::command(async)]
pub fn set_micro_expanded(app: AppHandle, expanded: bool) {
    windows::set_micro_expanded(&app, expanded);
}

#[tauri::command(async)]
pub fn open_settings_window(app: AppHandle) {
    windows::focus_main(&app);
}

#[tauri::command(async)]
pub fn open_main_window(app: AppHandle) {
    windows::focus_main(&app);
}

/* ------------------------- micro widget placement -------------------------- */

#[tauri::command(async)]
pub fn set_widget_mode(
    app: AppHandle,
    shared: State<'_, Shared>,
    mode: String,
) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings.system.widget_mode = match mode.as_str() {
            "floating" => WidgetMode::Floating,
            _ => WidgetMode::Docked,
        };
    }
    let snapshot = store_and_refresh(&app, &shared);
    windows::apply_widget_mode(&app);
    snapshot
}

#[tauri::command(async)]
pub fn save_widget_position(
    app: AppHandle,
    shared: State<'_, Shared>,
    x: i32,
    y: i32,
) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings.system.widget_x = x;
        rt.settings.system.widget_y = y;
        rt.settings.system.widget_position_set = true;
        rt.settings.system.widget_mode = WidgetMode::Floating;
    }
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn snap_widget_to_edge(app: AppHandle, shared: State<'_, Shared>) -> Snapshot {
    {
        let mut rt = shared.lock();
        rt.settings.system.widget_mode = WidgetMode::Docked;
        rt.settings.system.widget_position_set = false;
    }
    let snapshot = store_and_refresh(&app, &shared);
    windows::apply_widget_mode(&app);
    snapshot
}

#[tauri::command(async)]
pub fn show_window(app: AppHandle, label: String) {
    match label.as_str() {
        "snooze-alert" => windows::show_snooze(&app),
        // A preview is deliberately non-locking. The preview UI has a Close
        // button; keyboard hooks and penalties are used only for a real break.
        "break-lock" => { windows::show_lock(&app); }
        "micro-break" => windows::show_micro_break(&app),
        "dimmer-overlay" => windows::sync_overlay(&app, true),
        _ => windows::focus_main(&app),
    }
}

#[tauri::command(async)]
pub fn hide_window(app: AppHandle, label: String) {
    match label.as_str() {
        "snooze-alert" => windows::hide_snooze(&app),
        "break-lock" => {
            let shared = engine::shared(&app);
            let on_break = matches!(shared.lock().timer.phase, Phase::Break | Phase::LongBreak);
            if !on_break { windows::hide_lock(&app); }
        }
        "micro-break" => windows::hide_micro_break(&app),
        "dimmer-overlay" => windows::sync_overlay(&app, false),
        other => windows::hide(&app, other),
    }
}

/* --------------------------------- system ---------------------------------- */

#[tauri::command(async)]
pub fn set_autostart(app: AppHandle, shared: State<'_, Shared>, enabled: bool) -> Snapshot {
    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    if let Err(err) = result { crate::diag::log(format!("autostart change failed: {err}")); }
    let actual = manager.is_enabled().unwrap_or(!enabled);
    shared.lock().settings.system.autostart = actual;
    store_and_refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command(async)]
pub fn reset_gamma(app: AppHandle) -> Snapshot {
    let shared = _engine::shared(&app);
    {
        let mut rt = shared.lock();
        // Keep the chosen temperature for a later re-enable.
        rt.settings.eye.enabled = false;
        rt.last_gamma_kelvin = None;
    }
    display::restore_gamma();
    persistence::request_save(&app, &shared);
    crate::tray::sync_eye_check(&app, false);
    engine::refresh(&app, &shared)
}

#[tauri::command(async)]
pub fn open_creator_website() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Fixed constant, never interpolated user input; no console window.
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", "https://disweb.ir/"])
            .creation_flags(0x08000000)
            .spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg("https://disweb.ir/")
            .spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn open_log_folder() {
    crate::diag::reveal_log_folder();
}

#[tauri::command(async)]
pub fn log_path() -> String {
    crate::diag::log_path().display().to_string()
}

#[tauri::command(async)]
pub fn quit_app(app: AppHandle, shared: State<'_, Shared>) {
    engine::safe_shutdown(&app);
    let _ = shared;
    app.exit(0);
}
