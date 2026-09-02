export const PUBLIC_ARTWORK_MOTION_ENABLED = true;

export const PUBLIC_ARTWORK_MOTION = Object.freeze({
  artworkDurationMs: 560,
  easing: "cubic-bezier(.22, 1, .36, 1)",
  interactionDurationMs: 190,
  maximumDesktopDistancePx: 24,
  maximumMobileDistancePx: 14,
  stageMediaQuery:
    "(min-width: 64rem) and (min-height: 42rem) and (prefers-reduced-motion: no-preference)",
  staggerMs: 60,
});
