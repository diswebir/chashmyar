#[path = "../../../src-tauri/src/analytics_record.rs"]
mod analytics_record;

// Compile the real native payload-audit hash helper with the production sha2.
#[cfg(test)]
#[path = "../../../src-tauri/src/release_hash.rs"]
mod release_hash;

// Compile the real settings implementation against small platform stubs. This
// tests deserialization and defaults without launching Tauri or a Windows UI.
#[cfg(test)]
#[path = "../../../src-tauri/src/state.rs"]
mod state;
#[cfg(test)]
#[path = "../../../src-tauri/src/color_vision.rs"]
mod color_vision;
#[cfg(test)]
#[path = "../../../src-tauri/src/screen_handoff.rs"]
mod screen_handoff;
#[cfg(test)] mod color_filter {
    pub fn status() -> super::color_vision::Status { super::color_vision::Status::Off }
    pub fn screen_status() -> super::color_vision::Status { super::color_vision::Status::Off }
    pub fn screen_covers_overlay() -> bool { false }
}
#[cfg(test)] mod analytics { pub fn epoch() -> u64 { 0 } }
#[cfg(test)] mod display {
    pub const NEUTRAL_KELVIN: u32 = 6500;
    pub fn current_kelvin() -> u32 { NEUTRAL_KELVIN }
}
#[cfg(test)] mod windows { pub fn capture_exclusion_active() -> bool { false } }

#[cfg(test)]
mod tests {
    use super::analytics_record::DailyRecord;
    use serde_json::json;

    #[test]
    fn fresh_install_enables_requested_defaults() {
        let settings = super::state::Settings::default();
        assert!(settings.eye.enabled && settings.eye.schedule_enabled && settings.eye.color_safe_enabled);
        assert!(settings.timer.auto_start_break && settings.timer.auto_start_next_work);
        assert!(settings.timer.idle_detection_enabled && settings.timer.micro_break_enabled);
        assert_eq!(settings.timer.micro_break_interval_minutes, 20);
        assert_eq!(settings.timer.micro_break_seconds, 20);
        assert!(settings.lock.eye_exercises && settings.lock.body_exercises && settings.lock.emergency_unlock);
        assert_eq!(settings.lock.rotate_seconds, 20);
        assert!(settings.system.autostart && settings.system.auto_start_timer_on_launch);
        assert!(settings.system.eye_care_on_launch && settings.system.minimize_to_tray);
        assert!(!settings.system.sound_enabled, "fresh installations are silent");
        assert_eq!(settings.system.widget_hover_delay_ms, 2000);
        assert_eq!(settings.system.widget_hover_delay_revision, 1);
    }

    #[test]
    fn fullscreen_menu_coverage_is_opt_in_and_preserves_old_preferences() {
        for value in [json!({}), json!({"eye": {"kelvin": 3300, "brightness": 72}})] {
            let loaded: super::state::Settings = serde_json::from_value(value).unwrap();
            assert!(!loaded.eye.cover_windows_menus);
        }
        for malformed in [json!(null), json!("true"), json!(1), json!({"x": true})] {
            let loaded: super::state::Settings = serde_json::from_value(json!({
                "eye": {"coverWindowsMenus": malformed, "kelvin": 3300, "brightness": 72},
                "system": {"soundEnabled": true}
            })).unwrap();
            assert!(!loaded.eye.cover_windows_menus);
            assert_eq!(loaded.eye.kelvin, 3300); assert_eq!(loaded.eye.brightness, 72);
            assert!(loaded.system.sound_enabled);
        }
        let saved: super::state::Settings = serde_json::from_value(json!({
            "eye": {"coverWindowsMenus": true, "colorVisionProfile": "tritanopia"},
            "system": {"widgetHoverDelayMs": 2000, "widgetHoverDelayRevision": 1}
        })).unwrap();
        let loaded: super::state::Settings = serde_json::from_value(serde_json::to_value(&saved).unwrap()).unwrap();
        assert!(loaded.eye.cover_windows_menus);
        assert_eq!(loaded.eye.color_vision_profile, "tritanopia");
        assert_eq!(loaded.system.widget_hover_delay_ms, 2000);
    }

