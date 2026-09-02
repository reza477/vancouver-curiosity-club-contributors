import type { CSSProperties } from "react";

import {
  parsePublicEventLaneSlug,
  type PublicEventLaneSlug,
} from "@/lib/public-event-lanes";

export type PublicProgramStreamVisualId =
  | "think"
  | "reset-make"
  | "explore"
  | "eat-play";

export type PublicProgramStreamVisual = Readonly<{
  accentCssValue: `var(--${string})`;
  accentToken: `--${string}`;
  canonicalLaneSlug: PublicEventLaneSlug | null;
  id: PublicProgramStreamVisualId | "neutral";
  label: string;
  style: CSSProperties & Readonly<{ "--program-stream-accent": string }>;
}>;

function defineProgramStreamVisual(
  definition: Omit<PublicProgramStreamVisual, "style">,
): PublicProgramStreamVisual {
  return Object.freeze({
    ...definition,
    style: Object.freeze({
      "--program-stream-accent": definition.accentCssValue,
    }),
  });
}

/**
 * Presentation-only identities keyed by stable internal IDs. Canonical lane
 * slugs select these entries; visible names, titles, emoji, descriptions, and
 * artwork never participate in stream detection.
 */
export const PUBLIC_PROGRAM_STREAM_VISUAL_MAP = Object.freeze({
  think: defineProgramStreamVisual({
    accentCssValue: "var(--teal)",
    accentToken: "--teal",
    canonicalLaneSlug: "think",
    id: "think",
    label: "Think",
  }),
  "reset-make": defineProgramStreamVisual({
    accentCssValue: "var(--coral-strong)",
    accentToken: "--coral-strong",
    canonicalLaneSlug: "reset-and-make",
    id: "reset-make",
    label: "Reset & Make",
  }),
  explore: defineProgramStreamVisual({
    accentCssValue: "var(--amber-strong)",
    accentToken: "--amber-strong",
    canonicalLaneSlug: "explore",
    id: "explore",
    label: "Explore",
  }),
  "eat-play": defineProgramStreamVisual({
    accentCssValue: "var(--accent)",
    accentToken: "--accent",
    canonicalLaneSlug: "eat-and-play",
    id: "eat-play",
    label: "Eat & Play",
  }),
} satisfies Readonly<Record<PublicProgramStreamVisualId, PublicProgramStreamVisual>>);

export const PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL =
  defineProgramStreamVisual({
    accentCssValue: "var(--ink)",
    accentToken: "--ink",
    canonicalLaneSlug: null,
    id: "neutral",
    label: "Unspecified program stream",
  });

const VISUAL_BY_CANONICAL_LANE_SLUG = Object.freeze({
  think: PUBLIC_PROGRAM_STREAM_VISUAL_MAP.think,
  "reset-and-make": PUBLIC_PROGRAM_STREAM_VISUAL_MAP["reset-make"],
  explore: PUBLIC_PROGRAM_STREAM_VISUAL_MAP.explore,
  "eat-and-play": PUBLIC_PROGRAM_STREAM_VISUAL_MAP["eat-play"],
} satisfies Readonly<Record<PublicEventLaneSlug, PublicProgramStreamVisual>>);

export function publicProgramStreamVisualForLaneSlug(
  laneSlug: unknown,
): PublicProgramStreamVisual {
  const canonicalLaneSlug = parsePublicEventLaneSlug(laneSlug);
  return canonicalLaneSlug
    ? VISUAL_BY_CANONICAL_LANE_SLUG[canonicalLaneSlug]
    : PUBLIC_PROGRAM_STREAM_NEUTRAL_VISUAL;
}
