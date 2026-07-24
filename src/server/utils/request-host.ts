export function parseForwardedHost(raw: string | null): string | undefined {
  if (!raw) return undefined;

  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * Resolve the effective request host.
 *
 * `x-forwarded-host` is client-controlled and only trustworthy behind a trusted
 * upstream proxy. It is honoured ONLY when `trustProxy` is true; otherwise a
 * direct-access attacker could spoof the origin host (e.g. to unlock preview
 * mode or localhost short-circuits). When untrusted, fall back to the Host
 * header (which the edge proxy also sets) and finally the URL host.
 *
 * Defaults to untrusted so callers fail closed unless they explicitly establish
 * proxy trust (see {@link isProxyTrusted}).
 */
export function getEffectiveRequestHost(
  req: Request,
  url?: URL,
  trustProxy = false,
): string {
  if (trustProxy) {
    const forwarded = parseForwardedHost(req.headers.get("x-forwarded-host"));
    if (forwarded) return forwarded;
  }
  return req.headers.get("host") ??
    (url ?? new URL(req.url)).host;
}
