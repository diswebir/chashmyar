//! ChashmYar — Windows eye-care, screen dimmer & strict Pomodoro desktop app (v2).
//!
//! Architecture
//! ------------
//! ```text
//!  ┌────────────────────────────────┐      events (app://snapshot …)      ┌──────────────────┐
//!  │  Rust core                     │ ──────────────────────────────────▶ │  6 webviews      │
//!  │  Arc<Mutex<Runtime>>           │ ◀────────────────────────────────── │  React + Zustand │
//!  │  timer · gamma lerp · hook     │           invoke(commands)           └──────────────────┘
//!  │  idle · foreground · analytics │
//!  └────────────────────────────────┘
//!            │
//!            └─ spawns `--gamma-watchdog <pid>` helper process
//! ```

pub mod analytics;
pub mod analytics_record;
pub mod commands;
pub mod diag;
pub mod display;
pub mod engine;
pub mod focus_guard;
pub mod foreground;
pub mod idle;
pub mod locker;
pub mod overlay_policy;
pub mod persistence;
pub mod self_test;
pub mod score;
pub mod state;
pub mod timer;
pub mod timer_rules;
pub mod tray;
pub mod windows;

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

use engine::Shared;
use state::{Phase, Runtime};

pub fn run() {
    diag::init();
    display::install_panic_hook();

    let built = tauri::Builder::default()
        // A second launch must never fight the first one over the gamma ramp,
        // the low-level keyboard hook or the running timer.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            diag::log("second instance launched — focusing the existing window");
            windows::focus_main(app);
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = persistence::load(&handle);
            let autostart_wanted = settings.system.autostart;
            let auto_start_timer = settings.system.auto_start_timer_on_launch;
            let eye_on_launch = settings.system.eye_care_on_launch;
            let launched_from_autostart = std::env::args().any(|a| a == "--autostart");

            // Probe before starting the lerp worker: probing after refresh used
            // to reset the LUT to neutral during the startup transition.
            let gamma_supported = display::gamma_supported_probe();
            let mut runtime = Runtime::new(settings);
            runtime.gamma_supported = gamma_supported;
            if !eye_on_launch {
                runtime.settings.eye.enabled = false;
            }
            let shared: Shared = Arc::new(Mutex::new(runtime));
            app.manage(shared.clone());

            /* -------------------------- windows & tray ------------------------- */
            diag::log("creating windows…");
            if let Err(err) = windows::create_all(&handle) {
                diag::log(format!("window creation error: {err}"));
                return Err(Box::new(err));
            }
            // The tray is a convenience: never let it abort startup.
            match tray::build(&handle) {
                Ok(()) => diag::log("system tray ready"),
                Err(err) => diag::log(format!("system tray unavailable: {err}")),
            }

            // Theme-dependent native decoration (acrylic tint behind the lock).
            windows::apply_theme(&handle);
            windows::apply_language(&handle);
            // Layout-proof Ctrl+Shift emergency hold, sampled natively.
            locker::spawn_emergency_watcher(handle.clone(), shared.clone());
            // Geometry helpers can wait on the GUI loop; do not take their
            // serialization lock from this setup/event-loop callback.
            let widget_handle = handle.clone();
            std::thread::spawn(move || windows::apply_widget_mode(&widget_handle));
            windows::spawn_widget_position_saver(handle.clone(), shared.clone());

            /* ------------------------- autostart registry ---------------------- */
            {
                use tauri_plugin_autostart::ManagerExt;
                let manager = handle.autolaunch();
                let result = if autostart_wanted { manager.enable() } else { manager.disable() };
                if let Err(err) = result {
                    diag::log(format!("autostart registration failed: {err}"));
                }
                match manager.is_enabled() {
                    Ok(actual) => shared.lock().settings.system.autostart = actual,
                    Err(err) => diag::log(format!("autostart state could not be read: {err}")),
                }
            }

            /* ---------------------- first eye-care application ------------------ */
            engine::refresh(&handle, &shared);

            if auto_start_timer {
                {
                    let mut rt = shared.lock();
                    rt.timer.phase = Phase::Work;
                    rt.timer.running = true;
                    rt.timer.paused = false;
                    rt.timer.total_seconds = i64::from(rt.settings.timer.work_minutes.max(1)) * 60;
                    rt.timer.remaining_seconds = rt.timer.total_seconds;
                }
                engine::refresh(&handle, &shared);
            }

            if launched_from_autostart {
                if let Some(main) = handle.get_webview_window(windows::MAIN) {
                    let _ = main.hide();
                }
            }

            /* -------------------------- background loops ----------------------- */
            timer::spawn_ticker(handle.clone(), shared.clone()); // 1 s state machine
            foreground::spawn_watcher(handle.clone(), shared.clone()); // 1.5 s whitelist poll
            display::spawn_reassert_loop(); // 10 s gamma re-assertion
            display::spawn_watchdog(); // detached crash-safe helper

            {
                let rt = shared.lock();
                diag::log(format!(
                    "startup complete — gamma supported: {}, eye care: {}, autostart: {}, theme: {:?}, language: {:?}, widget: {:?}",
                    rt.gamma_supported,
                    rt.settings.eye.enabled,
                    autostart_wanted,
                    rt.settings.system.theme,
                    rt.settings.system.language,
                    rt.settings.system.widget_mode,
                ));
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Moved(position) = event {
                if window.label() == windows::MICRO {
                    windows::remember_widget_position(&window.app_handle(), *position);
                }
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label().to_string();
                if label == windows::LOCK {
                    // Only the timer (or the emergency fail-safe) closes this one.
                    api.prevent_close();
                } else if label == windows::MAIN {
                    let shared = engine::shared(window.app_handle());
                    let minimize = shared.lock().settings.system.minimize_to_tray;
                    api.prevent_close();
                    if minimize {
                        let _ = window.hide();
                    } else {
                        // Closing instead of minimizing must really quit; a
                        // destroyed main webview cannot be restored from tray.
                        engine::safe_shutdown(window.app_handle());
                        window.app_handle().exit(0);
                    }
                } else if label == windows::MICRO || label == windows::MICRO_BREAK {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::update_settings,
            commands::patch_settings,
            commands::set_kelvin,
            commands::set_brightness,
            commands::set_eye_enabled,
            commands::apply_profile,
            commands::set_color_safe,
            commands::whitelist_add,
            commands::whitelist_remove,
            commands::whitelist_reset_defaults,
            commands::timer_start,
            commands::timer_pause,
            commands::timer_resume,
            commands::timer_toggle,
            commands::timer_reset,
            commands::snooze,
            commands::dismiss_warning,
            commands::emergency_unlock,
            commands::end_break_early,
            commands::start_break_now,
            commands::dismiss_micro_break,
            commands::start_micro_break_now,
            commands::analytics_get,
            commands::analytics_today,
            commands::analytics_reset,
            commands::set_micro_expanded,
            commands::set_widget_mode,
            commands::save_widget_position,
            commands::snap_widget_to_edge,
            commands::open_settings_window,
            commands::open_main_window,
            commands::show_window,
            commands::hide_window,
            commands::set_autostart,
            commands::get_autostart,
            commands::reset_gamma,
            commands::open_log_folder,
            commands::open_creator_website,
            commands::quit_app,
        ])
        .build(tauri::generate_context!());

    // A failed build must never die silently: a GUI-subsystem binary has no
    // console, so report through the diagnostic log *and* a native message box.
    let app = match built {
        Ok(app) => app,
        Err(err) => {
            let message = format!(
                "راه‌اندازی چشم‌یار با خطا متوقف شد:\n\n{err}\n\nگزارش کامل: {}",
                diag::log_path().display()
            );
            diag::log(format!("fatal: build failed: {err}"));
            diag::fatal_box(&message);
            std::process::exit(2);
        }
    };

    app.run(|app, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                engine::safe_shutdown(app);
            }
            _ => {}
        });
}
