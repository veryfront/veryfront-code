const ROUTE_BASE_URL = "https://veryfront.invalid/";

/**
 * Convert an untrusted renderer slug or URL pathname into a canonical
 * same-origin pathname.
 *
 * Exactly one leading slash prevents `new URL(pathname, base)` from treating
 * protocol-relative or backslash-delimited input as a new authority. URL
 * parsing then applies the same dot-segment semantics as Request/URL, and the
 * trailing-slash policy keeps cache publication and invalidation comparable.
 */
export function normalizeRoutePathname(value: string): string {
  const trimmed = value.trim();
  const queryIndex = trimmed.search(/[?#]/);
  const route = (queryIndex < 0 ? trimmed : trimmed.slice(0, queryIndex))
    .replaceAll("\\", "/");
  const originPath = `/${route.replace(/^\/+/, "")}`;
  const pathname = new URL(originPath || "/", ROUTE_BASE_URL).pathname;
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  const normalized = withoutTrailingSlash || "/";
  return normalized === "/index" ? "/" : normalized;
}
