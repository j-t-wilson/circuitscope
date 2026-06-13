// Map a normalized intensity t in [0, 1] onto a teal → amber → red heat ramp.
// Used to color detector event fractions so anomalously hot detectors pop out.
export function heatColor(t, isDark) {
  const x = Math.max(0, Math.min(1, t));
  const hue = 170 * (1 - x);
  const sat = 60 + 25 * x;
  const light = isDark ? 64 - 8 * x : 42 - 6 * x;
  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}