    #[test]
    fn widget_hover_migration_is_once_and_does_not_touch_other_preferences() {
        for previous in [0, 100, 300, 650, 1200] {
            let old = json!({
                "system": {"widgetHoverDelayMs": previous, "soundEnabled": true, "autostart": false},
                "eye": {"kelvin": 3200},
                "timer": {"workMinutes": 33}
            });
            let mut settings: super::state::Settings = serde_json::from_value(old).unwrap();
            assert_eq!(settings.system.widget_hover_delay_revision, 0, "missing marker denotes an old installation");
            settings.system.migrate_widget_hover_delay();
            assert_eq!(settings.system.widget_hover_delay_ms, 2000);
            assert_eq!(settings.system.widget_hover_delay_revision, 1);
            assert!(settings.system.sound_enabled && !settings.system.autostart);
            assert_eq!(settings.eye.kelvin, 3200);
            assert_eq!(settings.timer.work_minutes, 33);
            settings.system.widget_hover_delay_ms = 650; // deliberate new choice
            let saved = serde_json::to_value(settings).unwrap();
            let mut reloaded: super::state::Settings = serde_json::from_value(saved).unwrap();
            reloaded.system.migrate_widget_hover_delay();
            assert_eq!(reloaded.system.widget_hover_delay_ms, 650, "migration never repeats after an edit");
            assert_eq!(reloaded.system.widget_hover_delay_revision, 1);
        }
        let mut missing_group: super::state::Settings = serde_json::from_value(json!({})).unwrap();
        missing_group.system.migrate_widget_hover_delay();
        assert_eq!(missing_group.system.widget_hover_delay_ms, 2000);
        let mut out_of_range: super::state::Settings = serde_json::from_value(
            json!({"system": {"widgetHoverDelayMs": 6000, "widgetHoverDelayRevision": 1}})
        ).unwrap();
        out_of_range.system.migrate_widget_hover_delay();
        assert_eq!(out_of_range.system.widget_hover_delay_ms, 5000);
    }

    #[test]
    fn sound_defaults_off_when_absent_but_saved_choices_survive_round_trip() {
        // Both a missing group and a missing field must use the new default.
        for value in [json!({}), json!({"system": {}}), json!({"system": {"autostart": false}})] {
            let settings: super::state::Settings = serde_json::from_value(value).unwrap();
            assert!(!settings.system.sound_enabled);
        }
        // Never migrate or overwrite an explicit choice from an older version.
        for enabled in [false, true] {
            let settings: super::state::Settings = serde_json::from_value(
                json!({"system": {"soundEnabled": enabled}}),
            ).unwrap();
            assert_eq!(settings.system.sound_enabled, enabled);
            let json = serde_json::to_value(&settings).unwrap();
            assert_eq!(json["system"]["soundEnabled"], enabled);
            let reloaded: super::state::Settings = serde_json::from_value(json).unwrap();
            assert_eq!(reloaded.system.sound_enabled, enabled);
        }
    }

    #[test]
    fn explicitly_saved_old_preferences_are_not_overwritten_by_new_defaults() {
        let value = json!({
            "eye": {"scheduleEnabled": false, "colorSafeEnabled": false},
            "timer": {"autoStartNextWork": false, "microBreakSeconds": 15, "microBreakIntervalMinutes": 15},
            "lock": {"rotateSeconds": 45, "eyeExercises": false},
            "system": {"autostart": false, "autoStartTimerOnLaunch": false}
        });
        let settings: super::state::Settings = serde_json::from_value(value).unwrap();
        assert!(!settings.eye.schedule_enabled && !settings.eye.color_safe_enabled);
        assert!(!settings.timer.auto_start_next_work);
        assert_eq!(settings.timer.micro_break_seconds, 15);
        assert_eq!(settings.timer.micro_break_interval_minutes, 15);
        assert_eq!(settings.lock.rotate_seconds, 45);
        assert!(!settings.lock.eye_exercises && !settings.system.autostart && !settings.system.auto_start_timer_on_launch);
        let saved = serde_json::to_value(settings).unwrap();
        assert_eq!(saved["lock"]["rotateSeconds"], 45);
        assert_eq!(saved["system"]["autostart"], false);
    }

    #[test]
    fn old_settings_keep_all_choices_and_default_colour_vision_off() {
        for old in [
            json!({}),
            json!({"eye": {}}),
            json!({"eye": {"enabled": false, "kelvin": 3200, "scheduleEnabled": false, "colorSafeEnabled": false}, "system": {"soundEnabled": true}}),
        ] {
            let settings: super::state::Settings = serde_json::from_value(old.clone()).unwrap();
            assert_eq!(settings.eye.color_vision_profile, "off");
            assert_eq!(settings.eye.color_vision_strength, 60);
            if old.get("system").is_some() {
                assert!(!settings.eye.enabled && !settings.eye.schedule_enabled && !settings.eye.color_safe_enabled);
                assert_eq!(settings.eye.kelvin, 3200); assert!(settings.system.sound_enabled);
            }
        }
    }

