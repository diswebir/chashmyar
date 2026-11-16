//! Keep ChashmYar's own notification windows *below* the active software
//! dimmer in the same Win32 Z-order transaction that shows/activates them.
//! The overlay stays click-through and the notifications remain focusable.
//! Unrelated applications continue to use the existing WinEvent fallback.
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

static FILTER_ENABLED: AtomicBool = AtomicBool::new(false);
static FILTER_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn set_filter_handle(hwnd: isize) { FILTER_HWND.store(hwnd, Ordering::Release); }
pub fn set_filter_enabled(enabled: bool) { FILTER_ENABLED.store(enabled, Ordering::Release); }

const SWP_NOZORDER: u32 = 0x0004;
const SWP_SHOWWINDOW: u32 = 0x0040;
const SWP_HIDEWINDOW: u32 = 0x0080;

/// A hide need not move. A show must be positioned even when the OS initially
/// requested NOZORDER; otherwise a previously hidden topmost popup can flash.
fn should_place_below_filter(enabled: bool, filter_visible: bool, flags: u32) -> bool {
    enabled && filter_visible && flags & SWP_HIDEWINDOW == 0
        && (flags & SWP_SHOWWINDOW != 0 || flags & SWP_NOZORDER == 0)
}

#[cfg(windows)]
mod native {
    use super::*;
    #[cfg(test)]
    use std::ffi::c_void;

    const WM_SHOWWINDOW: u32 = 0x0018;
    const WM_WINDOWPOSCHANGING: u32 = 0x0046;
    const WM_NCDESTROY: u32 = 0x0082;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const SUBCLASS_ID: usize = 0x4348_5941;

    #[repr(C)]
    struct WindowPos {
        hwnd: isize,
        insert_after: isize,
        x: i32, y: i32, cx: i32, cy: i32,
        flags: u32,
    }
    type SubclassProc = Option<unsafe extern "system" fn(isize, u32, usize, isize, usize, usize) -> isize>;
    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(hwnd: isize, callback: SubclassProc, id: usize, data: usize) -> i32;
        fn RemoveWindowSubclass(hwnd: isize, callback: SubclassProc, id: usize) -> i32;
        fn DefSubclassProc(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> isize;
    }
    #[link(name = "user32")]
    extern "system" {
        fn IsWindow(hwnd: isize) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    }

    fn active_filter() -> Option<isize> {
        if !FILTER_ENABLED.load(Ordering::Acquire) { return None; }
        let filter = FILTER_HWND.load(Ordering::Acquire);
        if filter == 0 || unsafe { IsWindow(filter) } == 0 || unsafe { IsWindowVisible(filter) } == 0 {
            None
        } else { Some(filter) }
    }

    unsafe extern "system" fn popup_subclass(hwnd: isize, msg: u32, wp: usize, lp: isize, id: usize, _data: usize) -> isize {
        if msg == WM_WINDOWPOSCHANGING && lp != 0 {
            // Let Tao/default processing run first, then adjust the final
            // WINDOWPOS before control returns to the window manager.
            let result = unsafe { DefSubclassProc(hwnd, msg, wp, lp) };
            if let Some(filter) = active_filter() {
                let pos = unsafe { &mut *(lp as *mut WindowPos) };
                if should_place_below_filter(true, true, pos.flags) {
                    pos.flags &= !SWP_NOZORDER;
                    pos.insert_after = filter;
                }
            }
            return result;
        } else if msg == WM_SHOWWINDOW && wp != 0 {
            // Windows sends WM_SHOWWINDOW before showing. Pre-position even if
            // a subsequent ShowWindow uses NOZORDER; WM_WINDOWPOSCHANGING also
            // covers the show/activation transaction itself.
            if let Some(filter) = active_filter() {
                unsafe { SetWindowPos(hwnd, filter, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER); }
            }
        } else if msg == WM_NCDESTROY {
            unsafe { RemoveWindowSubclass(hwnd, Some(popup_subclass), id); }
        }
        // Never consume input, suppress activation, or alter foreground focus.
        unsafe { DefSubclassProc(hwnd, msg, wp, lp) }
    }

