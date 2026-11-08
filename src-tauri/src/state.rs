//! Authoritative application state shared between the Rust core and all webviews.

use serde::{Deserialize, Serialize};

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EyeSettings {
    pub enabled: bool,
    pub kelvin: u32,
    pub brightness: u32,
    pub profile: String,
    pub schedule_enabled: bool,
    pub schedule_start: String,
    pub schedule_end: String,
    pub schedule_kelvin: u32,
    pub schedule_brightness: u32,
    /* ---- v2: colour-safe whitelist ---- */
    pub color_safe_enabled: bool,
    /// Process names (`Figma.exe`) or window-title keywords (`DevTools`).
    pub color_safe_whitelist: Vec<String>,
    /// Length of the gamma lerp when the whitelist engages/releases (ms).
    pub transition_ms: u32,
}

impl Default for EyeSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            kelvin: 4200,
            brightness: 100,
            profile: "custom".into(),
            schedule_enabled: false,
            schedule_start: "19:30".into(),
            schedule_end: "07:00".into(),
            schedule_kelvin: 3000,
            schedule_brightness: 82,
            color_safe_enabled: true,
            color_safe_whitelist: vec![
                "Figma.exe".into(),
                "Photoshop.exe".into(),
                "Illustrator.exe".into(),
                "DevTools".into(),
                "Inspect".into(),
            ],
            transition_ms: 2000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TimerSettings {
    pub work_minutes: u32,
    pub break_minutes: u32,
    pub long_break_minutes: u32,
    pub cycles_before_long_break: u32,
    pub pre_break_alert_seconds: i64,
    pub snooze_options: Vec<u32>,
    pub max_snooze: u32,
    pub auto_start_break: bool,
    pub auto_start_next_work: bool,
    /* ---- v2: idle detection ---- */
    pub idle_detection_enabled: bool,
    /// Auto-pause after this much inactivity (default 3 min).
    pub idle_pause_seconds: u32,
    /// Treat the absence as a completed natural break (default 5 min).
    pub idle_reset_seconds: u32,
    /* ---- v2: 20-20-20 micro breaks ---- */
    pub micro_break_enabled: bool,
    pub micro_break_interval_minutes: u32,
    pub micro_break_seconds: i64,
    /// Never interrupt when the full break is closer than this (default 3 min).
    pub micro_break_min_remaining_seconds: i64,
}

impl Default for TimerSettings {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            pre_break_alert_seconds: 30,
            snooze_options: vec![3, 5, 8],
            max_snooze: 3,
            auto_start_break: true,
            auto_start_next_work: false,
            idle_detection_enabled: true,
            idle_pause_seconds: 180,
            idle_reset_seconds: 300,
            micro_break_enabled: true,
            micro_break_interval_minutes: 15,
            micro_break_seconds: 15,
            micro_break_min_remaining_seconds: 180,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LockSettings {
    pub strict_lock: bool,
    pub emergency_unlock: bool,
    pub emergency_hold_seconds: u32,
    pub eye_exercises: bool,
    pub body_exercises: bool,
    pub rotate_seconds: u32,
    /* ---- v2: focus penalty ---- */
    pub focus_penalty_enabled: bool,
    pub focus_penalty_seconds: u32,
}

impl Default for LockSettings {
    fn default() -> Self {
        Self {
            strict_lock: true,
            emergency_unlock: true,
            emergency_hold_seconds: 5,
            eye_exercises: true,
            body_exercises: true,
            rotate_seconds: 45,
            focus_penalty_enabled: true,
            focus_penalty_seconds: 30,
        }
    }
}

/// UI colour scheme — every window (main app, widgets, break screen) follows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    Dark,
    Light,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Light
    }
}

/// UI language for every string rendered by the webviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    Fa,
    En,
}

