import {
  listMediaAssets,
  listPendingMediaCleanups,
  uploadMediaAsset,
} from "@/lib/server/media/storage";
import {
  getRuntimeMediaBucket,
  getRuntimeMediaDecodeProbe,
} from "@/lib/server/media/runtime";
import { revalidateAuthorizedMembership } from "@/lib/server/auth";
import { readMediaUploadRequest } from "@/lib/server/media/multipart";
import {
  organizerApiError,
  privateOrganizerJson,
  requireOrganizerApiActor,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { database, identity, membership } =
      await requireOrganizerApiActor([
      "owner",
      "administrator",
    ]);
    const cleanupPending = await listPendingMediaCleanups(database, identity);
    const assets = await listMediaAssets(database, identity);
    await revalidateAuthorizedMembership(
      database,
      identity,
      membership,
      { allowedRoles: ["owner", "administrator"] },
    );
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
