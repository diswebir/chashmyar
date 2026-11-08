// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
