/**
 * Transport-authenticated peer provenance for inbound Web Requests.
 *
 * Fetch Request headers and URLs are caller-controlled. Runtime adapters must
 * record the native socket peer before application code or interceptors run.
 * This module is internal and is intentionally not re-exported from a public
 * platform barrel.
 *
 * @module platform/adapters/runtime/shared/request-peer
 */

export type RequestPeerRuntime = "node" | "deno" | "bun";

export interface RequestPeerProvenance {
  readonly runtime: RequestPeerRuntime;
  readonly transport: "tcp";
  readonly hostname: string;
}

// Every call below receives an inbound request, credential headers and all,
// before the runtime handler takes those off it. Captured, so project code
// that replaced the collection prototypes never sees the request.
const IntrinsicReflectApply = Reflect.apply;
const WeakMapDelete = WeakMap.prototype.delete;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapHas = WeakMap.prototype.has;
const WeakMapSet = WeakMap.prototype.set;
const WeakSetAdd = WeakSet.prototype.add;
const WeakSetHas = WeakSet.prototype.has;
const requestPeerProvenance = new WeakMap<Request, RequestPeerProvenance>();
const interceptorHandledRequests = new WeakSet<Request>();

function getProvenance(request: Request): RequestPeerProvenance | undefined {
  return IntrinsicReflectApply(WeakMapGet, requestPeerProvenance, [request]) as
    | RequestPeerProvenance
    | undefined;
}

function hasProvenance(request: Request): boolean {
  return IntrinsicReflectApply(WeakMapHas, requestPeerProvenance, [request]) as boolean;
}

function setProvenance(request: Request, provenance: RequestPeerProvenance): void {
  IntrinsicReflectApply(WeakMapSet, requestPeerProvenance, [request, provenance]);
}

function deleteProvenance(request: Request): void {
  IntrinsicReflectApply(WeakMapDelete, requestPeerProvenance, [request]);
}

function markInterceptorHandled(request: Request): void {
  IntrinsicReflectApply(WeakSetAdd, interceptorHandledRequests, [request]);
}

function isInterceptorHandled(request: Request): boolean {
  return IntrinsicReflectApply(WeakSetHas, interceptorHandledRequests, [request]) as boolean;
}
const MAX_PEER_HOSTNAME_CHARACTERS = 255;
const DECIMAL_OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

function isBoundedPeerHostname(hostname: string): boolean {
  return hostname.length > 0 &&
    hostname.length <= MAX_PEER_HOSTNAME_CHARACTERS &&
    hostname === hostname.trim() &&
    !hostname.includes("\0");
}

function parseCanonicalIpv4(hostname: string): readonly number[] | null {
  const octets = hostname.split(".");
  if (octets.length !== 4) return null;

  const parsed: number[] = [];
  for (const octet of octets) {
    if (!DECIMAL_OCTET_PATTERN.test(octet)) return null;
    const value = Number(octet);
    if (value > 255) return null;
    parsed.push(value);
  }
  return parsed;
}

function canonicalizeIpv6(hostname: string): string | null {
  // Native TCP peer APIs return an address without URL brackets or a scope
  // zone. Reject either representation rather than guessing at its meaning.
  if (!hostname.includes(":") || hostname.includes("%") || hostname.includes("[")) {
    return null;
  }

  try {
    const parsed = new URL(`http://[${hostname}]/`);
    const normalized = parsed.hostname;
    return normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** @internal Record native transport authority before untrusted request code runs. */
export function recordRequestPeerFromTransport(
  request: Request,
  provenance: RequestPeerProvenance,
): boolean {
  if (hasProvenance(request)) return false;
  if (
    (provenance.runtime !== "node" &&
      provenance.runtime !== "deno" &&
      provenance.runtime !== "bun") ||
    provenance.transport !== "tcp" ||
    !isBoundedPeerHostname(provenance.hostname)
  ) {
    return false;
  }

  setProvenance(
    request,
    Object.freeze({
      runtime: provenance.runtime,
      transport: "tcp",
      hostname: provenance.hostname,
    }),
  );
  return true;
}

/** @internal Record the native peer supplied to a Deno.serve handler. */
export function recordDenoServeRequestPeer(
  request: Request,
  info: unknown,
): boolean {
  if (typeof info !== "object" || info === null) return false;

  try {
    const remoteAddress = (info as {
      readonly remoteAddr?: {
        readonly transport?: unknown;
        readonly hostname?: unknown;
      };
    }).remoteAddr;
    if (
      remoteAddress?.transport !== "tcp" ||
      typeof remoteAddress.hostname !== "string"
    ) {
      return false;
    }
    return recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: remoteAddress.hostname,
    });
  } catch {
    return false;
  }
}

