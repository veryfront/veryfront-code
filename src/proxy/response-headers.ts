const STICKY_COOKIE_NAME = "lb";

function parseCacheControl(cacheControl: string | null): Map<string, string | true> {
  const directives = new Map<string, string | true>();
  if (!cacheControl) return directives;

  for (const part of cacheControl.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [rawName, rawValue] = trimmed.split("=", 2);
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    directives.set(name, rawValue === undefined ? true : rawValue.trim().replace(/^"|"$/g, ""));
  }

  return directives;
}

function readPositiveDirectiveSeconds(
  directives: Map<string, string | true>,
  name: string,
): number {
  const value = directives.get(name);
  if (typeof value !== "string") return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function isPublicCacheable(headers: Headers): boolean {
  const directives = parseCacheControl(headers.get("cache-control"));
  if (!directives.has("public")) return false;
  if (directives.has("private") || directives.has("no-store") || directives.has("no-cache")) {
    return false;
  }

  return directives.has("immutable") ||
    readPositiveDirectiveSeconds(directives, "s-maxage") > 0 ||
    readPositiveDirectiveSeconds(directives, "max-age") > 0;
}

function readSetCookies(headers: Headers): string[] {
  const getSetCookie = headers.getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(headers);
    if (values.length > 0) return values;
  }

  const values: string[] = [];
  for (const [key, value] of headers) {
    if (key.toLowerCase() === "set-cookie") values.push(value);
  }

  const directValue = headers.get("set-cookie");
  if (values.length === 0 && directValue) values.push(directValue);

  return values;
}

function isStickyCookie(setCookie: string): boolean {
  const [name] = setCookie.split("=", 1);
  return name?.trim().toLowerCase() === STICKY_COOKIE_NAME;
}

export function removeStickyCookieFromPublicCacheableResponse(response: Response): Response {
  if (!isPublicCacheable(response.headers)) return response;

  const setCookies = readSetCookies(response.headers);
  if (setCookies.length === 0 || !setCookies.some(isStickyCookie)) return response;

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");

  for (const setCookie of setCookies) {
    if (!isStickyCookie(setCookie)) headers.append("Set-Cookie", setCookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
