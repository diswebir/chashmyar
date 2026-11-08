//! On-disk daily record, with defaults for fields missing from old versions.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DailyRecord {
    pub deep_work_minutes: u32,
    pub completed_breaks: u32,
    pub natural_breaks: u32,
    pub micro_breaks_completed: u32,
    pub snooze_used_count: u32,
    pub penalty_count: u32,
    pub emergency_skips: u32,
    /// New exact focus time, in addition to legacy whole-minute history.
    pub tracked_focus_seconds: u64,
    /// Complete/early outcomes recorded since v2.3 (legacy counts lack skips).
    pub observed_breaks_completed: u32,
    pub observed_breaks_skipped: u32,
    pub observed_exercises_completed: u32,
    pub observed_exercises_skipped: u32,
    pub work_sessions_on_time: u32,
    pub work_sessions_delayed: u32,
    pub work_sessions_ended_early: u32,
}

