interface ValidatedBaseUrl {
  origin: string;
  prefix: string;
  prefixPathname: string;
}

export type VeryfrontApiRequestUrlResolver = (pathOrUrl: string) => string;

/**
 * Create the canonical resolver for Veryfront API endpoints.
 *
 * Relative request paths are appended to and contained by the configured base
 * path. Explicit absolute request URLs are accepted only when they use the
 * configured origin.
 */
export function createVeryfrontApiRequestUrlResolver(
  baseUrl: string,
): VeryfrontApiRequestUrlResolver {
  const validatedBaseUrl = validateBaseUrl(baseUrl);
  return (pathOrUrl) => resolveRequestUrl(validatedBaseUrl, pathOrUrl);
}

function validateBaseUrl(value: string): ValidatedBaseUrl {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Veryfront API base URL must be a non-empty absolute URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new TypeError("Veryfront API base URL must be a valid absolute URL", {
      cause,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Veryfront API base URL must use http or https");
  }
  if (url.username || url.password) {
    throw new TypeError("Veryfront API base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new TypeError("Veryfront API base URL must not contain a query or fragment");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return {
    origin: url.origin,
    prefix: `${url.origin}${pathname}`,
    prefixPathname: pathname,
  };
}

function assertRelativeRequestWithinConfiguredBasePath(
  baseUrl: ValidatedBaseUrl,
  requestUrl: URL,
): void {
  if (
    baseUrl.prefixPathname &&
    requestUrl.pathname !== baseUrl.prefixPathname &&
    !requestUrl.pathname.startsWith(`${baseUrl.prefixPathname}/`)
  ) {
    throw new TypeError(
      "Veryfront API request path must remain within the configured API base path",
    );
  }
}

function resolveRequestUrl(baseUrl: ValidatedBaseUrl, pathOrUrl: string): string {
  if (typeof pathOrUrl !== "string") {
    throw new TypeError("Veryfront API request URL must be a string");
  }
  if (pathOrUrl.startsWith("//")) {
    throw new TypeError("Veryfront API request URL must not use a protocol-relative origin");
  }

  let absolute: URL | undefined;
  try {
    absolute = new URL(pathOrUrl);
  } catch {
    // Relative API paths are resolved below.
  }

  if (absolute) {
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      throw new TypeError("Veryfront API request URL must use http or https");
    }
    if (absolute.username || absolute.password) {
      throw new TypeError("Veryfront API request URL must not contain credentials");
    }
    if (absolute.origin !== baseUrl.origin) {
      throw new TypeError("Veryfront API request origin must match the configured API origin");
    }
    return absolute.href;
  }

  const separator = pathOrUrl.startsWith("/") || pathOrUrl.startsWith("?") ? "" : "/";
  const resolved = new URL(`${baseUrl.prefix}${separator}${pathOrUrl}`);
  if (resolved.origin !== baseUrl.origin) {
    throw new TypeError("Veryfront API request origin must match the configured API origin");
  }
  assertRelativeRequestWithinConfiguredBasePath(baseUrl, resolved);
  return resolved.href;
}
