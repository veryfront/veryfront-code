/** Parse a cookie header string into key-value pairs */
import * as dntShim from "../../_dnt.shims.js";

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

    const value = trimmed.slice(separatorIndex + 1);
    cookies[name] = decodeURIComponent(value);
  }

  return cookies;
}

/** Parse cookies from request headers */
export function parseCookiesFromHeaders(headers: dntShim.Headers): Record<string, string> {
  return parseCookies(headers.get("cookie") ?? "");
}
