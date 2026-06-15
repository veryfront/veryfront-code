const CACHE_NEUTRAL_COOKIES = new Set([
  "lb",
]);

export function requestHasCacheSensitiveState(req: Request): boolean {
  if (req.headers.has("authorization") || req.headers.has("x-api-key")) {
    return true;
  }

  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return false;

  return parseCookieNames(cookieHeader).some((name) => !isCacheNeutralCookieName(name));
}

export function isCacheNeutralCookieName(name: string): boolean {
  return CACHE_NEUTRAL_COOKIES.has(name.trim().toLowerCase());
}

function parseCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      return separatorIndex === -1 ? part : part.slice(0, separatorIndex).trim();
    })
    .filter(Boolean);
}
