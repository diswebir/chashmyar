//! System tray icon + menu (quick eye-protection toggle, timer control,
//! settings and a safe exit that restores the gamma ramp).

use parking_lot::Mutex;
use std::sync::OnceLock;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::engine::{self, Shared};
use crate::{display, windows};

static EYE_ITEM: OnceLock<Mutex<Option<CheckMenuItem<Wry>>>> = OnceLock::new();
static TIMER_ITEM: OnceLock<Mutex<Option<MenuItem<Wry>>>> = OnceLock::new();
static SETTINGS_ITEM: OnceLock<Mutex<Option<MenuItem<Wry>>>> = OnceLock::new();
static QUIT_ITEM: OnceLock<Mutex<Option<MenuItem<Wry>>>> = OnceLock::new();

fn eye_slot() -> &'static Mutex<Option<CheckMenuItem<Wry>>> {
    EYE_ITEM.get_or_init(|| Mutex::new(None))
}

pub fn sync_eye_check(app: &AppHandle, enabled: bool) {
    let _ = app;
    let item = eye_slot().lock().clone();
    if let Some(item) = item { let _ = item.set_checked(enabled); }
}

/// Translate native tray items as well as the webviews when language changes.
pub fn sync_language(app: &AppHandle, language: crate::state::Language) {
    let english = language == crate::state::Language::En;
    let eye = eye_slot().lock().clone();
    if let Some(item) = eye {
        let _ = item.set_text(if english { "Eye protection" } else { "محافظ چشم" });
    }
    let timer = TIMER_ITEM.get_or_init(|| Mutex::new(None)).lock().clone();
    if let Some(item) = timer {
        let _ = item.set_text(if english { "Start / pause timer" } else { "شروع / توقف پومودورو" });
    }
    let settings = SETTINGS_ITEM.get_or_init(|| Mutex::new(None)).lock().clone();
    if let Some(item) = settings {
        let _ = item.set_text(if english { "ChashmYar settings" } else { "تنظیمات چشم‌یار" });
    }
    let quit = QUIT_ITEM.get_or_init(|| Mutex::new(None)).lock().clone();
    if let Some(item) = quit {
        let _ = item.set_text(if english { "Quit safely" } else { "خروج امن" });
    }
    if let Some(tray) = app.tray_by_id("chashmyar-tray") {
        let _ = tray.set_tooltip(Some(if english { "ChashmYar — eye care and focus" } else { "چشم‌یار — محافظ چشم و پومودورو" }));
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let eye_enabled = app
        .try_state::<Shared>()
        .map(|s| s.lock().settings.eye.enabled)
        .unwrap_or(true);

    let eye = CheckMenuItem::with_id(app, "eye-toggle", "محافظ چشم", true, eye_enabled, None::<&str>)?;
    let timer = MenuItem::with_id(app, "timer-toggle", "شروع / توقف پومودورو", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "تنظیمات چشم‌یار", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "خروج امن", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&eye, &timer, &sep1, &settings, &sep2, &quit])?;

    *eye_slot().lock() = Some(eye);
    *TIMER_ITEM.get_or_init(|| Mutex::new(None)).lock() = Some(timer);
    *SETTINGS_ITEM.get_or_init(|| Mutex::new(None)).lock() = Some(settings);
    *QUIT_ITEM.get_or_init(|| Mutex::new(None)).lock() = Some(quit);

    // The tray callback runs on the native event loop. Never wait there for a
    // worker that may itself be waiting for a window/menu response. A single
    // worker preserves the order of rapid clicks without spawning per click.
    let (sender, receiver) = std::sync::mpsc::channel::<String>();
    let click_sender = sender.clone();
    let worker_app = app.clone();
    std::thread::spawn(move || {
        for action in receiver {
            match action.as_str() {
                "eye-toggle" => {
                    let shared = engine::shared(&worker_app);
                    let next = {
                        let mut rt = shared.lock();
                        rt.settings.eye.enabled = !rt.settings.eye.enabled;
                        rt.settings.eye.enabled
                    };
                    if !next { display::restore_gamma(); shared.lock().last_gamma_kelvin = None; }
                    crate::persistence::request_save(&worker_app, &shared);
                    engine::refresh(&worker_app, &shared);
                    sync_eye_check(&worker_app, next);
                }
                "timer-toggle" => {
                    let shared = engine::shared(&worker_app);
                    crate::commands::toggle_timer_shared(&worker_app, &shared);
                    engine::refresh(&worker_app, &shared);
                }
                "settings" => windows::focus_main(&worker_app),
                "quit" => {
                    engine::safe_shutdown(&worker_app);
                    worker_app.exit(0);
                }
                _ => {}
            }
        }
    });

    let mut builder = TrayIconBuilder::with_id("chashmyar-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("چشم‌یار — محافظ چشم و پومودورو")
        .on_menu_event(move |_app, event| {
            let _ = sender.send(event.id().as_ref().to_string());
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event { let _ = click_sender.send("settings".to_string()); }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    let language = app.try_state::<Shared>().map(|s| s.lock().settings.system.language)
        .unwrap_or(crate::state::Language::Fa);
    sync_language(app, language);
    Ok(())
}
