import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight,
  Coffee, Eye, Footprints, Keyboard, Lightbulb, Lock, PersonStanding,
  ShieldCheck, Sparkles, Timer, Unlock,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { formatClock, formatMinutes, toLocalDigits } from "../lib/persian";
import { call, onPenalty, playChime } from "../lib/bridge";
import type { PenaltyPayload } from "../types";
import {
  EYE_EXERCISES, STRETCHES, EyeExerciseCanvas, StretchIllustration, useReducedMotionPreference,
  type ExerciseInfo, type EyeExerciseMode, type StretchId,
} from "../components/exercises";
import { RingProgress } from "../components/ui";
import { t } from "../lib/i18n";

const TIPS = [
  "هر ۲۰ دقیقه، ۲۰ ثانیه به جسمی در فاصله حدود ۶ متری نگاه کنید.",
  "پلک زدن طبیعی به مرطوب ماندن سطح چشم کمک می‌کند.",
  "روشنایی صفحه را با نور محیط هماهنگ کنید و بازتاب‌های مزاحم را کاهش دهید.",
  "در طول روز گاهی از جای خود بلند شوید و چند قدم آرام بردارید.",
  "بالای نمایشگر را نزدیک به سطح چشم و صفحه را در فاصله راحت قرار دهید.",
  "هنگام کار، شانه‌ها را رها نگه دارید و هر چند وقت یک‌بار وضعیت بدن را تغییر دهید.",
  "پس از هر حرکت، چند نفس آرام بکشید و به بدن خود فرصت استراحت بدهید.",
];

type Slide =
  | (ExerciseInfo<EyeExerciseMode> & { kind: "eye" })
  | (ExerciseInfo<StretchId> & { kind: "body" });

