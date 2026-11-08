import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";

/**
 * Exercise copy stays in Persian until render time so changing languages updates
 * the existing page. Illustrations are self-contained vector animations; they
 * show the body part described by the instructions actually moving.
 */
export type EyeExerciseMode = "horizontal" | "vertical" | "infinity" | "twenty";
export type StretchId = "neck" | "wrist" | "shoulder" | "posture";

export interface ExerciseInfo<I extends string> {
  id: I;
  title: string;
  duration: string;
  cue: string;
  steps: string[];
}

export const EYE_EXERCISES: ExerciseInfo<EyeExerciseMode>[] = [
  {
    id: "horizontal",
    title: "نگاه آرام به چپ و راست",
    duration: "حدود ۲۰ ثانیه",
    cue: "سر ثابت؛ حرکت آرام چشم‌ها",
    steps: [
      "سرتان را ثابت نگه دارید و روبه‌رو نگاه کنید.",
      "فقط با چشم‌ها، نقطه را به‌آرامی به چپ و راست دنبال کنید.",
      "چند بار پلک بزنید و به چشم‌ها فشار نیاورید.",
    ],
  },
  {
    id: "vertical",
    title: "نگاه آرام به بالا و پایین",
    duration: "حدود ۲۰ ثانیه",
    cue: "بدون حرکت دادن سر",
    steps: [
      "سر و گردن را در حالت راحت و ثابت نگه دارید.",
      "فقط با چشم‌ها، نقطه را آرام به بالا و پایین دنبال کنید.",
      "در دامنه راحت حرکت کنید و چند بار پلک بزنید.",
    ],
  },
  {
    id: "infinity",
    title: "دنبال کردن مسیر هشت",
    duration: "حدود ۲۰ ثانیه",
    cue: "نقطه را آرام دنبال کنید",
    steps: [
      "سرتان را ثابت نگه دارید و شانه‌ها را رها کنید.",
      "با چشم‌ها، نقطه را در مسیر هشت دنبال کنید.",
      "اگر احساس خستگی یا ناراحتی دارید، حرکت را متوقف کنید.",
    ],
  },
  {
    id: "twenty",
    title: "نگاه به دوردست",
    duration: "۲۰ ثانیه",
    cue: "به بیرون صفحه نگاه کنید، نه به تصویر",
    steps: [
      "نگاهتان را از صفحه نمایش بردارید.",
      "به جسمی در فاصله حدود ۶ متری نگاه کنید.",
      "۲۰ ثانیه به دوردست نگاه کنید و به‌طور طبیعی پلک بزنید.",
    ],
  },
];

export const STRETCHES: ExerciseInfo<StretchId>[] = [
  {
    id: "neck",
    title: "کشش آرام گردن",
    duration: "۳ بار برای هر سمت",
    cue: "شانه‌ها پایین و رها",
    steps: [
      "صاف بایستید و شانه‌ها را پایین و رها نگه دارید.",
      "سر را آرام به سمت یک شانه خم کنید؛ شانه را بالا نبرید.",
      "۵ ثانیه مکث کنید، به مرکز برگردید و سمت دیگر را تکرار کنید.",
    ],
  },
  {
    id: "wrist",
    title: "حرکت آرام مچ دست",
    duration: "۵ بار برای هر دست",
    cue: "حرکت از مفصل مچ، بدون فشار",
    steps: [
      "در حالت ایستاده، یک دست را با آرنج راحت مقابل خود نگه دارید.",
      "مچ دست را به‌آرامی بالا و پایین ببرید؛ انگشتان را رها نگه دارید.",
      "چند بار تکرار کنید، سپس همین حرکت را با دست دیگر انجام دهید.",
    ],
  },
  {
    id: "shoulder",
    title: "بالا و پایین بردن شانه‌ها",
    duration: "۵ بار",
    cue: "آرام بالا، آرام پایین",
    steps: [
      "صاف بایستید و دست‌ها را کنار بدن رها کنید.",
      "شانه‌ها را به‌آرامی به سمت گوش‌ها ببرید و ۳ ثانیه نگه دارید.",
      "شانه‌ها را آرام پایین بیاورید و حرکت را تکرار کنید.",
    ],
  },
  {
    id: "posture",
    title: "کشش پهلو در حالت ایستاده",
    duration: "۳ بار برای هر سمت",
    cue: "حرکت کوتاه و کنترل‌شده",
    steps: [
      "صاف بایستید و پاها را به‌اندازه عرض لگن باز کنید.",
      "یک دست را آرام در امتداد ران پایین ببرید و به همان سمت خم شوید.",
      "پس از ۲ ثانیه به مرکز برگردید و سمت دیگر را تکرار کنید.",
    ],
  },
];

