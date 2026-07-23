const CACHE_NEUTRAL_COOKIES = new Set([
  "lb",
]);

export function requestHasCacheSensitiveState(req: Request): boolean {
  if (req.headers.has("authorization") || req.headers.has("x-api-key")) {
    return true;
  }

  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return false;

  const cookieNames = parseCookieNames(cookieHeader);
  if (cookieNames === null) return true;
  return cookieNames.some((name) => !isCacheNeutralCookieName(name));
}

export function isCacheNeutralCookieName(name: string): boolean {
  return CACHE_NEUTRAL_COOKIES.has(name.trim().toLowerCase());
}

function parseCookieNames(cookieHeader: string): string[] | null {
  const names: string[] = [];
  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    if (!part) continue;
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) return null;
    const name = part.slice(0, separatorIndex).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return null;
    names.push(name);
  }
  return names.length > 0 ? names : null;
}
