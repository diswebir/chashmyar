//! Conservative, testable settings recovery and same-directory replacement.
//! The on-disk schema remains the tauri-plugin-store JSON object with a
//! `settings` key. No Tauri, Windows, or UI is needed to test this module.
use crate::state::Settings;
use serde_json::{Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_SETTINGS_BYTES: u64 = 4 * 1024 * 1024;
static UNIQUE: AtomicU64 = AtomicU64::new(0);

pub struct Recovery {
    pub settings: Settings,
    /// Schema paths only, never values, process names or window titles.
    pub rejected: Vec<String>,
}

pub(crate) fn safe_defaults() -> Settings {
    let mut settings = Settings::default();
    // For an unreadable document do not invent launch behavior or a strict
    // keyboard lock. Valid fields from a partially damaged document are still
    // recovered independently below.
    settings.eye.enabled = false;
    settings.system.autostart = false;
    settings.system.auto_start_timer_on_launch = false;
    settings.system.eye_care_on_launch = false;
    settings.lock.strict_lock = false;
    settings
}

// Some legacy deserializers intentionally fail closed rather than returning
// an error, and display normalization clamps numeric ranges later. Detect
// those changes too so the original is backed up before a later save.
fn normalized_fields(value: &Value) -> Vec<String> {
    let Some(eye) = value.get("eye").and_then(Value::as_object) else { return Vec::new(); };
    let mut fields = Vec::new();
    for (key, min, max) in [("kelvin", 2700, 6500), ("scheduleKelvin", 2700, 6500),
                             ("brightness", 10, 100), ("scheduleBrightness", 10, 100)] {
        if let Some(n) = eye.get(key).and_then(Value::as_u64) {
            if n <= u64::from(u32::MAX) && !(min..=max).contains(&n) {
                fields.push(format!("eye.{key}"));
            }
        }
    }
    if let Some(v) = eye.get("colorVisionProfile") {
        if !v.as_str().is_some_and(crate::color_vision::Profile::valid) {
            fields.push("eye.colorVisionProfile".into());
        }
    }
    if let Some(v) = eye.get("colorVisionStrength") {
        if !v.as_u64().is_some_and(|n| n <= 100) {
            fields.push("eye.colorVisionStrength".into());
        }
    }
    if let Some(v) = eye.get("coverWindowsMenus") {
        if v.as_bool().is_none() { fields.push("eye.coverWindowsMenus".into()); }
    }
    fields
}

/// Retain each valid, known field rather than resetting an entire installation
/// because an unrelated field had an invalid type or an unknown enum value.
pub fn decode(value: Value) -> Recovery {
    let normalized = normalized_fields(&value);
    if let Ok(settings) = serde_json::from_value::<Settings>(value.clone()) {
        return Recovery { settings, rejected: normalized };
    }
    let Some(root) = value.as_object() else {
        return Recovery { settings: safe_defaults(), rejected: vec!["settings".into()] };
    };
    let schema = serde_json::to_value(Settings::default()).unwrap_or(Value::Null);
    let mut accepted = Value::Object(Map::new());
    let mut rejected = normalized;
    let mut unsafe_eye_switch = false;
    let mut unsafe_launch_switch = false;
    let mut unsafe_autostart = false;
    let mut unsafe_timer_autostart = false;
    let mut unsafe_strict_lock = false;
    for group in ["eye", "timer", "lock", "system"] {
        let Some(section) = root.get(group) else { continue; };
        let Some(fields) = section.as_object() else {
            rejected.push(group.to_string());
            if group == "eye" { unsafe_eye_switch = true; }
            if group == "system" {
                unsafe_launch_switch = true;
                unsafe_autostart = true;
                unsafe_timer_autostart = true;
            }
            if group == "timer" { unsafe_timer_autostart = true; }
            if group == "lock" { unsafe_strict_lock = true; }
            continue;
        };
        accepted.as_object_mut().unwrap().insert(group.into(), Value::Object(Map::new()));
        for (name, field) in fields {
            if !schema.get(group).and_then(Value::as_object).is_some_and(|known| known.contains_key(name)) {
                continue; // preserve unknown data in the original backup / next save
            }
            let mut candidate = accepted.clone();
            candidate[group].as_object_mut().unwrap().insert(name.clone(), field.clone());
            if serde_json::from_value::<Settings>(candidate.clone()).is_ok() {
                accepted = candidate;
            } else {
                rejected.push(format!("{group}.{name}"));
                if group == "eye" && name == "enabled" { unsafe_eye_switch = true; }
                if group == "system" && name == "eyeCareOnLaunch" { unsafe_launch_switch = true; }
                if group == "system" && name == "autostart" { unsafe_autostart = true; }
                if group == "system" && name == "autoStartTimerOnLaunch" { unsafe_timer_autostart = true; }
                if group == "lock" && name == "strictLock" { unsafe_strict_lock = true; }
            }
        }
    }
    let mut settings = serde_json::from_value::<Settings>(accepted).unwrap_or_else(|_| safe_defaults());
    if unsafe_eye_switch { settings.eye.enabled = false; }
    if unsafe_launch_switch { settings.system.eye_care_on_launch = false; }
    if unsafe_autostart { settings.system.autostart = false; }
    if unsafe_timer_autostart { settings.system.auto_start_timer_on_launch = false; }
    if unsafe_strict_lock { settings.lock.strict_lock = false; }
    Recovery { settings, rejected }
}

/// Add only unrecognized keys back into the newly serialized settings; the
/// current recognized fields always win, including repaired invalid values.
fn merge_unknown(previous: &Value, current: &mut Value) {
    if let (Some(old), Some(new)) = (previous.as_object(), current.as_object_mut()) {
        for (key, value) in old {
            if let Some(next) = new.get_mut(key) { merge_unknown(value, next); }
            else { new.insert(key.clone(), value.clone()); }
        }
    }
}

enum Document { Missing, Valid(Map<String, Value>), Broken(&'static str) }
fn read_document(path: &Path) -> io::Result<Document> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Document::Missing),
        Err(e) => return Err(e),
    };
    if file.metadata()?.len() > MAX_SETTINGS_BYTES { return Ok(Document::Broken("settings file exceeds 4 MiB")); }
    // Bound the read itself too: another process could grow the file after the
    // metadata check. Never interpret an incomplete prefix as valid JSON.
    let mut data = Vec::new();
    file.take(MAX_SETTINGS_BYTES + 1).read_to_end(&mut data)?;
    if data.len() as u64 > MAX_SETTINGS_BYTES { return Ok(Document::Broken("settings file exceeds 4 MiB")); }
    match serde_json::from_slice::<Value>(&data) {
        Ok(Value::Object(root)) => Ok(Document::Valid(root)),
        Ok(_) => Ok(Document::Broken("settings file root is not an object")),
        Err(_) => Ok(Document::Broken("settings file is not valid JSON")),
    }
}

