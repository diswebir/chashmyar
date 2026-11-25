//! Pure color-safe whitelist matching policy.

/// Case-insensitive executable exact/partial matching and title substring
/// matching. Keep the user's original entry for display. An entry such as
/// ".exe" has an empty stem and must not match every executable.
pub fn matching_entry(whitelist: &[String], process: &str, title: &str) -> Option<String> {
    let process = process.to_lowercase();
    let title = title.to_lowercase();
    for raw in whitelist {
        let entry = raw.trim();
        if entry.is_empty() { continue; }
        let needle = entry.to_lowercase();
        let stem = needle.trim_end_matches(".exe");
        if (!process.is_empty() && process == needle)
            || (!process.is_empty() && !stem.is_empty() && process.contains(stem))
            || (!title.is_empty() && title.contains(&needle)) {
            return Some(entry.to_string());
        }
    }
    None
}

/// A sample gets its sequence *before* native lookup begins. `None` means a
/// component was unavailable, not that the component is a known empty string.
/// Neither names nor titles are written to diagnostics.
#[derive(Debug, Clone)]
pub struct Sample {
    pub sequence: u64,
    pub process: Option<String>,
    pub title: Option<String>,
}
impl Sample {
    #[cfg(test)]
    fn new(sequence: u64, process: Option<&str>, title: Option<&str>) -> Self {
        Self { sequence, process: process.map(str::to_owned), title: title.map(str::to_owned) }
    }
    pub fn quality(&self) -> &'static str {
        match (self.process.is_some(), self.title.is_some()) {
            (true, true) => "complete",
            (false, false) => "unavailable",
            _ => "partial",
        }
    }
}

/// Owns one decision under the runtime lock. Samples may be gathered on
/// different threads without the lock; old/slow results are discarded.
#[derive(Debug, Default)]
pub struct ForegroundCache {
    last_sequence: Option<u64>,
    process: Option<String>,
    title: Option<String>,
    active: Option<String>,
}
impl ForegroundCache {
    pub fn active(&self) -> Option<&str> { self.active.as_deref() }

    /// Returns false for an older lookup, even if that older lookup was the
    /// only one that produced data. An unavailable *newer* sample advances the
    /// watermark while retaining a still-allowed prior decision.
    pub fn observe(&mut self, sample: Sample, enabled: bool, whitelist: &[String]) -> bool {
        if self.last_sequence.is_some_and(|last| sample.sequence <= last) { return false; }
        self.last_sequence = Some(sample.sequence);
        self.process = sample.process;
        self.title = sample.title;
        self.recompute(enabled, whitelist);
        true
    }

    /// Recompute on every settings edit against the current list and switch.
    /// Positive partial data can establish a match. With incomplete data, only
    /// retain an existing match while it is still on the list; never invent a
    /// new match from an old window. A complete nonmatch releases the pause.
    pub fn recompute(&mut self, enabled: bool, whitelist: &[String]) {
        if !enabled {
            self.process = None;
            self.title = None;
            self.active = None;
            return;
        }
        let positive = matching_entry(whitelist, self.process.as_deref().unwrap_or(""),
            self.title.as_deref().unwrap_or(""));
        self.active = if positive.is_some() {
            positive
        } else if self.process.is_none() || self.title.is_none() {
            self.active.as_ref().and_then(|previous| whitelist.iter()
                .map(|entry| entry.trim())
                .find(|entry| entry.eq_ignore_ascii_case(previous))
                .map(str::to_owned))
        } else {
            None
        };
    }
}

