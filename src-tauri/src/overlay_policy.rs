//! Pure policy for the display overlay; platform API success is tested on Windows.

/// A translucent overlay is needed for brightness, or as a warmth fallback when
/// a driver explicitly rejects gamma. Disabled/color-safe states must show none.
pub fn needs_overlay(
    enabled: bool,
    color_safe_active: bool,
    brightness: u32,
    gamma_available: bool,
    target_kelvin: u32,
) -> bool {
    enabled && !color_safe_active
        && (brightness < 100 || (!gamma_available && target_kelvin < 6500))
}

/// WDA_EXCLUDEFROMCAPTURE became available in Windows 10 build 19041 (2004).
/// Earlier releases treat it as WDA_MONITOR, which can black out the capture.
pub fn exclusion_supported_windows(major: u32, build: u32) -> bool {
    major > 10 || (major == 10 && build >= 19041)
}

// Win32 event IDs, mirrored here so the decision logic can be tested without
// a desktop session. windows.rs checks them against the bindings at compile time.
pub const EVENT_SYSTEM_ALERT: u32 = 0x0002;
pub const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
pub const EVENT_SYSTEM_MENUSTART: u32 = 0x0004;
pub const EVENT_SYSTEM_MENUPOPUPSTART: u32 = 0x0006;
pub const EVENT_SYSTEM_CAPTURESTART: u32 = 0x0008;
pub const EVENT_SYSTEM_DIALOGSTART: u32 = 0x0010;
pub const EVENT_OBJECT_CREATE: u32 = 0x8000;
pub const EVENT_OBJECT_SHOW: u32 = 0x8002;
pub const EVENT_OBJECT_UNCLOAKED: u32 = 0x8018;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayEventAction {
    Ignore,
    CheckStack,
    CheckTopLevelStack,
}

/// Ignore inactive/self/child-control events rather than scanning Z-order for
/// every accessibility notification. System menu events can refer to an owner
/// instead of the popup; object show/uncloak must additionally be a top-level
/// HWND before the callback checks the stack.
pub fn overlay_event_action(
    event: u32, enabled: bool, has_window: bool, is_overlay: bool,
    object_id: i32, child_id: i32,
) -> OverlayEventAction {
    use OverlayEventAction::*;
    if !enabled || is_overlay { return Ignore; }
    match event {
        // Some system-level notifications may not identify a window at all.
        EVENT_SYSTEM_ALERT | EVENT_SYSTEM_FOREGROUND | EVENT_SYSTEM_MENUSTART
        | EVENT_SYSTEM_MENUPOPUPSTART | EVENT_SYSTEM_CAPTURESTART | EVENT_SYSTEM_DIALOGSTART => CheckStack,
        EVENT_OBJECT_CREATE | EVENT_OBJECT_SHOW | EVENT_OBJECT_UNCLOAKED
            if has_window && child_id == 0 && matches!(object_id, 0 | -4) => CheckTopLevelStack,
        _ => Ignore,
    }
}

/// Avoid posting a flood of identical asynchronous moves if the UI thread is
/// temporarily busy. A *different* window is never delayed by this guard.
pub const DUPLICATE_RAISE_GUARD_MS: u64 = 8;
pub fn should_request_overlay_raise(previous_above: isize, last_ms: u64, above: isize, now_ms: u64) -> bool {
    previous_above != above || now_ms < last_ms || now_ms - last_ms >= DUPLICATE_RAISE_GUARD_MS
}

/// A few short checks after an early event catch popups that are inserted just
/// after their menu/capture/create notification. The ordinary 50 ms fallback
/// remains; bursts are rate-limited and never run while the overlay is off.
pub const BURST_OFFSETS_MS: [u64; 4] = [3, 8, 16, 32];
pub const BURST_MIN_INTERVAL_MS: u64 = 100;

pub fn should_request_burst(last_ms: u64, now_ms: u64) -> bool {
    last_ms == 0 || now_ms < last_ms || now_ms - last_ms >= BURST_MIN_INTERVAL_MS
}

#[derive(Debug, Default)]
pub struct OverlayBurst {
    started_ms: Option<u64>,
    next_index: usize,
}

impl OverlayBurst {
    pub fn start(&mut self, now_ms: u64) {
        self.started_ms = Some(now_ms);
        self.next_index = 0;
    }

    pub fn clear(&mut self) { self.started_ms = None; }

    pub fn next_due(&self) -> Option<u64> {
        self.started_ms.map(|start| start.saturating_add(BURST_OFFSETS_MS[self.next_index]))
    }

    /// Collapse missed deadlines to one scan rather than replaying a backlog.
    pub fn take_if_due(&mut self, now_ms: u64) -> bool {
        let Some(deadline) = self.next_due() else { return false };
        if now_ms < deadline { return false; }
        while self.next_index < BURST_OFFSETS_MS.len()
            && self.started_ms.unwrap().saturating_add(BURST_OFFSETS_MS[self.next_index]) <= now_ms {
            self.next_index += 1;
        }
        if self.next_index == BURST_OFFSETS_MS.len() { self.clear(); }
        true
    }
}

