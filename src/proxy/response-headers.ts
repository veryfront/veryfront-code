const STICKY_COOKIE_NAME = "lb";
const MAX_CACHE_CONTROL_CODE_UNITS = 16 * 1024;
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

function splitCacheControl(cacheControl: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < cacheControl.length; index++) {
    const character = cacheControl[index]!;
    const codeUnit = cacheControl.charCodeAt(index);
    if (quoted) {
      if (escaped) {
        if (
          (codeUnit < 0x20 && codeUnit !== 0x09) ||
          codeUnit === 0x7f
        ) {
          return null;
        }
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      } else if (
        (codeUnit < 0x20 && codeUnit !== 0x09) ||
        codeUnit === 0x7f
      ) {
        return null;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      const part = cacheControl.slice(start, index).trim();
      if (!part) return null;
      parts.push(part);
      start = index + 1;
    }
  }

  if (quoted || escaped) return null;
  const finalPart = cacheControl.slice(start).trim();
  if (!finalPart) return parts.length === 0 ? [] : null;
  parts.push(finalPart);
  return parts;
}

function parseQuotedValue(value: string): string | null {
  if (value.length < 2 || value[0] !== '"' || value.at(-1) !== '"') return null;
  let result = "";
  for (let index = 1; index < value.length - 1; index++) {
    const character = value[index]!;
    if (character === '"') return null;
    if (character === "\\") {
      index++;
      if (index >= value.length - 1) return null;
    }
    const resolved = value[index]!;
    const codeUnit = value.charCodeAt(index);
    if (
      (codeUnit < 0x20 && codeUnit !== 0x09) ||
      codeUnit === 0x7f
    ) {
      return null;
    }
    result += resolved;
  }
  return result;
}

function parseCacheControl(cacheControl: string | null): Map<string, string | true> | null {
  const directives = new Map<string, string | true>();
  if (!cacheControl) return directives;
  if (cacheControl.length > MAX_CACHE_CONTROL_CODE_UNITS) return null;

  const parts = splitCacheControl(cacheControl);
  if (!parts) return null;
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    const rawName = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    const name = rawName.trim().toLowerCase();
    if (!HTTP_TOKEN_PATTERN.test(name) || directives.has(name)) return null;

    if (separatorIndex === -1) {
      directives.set(name, true);
      continue;
    }
    const rawValue = part.slice(separatorIndex + 1).trim();
    const value = rawValue.startsWith('"')
      ? parseQuotedValue(rawValue)
      : HTTP_TOKEN_PATTERN.test(rawValue)
      ? rawValue
      : null;
    if (value === null) return null;
    directives.set(name, value);
  }

  return directives;
}

function readPositiveDirectiveSeconds(
  directives: Map<string, string | true>,
  name: string,
): number {
  const value = directives.get(name);
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    return 0;
  }
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
}

function isPublicCacheable(headers: Headers): boolean {
  const directives = parseCacheControl(headers.get("cache-control"));
  if (!directives || directives.get("public") !== true) return false;
  if (directives.has("private") || directives.has("no-store") || directives.has("no-cache")) {
    return false;
  }

  return directives.get("immutable") === true ||
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
