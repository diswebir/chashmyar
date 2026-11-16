import { Palette, RefreshCw } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { IS_TAURI } from "../lib/bridge";
import { t } from "../lib/i18n";
import { toPersianPercent } from "../lib/persian";
import type { ColorVisionProfile, ColorVisionStatus } from "../types";
import { GlassCard, SectionHeading, Slider } from "./ui";

const PROFILES: { id: ColorVisionProfile; label: string; detail: string }[] = [
  { id: "off", label: "خاموش", detail: "بدون تغییر رنگ" },
  { id: "deuteranopia", label: "دوتان (سبز–قرمز)", detail: "Deuteranopia / deutan" },
  { id: "protanopia", label: "پروتان (قرمز–سبز)", detail: "Protanopia / protan" },
  { id: "tritanopia", label: "تریتان (آبی–زرد)", detail: "Tritanopia / tritan" },
];

const STATUS_TEXT: Record<ColorVisionStatus, string> = {
  off: "فیلتر رنگ خاموش است یا شدت آن صفر است.",
  pending: "در انتظار پاسخ ویندوز به تغییر فیلتر…",
  active: "ویندوز درخواست فیلتر را پذیرفت؛ ظاهر واقعی همه نمایشگرها تضمین نمی‌شود.",
  paused: "رنگ‌ایمن فعال است؛ فیلتر چشم‌یار موقتاً متوقف شد.",
  conflict: "یک افکت تمام‌صفحه دیگر شناسایی شد؛ برای جلوگیری از تداخل، آن را خاموش و دوباره تلاش کنید.",
  error: "اعمال فیلتر ناموفق بود؛ شرایط سیستم را بررسی و دوباره تلاش کنید.",
  restoreError: "بازگرداندن رنگ تأیید نشد؛ برنامه دوباره تلاش می‌کند. اگر مشکل ادامه داشت، برنامه را ببندید و تنظیمات رنگ ویندوز را بررسی کنید.",
  unsupported: "این فیلتر در این محیط قابل اعمال نیست؛ از برنامه ویندوز استفاده کنید.",
};

export default function ColorVisionCard() {
  const { settings, eye } = useAppStore((s) => s.snapshot);
  const patchSettings = useAppStore((s) => s.patchSettings);
  const retry = useAppStore((s) => s.retryColorVision);
  const profile = settings.eye.colorVisionProfile;
  const status = eye.colorVisionStatus ?? "off";
  const problem = status === "conflict" || status === "error" || status === "restoreError" || status === "unsupported";
  const canRetry = (status === "conflict" || status === "error") && profile !== "off" && settings.eye.colorVisionStrength > 0;

  return (
    <GlassCard>
      <section data-testid="color-vision-card">
        <SectionHeading
          title={t("کمک به تشخیص رنگ")}
          subtitle={t("پروفایل‌های آزمایشی برای کل صفحه")}
          icon={<Palette size={16} />}
        />
        <div className="space-y-4">
          <p className="text-[11.5px] leading-6 text-slate-400">
            {t("این فیلتر رنگ‌ها را بازتوزیع می‌کند، نه اینکه کوررنگی را شبیه‌سازی یا درمان کند. نتیجه برای افراد و محتوا متفاوت است و ممکن است بعضی رنگ‌ها کمتر قابل تشخیص شوند.")}
          </p>
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold text-slate-200">{t("پروفایل دید رنگی")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROFILES.map((option) => {
                const selected = profile === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-2xl border p-3 transition ${selected
                      ? "border-emerald-400/40 bg-emerald-400/10"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"}`}
                  >
                    <input
                      type="radio"
                      name="color-vision-profile"
                      value={option.id}
                      checked={selected}
                      data-testid={`color-vision-${option.id}`}
                      onChange={() => void patchSettings({ eye: { colorVisionProfile: option.id } })}
                      className="mt-1 accent-emerald-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-slate-100">{t(option.label)}</span>
                      <span className="mt-1 block text-[10.5px] text-slate-400" dir={option.id === "off" ? undefined : "ltr"}>{t(option.detail)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Slider
            label={t("شدت تغییر رنگ")}
            hint={t("شدت افکت را با سلیقه خود تنظیم کنید؛ این عدد درجه کوررنگی نیست.")}
            value={settings.eye.colorVisionStrength}
            min={0}
            max={100}
            step={5}
            format={toPersianPercent}
            disabled={profile === "off"}
            onChange={(v) => void patchSettings({ eye: { colorVisionStrength: v } })}
            from="#0ea5e9"
            to="#10b981"
          />
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3" data-testid="color-vision-samples">
            <p className="mb-2 text-[11px] text-slate-400">{t("برای مقایسه، به این نمونه‌ها و محتوای خود نگاه کنید:")}</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { name: "قرمز", color: "#df5c62" },
                { name: "سبز", color: "#49a36c" },
                { name: "آبی", color: "#4a83d8" },
                { name: "خاکستری", color: "#9ca3af" },
              ].map((sample) => (
                <div key={sample.name} className="min-w-0 text-center text-[10px] text-slate-400">
                  <span className="mb-1 block h-5 rounded-md" style={{ backgroundColor: sample.color }} aria-hidden="true" />
                  {t(sample.name)}
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-2xl border p-3 text-[11px] leading-6 ${problem ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-200" : "border-white/[0.07] bg-white/[0.02] text-slate-300"}`}>
            <p role="status" aria-live="polite" data-testid="color-vision-status" data-status={status}>{t(STATUS_TEXT[status] ?? STATUS_TEXT.error)}</p>
            {canRetry ? (
              <button type="button" className="btn btn-ghost mt-2 text-[11px]" data-testid="color-vision-retry" onClick={() => void retry()}>
                <RefreshCw size={12} /> {t("تلاش دوباره")}
              </button>
            ) : null}
          </div>
          {!IS_TAURI ? (
            <p className="text-[11px] leading-5 text-slate-500" data-testid="color-vision-browser-note">
              {t("در پیش‌نمایش مرورگر رنگ واقعی نمایشگر تغییر نمی‌کند.")}
            </p>
          ) : null}
          <p className="text-[11px] leading-6 text-slate-500">
            {t("این قابلیت مستقل از کلید محافظ چشم است، ولی همراه گرما و روشنایی کار می‌کند. رنگ‌ایمن آن را موقتاً متوقف می‌کند. HDR، بازی‌ها، ضبط صفحه یا فیلترهای ویندوز و Magnifier ممکن است رفتار متفاوت یا تداخل داشته باشند.")}
          </p>
        </div>
      </section>
    </GlassCard>
  );
}
