import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { windowLabel } from "./lib/bridge";
import { useAppStore } from "./store/useAppStore";
import { dirOf, setLang, type Lang } from "./lib/i18n";
import SettingsWindow from "./windows/SettingsWindow";
import MicroBarWindow from "./windows/MicroBarWindow";
import MicroBreakToast from "./windows/MicroBreakToast";
import SnoozePopupWindow from "./windows/SnoozePopupWindow";
import BreakLockWindow from "./windows/BreakLockWindow";
import DimmerOverlayWindow from "./windows/DimmerOverlayWindow";

const ALLOWED = new Set([
  "main",
  "micro-bar",
  "micro-break",
  "snooze-alert",
  "break-lock",
  "dimmer-overlay",
]);

/**
 * Applies the persisted appearance (theme + language + text direction) to the
 * document before anything else renders, and re-applies it whenever the user
 * flips either switch. Windows are re-mounted on language change so every
 * string, digit and layout direction updates atomically.
 */
function useAppearance() {
  const settings = useAppStore((s) => s.snapshot.settings);
  const theme = settings.system.theme;
  const lang = (settings.system.language ?? "fa") as Lang;

  // Set the translator before child components render, not after the first paint.
  // Each Tauri window has its own JavaScript realm.
  setLang(lang);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "light" ? "light" : "dark";
    root.lang = lang;
    root.dir = dirOf(lang);
  }, [theme, lang]);

  return { theme, lang };
}

export default function App() {
  const boot = useAppStore((s) => s.boot);
  const [label] = useState(() => windowLabel());
  const [forbidden, setForbidden] = useState(false);
  useAppearance();

  useEffect(() => {
    if (!ALLOWED.has(label)) setForbidden(true);
    const unlisten = boot();
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [boot, label]);

  const view = useMemo(() => {
    switch (label) {
      case "micro-bar":
        return <MicroBarWindow />;
      case "micro-break":
        return <MicroBreakToast />;
      case "snooze-alert":
        return <SnoozePopupWindow />;
      case "break-lock":
        return <BreakLockWindow />;
      case "dimmer-overlay":
        return <DimmerOverlayWindow />;
      case "main":
      default:
        return <SettingsWindow />;
    }
  }, [label]);

  if (forbidden) {
    return (
      <div className="app-shell grid h-full place-items-center">
        <p className="text-sm text-slate-400">Unknown window: {label}</p>
      </div>
    );
  }

  // Preserve the current tab and scroll position while switching languages.
  return <div className="h-full w-full">{view}</div>;
}
