export const STAGE_SWITCH_HYSTERESIS_PX = 48;

export type StageCandidate = Readonly<{
  index: number;
  centerY: number;
}>;

export function rememberStageReveal<T extends object>(
  history: WeakSet<T>,
  item: T,
): boolean {
  if (history.has(item)) return false;
  history.add(item);
  return true;
}

export function shouldQueueStageActivation({
  requestedIndex,
  activeIndex,
  queuedIndex,
  transitionTargetIndex,
}: Readonly<{
  requestedIndex: number;
  activeIndex: number | null;
  queuedIndex: number | null;
  transitionTargetIndex: number | null;
}>): boolean {
  return (
    requestedIndex !== activeIndex &&
    requestedIndex !== queuedIndex &&
    requestedIndex !== transitionTargetIndex
  );
}

export function selectStableStageIndex(
  candidates: readonly StageCandidate[],
  activeIndex: number | null,
  readingLineY: number,
  hysteresisPx = STAGE_SWITCH_HYSTERESIS_PX,
): number | null {
  if (candidates.length === 0) return null;

  const distanceFromReadingLine = (candidate: StageCandidate) =>
    Math.abs(candidate.centerY - readingLineY);
  const nearest = candidates.reduce((closest, candidate) =>
    distanceFromReadingLine(candidate) < distanceFromReadingLine(closest)
      ? candidate
      : closest,
  );
  const active = candidates.find((candidate) => candidate.index === activeIndex);

  if (!active || nearest.index === active.index) return nearest.index;

  const activeDistance = distanceFromReadingLine(active);
  const nearestDistance = distanceFromReadingLine(nearest);
  const requiredAdvantage = Math.max(0, hysteresisPx);

  return activeDistance - nearestDistance >= requiredAdvantage
    ? nearest.index
    : active.index;
}