fn unique_path(path: &Path, label: &str) -> io::Result<(PathBuf, File)> {
    let parent = path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "settings path has no parent"))?;
    let file = path.file_name().and_then(|n| n.to_str()).unwrap_or("chashmyar.settings.json");
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    for _ in 0..100 {
        let id = UNIQUE.fetch_add(1, Ordering::Relaxed);
        let extension = if label == "recovery" { ".json" } else { "" };
        let name = format!("{file}.{label}-{stamp}-{}-{id}{extension}", std::process::id());
        let output = parent.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&output) {
            Ok(f) => return Ok((output, f)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "could not allocate a unique settings file"))
}

/// Back up the entire original file before permitting an automatic repair.
fn backup_file(path: &Path) -> io::Result<PathBuf> {
    let mut input = File::open(path)?;
    let (backup, mut output) = unique_path(path, "recovery")?;
    let result = (|| { io::copy(&mut input, &mut output)?; output.sync_all() })();
    drop(output);
    if let Err(err) = result { let _ = fs::remove_file(&backup); return Err(err); }
    Ok(backup)
}

pub struct Loaded {
    pub settings: Settings,
    /// A malformed/unreadable autostart choice must not change the registry.
    pub may_update_autostart: bool,
    /// Human-readable diagnostic, not a claim that recovery was lossless.
    pub warning: Option<String>,
}

