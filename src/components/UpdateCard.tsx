import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { GlassCard, SectionHeading } from "./ui";
import { call, IS_TAURI, type UpdateStatus } from "../lib/bridge";
import { toLocalDigits } from "../lib/persian";
import { t } from "../lib/i18n";

interface Props { status: UpdateStatus; check: () => Promise<void> }

export default function UpdateCard({ status, check }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [installError, setInstallError] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const busy = ["checking", "downloading", "installing"].includes(status.phase);
  const canCheck = !busy && !["ready", "unconfigured", "unsupported", "restartRequired"].includes(status.phase);
  const progress = status.total && status.total > 0 ? Math.max(0, Math.min(100, Math.round(status.downloaded * 100 / status.total))) : null;
  const version = toLocalDigits(status.version ?? "");

  useEffect(() => {
    if (!confirming) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setConfirming(false); opener.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [confirming]);
  useEffect(() => { if (status.phase !== "ready") setConfirming(false); }, [status.phase]);

  let description: string;
  switch (status.phase) {
    case "checking": description = t("در حال بررسی نسخه‌های جدید…"); break;
    case "downloading": description = t("نسخه {v} پیدا شد؛ دریافت و بررسی امضا در حال انجام است.", { v: version }); break;
    case "upToDate": description = t("چشم‌یار به‌روز است."); break;
    case "ready": description = t("نسخه {v} دریافت شد و امضای آن تأیید شد.", { v: version }); break;
    case "installing": description = t("در حال آماده‌سازی نصب و راه‌اندازی دوباره…"); break;
    case "unconfigured": description = t("این نسخه بدون کلید عمومی به‌روزرسان ساخته شده است؛ نسخه رسمی دارای امضا را دستی نصب کنید."); break;
    case "unsupported": description = t("به‌روزرسان خودکار فقط در نسخه ویندوز پشتیبانی می‌شود."); break;
    case "restartRequired": description = t("اجرای نصب‌کننده ناموفق بود؛ برنامه را یک‌بار ببندید و دوباره باز کنید."); break;
    case "error": description = t("بررسی، دریافت یا تأیید امضا ناموفق بود؛ اتصال را بررسی و دوباره تلاش کنید."); break;
    default: description = t("بررسی و دریافت خودکار در پس‌زمینه؛ نصب فقط با تأیید شما.");
  }

  const portableError = status.error === "portable_install" || installError === "portable_install";
  return (
    <>
      <div className="xl:col-span-2" data-testid="update-card">
      <GlassCard>
        <SectionHeading title={t("به‌روزرسانی چشم‌یار")} subtitle={t("بررسی هنگام اجرا و سپس هر ۶ ساعت، حتی در سینی سیستم")} icon={<RefreshCw size={16} />} />
        <div className="update-status-panel" role="status" aria-live="polite" data-testid="update-status" data-phase={status.phase}>
          <span className="update-status-icon" aria-hidden="true">
            {status.phase === "ready" || status.phase === "upToDate" ? <CheckCircle2 size={19} /> : <Download size={19} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{description}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {status.kind === "portable" ? t("نسخه پرتابل — فایل برنامه در همان پوشه جایگزین می‌شود.") : t("نسخه نصبی — نصب در همان مسیر فعلی انجام می‌شود.")}
            </p>
            {status.phase === "downloading" && progress !== null && (
              <div className="mt-2 flex items-center gap-2">
                <div className="update-progress" role="progressbar" aria-label={t("پیشرفت دریافت")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <span className="digits text-xs">{t("{n}٪", { n: toLocalDigits(progress) })}</span>
              </div>
            )}
          </div>
        </div>
        {portableError && <p className="mt-3 text-xs leading-6" style={{ color: "var(--muted)" }} role="alert">{t("جایگزینی فایل پرتابل انجام نشد. دسترسی نوشتن پوشه را بررسی کنید؛ در صورت نیاز فایل پشتیبان کنار برنامه باقی می‌ماند.")}</p>}
        {(status.error === "settings_save" || installError.includes("settings_save")) && <p className="mt-3 text-xs leading-6" style={{ color: "var(--muted)" }} role="alert">{t("تنظیمات ذخیره نشدند؛ نصب متوقف شد. فضای خالی و دسترسی نوشتن پوشه داده را بررسی کنید و دوباره تلاش کنید.")}</p>}
        {(status.error === "installer_prepare" || installError.includes("installer_prepare")) && <p className="mt-3 text-xs leading-6" style={{ color: "var(--muted)" }} role="alert">{t("آماده‌سازی نصب‌کننده ناموفق بود؛ فضای خالی و دسترسی نوشتن پوشه موقت را بررسی کنید و دوباره تلاش کنید.")}</p>}
        {installError === "break_active" && <p className="mt-3 text-xs" role="alert">{t("پس از پایان استراحت دوباره تلاش کنید.")}</p>}
        {!IS_TAURI && <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>{t("در پیش‌نمایش مرورگر بررسی واقعی انجام نمی‌شود.")}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {status.phase === "ready" ? (
            <button ref={opener} type="button" className="update-action-primary" onClick={() => { setInstallError(""); setConfirming(true); }} data-testid="update-install-open">
              <ShieldCheck size={15} /> {t("نصب و راه‌اندازی دوباره")}
            </button>
          ) : (
            <button type="button" className="update-action-primary" disabled={!canCheck} onClick={() => { setInstallError(""); void check(); }} data-testid="update-check">
              <RefreshCw size={15} /> {t("بررسی نسخه جدید")}
            </button>
          )}
          <button type="button" className="update-action-secondary" onClick={() => void call("open_releases_page")}>
            <ExternalLink size={14} /> {t("صفحه انتشارها")}
          </button>
        </div>
      </GlassCard>
      </div>
      {confirming && (
        <div className="update-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { setConfirming(false); opener.current?.focus(); } }}>
          <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title" data-testid="update-confirm">
            <span className="update-status-icon" aria-hidden="true"><ShieldCheck size={22} /></span>
            <h2 id="update-dialog-title" className="mt-3 text-base font-bold">{t("نصب نسخه {v}؟", { v: version })}</h2>
            <p className="mt-2 text-sm leading-7" style={{ color: "var(--fg-2)" }}>{t("برنامه بسته و دوباره اجرا می‌شود و تایمر جاری متوقف خواهد شد. تنظیمات و گزارش‌های ذخیره‌شده حفظ می‌شوند.")}</p>
            <p className="mt-2 text-xs leading-6" style={{ color: "var(--muted)" }}>
              {status.kind === "portable" ? t("فقط فایل پرتابل در همین پوشه جایگزین می‌شود؛ نسخه نصبی ایجاد نمی‌شود.") : t("به‌روزرسانی در محل نصب فعلی انجام می‌شود.")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className="update-action-primary" data-testid="update-confirm-install" onClick={() => {
                setConfirming(false);
                void call("install_ready_update").catch((error: unknown) => setInstallError(String(error)));
              }}>{t("بله، نصب شود")}</button>
              <button type="button" autoFocus className="update-action-secondary" onClick={() => { setConfirming(false); opener.current?.focus(); }}>{t("فعلاً نه")}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
