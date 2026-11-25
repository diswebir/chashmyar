import { useAppStore } from "../store/useAppStore";

/**
 * Software dimmer overlay — full-screen, click-through, always-on-top.
 * This ordinary window only dims: a Gamma failure never creates an orange
 * warmth layer. The explicitly enabled full-screen matrix is separate.
 */
export default function DimmerOverlayWindow() {
  const eye = useAppStore((s) => s.snapshot.eye);
  const settings = useAppStore((s) => s.snapshot.settings);

  // Hide this dimming layer before the opt-in fullscreen matrix is acquired.
  const active = settings.eye.enabled && !eye.whitelisted && !eye.screenFilterCoversOverlay;
  const dim = active ? ((100 - eye.effectiveBrightness) / 100) * 0.88 : 0;
  // Keep the historical zero-as-default behavior and saved long durations in
  // sync with the Gamma worker; they may be custom settings from older builds.
  const transitionMs = settings.eye.transitionMs || 2000;

  return (
    <div className="pointer-events-none fixed inset-0 select-none" style={{ cursor: "none" }}>
      <div
        className="absolute inset-0"
        data-testid="brightness-overlay-layer"
        style={{
          background: `rgba(0, 0, 0, ${dim})`,
          transition: `background ${transitionMs / 1000}s linear`,
        }}
      />
    </div>
  );
}
