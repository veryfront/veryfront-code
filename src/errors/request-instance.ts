import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "./diagnostic-policy.ts";

const RELATIVE_REQUEST_URL_BASE = "http://veryfront.invalid";

/**
 * Best-effort request-path extraction for error diagnostics.
 *
 * Request objects and URL strings can originate in adapters, so both property
 * access and URL parsing are treated as untrusted. Relative URLs are resolved
 * against a fixed, non-routable base solely to obtain their pathname.
 */
export function extractRequestPathname(request: unknown): string | undefined {
  try {
    if (
      (typeof request !== "object" || request === null) &&
      typeof request !== "function"
    ) {
      return undefined;
    }

    const value = (request as { readonly url?: unknown }).url;
    if (
      typeof value !== "string" ||
      value.length > ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS
    ) {
      return undefined;
    }

    const normalized = value.trim();
    if (normalized.length === 0) return undefined;
    return new URL(normalized, RELATIVE_REQUEST_URL_BASE).pathname;
  } catch {
    return undefined;
  }
}

/** Extract a request pathname from an adapter handler context. */
export function extractHandlerRequestPathname(
  context: unknown,
): string | undefined {
  try {
    if (
      (typeof context !== "object" || context === null) &&
      typeof context !== "function"
    ) {
      return undefined;
    }
    return extractRequestPathname(
      (context as { readonly req?: unknown }).req,
    );
  } catch {
    return undefined;
  }
}
