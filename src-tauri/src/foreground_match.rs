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
    fn empty_or_extension_only_entries_do_not_match_every_process() {
        let w = entries(&["", "  ", ".exe", ".EXE"]);
        assert_eq!(matching_entry(&w, "notepad.exe", "Notes"), None);
        assert_eq!(matching_entry(&w, "", ""), None);
        // A literal title containing .exe can still match that title.
        assert_eq!(matching_entry(&w, "notepad.exe", "file.exe"), Some(".exe".into()));
    }
}
