const URL_VALIDATION_BASE = "https://upload.invalid/";
const SAFE_UPLOAD_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_UPLOAD_URL_LENGTH = 16_384;
const SAFE_UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

interface UploadOwnerDocument {
  baseURI: string;
  defaultView: {
    open: (url?: string | URL, target?: string, features?: string) => unknown;
  } | null;
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function parseUploadUrl(value: unknown, baseUrl: string): URL | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_UPLOAD_URL_LENGTH ||
    containsAsciiControlCharacter(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate, baseUrl);
    if (!SAFE_UPLOAD_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username.length > 0 || parsed.password.length > 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Whether an upload identity is safe to pass across storage boundaries. */
export function isSafeUploadId(
  value: unknown,
  maxLength = 128,
): value is string {
  return typeof value === "string" &&
    Number.isSafeInteger(maxLength) &&
    maxLength > 0 &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_UPLOAD_ID_PATTERN.test(value);
}

/**
 * Whether a URL returned for an upload can be admitted into client state.
 *
 * Relative URLs are allowed for same-origin custom routes. Executable,
 * credential-bearing, process-local blob, and local-resource URLs are
 * deliberately excluded; inline guest-mode `data:` URLs are generated
 * internally by `useUpload` and never pass through this durable boundary.
 */
export function isSafeUploadUrl(value: unknown): value is string {
  return parseUploadUrl(value, URL_VALIDATION_BASE) !== null;
}

/** Resolve an admitted upload URL against the document that will open it. */
export function resolveSafeUploadUrl(
  value: unknown,
  baseUrl: string,
): string | null {
  return parseUploadUrl(value, baseUrl)?.href ?? null;
}

/**
 * Open an upload using its owning browsing context.
 *
 * Using `ownerDocument.defaultView` keeps portalled/iframe-rendered panels in
 * the correct window instead of accidentally navigating the host document.
 */
export function openSafeUploadUrl(
  value: unknown,
  ownerDocument: UploadOwnerDocument,
): boolean {
  const href = resolveSafeUploadUrl(value, ownerDocument.baseURI);
  const view = ownerDocument.defaultView;
  if (!href || !view) return false;

  try {
    view.open(href, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    // Sandboxed documents and browser policies may reject window.open.
    return false;
  }
}
