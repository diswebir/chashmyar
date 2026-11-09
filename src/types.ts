/* ============================================================================
 * ChashmYar v2 — shared TypeScript contracts (mirrors Rust serde camelCase)
 * ==========================================================================*/

export type TimerPhase = "idle" | "work" | "break" | "longBreak";
export type EyeProfileId = "reading" | "nightCoding" | "daylight" | "custom";
export type WidgetMode = "docked" | "floating";
export type Theme = "dark" | "light";
export type Language = "fa" | "en";

export interface EyeSettings {
  enabled: boolean;
  kelvin: number;
  brightness: number;
  profile: EyeProfileId;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleKelvin: number;
  scheduleBrightness: number;
  /** v2 — colour-safe whitelist */
  colorSafeEnabled: boolean;
  colorSafeWhitelist: string[];
  transitionMs: number;
}

export interface TimerSettings {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  preBreakAlertSeconds: number;
  snoozeOptions: number[];
  maxSnooze: number;
  autoStartBreak: boolean;
  autoStartNextWork: boolean;
  /** v2 — idle detection */
  idleDetectionEnabled: boolean;
  idlePauseSeconds: number;
  idleResetSeconds: number;
  /** v2 — 20-20-20 micro breaks */
  microBreakEnabled: boolean;
  microBreakIntervalMinutes: number;
  microBreakSeconds: number;
  microBreakMinRemainingSeconds: number;
}

export interface LockSettings {
  strictLock: boolean;
  emergencyUnlock: boolean;
  emergencyHoldSeconds: number;
  eyeExercises: boolean;
  bodyExercises: boolean;
  rotateSeconds: number;
  /** v2 — focus penalty */
  focusPenaltyEnabled: boolean;
  focusPenaltySeconds: number;
}

export interface SystemSettings {
  autostart: boolean;
  autoStartTimerOnLaunch: boolean;
  eyeCareOnLaunch: boolean;
  soundEnabled: boolean;
  minimizeToTray: boolean;
  /** v2 — micro widget placement */
  widgetMode: WidgetMode;
  widgetX: number;
  widgetY: number;
  widgetPositionSet: boolean;
  /** v2.1 — appearance */
  theme: Theme;
  language: Language;
  /** v2.1 — hover-intent delay of the docked strip (ms) */
  widgetHoverDelayMs: number;
}

export interface Settings {
  eye: EyeSettings;
  timer: TimerSettings;
  lock: LockSettings;
  system: SystemSettings;
}

export interface TimerState {
  phase: TimerPhase;
  running: boolean;
  paused: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  cycleIndex: number;
  completedWorkSessions: number;
  snoozeCount: number;
  warningVisible: boolean;
  /** v2 */
  idlePaused: boolean;
  idleSeconds: number;
  microBreakActive: boolean;
  microBreakRemaining: number;
  microBreakTotal: number;
  penaltyPulse: number;
  penaltiesThisBreak: number;
  /** 0..1 — native Ctrl+Shift hold progress on the break screen */
  emergencyHoldProgress: number;
}

export interface EyeInfo {
  gammaSupported: boolean;
  gammaApplied: boolean;
  /** Best-effort OS capture exclusion; not a guarantee for every recorder. */
  captureExcluded: boolean;
  /** interpolated value currently in the GPU LUT */
  effectiveKelvin: number;
  targetKelvin: number;
  effectiveBrightness: number;
  scheduled: boolean;
  whitelisted: boolean;
  whitelistedApp: string | null;
}

export interface AppSnapshot {
  revision: number;
  settings: Settings;
  timer: TimerState;
  eye: EyeInfo;
}

/* ------------------------------- analytics -------------------------------- */

export interface DayPoint {
  date: string;
  jalaliDate: string;
  weekday: string;
  deepWorkMinutes: number;
  completedBreaks: number;
  naturalBreaks: number;
  microBreaksCompleted: number;
  snoozeUsedCount: number;
  penaltyCount: number;
  emergencySkips: number;
  observedBreaksCompleted: number;
  observedBreaksSkipped: number;
  observedExercisesCompleted: number;
  observedExercisesSkipped: number;
  workSessionsOnTime: number;
  workSessionsDelayed: number;
  workSessionsEndedEarly: number;
  score: number | null;
  regularityScore: number | null;
  isToday: boolean;
}

