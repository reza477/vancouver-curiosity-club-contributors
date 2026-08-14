import type { PublicEventLaneSlug } from "@/lib/public-event-lanes";

export const PUBLIC_EVENT_LANE_OPTIONS = Object.freeze([
  Object.freeze({ name: "Think", slug: "think" }),
  Object.freeze({ name: "Reset & Make", slug: "reset-and-make" }),
  Object.freeze({ name: "Explore", slug: "explore" }),
  Object.freeze({ name: "Eat & Play", slug: "eat-and-play" }),
] satisfies readonly Readonly<{
  name: string;
  slug: PublicEventLaneSlug;
}>[]);

export type PublicEventsView = "calendar" | "upcoming";

export type PublicEventsViewSelection = Readonly<{
  activeView: PublicEventsView;
  invalid: boolean;
}>;

export function resolvePublicEventsView(
  value: unknown,
): PublicEventsViewSelection {
  if (value === undefined || value === "" || value === "upcoming") {
    return Object.freeze({ activeView: "upcoming", invalid: false });
  }
  if (value === "calendar") {
    return Object.freeze({ activeView: "calendar", invalid: false });
  }
  return Object.freeze({ activeView: "upcoming", invalid: true });
}

export function publicEventsHref(
  input: Readonly<{
    clubSlug?: string | null;
    laneSlug?: PublicEventLaneSlug | null;
    month?: string | null;
    page?: number | null;
    route?: string;
    view: PublicEventsView;
  }>,
): string {
  const route = input.route ?? "/events";
  const [path, existingQuery = ""] = route.split("?", 2);
  const params = new URLSearchParams(existingQuery);

  if (input.view === "calendar") params.set("view", "calendar");
  else params.delete("view");

  setOptionalParam(params, "lane", input.laneSlug);
  setOptionalParam(params, "club", input.clubSlug);

  if (input.view === "calendar") {
    setOptionalParam(params, "month", input.month);
    params.delete("page");
  } else {
    params.delete("month");
    if (input.page && input.page > 1) params.set("page", String(input.page));
    else params.delete("page");
  }

  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function setOptionalParam(
  params: URLSearchParams,
  name: string,
  value: string | null | undefined,
): void {
  if (value) params.set(name, value);
  else params.delete(name);
}
