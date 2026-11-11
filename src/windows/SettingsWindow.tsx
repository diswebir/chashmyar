import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  ArrowUpToLine,
  BarChart3,
  Coffee,
  Eye,
  Footprints,
  Globe,
  Heart,
  Hourglass,
  Info,
  Languages,
  LayoutDashboard,
  Lock,
  Monitor,
  Moon,
  Pause,
  Palette,
  Pin,
  Play,
  Power,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Timer as TimerIcon,
  Zap,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  ClockInput,
  Credits,
  NumericInput,
  DragStepper,
  GlassCard,
  RingProgress,
  SectionHeading,
  Segmented,
  Slider,
  Toggle,
} from "../components/ui";
import { formatClock, formatMinutes, nowClock, toLocalDigits, toPersianPercent } from "../lib/persian";
import { EYE_PROFILES, type EyeProfileId, type Language, type Theme } from "../types";
import { call } from "../lib/bridge";
import { t } from "../lib/i18n";
import AnalyticsTab from "../components/AnalyticsTab";
import { EyeExerciseCanvas, STRETCHES, StretchIllustration } from "../components/exercises";
import brandMark from "../../src-tauri/icons/128x128.png";

import { version as APP_VERSION } from "../../package.json";

type TabId = "dashboard" | "eye" | "timer" | "lock" | "analytics" | "system" | "about";

const TABS: { id: TabId; title: string; subtitle: string; icon: React.ReactNode }[] = [
  { id: "dashboard", title: "داشبورد", subtitle: "نمای کلی وضعیت", icon: <LayoutDashboard size={16} /> },
  { id: "eye", title: "محافظ چشم", subtitle: "دما و روشنایی", icon: <Eye size={16} /> },
  { id: "timer", title: "پومودورو و تعویق", subtitle: "زمان‌بندی و سقف تعویق", icon: <TimerIcon size={16} /> },
  { id: "lock", title: "قفل صفحه و ورزش‌ها", subtitle: "سخت‌گیری و تمرین‌ها", icon: <Lock size={16} /> },
  { id: "analytics", title: "گزارش سلامت و تمرکز", subtitle: "تحلیل هفت‌روزه", icon: <BarChart3 size={16} /> },
  { id: "system", title: "سیستم", subtitle: "استارت‌آپ و صدا", icon: <Monitor size={16} /> },
  { id: "about", title: "درباره", subtitle: "سازنده و نسخه", icon: <Info size={16} /> },
];

function SystemClock() {
  const [time, setTime] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setTime(Date.now());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(timer);
  }, []);
  return <span className="digits" dir="ltr" data-testid="system-clock">{nowClock(new Date(time))}</span>;
}

