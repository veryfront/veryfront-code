import { getRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

export interface ProxyIngressProvenance {
  readonly clientIp: string;
  readonly publicProtocol: "http" | "https";
}

export class ProxyIngressProvenanceError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ProxyIngressProvenanceError";
  }
}

const DECIMAL_OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;

function canonicalizeIpv4(value: string): string | null {
  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((octet) => !DECIMAL_OCTET_PATTERN.test(octet))) {
    return null;
  }
  const parsed = octets.map(Number);
  return parsed.every((octet) => octet <= 255) ? parsed.join(".") : null;
}

function canonicalizeIpv6(value: string): string | null {
  if (!value.includes(":") || value.includes("%") || value.includes("[") || value.includes("]")) {
    return null;
  }
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export function canonicalizeProxyIp(value: string): string | null {
  if (!value || value !== value.trim() || value.includes(",")) return null;
  return canonicalizeIpv4(value) ?? canonicalizeIpv6(value);
}

export function parseTrustedIngressProxyIps(raw: string | undefined): ReadonlySet<string> {
  if (raw === undefined || raw === "") return new Set();

  const trusted = new Set<string>();
  for (const entry of raw.split(",")) {
    const candidate = entry.trim();
    const canonical = canonicalizeProxyIp(candidate);
    if (!canonical) {
      throw new ProxyIngressProvenanceError(
        "VERYFRONT_PROXY_TRUSTED_INGRESS_IPS must contain only valid IP addresses",
      );
    }
    trusted.add(canonical);
  }
  return trusted;
}

function readTrustedForwardedProtocol(request: Request): "http" | "https" {
  const protocol = request.headers.get("x-forwarded-proto");
  if (protocol !== "http" && protocol !== "https") {
    throw new ProxyIngressProvenanceError(
      "Trusted ingress must replace x-forwarded-proto with exactly http or https",
    );
  }
  return protocol;
}

function readTrustedForwardedClientIp(request: Request): string {
  const raw = request.headers.get("x-forwarded-for");
  const clientIp = raw === null ? null : canonicalizeProxyIp(raw);
  if (!clientIp) {
    throw new ProxyIngressProvenanceError(
      "Trusted ingress must replace x-forwarded-for with exactly one canonical client IP",
    );
  }
  return clientIp;
}

/**
 * Resolve public request provenance from native transport authority.
 *
 * Forwarded metadata is consumed only when the immutable native peer matches
 * an exact operator-configured ingress IP. The ingress contract requires
 * replacement, not append semantics, so multi-hop/client-supplied values fail
 * closed instead of being guessed at.
 */
export function resolveProxyIngressProvenance(
  request: Request,
  trustedIngressProxyIps: ReadonlySet<string>,
): ProxyIngressProvenance | undefined {
  const peer = getRequestPeerProvenance(request);
  if (!peer) {
    if (trustedIngressProxyIps.size > 0) {
      throw new ProxyIngressProvenanceError(
        "Native proxy peer provenance is required when trusted ingress peers are configured",
      );
    }
    return undefined;
  }

  const peerIp = canonicalizeProxyIp(peer.hostname);
  if (!peerIp) {
    throw new ProxyIngressProvenanceError("Native proxy peer is not a valid IP address");
  }

  if (trustedIngressProxyIps.has(peerIp)) {
    return Object.freeze({
      clientIp: readTrustedForwardedClientIp(request),
      publicProtocol: readTrustedForwardedProtocol(request),
    });
  }

  return Object.freeze({
    clientIp: peerIp,
    publicProtocol: peer.protocol === "https:" ? "https" : "http",
  });
}
