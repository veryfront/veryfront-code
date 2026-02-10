/****
 * Client Hints utilities
 *
 * Handles extraction of client hints from request headers.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-Prefers-Color-Scheme
 */

export type ColorScheme = "light" | "dark";

export interface ColorSchemeResult {
  scheme: ColorScheme;
  fromParam: boolean;
  fromHeader: boolean;
}

export function getColorSchemeFromRequest(
  request: Request,
  url?: URL,
): ColorSchemeResult {
  const requestUrl = url ?? new URL(request.url);
  const colorModeParam = requestUrl.searchParams
    .get("color_mode")
    ?.trim()
    .toLowerCase();

  if (colorModeParam === "dark" || colorModeParam === "light") {
    return { scheme: colorModeParam, fromParam: true, fromHeader: false };
  }

  const headerValue = request.headers
    .get("Sec-CH-Prefers-Color-Scheme")
    ?.replace(/"/g, "")
    .trim()
    .toLowerCase();

  if (headerValue === "dark" || headerValue === "light") {
    return { scheme: headerValue, fromParam: false, fromHeader: true };
  }

  return { scheme: "light", fromParam: false, fromHeader: false };
}
