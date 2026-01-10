/** Parse a cookie header string into key-value pairs */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((cookie) => {
    const trimmed = cookie.trim();
    if (!trimmed) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (!name) return;
    cookies[name] = decodeURIComponent(value);
  });

  return cookies;
}

/** Parse cookies from request headers */
export function parseCookiesFromHeaders(headers: Headers): Record<string, string> {
  return parseCookies(headers.get("cookie") || "");
}
