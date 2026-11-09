/* ============================================================================
 * ChashmYar IPC bridge (v2)
 * ----------------------------------------------------------------------------
 * In a Tauri webview every call goes straight to the Rust core through
 * `invoke`. Inside a plain browser (UI development / in-app preview) a fully
 * functional in-memory mock implements the very same command surface — the
 * timer really ticks. Analytics starts empty, just as on a fresh installation.
 * ==========================================================================*/

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  DEFAULT_SETTINGS,
  EMPTY_ANALYTICS,
  type AnalyticsSummary,
  type AppSnapshot,
  type DayPoint,
  type PenaltyPayload,
  type Settings,
} from "../types";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

export function windowLabel(): string {
  if (IS_TAURI) return getCurrentWebviewWindow().label;
  const q = new URLSearchParams(window.location.search).get("win");
  return q ?? "main";
}

export const SNAPSHOT_EVENT = "app://snapshot";
export const PENALTY_EVENT = "break-penalty-applied";

type Listener = (snapshot: AppSnapshot) => void;

/* -------------------------------------------------------------------------- */
/*                         Browser mock implementation                        */
/* -------------------------------------------------------------------------- */

const MOCK_KEY = "chashmyar.mock.snapshot";
const MOCK_ANALYTICS_KEY = "chashmyar.mock.analytics";

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

interface MockDailyRecord {
  deepWorkMinutes: number;
  completedBreaks: number;
  naturalBreaks: number;
  microBreaksCompleted: number;
  snoozeUsedCount: number;
  penaltyCount: number;
  emergencySkips: number;
  trackedFocusSeconds: number;
  observedBreaksCompleted: number;
  observedBreaksSkipped: number;
  observedExercisesCompleted: number;
  observedExercisesSkipped: number;
  workSessionsOnTime: number;
  workSessionsDelayed: number;
  workSessionsEndedEarly: number;
}

function mockInitial(): AppSnapshot {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppSnapshot;
      return {
        revision: 0,
        settings: {
          eye: { ...DEFAULT_SETTINGS.eye, ...parsed.settings?.eye },
          timer: { ...DEFAULT_SETTINGS.timer, ...parsed.settings?.timer },
          lock: { ...DEFAULT_SETTINGS.lock, ...parsed.settings?.lock },
          system: { ...DEFAULT_SETTINGS.system, ...parsed.settings?.system },
        },
        timer: { ...parsed.timer, running: false, paused: false, idlePaused: false },
        eye: parsed.eye,
      };
    }
  } catch {
    /* ignore corrupted storage */
  }
  return {
    revision: 0,
    settings: DEFAULT_SETTINGS,
    timer: {
      // Like a fresh native launch, honour the opt-in startup default. A
      // seeded snapshot remains independently controllable for UI testing.
      phase: DEFAULT_SETTINGS.system.autoStartTimerOnLaunch ? "work" : "idle",
      running: DEFAULT_SETTINGS.system.autoStartTimerOnLaunch,
      paused: false,
      remainingSeconds: DEFAULT_SETTINGS.timer.workMinutes * 60,
      totalSeconds: DEFAULT_SETTINGS.timer.workMinutes * 60,
      cycleIndex: 1,
      completedWorkSessions: 0,
      snoozeCount: 0,
      warningVisible: false,
      idlePaused: false,
      idleSeconds: 0,
      microBreakActive: false,
      microBreakRemaining: 0,
      microBreakTotal: DEFAULT_SETTINGS.timer.microBreakSeconds,
      penaltyPulse: 0,
      penaltiesThisBreak: 0,
      emergencyHoldProgress: 0,
    },
    eye: {
      gammaSupported: true,
      gammaApplied: true,
      // A browser preview has no native display-affinity control.
      captureExcluded: false,
      effectiveKelvin: DEFAULT_SETTINGS.eye.kelvin,
      targetKelvin: DEFAULT_SETTINGS.eye.kelvin,
      effectiveBrightness: DEFAULT_SETTINGS.eye.brightness,
      scheduled: false,
      whitelisted: false,
      whitelistedApp: null,
    },
  };
}

