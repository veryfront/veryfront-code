export function parseForwardedHost(raw: string | null): string | undefined {
  if (!raw) return undefined;

  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

export function getEffectiveRequestHost(req: Request, url?: URL): string {
  return parseForwardedHost(req.headers.get("x-forwarded-host")) ??
    req.headers.get("host") ??
    (url ?? new URL(req.url)).host;
}
