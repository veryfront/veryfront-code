/** Parse a cookie header string into key-value pairs */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies = Object.create(null) as Record<string, string>;
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = trimmed.slice(0, separatorIndex).trim();
    if (!name) continue;

    let rawValue = trimmed.slice(separatorIndex + 1).trim();
    // RFC 6265 permits a cookie value to be wrapped in double quotes.
    if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
      rawValue = rawValue.slice(1, -1);
    }

    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // Treat only the malformed cookie as absent so valid siblings remain usable.
      continue;
    }

    cookies[name] = value;
  }

  return cookies;
}

/** Parse cookies from request headers */
export function parseCookiesFromHeaders(headers: Headers): Record<string, string> {
  return parseCookies(headers.get("cookie") ?? "");
}