export default function SettingsWindow() {
  const snapshot = useAppStore((s) => s.snapshot);
  const patchSettings = useAppStore((s) => s.patchSettings);
  const setKelvin = useAppStore((s) => s.setKelvin);
  const setBrightness = useAppStore((s) => s.setBrightness);
  const setEyeEnabled = useAppStore((s) => s.setEyeEnabled);
  const applyProfile = useAppStore((s) => s.applyProfile);
  const runTimer = useAppStore((s) => s.timer);
  const toggleTimer = useAppStore((s) => s.toggleTimer);
  const startBreak = useAppStore((s) => s.startBreak);
  const setAutostart = useAppStore((s) => s.setAutostart);
  const setColorSafe = useAppStore((s) => s.setColorSafe);
  const addWhitelistEntry = useAppStore((s) => s.addWhitelistEntry);
  const removeWhitelistEntry = useAppStore((s) => s.removeWhitelistEntry);
  const resetWhitelistDefaults = useAppStore((s) => s.resetWhitelistDefaults);
  const setWidgetMode = useAppStore((s) => s.setWidgetMode);
  const snapWidgetToEdge = useAppStore((s) => s.snapWidgetToEdge);
  const startMicroBreakNow = useAppStore((s) => s.startMicroBreakNow);
  const setTheme = useAppStore((s) => s.setTheme);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setWidgetHoverDelay = useAppStore((s) => s.setWidgetHoverDelay);

  const [tab, setTab] = useState<TabId>("dashboard");
  const [newEntry, setNewEntry] = useState("");
  const { settings, timer, eye } = snapshot;

  const phaseTitle = useMemo(() => {
    switch (timer.phase) {
      case "work":
        return timer.paused ? t("در حال توقف موقت") : t("در حال تمرکز");
      case "break":
        return t("استراحت کوتاه");
      case "longBreak":
        return t("استراحت طولانی");
      default:
        return t("آماده شروع");
    }
  }, [timer.phase, timer.paused, settings.system.language]);

  const progress = timer.totalSeconds > 0 ? 1 - timer.remainingSeconds / timer.totalSeconds : 0;
  const onBreak = timer.phase === "break" || timer.phase === "longBreak";

  return (
    <div
      className="app-shell flex h-full flex-col"
      dir={settings.system.language === "en" ? "ltr" : "rtl"}
    >
      {/* ------------------------------- header ------------------------------- */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-3.5">
        <div className="flex items-center gap-3">
          <img
            src={brandMark}
            alt=""
            aria-hidden="true"
            data-testid="brand-logo"
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-2xl"
          />
          <div>
            <h1 className="text-[16px] font-bold tracking-tight text-slate-50">{t("چشم‌یار")}</h1>
            <p className="text-[11px] text-slate-500">
              {t("نگهبان چشم و تمرکز شما — نسخه {v}", { v: toLocalDigits(APP_VERSION) })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* theme */}
          <Segmented<Theme>
            size="sm"
            value={settings.system.theme}
            onChange={(v) => void setTheme(v)}
            options={[
              { value: "dark", label: t("تم تاریک"), icon: <Moon size={12} /> },
              { value: "light", label: t("تم روشن"), icon: <Sun size={12} /> },
            ]}
          />
          {/* language */}
          <Segmented<Language>
            size="sm"
            value={settings.system.language}
            onChange={(v) => void setLanguage(v)}
            options={[
              { value: "fa", label: "فارسی", icon: <Languages size={12} /> },
              { value: "en", label: "English", icon: <Globe size={12} /> },
            ]}
          />
          <button
            onClick={() => void setEyeEnabled(!settings.eye.enabled)}
            className={`rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
              settings.eye.enabled
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25"
                : "bg-slate-700/40 text-slate-300 ring-1 ring-white/10 hover:bg-slate-700/60"
            }`}
          >
            {settings.eye.enabled ? t("محافظ چشم فعال") : t("محافظ چشم غیرفعال")}
          </button>
        </div>
      </header>

      {/* status chips */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-6 py-2">
        <span className="chip">
          <Gauge />
          <span className="digits">{formatClock(timer.remainingSeconds)}</span>
        </span>
        <span className="chip">
          {settings.eye.enabled ? (
            <>
              <Sun size={12} className="text-amber-300" />
              <span className="digits">{toLocalDigits(eye.effectiveKelvin)}K</span>
            </>
          ) : (
            <>
              <Power size={12} className="text-slate-400" /> {t("محافظ خاموش")}
            </>
          )}
        </span>
        <span className="chip">
          <Moon size={12} className="text-sky-300" />
          <span className="digits">
            {toPersianPercent(eye.effectiveBrightness)} {t("روشنایی")}
          </span>
        </span>
        {eye.whitelisted ? (
          <span className="chip border-emerald-400/40 text-emerald-300">
            <Palette size={12} /> {t("رنگ‌ایمن:")} {eye.whitelistedApp ?? t("برنامه فعال")}
          </span>
        ) : null}
        {timer.idlePaused ? (
          <span className="chip border-amber-400/40 text-amber-300">
            <Hourglass size={12} />
            {t("توقف خودکار (غیبت {n} دقیقه)", { n: toLocalDigits(Math.round(timer.idleSeconds / 60)) })}
          </span>
        ) : null}
        {timer.microBreakActive ? (
          <span className="chip border-sky-400/40 text-sky-300">
            <Coffee size={12} /> {t("تمرین کوتاه در حال اجرا")}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------ sidebar ----------------------------- */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-white/[0.06] p-4">
          <nav className="space-y-1.5">
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-right transition ${
                    active ? "text-slate-50" : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
                  }`}
                >
                  {active ? (
                    <motion.span
                      layoutId="tab-active"
                      className="absolute inset-0 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.08]"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <span className={`relative ${active ? "text-emerald-300" : ""}`}>{item.icon}</span>
                  <span className="relative min-w-0">
                    <span className="block text-[13px] font-medium">{t(item.title)}</span>
                    <span className="block text-[10px] text-slate-500">{t(item.subtitle)}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <AlarmClock size={13} className="text-amber-300" /> {t("مرحله بعدی")}
            </div>
            <p className="text-[12px] leading-6 text-slate-300">
              {timer.phase === "work"
                ? t("استراحت {m} دقیقه‌ای در {left}", {
                    m: toLocalDigits(settings.timer.breakMinutes),
                    left: formatMinutes(timer.remainingSeconds),
                  })
                : t("با شروع تایمر، مرحله کاری جدید آغاز می‌شود.")}
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              {Array.from({ length: settings.timer.cyclesBeforeLongBreak }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < timer.cycleIndex - 1
                      ? "bg-emerald-400"
                      : i === timer.cycleIndex - 1 && timer.phase === "work"
                        ? "bg-emerald-400/40"
                        : "bg-slate-700"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 text-[11px] leading-6 text-slate-500">
            <div className="flex items-center justify-between text-slate-400">
              <span>{t("ساعت سیستم")}</span>
              <SystemClock />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-slate-400">
              <span>{t("منبع دما")}</span>
              <span className={eye.gammaSupported ? "text-emerald-300" : "text-amber-300"}>
                {eye.gammaSupported ? t("Gamma Ramp سخت‌افزاری") : t("لایه نرم‌افزاری جایگزین")}
              </span>
            </div>
          </div>

          <div className="mt-3">
            <Credits compact />
          </div>
        </aside>

        {/* ------------------------------ content ----------------------------- */}
        <main className="scroll-area min-w-0 flex-1 p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${tab}-${settings.system.language}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              {/* ============================ dashboard ========================= */}
              {tab === "dashboard" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <GlassCard glow className="flex items-center gap-6">
                      <RingProgress progress={progress} size={172} stroke={10}>
                        <div className="text-center">
                          <div className="digits text-3xl font-bold text-slate-50">
                            {formatClock(timer.remainingSeconds)}
                          </div>
                          <div className="mt-1 text-[11px] text-emerald-300">{phaseTitle}</div>
                        </div>
                      </RingProgress>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[15px] font-semibold text-slate-100">{phaseTitle}</h2>
                        <p className="mt-1 text-[12px] leading-6 text-slate-400">
                          {t("چرخه {a} از {b} — {c} جلسه کامل‌شده در این اجرا", {
                            a: toLocalDigits(timer.cycleIndex),
                            b: toLocalDigits(settings.timer.cyclesBeforeLongBreak),
                            c: toLocalDigits(timer.completedWorkSessions),
                          })}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {timer.paused ? (
                            <button
                              onClick={() => void toggleTimer()}
                              className="flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30 transition hover:bg-emerald-500/25"
                            >
                              <Play size={13} /> {t("ادامه")}
                            </button>
                          ) : timer.running ? (
                            <button
                              onClick={() => void toggleTimer()}
                              className="flex items-center gap-1.5 rounded-xl bg-amber-400/15 px-3 py-2 text-[12px] font-semibold text-amber-300 ring-1 ring-amber-400/30 transition hover:bg-amber-400/25"
                            >
                              <Pause size={13} /> {t("توقف موقت")}
                            </button>
                          ) : (
                            <button
                              onClick={() => void toggleTimer()}
                              className="flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30 transition hover:bg-emerald-500/25"
                            >
                              <Play size={13} /> {t("شروع تمرکز")}
                            </button>
                          )}

                          <button
                            onClick={() => void startBreak()}
                            disabled={onBreak}
                            className="flex items-center gap-1.5 rounded-xl bg-sky-500/15 px-3 py-2 text-[12px] font-semibold text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/25 disabled:opacity-40"
                          >
                            <Coffee size={13} /> {t("شروع استراحت")}
                          </button>

                          <button
                            onClick={() => void runTimer("reset")}
                            disabled={onBreak && settings.lock.strictLock}
                            className="flex items-center gap-1.5 rounded-xl bg-white/[0.05] px-3 py-2 text-[12px] font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RotateCcw size={13} /> {t("بازنشانی")}
                          </button>
                        </div>
                        {timer.paused ? <p className="mt-2 text-[10.5px] text-slate-500">
                          {t("تایمر متوقف شد؛ می‌توانید از همان‌جا ادامه دهید.")}
                        </p> : null}
                      </div>
                    </GlassCard>

                    <GlassCard>
                      <SectionHeading
                        title={t("محافظ چشم")}
                        subtitle={t("دمای رنگ سخت‌افزاری و کاهش روشنایی نرم‌افزاری")}
                        icon={<Sparkles size={16} />}
                      />
                      <div className="space-y-4">
                        <Slider
                          label={t("دمای رنگ")}
                          hint={t("هرچه کلوین کمتر باشد، رنگ نور گرم‌تر است")}
                          value={settings.eye.kelvin}
                          min={2700}
                          max={6500}
                          step={50}
                          format={(v) => `${toLocalDigits(v)}K`}
                          onChange={(v) => void setKelvin(v)}
                          from="#f97316"
                          to="#38bdf8"
                        />
                        <Slider
                          label={t("روشنایی نمایشگر")}
                          value={settings.eye.brightness}
                          min={10}
                          max={100}
                          step={1}
                          format={toPersianPercent}
                          onChange={(v) => void setBrightness(v)}
                          from="#475569"
                          to="#f8fafc"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          {(Object.keys(EYE_PROFILES) as EyeProfileId[]).map((id) => {
                            const p = EYE_PROFILES[id];
                            const active = settings.eye.profile === id;
                            return (
                              <button
                                key={id}
                                onClick={() => void applyProfile(id)}
                                className={`rounded-2xl border p-3 text-right transition ${
                                  active
                                    ? "border-emerald-400/40 bg-emerald-400/10"
                                    : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[12.5px] font-semibold text-slate-100">
                                    {t(p.title)}
                                  </span>
                                  <span className="digits text-[10px] text-slate-400">
                                    {toLocalDigits(p.kelvin)}K
                                  </span>
                                </div>
                                <p className="mt-1 text-[10.5px] leading-5 text-slate-500">
                                  {t(p.subtitle)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </GlassCard>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                    <StatCard
                      label={t("جلسه‌های این اجرا")}
                      value={t("{n} جلسه", { n: toLocalDigits(timer.completedWorkSessions) })}
                      icon={<Zap size={15} />}
                    />
                    <StatCard
                      label={t("تعویق‌های باقی‌مانده")}
                      value={t("{a} از {b}", {
                        a: toLocalDigits(Math.max(0, settings.timer.maxSnooze - timer.snoozeCount)),
                        b: toLocalDigits(settings.timer.maxSnooze),
                      })}
                      icon={<AlarmClock size={15} />}
                    />
                    <StatCard
                      label={t("وضعیت قفل")}
                      value={settings.lock.strictLock ? t("سخت‌گیرانه") : t("ساده")}
                      icon={<ShieldCheck size={15} />}
                    />
                  </div>

                  <GlassCard>
                    <SectionHeading
                      title={t("نکته‌های امروز")}
                      subtitle={t("سه عادت کوچک برای مراقبت از چشم‌ها")}
                      icon={<Heart size={16} />}
                    />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {[
                        { icon: <Eye size={15} />, text: t("بدون حرکت دادن سر، فقط با چشم‌ها دنبال کنید") },
                        { icon: <Footprints size={15} />, text: t("نفس آرام بکشید و شانه‌ها را رها کنید") },
                        { icon: <Sun size={15} />, text: t("به یک نقطه دور نگاه کنید") },
                      ].map((tip, i) => (
                        <div
                          key={i}
                          className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5"
                        >
                          <span className="mb-2 grid h-8 w-8 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
                            {tip.icon}
                          </span>
                          <p className="text-[12px] leading-6 text-slate-300">{tip.text}</p>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </div>
              )}

              {/* ============================== eye ============================= */}
              {tab === "eye" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <GlassCard>
                    <SectionHeading
                      title={t("دما و روشنایی")}
                      subtitle={t("تغییرات بلافاصله روی نمایشگر اعمال می‌شود")}
                      icon={<Eye size={16} />}
                    />
                    <div className="space-y-5">
                      <Slider
                        label={t("دمای رنگ (کلوین)")}
                        hint={t("۲۷۰۰ کلوین: شب گرم — ۶۵۰۰ کلوین: نور روز")}
                        value={settings.eye.kelvin}
                        min={2700}
                        max={6500}
                        step={50}
                        format={(v) => `${toLocalDigits(v)}K`}
                        onChange={(v) => void setKelvin(v)}
                        from="#f97316"
                        to="#38bdf8"
                      />
                      <Slider
                        label={t("روشنایی نرم‌افزاری")}
                        hint={t("کاهش روشنایی با لایه سیاه شفاف؛ حتی پایین‌تر از حد سخت‌افزار")}
                        value={settings.eye.brightness}
                        min={10}
                        max={100}
                        step={1}
                        format={toPersianPercent}
                        onChange={(v) => void setBrightness(v)}
                        from="#334155"
                        to="#e2e8f0"
                      />
                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] leading-6 text-slate-400">
                        {t("وضعیت موتور رنگ:")}{" "}
                        <b className={eye.gammaSupported ? "text-emerald-300" : "text-amber-300"}>
                          {eye.gammaSupported
                            ? t("درایور درخواست Gamma را پذیرفت؛ اعمال رنگ تضمین نمی‌شود")
                            : t("درایور GPU اجازه تغییر Gamma را نداد")}
                        </b>
                        {!eye.gammaSupported ? t("— لایه گرمای نرم‌افزاری فعال شد.") : ""}
                        <p className="mt-2" data-testid="capture-exclusion-status">
                          {eye.captureExcluded
                            ? t("لایه در روش‌های ضبط سازگار پنهان می‌شود؛ نتیجه را در ابزار ضبط خود بررسی کنید.")
                            : t("پنهان‌سازی لایه از ضبط در این سیستم تأیید نشد؛ تصویر یا ویدئو ممکن است فیلتر را نشان دهد.")}
                        </p>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("پروفایل‌های آماده")}
                      subtitle={t("یک کلیک برای تنظیم کامل")}
                      icon={<Settings2 size={16} />}
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(Object.keys(EYE_PROFILES) as EyeProfileId[]).map((id) => {
                        const p = EYE_PROFILES[id];
                        const active = settings.eye.profile === id;
                        return (
                          <button
                            key={id}
                            onClick={() => void applyProfile(id)}
                            className={`rounded-2xl border p-3.5 text-right transition ${
                              active
                                ? "border-emerald-400/40 bg-emerald-400/10"
                                : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-slate-100">{t(p.title)}</span>
                              <span className="digits text-[10px] text-slate-400">
                                {toLocalDigits(p.kelvin)}K
                              </span>
                            </div>
                            <p className="mt-1 text-[10.5px] leading-5 text-slate-500">{t(p.subtitle)}</p>
                            <div className="mt-2 text-[10px] text-slate-500">
                              {t("روشنایی")} {toPersianPercent(p.brightness)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("زمان‌بندی خودکار شب")}
                      subtitle={t("در بازه مشخص‌شده، پروفایل گرم شبانه فعال می‌شود")}
                      icon={<Moon size={16} />}
                    />
                    <div className="space-y-3">
                      <Toggle
                        checked={settings.eye.scheduleEnabled}
                        onChange={(v) =>
                          void patchSettings({ eye: { scheduleEnabled: v } })
                        }
                        label={t("فعال‌سازی زمان‌بندی")}
                        description={t("خارج از بازه، تنظیمات دستی شما اعمال می‌شود")}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <label className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                          <span className="block text-[11px] text-slate-400">{t("شروع شب")}</span>
                          <ClockInput
                            value={settings.eye.scheduleStart}
                            label={t("شروع شب")}
                            onChange={(v) => void patchSettings({ eye: { scheduleStart: v } })}
                          />
                        </label>
                        <label className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                          <span className="block text-[11px] text-slate-400">{t("پایان شب")}</span>
                          <ClockInput
                            value={settings.eye.scheduleEnd}
                            label={t("پایان شب")}
                            onChange={(v) => void patchSettings({ eye: { scheduleEnd: v } })}
                          />
                        </label>
                      </div>
                      <Slider
                        label={t("کلوین شبانه")}
                        value={settings.eye.scheduleKelvin}
                        min={2700}
                        max={6500}
                        step={50}
                        format={(v) => `${toLocalDigits(v)}K`}
                        onChange={(v) =>
                          void patchSettings({ eye: { scheduleKelvin: v } })
                        }
                        from="#f97316"
                        to="#38bdf8"
                      />
                      <Slider
                        label={t("روشنایی شبانه")}
                        value={settings.eye.scheduleBrightness}
                        min={20}
                        max={100}
                        step={1}
                        format={toPersianPercent}
                        onChange={(v) =>
                          void patchSettings({ eye: { scheduleBrightness: v } })
                        }
                        from="#334155"
                        to="#e2e8f0"
                      />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("رنگ‌ایمن (Color-Safe)")}
                      subtitle={t("وقتی این برنامه‌ها فعال می‌شوند، فیلتر در ۲ ثانیه به ۶۵۰۰K محو می‌شود")}
                      icon={<Palette size={16} />}
                      action={
                        <button
                          onClick={() => void resetWhitelistDefaults()}
                          className="btn btn-ghost text-[11px]"
                        >
                          {t("پیش‌فرض")}
                        </button>
                      }
                    />
                    <div className="space-y-3">
                      <Toggle
                        checked={settings.eye.colorSafeEnabled}
                        onChange={(v) => void setColorSafe(v)}
                        label={t("فعال‌سازی لیست رنگ‌ایمن")}
                        description={t("برای طراحی گرافیک، کار با DevTools و بررسی رنگ CSS")}
                      />
                      <div className="flex gap-2">
                        <input
                          value={newEntry}
                          onChange={(e) => setNewEntry(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newEntry.trim()) {
                              void addWhitelistEntry(newEntry.trim());
                              setNewEntry("");
                            }
                          }}
                          placeholder={t("نام فرآیند یا کلیدواژه عنوان پنجره… (مثلاً Figma.exe)")}
                          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/40"
                        />
                        <button
                          onClick={() => {
                            if (newEntry.trim()) {
                              void addWhitelistEntry(newEntry.trim());
                              setNewEntry("");
                            }
                          }}
                          title={t("افزودن")}
                          className="btn btn-primary px-3"
                        >
                          {t("افزودن")}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {settings.eye.colorSafeWhitelist.length === 0 ? (
                          <span className="text-[11px] text-slate-500">
                            {t("لیست خالی است — همه برنامه‌ها فیلتر می‌شوند.")}
                          </span>
                        ) : (
                          settings.eye.colorSafeWhitelist.map((entry) => (
                            <span key={entry} className="chip">
                              <span dir="ltr">{entry}</span>
                              <button
                                onClick={() => void removeWhitelistEntry(entry)}
                                title={t("حذف")}
                                className="text-slate-500 transition hover:text-rose-300"
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] leading-6 text-slate-400">
                        {t("وضعیت لحظه‌ای:")}{" "}
                        {eye.whitelisted ? (
                          <b className="text-emerald-300">
                            {t("فیلتر موقتاً کنار رفته — {app}", { app: eye.whitelistedApp ?? "" })}
                          </b>
                        ) : (
                          <b className="text-slate-300">{t("فیلتر فعال روی کل سیستم")}</b>
                        )}
                        <span className="mx-1 text-slate-600">|</span>
                        {t("دما در LUT:")}
                        <b className="digits text-slate-200">{toLocalDigits(eye.effectiveKelvin)}K</b>
                        {eye.targetKelvin !== eye.effectiveKelvin ? (
                          <span className="text-amber-300">
                            {t("(در حال گذار به {k}K)", { k: toLocalDigits(eye.targetKelvin) })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </GlassCard>
                </div>
              )}

              {/* ============================= timer ============================ */}
              {tab === "timer" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <GlassCard>
                    <SectionHeading
                      title={t("طول مراحل")}
                      subtitle={t("زمان‌های پومودورو — با ماوس بکشید")}
                      icon={<TimerIcon size={16} />}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <DragStepper
                        label={t("مدت تمرکز")}
                        value={settings.timer.workMinutes}
                        min={5}
                        max={90}
                        step={1}
                        unit="دقیقه"
                        onChange={(v) => void patchSettings({ timer: { workMinutes: v } })}
                      />
                      <DragStepper
                        label={t("استراحت کوتاه")}
                        value={settings.timer.breakMinutes}
                        min={1}
                        max={30}
                        step={1}
                        unit="دقیقه"
                        accent="#38bdf8"
                        onChange={(v) => void patchSettings({ timer: { breakMinutes: v } })}
                      />
                      <DragStepper
                        label={t("استراحت طولانی")}
                        value={settings.timer.longBreakMinutes}
                        min={5}
                        max={60}
                        step={1}
                        unit="دقیقه"
                        accent="#a78bfa"
                        onChange={(v) =>
                          void patchSettings({ timer: { longBreakMinutes: v } })
                        }
                      />
                      <DragStepper
                        label={t("تعداد مراحل تا استراحت طولانی")}
                        value={settings.timer.cyclesBeforeLongBreak}
                        min={2}
                        max={8}
                        step={1}
                        unit="مرحله"
                        accent="#fbbf24"
                        onChange={(v) =>
                          void patchSettings({ timer: { cyclesBeforeLongBreak: v } })
                        }
                      />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("هشدار پیش از استراحت و تعویق")}
                      subtitle={t("سقف تعویق در هسته برنامه بررسی و اعمال می‌شود")}
                      icon={<AlarmClock size={16} />}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <DragStepper
                        label={t("زمان هشدار پیش از استراحت")}
                        value={settings.timer.preBreakAlertSeconds}
                        min={10}
                        max={120}
                        step={5}
                        unit="ثانیه"
                        accent="#fbbf24"
                        onChange={(v) =>
                          void patchSettings({ timer: { preBreakAlertSeconds: v } })
                        }
                      />
                      <DragStepper
                        label={t("حداکثر تعداد تعویق در هر مرحله")}
                        value={settings.timer.maxSnooze}
                        min={0}
                        max={5}
                        step={1}
                        unit="بار"
                        accent="#fb923c"
                        onChange={(v) => void patchSettings({ timer: { maxSnooze: v } })}
                      />
                    </div>
                    <div className="mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                      <div className="mb-2 text-[12px] font-medium text-slate-200">
                        {t("مقادیر دکمه‌های تعویق (دقیقه)")}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {settings.timer.snoozeOptions.map((minutes, index) => (
                          <label
                            key={index}
                            className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-center"
                          >
                            <span className="block text-[10px] text-slate-500">
                              {t("دکمه {i}", { i: toLocalDigits(index + 1) })}
                            </span>
                            <NumericInput
                              min={1} max={30} value={minutes}
                              label={t("دکمه {i}", { i: toLocalDigits(index + 1) })}
                              onChange={(v) => {
                                const next = [...settings.timer.snoozeOptions];
                                next[index] = v;
                                void patchSettings({ timer: { snoozeOptions: next } });
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <Toggle
                        checked={settings.timer.autoStartBreak}
                        onChange={(v) => void patchSettings({ timer: { autoStartBreak: v } })}
                        label={t("شروع خودکار استراحت")}
                        description={t("پس از پایان تمرکز، قفل صفحه بلافاصله فعال شود")}
                      />
                      <Toggle
                        checked={settings.timer.autoStartNextWork}
                        onChange={(v) =>
                          void patchSettings({ timer: { autoStartNextWork: v } })
                        }
                        label={t("شروع خودکار مرحله بعد")}
                        description={t("پس از پایان استراحت، تایمر بعدی خودکار شروع شود")}
                      />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("تشخیص غیبت (Idle)")}
                      subtitle={t("با Win32 GetLastInputInfo — تایمر وقتی پشت میز نیستید هدر نمی‌رود")}
                      icon={<Hourglass size={16} />}
                    />
                    <div className="space-y-3">
                      <Toggle
                        checked={settings.timer.idleDetectionEnabled}
                        onChange={(v) =>
                          void patchSettings({ timer: { idleDetectionEnabled: v } })
                        }
                        label={t("فعال‌سازی تشخیص غیبت")}
                        description={t("در صورت بازگشت به میز، تایمر به‌صورت خودکار ادامه می‌یابد")}
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DragStepper
                          label={t("توقف خودکار پس از غیبت")}
                          value={Math.round(settings.timer.idlePauseSeconds / 60)}
                          min={1}
                          max={15}
                          step={1}
                          unit="دقیقه"
                          hint={t("پیش‌فرض ۳ دقیقه")}
                          accent="#fbbf24"
                          onChange={(v) =>
                            void patchSettings({
                              timer: { idlePauseSeconds: v * 60 },
                            })
                          }
                        />
                        <DragStepper
                          label={t("ثبت استراحت طبیعی پس از غیبت")}
                          value={Math.round(settings.timer.idleResetSeconds / 60)}
                          min={2}
                          max={30}
                          step={1}
                          unit="دقیقه"
                          hint={t("غیبت طولانی‌تر از این مقدار، یک استراحت کامل محسوب می‌شود")}
                          accent="#34d399"
                          onChange={(v) =>
                            void patchSettings({
                              timer: { idleResetSeconds: v * 60 },
                            })
                          }
                        />
                      </div>
                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] leading-6 text-slate-400">
                        {t("غیبت فعلی:")}
                        <b className="digits text-slate-200">
                          {toLocalDigits(timer.idleSeconds)} {t("ثانیه")}
                        </b>
                        {timer.idlePaused ? (
                          <span className="text-amber-300">
                            {t("— تایمر متوقف است و با اولین حرکت ماوس ادامه می‌یابد")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("تمرین کوتاه در حین کار")}
                      subtitle={t("کارت شناور {n} ثانیه‌ای — بدون قفل کردن کیبورد و ماوس", {
                        n: toLocalDigits(settings.timer.microBreakSeconds),
                      })}
                      icon={<Coffee size={16} />}
                      action={
                        <button
                          onClick={() => void startMicroBreakNow()}
                          className="btn btn-primary text-[11px]"
                        >
                          {t("نمایش آزمایشی")}
                        </button>
                      }
                    />
                    <div className="space-y-3">
                      <Toggle
                        checked={settings.timer.microBreakEnabled}
                        onChange={(v) =>
                          void patchSettings({ timer: { microBreakEnabled: v } })
                        }
                        label={t("فعال‌سازی تمرین کوتاه در حین کار")}
                        description={t("یادآوری منظم برای نگاه به فاصله ۶ متری و پلک زدن")}
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <DragStepper
                          label={t("فاصله تکرار")}
                          value={settings.timer.microBreakIntervalMinutes}
                          min={5}
                          max={60}
                          step={5}
                          unit="دقیقه"
                          accent="#38bdf8"
                          onChange={(v) =>
                            void patchSettings({
                              timer: { microBreakIntervalMinutes: v },
                            })
                          }
                        />
                        <DragStepper
                          label={t("مدت تمرین کوتاه")}
                          value={settings.timer.microBreakSeconds}
                          min={10}
                          max={30}
                          step={5}
                          unit="ثانیه"
                          accent="#22d3ee"
                          onChange={(v) =>
                            void patchSettings({ timer: { microBreakSeconds: v } })
                          }
                        />
                        <DragStepper
                          label={t("حداقل زمان باقی‌مانده تا استراحت کامل")}
                          value={Math.round(settings.timer.microBreakMinRemainingSeconds / 60)}
                          min={0}
                          max={10}
                          step={1}
                          unit="دقیقه"
                          hint={t("اگر استراحت کامل نزدیک‌تر از این مقدار باشد، تمرین کوتاه اجرا نمی‌شود")}
                          accent="#a78bfa"
                          onChange={(v) =>
                            void patchSettings({
                              timer: { microBreakMinRemainingSeconds: v * 60 },
                            })
                          }
                        />
                      </div>
                    </div>
                  </GlassCard>
                </div>
              )}

              {/* ============================== lock ============================ */}
              {tab === "lock" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <GlassCard>
                    <SectionHeading
                      title={t("قفل صفحه استراحت")}
                      subtitle={t("پنجره تمام‌صفحه شیشه‌ای با قلاب کیبورد سطح پایین")}
                      icon={<Lock size={16} />}
                    />
                    <div className="space-y-2">
                      <Toggle
                        checked={settings.lock.strictLock}
                        onChange={(v) => void patchSettings({ lock: { strictLock: v } })}
                        label={t("حالت سخت‌گیرانه")}
                        description={t(
                          "مسدودسازی Alt+Tab، Alt+F4، کلید ویندوز و Ctrl+Shift+Esc در طول استراحت",
                        )}
                      />
                      <Toggle
                        checked={settings.lock.emergencyUnlock}
                        onChange={(v) =>
                          void patchSettings({ lock: { emergencyUnlock: v } })
                        }
                        label={t("خروج اضطراری (Ctrl + Shift)")}
                        description={t("نگه داشتن کلیدها برای مدت تعیین‌شده، مستقل از زبان صفحه‌کلید")}
                      />
                      <DragStepper
                        label={t("مدت نگه داشتن کلید خروج اضطراری")}
                        value={settings.lock.emergencyHoldSeconds}
                        min={2}
                        max={10}
                        step={1}
                        unit="ثانیه"
                        accent="#fb7185"
                        onChange={(v) =>
                          void patchSettings({ lock: { emergencyHoldSeconds: v } })
                        }
                      />
                      <Toggle
                        checked={settings.lock.eyeExercises}
                        onChange={(v) =>
                          void patchSettings({ lock: { eyeExercises: v } })
                        }
                        label={t("تمرین‌های چشم")}
                        description={t("حرکت آرام چشم‌ها و نگاه به دوردست")}
                      />
                      <Toggle
                        checked={settings.lock.bodyExercises}
                        onChange={(v) =>
                          void patchSettings({ lock: { bodyExercises: v } })
                        }
                        label={t("تمرین‌های ایستاده بدن")}
                        description={t("حرکت‌های ملایم گردن، مچ، شانه و پهلو")}
                      />
                      <DragStepper
                        label={t("فاصله نمایش تمرین بعدی")}
                        value={settings.lock.rotateSeconds}
                        min={10}
                        max={120}
                        step={5}
                        unit="ثانیه"
                        accent="#a78bfa"
                        onChange={(v) =>
                          void patchSettings({ lock: { rotateSeconds: v } })
                        }
                      />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("جریمه تلاش برای خروج از صفحه استراحت")}
                      subtitle={t(
                        "اگر پنجره قفل مینیمایز شود یا فوکوس از دست برود، زمان استراحت افزایش می‌یابد",
                      )}
                      icon={<ShieldCheck size={16} />}
                    />
                    <div className="space-y-3">
                      <Toggle
                        checked={settings.lock.focusPenaltyEnabled}
                        onChange={(v) =>
                          void patchSettings({ lock: { focusPenaltyEnabled: v } })
                        }
                        label={t("جریمه تلاش برای خروج از صفحه استراحت")}
                        description={t("Ctrl+Alt+Del قابل بلاک نیست، پس جریمه اعمال می‌شود")}
                      />
                      <DragStepper
                        label={t("مقدار جریمه هر بار خروج")}
                        value={settings.lock.focusPenaltySeconds}
                        min={5}
                        max={120}
                        step={5}
                        unit="ثانیه"
                        accent="#f43f5e"
                        onChange={(v) =>
                          void patchSettings({ lock: { focusPenaltySeconds: v } })
                        }
                      />
                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] leading-6 text-slate-400">
                        {t("جریمه‌های این استراحت:")}{" "}
                        <b className="digits text-rose-300">
                          {toLocalDigits(timer.penaltiesThisBreak)}
                        </b>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="xl:col-span-2">
                    <SectionHeading
                      title={t("پیش‌نمایش تمرین‌ها")}
                      subtitle={t("همان کارت‌هایی که در صفحه قفل می‌بینید")}
                      icon={<Sparkles size={16} />}
                    />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="mb-2 text-[12px] font-semibold text-slate-200">
                          {t("تمرین‌های چشم")}
                        </p>
                        <EyeExerciseCanvas mode="infinity" />
                      </div>
                      {STRETCHES.slice(0, 2).map((stretch) => (
                        <div
                          key={stretch.id}
                          className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                        >
                          <p className="mb-2 text-[12px] font-semibold text-slate-200">
                            {t(stretch.title)}
                          </p>
                          <StretchIllustration id={stretch.id} />
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </div>
              )}

              {/* ============================ analytics ========================= */}
              {tab === "analytics" && <AnalyticsTab />}

              {/* ============================= system =========================== */}
              {tab === "system" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <GlassCard>
                    <SectionHeading
                      title={t("اجرای خودکار و استارت‌آپ")}
                      subtitle={t("ثبت در HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run")}
                      icon={<Power size={16} />}
                    />
                    <div className="space-y-2">
                      <Toggle
                        checked={settings.system.autostart}
                        onChange={(v) => void setAutostart(v)}
                        label={t("اجرای خودکار هنگام بالا آمدن ویندوز")}
                        description={t("چشم‌یار در پس‌زمینه و بدون پنجره باز می‌شود")}
                      />
                      <Toggle
                        checked={settings.system.autoStartTimerOnLaunch}
                        onChange={(v) =>
                          void patchSettings({
                            system: { autoStartTimerOnLaunch: v },
                          })
                        }
                        label={t("شروع خودکار تایمر در استارت‌آپ")}
                        description={t("اولین مرحله تمرکز بلافاصله آغاز می‌شود")}
                      />
                      <Toggle
                        checked={settings.system.eyeCareOnLaunch}
                        onChange={(v) =>
                          void patchSettings({ system: { eyeCareOnLaunch: v } })
                        }
                        label={t("فعال بودن محافظ چشم در استارت‌آپ")}
                        description={t("دما و روشنایی ذخیره‌شده به‌صورت خودکار اعمال می‌شود")}
                      />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("صدا و رفتار پنجره")}
                      icon={<Coffee size={16} />}
                    />
                    <div className="space-y-2">
                      <Toggle
                        checked={settings.system.soundEnabled}
                        onChange={(v) =>
                          void patchSettings({ system: { soundEnabled: v } })
                        }
                        label={t("پخش صدای هشدار")}
                        description={t("صدای اعلان، تمرین کوتاه، استراحت و جریمه؛ در نصب تازه خاموش است")}
                      />
                      <Toggle
                        checked={settings.system.minimizeToTray}
                        onChange={(v) =>
                          void patchSettings({ system: { minimizeToTray: v } })
                        }
                        label={t("کوچک شدن به سینی سیستم")}
                        description={t("بستن پنجره تنظیمات، برنامه را در سینی نگه می‌دارد")}
                      />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading
                      title={t("ویجت پیشرفت")}
                      subtitle={t("نوار باریک چسبیده به لبه بالا یا کپسول شناور قابل جابه‌جایی")}
                      icon={<Pin size={16} />}
                    />
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => void setWidgetMode("docked")}
                          className={`rounded-2xl border p-3 text-right transition ${
                            settings.system.widgetMode === "docked"
                              ? "border-emerald-400/40 bg-emerald-400/10"
                              : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                          }`}
                        >
                          <span className="text-[12.5px] font-semibold text-slate-100">
                            {t("چسبیده به لبه بالا")}
                          </span>
                          <p className="mt-1 text-[10.5px] leading-5 text-slate-500">
                            {t("پیش‌فرض (لبه بالا)")}
                          </p>
                        </button>
                        <button
                          onClick={() => void setWidgetMode("floating")}
                          className={`rounded-2xl border p-3 text-right transition ${
                            settings.system.widgetMode === "floating"
                              ? "border-emerald-400/40 bg-emerald-400/10"
                              : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                          }`}
                        >
                          <span className="text-[12.5px] font-semibold text-slate-100">
                            {t("ویجت شناور")}
                          </span>
                          <p className="mt-1 text-[10.5px] leading-5 text-slate-500">
                            {t("کپسول شناور که می‌توانید آن را در صفحه جابه‌جا کنید")}
                          </p>
                        </button>
                      </div>

                      <Slider
                        label={t("تأخیر باز شدن ویجت")}
                        hint={t("مدت مکث ماوس روی نوار بالا پیش از باز شدن ویجت")}
                        value={settings.system.widgetHoverDelayMs}
                        min={0}
                        max={1200}
                        step={50}
                        format={(v) => `${toLocalDigits(v)} ${t("میلی‌ثانیه")}`}
                        onChange={(v) => void setWidgetHoverDelay(v)}
                        from="#34d399"
                        to="#22d3ee"
                      />

                      <button
                        onClick={() => void snapWidgetToEdge()}
                        className="btn w-full justify-center"
                      >
                        <ArrowUpToLine size={13} />
                        {t("بازگرداندن ویجت به لبه بالای صفحه")}
                      </button>
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading title={t("اقدامات")} icon={<Settings2 size={16} />} />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => void call("show_window", { label: "snooze-alert" })}
                        className="btn justify-center text-[12px]"
                      >
                        {t("نمایش هشدار ۳۰ ثانیه‌ای")}
                      </button>
                      <button
                        onClick={() => void call("show_window", { label: "break-lock" })}
                        className="btn justify-center text-[12px]"
                      >
                        {t("پیش‌نمایش صفحه قفل")}
                      </button>
                      <button
                        onClick={() => void call("reset_gamma")}
                        className="btn justify-center text-[12px]"
                      >
                        {t("بازگرداندن گاما و خاموش کردن فیلتر")}
                      </button>
                      <button
                        onClick={() => void call("open_log_folder")}
                        className="btn justify-center text-[12px]"
                      >
                        {t("پوشه لاگ و گزارش خطا")}
                      </button>
                      <button
                        onClick={() => void call("quit_app")}
                        className="col-span-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-[12px] text-rose-200 transition hover:bg-rose-500/20"
                      >
                        {t("خروج امن از چشم‌یار")}
                      </button>
                    </div>
                    <p className="mt-3 text-[10.5px] leading-6 text-slate-500">
                      {t("اگر برنامه رفتار غیرمنتظره داشت، فایل")}
                      <span dir="ltr" className="mx-1 font-vazir text-slate-400">
                        %LOCALAPPDATA%\ChashmYar\startup.log
                      </span>
                      {t("را بفرستید. برای تست سلامت سیستم‌عامل (گاما، قلاب کیبورد، WebView2) فایل اجرایی را با")}
                      <span dir="ltr" className="mx-1 font-vazir text-slate-400">
                        --self-test
                      </span>
                      {t("اجرا کنید.")}
                    </p>
                  </GlassCard>
                </div>
              )}

              {/* ============================== about =========================== */}
              {tab === "about" && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                  <GlassCard>
                    <SectionHeading
                      title={t("درباره چشم‌یار")}
                      subtitle={t("نگهبان چشم و تمرکز شما — نسخه {v}", { v: toLocalDigits(APP_VERSION) })}
                      icon={<Info size={16} />}
                    />
                    <div className="space-y-3 text-[12px] leading-7 text-slate-300">
                      <p>
                        {t(
                          "چشم‌یار دمای رنگ نمایشگر را تنظیم می‌کند و با زمان‌بندی کار، تمرین کوتاه در حین کار و حرکت‌های کششی به مراقبت از چشم و بدن کمک می‌کند.",
                        )}
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                        <div className="panel-soft px-3 py-2">
                          <span className="text-slate-500">{t("نسخه")}</span>
                          <b className="digits mr-2 text-slate-200">{toLocalDigits(APP_VERSION)}</b>
                        </div>
                        <div className="panel-soft px-3 py-2">
                          <span className="text-slate-500">{t("زبان")}</span>
                          <b className="mr-2 text-slate-200">
                            {settings.system.language === "en" ? "English" : "فارسی"}
                          </b>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <Credits />
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <SectionHeading title={t("ظاهر برنامه")} icon={<Palette size={16} />} />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => void setTheme("light")}
                        className={`rounded-2xl border p-3.5 text-right transition ${
                          settings.system.theme === "light"
                            ? "border-emerald-400/40 bg-emerald-400/10"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-100">
                          <Sun size={14} className="text-amber-300" /> {t("تم روشن")}
                        </span>
                        <p className="mt-1 text-[10.5px] leading-5 text-slate-500">
                          {t("روشن و تمیز برای محیط‌های پرنور")}
                        </p>
                      </button>
                      <button
                        onClick={() => void setTheme("dark")}
                        className={`rounded-2xl border p-3.5 text-right transition ${
                          settings.system.theme === "dark"
                            ? "border-emerald-400/40 bg-emerald-400/10"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-100">
                          <Moon size={14} className="text-sky-300" /> {t("تم تاریک")}
                        </span>
                        <p className="mt-1 text-[10.5px] leading-5 text-slate-500">
                          {t("تیره و ملایم برای شب و کار طولانی")}
                        </p>
                      </button>
                    </div>
                    <p className="mt-4 mb-2 text-[12px] font-medium text-slate-200">{t("زبان")}</p>
                    <Segmented<Language>
                      value={settings.system.language}
                      onChange={(v) => void setLanguage(v)}
                      options={[
                        { value: "fa", label: "فارسی", icon: <Languages size={12} /> },
                        { value: "en", label: "English", icon: <Globe size={12} /> },
                      ]}
                    />
                    <p className="mt-2 text-[10.5px] leading-6 text-slate-500">
                      {t("تغییر زبان کل برنامه")}
                    </p>
                  </GlassCard>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
        {icon}
      </span>
      <div>
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className="digits mt-0.5 text-[14px] font-semibold text-slate-100">{value}</p>
      </div>
    </div>
  );
}

/* Local gauge icon — avoids importing the whole lucide icon for one glyph. */
function Gauge() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" className="text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 14 16 9" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );
}
