import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  getRuntimeImagesBinding,
  getRuntimeMediaBucket,
} from "@/lib/server/media/runtime";
import { synchronizedMeetupPosterResponse } from "@/lib/server/meetup/poster-response";
import { safeErrorResponse } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{
    eventId: string;
    groupSlug: string;
    variant: string;
  }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { eventId, groupSlug, variant } = await context.params;
  try {
    return await synchronizedMeetupPosterResponse(
      request,
      {
        bucket: getRuntimeMediaBucket(),
        database: getRuntimeAuthConfiguration().database,
        images: getRuntimeImagesBinding(),
      },
      { eventId, groupSlug, variant },
    );
  } catch (error) {
    return safeErrorResponse(error, {
      operation: "read_synchronized_meetup_poster",
      route: "/meetup-posters/[groupSlug]/[eventId]/[variant]",
    });
  }
}
