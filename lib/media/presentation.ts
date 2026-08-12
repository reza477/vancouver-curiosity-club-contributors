export const REPEATED_MEETUP_EVENT_POSTER_CREDIT =
  "Vancouver Curiosity Club event poster via Meetup";

export function discoveryArtworkCredit(credit: string): string | null {
  return credit === REPEATED_MEETUP_EVENT_POSTER_CREDIT ? null : credit;
}

export function focalPointPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value / 100));
}

export function focalPointObjectPosition(
  focalPoint: Readonly<{ x: number; y: number }>,
): string {
  return `${focalPointPercent(focalPoint.x)}% ${focalPointPercent(
    focalPoint.y,
  )}%`;
}

export function responsiveImageSrcSet(
  candidates: readonly Readonly<{ url: string; width: number }>[],
): string {
  const byWidth = new Map<number, string>();
  for (const candidate of candidates) {
    if (
      typeof candidate.url !== "string" ||
      candidate.url.length === 0 ||
      !Number.isSafeInteger(candidate.width) ||
      candidate.width < 1
    ) {
      continue;
    }
    byWidth.set(candidate.width, candidate.url);
  }
  return [...byWidth.entries()]
    .sort(([left], [right]) => left - right)
    .map(([width, url]) => `${url} ${width}w`)
    .join(", ");
}
