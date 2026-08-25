import { HTTP_TOKEN_PATTERN } from "#veryfront/utils/cors-policy-limits.ts";
import { MAX_CSRF_NAME_LENGTH } from "#veryfront/utils/constants/security.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";

export const DEFAULT_CSRF_COOKIE_NAME = "__Host-vf_csrf";
export const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";
export const INSECURE_ORIGIN_CSRF_COOKIE_NAME = "vf_csrf";

/** Pick a default cookie name that browsers retain for this origin. */
export function defaultCsrfCookieNameForOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    const loopback = url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "http:" && !loopback
      ? INSECURE_ORIGIN_CSRF_COOKIE_NAME
      : DEFAULT_CSRF_COOKIE_NAME;
  } catch {
    return DEFAULT_CSRF_COOKIE_NAME;
  }
}

export interface CsrfNameOptions {
  cookieName?: string;
  headerName?: string;
}

export function requireCsrfName(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CSRF_NAME_LENGTH ||
    !HTTP_TOKEN_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} must be a valid HTTP token no longer than ${MAX_CSRF_NAME_LENGTH} characters`,
    );
  }
  return value;
}

export function resolveCsrfNames(options?: CsrfNameOptions): {
  cookieName: string;
  headerName: string;
} {
  return {
    cookieName: requireNonReservedCsrfCookieName(
      requireCsrfName(
        options?.cookieName ?? DEFAULT_CSRF_COOKIE_NAME,
        "CSRF cookieName",
      ),
    ),
    headerName: requireCsrfName(
      options?.headerName ?? DEFAULT_CSRF_HEADER_NAME,
      "CSRF headerName",
    ),
  };
}

/**
 * Name of the companion cookie that advertises configured CSRF names.
 *
 * The double-submit helper ships in browser bundles and cannot read server
 * configuration, so a project that sets `security.csrf.cookieName` or
 * `headerName` would otherwise have to hand-plumb those names into every call
 * site. The server publishes them here instead, and the helper discovers them.
 *
 * The names are not secrets: the header name is visible on every request the
 * browser makes, and the cookie name is visible in `document.cookie`. Tampering
 * cannot weaken validation, because the server still checks against its own
 * configuration; a forged value only makes the browser send a header the server
 * is not reading, which fails closed with a 403.
 */
export const CSRF_NAMES_COOKIE_NAME = "vf_csrf_names";

/**
 * Return the advertisement cookie name reserved for one browser origin.
 *
 * Cookies do not distinguish ports. Encoding the complete origin into the
 * name lets several local applications on one host retain their own discovery
 * values instead of taking turns overwriting one shared cookie. URL-safe
 * base64 keeps the derived name within the cookie-token alphabet and is
 * deterministic in both server and browser bundles.
 */
export function csrfNamesCookieName(origin: string): string {
  return `${CSRF_NAMES_COOKIE_NAME}_${base64urlEncode(origin)}`;
}

/** Reports whether a cookie name belongs to the discovery-cookie namespace. */
export function isReservedCsrfCookieName(cookieName: string): boolean {
  return cookieName === CSRF_NAMES_COOKIE_NAME ||
    cookieName.startsWith(`${CSRF_NAMES_COOKIE_NAME}_`);
}

/**
 * Separator between advertisement fields.
 *
 * `:` is deliberately outside HTTP_TOKEN_PATTERN, so it can never appear inside
 * a name that `requireCsrfName` accepts. A `.` would be ambiguous: `.` IS a
 * legal token character, so `a.b` plus `c` and `a` plus `b.c` would encode
 * identically and decode to the wrong pair.
 */
const CSRF_NAMES_SEPARATOR = ":";

/**
 * Reject a configured name that would collide with the advertisement cookie.
 *
 * Without this, `security.csrf.cookieName: "vf_csrf_names"` would make the
 * advertisement overwrite the random token cookie, silently disabling CSRF.
 */
export function requireNonReservedCsrfCookieName(cookieName: string): string {
  if (isReservedCsrfCookieName(cookieName)) {
    throw new TypeError(
      `CSRF cookieName must not use the reserved "${CSRF_NAMES_COOKIE_NAME}" advertisement ` +
        "namespace: reusing it would overwrite a configured-name cookie",
    );
  }
  return cookieName;
}

/**
 * Encode configured names for the advertisement cookie, or null when both are
 * the documented defaults and the helper already resolves them without help.
 *
 * The serving origin is included because cookies are shared across ports on the
 * same host, so two local projects on different ports would otherwise overwrite
 * each other's advertisement and each send the other's header name.
 *
 * The origin may itself contain colons (a port, or an IPv6 host such as
 * `http://[::1]:3000`). Decoding splits from the right, taking the last two
 * fields as the names, so no restriction on the origin is needed.
 */
export function encodeCsrfNamesAdvertisement(
  cookieName: string,
  headerName: string,
  origin: string,
): string | null {
  requireNonReservedCsrfCookieName(cookieName);
  if (cookieName === DEFAULT_CSRF_COOKIE_NAME && headerName === DEFAULT_CSRF_HEADER_NAME) {
    return null;
  }
  return [origin, cookieName, headerName].join(CSRF_NAMES_SEPARATOR);
}

/**
 * Decode an advertisement cookie value for the document's own origin.
 *
 * Returns null unless every field is present and both names are valid HTTP
 * tokens, so a malformed, truncated, or foreign-origin value falls back to the
 * defaults rather than producing a half-configured request.
 */
export function decodeCsrfNamesAdvertisement(
  value: string | undefined,
  documentOrigin: string,
): { cookieName: string; headerName: string } | null {
  if (!value) return null;
  // The origin itself contains a ":" (scheme and port), so split from the right:
  // the last two fields are the names, everything before them is the origin.
  const lastSep = value.lastIndexOf(CSRF_NAMES_SEPARATOR);
  if (lastSep <= 0) return null;
  const firstOfPair = value.lastIndexOf(CSRF_NAMES_SEPARATOR, lastSep - 1);
  if (firstOfPair <= 0) return null;

  const origin = value.slice(0, firstOfPair);
  const cookieName = value.slice(firstOfPair + 1, lastSep);
  const headerName = value.slice(lastSep + 1);
  if (origin !== documentOrigin) return null;

  try {
    return {
      cookieName: requireNonReservedCsrfCookieName(
        requireCsrfName(cookieName, "CSRF cookieName"),
      ),
      headerName: requireCsrfName(headerName, "CSRF headerName"),
    };
  } catch {
    return null;
  }
}