impl Default for Language {
    fn default() -> Self {
        Language::Fa
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetMode {
    /// 2px strip glued to the top edge of the screen.
    Docked,
    /// Free-floating draggable capsule.
    Floating,
}

impl Default for WidgetMode {
    fn default() -> Self {
        WidgetMode::Docked
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemSettings {
    pub autostart: bool,
    pub auto_start_timer_on_launch: bool,
    pub eye_care_on_launch: bool,
    pub sound_enabled: bool,
    pub minimize_to_tray: bool,
    /* ---- v2: micro widget placement ---- */
    pub widget_mode: WidgetMode,
    pub widget_x: i32,
    pub widget_y: i32,
    pub widget_position_set: bool,
    /* ---- v2.1: appearance & behaviour ---- */
    pub theme: Theme,
    pub language: Language,
    /// How long the cursor must rest on the docked strip before the pill opens.
    pub widget_hover_delay_ms: u32,
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            autostart: false,
            auto_start_timer_on_launch: false,
            eye_care_on_launch: true,
            sound_enabled: true,
            minimize_to_tray: true,
            widget_mode: WidgetMode::Docked,
            widget_x: 0,
            widget_y: 0,
            widget_position_set: false,
            theme: Theme::Light,
            language: Language::Fa,
            widget_hover_delay_ms: 300,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub eye: EyeSettings,
    pub timer: TimerSettings,
    pub lock: LockSettings,
    pub system: SystemSettings,
}

/* -------------------------------------------------------------------------- */
/*                                   Timer                                    */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Work,
    Break,
    LongBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub phase: Phase,
    pub running: bool,
    pub paused: bool,
    pub remaining_seconds: i64,
    pub total_seconds: i64,
    pub cycle_index: u32,
    pub completed_work_sessions: u32,
    pub snooze_count: u32,
    pub warning_visible: bool,
    /* ---- v2 ---- */
    /// Timer automatically frozen because the user walked away.
    pub idle_paused: bool,
    pub idle_seconds: u32,
    /// 20-20-20 sub-state (15s, non-blocking).
    pub micro_break_active: bool,
    pub micro_break_remaining: i64,
    pub micro_break_total: i64,
    /// Increments on every focus penalty so the UI can pulse a toast.
    pub penalty_pulse: u32,
    pub penalties_this_break: u32,
    /// 0..1 — how far the user has held Ctrl + Shift on the break screen.
    /// Computed natively from `GetAsyncKeyState`, so it works with *any*
    /// keyboard layout (the old Ctrl+Shift+U combo broke on non-Latin layouts).
    pub emergency_hold_progress: f32,
}

impl Default for TimerState {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            running: false,
            paused: false,
            remaining_seconds: 25 * 60,
            total_seconds: 25 * 60,
            cycle_index: 1,
            completed_work_sessions: 0,
            snooze_count: 0,
            warning_visible: false,
            idle_paused: false,
            idle_seconds: 0,
            micro_break_active: false,
            micro_break_remaining: 0,
            micro_break_total: 15,
            penalty_pulse: 0,
            penalties_this_break: 0,
            emergency_hold_progress: 0.0,
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Snapshot                                  */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EyeInfo {
    pub gamma_supported: bool,
    pub gamma_applied: bool,
    /// Interpolated value currently in the GPU LUT.
    pub effective_kelvin: u32,
    /// Where the engine is heading (after whitelist resolution).
    pub target_kelvin: u32,
    pub effective_brightness: u32,
    pub scheduled: bool,
    /// Colour-safe whitelist is currently overriding the filter.
    pub whitelisted: bool,
    pub whitelisted_app: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Monotonic within a process: webviews can reject stale IPC replies.
    pub revision: u64,
    pub settings: Settings,
    pub timer: TimerState,
    pub eye: EyeInfo,
}

/* -------------------------------------------------------------------------- */
/*                                  Runtime                                   */
/* -------------------------------------------------------------------------- */

pub struct Runtime {
    pub settings: Settings,
    pub timer: TimerState,
    pub gamma_supported: bool,
    pub gamma_applied: bool,
    pub scheduled: bool,
    /// Last Kelvin value actually pushed to the GPU (avoids flicker).
    pub last_gamma_kelvin: Option<u32>,
    /// Active colour-safe whitelist hit (process name / title keyword).
    pub whitelist_active: Option<String>,
    /// Continuous work seconds since the last 20-20-20 micro break.
    pub work_elapsed_seconds: i64,
    /// Unflushed focused seconds and their local calendar day (analytics).
    pub focus_seconds: i64,
    pub focus_date: String,
    /// Active seconds in this work session; pauses do not end the session.
    pub work_session_elapsed_seconds: u64,
    /// Manual previews must not inflate exercise-completion statistics.
    pub micro_break_is_preview: bool,
    /// Monotonic order for snapshots emitted from different threads.
    pub revision: u64,
    /// Foreground process/title cache, used by the whitelist watcher.
    pub foreground_process: String,
    pub foreground_title: String,
    /// Milliseconds Ctrl + Shift have been held down during a break.
    pub emergency_hold_ms: u32,
    /// Once per uninterrupted absence, not once per second.
    pub idle_natural_break_recorded: bool,
    /// A manually requested break must not advance the completed-work cycle.
    pub break_counts_cycle: bool,
}

impl Runtime {
    pub fn new(settings: Settings) -> Self {
        let timer = TimerState {
            remaining_seconds: i64::from(settings.timer.work_minutes.max(1)) * 60,
            total_seconds: i64::from(settings.timer.work_minutes.max(1)) * 60,
            micro_break_total: settings.timer.micro_break_seconds.max(1),
            ..TimerState::default()
        };
        Self {
            settings,
            timer,
            gamma_supported: true,
            gamma_applied: false,
            scheduled: false,
            last_gamma_kelvin: None,
            whitelist_active: None,
            work_elapsed_seconds: 0,
            focus_seconds: 0,
            focus_date: chrono::Local::now().format("%Y-%m-%d").to_string(),
            work_session_elapsed_seconds: 0,
            micro_break_is_preview: false,
            revision: 0,
            foreground_process: String::new(),
            foreground_title: String::new(),
            emergency_hold_ms: 0,
            idle_natural_break_recorded: false,
            break_counts_cycle: false,
        }
    }

    /// Take the current partial minute without rounding it up.
    pub fn take_focus(&mut self) -> Option<(String, u64, u64)> {
        let seconds = std::mem::take(&mut self.focus_seconds).max(0) as u64;
        if seconds == 0 { None } else { Some((self.focus_date.clone(), seconds, crate::analytics::epoch())) }
    }

    pub fn snapshot(&self) -> Snapshot {
        let (kelvin, brightness, scheduled) = effective_eye(&self.settings);
        let paused_by_whitelist = self.whitelist_active.is_some() && self.settings.eye.color_safe_enabled;
        let target = if !self.settings.eye.enabled || paused_by_whitelist {
            crate::display::NEUTRAL_KELVIN
        } else {
            kelvin
        };
        let effective_brightness = if !self.settings.eye.enabled || paused_by_whitelist {
            100
        } else {
            brightness
        };

        let mut timer = self.timer.clone();
        let hold_target = (self.settings.lock.emergency_hold_seconds.clamp(2, 30) * 1000) as f32;
        timer.emergency_hold_progress = if hold_target > 0.0 {
            (self.emergency_hold_ms as f32 / hold_target).min(1.0)
        } else {
            0.0
        };

        Snapshot {
            revision: self.revision,
            settings: self.settings.clone(),
            timer,
            eye: EyeInfo {
                gamma_supported: self.gamma_supported,
                gamma_applied: self.gamma_applied && self.settings.eye.enabled && !paused_by_whitelist,
                effective_kelvin: crate::display::current_kelvin(),
                target_kelvin: target,
                effective_brightness,
                scheduled,
                whitelisted: paused_by_whitelist,
                whitelisted_app: if paused_by_whitelist {
                    self.whitelist_active.clone()
                } else {
                    None
                },
            },
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                          Night schedule resolution                          */
/* -------------------------------------------------------------------------- */

fn hhmm_to_minutes(value: &str) -> Option<u32> {
    let mut parts = value.split(':');
    let h: u32 = parts.next()?.trim().parse().ok()?;
    let m: u32 = parts.next()?.trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

#[cfg(windows)]
fn local_minutes_now() -> u32 {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let st = unsafe { GetLocalTime() };
    u32::from(st.wHour) * 60 + u32::from(st.wMinute)
}

#[cfg(not(windows))]
fn local_minutes_now() -> u32 {
    12 * 60
}

/// Resolves (kelvin, brightness, schedule_active) for the current moment.
pub fn effective_eye(settings: &Settings) -> (u32, u32, bool) {
    if !settings.eye.enabled {
        return (settings.eye.kelvin, 100, false);
    }
    if settings.eye.schedule_enabled {
        if let (Some(start), Some(end)) = (
            hhmm_to_minutes(&settings.eye.schedule_start),
            hhmm_to_minutes(&settings.eye.schedule_end),
        ) {
            let now = local_minutes_now();
            let inside = if start <= end {
                now >= start && now < end
            } else {
                now >= start || now < end
            };
            if inside {
                return (
                    settings.eye.schedule_kelvin,
                    settings.eye.schedule_brightness,
                    true,
                );
            }
        }
    }
    (settings.eye.kelvin, settings.eye.brightness, false)
}
