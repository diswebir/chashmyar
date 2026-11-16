// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // CI runs this mode on both actual release payloads. It exits before the
    // updater, display changes, WebView, single-instance lock or GUI start.
    if let Some(exit_code) = chashmyar_lib::release_payload::handle_command() {
        std::process::exit(exit_code);
    }

    // A freshly updated portable waits for the old process before the
    // single-instance plugin, gamma, keyboard hook or watchdog can start.
    #[cfg(all(windows, feature = "portable"))]
    chashmyar_lib::portable_replace::wait_before_startup();

    // `chashmyar.exe --self-test` runs the on-machine health check and exits.
    if chashmyar_lib::self_test::is_self_test_mode() {
        chashmyar_lib::self_test::run();
    }

    // `chashmyar.exe --gamma-watchdog <parent_pid>` runs the ultra-light helper
    // that resets the display LUT to 6500K the moment the parent dies.
    if chashmyar_lib::display::is_watchdog_mode() {
        chashmyar_lib::display::run_watchdog_mode();
    }

    chashmyar_lib::run();
}