let mock: AppSnapshot = mockInitial();
const mockListeners = new Set<Listener>();
const penaltyListeners = new Set<(p: PenaltyPayload) => void>();
let mockTicker: number | null = null;

function persistMock() {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(mock));
  } catch {
    /* storage may be unavailable inside sandboxed iframes */
  }
}

function emitMock() {
  mock.revision += 1;
  persistMock();
  mockListeners.forEach((l) => l(structuredClone(mock)));
}

function mockEmitPenalty(payload: PenaltyPayload) {
  penaltyListeners.forEach((l) => l(payload));
}

/* ----------------------------- mock analytics ----------------------------- */

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = 979;
  const gy2 = gy - 1600;
  let days =
    365 * gy2 + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + gDays[gm - 1];
  if (gm > 2 && ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0)) days += 1;
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

const FA_WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

function weekdayFa(d: Date): string {
  return FA_WEEKDAYS[d.getDay()] ?? "شنبه";
}

function emptyMockRecord(): MockDailyRecord {
  return {
    deepWorkMinutes: 0, completedBreaks: 0, naturalBreaks: 0,
    microBreaksCompleted: 0, snoozeUsedCount: 0, penaltyCount: 0, emergencySkips: 0,
    trackedFocusSeconds: 0, observedBreaksCompleted: 0, observedBreaksSkipped: 0,
    observedExercisesCompleted: 0, observedExercisesSkipped: 0,
    workSessionsOnTime: 0, workSessionsDelayed: 0, workSessionsEndedEarly: 0,
  };
}

function loadMockAnalytics(): Record<string, MockDailyRecord> {
  try {
    const raw = localStorage.getItem(MOCK_ANALYTICS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, MockDailyRecord>;
  } catch { /* ignore damaged storage */ }
  return {};
}

function saveMockAnalytics(db: Record<string, MockDailyRecord>) {
  try { localStorage.setItem(MOCK_ANALYTICS_KEY, JSON.stringify(db)); } catch { /* unavailable */ }
}

function bumpMockAnalytics(f: (r: MockDailyRecord) => void, key = isoDate(new Date())) {
  const db = loadMockAnalytics();
  const record = { ...emptyMockRecord(), ...db[key] };
  f(record);
  db[key] = record;
  saveMockAnalytics(db);
}

function percent(completed: number, skipped: number): number | null {
  return completed + skipped > 0 ? Math.round(100 * completed / (completed + skipped)) : null;
}

function dayPointOf(key: string, date: Date, record?: MockDailyRecord): DayPoint {
  // Older saved mock records have none of the new denominator fields.
  const r = { ...emptyMockRecord(), ...record };
  const [jy, jm, jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return {
    date: key,
    jalaliDate: `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`,
    weekday: weekdayFa(date),
    deepWorkMinutes: r.deepWorkMinutes + Math.floor(r.trackedFocusSeconds / 60),
    completedBreaks: r.completedBreaks,
    naturalBreaks: r.naturalBreaks,
    microBreaksCompleted: r.microBreaksCompleted,
    snoozeUsedCount: r.snoozeUsedCount,
    penaltyCount: r.penaltyCount,
    emergencySkips: r.emergencySkips,
    observedBreaksCompleted: r.observedBreaksCompleted,
    observedBreaksSkipped: r.observedBreaksSkipped,
    observedExercisesCompleted: r.observedExercisesCompleted,
    observedExercisesSkipped: r.observedExercisesSkipped,
    workSessionsOnTime: r.workSessionsOnTime,
    workSessionsDelayed: r.workSessionsDelayed,
    workSessionsEndedEarly: r.workSessionsEndedEarly,
    score: percent(r.observedBreaksCompleted + r.observedExercisesCompleted, r.observedBreaksSkipped + r.observedExercisesSkipped),
    regularityScore: percent(r.workSessionsOnTime, r.workSessionsDelayed + r.workSessionsEndedEarly),
    isToday: isoDate(new Date()) === key,
  };
}

function mockAnalytics(): AnalyticsSummary {
  const db = loadMockAnalytics();
  const week: DayPoint[] = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86400000);
    const key = isoDate(day);
    week.push(dayPointOf(key, day, db[key]));
  }
  const sum = (f: (d: DayPoint) => number) => week.reduce((acc, d) => acc + f(d), 0);
  const scoredDays = week.filter((d) => d.score !== null);
  let streak = 0;
  for (let i = week.length - 1; i >= 0; i -= 1) {
    if (week[i].deepWorkMinutes > 0) streak += 1;
    else break;
  }
  const best = scoredDays.length
    ? scoredDays.reduce((a, b) => ((b.score ?? -1) >= (a.score ?? -1) ? b : a)).weekday
    : null;

  return {
    today: week[week.length - 1],
    week,
    weekDeepWorkMinutes: sum((d) => d.deepWorkMinutes),
    weekSnoozes: sum((d) => d.snoozeUsedCount),
    weekPenalties: sum((d) => d.penaltyCount),
    weekCompletedBreaks: sum((d) => d.completedBreaks),
    weekMicroBreaks: sum((d) => d.microBreaksCompleted),
    weekNaturalBreaks: sum((d) => d.naturalBreaks),
    weekAverageScore: percent(
      sum((d) => d.observedBreaksCompleted + d.observedExercisesCompleted),
      sum((d) => d.observedBreaksSkipped + d.observedExercisesSkipped)),
    weekRegularityScore: percent(
      sum((d) => d.workSessionsOnTime),
      sum((d) => d.workSessionsDelayed + d.workSessionsEndedEarly)),
    scoreStreakDays: streak,
    bestWeekday: best,
  };
}

