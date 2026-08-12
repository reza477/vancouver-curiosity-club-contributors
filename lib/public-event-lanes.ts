export const PUBLIC_EVENT_LANE_SLUGS = [
  "think",
  "reset-and-make",
  "explore",
  "eat-and-play",
] as const;

export type PublicEventLaneSlug =
  (typeof PUBLIC_EVENT_LANE_SLUGS)[number];

export function parsePublicEventLaneSlug(
  value: unknown,
): PublicEventLaneSlug | null {
  return typeof value === "string" &&
    (PUBLIC_EVENT_LANE_SLUGS as readonly string[]).includes(value)
    ? (value as PublicEventLaneSlug)
    : null;
}

