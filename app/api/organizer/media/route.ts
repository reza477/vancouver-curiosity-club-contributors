import {
  listMediaAssets,
  listPendingMediaCleanups,
  uploadMediaAsset,
} from "@/lib/server/media/storage";
import {
  getRuntimeMediaBucket,
  getRuntimeMediaDecodeProbe,
} from "@/lib/server/media/runtime";
import { readMediaUploadRequest } from "@/lib/server/media/multipart";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const [assets, cleanupPending] = await Promise.all([
      listMediaAssets(database, identity),
      listPendingMediaCleanups(database, identity),
    ]);
    return privateOrganizerJson({ assets, cleanupPending });
  } catch (error) {
    return organizerApiError(
      error,
      "list_media_assets",
      "/api/organizer/media",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { database, identity } = await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const asset = await uploadMediaAsset(
      database,
      getRuntimeMediaBucket(),
      identity,
      await readMediaUploadRequest(request),
      { decodeProbe: getRuntimeMediaDecodeProbe() },
    );
    return privateOrganizerJson({ asset }, { status: 201 });
  } catch (error) {
    return organizerApiError(
      error,
      "upload_media_asset",
      "/api/organizer/media",
    );
  }
}
