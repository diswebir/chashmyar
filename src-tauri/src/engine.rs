//! State machine glue: derives hardware/overlay state from settings, manages the
//! break-lock lifecycle, the colour-safe hand-off and broadcasts snapshots.

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{self, Phase, Runtime, Snapshot};
use crate::{analytics, display, focus_guard, locker, windows};

pub type Shared = Arc<Mutex<Runtime>>;

pub const SNAPSHOT_EVENT: &str = "app://snapshot";
static FILTER_TRACE: Mutex<crate::filter_diagnostics::TraceTracker> =
    Mutex::new(crate::filter_diagnostics::TraceTracker::new());
static SHUTDOWN_ONCE: crate::shutdown_once::ShutdownOnce = crate::shutdown_once::ShutdownOnce::new();
// Serialize changes which open/close the lock, hook and focus guard together.
pub(crate) static BREAK_TRANSITION: Mutex<()> = Mutex::new(());

/// Why a break ended — drives the analytics bookkeeping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreakEnd {
    /// Ran to 00:00.
    Completed,
    /// Ended early from the settings/dashboard button.
    Early,
    /// Emergency Ctrl+Shift escape.
    Emergency,
}

pub fn shared(app: &AppHandle) -> Shared {
    app.state::<Shared>().inner().clone()
}

/// Recomputes everything derived from settings, then pushes the snapshot.
pub fn refresh(app: &AppHandle, shared: &Shared) -> Snapshot {
    refresh_inner(app, shared, false)
}

/// User-requested Gamma reset/tray off: publish a fast neutral target only if
/// the current locked state is still off. A newer enable wins over a stale reset.
pub fn refresh_neutral_if_off(app: &AppHandle, shared: &Shared) -> Snapshot {
    refresh_inner(app, shared, true)
}

fn refresh_inner(app: &AppHandle, shared: &Shared, request_fast_off: bool) -> Snapshot {
    let snapshot = {
        let mut rt = shared.lock();
        let (kelvin, brightness, scheduled) = state::effective_eye(&rt.settings);
        rt.scheduled = scheduled;

        let paused_by_whitelist =
            rt.foreground_cache.active().is_some() && rt.settings.eye.color_safe_enabled;
        let target = if !rt.settings.eye.enabled || paused_by_whitelist {
            display::NEUTRAL_KELVIN
        } else {
            kelvin
        };

        // Reflect the last Gamma API result. In the default path an explicit
        // failure is reported, never converted into a software warmth layer.
        let (gamma_any_accepted, gamma_all_accepted) = display::last_gamma_result();
        rt.gamma_supported = gamma_any_accepted;
        rt.gamma_all_accepted = gamma_all_accepted;
        let wants_screen = rt.settings.eye.cover_windows_menus && rt.settings.eye.enabled && !paused_by_whitelist
            && (brightness < 100 || target < display::NEUTRAL_KELVIN);
        let neutral = if display::fullscreen_neutral_ready() {
            crate::screen_handoff::NeutralState::Ready
        } else if display::fullscreen_neutral_failed() {
            crate::screen_handoff::NeutralState::Failed
        } else {
            crate::screen_handoff::NeutralState::Pending
        };
        // All hardware/window operations remain on their own workers. This
        // policy only publishes requests while holding the runtime mutex.
        let handoff = rt.screen_handoff.step(wants_screen, neutral,
            crate::color_filter::screen_status(), crate::color_filter::screen_covers_overlay(),
            windows::overlay_hidden_confirmed());
        if handoff.hold_gamma_neutral {
            display::hold_neutral_for_fullscreen(rt.settings.eye.transition_ms);
        } else {
            let duration = crate::gamma_logic::transition_for_explicit_off(
                rt.settings.eye.transition_ms, request_fast_off, rt.settings.eye.enabled,
            );
            display::set_target(target, duration);
        }
        // Colour vision stays independent of the eye switch, but both screen
        // warmth and dimming share its single Magnification worker/matrix.
        let screen = crate::color_vision::ScreenTarget::new(handoff.request_screen, brightness, target);
        crate::color_filter::set_target(
            crate::color_vision::Profile::parse(&rt.settings.eye.color_vision_profile),
            rt.settings.eye.color_vision_strength,
            paused_by_whitelist,
            screen,
        );
        rt.gamma_applied = crate::gamma_logic::reported_warmth(
            rt.gamma_supported, rt.settings.eye.enabled, paused_by_whitelist,
            handoff.hold_gamma_neutral, target, display::current_kelvin(), display::NEUTRAL_KELVIN,
        );

        let overlay_visible = crate::overlay_policy::needs_overlay(
            rt.settings.eye.enabled, paused_by_whitelist, brightness,
        ) && !handoff.hide_overlay && !crate::color_filter::screen_covers_overlay();
        // Publish only an atomic target while holding the runtime lock. Calling
        // synchronous native window getters here can deadlock the UI thread.
        windows::set_overlay_target(overlay_visible);
        rt.revision = rt.revision.saturating_add(1);
        rt.snapshot()
    };

    // I/O is outside the runtime lock. Do not record foreground identities.
    // Serializing this small trace also preserves revision order across callers.
    {
        use crate::filter_diagnostics::FilterTrace;
        let trace = FilterTrace {
            enabled: snapshot.settings.eye.enabled,
            color_safe_paused: snapshot.eye.whitelisted,
            scheduled: snapshot.eye.scheduled,
            requested_kelvin: snapshot.eye.target_kelvin,
            last_api_kelvin: snapshot.eye.effective_kelvin,
            brightness: snapshot.eye.effective_brightness,
            gamma_any: snapshot.eye.gamma_supported,
            gamma_all: snapshot.eye.gamma_all_accepted,
            screen_status: snapshot.eye.screen_filter_status,
            screen_covered: snapshot.eye.screen_filter_covers_overlay,
        };
        if let Some(changed) = FILTER_TRACE.lock().observe(snapshot.revision, trace) {
            crate::diag::log(changed.message());
        }
    }
    windows::ensure_overlay_worker(app);
    let _ = app.emit(SNAPSHOT_EVENT, snapshot.clone());
    snapshot
}

