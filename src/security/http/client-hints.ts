/**
 * Client Hints utilities
 *
 * Handles extraction of client hints from request headers.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-Prefers-Color-Scheme
 */

export type ColorScheme = "light" | "dark";

/**
 * Extract color scheme preference from Sec-CH-Prefers-Color-Scheme header
 *
 * @param request - The incoming request
 * @returns The color scheme preference, defaults to "light"
 */
export function getColorSchemeFromRequest(request: Request): ColorScheme {
  const header = request.headers.get("Sec-CH-Prefers-Color-Scheme");

  if (!header) {
    return "light";
  }

  // Header value is quoted: "dark" or "light"
  const value = header.replace(/"/g, "").trim().toLowerCase();

  if (value === "dark") {
    return "dark";
  }

  return "light";
}
