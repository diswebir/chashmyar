import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Eye, Sparkles, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { playChime } from "../lib/bridge";
import { toLocalDigits } from "../lib/persian";
import { t } from "../lib/i18n";

/**
 * 20-20-20 non-intrusive coach.
 *
 * Deliberately **never** locks input or covers the screen: a compact always-on-top
 * card slides in at the top-centre with a countdown ring, a blinking eye and a
 * dismiss button. Water-drop chimes mark the start and the end.
 */
export default function MicroBreakToast() {
  const snapshot = useAppStore((s) => s.snapshot);
  const dismiss = useAppStore((s) => s.dismissMicroBreak);
  const timer = snapshot.timer;
  const soundEnabled = snapshot.settings.system.soundEnabled;
  const lang = snapshot.settings.system.language;

  const started = useRef(false);
  const wasActive = useRef(timer.microBreakActive);

  useEffect(() => {
    if (soundEnabled && timer.microBreakActive && !started.current) {
      started.current = true;
      playChime("drop");
    }
    if (wasActive.current && !timer.microBreakActive) {
      if (soundEnabled) playChime("drop");
      started.current = false;
    }
    wasActive.current = timer.microBreakActive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.microBreakActive]);

  const total = Math.max(1, timer.microBreakTotal || 15);
  const remaining = Math.max(0, timer.microBreakRemaining);
  const progress = 1 - remaining / total;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="grid h-full w-full place-items-start justify-center pt-1"
      dir={lang === "en" ? "ltr" : "rtl"}
    >
      <motion.div
        initial={{ y: -22, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="panel osd-panel flex w-[500px] items-center gap-4 px-5 py-4"
        data-testid="short-exercise-panel"
      >
        {/* ring countdown */}
        <div className="relative grid h-16 w-16 shrink-0 place-items-center">
          <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
            <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--track)" strokeWidth="5" />
            <motion.circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference * (1 - progress) }}
              animate={{ strokeDashoffset: circumference * (1 - progress) }}
              transition={{ ease: "linear", duration: 0.9 }}
            />
          </svg>
          <span className="digits text-[15px] font-bold text-sky-300">
            {toLocalDigits(remaining)}
          </span>
        </div>

        {/* blinking eye */}
        <motion.span
          animate={{ scaleY: [1, 1, 0.15, 1] }}
          transition={{ duration: 3.4, repeat: Infinity, times: [0, 0.75, 0.85, 1] }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-400/15 text-sky-300"
        >
          <Eye size={20} />
        </motion.span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-100">
            <Sparkles size={13} className="text-sky-300" />
            {t("تمرین کوتاه در حین کار")}
          </div>
          <p className="mt-1 text-[11.5px] leading-6 text-slate-400">
            {t("به مدت {n} ثانیه به فاصله ۶ متری نگاه کنید و ۱۰ بار کامل پلک بزنید.", {
              n: toLocalDigits(total),
            })}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void dismiss()}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition hover:border-rose-400/40 hover:text-rose-300"
          title={t("بستن تمرین کوتاه")}
          aria-label={t("بستن تمرین کوتاه")}
        >
          <X size={14} />
        </button>
      </motion.div>
    </div>
  );
}