    #[test]
    fn colour_vision_preferences_round_trip_and_unrecognized_values_fail_closed() {
        for profile in ["off", "protanopia", "deuteranopia", "tritanopia"] {
            let input = json!({"eye": {"colorVisionProfile": profile, "colorVisionStrength": 35, "kelvin": 3450}});
            let mut settings: super::state::Settings = serde_json::from_value(input).unwrap();
            settings.eye.normalize_color_vision();
            let saved = serde_json::to_value(&settings).unwrap();
            assert_eq!(saved["eye"]["colorVisionProfile"], profile);
            assert_eq!(saved["eye"]["colorVisionStrength"], 35);
            let loaded: super::state::Settings = serde_json::from_value(saved).unwrap();
            assert_eq!(loaded.eye.kelvin, 3450);
        }
        let mut invalid: super::state::Settings = serde_json::from_value(
            json!({"eye": {"colorVisionProfile": "unknown-future-mode", "colorVisionStrength": 500, "kelvin": 3450}})
        ).unwrap();
        invalid.eye.normalize_color_vision();
        assert_eq!(invalid.eye.color_vision_profile, "off");
        assert_eq!(invalid.eye.color_vision_strength, 100);
        assert_eq!(invalid.eye.kelvin, 3450);
        for bad_profile in [json!(null), json!(false), json!({"other": true}), json!([1, 2])] {
            let mut loaded: super::state::Settings = serde_json::from_value(json!({
                "eye": {"colorVisionProfile": bad_profile, "kelvin": 3450, "enabled": false},
                "system": {"soundEnabled": true}
            })).unwrap();
            loaded.eye.normalize_color_vision();
            assert_eq!(loaded.eye.color_vision_profile, "off");
            assert_eq!(loaded.eye.kelvin, 3450);
            assert!(!loaded.eye.enabled && loaded.system.sound_enabled);
        }
        for bad_strength in [json!(null), json!(-1), json!("bad"), json!([60]), json!(60.5)] {
            let loaded: super::state::Settings = serde_json::from_value(json!({
                "eye": {"colorVisionProfile": "protanopia", "colorVisionStrength": bad_strength, "kelvin": 3450},
                "system": {"soundEnabled": true}
            })).unwrap();
            assert_eq!(loaded.eye.color_vision_strength, 0);
            assert_eq!(loaded.eye.kelvin, 3450);
            assert!(loaded.system.sound_enabled);
        }
    }

    #[test]
    fn old_records_keep_totals_without_inventing_outcomes() {
        let old = json!({
            "deepWorkMinutes": 125, "completedBreaks": 4, "naturalBreaks": 2,
            "microBreaksCompleted": 3, "snoozeUsedCount": 2,
            "penaltyCount": 1, "emergencySkips": 1
        });
        let record: DailyRecord = serde_json::from_value(old).unwrap();
        assert_eq!(record.deep_work_minutes, 125);
        assert_eq!(record.completed_breaks, 4);
        assert_eq!(record.micro_breaks_completed, 3);
        assert_eq!(record.snooze_used_count, 2);
        assert_eq!(record.observed_breaks_completed, 0);
        assert_eq!(record.observed_breaks_skipped, 0);
        assert_eq!(record.observed_exercises_completed, 0);
        assert_eq!(record.observed_exercises_skipped, 0);
        assert_eq!(record.work_sessions_on_time, 0);
        assert_eq!(record.work_sessions_delayed, 0);
        assert_eq!(record.work_sessions_ended_early, 0);
        assert_eq!(record.tracked_focus_seconds, 0);
        let stored = serde_json::to_value(record).unwrap();
        assert_eq!(stored["deepWorkMinutes"], 125);
        assert_eq!(stored["observedBreaksCompleted"], 0);
    }

    #[test]
    fn new_records_round_trip_partial_minutes_and_session_outcomes() {
        let mut record = DailyRecord::default();
        record.deep_work_minutes = 8;
        record.tracked_focus_seconds = 119;
        record.observed_breaks_completed = 2;
        record.observed_exercises_skipped = 1;
        record.work_sessions_delayed = 1;
        let stored = serde_json::to_string(&record).unwrap();
        let loaded: DailyRecord = serde_json::from_str(&stored).unwrap();
        assert_eq!(loaded.deep_work_minutes, 8);
        assert_eq!(loaded.tracked_focus_seconds, 119);
        assert_eq!(loaded.observed_breaks_completed, 2);
        assert_eq!(loaded.observed_exercises_skipped, 1);
        assert_eq!(loaded.work_sessions_delayed, 1);
    }
}