/* -------------------------------- mock ticker ----------------------------- */

let mockFocusSeconds = 0;
let mockFocusDate = isoDate(new Date());
let mockSessionElapsed = 0;
let mockMicroElapsed = 0;
let mockMicroPreview = false;

function flushMockFocus() {
  if (mockFocusSeconds > 0) {
    const seconds = mockFocusSeconds;
    mockFocusSeconds = 0;
    bumpMockAnalytics((r) => { r.trackedFocusSeconds += seconds; }, mockFocusDate);
  }
}

function mockStartTicker() {
  if (mockTicker !== null) return;
  mockTicker = window.setInterval(() => {
    const t = mock.timer;
    const today = isoDate(new Date());
    if (today !== mockFocusDate) { flushMockFocus(); mockFocusDate = today; }
    const microWasActive = t.microBreakActive;
    /* short exercise countdown */
    if (t.microBreakActive) {
      t.microBreakRemaining = Math.max(0, t.microBreakRemaining - 1);
      if (t.microBreakRemaining === 0) {
        t.microBreakActive = false;
        if (!mockMicroPreview) bumpMockAnalytics((r) => {
          r.microBreaksCompleted += 1;
          r.observedExercisesCompleted += 1;
        });
        mockMicroPreview = false;
      }
      emitMock();
    }
    if (!t.running || t.paused) return;

    if (t.phase === "work" || t.phase === "break" || t.phase === "longBreak") {
      t.remainingSeconds = Math.max(0, t.remainingSeconds - 1);

      if (t.phase === "work") {
        mockSessionElapsed += 1;
        if (!microWasActive) {
          mockFocusSeconds += 1;
          if (mockFocusSeconds >= 60) flushMockFocus();
        }
        mockMicroElapsed += 1;
        if (mock.settings.timer.microBreakEnabled && !t.microBreakActive &&
          mockMicroElapsed >= mock.settings.timer.microBreakIntervalMinutes * 60 &&
          t.remainingSeconds > mock.settings.timer.microBreakMinRemainingSeconds) {
          mockMicroPreview = false;
          t.microBreakActive = true;
          t.microBreakTotal = Math.max(5, mock.settings.timer.microBreakSeconds);
          t.microBreakRemaining = t.microBreakTotal;
          mockMicroElapsed = 0;
        }
      }

      if (t.phase === "work" && t.remainingSeconds === mock.settings.timer.preBreakAlertSeconds) {
        t.warningVisible = true;
      }

      if (t.phase === "work" && t.remainingSeconds === 0) {
        const long = t.cycleIndex >= mock.settings.timer.cyclesBeforeLongBreak;
        const minutes = long ? mock.settings.timer.longBreakMinutes : mock.settings.timer.breakMinutes;
        flushMockFocus();
        bumpMockAnalytics((r) => {
          if (t.snoozeCount > 0) r.workSessionsDelayed += 1;
          else r.workSessionsOnTime += 1;
        });
        mockSessionElapsed = 0;
        mockMicroElapsed = 0;
        t.microBreakActive = false;
        mockMicroPreview = false;
        t.phase = long ? "longBreak" : "break";
        t.totalSeconds = minutes * 60;
        t.remainingSeconds = t.totalSeconds;
        t.warningVisible = false;
        t.snoozeCount = 0;
        t.completedWorkSessions += 1;
        t.penaltiesThisBreak = 0;
        if (!mock.settings.timer.autoStartBreak) t.running = false;
      } else if (t.phase !== "work" && t.remainingSeconds === 0) {
        bumpMockAnalytics((r) => {
          r.completedBreaks += 1;
          r.observedBreaksCompleted += 1;
        });
        t.phase = "work";
        t.cycleIndex = (t.cycleIndex % mock.settings.timer.cyclesBeforeLongBreak) + 1;
        t.totalSeconds = mock.settings.timer.workMinutes * 60;
        t.remainingSeconds = t.totalSeconds;
        if (!mock.settings.timer.autoStartNextWork) t.running = false;
      }
      emitMock();
    }
  }, 1000);
}

