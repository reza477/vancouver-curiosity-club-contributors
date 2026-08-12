import {
  parsePublicEventLaneSlug,
  type PublicEventLaneSlug,
} from "@/lib/public-event-lanes";

export type PublicEventLaneSelection = Readonly<{
  activeLaneSlug: PublicEventLaneSlug | null;
  invalid: boolean;
}>;

export function resolvePublicEventLaneSelection(
  value: unknown,
): PublicEventLaneSelection {
  if (value === undefined || value === "") {
    return Object.freeze({ activeLaneSlug: null, invalid: false });
  }
  const activeLaneSlug = parsePublicEventLaneSlug(value);
  return Object.freeze({
    activeLaneSlug,
    invalid: activeLaneSlug === null,
  });
}