// Native SVG animations keep the pivot explicit and are supported by WebView2.
// Each segment uses an ease-in/ease-out spline; repeated values create a hold.
const EASE = ".42 0 .58 1";
export function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
// React can insert an SVG animation after the SVG timeline has already started.
// Explicitly start it after mount so even newly switched scenes always animate.
function useStartSvgAnimation<T extends SVGAnimationElement>(reduced: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (reduced) return;
    // Wait until the new SVG has joined the document's active SMIL timeline.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => ref.current?.beginElement());
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [reduced]);
  return ref;
}
function AnimatedTransform({ type, values, times, seconds, reduced }: {
  type: "rotate" | "translate"; values: string; times: string; seconds: number; reduced: boolean;
}) {
  const ref = useStartSvgAnimation<SVGAnimateTransformElement>(reduced);
  if (reduced) return null;
  const segments = values.split(";").length - 1;
  return <animateTransform ref={ref} begin="indefinite" attributeName="transform" type={type} values={values} keyTimes={times}
    dur={`${seconds}s`} calcMode="spline" keySplines={Array(segments).fill(EASE).join(";")} repeatCount="indefinite" />;
}
function AnimatedAttribute({ name, values, seconds, reduced }: {
  name: string; values: string; seconds: number; reduced: boolean;
}) {
  const ref = useStartSvgAnimation<SVGAnimateElement>(reduced);
  if (reduced) return null;
  const segments = values.split(";").length - 1;
  return <animate ref={ref} begin="indefinite" attributeName={name} values={values} dur={`${seconds}s`} calcMode="spline"
    keyTimes={Array.from({ length: segments + 1 }, (_, i) => i / segments).join(";")}
    keySplines={Array(segments).fill(EASE).join(";")} repeatCount="indefinite" />;
}
function AnimatedPathMotion({ path, reduced }: { path: string; reduced: boolean }) {
  const ref = useStartSvgAnimation<SVGAnimateMotionElement>(reduced);
  return reduced ? null : <animateMotion ref={ref} begin="indefinite" path={path} dur="10s" repeatCount="indefinite" />;
}

function SceneBackground() {
  return (
    <g aria-hidden="true">
      <circle cx="240" cy="143" r="119" fill="var(--illustration-orb)" />
      <circle cx="240" cy="143" r="100" fill="none" stroke="var(--illustration-line)" strokeDasharray="3 7" />
      <circle cx="76" cy="78" r="4" fill="var(--illustration-spark)" opacity=".7" />
      <circle cx="390" cy="98" r="3" fill="var(--illustration-spark)" opacity=".55" />
      <path d="M68 197h10m-5-5v10M402 43h10m-5-5v10" stroke="var(--illustration-spark)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      <ellipse cx="240" cy="265" rx="119" ry="7" fill="var(--illustration-shadow)" />
    </g>
  );
}

