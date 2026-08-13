import { parsePublicEventLaneSlug } from "@/lib/public-event-lanes";
import { trustedPublicRequestOrigin } from "@/lib/public-domain";

/**
 * Keep legacy Calendar bookmarks useful while Events remains the single
 * public discovery destination. A route handler reads the request URL
 * directly so the selected month survives the redirect in every runtime.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const source = new URL(request.url);
  const destination = new URL(
    "/events",
    trustedPublicRequestOrigin(source),
  );
  const monthValues = source.searchParams.getAll("month");
  const month = monthValues.length === 1 ? monthValues[0] : "";
  const laneValues = source.searchParams.getAll("lane");
  const laneSlug =
    laneValues.length === 1
      ? parsePublicEventLaneSlug(laneValues[0])
      : null;

  if (month) {
    destination.searchParams.set("month", month);
  }
  if (laneSlug) {
    destination.searchParams.set("lane", laneSlug);
  }

  return Response.redirect(destination, 308);
}
