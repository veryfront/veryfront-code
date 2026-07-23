/**
 * Flattens matched route params (which may be arrays for catch-all `[...slug]`
 * segments) into the `Record<string, string>` shape the router value exposes.
 *
 * Catch-all segments are **joined with `/`** so no path information is lost —
 * `/docs/guides/intro` -> `{ slug: "guides/intro" }`, not `{ slug: "guides" }`.
 * This matches the client SPA normalizer and the RSC hydration normalizer, so
 * server and client agree.
 */
export function flattenRouteParams(
  params?: Record<string, string | string[]>,
): Record<string, string> {
  if (!params) return {};
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    Object.defineProperty(flat, key, {
      configurable: true,
      enumerable: true,
      value: Array.isArray(value) ? value.join("/") : value,
      writable: true,
    });
  }
  return flat;
}
