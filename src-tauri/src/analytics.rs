//! Local activity analytics. Scores describe recorded timer outcomes only;
//! neither score is a diagnosis of eye health or a measure of work quality.
//! New outcome counters are separate from legacy history, which did not record
//! skipped opportunities and therefore cannot yield a trustworthy denominator.

use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate};
use serde::Serialize;
use parking_lot::Mutex;
use std::collections::BTreeMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const STORE_FILE: &str = "chashmyar.analytics.json";
const KEY: &str = "records";
// Atomic read-modify-write: the ticker, UI and focus guard can log at once.
static ANALYTICS_LOCK: Mutex<()> = Mutex::new(());
static ANALYTICS_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn epoch() -> u64 { ANALYTICS_EPOCH.load(std::sync::atomic::Ordering::Acquire) }

/* -------------------------------------------------------------------------- */
/*                                   Schema                                   */
/* -------------------------------------------------------------------------- */

pub use crate::analytics_record::DailyRecord;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayPoint {
    /// ISO date (`2026-11-07`).
    pub date: String,
    /// Jalali date without Persian digits (`1404/08/16`) — the UI converts.
    pub jalali_date: String,
    /// Persian weekday, `شنبه` … `جمعه`.
    pub weekday: String,
    pub deep_work_minutes: u32,
    pub completed_breaks: u32,
    pub natural_breaks: u32,
    pub micro_breaks_completed: u32,
    pub snooze_used_count: u32,
    pub penalty_count: u32,
    pub emergency_skips: u32,
    pub observed_breaks_completed: u32,
    pub observed_breaks_skipped: u32,
    pub observed_exercises_completed: u32,
    pub observed_exercises_skipped: u32,
    pub work_sessions_on_time: u32,
    pub work_sessions_delayed: u32,
    pub work_sessions_ended_early: u32,
    pub score: Option<u32>,
    pub regularity_score: Option<u32>,
    pub is_today: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub today: DayPoint,
    pub week: Vec<DayPoint>,
    pub week_deep_work_minutes: u32,
    pub week_snoozes: u32,
    pub week_penalties: u32,
    pub week_completed_breaks: u32,
    pub week_micro_breaks: u32,
    pub week_natural_breaks: u32,
    pub week_average_score: Option<u32>,
    pub week_regularity_score: Option<u32>,
    pub score_streak_days: u32,
    pub best_weekday: Option<String>,
}

/* -------------------------------------------------------------------------- */
/*                            Persistence helpers                             */
/* -------------------------------------------------------------------------- */

type Db = BTreeMap<String, DailyRecord>;

fn load_db(app: &AppHandle) -> Db {
    if let Ok(store) = app.store(STORE_FILE) {
        if let Some(value) = store.get(KEY) {
            if let Ok(db) = serde_json::from_value::<Db>(value) {
                return db;
            }
        }
    }
    Db::new()
}

fn save_db(app: &AppHandle, db: &Db) {
    if let Ok(store) = app.store(STORE_FILE) {
        if let Ok(value) = serde_json::to_value(db) {
            let _ = store.set(KEY, value);
            let _ = store.save();
        }
    }
}

fn key_for(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// Atomically mutates a calendar day's record; all callers share one lock.
pub fn bump_for_date(app: &AppHandle, date: &str, f: impl FnOnce(&mut DailyRecord)) {
    let _guard = ANALYTICS_LOCK.lock();
    let mut db = load_db(app);
    let entry = db.entry(date.to_string()).or_default();
    f(entry);
    while db.len() > 400 {
        if let Some(key) = db.keys().next().cloned() { db.remove(&key); } else { break; }
    }
    save_db(app, &db);
}

pub fn bump(app: &AppHandle, f: impl FnOnce(&mut DailyRecord)) {
    bump_for_date(app, &key_for(Local::now().date_naive()), f);
}

pub fn add_focus_seconds(app: &AppHandle, date: &str, seconds: u64, captured_epoch: u64) {
    if seconds == 0 { return; }
    let _guard = ANALYTICS_LOCK.lock();
    // A flush captured before reset must not resurrect erased history.
    if captured_epoch != epoch() { return; }
    let mut db = load_db(app);
    let entry = db.entry(date.to_string()).or_default();
    entry.tracked_focus_seconds = entry.tracked_focus_seconds.saturating_add(seconds);
    while db.len() > 400 {
        if let Some(key) = db.keys().next().cloned() { db.remove(&key); } else { break; }
    }
    save_db(app, &db);
}

pub fn record(app: &AppHandle) -> DailyRecord {
    let _guard = ANALYTICS_LOCK.lock();
    let today = Local::now().date_naive();
    load_db(app).get(&key_for(today)).cloned().unwrap_or_default()
}

/* -------------------------------------------------------------------------- */
/*                              Jalali calendar                               */
/* -------------------------------------------------------------------------- */

/// Gregorian → Jalali (standard `jalaali` algorithm, valid for 1900–2100).
pub fn gregorian_to_jalali(gy: i32, gm: i32, gd: i32) -> (i32, i32, i32) {
    let g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let mut jy = if gy > 1600 { 979 } else { 0 };
    let mut gy2 = if gy > 1600 { gy - 1600 } else { gy - 621 };

    let mut days = 365 * gy2 + (gy2 + 3) / 4 - (gy2 + 99) / 100 + (gy2 + 399) / 400 - 80
        + gd
        + g_d_m[(gm - 1) as usize];

    let leap = (gy % 4 == 0 && gy % 100 != 0) || gy % 400 == 0;
    if gm > 2 && leap {
        days += 1;
    }

    jy += 33 * (days / 12053);
    days %= 12053;
    jy += 4 * (days / 1461);
    days %= 1461;
    if days > 365 {
        jy += (days - 1) / 365;
        days = (days - 1) % 365;
    }

    let jm = if days < 186 { 1 + days / 31 } else { 7 + (days - 186) / 30 };
    let jd = 1 + if days < 186 { days % 31 } else { (days - 186) % 30 };
    gy2 = 0;
    let _ = gy2;
    (jy, jm, jd)
}

fn persian_weekday(date: NaiveDate) -> &'static str {
    match date.weekday() {
        chrono::Weekday::Sat => "شنبه",
        chrono::Weekday::Sun => "یکشنبه",
        chrono::Weekday::Mon => "دوشنبه",
        chrono::Weekday::Tue => "سه‌شنبه",
        chrono::Weekday::Wed => "چهارشنبه",
        chrono::Weekday::Thu => "پنجشنبه",
        chrono::Weekday::Fri => "جمعه",
    }
}

