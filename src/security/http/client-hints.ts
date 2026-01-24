/**
 * Client Hints utilities
 *
 * Handles extraction of client hints from request headers.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-Prefers-Color-Scheme
 */

export type ColorScheme = "light" | "dark";

export interface ColorSchemeResult {
  scheme: ColorScheme;
  fromParam: boolean;
}

/**
 * Extract color scheme preference from multiple sources (priority order):
 * 1. `color_mode` query parameter (explicit override)
 * 2. `Sec-CH-Prefers-Color-Scheme` header (browser preference)
 * 3. Default: "light"
 *
 * @param request - The incoming request
 * @param url - Optional URL to check for color_mode query param
 * @returns Object with scheme and whether it came from a URL param
 */
export function getColorSchemeFromRequest(
  request: Request,
  url?: URL,
): ColorSchemeResult {
  const requestUrl = url ?? new URL(request.url);
  const colorModeParam = requestUrl.searchParams.get("color_mode")?.trim().toLowerCase();

  if (colorModeParam === "dark" || colorModeParam === "light") {
    return { scheme: colorModeParam, fromParam: true };
  }

  const headerValue = request.headers
    .get("Sec-CH-Prefers-Color-Scheme")
    ?.replace(/"/g, "")
    .trim()
    .toLowerCase();

  if (headerValue === "dark") {
    return { scheme: "dark", fromParam: false };
  }

  return { scheme: "light", fromParam: false };
}
