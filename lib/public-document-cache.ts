export const PUBLIC_DOCUMENT_BROWSER_CACHE_CONTROL =
  "private, max-age=60, must-revalidate";

const PUBLIC_FORM_DOCUMENT_PATHS = new Set([
  "/contact",
  "/get-involved",
  "/host-an-event",
]);

export function isPublicFormDocumentPathname(
  pathname: string | null,
): boolean {
  if (pathname === null) return false;
  const routePathname = pathname.endsWith(".rsc")
    ? pathname.slice(0, -4) || "/"
    : pathname;
  return PUBLIC_FORM_DOCUMENT_PATHS.has(routePathname);
}