/** Head, neck and simple facial detail. It is animated as one part when needed. */
function Head() {
  return (
    <g>
      <path d="M226 99v29h28V99" fill="var(--illustration-skin)" stroke="var(--illustration-ink)" strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="240" cy="65" rx="34" ry="41" fill="var(--illustration-skin)" stroke="var(--illustration-ink)" strokeWidth="3" />
      <path d="M206 60c-1-27 12-42 35-42 22 0 35 16 33 39-10-3-17-12-20-18-13 12-28 15-48 16Z" fill="var(--illustration-hair)" />
      <path d="M218 59h6m32 0h6" stroke="var(--illustration-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M234 79q6 4 12 0" fill="none" stroke="var(--illustration-ink)" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  );
}

function Torso() {
  return (
    <path d="M208 117q-25 5-37 27l17 24 14-10-5 62h86l-5-62 14 10 17-24q-12-22-37-27-12 12-32 12t-32-12Z" fill="var(--illustration-shirt)" stroke="var(--illustration-ink)" strokeWidth="3" strokeLinejoin="round" />
  );
}

function Legs() {
  return (
    <g fill="none" stroke="var(--illustration-trousers)" strokeWidth="20" strokeLinecap="round">
      <path d="M216 213l-10 43" />
      <path d="M264 213l10 43" />
    </g>
  );
}

function RestingArms() {
  return (
    <g fill="none" stroke="var(--illustration-ink)" strokeLinecap="round" strokeLinejoin="round">
      <path d="M183 150l-22 58m136-58 22 58" strokeWidth="20" />
      <path d="M183 150l-22 58m136-58 22 58" stroke="var(--illustration-shirt)" strokeWidth="14" />
      <path d="M160 208l-3 15m163-15 3 15" stroke="var(--illustration-skin)" strokeWidth="10" />
    </g>
  );
}

function DoubleArrow({ d, left, right }: { d: string; left: string; right: string }) {
  return (
    <g fill="none" stroke="var(--illustration-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".8">
      <path d={d} strokeDasharray="5 7" />
      <path d={left} />
      <path d={right} />
    </g>
  );
}

/** A head tilt around the base of the neck, with brief holds on both sides. */
function NeckScene() {
  const reduced = useReducedMotionPreference();
  return (
    <svg viewBox="0 0 480 280" aria-hidden="true">
      <SceneBackground />
      <Legs /><RestingArms /><Torso />
      <g data-motion-part="head">
        <AnimatedTransform type="rotate" values="0 240 114;-12 240 114;-12 240 114;0 240 114;12 240 114;12 240 114;0 240 114"
          times="0;.07;.38;.45;.52;.83;1" seconds={16} reduced={reduced} />
        <Head />
      </g>
      <DoubleArrow d="M158 67q82-74 164 0" left="M158 67l3-16m-3 16 15-5" right="M322 67l-3-16m3 16-15-5" />
    </svg>
  );
}

/** An actual hand pivots gently at the wrist; the forearm remains stationary. */
function WristScene() {
  const reduced = useReducedMotionPreference();
  return (
    <svg viewBox="0 0 480 280" aria-hidden="true">
      <SceneBackground />
      <path d="M82 175q29-40 77-31l61 6-6 41-64-5-51 25Z" fill="var(--illustration-shirt)" stroke="var(--illustration-ink)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M211 150q38 4 82 3v32q-42 2-82 5Z" fill="var(--illustration-skin)" stroke="var(--illustration-ink)" strokeWidth="3" />
      <g data-motion-part="wrist-hand">
        <AnimatedTransform type="rotate" values="0 292 169;-18 292 169;-18 292 169;0 292 169;18 292 169;18 292 169;0 292 169"
          times="0;.14;.28;.5;.64;.78;1" seconds={6} reduced={reduced} />
        <path d="M291 153q12-8 24-7l32-3 31-4q7-1 8 4 1 5-6 6l-28 5 35-2q7 0 7 5t-7 5l-35 2 31 2q7 1 6 6-1 5-8 5l-31-1 23 5q7 2 5 7-2 4-8 3l-37-6q-14-2-22-8l-20 5Z" fill="var(--illustration-skin)" stroke="var(--illustration-ink)" strokeWidth="3" strokeLinejoin="round" />
        <path d="M332 155l19-1m-19 10 20 0m-20 9 18 3" fill="none" stroke="var(--illustration-ink)" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
      </g>
      <circle cx="292" cy="169" r="5" fill="var(--illustration-accent)" />
      <DoubleArrow d="M350 100q42 46 0 108" left="M350 100l16 3m-16-3 3 16" right="M350 208l15-3m-15 3 3-15" />
    </svg>
  );
}

