import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, Clock3, Coffee, Eye, Info, RefreshCw, Timer, Trash2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { GlassCard, SectionHeading } from "./ui";
import { toPersianDigits, weekdayName, formatShortDate } from "../lib/persian";
import type { DayPoint } from "../types";
import { getLang, t } from "../lib/i18n";

function minutesText(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("{m} دقیقه", { m: toPersianDigits(m) });
  if (m === 0) return t("{h} ساعت", { h: toPersianDigits(h) });
  return t("{h} ساعت و {m} دقیقه", { h: toPersianDigits(h), m: toPersianDigits(m) });
}

function scoreText(score: number | null): string {
  return score === null ? "—" : t("{n}٪", { n: toPersianDigits(score) });
}

function scoreColor(score: number | null): string {
  if (score === null) return "#94a3b8";
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#f43f5e";
}

function Metric({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-[11.5px]">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">{icon}</span>
      </div>
      <div className="mt-2 text-[19px] font-bold text-slate-100">{value}</div>
      <div className="mt-1 text-[10.5px] leading-5 text-slate-500">{hint}</div>
    </div>
  );
}

function ScoreCard({ title, today, week, completed, total, description, icon, testId }: {
  title: string; today: number | null; week: number | null; completed: number; total: number; testId: string;
  description: string; icon: React.ReactNode;
}) {
  const color = scoreColor(today);
  return (
    <div className="panel-soft p-4 sm:p-5" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
            <span className="text-emerald-300">{icon}</span>{title}
          </div>
          <p className="mt-2 max-w-lg text-[11.5px] leading-6 text-slate-400">{description}</p>
        </div>
        <div className="shrink-0 text-center">
          <div className="digits text-[26px] font-bold" style={{ color }}>{scoreText(today)}</div>
          <div className="text-[10px] text-slate-500">{today === null ? t("بدون داده کافی") : t("امروز")}</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700/40" aria-hidden="true">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${today ?? 0}%`, background: color }} />
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-slate-400">
        <span>{t("امروز: {done} از {total} مورد ثبت‌شده", { done: toPersianDigits(completed), total: toPersianDigits(total) })}</span>
        <span>{t("امتیاز هفت روز: {score}", { score: scoreText(week) })}</span>
      </div>
    </div>
  );
}

