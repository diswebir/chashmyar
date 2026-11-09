import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Minus, Plus } from "lucide-react";
import { toAsciiDigits, toPersianDigits } from "../lib/persian";
import { t } from "../lib/i18n";
import { useAppStore } from "../store/useAppStore";
import { call, IS_TAURI } from "../lib/bridge";

/* ------------------------------- Glass card ------------------------------- */
export function GlassCard({
  children,
  className = "",
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`panel p-5 ${glow ? "ring-1 ring-emerald-400/25" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon ? (
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-emerald-300">
            {icon}
          </span>
        ) : null}
        <div>
          <h3 className="text-[15px] font-semibold text-slate-100">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12px] leading-5 text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- Slider --------------------------------- */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix,
  format,
  onChange,
  from = "#10b981",
  to = "#f59e0b",
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  format?: (v: number) => string;
  onChange: (value: number) => void;
  from?: string;
  to?: string;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => { if (timer.current === null) setLocal(value); }, [value]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      const latest = pending.current;
      pending.current = null;
      changeRef.current(latest);
    }
  }, []);

  const fill = useMemo(() => ((local - min) / (max - min)) * 100, [local, min, max]);

  const commit = (next: number) => {
    setLocal(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    pending.current = next;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      pending.current = null;
      changeRef.current(next);
    }, 110);
  };

  return (
    <div className={disabled ? "opacity-45" : ""}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-slate-200">{label}</span>
        <span className="digits text-[13px] font-semibold text-emerald-300">
          {format ? format(local) : toPersianDigits(local)}
          {suffix ? <span className="mr-1 text-[11px] text-slate-400">{suffix}</span> : null}
        </span>
      </div>
      {hint ? <p className="mb-2 text-[11px] leading-5 text-slate-500">{hint}</p> : null}
      <input
        type="range"
        aria-label={label}
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => commit(Number(e.target.value))}
        style={
          {
            "--fill": `${fill}%`,
            "--track-from": from,
            "--track-to": to,
          } as React.CSSProperties
        }
      />
      {/* The track is physically left-to-right in both languages. Its endpoints
          must follow that same direction rather than inheriting Persian RTL. */}
      <div dir="ltr" className="flex justify-between text-[10px] text-slate-500 digits" data-testid="slider-endpoints">
        <span>{toPersianDigits(min)}</span>
        <span>{toPersianDigits(max)}</span>
      </div>
    </div>
  );
}

/* --------------------------------- Toggle --------------------------------- */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group flex w-full items-center justify-between gap-4 rounded-2xl border p-3.5 text-right transition ${
        disabled
          ? "opacity-45"
          : "border-white/[0.07] bg-white/[0.02] hover:border-emerald-400/30 hover:bg-white/[0.04]"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">{description}</span>
        ) : null}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ${
          checked ? "bg-emerald-500/90 shadow-[0_0_18px_-4px_rgba(16,185,129,0.9)]" : "bg-slate-600/60"
        }`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          style={{ [checked ? "left" : "right"]: 2 } as React.CSSProperties}
        />
      </span>
    </button>
  );
}

/* -------------------------------- Stepper --------------------------------- */
/**
 * Numeric control that can be **dragged** horizontally with the mouse (or a
 * finger) or nudged with the − / + buttons. Dragging 6px ≈ 1 step,
 * and holding Shift drags 5× faster.
 */
