import { MeetupSyncError } from "./errors";
import { MAX_MEETUP_ICS_BYTES } from "./ics";
import { parseMeetupGroupCalendarFeedUrl } from "./url";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;

export type MeetupCalendarFetchResult =
  | Readonly<{
      etag: string | null;
      httpLastModified: string | null;
      status: "not_modified";
    }>
  | Readonly<{
      calendarText: string;
      etag: string | null;
      httpLastModified: string | null;
      status: "ok";
    }>;

export async function fetchMeetupCalendar(
  sourceUrl: string,
  options: Readonly<{
    etag?: string | null;
    fetcher?: typeof fetch;
    httpLastModified?: string | null;
    maxBytes?: number;
  }> = {},
): Promise<MeetupCalendarFetchResult> {
  const source = parseMeetupGroupCalendarFeedUrl(sourceUrl, "sourceUrl");
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_MEETUP_ICS_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_MEETUP_ICS_BYTES
  ) {
    throw new MeetupSyncError("response_too_large");
  }

  const headers = new Headers({
    Accept: "text/calendar",
    "User-Agent": "Vancouver-Curiosity-Club-Calendar-Sync/1.0",
  });
  const etag = safeConditionalHeader(options.etag, 512);
  const lastModified = safeConditionalHeader(
    options.httpLastModified,
    256,
  );
  if (etag) headers.set("If-None-Match", etag);
  if (lastModified) headers.set("If-Modified-Since", lastModified);

  let currentUrl = source.url;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      let response: Response;
      try {
        response = await fetcher(currentUrl, {
          cache: "no-store",
          headers,
          redirect: "manual",
          signal: abortController.signal,
        });
      } catch {
        throw new MeetupSyncError("network_error");
      }

      if (isRedirect(response.status)) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new MeetupSyncError("redirect_rejected");
        }
        const location = response.headers.get("location");
        if (!location) throw new MeetupSyncError("redirect_rejected");
        let redirected;
        try {
          redirected = parseMeetupGroupCalendarFeedUrl(
            new URL(location, currentUrl).toString(),
            "redirectUrl",
          );
        } catch {
          throw new MeetupSyncError("redirect_rejected");
        }
        if (redirected.groupSlug !== source.groupSlug) {
          throw new MeetupSyncError("redirect_rejected");
        }
        currentUrl = redirected.url;
        continue;
      }

      const responseEtag = safeResponseHeader(
        response.headers.get("etag"),
        512,
      );
      const responseLastModified = safeResponseHeader(
        response.headers.get("last-modified"),
        256,
      );
      if (response.status === 304) {
        return Object.freeze({
          status: "not_modified" as const,
          etag: responseEtag ?? etag,
          httpLastModified: responseLastModified ?? lastModified,
        });
      }
      if (response.status !== 200) {
        throw new MeetupSyncError("upstream_rejected");
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== "text/calendar") {
        throw new MeetupSyncError("upstream_rejected");
      }

      return Object.freeze({
        status: "ok" as const,
        calendarText: await readBoundedUtf8Body(response, maxBytes),
        etag: responseEtag,
        httpLastModified: responseLastModified,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedUtf8Body(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    throw new MeetupSyncError("response_too_large");
  }
  if (!response.body) throw new MeetupSyncError("upstream_rejected");

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new MeetupSyncError("response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MeetupSyncError) throw error;
    throw new MeetupSyncError("network_error");
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MeetupSyncError("calendar_invalid");
  }
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function safeConditionalHeader(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  return safeHeader(value, maxLength);
}

function safeResponseHeader(
  value: string | null,
  maxLength: number,
): string | null {
  if (value === null) return null;
  return safeHeader(value, maxLength);
}

function safeHeader(value: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > maxLength ||
    /[\u0000-\u001F\u007F]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}
