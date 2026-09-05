interface ValidatedBaseUrl {
  origin: string;
  prefix: string;
  prefixPathname: string;
}

const IntrinsicReflectApply = Reflect.apply;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeTrim = String.prototype.trim;
const NativeURL = URL;
const urlProtocolGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "protocol")?.get;
const urlUsernameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "username")?.get;
const urlPasswordGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "password")?.get;
const urlSearchGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "search")?.get;
const urlHashGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hash")?.get;
const urlPathnameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")?.get;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;
const urlHrefGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "href")?.get;

type NativeUrlProperty =
  | "protocol"
  | "username"
  | "password"
  | "search"
  | "hash"
  | "pathname"
  | "origin"
  | "href";

const nativeUrlGetters: Record<NativeUrlProperty, ((this: URL) => string) | undefined> = {
  protocol: urlProtocolGetter,
  username: urlUsernameGetter,
  password: urlPasswordGetter,
  search: urlSearchGetter,
  hash: urlHashGetter,
  pathname: urlPathnameGetter,
  origin: urlOriginGetter,
  href: urlHrefGetter,
};

function readUrl(url: URL, property: NativeUrlProperty): string {
  const getter = nativeUrlGetters[property];
  if (!getter) throw new TypeError(`Native URL ${property} getter is unavailable`);
  return IntrinsicReflectApply(getter, url, []) as string;
}

function startsWith(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
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
  if (
    typeof value !== "string" || value.length === 0 ||
    IntrinsicReflectApply(StringPrototypeTrim, value, []) !== value
  ) {
    throw new TypeError("Veryfront API base URL must be a non-empty absolute URL");
  }

  let url: URL;
  try {
    url = new NativeURL(value);
  } catch (cause) {
    throw new TypeError("Veryfront API base URL must be a valid absolute URL", {
      cause,
    });
  }

  const protocol = readUrl(url, "protocol");
  if (protocol !== "http:" && protocol !== "https:") {
    throw new TypeError("Veryfront API base URL must use http or https");
  }
  if (readUrl(url, "username") || readUrl(url, "password")) {
    throw new TypeError("Veryfront API base URL must not contain credentials");
  }
  if (readUrl(url, "search") || readUrl(url, "hash")) {
    throw new TypeError("Veryfront API base URL must not contain a query or fragment");
  }

  const origin = readUrl(url, "origin");
  const pathname = IntrinsicReflectApply(StringPrototypeReplace, readUrl(url, "pathname"), [
    /\/+$/,
    "",
  ]) as string;
  return {
    origin,
    prefix: `${origin}${pathname}`,
    prefixPathname: pathname,
  };
}

function assertRelativeRequestWithinConfiguredBasePath(
  baseUrl: ValidatedBaseUrl,
  requestUrl: URL,
): void {
  if (
    baseUrl.prefixPathname &&
    readUrl(requestUrl, "pathname") !== baseUrl.prefixPathname &&
    !startsWith(readUrl(requestUrl, "pathname"), `${baseUrl.prefixPathname}/`)
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
  if (startsWith(pathOrUrl, "//")) {
    throw new TypeError("Veryfront API request URL must not use a protocol-relative origin");
  }

  let absolute: URL | undefined;
  try {
    absolute = new NativeURL(pathOrUrl);
  } catch {
    // Relative API paths are resolved below.
  }

  if (absolute) {
    const protocol = readUrl(absolute, "protocol");
    if (protocol !== "http:" && protocol !== "https:") {
      throw new TypeError("Veryfront API request URL must use http or https");
    }
    if (readUrl(absolute, "username") || readUrl(absolute, "password")) {
      throw new TypeError("Veryfront API request URL must not contain credentials");
    }
    if (readUrl(absolute, "origin") !== baseUrl.origin) {
      throw new TypeError("Veryfront API request origin must match the configured API origin");
    }
    return readUrl(absolute, "href");
  }

  const separator = startsWith(pathOrUrl, "/") || startsWith(pathOrUrl, "?") ? "" : "/";
  const resolved = new NativeURL(`${baseUrl.prefix}${separator}${pathOrUrl}`);
  if (readUrl(resolved, "origin") !== baseUrl.origin) {
    throw new TypeError("Veryfront API request origin must match the configured API origin");
  }
  assertRelativeRequestWithinConfiguredBasePath(baseUrl, resolved);
  return readUrl(resolved, "href");
}