/** Both shoulders and connected arms lift and lower together; the head stays put. */
function ShoulderScene() {
  const reduced = useReducedMotionPreference();
  return (
    <svg viewBox="0 0 480 280" aria-hidden="true">
      <SceneBackground />
      <Legs /><Head /><Torso />
      <g data-motion-part="shoulders">
        <AnimatedTransform type="translate" values="0 0;0 -12;0 -12;0 0;0 0" times="0;.15;.65;.85;1" seconds={6} reduced={reduced} />
        <RestingArms />
        <path d="M174 143q16-20 35-20m97 20q-16-20-35-20" fill="none" stroke="var(--illustration-shirt)" strokeWidth="16" strokeLinecap="round" />
        <circle cx="180" cy="143" r="4" fill="var(--illustration-accent)" />
        <circle cx="300" cy="143" r="4" fill="var(--illustration-accent)" />
      </g>
      <DoubleArrow d="M130 153v-43" left="M130 110l-8 9m8-9 8 9" right="M130 153l-8-9m8 9 8-9" />
      <DoubleArrow d="M350 153v-43" left="M350 110l-8 9m8-9 8 9" right="M350 153l-8-9m8 9 8-9" />
    </svg>
  );
}

/** The upper body bends from the hip; both legs stay grounded and still. */
function SideBendScene() {
  const reduced = useReducedMotionPreference();
  return (
    <svg viewBox="0 0 480 280" aria-hidden="true">
      <SceneBackground />
      <Legs />
      <g data-motion-part="torso">
        <AnimatedTransform type="rotate" values="0 240 216;-10 240 216;-10 240 216;0 240 216;10 240 216;10 240 216;0 240 216"
          times="0;.1;.3;.4;.5;.7;1" seconds={10} reduced={reduced} />
        <RestingArms /><Torso /><Head />
      </g>
      <DoubleArrow d="M128 135q112-69 224 0" left="M128 135l5-15m-5 15 16-3" right="M352 135l-5-15m5 15-16-3" />
    </svg>
  );
}