function mockApplyPatch(patch: DeepPartial<Settings>) {
  mock.settings = {
    eye: { ...mock.settings.eye, ...(patch.eye ?? {}) },
    timer: { ...mock.settings.timer, ...(patch.timer ?? {}) },
    lock: { ...mock.settings.lock, ...(patch.lock ?? {}) },
    system: { ...mock.settings.system, ...(patch.system ?? {}) },
  };
  if (mock.settings.eye.enabled) {
    mock.eye = {
      ...mock.eye,
      gammaApplied: true,
      effectiveKelvin: mock.settings.eye.kelvin,
      targetKelvin: mock.settings.eye.kelvin,
      effectiveBrightness: mock.settings.eye.brightness,
    };
  } else {
    mock.eye = { ...mock.eye, gammaApplied: false, effectiveKelvin: 6500, targetKelvin: 6500, effectiveBrightness: 100 };
  }
}

async function mockCommand<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const t = mock.timer;
  switch (name) {
    case "get_snapshot":
      return structuredClone(mock) as T;
    case "patch_settings": {
      mockApplyPatch(args?.patch as DeepPartial<Settings>);
      if (t.phase === "idle" || (t.phase === "work" && !t.running && !t.paused)) {
        t.totalSeconds = mock.settings.timer.workMinutes * 60;
        t.remainingSeconds = t.totalSeconds;
      }
      emitMock();
      return structuredClone(mock) as T;
    }
    case "update_settings": {
      mock.settings = args?.settings as Settings;
      mockApplyPatch({});
      emitMock();
      return structuredClone(mock) as T;
    }
    case "set_kelvin":
      mockApplyPatch({ eye: { kelvin: args?.kelvin as number } });
      emitMock();
      return structuredClone(mock) as T;
    case "set_brightness":
      mockApplyPatch({ eye: { brightness: args?.brightness as number } });
      emitMock();
      return structuredClone(mock) as T;
    case "set_eye_enabled":
      mockApplyPatch({ eye: { enabled: args?.enabled as boolean } });
      emitMock();
      return structuredClone(mock) as T;
    case "apply_profile": {
      const profile = args?.profile as Settings["eye"]["profile"];
      const presets: Record<string, [number, number]> = { reading: [3900, 88], nightCoding: [3000, 72], daylight: [6500, 100] };
      const [kelvin, brightness] = presets[profile] ?? [mock.settings.eye.kelvin, mock.settings.eye.brightness];
      mockApplyPatch({ eye: { profile, kelvin, brightness, enabled: true } });
      emitMock();
      return structuredClone(mock) as T;
    }
    case "set_color_safe":
      mockApplyPatch({ eye: { colorSafeEnabled: args?.enabled as boolean } });
      emitMock();
      return structuredClone(mock) as T;
    case "whitelist_add": {
      const entry = String(args?.entry ?? "").trim();
      if (entry && !mock.settings.eye.colorSafeWhitelist.includes(entry)) {
        mockApplyPatch({ eye: { colorSafeWhitelist: [...mock.settings.eye.colorSafeWhitelist, entry] } });
      }
      emitMock();
      return structuredClone(mock) as T;
    }
    case "whitelist_remove":
      mockApplyPatch({
        eye: {
          colorSafeWhitelist: mock.settings.eye.colorSafeWhitelist.filter(
            (e) => e.toLowerCase() !== String(args?.entry ?? "").toLowerCase(),
          ),
        },
      });
      emitMock();
      return structuredClone(mock) as T;
    case "whitelist_reset_defaults":
      mockApplyPatch({ eye: { colorSafeWhitelist: DEFAULT_SETTINGS.eye.colorSafeWhitelist } });
      emitMock();
      return structuredClone(mock) as T;
    case "timer_start":
      if (t.phase === "break" || t.phase === "longBreak") return structuredClone(mock) as T;
      flushMockFocus();
      if (t.phase === "work" && mockSessionElapsed > 0) bumpMockAnalytics((r) => { r.workSessionsEndedEarly += 1; });
      if (t.microBreakActive && !mockMicroPreview) bumpMockAnalytics((r) => { r.observedExercisesSkipped += 1; });
      mockSessionElapsed = 0;
      mockMicroElapsed = 0;
      mockMicroPreview = false;
      t.phase = "work";
      t.running = true;
      t.paused = false;
      t.idlePaused = false;
      t.totalSeconds = mock.settings.timer.workMinutes * 60;
      t.remainingSeconds = t.totalSeconds;
      t.snoozeCount = 0;
      t.warningVisible = false;
      t.microBreakActive = false;
      mockStartTicker();
      emitMock();
      return structuredClone(mock) as T;
    case "timer_pause":
      if (t.running) t.paused = true;
      emitMock();
      return structuredClone(mock) as T;
    case "timer_resume":
      t.paused = false;
      t.idlePaused = false;
      mockStartTicker();
      emitMock();
      return structuredClone(mock) as T;
    case "timer_toggle": {
      if (t.running && !t.paused) {
        t.paused = true;
      } else if (t.phase !== "idle" && t.remainingSeconds > 0) {
        t.running = true;
        t.paused = false;
        t.idlePaused = false;
        mockStartTicker();
      } else {
        t.phase = "work";
        t.running = true;
        t.paused = false;
        t.idlePaused = false;
        t.totalSeconds = mock.settings.timer.workMinutes * 60;
        t.remainingSeconds = t.totalSeconds;
        t.snoozeCount = 0;
        t.warningVisible = false;
        mockStartTicker();
      }
      emitMock();
      return structuredClone(mock) as T;
    }
    case "start_break_now": {
      if (t.phase !== "break" && t.phase !== "longBreak") {
        flushMockFocus();
        if (t.phase === "work" && mockSessionElapsed > 0) bumpMockAnalytics((r) => { r.workSessionsEndedEarly += 1; });
        mockSessionElapsed = 0;
        mockMicroElapsed = 0;
        mockMicroPreview = false;
        t.phase = "break";
        t.totalSeconds = mock.settings.timer.breakMinutes * 60;
        t.remainingSeconds = t.totalSeconds;
      }
      t.running = true;
      t.paused = false;
      t.idlePaused = false;
      t.warningVisible = false;
      t.microBreakActive = false;
      mockStartTicker();
      emitMock();
      return structuredClone(mock) as T;
    }
    case "end_break_early": {
      if ((t.phase !== "break" && t.phase !== "longBreak") || mock.settings.lock.strictLock) return structuredClone(mock) as T;
      bumpMockAnalytics((r) => { r.observedBreaksSkipped += 1; });
      t.phase = "work";
      t.totalSeconds = mock.settings.timer.workMinutes * 60;
      t.remainingSeconds = t.totalSeconds;
      t.running = false;
      t.paused = false;
      emitMock();
      return structuredClone(mock) as T;
    }
    case "timer_reset":
      if ((t.phase === "break" || t.phase === "longBreak") && mock.settings.lock.strictLock) return structuredClone(mock) as T;
      flushMockFocus();
      if (t.phase === "work" && mockSessionElapsed > 0) bumpMockAnalytics((r) => { r.workSessionsEndedEarly += 1; });
      if (t.phase === "break" || t.phase === "longBreak") bumpMockAnalytics((r) => { r.observedBreaksSkipped += 1; });
      if (t.microBreakActive && !mockMicroPreview) bumpMockAnalytics((r) => { r.observedExercisesSkipped += 1; });
      mockSessionElapsed = 0;
      mockMicroElapsed = 0;
      mockMicroPreview = false;
      t.phase = "idle";
      t.running = false;
      t.paused = false;
      t.idlePaused = false;
      t.remainingSeconds = mock.settings.timer.workMinutes * 60;
      t.totalSeconds = t.remainingSeconds;
      t.snoozeCount = 0;
      t.warningVisible = false;
      t.microBreakActive = false;
      emitMock();
      return structuredClone(mock) as T;
    case "snooze": {
      const minutes = (args?.minutes as number) ?? 3;
      if (t.phase === "work" && t.warningVisible && t.snoozeCount < mock.settings.timer.maxSnooze) {
        t.remainingSeconds += minutes * 60;
        t.totalSeconds += minutes * 60;
        t.snoozeCount += 1;
        t.warningVisible = false;
        bumpMockAnalytics((r) => {
          r.snoozeUsedCount += 1;
        });
        emitMock();
      }
      return structuredClone(mock) as T;
    }
    case "dismiss_warning":
      t.warningVisible = false;
      emitMock();
      return structuredClone(mock) as T;
    case "dismiss_micro_break":
      if (t.microBreakActive && !mockMicroPreview) bumpMockAnalytics((r) => { r.observedExercisesSkipped += 1; });
      mockMicroPreview = false;
      mockMicroElapsed = 0;
      t.microBreakActive = false;
      t.microBreakRemaining = 0;
      emitMock();
      return structuredClone(mock) as T;
    case "start_micro_break_now":
      if (!t.microBreakActive) {
        mockMicroPreview = true;
        t.microBreakActive = true;
        t.microBreakTotal = Math.max(5, mock.settings.timer.microBreakSeconds);
        t.microBreakRemaining = t.microBreakTotal;
      }
      mockStartTicker();
      emitMock();
      return structuredClone(mock) as T;
    case "emergency_unlock":
      if ((t.phase !== "break" && t.phase !== "longBreak") || !mock.settings.lock.emergencyUnlock) return structuredClone(mock) as T;
      bumpMockAnalytics((r) => {
        r.emergencySkips += 1;
        r.observedBreaksSkipped += 1;
      });
      t.phase = "work";
      t.microBreakActive = false;
      t.remainingSeconds = mock.settings.timer.workMinutes * 60;
      t.totalSeconds = t.remainingSeconds;
      t.running = true;
      t.paused = false;
      emitMock();
      return structuredClone(mock) as T;
    case "analytics_get":
      return mockAnalytics() as T;
    case "analytics_today":
      return mockAnalytics().today as T;
    case "analytics_reset":
      mockFocusSeconds = 0;
      saveMockAnalytics({});
      return {} as T;
    case "set_widget_mode":
      mockApplyPatch({ system: { widgetMode: args?.mode as Settings["system"]["widgetMode"] } });
      emitMock();
      return structuredClone(mock) as T;
    case "save_widget_position":
      mockApplyPatch({
        system: {
          widgetX: args?.x as number,
          widgetY: args?.y as number,
          widgetPositionSet: true,
        },
      });
      emitMock();
      return structuredClone(mock) as T;
    case "snap_widget_to_edge":
      mockApplyPatch({ system: { widgetMode: "docked", widgetPositionSet: false } });
      emitMock();
      return structuredClone(mock) as T;
    case "set_autostart":
      mockApplyPatch({ system: { autostart: Boolean(args?.enabled) } });
      emitMock();
      return structuredClone(mock) as T;
    case "open_creator_website":
      window.open("https://disweb.ir/", "_blank", "noopener,noreferrer");
      return {} as T;
    case "reset_gamma":
      mockApplyPatch({ eye: { enabled: false } });
      emitMock();
      return structuredClone(mock) as T;
    case "set_micro_expanded":
    case "quit_app":
    case "open_settings_window":
    case "open_main_window":
    case "show_window":
    case "hide_window":
      return {} as T;
    default:
      return {} as T;
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Public API                                 */
/* -------------------------------------------------------------------------- */

// Keep mutation order from a single webview even when users click or drag fast.
// Reads can run concurrently, and backend snapshot revisions suppress old replies.
let mutationQueue: Promise<void> = Promise.resolve();
const READ_COMMANDS = new Set(["get_snapshot", "analytics_get", "analytics_today"]);
export async function call<T = AppSnapshot>(name: string, args?: Record<string, unknown>): Promise<T> {
  const run = () => IS_TAURI ? invoke<T>(name, args) : mockCommand<T>(name, args);
  if (READ_COMMANDS.has(name)) return run();
  const pending = mutationQueue.then(run);
  mutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function getSnapshot(): Promise<AppSnapshot> {
  return call<AppSnapshot>("get_snapshot");
}

/** Subscribes to authoritative state pushes from the Rust core. */
export async function subscribe(cb: Listener): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<AppSnapshot>(SNAPSHOT_EVENT, (e) => cb(e.payload));
  }
  mockStartTicker();
  mockListeners.add(cb);
  window.setTimeout(() => cb(structuredClone(mock)), 0);
  return () => {
    mockListeners.delete(cb);
  };
}

