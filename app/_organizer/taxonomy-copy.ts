const REQUIRED_CANONICAL_LANE_SLUGS = new Set([
  "think",
  "reset-and-make",
  "explore",
  "eat-and-play",
]);

export function blockedLaneArchiveExplanation(slug: string): string {
  return REQUIRED_CANONICAL_LANE_SLUGS.has(slug)
    ? "This required canonical lane remains active and cannot be archived or deleted."
    : "This lane remains active while established references block archiving or deletion.";
}