function EyePair({ mode }: { mode: Exclude<EyeExerciseMode, "twenty"> }) {
  const reduced = useReducedMotionPreference();
  const values = mode === "horizontal" ? "-15 0;15 0;-15 0" : "0 -8;0 8;0 -8";
  // A scaled copy of the guide path keeps both pupils following its figure eight.
  const pupilPath = "M-13 0C-13 -5 -6.13 -5 0 0S13 5 13 0 6.13 -5 0 0 -13 5 -13 0Z";
  return (
    <g>
      {[172, 308].map((cx) => (
        <g key={cx}>
          <path d={`M ${cx - 48} 199 Q ${cx} 150 ${cx + 48} 199 Q ${cx} 238 ${cx - 48} 199 Z`} fill="var(--illustration-eye)" stroke="var(--illustration-ink)" strokeWidth="3.5" />
          <g data-motion-part="pupil">
            {mode === "infinity"
              ? <AnimatedPathMotion path={pupilPath} reduced={reduced} />
              : <AnimatedTransform type="translate" values={values} times="0;.5;1" seconds={6} reduced={reduced} />}
            <circle cx={cx} cy="198" r="16" fill="var(--illustration-accent)" />
            <circle cx={cx} cy="198" r="8" fill="var(--illustration-ink)" />
            <circle cx={cx + 4} cy="193" r="3.5" fill="white" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** Smooth, bidirectional guide dots: no jump back to the start at loop ends. */
function TrackingScene({ mode }: { mode: Exclude<EyeExerciseMode, "twenty"> }) {
  const reduced = useReducedMotionPreference();
  const guidePath = mode === "horizontal" ? "M105 80H375" : mode === "vertical" ? "M240 34V142" : "M100 88C100 38 174 38 240 88S380 138 380 88 306 38 240 88 100 138 100 88Z";
  return (
    <svg viewBox="0 0 480 280" aria-hidden="true">
      <SceneBackground />
      <path d={guidePath} fill="none" stroke="var(--illustration-accent)" strokeWidth="2.5" strokeDasharray="5 8" strokeLinecap="round" opacity=".42" />
      {mode === "infinity" ? (
        <circle cx={reduced ? 100 : 0} cy={reduced ? 88 : 0} r="9" fill="var(--illustration-accent)" data-motion-part="guide-dot">
          <AnimatedPathMotion path={guidePath} reduced={reduced} />
        </circle>
      ) : mode === "horizontal" ? (
        <circle cx="105" cy="80" r="9" fill="var(--illustration-accent)" data-motion-part="guide-dot">
          <AnimatedAttribute name="cx" values="105;375;105" seconds={6} reduced={reduced} />
        </circle>
      ) : (
        <circle cx="240" cy="34" r="9" fill="var(--illustration-accent)" data-motion-part="guide-dot">
          <AnimatedAttribute name="cy" values="34;142;34" seconds={6} reduced={reduced} />
        </circle>
      )}
      <EyePair mode={mode} />
    </svg>
  );
}

/** A real distant scene rather than a dot to stare at on the screen. */
function DistanceScene() {
  const reduced = useReducedMotionPreference();
  return (
    <svg viewBox="0 0 480 280" aria-hidden="true">
      <SceneBackground />
      <rect x="127" y="32" width="226" height="156" rx="18" fill="var(--illustration-eye)" stroke="var(--illustration-ink)" strokeWidth="3" />
      <path d="M130 145q49-52 98-18 53-69 122-20v64a14 14 0 0 1-14 14H144a14 14 0 0 1-14-14Z" fill="var(--illustration-land)" />
      <circle cx="291" cy="70" r="18" fill="var(--illustration-sun)" />
      <path d="M238 34v151M129 111h222" stroke="var(--illustration-ink)" strokeWidth="3" opacity=".55" />
      <path d="M158 184v-32m-13 12 13-21 14 21Z" fill="var(--illustration-accent)" stroke="var(--illustration-accent)" strokeWidth="3" strokeLinejoin="round" />
      <g data-motion-part="breathing">
        <AnimatedTransform type="translate" values="0 0;0 -3;0 0" times="0;.5;1" seconds={4} reduced={reduced} />
        <path d="M218 262q1-38 22-38t22 38" fill="var(--illustration-shirt)" stroke="var(--illustration-ink)" strokeWidth="3" />
        <circle cx="240" cy="210" r="17" fill="var(--illustration-hair)" />
      </g>
      <path d="M240 198V150" stroke="var(--illustration-accent)" strokeWidth="2" strokeDasharray="5 6" opacity=".65" />
    </svg>
  );
}

export function EyeExerciseCanvas({ mode }: { mode: EyeExerciseMode }) {
  return (
    <div className="exercise-illustration" role="img" aria-label={t(EYE_EXERCISES.find((item) => item.id === mode)?.title ?? "تمرین‌های چشم")} data-exercise-scene={mode}>
      {mode === "twenty" ? <DistanceScene /> : <TrackingScene mode={mode} />}
    </div>
  );
}

export function StretchIllustration({ id }: { id: StretchId }) {
  return (
    <div className="exercise-illustration" role="img" aria-label={t(STRETCHES.find((item) => item.id === id)?.title ?? "تمرین‌های بدن")} data-exercise-scene={id}>
      {id === "neck" ? <NeckScene /> : id === "wrist" ? <WristScene /> : id === "shoulder" ? <ShoulderScene /> : <SideBendScene />}
    </div>
  );
}