/// Work → Break transition: opens the glassmorphic lock screen, arms the hook
/// and starts the focus-enforcement loop.
pub fn enter_break(app: &AppHandle, shared: &Shared, manual: bool) {
    let _transition = BREAK_TRANSITION.lock();
    let strict;
    let pending_focus;
    let outcome;
    {
        let mut rt = shared.lock();
        // Races between a ticker transition and a user click must never reset
        // an already running break. A manual click can start a waiting break.
        if matches!(rt.timer.phase, Phase::Break | Phase::LongBreak) {
            if manual {
                rt.timer.running = true;
                rt.timer.paused = false;
            }
            return;
        }
        // A queued ticker transition may arrive after a pause, reset or snooze.
        if !manual && !crate::timer_rules::scheduled_enter_allowed(
            rt.timer.phase == Phase::Work, rt.timer.remaining_seconds,
            rt.timer.running, rt.timer.paused, rt.timer.idle_paused) { return; }
        let completed_work = rt.timer.phase == Phase::Work && rt.timer.remaining_seconds <= 0;
        outcome = crate::timer_rules::work_outcome(completed_work,
            rt.timer.phase == Phase::Work, rt.timer.snooze_count, rt.work_session_elapsed_seconds);
        rt.break_counts_cycle = completed_work;
        let cycles = rt.settings.timer.cycles_before_long_break.max(1);
        let long = completed_work && rt.timer.cycle_index >= cycles;
        let minutes = if long {
            rt.settings.timer.long_break_minutes
        } else {
            rt.settings.timer.break_minutes
        };

        pending_focus = rt.take_focus();
        rt.work_session_elapsed_seconds = 0;
        rt.work_elapsed_seconds = 0;
        rt.timer.phase = if long { Phase::LongBreak } else { Phase::Break };
        rt.timer.total_seconds = i64::from(minutes.max(1)) * 60;
        rt.timer.remaining_seconds = rt.timer.total_seconds;
        rt.timer.warning_visible = false;
        if completed_work { rt.timer.completed_work_sessions += 1; }
        rt.timer.micro_break_active = false;
        rt.timer.micro_break_remaining = 0;
        rt.timer.penalties_this_break = 0;
        rt.timer.idle_paused = false;
        rt.timer.paused = false;
        // Manual start always starts counting, even from idle or paused and
        // regardless of the automatic-start preference.
        rt.timer.running = manual || rt.settings.timer.auto_start_break;
        rt.emergency_hold_ms = 0;
        strict = rt.settings.lock.strict_lock;
    }

    if let Some((date, seconds, epoch)) = pending_focus { analytics::add_focus_seconds(app, &date, seconds, epoch); }
    if let Some(outcome) = outcome {
        analytics::bump(app, |r| match outcome {
            crate::timer_rules::WorkOutcome::OnTime => r.work_sessions_on_time = r.work_sessions_on_time.saturating_add(1),
            crate::timer_rules::WorkOutcome::Delayed => r.work_sessions_delayed = r.work_sessions_delayed.saturating_add(1),
            crate::timer_rules::WorkOutcome::EndedEarly => r.work_sessions_ended_early = r.work_sessions_ended_early.saturating_add(1),
        });
    }
    windows::hide_snooze(app);
    windows::hide_micro_break(app);
    // Do not install a global keyboard hook if the break window failed to open.
    if windows::show_lock(app) && strict {
        locker::activate();
        focus_guard::spawn(app.clone(), shared.clone());
    }
}