/// Recompute a completely known observation; used to preserve the original
/// matching behavior in a standalone test.
#[cfg(test)]
pub fn active_entry(enabled: bool, whitelist: &[String], process: &str, title: &str) -> Option<String> {
    if enabled { matching_entry(whitelist, process, title) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entries(values: &[&str]) -> Vec<String> { values.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn standard_executables_and_titles_keep_their_old_matching_behavior() {
        let w = entries(&[" Figma.exe ", "DevTools", "photoshop"]);
        assert_eq!(matching_entry(&w, "FIGMA.EXE", "Design"), Some("Figma.exe".into()));
        assert_eq!(matching_entry(&w, "chrome.exe", "Chrome DevTools"), Some("DevTools".into()));
        assert_eq!(matching_entry(&w, "PhotoshopBeta.exe", ""), Some("photoshop".into()));
        assert_eq!(matching_entry(&w, "notepad.exe", "Notes"), None);
    }

    #[test]
    fn editing_an_unrelated_entry_does_not_clear_the_current_match() {
        let mut w = entries(&["Figma.exe", "DevTools"]);
        assert_eq!(active_entry(true, &w, "FIGMA.EXE", "Design"), Some("Figma.exe".into()));
        w.retain(|entry| entry != "DevTools");
        assert_eq!(active_entry(true, &w, "FIGMA.EXE", "Design"), Some("Figma.exe".into()));
        assert_eq!(active_entry(false, &w, "FIGMA.EXE", "Design"), None);
        w.clear();
        assert_eq!(active_entry(true, &w, "FIGMA.EXE", "Design"), None);
    }

    #[test]
    fn unknown_and_partial_foreground_reads_do_not_erase_a_positive_decision() {
        let mut cache = ForegroundCache::default();
        let mut list = entries(&["Figma.exe", "DevTools"]);
        cache.observe(Sample::new(1, Some("figma.exe"), Some("Design")), true, &list);
        assert_eq!(cache.active(), Some("Figma.exe"));
        // A missing process lookup or a missing HWND is not a negative result.
        cache.observe(Sample::new(2, None, Some("")), true, &list);
        assert_eq!(cache.active(), Some("Figma.exe"));
        cache.observe(Sample::new(3, None, None), true, &list);
        list.retain(|entry| entry != "DevTools");
        cache.recompute(true, &list);
        assert_eq!(cache.active(), Some("Figma.exe"));
        // The user can explicitly remove the retained match even while unknown.
        list.clear();
        cache.recompute(true, &list);
        assert_eq!(cache.active(), None);
        // Known partial data can still establish a new positive match.
        list = entries(&["DevTools"]);
        cache.observe(Sample::new(4, None, Some("Chrome DevTools")), true, &list);
        assert_eq!(cache.active(), Some("DevTools"));
        cache.observe(Sample::new(5, Some("notepad.exe"), Some("Notes")), true, &list);
        assert_eq!(cache.active(), None);
    }

    #[test]
    fn disabling_forgets_foreground_and_a_stale_sample_cannot_reactivate_it() {
        let mut cache = ForegroundCache::default();
        let list = entries(&["Figma.exe"]);
        cache.observe(Sample::new(10, Some("figma.exe"), Some("Design")), true, &list);
        cache.recompute(false, &list);
        assert_eq!(cache.active(), None);
        cache.observe(Sample::new(12, None, None), true, &list);
        cache.observe(Sample::new(11, Some("figma.exe"), Some("Design")), true, &list);
        assert_eq!(cache.active(), None);
        cache.observe(Sample::new(13, Some("figma.exe"), Some("Design")), true, &list);
        assert_eq!(cache.active(), Some("Figma.exe"));
    }

    #[test]
    fn out_of_order_samples_and_concurrent_list_edits_use_the_latest_policy() {
        use std::sync::{Arc, Mutex, mpsc};
        let state = Arc::new(Mutex::new((entries(&["Figma.exe", "DevTools"]), ForegroundCache::default())));
        let (ready_tx, ready_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let old = Arc::clone(&state);
        let thread = std::thread::spawn(move || {
            let sample = Sample::new(20, Some("figma.exe"), Some("Design"));
            ready_tx.send(()).unwrap();
            release_rx.recv().unwrap(); // sampled first but applied last
            let mut state = old.lock().unwrap();
            let (list, cache) = &mut *state;
            cache.observe(sample, true, list);
        });
        ready_rx.recv().unwrap();
        {
            let mut state = state.lock().unwrap();
            let (list, cache) = &mut *state;
            cache.observe(Sample::new(21, Some("chrome.exe"), Some("Chrome DevTools")), true, list);
            // Settings are updated while the older lookup is still in flight.
            list.retain(|entry| entry != "Figma.exe");
            cache.recompute(true, list);
        }
        release_tx.send(()).unwrap();
        thread.join().unwrap();
        let state = state.lock().unwrap();
        assert_eq!(state.1.active(), Some("DevTools"));
    }

    #[test]
    fn empty_or_extension_only_entries_do_not_match_every_process() {
        let w = entries(&["", "  ", ".exe", ".EXE"]);
        assert_eq!(matching_entry(&w, "notepad.exe", "Notes"), None);
        assert_eq!(matching_entry(&w, "", ""), None);
        // A literal title containing .exe can still match that title.
        assert_eq!(matching_entry(&w, "notepad.exe", "file.exe"), Some(".exe".into()));
    }
}
