//! Small privacy-preserving trace of changes to the filter decision. No window
//! title, process name, whitelist entry, browsing data or contents are recorded.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FilterTrace {
    pub enabled: bool,
    pub color_safe_paused: bool,
    pub scheduled: bool,
    pub requested_kelvin: u32,
    pub last_api_kelvin: u32,
    pub brightness: u32,
    pub gamma_any: bool,
    pub gamma_all: bool,
    pub screen_status: &'static str,
    pub screen_covered: bool,
}
impl FilterTrace {
    pub fn message(self) -> String {
        format!("filter: enabled={} color_safe_paused={} scheduled={} requested={}K last_api={}K brightness={}% gamma_any={} gamma_all={} screen={} covered={}",
            self.enabled, self.color_safe_paused, self.scheduled, self.requested_kelvin,
            self.last_api_kelvin, self.brightness, self.gamma_any, self.gamma_all,
            self.screen_status, self.screen_covered)
    }
}

/// Reject stale concurrent snapshots; emit only changes, not every timer tick.
pub struct TraceTracker { last_revision: Option<u64>, last: Option<FilterTrace> }
impl TraceTracker {
    pub const fn new() -> Self { Self { last_revision: None, last: None } }
    pub fn observe(&mut self, revision: u64, value: FilterTrace) -> Option<FilterTrace> {
        if self.last_revision.is_some_and(|last| revision <= last) { return None; }
        self.last_revision = Some(revision);
        if self.last == Some(value) { return None; }
        self.last = Some(value);
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> FilterTrace { FilterTrace { enabled: true, color_safe_paused: false,
        scheduled: false, requested_kelvin: 3200, last_api_kelvin: 3200, brightness: 80,
        gamma_any: true, gamma_all: true, screen_status: "off", screen_covered: false } }
    #[test]
    fn unchanged_ticks_are_coalesced_and_stale_revisions_are_ignored() {
        let mut tracker = TraceTracker::new();
        let a = sample();
        assert_eq!(tracker.observe(1, a), Some(a));
        assert_eq!(tracker.observe(2, a), None);
        let mut b = a; b.color_safe_paused = true;
        assert_eq!(tracker.observe(3, b), Some(b));
        assert_eq!(tracker.observe(2, a), None);
        assert_eq!(tracker.observe(4, b), None);
        assert_eq!(tracker.observe(5, a), Some(a));
    }
    #[test]
    fn output_has_decision_and_api_status_but_no_foreground_identity() {
        let text = sample().message();
        assert!(text.contains("color_safe_paused=false") && text.contains("gamma_any=true"));
        assert!(text.contains("last_api=3200K") && text.contains("screen=off"));
        assert!(!text.contains("title=") && !text.contains("process=") && !text.contains("whitelist_entry="));
    }
}
