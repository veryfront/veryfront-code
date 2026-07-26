import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "./diagnostic-policy.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const RELATIVE_REQUEST_URL_BASE = "http://veryfront.invalid";
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const NativeURL = URL;
const trimString = String.prototype.trim;
const requestUrlGetter = typeof Request === "function"
  ? getOwnPropertyDescriptor(Request.prototype, "url")?.get
  : undefined;
const urlPathnameGetter = getOwnPropertyDescriptor(
  NativeURL.prototype,
  "pathname",
)?.get;

function readRequestUrl(request: object): unknown {
  const ownDescriptor = getOwnPropertyDescriptor(request, "url");
  if (ownDescriptor) {
    return "value" in ownDescriptor ? ownDescriptor.value : undefined;
  }
  return requestUrlGetter ? apply(requestUrlGetter, request, []) : undefined;
}

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
    if (isProxyWithoutHooks(request)) return undefined;

    const value = readRequestUrl(request);
    if (
      typeof value !== "string" ||
      value.length > ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS
    ) {
      return undefined;
    }

    const normalized = apply(trimString, value, []) as string;
    if (normalized.length === 0) return undefined;
    if (!urlPathnameGetter) return undefined;
    const parsed = new NativeURL(normalized, RELATIVE_REQUEST_URL_BASE);
    return apply(urlPathnameGetter, parsed, []) as string;
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
    if (isProxyWithoutHooks(context)) return undefined;

    const descriptor = getOwnPropertyDescriptor(context, "req");
    if (!descriptor || !("value" in descriptor)) return undefined;
    return extractRequestPathname(descriptor.value);
  } catch {
    return undefined;
  }
}