export function DragStepper({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  hint,
  onChange,
  disabled = false,
  accent = "#10b981",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  accent?: string;
}) {
  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ startX: 0, startValue: value, moved: false, active: false });
  const commitTimer = useRef<number | null>(null);
  const pendingCommit = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!dragging && commitTimer.current === null) setLocal(value);
  }, [value, dragging]);
  useEffect(() => () => {
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = null;
    if (pendingCommit.current !== null) {
      const latest = pendingCommit.current;
      pendingCommit.current = null;
      changeRef.current(latest);
    }
  }, []);

  const commit = (next: number) => {
    const snapped = clamp(Math.round(next / step) * step);
    setLocal(snapped);
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    pendingCommit.current = snapped;
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      pendingCommit.current = null;
      changeRef.current(snapped);
    }, 90);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startValue: local, moved: false, active: true };
    setDragging(true);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || disabled) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 2) drag.current.moved = true;
    // RTL-friendly: dragging to the left increases the value in Persian UI.
    const direction = document.documentElement.dir === "rtl" ? -1 : 1;
    const steps = Math.round((dx * direction) / 6) * (e.shiftKey ? 5 : 1);
    commit(drag.current.startValue + steps * step);
  };

  const endDrag = () => { drag.current.active = false; setDragging(false); };

  const fill = ((local - min) / (max - min)) * 100;

  return (
    <div
      className={`select-none rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 transition ${
        disabled ? "opacity-45" : dragging ? "border-emerald-400/40" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-200">{label}</span>
        <span className="digits text-[12px] text-slate-400">
          {toPersianDigits(local)} {unit ? t(unit) : null}
        </span>
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-5 text-slate-500">{hint}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || local <= min}
          onClick={() => commit(local - step)}
          aria-label={`${label} −`}
          className="btn-icon disabled:opacity-40"
        >
          <Minus size={14} />
        </button>

        <div
          role="slider"
          tabIndex={0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={local}
          aria-label={label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowRight") {
              e.preventDefault();
              commit(local + step);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
              e.preventDefault();
              commit(local - step);
            }
          }}
          className={`relative h-9 flex-1 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] ${
            disabled ? "cursor-not-allowed" : dragging ? "cursor-grabbing" : "cursor-ew-resize"
          }`}
        >
          <div
            className="absolute inset-y-0 right-0 rounded-l-xl opacity-30 transition-[width] duration-75"
            style={{ width: `${fill}%`, background: accent }}
          />
          <div className="relative flex h-full items-center justify-center">
            <span className="digits text-[15px] font-bold text-slate-100">
              {toPersianDigits(local)}
              {unit ? <span className="mr-1 text-[10px] font-medium text-slate-400">{t(unit)}</span> : null}
            </span>
          </div>
          <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-[9px] text-slate-500">
            ⟵ ⟶
          </span>
        </div>

        <button
          type="button"
          disabled={disabled || local >= max}
          onClick={() => commit(local + step)}
          aria-label={`${label} +`}
          className="btn-icon disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">{t("کشیدن با ماوس یا استفاده از دکمه‌های − و +")}</p>
    </div>
  );
}

/* ----------------------------- Numeric fields ----------------------------- */
/** Editable localized digits; all three common digit sets are accepted. */
export function NumericInput({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label: string;
}) {
  const language = useAppStore((s) => s.snapshot.settings.system.language);
  const [draft, setDraft] = useState(toPersianDigits(value));
  const editing = useRef(false);
  useEffect(() => {
    if (editing.current) setDraft((draft) => toPersianDigits(draft));
    else setDraft(toPersianDigits(value));
  }, [value, language]);
  return (
    <input
      type="text" inputMode="numeric" dir="ltr" aria-label={label}
      value={draft} onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(toPersianDigits(toAsciiDigits(e.target.value).replace(/[^0-9]/g, "").slice(0, 3)))}
      onBlur={() => {
        editing.current = false;
        const n = Number(toAsciiDigits(draft));
        const next = draft && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
        setDraft(toPersianDigits(next));
        if (next !== value) onChange(next);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="digits mt-1 w-full bg-transparent text-center text-[14px] font-semibold text-slate-100 outline-none"
    />
  );
}

/** Editable HH:MM field; rendered digits follow the language, backend stays ASCII. */
export function ClockInput({ value, onChange, label }: {
  value: string; onChange: (v: string) => void; label: string;
}) {
  const language = useAppStore((s) => s.snapshot.settings.system.language);
  const [draft, setDraft] = useState(toPersianDigits(value));
  const editing = useRef(false);
  useEffect(() => {
    if (editing.current) setDraft((draft) => toPersianDigits(draft));
    else setDraft(toPersianDigits(value));
  }, [value, language]);
  return (
    <input
      type="text" inputMode="numeric" dir="ltr" aria-label={label} title={t("ساعت را به شکل ساعت:دقیقه وارد کنید")}
      value={draft} onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(toPersianDigits(toAsciiDigits(e.target.value).replace(/[^0-9:]/g, "").slice(0, 5)))}
      onBlur={() => {
        editing.current = false;
        const match = toAsciiDigits(draft).match(/^(\d{1,2}):(\d{1,2})$/);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
          setDraft(toPersianDigits(value));
          return;
        }
        const next = `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
        setDraft(toPersianDigits(next));
        if (next !== value) onChange(next);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="digits mt-1 w-full bg-transparent text-[14px] text-slate-100 outline-none"
    />
  );
}

/* ------------------------------ Segmented -------------------------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          className={`seg-item flex items-center gap-1.5 ${size === "sm" ? "px-2 py-1 text-[11px]" : ""}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Ring progress ------------------------------ */
export function RingProgress({
  progress,
  size = 190,
  stroke = 10,
  gradient = ["#10b981", "#22d3ee"],
  children,
}: {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
  gradient?: [string, string];
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  const id = `ring-${gradient[0].replace("#", "")}-${Math.round(size)}`;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="100%" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--track)"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c * (1 - clamped) }}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ ease: "linear", duration: 0.9 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/* --------------------------------- Credits -------------------------------- */
export function Credits({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`credits ${compact ? "credits--compact" : ""}`} data-testid="credits-card">
      <a
        href="https://disweb.ir/"
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => {
          if (IS_TAURI) { event.preventDefault(); void call("open_creator_website"); }
        }}
        className="credits-profile"
      >
        <span className="credits-heart" aria-hidden="true" data-testid="credits-heart">
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
            <path d="M12 21s-7.5-4.7-9.4-9A5.4 5.4 0 0 1 12 6.6 5.4 5.4 0 0 1 21.4 12c-1.9 4.3-9.4 9-9.4 9Z" fill="currentColor" />
          </svg>
        </span>
        <span className="credits-identity">
          <span className="credits-topline">
            <span className="credits-label">{t("سازنده")}</span>
            <span className="credits-domain" dir="ltr">disweb.ir <ExternalLink size={10} aria-hidden="true" /></span>
          </span>
          <span className="credits-name">{t("رضا جنترانی")}</span>
        </span>
      </a>
      <p className="credits-tagline">{t("ساخته شده با قلب برای چشمان شما")}</p>
    </div>
  );
}
