//! Authoritative Pomodoro state machine (v2).
//!
//! The 1-second tick lives here, in Rust — never in the webview — so the timer
//! keeps running while windows are closed, throttled or locked.
//!
//! ```text
//!  Idle ──start──▶ Work ──remaining==0──▶ Break / LongBreak ──remaining==0──▶ Work
//!                   │  │
//!                   │  ├─ remaining == alert(30s) ─▶ warning OSD (+snooze budget)
//!                   │  ├─ idle >= 3m  ─▶ PausedIdle (auto-resume on input)
//!                   │  ├─ idle >= 5m  ─▶ Natural break: cycle reset + log
//!                   │  └─ work_elapsed >= 15m ─▶ 20-20-20 micro break (15s, non-blocking)
//! ```

use std::time::Duration;
use tauri::AppHandle;

use crate::analytics;
use crate::engine::{self, Shared};
use crate::state::Phase;
use crate::{idle, windows};

pub fn spawn_ticker(app: AppHandle, shared: Shared) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1000));
        tick(&app, &shared);
    });
}

pub fn tick(app: &AppHandle, shared: &Shared) {
    let mut warn = false;
    let mut enter = false;
    let mut leave = false;
    let mut show_micro = false;
    let mut hide_micro = false;
    let mut micro_completed = false;
    let mut natural_break = false;
    let mut natural_session_interrupted = false;
    let mut focus_to_write: Vec<(String, u64, u64)> = Vec::new();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Cheap Win32 call (~microseconds); sampled every tick so the UI can show it.
    let idle_secs = idle::idle_seconds();

    {
        let mut rt = shared.lock();
        rt.timer.idle_seconds = idle_secs;
        // Flush the partial minute to the day it actually belongs to at midnight.
        if rt.focus_date != today {
            if let Some(pending) = rt.take_focus() { focus_to_write.push(pending); }
            rt.focus_date = today;
        }
        let micro_was_active = rt.timer.micro_break_active;

        let idle_enabled = rt.settings.timer.idle_detection_enabled;
        let pause_after = rt.settings.timer.idle_pause_seconds.max(30);
        let reset_after = rt.settings.timer.idle_reset_seconds.max(pause_after + 30);

        /* ----------------------- micro break countdown ---------------------- */
        if rt.timer.micro_break_active {
            rt.timer.micro_break_remaining -= 1;
            if rt.timer.micro_break_remaining <= 0 {
                rt.timer.micro_break_active = false;
                rt.timer.micro_break_remaining = 0;
                hide_micro = true;
                micro_completed = !rt.micro_break_is_preview;
                rt.micro_break_is_preview = false;
            }
        }

        /* --------------------------- idle handling -------------------------- */
        if idle_enabled && rt.timer.phase == Phase::Work && rt.timer.running {
            if idle_secs >= reset_after {
                if !rt.idle_natural_break_recorded && !rt.timer.paused {
                    // Count this absence once even though the shorter idle-pause
                    // threshold was crossed first.
                    rt.idle_natural_break_recorded = true;
                    rt.timer.idle_paused = true;
                    if let Some(pending) = rt.take_focus() { focus_to_write.push(pending); }
                    natural_session_interrupted = rt.work_session_elapsed_seconds > 0;
                    rt.work_session_elapsed_seconds = 0;
                    rt.timer.remaining_seconds =
                        i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
                    rt.timer.total_seconds = rt.timer.remaining_seconds;
                    rt.timer.snooze_count = 0;
                    rt.timer.warning_visible = false;
                    rt.work_elapsed_seconds = 0;
                    natural_break = true;
                }
            } else if idle_secs >= pause_after {
                rt.timer.idle_paused = true;
            }
        }

        /* ------------------------ resume when back ------------------------- */
        if idle_secs < 2 {
            rt.timer.idle_paused = false;
            rt.idle_natural_break_recorded = false;
        }

        let active = rt.timer.running && !rt.timer.paused && !rt.timer.idle_paused;

        if active {
            let alert = rt.settings.timer.pre_break_alert_seconds.max(1);

            match rt.timer.phase {
                Phase::Work => {
                    rt.timer.remaining_seconds -= 1;
                    rt.work_session_elapsed_seconds = rt.work_session_elapsed_seconds.saturating_add(1);
                    if !micro_was_active {
                        rt.focus_seconds += 1;
                        if rt.focus_seconds >= 60 {
                            if let Some(pending) = rt.take_focus() { focus_to_write.push(pending); }
                        }
                    }
                    rt.work_elapsed_seconds += 1;

                    /* ------------------- 20-20-20 micro break ------------------- */
                    let interval = i64::from(rt.settings.timer.micro_break_interval_minutes.max(1)) * 60;
                    let min_remaining =
                        rt.settings.timer.micro_break_min_remaining_seconds.max(0);
                    if rt.settings.timer.micro_break_enabled
                        && !rt.timer.micro_break_active
                        && rt.work_elapsed_seconds >= interval
                        && rt.timer.remaining_seconds > min_remaining
                    {
                        rt.timer.micro_break_active = true;
                        rt.micro_break_is_preview = false;
                        rt.timer.micro_break_total = rt.settings.timer.micro_break_seconds.max(5);
                        rt.timer.micro_break_remaining = rt.timer.micro_break_total;
                        rt.work_elapsed_seconds = 0;
                        show_micro = true;
                    }

                    if rt.timer.remaining_seconds <= 0 {
                        enter = true;
                    } else if rt.timer.remaining_seconds == alert && !rt.timer.warning_visible {
                        // Surfaced once — the popup itself enforces the snooze cap.
                        rt.timer.warning_visible = true;
                        warn = true;
                    }
                }
                Phase::Break | Phase::LongBreak => {
                    rt.timer.remaining_seconds -= 1;
                    if rt.timer.remaining_seconds <= 0 {
                        leave = true;
                    }
                }
                Phase::Idle => {}
            }
        }
    }

    if show_micro { windows::show_micro_break_if_active(app, shared); }
    if hide_micro { windows::hide_micro_break_if_finished(app, shared); }
    for (date, seconds, epoch) in focus_to_write { analytics::add_focus_seconds(app, &date, seconds, epoch); }
    if micro_completed {
        analytics::bump(app, |r| {
            r.micro_breaks_completed = r.micro_breaks_completed.saturating_add(1);
            r.observed_exercises_completed = r.observed_exercises_completed.saturating_add(1);
        });
    }
    if natural_break {
        // The old pre-break warning belongs to the abandoned session.
        windows::hide_snooze(app);
        analytics::bump(app, |r| {
            r.natural_breaks = r.natural_breaks.saturating_add(1);
            if natural_session_interrupted { r.work_sessions_ended_early = r.work_sessions_ended_early.saturating_add(1); }
        });
    }
    if warn { windows::show_snooze_if_valid(app, shared); }
    if enter {
        engine::enter_break(app, shared, false);
    }
    if leave {
        engine::leave_break(app, shared, engine::BreakEnd::Completed);
    }

    engine::refresh(app, shared);
}
