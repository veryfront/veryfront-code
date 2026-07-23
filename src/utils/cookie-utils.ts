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
    if (!name) continue;

    let value: string;
    try {
      value = decodeURIComponent(trimmed.slice(separatorIndex + 1));
    } catch {
      // Treat only the malformed cookie as absent so valid siblings remain usable.
      continue;
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