fn day_point(record: Option<&DailyRecord>, date: NaiveDate, today: NaiveDate) -> DayPoint {
    let r = record.cloned().unwrap_or_default();
    let (jy, jm, jd) = gregorian_to_jalali(
        date.year(),
        date.month() as i32,
        date.day() as i32,
    );
    DayPoint {
        date: key_for(date),
        jalali_date: format!("{jy:04}/{:02}/{:02}", jm, jd),
        weekday: persian_weekday(date).to_string(),
        deep_work_minutes: r.deep_work_minutes.saturating_add((r.tracked_focus_seconds / 60).min(u64::from(u32::MAX)) as u32),
        completed_breaks: r.completed_breaks,
        natural_breaks: r.natural_breaks,
        micro_breaks_completed: r.micro_breaks_completed,
        snooze_used_count: r.snooze_used_count,
        penalty_count: r.penalty_count,
        emergency_skips: r.emergency_skips,
        observed_breaks_completed: r.observed_breaks_completed,
        observed_breaks_skipped: r.observed_breaks_skipped,
        observed_exercises_completed: r.observed_exercises_completed,
        observed_exercises_skipped: r.observed_exercises_skipped,
        work_sessions_on_time: r.work_sessions_on_time,
        work_sessions_delayed: r.work_sessions_delayed,
        work_sessions_ended_early: r.work_sessions_ended_early,
        score: crate::score::eye_care_score(
            u64::from(r.observed_breaks_completed), u64::from(r.observed_breaks_skipped),
            u64::from(r.observed_exercises_completed), u64::from(r.observed_exercises_skipped)),
        regularity_score: crate::score::regularity_score(
            u64::from(r.work_sessions_on_time), u64::from(r.work_sessions_delayed),
            u64::from(r.work_sessions_ended_early)),
        is_today: date == today,
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Summary                                   */
/* -------------------------------------------------------------------------- */

pub fn summary(app: &AppHandle) -> AnalyticsSummary {
    let _guard = ANALYTICS_LOCK.lock();
    let db = load_db(app);
    let today = Local::now().date_naive();

    let mut week: Vec<DayPoint> = Vec::with_capacity(7);
    for offset in (0..7).rev() {
        let date = today - ChronoDuration::days(offset as i64);
        week.push(day_point(db.get(&key_for(date)), date, today));
    }

    let today_point = week.last().cloned().unwrap_or_else(|| day_point(None, today, today));

    let week_deep_work_minutes: u32 = week.iter().map(|d| d.deep_work_minutes).sum();
    let week_snoozes: u32 = week.iter().map(|d| d.snooze_used_count).sum();
    let week_penalties: u32 = week.iter().map(|d| d.penalty_count).sum();
    let week_completed_breaks: u32 = week.iter().map(|d| d.completed_breaks).sum();
    let week_micro_breaks: u32 = week.iter().map(|d| d.micro_breaks_completed).sum();
    let week_natural_breaks: u32 = week.iter().map(|d| d.natural_breaks).sum();

    // Weekly scores are computed over all observed outcomes, not the average
    // of arbitrary daily percentages; no-data days do not become 100 or 0.
    let sum = |f: fn(&DayPoint) -> u32| week.iter().map(|d| u64::from(f(d))).sum::<u64>();
    let week_average_score = crate::score::eye_care_score(
        sum(|d| d.observed_breaks_completed), sum(|d| d.observed_breaks_skipped),
        sum(|d| d.observed_exercises_completed), sum(|d| d.observed_exercises_skipped),
    );
    let week_regularity_score = crate::score::regularity_score(
        sum(|d| d.work_sessions_on_time), sum(|d| d.work_sessions_delayed),
        sum(|d| d.work_sessions_ended_early),
    );

    let mut score_streak_days = 0u32;
    for day in week.iter().rev() {
        if day.deep_work_minutes > 0 { score_streak_days += 1; } else { break; }
    }
    let best_weekday = week.iter().filter_map(|d| d.score.map(|score| (score, d)))
        .max_by_key(|(score, _)| *score).map(|(_, d)| d.weekday.clone());

    AnalyticsSummary {
        today: today_point,
        week,
        week_deep_work_minutes,
        week_snoozes,
        week_penalties,
        week_completed_breaks,
        week_micro_breaks,
        week_natural_breaks,
        week_average_score,
        week_regularity_score,
        score_streak_days,
        best_weekday,
    }
}

pub fn reset_all(app: &AppHandle, shared: &crate::engine::Shared) {
    let _guard = ANALYTICS_LOCK.lock();
    {
        // Invalidate captured partial minutes atomically with their source.
        // No other analytics writer acquires the runtime lock while writing.
        let mut rt = shared.lock();
        rt.focus_seconds = 0;
        ANALYTICS_EPOCH.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
    }
    // Disk I/O happens after releasing the runtime mutex.
    save_db(app, &Db::new());
}