/** @internal Record the native peer supplied by a Node IncomingMessage. */
export function recordNodeIncomingRequestPeer(
  request: Request,
  incoming: unknown,
): boolean {
  if (typeof incoming !== "object" || incoming === null) return false;

  try {
    const socket = (incoming as {
      readonly socket?: { readonly remoteAddress?: unknown };
    }).socket;
    if (typeof socket?.remoteAddress !== "string") return false;
    return recordRequestPeerFromTransport(request, {
      runtime: "node",
      transport: "tcp",
      hostname: socket.remoteAddress,
    });
  } catch {
    return false;
  }
}

/** @internal Record the native peer supplied by a Bun server context. */
export function recordBunServerRequestPeer(
  request: Request,
  server: unknown,
): boolean {
  if (typeof server !== "object" || server === null) return false;

  try {
    const requestIP = (server as {
      readonly requestIP?: unknown;
    }).requestIP;
    if (typeof requestIP !== "function") return false;

    const peer = requestIP.call(server, request) as {
      readonly address?: unknown;
    } | null;
    if (typeof peer?.address !== "string") return false;
    return recordRequestPeerFromTransport(request, {
      runtime: "bun",
      transport: "tcp",
      hostname: peer.address,
    });
  } catch {
    return false;
  }
}

/**
 * @internal Record native peer context passed through a public handler bridge.
 * Supports Deno.serve handler info, Node IncomingMessage values, and Bun server
 * context values.
 */
export function recordHandlerRequestPeer(
  request: Request,
  context: unknown,
): boolean {
  return recordDenoServeRequestPeer(request, context) ||
    recordNodeIncomingRequestPeer(request, context) ||
    recordBunServerRequestPeer(request, context);
}

/** @internal Read immutable transport provenance without consulting headers. */
export function getRequestPeerProvenance(
  request: Request,
): RequestPeerProvenance | undefined {
  return getProvenance(request);
}

/**
 * @internal Preserve transport authority when framework code replaces a
 * Request. Missing source provenance clears any authority on the target, so a
 * replacement cannot manufacture trust.
 */
export function inheritRequestPeerProvenance<T extends Request>(
  source: Request,
  target: T,
): T {
  if (source === target) return target;

  const provenance = getProvenance(source);
  if (provenance === undefined) deleteProvenance(target);
  else setProvenance(target, provenance);
  return target;
}

/** @internal Run an interceptor without discarding transport peer authority. */
export async function runRequestInterceptor(
  request: Request,
  interceptor: (request: Request) => Request | Promise<Request>,
): Promise<Request> {
  markInterceptorHandled(request);
  const intercepted = await interceptor(request);
  if (intercepted === request) return request;

  if (isInterceptorHandled(intercepted)) {
    throw new TypeError(
      "Request interceptors must return a fresh replacement Request",
    );
  }
  markInterceptorHandled(intercepted);
  return inheritRequestPeerProvenance(request, intercepted);
}

/** @internal True for IPv4 127/8, IPv6 ::1, or mapped IPv4 127/8. */
export function isLoopbackAddress(hostname: string): boolean {
  const ipv4 = parseCanonicalIpv4(hostname);
  if (ipv4 !== null) return ipv4[0] === 127;

  const ipv6 = canonicalizeIpv6(hostname);
  if (ipv6 === "::1") return true;

  const mapped = ipv6 === null ? null : IPV4_MAPPED_IPV6_PATTERN.exec(ipv6);
  if (mapped === null) return false;
  const highWord = Number.parseInt(mapped[1]!, 16);
  return (highWord >>> 8) === 127;
}

/** True only when recorded native peer provenance contains a loopback address. */
export function isRequestFromLoopbackPeer(request: Request): boolean {
  const hostname = getProvenance(request)?.hostname;
  return hostname !== undefined && isLoopbackAddress(hostname);
}
