import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Coffee, GripVertical, Pause, Pin, Play, Settings2, Timer } from "lucide-react";
import { beginWidgetDrag, call } from "../lib/bridge";
import { useAppStore } from "../store/useAppStore";
import { formatClock, toLocalDigits } from "../lib/persian";
import { t } from "../lib/i18n";

/**
 * Micro progress widget — two personalities, one component:
 *
 * • **Docked** (default): a 3-pixel strip glued to the top edge of the screen.
 *   Resting the cursor on it for `settings.system.widgetHoverDelayMs`
 *   (default 300 ms, user configurable) opens the pill. The delay is what keeps
 *   "click the maximised browser tab" from being stolen by the widget.
 * • **Floating**: a compact capsule the user drags anywhere. The Rust core
 *   records the position on every native move, so pressing pause, expanding or
 *   switching windows never teleports it back to its default corner.
 */
export default function MicroBarWindow() {
  const snapshot = useAppStore((s) => s.snapshot);
  const timer = snapshot.timer;
  const system = snapshot.settings.system;
  const floating = system.widgetMode === "floating";
  const toggleTimer = useAppStore((s) => s.toggleTimer);
  const setWidgetMode = useAppStore((s) => s.setWidgetMode);
  const snapToEdge = useAppStore((s) => s.snapWidgetToEdge);
  const startBreak = useAppStore((s) => s.startBreak);

  const [expanded, setExpanded] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const dragging = useRef(false);

  /** Hover intent delay, straight from the persisted settings. */
  const hoverDelay = Math.max(0, Math.min(1500, system.widgetHoverDelayMs ?? 300));

  const setNativeExpanded = async (next: boolean) => {
    setExpanded(next);
    try {
      await call("set_micro_expanded", { expanded: next });
    } catch {
      /* browser preview */
    }
  };

  const isActive = timer.running && !timer.paused && !timer.idlePaused && timer.phase === "work";
  const ratio = timer.totalSeconds > 0 ? 1 - timer.remainingSeconds / timer.totalSeconds : 0;
  const progress = Math.min(1, Math.max(0, timer.phase === "work" ? ratio : timer.running ? 1 : 0));
  const onBreak = timer.phase === "break" || timer.phase === "longBreak";

  const color = useMemo(() => {
    if (onBreak) return "linear-gradient(90deg,#38bdf8,#22d3ee)";
    if (timer.remainingSeconds > 60) return "linear-gradient(90deg,#10b981,#22d3ee)";
    if (timer.remainingSeconds > 30) return "linear-gradient(90deg,#f59e0b,#fbbf24)";
    return "linear-gradient(90deg,#f43f5e,#fb7185)";
  }, [timer.remainingSeconds, onBreak]);

  const phaseLabel = timer.idlePaused
    ? t("توقف خودکار (غیبت)")
    : onBreak
      ? t("استراحت")
      : timer.phase === "work"
        ? t("مانده تا استراحت")
        : t("آماده شروع");

  useEffect(() => {
    if (!isActive) void setNativeExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  /* ------------------------ hover intent (configurable) -------------------- */
  const handleEnter = () => {
    if (floating || expanded) return;
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      void setNativeExpanded(true);
    }, hoverDelay);
  };

  const handleLeave = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (expanded) void setNativeExpanded(false);
  };

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  /* --------------------------- drag (floating) ----------------------------- */
  const handleDragStart = async () => {
    if (!floating || dragging.current) return;
    dragging.current = true;
    try {
      await beginWidgetDrag();
    } finally {
      dragging.current = false;
    }
  };

  const toggleLabel = timer.running && !timer.paused ? t("توقف موقت") : t("شروع");

  /* ------------------------------ floating -------------------------------- */
  if (floating) {
    return (
      <div className="fixed inset-0 grid place-items-center" dir={document.documentElement.dir}>
        <div
          onMouseDown={(e) => { if (e.button === 0) void handleDragStart(); }}
          className="widget-surface group flex h-[42px] w-[258px] cursor-grab items-center gap-2 rounded-full border px-3 active:cursor-grabbing"
          style={{ boxShadow: "var(--shadow-capsule)" }}
        >
          <GripVertical size={13} className="shrink-0 text-slate-500" />
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700/60">
            <motion.div
              className="absolute inset-y-0 right-0 rounded-full"
              style={{
                backgroundImage: timer.running ? color : "linear-gradient(90deg,#334155,#475569)",
              }}
              animate={{ width: `${Math.max(timer.running ? 2 : 0, progress * 100)}%` }}
              transition={{ ease: "linear", duration: 0.9 }}
            />
          </div>
          <span className="digits shrink-0 text-[12px] font-bold text-emerald-300">
            {formatClock(timer.remainingSeconds)}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void toggleTimer()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            {timer.running && !timer.paused ? <Pause size={11} /> : <Play size={11} />}
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void startBreak()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300"
            title={t("شروع استراحت")}
            aria-label={t("شروع استراحت")}
          >
            <Coffee size={11} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void call("open_settings_window")}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300"
            title={t("تنظیمات چشم‌یار")}
            aria-label={t("تنظیمات چشم‌یار")}
          >
            <Settings2 size={11} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void snapToEdge()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300"
            title={t("بازگرداندن ویجت به لبه بالای صفحه")}
            aria-label={t("چسباندن به لبه بالا")}
          >
            <Pin size={11} />
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------- docked --------------------------------- */
  return (
    <div
      className="fixed inset-x-0 top-0 select-none"
      onMouseLeave={handleLeave}
      style={{ height: "100vh" }}
      dir={document.documentElement.dir}
    >
      {/* the hover sensor strip */}
      <div
        onMouseEnter={handleEnter}
        className="group relative w-full"
        style={{ height: 3, cursor: "pointer" }}
      >
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
        <motion.div
          className="absolute inset-y-0 right-0 rounded-l-full"
          style={{
            backgroundImage: timer.running ? color : "linear-gradient(90deg,#334155,#475569)",
          }}
          animate={{ width: `${Math.max(timer.running ? 1.5 : 0, progress * 100)}%` }}
          transition={{ ease: "linear", duration: 0.9 }}
        />
        {isActive ? (
          <motion.div
            className="absolute inset-y-0 right-0 rounded-l-full blur-[5px]"
            style={{ backgroundImage: color }}
            animate={{ width: `${Math.max(1.5, progress * 100)}%`, opacity: [0.45, 0.8, 0.45] }}
            transition={{
              width: { ease: "linear", duration: 0.9 },
              opacity: { duration: 1.8, repeat: Infinity },
            }}
          />
        ) : null}
      </div>

      <AnimatePresence>
        {expanded ? (
          <motion.div
            initial={{ y: -14, scale: 0.98 }}
            animate={{ y: 8, scale: 1 }}
            exit={{ y: -14, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onMouseEnter={handleEnter}
            className="widget-surface mx-auto flex w-fit items-center gap-2.5 rounded-2xl border px-3.5 py-2"
            data-testid="docked-widget-popup"
            /* A tight, symmetrical shadow tuned to the pill's own height —
               the old 40 px spread made the 56 px pill look like it floated. */
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-300">
              <Timer size={14} className="opacity-70" />
              <span className="digits">{formatClock(timer.remainingSeconds)}</span>
            </span>
            <span className="h-4 w-px bg-white/10" />
            <span className={`text-[12px] ${timer.idlePaused ? "text-amber-300" : "text-slate-300"}`}>
              {phaseLabel}
            </span>
            <span className="h-4 w-px bg-white/10" />
            <span className="text-[11.5px] text-slate-400">
              {t("مرحله {a} از {b}", {
                a: toLocalDigits(timer.cycleIndex),
                b: toLocalDigits(snapshot.settings.timer.cyclesBeforeLongBreak),
              })}
            </span>
            {timer.microBreakActive ? (
              <>
                <span className="h-4 w-px bg-white/10" />
                <span className="text-[11px] text-sky-300">{t("تمرین کوتاه در حال اجرا")}</span>
              </>
            ) : null}
            {timer.snoozeCount > 0 ? (
              <>
                <span className="h-4 w-px bg-white/10" />
                <span className="digits text-[11px] text-amber-300">
                  {t("تعویق")} {toLocalDigits(timer.snoozeCount)}/{toLocalDigits(snapshot.settings.timer.maxSnooze)}
                </span>
              </>
            ) : null}
            <span className="h-4 w-px bg-white/10" />
            <button
              type="button"
              onClick={() => void toggleTimer()}
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
              title={toggleLabel}
              aria-label={toggleLabel}
            >
              {timer.running && !timer.paused ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button
              type="button"
              onClick={() => void startBreak()}
              disabled={onBreak}
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300 disabled:opacity-40"
              title={t("شروع استراحت")}
              aria-label={t("شروع استراحت")}
            >
              <Coffee size={13} />
            </button>
            <button
              type="button"
              onClick={() => void setWidgetMode("floating")}
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300"
              title={t("جدا کردن ویجت (حالت شناور)")}
              aria-label={t("جدا کردن ویجت (حالت شناور)")}
            >
              <Pin size={13} />
            </button>
            <button
              type="button"
              onClick={() => void call("open_settings_window")}
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-sky-400/40 hover:text-sky-300"
              title={t("تنظیمات چشم‌یار")}
              aria-label={t("تنظیمات چشم‌یار")}
            >
              <Settings2 size={13} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
