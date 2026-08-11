import type { D1DatabaseLike } from "../auth";
import type { RuntimeImagesBinding } from "../media/runtime";
import type { R2BucketLike } from "../media/storage";
import { getSynchronizedMeetupPoster } from "./posters";

export async function synchronizedMeetupPosterResponse(
  request: Request,
  dependencies: Readonly<{
    bucket: R2BucketLike;
    database: Pick<D1DatabaseLike, "prepare">;
    images: RuntimeImagesBinding;
  }>,
  input: Readonly<{
    eventId: unknown;
    groupSlug: unknown;
    variant: unknown;
  }>,
): Promise<Response> {
  const poster = await getSynchronizedMeetupPoster(
    dependencies.database,
    dependencies.bucket,
    dependencies.images,
    input,
  );
  const etag = `"${poster.etag}-${String(input.variant)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: posterHeaders(poster.mimeType, etag),
    });
  }
  return new Response(poster.body, {
    headers: posterHeaders(poster.mimeType, etag),
  });
}

function posterHeaders(mimeType: string, etag: string): HeadersInit {
  return {
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    "Content-Disposition": "inline",
    "Content-Type": mimeType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
}