/// Break → Work transition: releases the hook, closes the lock screen.
pub fn leave_break(app: &AppHandle, shared: &Shared, reason: BreakEnd) -> bool {
    let _transition = BREAK_TRANSITION.lock();
    {
        let mut rt = shared.lock();
        // Only the first transition may advance the cycle or record analytics.
        if !matches!(rt.timer.phase, Phase::Break | Phase::LongBreak) { return false; }
        if reason == BreakEnd::Completed && !crate::timer_rules::scheduled_leave_allowed(
            true, rt.timer.remaining_seconds, rt.timer.running, rt.timer.paused) { return false; }
        if reason == BreakEnd::Early && rt.settings.lock.strict_lock { return false; }
        if reason == BreakEnd::Emergency && !rt.settings.lock.emergency_unlock { return false; }
        let cycles = rt.settings.timer.cycles_before_long_break.max(1);
        rt.timer.phase = Phase::Work;
        if rt.break_counts_cycle {
            rt.timer.cycle_index = (rt.timer.cycle_index % cycles) + 1;
        }
        rt.break_counts_cycle = false;
        rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
        rt.timer.remaining_seconds = rt.timer.total_seconds;
        rt.timer.snooze_count = 0;
        rt.timer.warning_visible = false;
        rt.timer.penalties_this_break = 0;
        rt.timer.micro_break_active = false;
        rt.timer.micro_break_remaining = 0;
        rt.work_elapsed_seconds = 0;
        rt.focus_seconds = 0;
        rt.work_session_elapsed_seconds = 0;
        rt.timer.running = reason == BreakEnd::Emergency || rt.settings.timer.auto_start_next_work;
        rt.timer.paused = false;
        rt.timer.idle_paused = false;
        rt.emergency_hold_ms = 0;
    }
    locker::release();
    focus_guard::stop();
    windows::hide_lock(app);
    windows::hide_micro_break(app);
    match reason {
        BreakEnd::Completed => analytics::bump(app, |r| {
            r.completed_breaks = r.completed_breaks.saturating_add(1);
            r.observed_breaks_completed = r.observed_breaks_completed.saturating_add(1);
        }),
        BreakEnd::Emergency => analytics::bump(app, |r| {
            r.emergency_skips = r.emergency_skips.saturating_add(1);
            r.observed_breaks_skipped = r.observed_breaks_skipped.saturating_add(1);
        }),
        BreakEnd::Early => analytics::bump(app, |r| {
            r.observed_breaks_skipped = r.observed_breaks_skipped.saturating_add(1);
        })
    }
    true
}

/// Emergency escape shared by the command layer and the native modifier
/// watcher (`locker::spawn_emergency_watcher`). Ctrl + Shift is read straight
/// from `GetAsyncKeyState`, so it cannot be swallowed by keyboard layouts.
pub fn emergency_unlock(app: &AppHandle, shared: &Shared) {
    {
        let rt = shared.lock();
        if !matches!(rt.timer.phase, Phase::Break | Phase::LongBreak)
            || !rt.settings.lock.emergency_unlock {
            return;
        }
    }
    crate::diag::log("emergency unlock triggered (Ctrl+Shift held)");
    if !leave_break(app, shared, BreakEnd::Emergency) { return; }

    windows::hide_snooze(app);
    refresh(app, shared);
}

/// Normal exit path. Repeated Quit/ExitRequested/Exit events share one
/// cleanup; a process death remains guarded by the detached watchdog.
pub fn safe_shutdown(app: &AppHandle) {
    SHUTDOWN_ONCE.run(|| {
        windows::stop_overlay_event_hook();
        locker::release();
        focus_guard::stop();
        let color_ok = crate::color_filter::stop_and_restore();
        if !color_ok { crate::diag::log("color vision restore could not be confirmed during shutdown"); }
        let gamma_ok = display::stop_and_restore_gamma();
        if gamma_ok { display::stop_watchdog(); }
        // Otherwise keep the watchdog alive to attempt a reset after exit.
        let mut save_ok = true;
        if let Some(shared) = app.try_state::<Shared>() {
            let pending = { shared.lock().take_focus() };
            if let Some((date, seconds, epoch)) = pending { analytics::add_focus_seconds(app, &date, seconds, epoch); }
            if let Err(err) = crate::persistence::save_current_checked(app, shared.inner()) {
                crate::diag::log(format!("settings save failed during shutdown: {err}"));
                save_ok = false;
            }
        }
        color_ok && gamma_ok && save_ok
    });
}
