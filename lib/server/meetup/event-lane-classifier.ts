import type { PublicEventLaneSlug } from "@/lib/public-event-lanes";

const RESET_AND_MAKE_MARKERS = [
  "meditat",
  "journal",
  "sketch",
  "drawing",
  "paint night",
  "painting",
  "poetry night",
  "poetry circle",
  "poem",
  "silent reading",
  "creative workshop",
  "craft night",
  "crafting",
  "writing workshop",
  "threshold ritual",
  "reset",
  "coworking",
] as const;

const EXPLORE_MARKERS = [
  "paddleboard",
  "hike",
  "hiking",
  "walk",
  "beach sunset",
  "cleveland dam",
  "neighbourhood walk",
  "neighborhood walk",
  "city walk",
  "outdoor outing",
  "under the stars",
] as const;

const EAT_AND_PLAY_MARKERS = [
  "karaoke",
  "latin dance",
  "dance night",
  "dancing night",
  "dinner",
  "lunch",
  "brunch",
  "restaurant",
  "tasting",
  "small plates",
  "board game",
  "games night",
  "game night",
  "mangos",
] as const;

/**
 * Gives imported Meetup gatherings a durable activity lane without replacing
 * a later organizer choice. The order is intentional: Silent Reading Party is
 * reflective practice, while a paddleboarding picnic remains Explore.
 */
export function classifyMeetupEventLaneSlug(
  title: string,
): PublicEventLaneSlug {
  return classifyMeetupEventLane({ description: null, title });
}

export function classifyMeetupEventLane(
  input: Readonly<{ description: string | null; title: string }>,
): PublicEventLaneSlug {
  // Classify the advertised activity, not incidental words in the long-form
  // description. A film discussion can mention food, parks, walking, writing,
  // or rituals without becoming an Eat, Explore, or Reset gathering.
  const normalizedContent = input.title
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA");
  if (containsAny(normalizedContent, RESET_AND_MAKE_MARKERS)) {
    return "reset-and-make";
  }
  if (containsAny(normalizedContent, EXPLORE_MARKERS)) return "explore";
  if (containsAny(normalizedContent, EAT_AND_PLAY_MARKERS)) {
    return "eat-and-play";
  }
  return "think";
}

function containsAny(
  value: string,
  markers: readonly string[],
): boolean {
  return markers.some((marker) => value.includes(marker));
}
