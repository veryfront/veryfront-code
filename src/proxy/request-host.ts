const MAX_HOST_AUTHORITY_CODE_UNITS = 1_024;
const NativeURL = URL;
const IntrinsicReflectApply = Reflect.apply;
const StringPrototypeTrim = String.prototype.trim;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const URLProtocolGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "protocol")!.get!;
const URLUsernameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "username")!.get!;
const URLPasswordGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "password")!.get!;
const URLHostnameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname")!.get!;
const URLPathnameGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")!.get!;
const URLSearchGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "search")!.get!;
const URLHashGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hash")!.get!;

export class ProxyRequestHostError extends TypeError {
  constructor() {
    super("Proxy request Host header is invalid");
    this.name = "ProxyRequestHostError";
  }
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = stringCharCodeAt(value, index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function stringTrim(value: string): string {
  return IntrinsicReflectApply(StringPrototypeTrim, value, []) as string;
}

function stringIncludes(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringToLowerCase(value: string): string {
  return IntrinsicReflectApply(StringPrototypeToLowerCase, value, []) as string;
}

function stringEndsWith(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeEndsWith, value, [search]) as boolean;
}

function stringSlice(value: string, start: number, end?: number): string {
  return IntrinsicReflectApply(
    StringPrototypeSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return IntrinsicReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}

function stringIndexOf(value: string, search: string): number {
  return IntrinsicReflectApply(StringPrototypeIndexOf, value, [search]) as number;
}

function stringLastIndexOf(value: string, search: string): number {
  return IntrinsicReflectApply(StringPrototypeLastIndexOf, value, [search]) as number;
}

function stringCharCodeAt(value: string, index: number): number {
  return IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function urlProtocol(url: URL): string {
  return IntrinsicReflectApply(URLProtocolGetter, url, []) as string;
}

function urlUsername(url: URL): string {
  return IntrinsicReflectApply(URLUsernameGetter, url, []) as string;
}

function urlPassword(url: URL): string {
  return IntrinsicReflectApply(URLPasswordGetter, url, []) as string;
}

function urlHostname(url: URL): string {
  return IntrinsicReflectApply(URLHostnameGetter, url, []) as string;
}

function urlPathname(url: URL): string {
  return IntrinsicReflectApply(URLPathnameGetter, url, []) as string;
}

function urlSearch(url: URL): string {
  return IntrinsicReflectApply(URLSearchGetter, url, []) as string;
}

function urlHash(url: URL): string {
  return IntrinsicReflectApply(URLHashGetter, url, []) as string;
}

function parseProxyRequestAuthority(authority: string): { hostname: string; authority: string } {
  if (
    typeof authority !== "string" ||
    authority.length === 0 ||
    authority.length > MAX_HOST_AUTHORITY_CODE_UNITS ||
    authority !== stringTrim(authority) ||
    stringIncludes(authority, "\\") ||
    containsAsciiControlCharacter(authority)
  ) {
    throw new ProxyRequestHostError();
  }

  let parsed: URL;
  try {
    parsed = new NativeURL(`http://${authority}`);
  } catch {
    throw new ProxyRequestHostError();
  }
  if (
    urlProtocol(parsed) !== "http:" ||
    !urlHostname(parsed) ||
    urlUsername(parsed) !== "" ||
    urlPassword(parsed) !== "" ||
    urlPathname(parsed) !== "/" ||
    urlSearch(parsed) !== "" ||
    urlHash(parsed) !== ""
  ) {
    throw new ProxyRequestHostError();
  }

  const hostname = stringToLowerCase(urlHostname(parsed));
  const normalizedHostname = stringEndsWith(hostname, ".")
    ? stringSlice(hostname, 0, -1)
    : hostname;
  if (!normalizedHostname) throw new ProxyRequestHostError();

  const portSeparator = stringStartsWith(authority, "[")
    ? stringIndexOf(authority, "]") + 1
    : stringLastIndexOf(authority, ":");
  const rawPort = portSeparator > 0 && authority[portSeparator] === ":"
    ? stringSlice(authority, portSeparator + 1)
    : "";
  const port = rawPort ? String(Number(rawPort)) : "";

  return {
    hostname: normalizedHostname,
    authority: port ? `${normalizedHostname}:${port}` : normalizedHostname,
  };
}

/**
 * Validate and canonicalize an HTTP Host authority. The result contains no
 * port and is safe to use as a routing or token-cache identity.
 */
export function normalizeProxyRequestHost(authority: string): string {
  return parseProxyRequestAuthority(authority).hostname;
}

/** Validate and canonicalize an HTTP Host authority while preserving its port. */
export function normalizeProxyRequestAuthority(authority: string): string {
  return parseProxyRequestAuthority(authority).authority;
}

export function resolveProxyRequestHost(req: Request, url: URL): string {
  return normalizeProxyRequestHost(req.headers.get("host") ?? url.host);
}

export function resolveProxyRequestAuthority(req: Request, url: URL): string {
  return normalizeProxyRequestAuthority(req.headers.get("host") ?? url.host);
}
