export const HASHED_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
export const EVENT_POSTER_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";
export const PUBLIC_FONT_CACHE_CONTROL =
  "public, max-age=3600, must-revalidate";

// This is an asset-layout detail, not an access-control boundary. Only the
// explicitly validated public files below may be copied into this namespace.
export const WORKER_ASSET_ORIGIN_PREFIX = "/__vcc_asset_origin__";
export const WORKER_OWNED_ASSET_DIRECTORIES = [
  "assets",
  "_next/static",
  "event-posters",
  "fonts",
] as const;

const CONTENT_HASHED_ASSET_PATH =
  /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;
const VINEXT_HASHED_CHUNK_PATH =
  /^\/_next\/static\/chunks\/(?=[A-Za-z0-9_.-]{1,240}$)[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.js$/u;
const VINEXT_HASHED_STYLESHEET_PATH =
  /^\/_next\/static\/css\/(?=[A-Za-z0-9_.-]{1,240}$)[A-Za-z0-9_.-]+[.-][A-Za-z0-9_-]{8,}\.css$/u;
const VINEXT_HASHED_FONT_PATH =
  /^\/_next\/static\/_vinext_fonts\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.woff2$/u;
const VINEXT_HASHED_MEDIA_PATH =
  /^\/_next\/static\/media\/(?=[A-Za-z0-9_.-]{1,240}$)[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{8,}\.(?:avif|gif|ico|jpe?g|png|webp|woff2?)$/u;
const VINEXT_BUILD_MANIFEST_PATH =
  /^\/_next\/static\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:_buildManifest|_ssgManifest)\.js$/u;
const REGENERABLE_EVENT_POSTER_PATH =
  /^\/event-posters\/(?=[A-Za-z0-9._-]{1,180}$)[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|webp|jpeg)$/u;
const PUBLIC_FONT_PATH =
  /^\/fonts\/(?=[A-Za-z0-9._-]{1,180}$)[A-Za-z0-9][A-Za-z0-9._-]*\.woff2$/u;

export function publicAssetCacheControl(input: Readonly<{
  method: string;
  pathname: string;
  status: number;
}>): string | null {
  const method = input.method.toUpperCase();
  if (
    (input.status !== 200 && input.status !== 304) ||
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
  if (isPublicFontPath(input.pathname)) {
    return PUBLIC_FONT_CACHE_CONTROL;
  }
  return null;
}

export function publicAssetOriginPath(input: Readonly<{
  method: string;
  pathname: string;
}>): string | null {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  if (
    !isContentHashedAssetPath(input.pathname) &&
    !isRegenerableEventPosterPath(input.pathname) &&
    !isPublicFontPath(input.pathname)
  ) {
    return null;
  }
  return `${WORKER_ASSET_ORIGIN_PREFIX}${input.pathname}`;
}

export function publicAssetContentType(pathname: string): string | null {
  if (
    !isContentHashedAssetPath(pathname) &&
    !isRegenerableEventPosterPath(pathname) &&
    !isPublicFontPath(pathname)
  ) {
    return null;
  }
  if (pathname.endsWith(".avif")) return "image/avif";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpeg") || pathname.endsWith(".jpg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".woff2")) return "font/woff2";
  return null;
}

export function isContentHashedAssetPath(pathname: string): boolean {
  return (
    CONTENT_HASHED_ASSET_PATH.test(pathname) ||
    isVinextStaticAssetPath(pathname)
  );
}

function isVinextStaticAssetPath(pathname: string): boolean {
  return (
    VINEXT_HASHED_CHUNK_PATH.test(pathname) ||
    VINEXT_HASHED_STYLESHEET_PATH.test(pathname) ||
    VINEXT_HASHED_FONT_PATH.test(pathname) ||
    VINEXT_HASHED_MEDIA_PATH.test(pathname) ||
    VINEXT_BUILD_MANIFEST_PATH.test(pathname)
  );
}

export function isRegenerableEventPosterPath(pathname: string): boolean {
  return REGENERABLE_EVENT_POSTER_PATH.test(pathname);
}

export function isPublicFontPath(pathname: string): boolean {
  return PUBLIC_FONT_PATH.test(pathname);
}
