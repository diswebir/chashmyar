import { create } from "zustand";
import {
  PENALTY_EVENT,
  SNAPSHOT_EVENT,
  call,
  fetchAnalytics,
  getSnapshot,
  subscribe,
} from "../lib/bridge";
import {
  DEFAULT_SETTINGS,
  EMPTY_ANALYTICS,
  type AnalyticsSummary,
  type AppSnapshot,
  type Language,
  type Settings,
  type Theme,
  type WidgetMode,
} from "../types";

type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

interface AppStore {
  snapshot: AppSnapshot;
  ready: boolean;
  analytics: AnalyticsSummary;
  analyticsLoading: boolean;

  boot: () => Promise<() => void>;
  refresh: () => Promise<void>;
  refreshAnalytics: () => Promise<void>;
  patchSettings: (patch: SettingsPatch) => Promise<void>;

  setKelvin: (kelvin: number) => Promise<void>;
  setBrightness: (brightness: number) => Promise<void>;
  setEyeEnabled: (enabled: boolean) => Promise<void>;
  applyProfile: (profile: Settings["eye"]["profile"]) => Promise<void>;

  setColorSafe: (enabled: boolean) => Promise<void>;
  addWhitelistEntry: (entry: string) => Promise<void>;
  removeWhitelistEntry: (entry: string) => Promise<void>;
  resetWhitelistDefaults: () => Promise<void>;

  timer: (action: "start" | "pause" | "resume" | "reset") => Promise<void>;
  /** Start / pause / resume in one call — never restarts a paused session. */
  toggleTimer: () => Promise<void>;
  startBreak: () => Promise<void>;
  endBreakEarly: () => Promise<void>;
  snooze: (minutes: number) => Promise<void>;
  dismissWarning: () => Promise<void>;
  emergencyUnlock: () => Promise<void>;
  dismissMicroBreak: () => Promise<void>;
  startMicroBreakNow: () => Promise<void>;

  setWidgetMode: (mode: WidgetMode) => Promise<void>;
  snapWidgetToEdge: () => Promise<void>;

  setAutostart: (enabled: boolean) => Promise<void>;
  resetAnalytics: () => Promise<void>;

  setTheme: (theme: Theme) => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
  setWidgetHoverDelay: (ms: number) => Promise<void>;
}

const empty: AppSnapshot = {
  revision: -1,
  settings: DEFAULT_SETTINGS,
  timer: {
    phase: "idle",
    running: false,
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
    gammaApplied: false,
    captureExcluded: false,
    effectiveKelvin: DEFAULT_SETTINGS.eye.kelvin,
    targetKelvin: DEFAULT_SETTINGS.eye.kelvin,
    effectiveBrightness: DEFAULT_SETTINGS.eye.brightness,
    scheduled: false,
    whitelisted: false,
    whitelistedApp: null,
  },
};

export const useAppStore = create<AppStore>((set, get) => {
  let analyticsSequence = 0;
  const acceptSnapshot = (snapshot: AppSnapshot) => {
    set((state) => snapshot.revision >= state.snapshot.revision
      ? { snapshot, ready: true }
      : { ready: true });
  };
  return {
  snapshot: empty,
  ready: false,
  analytics: EMPTY_ANALYTICS,
  analyticsLoading: false,

  boot: async () => {
    const unlisten = await subscribe(acceptSnapshot);
    const id = ++analyticsSequence;
    const [snapshot, analytics] = await Promise.all([getSnapshot(), fetchAnalytics()]);
    acceptSnapshot(snapshot);
    if (id === analyticsSequence) set({ analytics });
    return unlisten;
  },

  refresh: async () => acceptSnapshot(await getSnapshot()),

  refreshAnalytics: async () => {
    const id = ++analyticsSequence;
    set({ analyticsLoading: true });
    const analytics = await fetchAnalytics();
    if (id === analyticsSequence) set({ analytics, analyticsLoading: false });
  },

  patchSettings: async (patch) => {
    const snapshot = await call<AppSnapshot>("patch_settings", { patch });
    acceptSnapshot(snapshot);
  },

  setKelvin: async (kelvin) => acceptSnapshot(await call<AppSnapshot>("set_kelvin", { kelvin })),
  setBrightness: async (brightness) => acceptSnapshot(await call<AppSnapshot>("set_brightness", { brightness })),
  setEyeEnabled: async (enabled) => acceptSnapshot(await call<AppSnapshot>("set_eye_enabled", { enabled })),
  applyProfile: async (profile) => acceptSnapshot(await call<AppSnapshot>("apply_profile", { profile })),

  setColorSafe: async (enabled) => acceptSnapshot(await call<AppSnapshot>("set_color_safe", { enabled })),
  addWhitelistEntry: async (entry) => acceptSnapshot(await call<AppSnapshot>("whitelist_add", { entry })),
  removeWhitelistEntry: async (entry) => acceptSnapshot(await call<AppSnapshot>("whitelist_remove", { entry })),
  resetWhitelistDefaults: async () => acceptSnapshot(await call<AppSnapshot>("whitelist_reset_defaults")),

  timer: async (action) => {
    const snapshot = await call<AppSnapshot>(`timer_${action}`);
    acceptSnapshot(snapshot);
    if (action === "reset" || action === "start") void get().refreshAnalytics();
  },
  toggleTimer: async () => {
    const snapshot = await call<AppSnapshot>("timer_toggle");
    acceptSnapshot(snapshot);
    void get().refreshAnalytics();
  },

  startBreak: async () => {
    const snapshot = await call<AppSnapshot>("start_break_now");
    acceptSnapshot(snapshot);
  },

  endBreakEarly: async () => {
    const snapshot = await call<AppSnapshot>("end_break_early");
    acceptSnapshot(snapshot);
  },

  snooze: async (minutes) => acceptSnapshot(await call<AppSnapshot>("snooze", { minutes })),
  dismissWarning: async () => acceptSnapshot(await call<AppSnapshot>("dismiss_warning")),
  emergencyUnlock: async () => acceptSnapshot(await call<AppSnapshot>("emergency_unlock")),
  dismissMicroBreak: async () => acceptSnapshot(await call<AppSnapshot>("dismiss_micro_break")),
  startMicroBreakNow: async () => acceptSnapshot(await call<AppSnapshot>("start_micro_break_now")),

  setWidgetMode: async (mode) => acceptSnapshot(await call<AppSnapshot>("set_widget_mode", { mode })),
  snapWidgetToEdge: async () => acceptSnapshot(await call<AppSnapshot>("snap_widget_to_edge")),

  setAutostart: async (enabled) => acceptSnapshot(await call<AppSnapshot>("set_autostart", { enabled })),

  resetAnalytics: async () => {
    analyticsSequence += 1;
    await call("analytics_reset");
    await get().refreshAnalytics();
  },

  setTheme: async (theme) => get().patchSettings({ system: { theme } }),
  setLanguage: async (language) => get().patchSettings({ system: { language } }),
  setWidgetHoverDelay: async (widgetHoverDelayMs) => get().patchSettings({ system: { widgetHoverDelayMs } }),

  };
});

export { SNAPSHOT_EVENT, PENALTY_EVENT };
