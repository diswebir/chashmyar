import { useAppStore } from "../store/useAppStore";

/**
 * Software dimmer overlay — full-screen, click-through, always-on-top.
 * Uses the *effective* values from the Rust engine so the colour-safe whitelist
 * (and the 2 s lerp) fade this layer out smoothly as well.
 */
export default function DimmerOverlayWindow() {
  const eye = useAppStore((s) => s.snapshot.eye);
  const settings = useAppStore((s) => s.snapshot.settings);

  const active = settings.eye.enabled && !eye.whitelisted;
  const dim = active ? ((100 - eye.effectiveBrightness) / 100) * 0.88 : 0;

  const fallbackWarm = active && !eye.gammaSupported;
  // On driver failure the LUT never reaches the requested Kelvin; use the
  // resolved target, not the unchanged current LUT, to calculate the fallback.
  const warmth = Math.min(1, Math.max(0, (6500 - eye.targetKelvin) / 3800));
  const tintOpacity = fallbackWarm && warmth > 0 ? 0.12 + warmth * 0.5 : 0;

  return (
    <div className="pointer-events-none fixed inset-0 select-none" style={{ cursor: "none" }}>
      <div
        className="absolute inset-0"
        style={{
          background: `rgba(0, 0, 0, ${dim})`,
          transition: `background ${(settings.eye.transitionMs || 2000) / 1000}s linear`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `rgba(255, 124, 44, ${tintOpacity})`,
          mixBlendMode: "multiply",
          transition: `background ${(settings.eye.transitionMs || 2000) / 1000}s linear`,
        }}
      />
    </div>
  );
}
