function parseFirstForwardedValue(raw: string | null): string | undefined {
  if (!raw) return undefined;

  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

export function parseForwardedHost(raw: string | null): string | undefined {
  return parseFirstForwardedValue(raw);
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

/**
 * Resolve the browser-visible HTTP(S) origin at the trusted request boundary.
 * Forwarded values are used only after the caller establishes proxy trust.
 * Invalid trusted values return null so redirect policy checks fail closed.
 */
export function getEffectiveRequestOrigin(
  req: Request,
  url?: URL,
  trustProxy = false,
): string | null {
  const requestUrl = url ?? new URL(req.url);
  let protocol = requestUrl.protocol;

  if (trustProxy) {
    const rawForwardedProtocol = req.headers.get("x-forwarded-proto");
    if (rawForwardedProtocol !== null) {
      const forwardedProtocol = parseFirstForwardedValue(rawForwardedProtocol)?.toLowerCase()
        .replace(/:$/, "");
      if (forwardedProtocol !== "http" && forwardedProtocol !== "https") return null;
      protocol = `${forwardedProtocol}:`;
    }
  }

  if (protocol !== "http:" && protocol !== "https:") return null;

  const host = getEffectiveRequestHost(req, requestUrl, trustProxy);
  if (host.length === 0 || host.length > 2_048 || host.trim() !== host) return null;

  try {
    const originUrl = new URL(`${protocol}//${host}`);
    if (
      originUrl.username !== "" ||
      originUrl.password !== "" ||
      originUrl.pathname !== "/" ||
      originUrl.search !== "" ||
      originUrl.hash !== ""
    ) {
      return null;
    }
    return originUrl.origin;
  } catch {
    return null;
  }
}
