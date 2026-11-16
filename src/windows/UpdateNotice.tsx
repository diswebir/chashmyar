import { ArrowUpCircle, X } from "lucide-react";
import { call } from "../lib/bridge";
import { t } from "../lib/i18n";
import { toLocalDigits } from "../lib/persian";
import { useUpdateStatus } from "../lib/updates";
import { useAppStore } from "../store/useAppStore";

/** Passive notice for both installed and standalone builds. */
export default function UpdateNotice() {
  const { status } = useUpdateStatus();
  const language = useAppStore((s) => s.snapshot.settings.system.language);
  return (
    <div className="h-full w-full p-2" dir={language === "en" ? "ltr" : "rtl"}>
      <div className="update-notice panel" data-testid="update-notice">
        <span className="update-status-icon" aria-hidden="true"><ArrowUpCircle size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">{t("نسخه جدید چشم‌یار آماده است")}</p>
          <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--muted)" }}>
            {status.version ? t("نسخه {v} با امضای تأییدشده دریافت شد.", { v: toLocalDigits(status.version) }) : t("برای نصب، ابتدا تأیید کنید.")}
          </p>
          <button type="button" className="update-notice-link" onClick={() => void call("update_open_details")}>{t("مشاهده و نصب")}</button>
        </div>
        <button type="button" className="update-notice-close" aria-label={t("بستن اعلان به‌روزرسانی")} onClick={() => void call("update_dismiss_notice")}><X size={15} /></button>
      </div>
    </div>
  );
}