    /// Must be called on the thread that owns the popup HWND (Tauri GUI thread).
    pub fn install_on_window_thread(hwnd: isize) -> Result<(), String> {
        if hwnd == 0 || unsafe { IsWindow(hwnd) } == 0 { return Err("invalid popup HWND".into()); }
        if unsafe { SetWindowSubclass(hwnd, Some(popup_subclass), SUBCLASS_ID, 0) } == 0 {
            return Err(format!("SetWindowSubclass: {}", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        const WS_EX_TOPMOST: u32 = 0x0000_0008;
        const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
        const WS_EX_LAYERED: u32 = 0x0008_0000;
        const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
        const WS_POPUP: u32 = 0x8000_0000;
        const SW_SHOWNA: i32 = 8;
        const SW_HIDE: i32 = 0;
        const GW_HWNDPREV: u32 = 3;
        const HWND_TOPMOST: isize = -1;
        #[link(name = "user32")]
        extern "system" {
            fn CreateWindowExW(ex: u32, class: *const u16, title: *const u16, style: u32,
                               x: i32, y: i32, width: i32, height: i32, parent: isize,
                               menu: isize, instance: isize, param: *mut c_void) -> isize;
            fn ShowWindow(hwnd: isize, command: i32) -> i32;
            fn DestroyWindow(hwnd: isize) -> i32;
            fn GetWindow(hwnd: isize, command: u32) -> isize;
            fn SetForegroundWindow(hwnd: isize) -> i32;
            fn GetForegroundWindow() -> isize;
        }
        fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }
        fn overlay_is_above(popup: isize, overlay: isize) -> bool {
            let mut cursor = popup;
            for _ in 0..2048 {
                cursor = unsafe { GetWindow(cursor, GW_HWNDPREV) };
                if cursor == overlay { return true; }
                if cursor == 0 { return false; }
            }
            false
        }
        #[test]
        fn native_show_and_topmost_reorder_stay_behind_filter() {
            let class = wide("STATIC");
            let title = wide("ChashmYar test only");
            let make_window = |styles| unsafe { CreateWindowExW(styles, class.as_ptr(), title.as_ptr(), WS_POPUP,
                0, 0, 100, 100, 0, 0, 0, std::ptr::null_mut()) };
            let filter = make_window(WS_EX_TOPMOST | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE);
            let popup = make_window(WS_EX_TOPMOST);
            assert_ne!(filter, 0); assert_ne!(popup, 0);
            unsafe { ShowWindow(filter, SW_SHOWNA); }
            set_filter_handle(filter); set_filter_enabled(true);
            install_on_window_thread(popup).unwrap();
            unsafe { ShowWindow(popup, SW_SHOWNA); }
            assert!(overlay_is_above(popup, filter), "first show must not put the popup above the filter");
            unsafe { SetWindowPos(popup, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
            assert!(overlay_is_above(popup, filter), "a subsequent topmost promotion must remain behind the filter");
            // A background CI session can deny foreground activation. Where it
            // is permitted, exercise the same native raise used by a click.
            if unsafe { SetForegroundWindow(popup) } != 0 && unsafe { GetForegroundWindow() } == popup {
                assert!(overlay_is_above(popup, filter), "an activated popup must remain behind the filter");
            } else {
                eprintln!("Foreground activation not permitted by this Windows session; manual click test still required");
            }
            unsafe { ShowWindow(popup, SW_HIDE); ShowWindow(popup, SW_SHOWNA); }
            assert!(overlay_is_above(popup, filter), "repeated show must stay behind the filter");
            set_filter_enabled(false);
            unsafe { SetWindowPos(popup, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
            assert!(!overlay_is_above(popup, filter), "disabled filter must not interfere with Z-order");
            unsafe { DestroyWindow(popup); DestroyWindow(filter); }
            set_filter_handle(0);
        }
    }
}

#[cfg(windows)]
pub use native::install_on_window_thread;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn position_policy_covers_show_and_click_without_affecting_hide() {
        assert!(should_place_below_filter(true, true, SWP_SHOWWINDOW | SWP_NOZORDER));
        assert!(should_place_below_filter(true, true, 0));
        assert!(!should_place_below_filter(true, true, SWP_NOZORDER));
        assert!(!should_place_below_filter(true, true, SWP_HIDEWINDOW));
        assert!(!should_place_below_filter(false, true, SWP_SHOWWINDOW));
        assert!(!should_place_below_filter(true, false, SWP_SHOWWINDOW));
    }
}