export interface AnalyticsSummary {
  today: DayPoint;
  week: DayPoint[];
  weekDeepWorkMinutes: number;
  weekSnoozes: number;
  weekPenalties: number;
  weekCompletedBreaks: number;
  weekMicroBreaks: number;
  weekNaturalBreaks: number;
  weekAverageScore: number | null;
  weekRegularityScore: number | null;
  scoreStreakDays: number;
  bestWeekday: string | null;
}

export interface PenaltyPayload {
  seconds: number;
  totalPenalties: number;
  remainingSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  eye: {
    enabled: true,
    kelvin: 4200,
    brightness: 100,
    profile: "custom",
    scheduleEnabled: true,
    scheduleStart: "19:30",
    scheduleEnd: "07:00",
    scheduleKelvin: 3000,
    scheduleBrightness: 82,
    colorSafeEnabled: true,
    colorSafeWhitelist: ["Figma.exe", "Photoshop.exe", "Illustrator.exe", "DevTools", "Inspect"],
    transitionMs: 2000,
  },
  timer: {
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    preBreakAlertSeconds: 30,
    snoozeOptions: [3, 5, 8],
    maxSnooze: 3,
    autoStartBreak: true,
    autoStartNextWork: true,
    idleDetectionEnabled: true,
    idlePauseSeconds: 180,
    idleResetSeconds: 300,
    microBreakEnabled: true,
    microBreakIntervalMinutes: 20,
    microBreakSeconds: 20,
    microBreakMinRemainingSeconds: 180,
  },
  lock: {
    strictLock: true,
    emergencyUnlock: true,
    emergencyHoldSeconds: 5,
    eyeExercises: true,
    bodyExercises: true,
    rotateSeconds: 20,
    focusPenaltyEnabled: true,
    focusPenaltySeconds: 30,
  },
  system: {
    autostart: true,
    autoStartTimerOnLaunch: true,
    eyeCareOnLaunch: true,
    soundEnabled: true,
    minimizeToTray: true,
    widgetMode: "docked",
    widgetX: 0,
    widgetY: 0,
    widgetPositionSet: false,
    theme: "light",
    language: "fa",
    widgetHoverDelayMs: 300,
  },
};

export const EYE_PROFILES: Record<
  EyeProfileId,
  { title: string; subtitle: string; kelvin: number; brightness: number }
> = {
  reading: { title: "مطالعه", subtitle: "گرمای ملایم برای متن و کتاب", kelvin: 3900, brightness: 88 },
  nightCoding: { title: "برنامه‌نویسی شبانه", subtitle: "کم‌ترین فشار روی چشم در تاریکی", kelvin: 3000, brightness: 72 },
  daylight: { title: "روز", subtitle: "رنگ سفید طبیعی و تمرکز بالا", kelvin: 6500, brightness: 100 },
  custom: { title: "سفارشی", subtitle: "تنظیم دستی دما و روشنایی", kelvin: 4200, brightness: 90 },
};

export const EMPTY_DAY: DayPoint = {
  date: "",
  jalaliDate: "",
  weekday: "",
  deepWorkMinutes: 0,
  completedBreaks: 0,
  naturalBreaks: 0,
  microBreaksCompleted: 0,
  snoozeUsedCount: 0,
  penaltyCount: 0,
  emergencySkips: 0,
  observedBreaksCompleted: 0,
  observedBreaksSkipped: 0,
  observedExercisesCompleted: 0,
  observedExercisesSkipped: 0,
  workSessionsOnTime: 0,
  workSessionsDelayed: 0,
  workSessionsEndedEarly: 0,
  score: null,
  regularityScore: null,
  isToday: true,
};

export const EMPTY_ANALYTICS: AnalyticsSummary = {
  today: EMPTY_DAY,
  week: [],
  weekDeepWorkMinutes: 0,
  weekSnoozes: 0,
  weekPenalties: 0,
  weekCompletedBreaks: 0,
  weekMicroBreaks: 0,
  weekNaturalBreaks: 0,
  weekAverageScore: null,
  weekRegularityScore: null,
  scoreStreakDays: 0,
  bestWeekday: null,
};
