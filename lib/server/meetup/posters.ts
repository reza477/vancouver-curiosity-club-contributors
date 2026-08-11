import { parseIdentifier } from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import type { D1DatabaseLike } from "../auth";
import {
  validateOriginalImage,
  type ValidatedImage,
} from "../media/image-validation";
import type { RuntimeImagesBinding } from "../media/runtime";
import type { R2BucketLike } from "../media/storage";

const SOURCE_TYPE = "meetup_ics";
const MAX_POSTER_BYTES = 8 * 1024 * 1024;
export const SYNCHRONIZED_MEETUP_POSTER_VARIANTS = Object.freeze({
  large: Object.freeze({ height: 900, width: 1_600 }),
  medium: Object.freeze({ height: 540, width: 960 }),
  small: Object.freeze({ height: 270, width: 480 }),
} as const);

export type SynchronizedMeetupPoster = Readonly<{
  body: ArrayBuffer;
  etag: string;
  mimeType: "image/webp";
}>;

export async function getSynchronizedMeetupPoster(
  database: Pick<D1DatabaseLike, "prepare">,
  bucket: R2BucketLike,
  images: RuntimeImagesBinding,
  input: Readonly<{
    eventId: unknown;
    fetcher?: typeof fetch;
    groupSlug: unknown;
    variant: unknown;
  }>,
): Promise<SynchronizedMeetupPoster> {
  const groupSlug = parseIdentifier(input.groupSlug, "groupSlug");
  const eventId = parseIdentifier(input.eventId, "eventId");
  const variant = parsePosterVariant(input.variant);
  const eventUrl = `https://www.meetup.com/${groupSlug}/events/${eventId}/`;
  const row = await database
    .prepare(
      `SELECT content.poster_source_url
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.active_generation_id
        AND generation.organization_id = source.organization_id
        AND generation.sync_source_id = source.id
        AND generation.state = 'published'
        AND generation.published_at IS NOT NULL
        AND generation.processed_item_count = generation.expected_item_count
       JOIN meetup_event_snapshots AS snapshot
         ON snapshot.organization_id = source.organization_id
        AND snapshot.sync_source_id = source.id
        AND snapshot.generation_id = generation.id
       JOIN meetup_event_snapshot_public_contents AS content
         ON content.snapshot_id = snapshot.id
       JOIN events AS event
         ON event.id = snapshot.event_id
        AND event.organization_id = snapshot.organization_id
        AND event.visibility = 'public'
        AND event.published_at IS NOT NULL
        AND event.deleted_at IS NULL
       WHERE source.source_type = ?
         AND source.enabled = 1
         AND source.deleted_at IS NULL
         AND snapshot.event_url = ?
         AND snapshot.status IN ('confirmed', 'tentative', 'cancelled')
         AND (
           snapshot.status <> 'cancelled'
           OR EXISTS (
             SELECT 1
             FROM meetup_event_snapshots AS previous_snapshot
             JOIN meetup_sync_generations AS previous_generation
               ON previous_generation.id = previous_snapshot.generation_id
              AND previous_generation.organization_id =
                  previous_snapshot.organization_id
              AND previous_generation.sync_source_id =
                  previous_snapshot.sync_source_id
              AND previous_generation.state = 'published'
              AND previous_generation.published_at IS NOT NULL
              AND previous_generation.processed_item_count =
                  previous_generation.expected_item_count
             WHERE previous_snapshot.organization_id =
                   snapshot.organization_id
               AND previous_snapshot.sync_source_id =
                   snapshot.sync_source_id
               AND previous_snapshot.external_id = snapshot.external_id
               AND previous_snapshot.generation_id <> snapshot.generation_id
               AND previous_snapshot.status IN ('confirmed', 'tentative')
           )
         )
         AND content.poster_source_url IS NOT NULL
       LIMIT 2`,
    )
    .bind(SOURCE_TYPE, eventUrl)
    .all<Record<string, unknown>>();
  const rows = row.results ?? [];
  if (rows.length !== 1) throw posterNotFound();
  const sourceUrl = parsePosterSourceUrl(rows[0]?.poster_source_url);
  const sourceDigest = await sha256Hex(sourceUrl);
  const target = SYNCHRONIZED_MEETUP_POSTER_VARIANTS[variant];
  const objectKey = `meetup-posters/${sourceDigest}/${target.width}.webp`;

  const cached = await bucket.get(objectKey);
  if (cached) {
    return Object.freeze({
      body: cached.body
        ? await new Response(cached.body).arrayBuffer()
        : await cached.arrayBuffer(),
      etag: sourceDigest,
      mimeType: "image/webp" as const,
    });
  }

  const original = await fetchAndValidatePoster(
    input.fetcher ?? fetch,
    sourceUrl,
  );
  const originalBody = new Uint8Array(original.bytes.byteLength);
  originalBody.set(original.bytes);
  const transformed = await images
    .input(new Blob([originalBody.buffer], { type: original.mimeType }).stream())
    .transform({ fit: "cover", height: target.height, width: target.width })
    .output({ format: "image/webp", quality: 85 });
  const response = await transformed.response();
  if (!response.ok) throw posterUnavailable();
  const bytes = new Uint8Array(
    await readBoundedPosterBody(response, MAX_POSTER_BYTES),
  );
  const validated = await validateOriginalImage({
    bytes,
    declaredMimeType: "image/webp",
    fileName: "meetup-poster.webp",
  });
  assertSuitableVariant(validated, target);
  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/webp" },
  });
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return Object.freeze({
    body: body.buffer,
    etag: sourceDigest,
    mimeType: "image/webp" as const,
  });
}