export default function BreakLockWindow() {
  const reducedMotion = useReducedMotionPreference();
  const snapshot = useAppStore((s) => s.snapshot);
  const endBreakEarly = useAppStore((s) => s.endBreakEarly);
  const startBreak = useAppStore((s) => s.startBreak);
  const timer = snapshot.timer;
  const { lock, system, timer: timerSettings } = snapshot.settings;
  const dir = system.language === "en" ? "ltr" : "rtl";

  const [slideIndex, setSlideIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [tipIndex, setTipIndex] = useState(0);
  const [penalty, setPenalty] = useState<PenaltyPayload | null>(null);
  const penaltyPulseSeen = useRef(timer.penaltyPulse);
  const isBreak = timer.phase === "break" || timer.phase === "longBreak";
  const holdProgress = Math.min(1, Math.max(0, timer.emergencyHoldProgress ?? 0));
  const displayedTotal = isBreak ? timer.totalSeconds : timerSettings.breakMinutes * 60;
  const displayedRemaining = isBreak ? timer.remainingSeconds : displayedTotal;
  const progress = displayedTotal > 0 ? 1 - displayedRemaining / displayedTotal : 0;

  const slides = useMemo<Slide[]>(() => [
    ...(lock.eyeExercises ? EYE_EXERCISES.map((item) => ({ ...item, kind: "eye" as const })) : []),
    ...(lock.bodyExercises ? STRETCHES.map((item) => ({ ...item, kind: "body" as const })) : []),
  ], [lock.eyeExercises, lock.bodyExercises]);

  useEffect(() => {
    setSlideIndex((i) => Math.min(i, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  const go = useCallback((step: number) => {
    if (!slides.length) return;
    setDirection(step > 0 ? 1 : -1);
    setSlideIndex((i) => (i + step + slides.length) % slides.length);
  }, [slides.length]);

  // Each manual choice starts a fresh interval rather than being interrupted
  // by an old timer seconds later.
  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setTimeout(() => go(1), Math.max(10, lock.rotateSeconds) * 1000);
    return () => window.clearTimeout(id);
  }, [go, lock.rotateSeconds, slideIndex, slides.length]);

  useEffect(() => {
    const id = window.setTimeout(() => setTipIndex((i) => (i + 1) % TIPS.length), 20_000);
    return () => window.clearTimeout(id);
  }, [tipIndex]);

  // Hidden webviews are created at startup: chime only on a real transition.
  const previousBreak = useRef(isBreak);
  useEffect(() => {
    if (previousBreak.current !== isBreak && system.soundEnabled) playChime(isBreak ? "break" : "complete");
    previousBreak.current = isBreak;
  }, [isBreak, system.soundEnabled]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void onPenalty((payload) => {
      setPenalty(payload);
      if (system.soundEnabled) playChime("penalty");
    }).then((unlisten) => { if (cancelled) unlisten(); else dispose = unlisten; });
    return () => { cancelled = true; dispose?.(); };
  }, [system.soundEnabled]);

  useEffect(() => {
    if (timer.penaltyPulse > penaltyPulseSeen.current) {
      penaltyPulseSeen.current = timer.penaltyPulse;
      setPenalty((prev) => ({
        seconds: prev?.seconds ?? snapshot.settings.lock.focusPenaltySeconds,
        totalPenalties: timer.penaltiesThisBreak,
        remainingSeconds: timer.remainingSeconds,
      }));
    }
    // Trigger only on an actual new penalty pulse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.penaltyPulse]);

  useEffect(() => {
    if (!penalty) return;
    const id = window.setTimeout(() => setPenalty(null), 8000);
    return () => window.clearTimeout(id);
  }, [penalty]);

  const slide = slides[Math.min(slideIndex, Math.max(0, slides.length - 1))];
  return (
    <div className="lock-shell rest-shell relative h-full w-full overflow-y-auto" dir={dir}>
      <AnimatePresence>
        {penalty ? (
          <motion.div
            initial={{ y: reducedMotion ? 0 : -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reducedMotion ? 0 : -30, opacity: 0 }}
            className="rest-penalty" role="alert" dir={dir}
          >
            <AlertTriangle size={19} />
            <div>
              <strong>{t("تلاش برای خروج از صفحه استراحت شناسایی شد!")}</strong>
              <p>{t("{s} ثانیه جریمه به زمان استراحت اضافه شد — مجموع جریمه‌ها: {n} بار", {
                s: toLocalDigits(penalty.seconds), n: toLocalDigits(penalty.totalPenalties),
              })}</p>
            </div>
            <button type="button" onClick={() => setPenalty(null)} className="btn">{t("بستن")}</button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="rest-page">
        <header className="rest-header">
          <div className="rest-heading">
            <span className="rest-heading-icon"><Coffee size={21} /></span>
            <div>
              <p className="rest-eyebrow">{t("مکثی برای حال بهتر")}</p>
              <h1>{!isBreak ? t("پیش‌نمایش صفحه استراحت") : timer.phase === "longBreak" ? t("استراحت طولانی") : t("وقت استراحت چشم و بدن")}</h1>
            </div>
          </div>
          <div className="rest-header-status">
            <span className="rest-status"><ShieldCheck size={14} />{!isBreak ? t("پیش‌نمایش") : lock.strictLock ? t("قفل سخت‌گیرانه فعال") : t("قفل ساده")}</span>
            {timer.penaltiesThisBreak > 0 ? <span className="rest-status rest-status-alert"><AlertTriangle size={14} />{t("{n} جریمه", { n: toLocalDigits(timer.penaltiesThisBreak) })}</span> : null}
          </div>
        </header>

        {/* The physical arrangement follows the sketch in both languages:
            timer and tips are on the left; the wide exercise panel is on the right. */}
        <main className="rest-layout" dir="ltr" data-testid="rest-layout">
          <aside className="rest-sidebar" dir={dir} data-testid="rest-sidebar">
            <section className="panel rest-timer-card" data-testid="rest-timer">
              <div className="rest-card-heading">
                <span className="rest-mini-icon"><Timer size={16} /></span>
                <div><h2>{t("زمان استراحت")}</h2><p>{t("فرصتی برای تازه شدن")}</p></div>
              </div>
              <div className="rest-countdown">
                <RingProgress progress={progress} size={180} stroke={9} gradient={["#10b981", "#38bdf8"]}>
                  <div>
                    <div className="digits rest-time" dir="ltr" data-testid="break-countdown">{formatClock(displayedRemaining)}</div>
                    <div className="rest-time-label">{t("تا پایان استراحت")}</div>
                  </div>
                </RingProgress>
              </div>
              <div className="rest-timer-meta">
                <div><span>{t("طول استراحت")}</span><strong className="digits">{formatMinutes(displayedTotal)}</strong></div>
                <div><span>{t("تعویق استفاده‌شده")}</span><strong className="digits">{t("{a} از {b}", { a: toLocalDigits(timer.snoozeCount), b: toLocalDigits(timerSettings.maxSnooze) })}</strong></div>
              </div>
            </section>

            <section className="panel rest-tips-card" data-testid="rest-tips">
              <div className="rest-tips-heading">
                <span className="rest-tip-icon"><Lightbulb size={16} /></span>
                <div><h2>{t("نکته‌های مراقبتی")}</h2><p>{t("هر بار، یک یادآوری کوچک")}</p></div>
                <span className="rest-tip-count digits" dir="ltr">{toLocalDigits(tipIndex + 1)} / {toLocalDigits(TIPS.length)}</span>
              </div>
              <div className="rest-tip-content">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p key={tipIndex} initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }} transition={{ duration: .2 }}>
                    {t(TIPS[tipIndex])}
                  </motion.p>
                </AnimatePresence>
              </div>
              <div className="rest-tip-dots" role="group" aria-label={t("انتخاب نکته")}>{TIPS.map((_, i) => (
                <button key={i} type="button" onClick={() => setTipIndex(i)} aria-label={t("نکته {n}", { n: toLocalDigits(i + 1) })} aria-current={i === tipIndex ? "true" : undefined} className={i === tipIndex ? "active" : ""} />
              ))}</div>
            </section>
          </aside>

          <section className="panel rest-exercise-card" dir={dir} data-testid="rest-exercises">
            <div className="rest-exercise-heading">
              <div className="rest-exercise-heading-title">
                <span className="rest-mini-icon"><Sparkles size={17} /></span>
                <div><h2>{t("تمرین‌های چشم و بدن")}</h2><p>{t("حرکت‌های ساده برای یک استراحت بهتر")}</p></div>
              </div>
              {slides.length ? <span className="rest-exercise-count digits" dir="ltr">{toLocalDigits(slideIndex + 1)} <span>/</span> {toLocalDigits(slides.length)}</span> : null}
            </div>

            <div className="rest-stand-reminder" data-testid="stand-reminder">
              <span><PersonStanding size={23} /></span>
              <div>
                <strong>{slide?.id === "rest" ? t("در جای امن و راحت بنشینید") : t("لطفاً از پشت میز بلند شوید")}</strong>
                <p>{slide?.id === "rest" ? t("برای این تمرین، نشسته چشم‌ها و شانه‌ها را آرام نگه دارید.") : t("برای انجام تمرین‌ها بایستید و حرکت‌ها را آرام و کنترل‌شده انجام دهید.")}</p>
              </div>
            </div>

            <div className="rest-slide-area">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={`${slide?.kind ?? "empty"}-${slide?.id ?? "none"}`}
                  initial={{ opacity: 0, x: reducedMotion ? 0 : direction > 0 ? 16 : -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: reducedMotion ? 0 : direction > 0 ? -16 : 16 }}
                  transition={{ duration: .22, ease: "easeOut" }}
                  className="rest-slide"
                >
                  {slide ? <>
                    <div className="rest-art-card" dir={dir}>
                      <div className="rest-art-caption"><span className="rest-art-pulse" />{t("راهنمای تصویری حرکت")}</div>
                      {slide.kind === "eye" ? <EyeExerciseCanvas mode={slide.id} /> : <StretchIllustration id={slide.id} />}
                      <div className="rest-art-cue"><Check size={14} /> {t(slide.cue)}</div>
                    </div>
                    <div className="rest-instructions" dir={dir}>
                      <div className="rest-instruction-tags">
                        <span>{slide.kind === "eye" ? <Eye size={13} /> : <Footprints size={13} />}{slide.kind === "eye" ? t("تمرین چشم") : t("تمرین بدن")}</span>
                        <span><Timer size={13} />{t(slide.duration)}</span>
                      </div>
                      <h3>{t(slide.title)}</h3>
                      <p className="rest-instructions-label">{t("چگونه انجام دهیم؟")}</p>
                      <ol>
                        {slide.steps.map((step, index) => <li key={step}>
                          <span className="digits" aria-hidden="true">{toLocalDigits(index + 1)}</span>
                          <p>{t(step)}</p>
                        </li>)}
                      </ol>
                    </div>
                  </> : <div className="rest-no-exercises">{t("تمرین‌ها خاموش هستند — فقط نفس بکشید و استراحت کنید")}</div>}
                </motion.div>
              </AnimatePresence>
            </div>

            {slides.length > 0 ? <div className="rest-exercise-nav">
              <button type="button" className="rest-nav-button" onClick={() => go(-1)} aria-label={t("حرکت قبلی")}>
                {dir === "rtl" ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}<span>{t("قبلی")}</span>
              </button>
              <div className="rest-exercise-dots" role="group" aria-label={t("انتخاب تمرین")}>{slides.map((item, i) => (
                <button key={`${item.kind}-${item.id}`} type="button" onClick={() => { setDirection(i > slideIndex ? 1 : -1); setSlideIndex(i); }} aria-label={t("حرکت {n}", { n: toLocalDigits(i + 1) })} aria-current={i === slideIndex ? "true" : undefined} className={i === slideIndex ? "active" : ""} />
              ))}</div>
              <button type="button" className="rest-nav-button rest-nav-next" onClick={() => go(1)} aria-label={t("حرکت بعدی")}>
                <span>{t("حرکت بعدی")}</span>{dir === "rtl" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </div> : null}
            <p className="rest-safety"><AlertTriangle size={13} />{t("حرکت‌ها را بدون درد انجام دهید؛ اگر ایستادن برایتان ممکن نیست، آن‌ها را نشسته انجام دهید.")}</p>
          </section>
        </main>

        <footer className="rest-footer">
          <div className="rest-footer-note">
            {isBreak && lock.strictLock ? <><Keyboard size={14} />{t("کلیدهای Alt+Tab و کلید ویندوز در طول استراحت غیرفعال هستند")}</> : <><Sparkles size={14} />{t("به بدن خود فرصت حرکت و استراحت بدهید")}</>}
          </div>
          <div className="rest-footer-actions">
            {isBreak && lock.emergencyUnlock ? <div className="rest-emergency">
              <div className="relative grid h-8 w-8 place-items-center">
                <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--track)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#f43f5e" strokeWidth="3" strokeLinecap="round" strokeDasharray={2 * Math.PI * 15} strokeDashoffset={2 * Math.PI * 15 * (1 - holdProgress)} style={{ transition: "stroke-dashoffset 100ms linear" }} />
                </svg>
                <Unlock size={12} className="text-rose-300" />
              </div>
              <span>{t("خروج اضطراری:")}</span><span className="rest-keys" dir="ltr"><KeyCap label="Ctrl" active={holdProgress > 0} /><span>+</span><KeyCap label="Shift" active={holdProgress > 0} /></span>
              <span>{holdProgress > 0 ? t("{n} ثانیه", { n: toLocalDigits(Math.max(0, Math.ceil(lock.emergencyHoldSeconds * (1 - holdProgress)))) }) : t("نگه دار تا باز شود")}</span>
            </div> : null}
            {isBreak && (!timer.running || timer.paused) ? <button type="button" onClick={() => void startBreak()} className="btn btn-primary"><Coffee size={13} />{timer.paused ? t("ادامه شمارش استراحت") : t("شروع شمارش استراحت")}</button> : null}
            {!isBreak ? <button type="button" onClick={() => void call("hide_window", { label: "break-lock" })} className="btn">{t("بستن پیش‌نمایش")}</button>
              : !lock.strictLock ? <button type="button" onClick={() => void endBreakEarly()} className="btn btn-ghost">{dir === "rtl" ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}{t("پایان زودهنگام استراحت")}</button> : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function KeyCap({ label, active }: { label: string; active: boolean }) {
  return <kbd className={`rest-key ${active ? "active" : ""}`}>{label}</kbd>;
}
