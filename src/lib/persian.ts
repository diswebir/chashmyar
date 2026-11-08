/* ============================================================================
 * Locale-aware number & time formatting.
 *
 * Numeric strings are formatted for the active UI language: Persian figures
 * for fa and Latin figures for en. Both Persian and Latin digits are accepted
 * as input regardless of language.
 * ==========================================================================*/

import { translate } from "./i18n";

export type Locale = "fa" | "en";

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

let locale: Locale = "fa";

export function setLocale(next: Locale) {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

/** Accept Persian, Arabic-Indic and Latin digits in editable fields. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) - (d >= "۰" ? 0x6f0 : 0x660)));
}

/** Format for a specified locale, including already-Persian source strings. */
export function digitsForLocale(input: string | number, target: Locale): string {
  const text = String(input);
  if (target === "en") return toAsciiDigits(text).replace(/٪/g, "%").replace(/٫/g, ".").replace(/٬/g, ",");
  return text.replace(/[0-9٠-٩]/g, (d) => FA_DIGITS[d >= "٠" ? d.charCodeAt(0) - 0x660 : Number(d)]);
}

/** Digits of the active locale. */
export function toLocalDigits(input: string | number): string {
  return digitsForLocale(input, locale);
}

/** Kept for readability at call sites: always the *active* locale's digits. */
export const toPersianDigits = toLocalDigits;

/** 125 -> "۰۲:۰۵" (fa) / "02:05" (en) */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return toLocalDigits(`${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
}

/** Hours stay two digits even past 59 minutes: 3725 -> "۰۱:۰۲:۰۵" */
export function formatClockLong(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 3600) return formatClock(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return toLocalDigits(
    `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`,
  );
}

/** 1380 -> "۲۳ دقیقه" / "23 min" */
export function formatMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minute = translate("دقیقه");
  const second = translate("ثانیه");
  if (s < 60) return `${toLocalDigits(s)} ${second}`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (sec === 0) return `${toLocalDigits(m)} ${minute}`;
  if (locale === "en") return `${toLocalDigits(m)} ${minute} ${toLocalDigits(sec)} ${second}`;
  return `${toLocalDigits(m)} ${minute} و ${toLocalDigits(sec)} ${second}`;
}

export function toPersianPercent(value: number): string {
  return `${toLocalDigits(Math.round(value))}${locale === "en" ? "%" : "٪"}`;
}

/** Alias with a locale-neutral name for new code. */
export const formatPercent = toPersianPercent;

export function ordinal(n: number): string {
  return toLocalDigits(n);
}

export function nowClock(d = new Date()): string {
  return toLocalDigits(
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
  );
}

export function parseClockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10) || 0);
  return h * 60 + m;
}

/** "2026-11-07" -> "۷ نوامبر" (fa/latin) or "7 Nov" (en) */
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const FA_MONTHS = [
  "ژانویه",
  "فوریه",
  "مارس",
  "آوریل",
  "مه",
  "ژوئن",
  "ژوئیه",
  "اوت",
  "سپتامبر",
  "اکتبر",
  "نوامبر",
  "دسامبر",
];

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => Number.parseInt(x, 10));
  if (!y || !m || !d) return iso;
  if (locale === "en") return `${toLocalDigits(d)} ${EN_MONTHS[m - 1] ?? ""}`;
  return `${toLocalDigits(d)} ${FA_MONTHS[m - 1] ?? ""}`;
}

/** Persian weekday name → English, for the analytics table. */
export function weekdayName(name: string): string {
  return translate(name);
}