/// GetSystemMetrics returns physical coordinates, including negative origins.
pub fn valid_virtual_bounds(x: i32, y: i32, width: i32, height: i32) -> Option<(i32, i32, u32, u32)> {
    if width <= 0 || height <= 0 { None } else { Some((x, y, width as u32, height as u32)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_or_color_safe_never_shows_the_layer() {
        assert!(!needs_overlay(false, false, 10, false, 2700));
        assert!(!needs_overlay(true, true, 10, false, 2700));
    }

    #[test]
    fn normal_brightness_uses_a_layer_only_when_needed() {
        assert!(!needs_overlay(true, false, 100, true, 4200));
        assert!(needs_overlay(true, false, 99, true, 6500));
        assert!(needs_overlay(true, false, 10, true, 4200));
    }

    #[test]
    fn rejected_gamma_gets_warmth_fallback_even_at_full_brightness() {
        assert!(needs_overlay(true, false, 100, false, 3000));
        assert!(!needs_overlay(true, false, 100, false, 6500));
        assert!(needs_overlay(true, false, 70, false, 6500));
    }

    #[test]
    fn older_windows_never_receives_the_black_capture_affinity() {
        assert!(!exclusion_supported_windows(6, 19045));
        assert!(!exclusion_supported_windows(10, 18363));
        assert!(!exclusion_supported_windows(10, 19040));
        assert!(exclusion_supported_windows(10, 19041));
        assert!(exclusion_supported_windows(10, 26100));
        assert!(exclusion_supported_windows(11, 1));
    }

    #[test]
    fn popup_and_foreground_events_trigger_without_exposing_content() {
        use OverlayEventAction::*;
        for event in [EVENT_SYSTEM_ALERT, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUSTART,
                      EVENT_SYSTEM_MENUPOPUPSTART, EVENT_SYSTEM_CAPTURESTART, EVENT_SYSTEM_DIALOGSTART] {
            assert_eq!(overlay_event_action(event, true, true, false, -4, 0), CheckStack);
            assert_eq!(overlay_event_action(event, false, true, false, -4, 0), Ignore);
            assert_eq!(overlay_event_action(event, true, false, false, -4, 0), CheckStack); // system event without HWND
            assert_eq!(overlay_event_action(event, true, true, true, -4, 0), Ignore);
        }
        // Menu-end and unrelated object events must not cause a new raise.
        assert_eq!(overlay_event_action(0x0005, true, true, false, 0, 0), Ignore);
        assert_eq!(overlay_event_action(0x8005, true, true, false, 0, 0), Ignore);
    }

    #[test]
    fn show_events_ignore_individual_accessibility_children() {
        use OverlayEventAction::*;
        for event in [EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED] {
            assert_eq!(overlay_event_action(event, true, true, false, 0, 0), CheckTopLevelStack); // window itself
            assert_eq!(overlay_event_action(event, true, true, false, -4, 0), CheckTopLevelStack); // client itself
            assert_eq!(overlay_event_action(event, true, true, false, 0, 1), Ignore);
            assert_eq!(overlay_event_action(event, true, true, false, -4, 7), Ignore);
            assert_eq!(overlay_event_action(event, true, true, false, -8, 0), Ignore); // cursor
            assert_eq!(overlay_event_action(event, true, true, false, -10, 0), Ignore); // alert object
            assert_eq!(overlay_event_action(event, false, true, false, 0, 0), Ignore);
            assert_eq!(overlay_event_action(event, true, false, false, 0, 0), Ignore);
            assert_eq!(overlay_event_action(event, true, true, true, 0, 0), Ignore);
        }
    }

    #[test]
    fn only_duplicate_async_raises_are_briefly_coalesced() {
        assert!(should_request_overlay_raise(0, 0, 42, 100));
        assert!(!should_request_overlay_raise(42, 100, 42, 107));
        assert!(should_request_overlay_raise(42, 100, 42, 108));
        assert!(should_request_overlay_raise(42, 100, 77, 101)); // different window: immediate
        assert!(should_request_overlay_raise(42, 100, 42, 99)); // clock anomaly: don't suppress
    }

    #[test]
    fn early_popup_burst_is_short_bounded_and_does_not_replay_late_work() {
        assert!(should_request_burst(0, 20));
        assert!(!should_request_burst(100, 199));
        assert!(should_request_burst(100, 200));
        assert!(should_request_burst(100, 99));
        let mut b = OverlayBurst::default();
        assert_eq!(b.next_due(), None);
        b.start(1000);
        assert_eq!(b.next_due(), Some(1003));
        assert!(!b.take_if_due(1002));
        assert!(b.take_if_due(1003));
        assert_eq!(b.next_due(), Some(1008));
        assert!(b.take_if_due(1030)); // skip both overdue checks, not a flood
        assert_eq!(b.next_due(), Some(1032));
        assert!(b.take_if_due(1032));
        assert_eq!(b.next_due(), None);
        b.start(u64::MAX - 2);
        assert_eq!(b.next_due(), Some(u64::MAX));
        assert!(b.take_if_due(u64::MAX));
        assert_eq!(b.next_due(), None);
    }

    #[test]
    fn virtual_bounds_accept_negative_origins_but_not_empty_displays() {
        assert_eq!(valid_virtual_bounds(-1920, -900, 5760, 3060), Some((-1920, -900, 5760, 3060)));
        assert_eq!(valid_virtual_bounds(0, 0, 0, 1080), None);
        assert_eq!(valid_virtual_bounds(0, 0, 1920, -1), None);
    }
}