/** Subscribes to the focus-penalty event emitted by the Rust focus guard. */
export async function onPenalty(cb: (p: PenaltyPayload) => void): Promise<UnlistenFn> {
  if (IS_TAURI) {
    return listen<PenaltyPayload>(PENALTY_EVENT, (e) => cb(e.payload));
  }
  penaltyListeners.add(cb);
  return () => {
    penaltyListeners.delete(cb);
  };
}

export async function fetchAnalytics(): Promise<AnalyticsSummary> {
  try {
    return await call<AnalyticsSummary>("analytics_get");
  } catch {
    return EMPTY_ANALYTICS;
  }
}

/** Drag helper for the floating micro widget; persists the dropped position. */
export async function beginWidgetDrag(): Promise<void> {
  if (!IS_TAURI) return;
  const win = getCurrentWebviewWindow();
  await win.startDragging();
}

/** Lightweight chime synthesis — no binary audio assets required. */
export function playChime(kind: "warning" | "break" | "complete" | "drop" | "penalty" = "warning") {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    if (kind === "drop") {
      // short water-drop: fast downward pitch sweep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const start = ctx.currentTime;
      osc.frequency.setValueAtTime(1250, start);
      osc.frequency.exponentialRampToValueAtTime(420, start + 0.22);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
      window.setTimeout(() => void ctx.close(), 1200);
      return;
    }

    const notes =
      kind === "warning"
        ? [880, 1174.66]
        : kind === "break"
          ? [523.25, 659.25, 783.99]
          : kind === "penalty"
            ? [392, 311.13]
            : [783.99, 1046.5];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    window.setTimeout(() => void ctx.close(), 1800);
  } catch {
    /* audio is optional */
  }
}
