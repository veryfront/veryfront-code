const MAX_HOST_AUTHORITY_CODE_UNITS = 1_024;
const NativeURL = URL;

export class ProxyRequestHostError extends TypeError {
  constructor() {
    super("Proxy request Host header is invalid");
    this.name = "ProxyRequestHostError";
  }
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

/**
 * Validate and canonicalize an HTTP Host authority. The result contains no
 * port and is safe to use as a routing or token-cache identity.
 */
export function normalizeProxyRequestHost(authority: string): string {
  if (
    typeof authority !== "string" ||
    authority.length === 0 ||
    authority.length > MAX_HOST_AUTHORITY_CODE_UNITS ||
    authority !== authority.trim() ||
    authority.includes("\\") ||
    containsAsciiControlCharacter(authority)
  ) {
    throw new ProxyRequestHostError();
  }

  let parsed: URL;
  try {
    parsed = new NativeURL(`http://${authority}`);
  } catch {
    throw new ProxyRequestHostError();
  }
  if (
    parsed.protocol !== "http:" ||
    !parsed.hostname ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new ProxyRequestHostError();
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalized = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (!normalized) throw new ProxyRequestHostError();
  return normalized;
}

export function resolveProxyRequestHost(req: Request, url: URL): string {
  return normalizeProxyRequestHost(req.headers.get("host") ?? url.host);
}
