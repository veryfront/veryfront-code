const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Parse a cookie header string into key-value pairs */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = trimmed.slice(0, separatorIndex).trim();
    if (!COOKIE_NAME_PATTERN.test(name)) continue;

    const rawValue = trimmed.slice(separatorIndex + 1);
    const encodedValue = rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
    let value = encodedValue;
    try {
      value = decodeURIComponent(encodedValue);
    } catch {
      // Cookie headers are untrusted request input. Preserve malformed values
      // so one bad cookie cannot abort parsing of every other cookie.
    }

    Object.defineProperty(cookies, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return cookies;
}

/** Parse cookies from request headers */
export function parseCookiesFromHeaders(headers: Headers): Record<string, string> {
  return parseCookies(headers.get("cookie") ?? "");
}
