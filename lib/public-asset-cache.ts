export const HASHED_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
export const EVENT_POSTER_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";

const CONTENT_HASHED_ASSET_PATH =
  /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;
const REGENERABLE_EVENT_POSTER_PATH =
  /^\/event-posters\/(?=[A-Za-z0-9._-]{1,180}$)[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|webp|jpeg)$/u;

export function publicAssetCacheControl(input: Readonly<{
  method: string;
  pathname: string;
  status: number;
}>): string | null {
  const method = input.method.toUpperCase();
  if (
    input.status !== 200 ||
    (method !== "GET" && method !== "HEAD")
  ) {
    return null;
  }
  if (isContentHashedAssetPath(input.pathname)) {
    return HASHED_ASSET_CACHE_CONTROL;
  }
  if (isRegenerableEventPosterPath(input.pathname)) {
    return EVENT_POSTER_CACHE_CONTROL;
  }
  return null;
}

export function isContentHashedAssetPath(pathname: string): boolean {
  return CONTENT_HASHED_ASSET_PATH.test(pathname);
}

export function isRegenerableEventPosterPath(pathname: string): boolean {
  return REGENERABLE_EVENT_POSTER_PATH.test(pathname);
}
