import {
  deleteMediaAsset,
  MediaAssetPublishedUseError,
  readMediaAsset,
  updateMediaAssetMetadata,
} from "@/lib/server/media/storage";
import { getRuntimeMediaBucket } from "@/lib/server/media/runtime";
import { parseFiniteInteger, parseObject } from "@/lib/validation";
import {
  organizerApiError,
  privateOrganizerJson,
  readOrganizerMutationBody,
  requireOrganizerApiActor,
} from "../../_shared";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    return privateOrganizerJson({
      asset: await readMediaAsset(database, identity, id),
    });
  } catch (error) {
    return organizerApiError(
      error,
      "read_media_asset",
      "/api/organizer/media/[id]",
    );
  }
}

export async function PATCH(
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
      await readOrganizerMutationBody(request, 16_384),
      "body",
    );
    const asset = await updateMediaAssetMetadata(
      database,
      identity,
      id,
      body.expectedVersion,
      body.metadata,
    );
    return privateOrganizerJson({ asset });
  } catch (error) {
    if (error instanceof MediaAssetPublishedUseError) {
      return privateOrganizerJson(
        {
          blockers: error.blockers,
          error: {
            blockers: error.blockers,
            code: error.code,
            hasMoreBlockers: error.hasMoreBlockers,
            message: error.publicMessage,
          },
          hasMoreBlockers: error.hasMoreBlockers,
        },
        { status: error.status },
      );
    }
    return organizerApiError(
      error,
      "update_media_asset",
      "/api/organizer/media/[id]",
    );
  }
}

export async function DELETE(
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
      await readOrganizerMutationBody(request, 4_096),
      "body",
    );
    const result = await deleteMediaAsset(
      database,
      getRuntimeMediaBucket(),
      identity,
      id,
      parseFiniteInteger(body.expectedVersion, {
        path: "expectedVersion",
        minimum: 1,
      }),
    );
    return privateOrganizerJson(
      result,
      result.deleted ? undefined : { status: 409 },
    );
  } catch (error) {
    return organizerApiError(
      error,
      "delete_media_asset",
      "/api/organizer/media/[id]",
    );
  }
}