fn backup_note(path: &Path) -> String {
    match backup_file(path) {
        Ok(copy) => format!("original backed up to {}", copy.display()),
        Err(err) => format!("backup failed ({err}); a later save will retry backup and will not overwrite it if that fails"),
    }
}

pub fn load_file(path: &Path) -> Loaded {
    match read_document(path) {
        Ok(Document::Missing) => Loaded { settings: Settings::default(), may_update_autostart: true, warning: None },
        Ok(Document::Broken(reason)) => Loaded {
            settings: safe_defaults(),
            may_update_autostart: false,
            warning: Some(format!("{reason}; eye protection starts off; {}", backup_note(path))),
        },
        Ok(Document::Valid(root)) => match root.get("settings") {
            None => Loaded { settings: Settings::default(), may_update_autostart: true, warning: None },
            Some(value) => {
                let recovered = decode(value.clone());
                let may_update_autostart = !recovered.rejected.iter().any(|field|
                    matches!(field.as_str(), "settings" | "system" | "system.autostart"));
                let warning = if recovered.rejected.is_empty() { None } else {
                    Some(format!("invalid or normalized settings fields [{}]; {}", recovered.rejected.join(", "), backup_note(path)))
                };
                Loaded { settings: recovered.settings, may_update_autostart, warning }
            }
        },
        Err(err) => Loaded {
            settings: safe_defaults(),
            may_update_autostart: false,
            warning: Some(format!("cannot read settings ({err}); eye protection starts off; save will not bypass read errors")),
        },
    }
}

/// Write a full JSON document to a new file in the same directory, flush it,
/// then replace the old path. On any error the previous path is not truncated.
/// Durability/atomicity still depend on the filesystem and power-loss behavior.
fn replace_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "settings path has no parent"))?;
    fs::create_dir_all(parent)?;
    let (tmp, mut output) = unique_path(path, "tmp")?;
    let result = (|| { output.write_all(bytes)?; output.sync_all()?; drop(output); fs::rename(&tmp, path) })();
    if result.is_err() { let _ = fs::remove_file(&tmp); }
    result
}

/// Serialize writers and take the latest state only *after* acquiring the
/// writer lock. In production the closure briefly takes the runtime lock; no
/// caller may enter this function already holding that lock.
pub struct SettingsWriter { lock: std::sync::Mutex<()> }
impl SettingsWriter {
    pub const fn new() -> Self { Self { lock: std::sync::Mutex::new(()) } }
    pub fn save_latest(&self, path: &Path, latest: impl FnOnce() -> Settings) -> io::Result<Option<PathBuf>> {
        let _guard = self.lock.lock().unwrap_or_else(|poison| poison.into_inner());
        let settings = latest();
        save_file(path, &settings)
    }
}