/** Null days are deliberately left as gaps, not drawn as 0 or 100. */
function WeekChart({ week }: { week: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760, height = 270, padTop = 18, padBottom = 54, padRight = 55, padLeft = 16;
  const chartH = height - padTop - padBottom;
  const chartW = width - padLeft - padRight;
  const maxMinutes = Math.max(60, ...week.map((d) => d.deepWorkMinutes));
  const maxSnooze = Math.max(3, ...week.map((d) => d.snoozeUsedCount));
  const slot = chartW / Math.max(1, week.length);
  const xOf = (i: number) => padLeft + slot * i + slot / 2;
  const yScore = (value: number) => padTop + chartH - value / 100 * chartH;
  const scorePath = useMemo(() => {
    let previous = false;
    return week.map((d, i) => {
      if (d.score === null) { previous = false; return ""; }
      const path = `${previous ? "L" : "M"} ${xOf(i).toFixed(1)} ${yScore(d.score).toFixed(1)}`;
      previous = true;
      return path;
    }).join(" ");
    // Dimensions are constants and week is replaced whenever data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={t("نمودار هفت‌روزه زمان تایمر کاری و پایبندی به مراقبت چشم")}>
        <defs>
          <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="rgba(16,185,129,0.35)" /><stop offset="100%" stopColor="rgba(16,185,129,0.95)" /></linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => {
          const y = padTop + chartH - g * chartH;
          return <g key={g}><line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="rgba(148,163,184,0.14)" strokeDasharray="4 6" /><text x={width - padRight + 8} y={y + 3.5} fontSize="10" fill="var(--muted)">{toPersianDigits((g * maxMinutes / 60).toFixed(1))} {t("ساعت")}</text></g>;
        })}
        {week.map((d, i) => {
          const barW = slot * 0.32, snoozeW = slot * 0.15;
          const barH = d.deepWorkMinutes / maxMinutes * chartH;
          const snoozeH = d.snoozeUsedCount / maxSnooze * chartH * 0.45;
          return <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={padLeft + slot * i} y={padTop} width={slot} height={chartH} fill={hover === i ? "rgba(148,163,184,0.07)" : "transparent"} rx="8" />
            {barH > 0 && <rect x={xOf(i) - barW / 2} y={padTop + chartH - barH} width={barW} height={barH} rx="6" fill="url(#barGrad)" />}
            {snoozeH > 0 && <rect x={xOf(i) - barW / 2 - snoozeW - 5} y={padTop + chartH - snoozeH} width={snoozeW} height={snoozeH} rx="3" fill="#f59e0b" />}
          </g>;
        })}
        <path d={scorePath} fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        {week.map((d, i) => d.score === null ? null : <circle key={`pt-${d.date}`} cx={xOf(i)} cy={yScore(d.score)} r={hover === i ? 5.5 : 3.6} fill="var(--panel-solid)" stroke="#38bdf8" strokeWidth="2" pointerEvents="none" />)}
        <line x1={padLeft} x2={width - padRight} y1={padTop + chartH} y2={padTop + chartH} stroke="rgba(148,163,184,0.28)" />
        {week.map((d, i) => <g key={`lbl-${d.date}`}>
          <text x={xOf(i)} y={height - padBottom + 20} fontSize="11.5" textAnchor="middle" fill={d.isToday ? "var(--accent)" : "var(--muted)"} fontWeight={d.isToday ? 700 : 400}>{weekdayName(d.weekday)}</text>
          <text x={xOf(i)} y={height - padBottom + 36} fontSize="9.5" textAnchor="middle" fill="var(--muted)">{getLang() === "fa" ? toPersianDigits(d.jalaliDate) : formatShortDate(d.date)}</text>
        </g>)}
      </svg>
      {hover !== null && week[hover] && <div className="pointer-events-none absolute top-2 z-10 w-48 -translate-x-1/2 rounded-2xl border border-white/12 bg-ink-800 p-3 text-[11px] shadow-xl" style={{ left: `${Math.max(14, Math.min(86, xOf(hover) / width * 100))}%` }} dir={getLang() === "fa" ? "rtl" : "ltr"}>
        <div className="flex justify-between gap-2 font-semibold text-slate-100"><span>{weekdayName(week[hover].weekday)}</span><span>{scoreText(week[hover].score)}</span></div>
        <div className="mt-2 flex justify-between gap-2 text-slate-400"><span>{t("زمان تایمر کاری")}</span><span>{minutesText(week[hover].deepWorkMinutes)}</span></div>
        <div className="mt-1 flex justify-between gap-2 text-slate-400"><span>{t("تعویق")}</span><span>{t("{n} بار", { n: toPersianDigits(week[hover].snoozeUsedCount) })}</span></div>
      </div>}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[10.5px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />{t("زمان تایمر کاری")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-1.5 rounded-sm bg-amber-400" />{t("تعویق")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-sky-400" />{t("پایبندی به مراقبت چشم")}</span>
      </div>
    </div>
  );
}

export default function AnalyticsTab() {
  const analytics = useAppStore((s) => s.analytics);
  const refresh = useAppStore((s) => s.refreshAnalytics);
  const reset = useAppStore((s) => s.resetAnalytics);
  const timer = useAppStore((s) => s.snapshot.timer);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { void refresh(); }, [refresh, timer.completedWorkSessions, timer.phase, timer.microBreakActive, timer.snoozeCount]);
  useEffect(() => { const id = window.setInterval(() => void refresh(), 30000); return () => window.clearInterval(id); }, [refresh]);
  useEffect(() => {
    if (!confirmReset) return;
    const id = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmReset]);

  const today = analytics.today;
  const eyeDone = today.observedBreaksCompleted + today.observedExercisesCompleted;
  const eyeTotal = eyeDone + today.observedBreaksSkipped + today.observedExercisesSkipped;
  const regularTotal = today.workSessionsOnTime + today.workSessionsDelayed + today.workSessionsEndedEarly;

  return <div className="space-y-5" dir={getLang() === "fa" ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-[15px] font-bold text-slate-100">{t("گزارش فعالیت و مراقبت")}</h2><p className="mt-0.5 text-[11.5px] leading-5 text-slate-500">{t("نمایی از رویدادهای ثبت‌شده در هفت روز گذشته")}</p></div>
      <div className="flex items-center gap-2">
        <button onClick={() => void refresh()} className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300" title={t("به‌روزرسانی گزارش")} aria-label={t("به‌روزرسانی گزارش")}><RefreshCw size={13} /></button>
        <button onClick={() => { if (confirmReset) { void reset(); setConfirmReset(false); } else setConfirmReset(true); }} className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] transition ${confirmReset ? "border-rose-400/50 bg-rose-500/15 text-rose-200" : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-rose-300"}`} title={t("پاک کردن تاریخچه")}><Trash2 size={12} />{confirmReset ? t("تأیید پاک کردن") : t("بازنشانی")}</button>
      </div>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Metric label={t("زمان تایمر کاری امروز")} value={minutesText(today.deepWorkMinutes)} hint={t("مجموع هفت روز: {v}", { v: minutesText(analytics.weekDeepWorkMinutes) })} icon={<Clock3 size={15} />} />
      <Metric label={t("استراحت‌های کامل")} value={t("{n} استراحت", { n: toPersianDigits(today.completedBreaks) })} hint={t("تمرین کوتاه: {a} · استراحت طبیعی: {b}", { a: toPersianDigits(today.microBreaksCompleted), b: toPersianDigits(today.naturalBreaks) })} icon={<Coffee size={15} />} />
      <Metric label={t("تعویق‌ها")} value={t("{n} بار", { n: toPersianDigits(today.snoozeUsedCount) })} hint={t("هفت روز: {a} · جریمه قفل: {b}", { a: toPersianDigits(analytics.weekSnoozes), b: toPersianDigits(analytics.weekPenalties) })} icon={<Timer size={15} />} />
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ScoreCard testId="eye-care-score" title={t("پایبندی به مراقبت چشم")} today={today.score} week={analytics.weekAverageScore} completed={eyeDone} total={eyeTotal} icon={<Eye size={16} />} description={t("نسبت تایمرهای استراحت کامل و تمرین کوتاه که تا انتها رسیدند به همه موارد پایان‌یافته یا زود بسته‌شده.")} />
      <ScoreCard testId="regularity-score" title={t("نظم زمان‌بندی کار")} today={today.regularityScore} week={analytics.weekRegularityScore} completed={today.workSessionsOnTime} total={regularTotal} icon={<Activity size={16} />} description={t("نسبت نوبت‌های کاری که بدون تعویق به پایان رسیدند به کل نوبت‌های پایان‌یافته، تعویق‌شده یا زود متوقف‌شده.")} />
    </div>

    <div className="flex items-start gap-2 rounded-2xl border border-sky-400/20 bg-sky-400/[0.06] px-4 py-3 text-[11.5px] leading-6 text-slate-400"><Info size={15} className="mt-1 shrink-0 text-sky-300" /><p>{t("این امتیازها فقط بر اساس رویدادهای تایمر هستند؛ سلامت پزشکی چشم، انجام واقعی تمرین یا کیفیت کار را تشخیص نمی‌دهند. موارد در حال اجرا و پیش‌نمایش تمرین در امتیاز حساب نمی‌شوند. سوابق قدیمی بدون نتیجهٔ کافی همچنان در آمار حفظ می‌شوند اما وارد امتیاز نمی‌شوند.")}</p></div>

    <GlassCard>
      <SectionHeading title={t("نمودار ۷ روزه")} subtitle={t("ستون سبز: زمان تایمر کاری · نارنجی: تعویق · خط آبی: پایبندی به مراقبت چشم")} icon={<CalendarDays size={16} />} />
      <WeekChart week={analytics.week} />
    </GlassCard>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <GlassCard>
        <SectionHeading title={t("جزئیات هفته")} subtitle={t("جمع شاخص‌ها در ۷ روز گذشته")} icon={<Activity size={16} />} />
        <div className="space-y-2">
          {[{ label: t("زمان تایمر کاری"), value: minutesText(analytics.weekDeepWorkMinutes) }, { label: t("استراحت کامل"), value: t("{n} بار", { n: toPersianDigits(analytics.weekCompletedBreaks) }) }, { label: t("تمرین کوتاه در حین کار"), value: t("{n} بار", { n: toPersianDigits(analytics.weekMicroBreaks) }) }, { label: t("استراحت طبیعی (غیبت)"), value: t("{n} بار", { n: toPersianDigits(analytics.weekNaturalBreaks) }) }, { label: t("تعویق"), value: t("{n} بار", { n: toPersianDigits(analytics.weekSnoozes) }) }, { label: t("جریمه قفل صفحه"), value: t("{n} بار", { n: toPersianDigits(analytics.weekPenalties) }) }].map((row) => <div key={row.label} className="flex justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"><span className="text-[11.5px] text-slate-400">{row.label}</span><span className="text-[12px] font-semibold text-emerald-300">{row.value}</span></div>)}
        </div>
      </GlassCard>
      <GlassCard>
        <SectionHeading title={t("امتیازهای روزانه")} subtitle={t("مراقبت چشم / نظم زمان‌بندی کار")} icon={<Eye size={16} />} />
        <div className="space-y-2">{[...analytics.week].reverse().map((d) => <div key={d.date} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px]"><span className={d.isToday ? "font-semibold text-emerald-300" : "text-slate-400"}>{weekdayName(d.weekday)}</span><span className="digits font-semibold"><span style={{ color: scoreColor(d.score) }}>{scoreText(d.score)}</span><span className="mx-2 text-slate-500">/</span><span style={{ color: scoreColor(d.regularityScore) }}>{scoreText(d.regularityScore)}</span></span><span className="text-slate-500">{minutesText(d.deepWorkMinutes)}</span></div>)}</div>
        <p className="mt-3 text-[10.5px] leading-6 text-slate-500">{t("امتیاز هفتگی از مجموع تعداد رویدادها محاسبه می‌شود، نه میانگین روزهای بدون داده.")}</p>
      </GlassCard>
    </div>
  </div>;
}
