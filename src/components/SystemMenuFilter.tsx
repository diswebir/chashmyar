import { RefreshCw } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { IS_TAURI } from "../lib/bridge";
import { t } from "../lib/i18n";
import { Toggle } from "./ui";

/** Optional screen-wide matrix; normal temperature uses Gamma and dimming uses an overlay. */
export default function SystemMenuFilter() {
  const { settings, eye } = useAppStore((s) => s.snapshot);
  const patch = useAppStore((s) => s.patchSettings);
  const retry = useAppStore((s) => s.retryColorVision);
  const status = eye.screenFilterStatus ?? "off";
  const requested = settings.eye.coverWindowsMenus;
  const text = status === "restoreError" ? "بازگرداندن فیلتر تمام‌صفحه تأیید نشد؛ برنامه را ببندید و تنظیمات رنگ ویندوز را بررسی کنید."
    : status === "pending" && eye.screenFilterCoversOverlay ? "در انتظار پاسخ ویندوز؛ لطفاً کمی صبر کنید."
    : status === "error" && eye.screenFilterCoversOverlay ? "تغییر افکت تأیید نشد؛ افکت قبلی ممکن است هنوز فعال باشد. برنامه دوباره تلاش می‌کند."
    : eye.screenFilterCoversOverlay && (!requested || !settings.eye.enabled || eye.whitelisted)
      ? "بازگردانی افکت تمام‌صفحه در جریان است؛ مسیر Gamma هنوز قطعی نیست."
    : !settings.eye.enabled ? "محافظ چشم خاموش است؛ این حالت نیز غیرفعال است."
    : eye.whitelisted ? "رنگ‌ایمن فعال است؛ این حالت موقتاً متوقف شد."
    : !requested ? "حالت تمام‌صفحه خاموش است؛ دما فقط از Gamma درخواست می‌شود."
    : status === "active" ? "ویندوز درخواست فیلتر تمام‌صفحه را پذیرفت؛ پوشش ظاهری تضمین نمی‌شود."
    : status === "pending" ? "در انتظار پاسخ ویندوز؛ لطفاً کمی صبر کنید."
    : status === "conflict" ? "افکت یا ذره‌بین دیگری شناسایی شد؛ مسیر Gamma و لایه تیرگی قبلی درخواست می‌شوند. پس از رفع تداخل، دوباره تلاش کنید."
    : status === "error" ? "اعمال تمام‌صفحه یا انتقال امن Gamma ناموفق بود؛ مسیر Gamma و لایه تیرگی قبلی درخواست می‌شوند."
    : status === "unsupported" ? "این محیط فیلتر تمام‌صفحه ندارد؛ مسیر Gamma و لایه تیرگی قبلی درخواست می‌شوند."
    : "اکنون کاهش روشنایی یا گرما لازم نیست.";
  const canRetry = requested && settings.eye.enabled && !eye.whitelisted && (status === "conflict" || status === "error");
  return (
    <section className="space-y-2" data-testid="system-menu-filter">
      <Toggle
        checked={requested}
        onChange={(value) => void patch({ eye: { coverWindowsMenus: value } })}
        label={t("پوشش منوهای ویندوز (آزمایشی)")}
        description={t("برای پایداری بیشتر گرما و تیرگی روی استارت و ویجت؛ پیش‌فرض خاموش است.")}
      />
      <p className="text-[11px] leading-6 text-slate-500">
        {t("با روشن‌کردن این گزینه، گرما و تیرگی به افکت نرم‌افزاری تمام‌صفحه منتقل می‌شوند؛ در حالت عادی دما فقط از Gamma درخواست می‌شود.")}
        {" "}{t("این حالت از افکت تمام‌صفحه ویندوز استفاده می‌کند. ممکن است با Magnifier یا فیلتر رنگ ویندوز تداخل داشته باشد؛ نتیجه در HDR، بازی، صفحه امن و ضبط صفحه متفاوت است. پوشش همه سطوح تضمین نمی‌شود.")}
        {" "}{t("هنگام جابه‌جایی بین روش‌ها ممکن است تصویر موقتاً روشن شود.")}
      </p>
      <p role="status" aria-live="polite" data-testid="system-menu-filter-status" data-status={status}
        className={status === "conflict" || status === "error" || status === "restoreError" || status === "unsupported" ? "text-[11px] leading-6 text-amber-300" : "text-[11px] leading-6 text-slate-400"}>
        {t(text)}
      </p>
      {canRetry ? <button type="button" className="btn btn-ghost text-[11px]" data-testid="system-menu-filter-retry" onClick={() => void retry()}>
        <RefreshCw size={12} /> {t("تلاش دوباره")}
      </button> : null}
      {!IS_TAURI && requested ? <p className="text-[11px] leading-5 text-slate-500">{t("در پیش‌نمایش مرورگر رنگ واقعی نمایشگر تغییر نمی‌کند.")}</p> : null}
    </section>
  );
}