/// Preserve other store keys and unknown future settings fields. Never replace
/// damaged data unless a copy of the original was successfully made first.
fn save_file(path: &Path, settings: &Settings) -> io::Result<Option<PathBuf>> {
    let mut backup = None;
    let mut root = match read_document(path)? {
        Document::Missing => Map::new(),
        Document::Broken(_) => { backup = Some(backup_file(path)?); Map::new() }
        Document::Valid(root) => {
            if root.get("settings").is_some_and(|v| !decode(v.clone()).rejected.is_empty()) {
                backup = Some(backup_file(path)?);
            }
            root
        }
    };
    let mut value = serde_json::to_value(settings).map_err(io::Error::other)?;
    if let Some(old) = root.get("settings") { merge_unknown(old, &mut value); }
    root.insert("settings".into(), value);
    let bytes = serde_json::to_vec_pretty(&Value::Object(root)).map_err(io::Error::other)?;
    replace_file(path, &bytes)?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn temp_file(name: &str) -> PathBuf {
        let id = UNIQUE.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("chashmyar-settings-{name}-{}-{id}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("chashmyar.settings.json")
    }
    fn clean(path: &Path) { let _ = fs::remove_dir_all(path.parent().unwrap()); }

    #[test]
    fn malformed_unrelated_field_does_not_discard_valid_eye_or_timer_choices() {
        let r = decode(json!({
            "eye": {"enabled": false, "kelvin": 3150, "brightness": 73,
                    "scheduleEnabled": false, "colorSafeEnabled": false},
            "timer": {"workMinutes": 37},
            "system": {"theme": "future-theme", "soundEnabled": true}
        }));
        assert!(!r.settings.eye.enabled);
        assert_eq!(r.settings.eye.kelvin, 3150);
        assert_eq!(r.settings.eye.brightness, 73);
        assert!(!r.settings.eye.schedule_enabled && !r.settings.eye.color_safe_enabled);
        assert_eq!(r.settings.timer.work_minutes, 37);
        assert!(r.settings.system.sound_enabled);
        assert_eq!(r.rejected, vec!["system.theme"]);
    }
    #[test]
    fn malformed_eye_enabled_does_not_implicitly_turn_filter_on() {
        let r = decode(json!({"eye": {"enabled": "invalid", "kelvin": 3100}, "system": {"soundEnabled": true}}));
        assert!(!r.settings.eye.enabled);
        assert_eq!(r.settings.eye.kelvin, 3100);
        assert!(r.settings.system.sound_enabled);
        assert_eq!(r.rejected, vec!["eye.enabled"]);
    }
    #[test]
    fn damaged_launch_and_lock_switches_do_not_enable_strict_or_auto_start() {
        let damaged = decode(json!({"lock": {"strictLock": "bad"}, "system": {
            "autostart": "bad", "autoStartTimerOnLaunch": "bad", "eyeCareOnLaunch": "bad"
        }, "eye": {"enabled": false, "kelvin": 3450}}));
        assert!(!damaged.settings.lock.strict_lock);
        assert!(!damaged.settings.system.autostart);
        assert!(!damaged.settings.system.auto_start_timer_on_launch);
        assert!(!damaged.settings.system.eye_care_on_launch);
        assert_eq!(damaged.settings.eye.kelvin, 3450);
        let broken = safe_defaults();
        assert!(!broken.eye.enabled && !broken.lock.strict_lock);
        assert!(!broken.system.autostart && !broken.system.auto_start_timer_on_launch);
    }

    #[test]
    fn unreadable_or_bad_autostart_does_not_change_registry_at_launch() {
        let path = temp_file("autostart");
        assert!(load_file(&path).may_update_autostart, "new installs keep their defaults");
        fs::write(&path, b"{ incomplete").unwrap();
        assert!(!load_file(&path).may_update_autostart);
        fs::write(&path, serde_json::to_vec(&json!({"settings": {"system": {
            "autostart": "invalid", "soundEnabled": true
        }}})).unwrap()).unwrap();
        let bad = load_file(&path);
        assert!(!bad.may_update_autostart && bad.settings.system.sound_enabled);
        fs::write(&path, serde_json::to_vec(&json!({"settings": {"system": {
            "autostart": false, "theme": "future-theme"
        }}})).unwrap()).unwrap();
        let unrelated = load_file(&path);
        assert!(unrelated.may_update_autostart && !unrelated.settings.system.autostart);
        clean(&path);
    }

    #[test]
    fn bad_group_and_bad_launch_switch_fail_safe_without_losing_other_groups() {
        let r = decode(json!({"eye": null, "system": {"eyeCareOnLaunch": "x", "soundEnabled": true}, "timer": {"workMinutes": 44}}));
        assert!(!r.settings.eye.enabled && !r.settings.system.eye_care_on_launch);
        assert!(r.settings.system.sound_enabled);
        assert_eq!(r.settings.timer.work_minutes, 44);
        assert_eq!(r.rejected, vec!["eye", "system.eyeCareOnLaunch"]);
    }
    #[test]
    fn missing_old_revision_still_migrates_after_unrelated_recovery() {
        let r = decode(json!({"eye": {"enabled": false}, "system": {"widgetHoverDelayMs": 650, "theme": "unknown"}}));
        assert_eq!(r.settings.system.widget_hover_delay_revision, 0);
        let mut settings = r.settings;
        settings.system.migrate_widget_hover_delay();
        assert_eq!(settings.system.widget_hover_delay_ms, 2000);
        assert!(!settings.eye.enabled);
    }
    #[test]
    fn display_normalization_does_not_rewrite_historically_valid_durations() {
        let mut settings = Settings::default();
        for input in [0, 750, 60_000, 120_000, u32::MAX] {
            settings.eye.transition_ms = input;
            settings.eye.normalize_display();
            assert_eq!(settings.eye.transition_ms, input);
        }
    }
    #[test]
    fn display_values_are_bounded_before_they_reach_gamma_and_css() {
        let mut s = Settings::default();
        s.eye.kelvin = u32::MAX;
        s.eye.brightness = u32::MAX;
        s.eye.schedule_kelvin = 0;
        s.eye.schedule_brightness = 0;
        s.eye.normalize_display();
        assert_eq!(s.eye.kelvin, 6500);
        assert_eq!(s.eye.brightness, 100);
        assert_eq!(s.eye.schedule_kelvin, 2700);
        assert_eq!(s.eye.schedule_brightness, 10);
    }
    #[test]
    fn corrupt_json_is_backed_up_before_safe_replacement() {
        let path = temp_file("broken");
        let original = b"{ \"settings\": ";
        fs::write(&path, original).unwrap();
        let loaded = load_file(&path);
        assert!(!loaded.settings.eye.enabled);
        assert!(loaded.warning.as_deref().unwrap().contains("backed up"));
        let saved_backup = save_file(&path, &loaded.settings).unwrap().unwrap();
        assert_eq!(fs::read(saved_backup).unwrap(), original);
        let valid: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(valid["settings"]["eye"]["enabled"], false);
        clean(&path);
    }
    #[test]
    fn lenient_or_out_of_range_fields_are_backed_up_before_normalization() {
        let path = temp_file("lenient-options");
        let original = json!({"settings": {"eye": {
            "enabled": false, "kelvin": 9000, "brightness": 0,
            "colorVisionProfile": "future-mode", "colorVisionStrength": -1,
            "coverWindowsMenus": "invalid"
        }}});
        fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        let mut loaded = load_file(&path);
        assert!(loaded.warning.as_deref().unwrap().contains("eye.kelvin"));
        loaded.settings.eye.normalize_color_vision();
        loaded.settings.eye.normalize_display();
        let backup = save_file(&path, &loaded.settings).unwrap().expect("must preserve original");
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(backup).unwrap()).unwrap(), original);
        assert_eq!(loaded.settings.eye.kelvin, 6500);
        assert_eq!(loaded.settings.eye.brightness, 10);
        assert_eq!(loaded.settings.eye.color_vision_profile, "off");
        assert_eq!(loaded.settings.eye.color_vision_strength, 0);
        assert!(!loaded.settings.eye.cover_windows_menus);
        clean(&path);
    }

    #[test]
    fn malformed_fields_are_backed_up_and_unknown_fields_survive_save() {
        let path = temp_file("fields");
        let original = json!({"otherRoot": {"token": 1}, "settings": {
            "eye": {"enabled": false, "kelvin": 3150, "futureEye": {"keep": true}},
            "system": {"theme": "not-a-theme", "soundEnabled": true}, "futureGroup": {"value": 77}
        }});
        fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        let loaded = load_file(&path);
        assert!(!loaded.settings.eye.enabled && loaded.settings.system.sound_enabled);
        assert!(loaded.warning.as_deref().unwrap().contains("system.theme"));
        let backup = save_file(&path, &loaded.settings).unwrap().unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(backup).unwrap()).unwrap(), original);
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["otherRoot"]["token"], 1);
        assert_eq!(saved["settings"]["eye"]["futureEye"]["keep"], true);
        assert_eq!(saved["settings"]["futureGroup"]["value"], 77);
        assert_eq!(saved["settings"]["eye"]["enabled"], false);
        assert_eq!(saved["settings"]["eye"]["kelvin"], 3150);
        assert_eq!(saved["settings"]["system"]["theme"], "light");
        clean(&path);
    }
    #[test]
    fn concurrent_writer_reloads_the_latest_settings_inside_its_lock() {
        use std::sync::{Arc, Mutex, mpsc};
        use std::time::Duration;
        let path = temp_file("concurrent");
        let writer = Arc::new(SettingsWriter::new());
        let current = Arc::new(Mutex::new(Settings::default()));
        current.lock().unwrap().eye.kelvin = 3150;
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_path = path.clone();
        let first_writer = Arc::clone(&writer);
        let first_state = Arc::clone(&current);
        let first = std::thread::spawn(move || first_writer.save_latest(&first_path, || {
            let old = first_state.lock().unwrap().clone();
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            old
        }).unwrap());
        entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        current.lock().unwrap().eye.kelvin = 3450;
        let second_path = path.clone();
        let second_writer = Arc::clone(&writer);
        let second_state = Arc::clone(&current);
        let second = std::thread::spawn(move || second_writer.save_latest(&second_path, ||
            second_state.lock().unwrap().clone()).unwrap());
        release_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        assert_eq!(load_file(&path).settings.eye.kelvin, 3450);
        clean(&path);
    }

    #[cfg(unix)]
    #[test]
    fn readers_never_observe_partial_json_during_same_directory_replacements() {
        use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
        let path = temp_file("atomic-read");
        let writer = SettingsWriter::new();
        writer.save_latest(&path, Settings::default).unwrap();
        let running = Arc::new(AtomicBool::new(true));
        let reader_running = Arc::clone(&running);
        let reader_path = path.clone();
        let reader = std::thread::spawn(move || {
            let mut count = 0;
            while reader_running.load(Ordering::SeqCst) || count < 20 {
                let bytes = fs::read(&reader_path).unwrap();
                let document: Value = serde_json::from_slice(&bytes).unwrap();
                assert!(document["settings"]["eye"]["kelvin"].is_u64());
                count += 1;
            }
            count
        });
        for i in 0..80 {
            writer.save_latest(&path, || {
                let mut s = Settings::default();
                s.eye.kelvin = 3000 + i;
                s
            }).unwrap();
        }
        running.store(false, Ordering::SeqCst);
        assert!(reader.join().unwrap() >= 20);
        clean(&path);
    }

    #[test]
    fn oversized_settings_are_backed_up_before_a_safe_replacement() {
        let path = temp_file("oversized");
        let original = vec![b' '; MAX_SETTINGS_BYTES as usize + 1];
        fs::write(&path, &original).unwrap();
        let loaded = load_file(&path);
        assert!(!loaded.settings.eye.enabled);
        assert!(loaded.warning.unwrap().contains("exceeds 4 MiB"));
        let backup = save_file(&path, &loaded.settings).unwrap().unwrap();
        assert_eq!(fs::metadata(backup).unwrap().len(), original.len() as u64);
        assert_eq!(load_file(&path).settings.eye.enabled, false);
        clean(&path);
    }

    #[cfg(unix)]
    #[test]
    fn backup_permission_failure_does_not_replace_a_damaged_original() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_file("no-backup-permission");
        let bytes = b"{ damaged but irreplaceable";
        fs::write(&path, bytes).unwrap();
        let parent = path.parent().unwrap();
        fs::set_permissions(parent, fs::Permissions::from_mode(0o500)).unwrap();
        let loaded = load_file(&path);
        assert!(loaded.warning.unwrap().contains("backup failed"));
        let result = save_file(&path, &loaded.settings);
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        clean(&path);
    }

    #[test]
    fn unreadable_source_never_gets_silently_replaced() {
        let path = temp_file("directory");
        fs::create_dir(&path).unwrap();
        let loaded = load_file(&path);
        assert!(!loaded.settings.eye.enabled && loaded.warning.is_some());
        assert!(save_file(&path, &loaded.settings).is_err());
        assert!(path.is_dir());
        clean(&path);
    }
    #[test]
    fn fresh_and_valid_files_do_not_create_recovery_backups() {
        let path = temp_file("valid");
        let loaded = load_file(&path);
        assert!(loaded.settings.eye.enabled && loaded.warning.is_none());
        assert!(save_file(&path, &loaded.settings).unwrap().is_none());
        assert!(load_file(&path).warning.is_none());
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
        clean(&path);
    }
}
