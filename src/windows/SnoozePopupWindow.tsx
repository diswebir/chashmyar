import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlarmClock, Ban, Coffee, Eye, Hourglass, Plus, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { formatClock, formatMinutes, toLocalDigits } from "../lib/persian";
import { playChime } from "../lib/bridge";
import { t } from "../lib/i18n";

/** The native core enforces the snooze budget; the UI also prevents double clicks. */
export default function SnoozePopupWindow() {
  const snapshot = useAppStore((s) => s.snapshot);
  const snooze = useAppStore((s) => s.snooze);
  const dismiss = useAppStore((s) => s.dismissWarning);
  const startBreak = useAppStore((s) => s.startBreak);
  const timer = snapshot.timer;
  const { snoozeOptions, maxSnooze, preBreakAlertSeconds } = snapshot.settings.timer;
  const lang = snapshot.settings.system.language;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (snapshot.settings.system.soundEnabled) playChime("warning");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await action(); } finally { inFlight.current = false; setBusy(false); }
  };
  const remaining = Math.max(0, maxSnooze - timer.snoozeCount);
  const capped = remaining <= 0;

  return (
    <div className="grid h-full w-full place-items-start justify-center p-2" dir={lang === "en" ? "ltr" : "rtl"}>
      <motion.div
        initial={{ x: 30, scale: 0.98 }}
        animate={{ x: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="panel osd-panel snooze-panel w-[436px] overflow-hidden p-4"
        data-testid="snooze-panel"
      >
        <div className="flex items-start gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-300">
            <AlarmClock size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-slate-100">{t("به‌زودی استراحت شروع می‌شود")}</h2>
            <p className="mt-1 text-[12px] leading-6 text-slate-400">
              {t("{m} تا پایان این مرحله کاری باقی مانده است. کار خود را ذخیره کنید.", {
                m: formatMinutes(preBreakAlertSeconds),
              })}
            </p>
          </div>
          <span className="digits mt-0.5 rounded-xl bg-white/[0.06] px-2 py-1 text-[13px] font-bold text-amber-300" dir="ltr">
            {formatClock(timer.remainingSeconds)}
          </span>
          <button type="button" className="osd-close" disabled={busy} onClick={() => void act(dismiss)}
            aria-label={t("بستن اعلان")} title={t("بستن اعلان")} data-testid="snooze-close">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="my-3 h-px bg-white/[0.07]" />

        {capped ? (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3">
            <Ban size={16} className="mt-0.5 shrink-0 text-rose-300" />
            <p className="text-[12px] leading-6 text-rose-200">
              {t("سقف تعویق مجاز ({n} بار) پر شده است. استراحت در {left} دیگر آغاز می‌شود.", {
                n: toLocalDigits(maxSnooze), left: formatMinutes(Math.max(timer.remainingSeconds, 0)),
              })}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>{t("تعویق‌های باقی‌مانده:")} <b className="digits text-slate-200">{toLocalDigits(remaining)}</b> {t("از {n}", { n: toLocalDigits(maxSnooze) })}</span>
              <span className="flex items-center gap-1 text-slate-400"><Hourglass size={12} /> {t("برای افزودن زمان انتخاب کنید")}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {snoozeOptions.map((minutes, index) => (
                <button key={`${minutes}-${index}`} type="button" disabled={busy} onClick={() => void act(() => snooze(minutes))}
                  className="snooze-choice" aria-label={t("افزودن {n} دقیقه", { n: toLocalDigits(minutes) })}>
                  <span className="snooze-choice-plus"><Plus size={14} aria-hidden="true" /></span>
                  <span className="digits snooze-choice-number">{toLocalDigits(minutes)}</span>
                  <span className="snooze-choice-label">{t("دقیقه")}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><Eye size={12} /> {t("چشم‌یار")}</span>
          <button type="button" disabled={busy} onClick={() => void act(startBreak)} className="btn btn-primary text-[11px]">
            <Coffee size={12} /> {t("شروع استراحت")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