function parsePosterVariant(
  value: unknown,
): keyof typeof SYNCHRONIZED_MEETUP_POSTER_VARIANTS {
  if (value === "small" || value === "medium" || value === "large") {
    return value;
  }
  throw posterNotFound();
}

function parsePosterSourceUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw posterNotFound();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw posterNotFound();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "secure.meetupstatic.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/photos\/event\/[0-9a-f/]+\/highres_[0-9]+\.jpe?g$/iu.test(
      parsed.pathname,
    )
  ) {
    throw posterNotFound();
  }
  return parsed.href;
}

async function fetchAndValidatePoster(
  fetcher: typeof fetch,
  sourceUrl: string,
): Promise<ValidatedImage> {
  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      cache: "no-store",
      headers: {
        Accept: "image/jpeg",
        "User-Agent": "Vancouver-Curiosity-Club-Meetup-Poster-Sync/1.0",
      },
      redirect: "manual",
    });
  } catch {
    throw posterUnavailable();
  }
  if (response.status !== 200 || response.url !== sourceUrl) {
    throw posterUnavailable();
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "image/jpeg") throw posterUnavailable();
  const bytes = new Uint8Array(
    await readBoundedPosterBody(response, MAX_POSTER_BYTES),
  );
  const original = await validateOriginalImage({
    bytes,
    declaredMimeType: "image/jpeg",
    fileName: "meetup-poster.jpeg",
  });
  const ratio = original.displayWidth / original.displayHeight;
  if (
    original.displayWidth < 480 ||
    original.displayHeight < 270 ||
    ratio < 1.7 ||
    ratio > 1.82
  ) {
    throw posterUnavailable();
  }
  return original;
}

async function readBoundedPosterBody(
  response: Response,
  maximum: number,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximum)
  ) {
    throw posterUnavailable();
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 12 || bytes.byteLength > maximum) {
    throw posterUnavailable();
  }
  return bytes;
}

function assertSuitableVariant(
  image: ValidatedImage,
  target: Readonly<{ height: number; width: number }>,
): void {
  if (
    image.mimeType !== "image/webp" ||
    image.displayWidth !== target.width ||
    image.displayHeight !== target.height
  ) {
    throw posterUnavailable();
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function posterNotFound(): SafeApplicationError {
  return new SafeApplicationError(
    "not_found",
    404,
    "The event poster was not found.",
  );
}

function posterUnavailable(): SafeApplicationError {
  return new SafeApplicationError(
    "service_unavailable",
    503,
    "The event poster is temporarily unavailable.",
  );
}
