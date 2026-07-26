import { archiveOrganizerVenue } from "@/lib/server/organizer/venues";
import {
  assertOnlyKeys,
  parseFiniteInteger,
  parseObject,
} from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const body = parseObject(
      await readOrganizerMutationBody(request, 2_000),
      "body",
    );
    assertOnlyKeys(body, ["expectedVersion"], "body");
    const venue = await archiveOrganizerVenue(
      database,
      identity,
      id,
      parseFiniteInteger(body.expectedVersion, {
        path: "expectedVersion",
        minimum: 1,
      }),
    );
    return privateOrganizerJson({ venue });
  } catch (error) {
    return organizerApiError(
      error,
      "archive_organizer_venue",
      "/api/organizer/venues/[id]/archive",
    );
  }
}
