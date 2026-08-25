/**
 * Cross-runtime host address resolution.
 *
 * Resolution goes through a short-lived cache that also collapses concurrent
 * lookups of the same host into one query. The egress guard
 * (`security/sandbox/worker-egress-guard.ts`) validates every outbound request
 * through here, so without that collapsing a single page render issues one
 * query per module fetch.
 *
 * That fan-out is what makes it matter. A page importing one CDN package pulls
 * dozens of modules from the same host, and the underlying resolvers query the
 * configured nameservers directly rather than going through the OS resolver
 * cache that getaddrinfo uses. Resolvers that serialize concurrent queries then
 * add seconds: a Tailscale MagicDNS resolver measured 46ms for one lookup but
 * 2061ms for 51 concurrent lookups, against roughly 60ms for public resolvers at
 * the same concurrency. HTTP_MODULE_FETCH_TIMEOUT_MS gives each fetch attempt
 * 2_500ms rather than each fetch, so DNS alone exhausted one attempt. Every
 * attempt then failed the same way and the fetches died with AbortError, until
 * the render hit its idle deadline.
 *
 * Caching resolved addresses does not widen the DNS-rebinding window that
 * pinning closes: reusing an already validated address set is what pinning
 * does, and every caller still runs the full egress policy against the returned
 * addresses. Only the DNS answer is cached, never a policy verdict. Empty and
 * failed resolutions are never cached, so "this host does not resolve" stays a
 * live question rather than a sticky one.
 *
 * @module platform/compat/dns
 */

import { getDenoRuntime, isBun, isDeno, isNode } from "./runtime.ts";

export type DnsAddressRecordType = "A" | "AAAA";

export interface ResolveHostAddressesOptions {
  recordTypes?: readonly DnsAddressRecordType[];
}

/**
 * How long a successful resolution stays reusable.
 *
 * Long enough that one page render resolves a CDN host once, short enough that
 * a legitimate address change is picked up quickly.
 */
export const HOST_ADDRESS_CACHE_TTL_MS = 30_000;

/**
 * Upper bound on cached hosts, so hostnames drawn from request data cannot grow
 * the cache without limit.
 */
export const HOST_ADDRESS_CACHE_MAX_ENTRIES = 256;

const DEFAULT_RECORD_TYPES: readonly DnsAddressRecordType[] = ["A", "AAAA"];

export type ResolveHostAddresses = (
  hostname: string,
  options?: ResolveHostAddressesOptions,
) => Promise<string[]>;

export interface HostAddressResolverOptions {
  /** Underlying resolver. Receives the caller's normalized record types. */
  resolve: (
    hostname: string,
    options: { recordTypes: readonly DnsAddressRecordType[] },
  ) => Promise<string[]>;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface HostAddressCacheEntry {
  addresses: readonly string[];
  expiresAt: number;
}

/**
 * Key a resolution by host and record types: an A-only answer cannot serve a
 * caller that asked for A and AAAA. A pipe cannot appear in either part, so the
 * two fields stay unambiguous.
 */
function cacheKey(hostname: string, recordTypes: readonly DnsAddressRecordType[]): string {
  return `${hostname}|${recordTypes.join(",")}`;
}

/**
 * Build a resolver that caches successful answers and shares in-flight lookups.
 *
 * Exported so the caching behavior can be tested against an injected resolver
 * and clock. Runtime callers use `resolveHostAddresses`.
 */
export function createHostAddressResolver(
  options: HostAddressResolverOptions,
): ResolveHostAddresses {
  const ttlMs = options.ttlMs ?? HOST_ADDRESS_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? HOST_ADDRESS_CACHE_MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());

  const entries = new Map<string, HostAddressCacheEntry>();
  const inFlight = new Map<string, Promise<string[]>>();

  function readFresh(key: string): readonly string[] | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.addresses;
  }

  function store(key: string, addresses: readonly string[]): void {
    // Insertion order is eviction order, so refreshing a key must re-insert it.
    entries.delete(key);
    entries.set(key, { addresses, expiresAt: now() + ttlMs });

    for (const [candidate, entry] of entries) {
      if (entries.size <= maxEntries) break;
      if (entry.expiresAt <= now()) entries.delete(candidate);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  return async function resolve(
    hostname: string,
    callOptions: ResolveHostAddressesOptions = {},
  ): Promise<string[]> {
    const recordTypes = callOptions.recordTypes ?? DEFAULT_RECORD_TYPES;
    const key = cacheKey(hostname, recordTypes);

    const cached = readFresh(key);
    if (cached) return [...cached];

    const pending = inFlight.get(key);
    if (pending) return [...await pending];

    const lookup = (async () => {
      const addresses = await options.resolve(hostname, { recordTypes });
      // An empty answer is a blocking condition upstream, not a fact worth
      // holding on to.
      if (addresses.length > 0) store(key, [...addresses]);
      return addresses;
    })();

    inFlight.set(key, lookup);
    try {
      return [...await lookup];
    } finally {
      if (inFlight.get(key) === lookup) inFlight.delete(key);
    }
  };
}

/**
 * Loopback addresses per family, for the names RFC 6761 §6.3 reserves.
 */
const LOOPBACK_ADDRESSES: Readonly<Record<DnsAddressRecordType, string>> = {
  A: "127.0.0.1",
  AAAA: "::1",
};

/**
 * True for `localhost` and any `*.localhost` subdomain.
 *
 * RFC 6761 §6.3 reserves these names and requires that they resolve to
 * loopback, so a resolver may answer for them without a nameserver query.
 *
 * Deliberately byte-identical to `isLocalhostName` in
 * `security/sandbox/worker-egress-guard.ts`, INCLUDING its lack of trailing-dot
 * normalisation. The guard uses that predicate twice: to strike localhost names
 * out of `allowedInternalHosts`, and to block them on the request path. A
 * resolver that recognises a form the guard does not — `api.localhost.`, say —
 * lets that entry survive the allowlist filter, skips the internal-address
 * check because the host is allowlisted, and then hands back loopback. Being
 * more permissive here than the guard is a bypass, not a convenience.
 */
function isLoopbackName(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

/**
 * Loopback answers for a reserved name, or `null` when the name is not one.
 *
 * Exported for tests: the runtimes disagreed here (#3785) and the fix has to
 * be assertable without depending on what the host's resolver happens to
 * answer, which is the very thing that made the divergence invisible.
 *
 * @internal
 */
export function resolveLoopbackAddresses(
  hostname: string,
  recordTypes: readonly DnsAddressRecordType[],
): string[] | null {
  if (!isLoopbackName(hostname)) return null;
  return recordTypes.map((recordType) => LOOPBACK_ADDRESSES[recordType]);
}

/** Deno 2 raises NotCapable for a missing permission; earlier runtimes used PermissionDenied. */
function isPermissionError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "NotCapable" || error.name === "PermissionDenied");
}

/**
 * A DNS lookup failed because net permission is missing, not because the name
 * did not resolve. Named so boundary layers that collapse unknown errors into
 * a generic message (e.g. the worker egress broker) can recognize and forward
 * the permission diagnosis instead of discarding it.
 */
export class DnsPermissionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DnsPermissionError";
  }
}

async function resolveHostAddressesUncached(
  hostname: string,
  options: { recordTypes: readonly DnsAddressRecordType[] },
): Promise<string[]> {
  const results: string[] = [];

  // Answered before any runtime branch, so every runtime returns the same
  // addresses for these names. `Deno.resolveDns` answers for `localhost` while
  // Node's `resolve4`/`resolve6` query nameservers and do not — which is the
  // whole of #3785. Note this is NOT "consult the hosts file": `resolveDns`
  // does not (measured — `broadcasthost` is in /etc/hosts and returns
  // NotFound), and giving the hosts file authority over a resolver that sits
  // behind the egress guard would widen what that guard can reach.
  const loopback = resolveLoopbackAddresses(hostname, options.recordTypes);
  if (loopback !== null) return loopback;

  if (isDeno) {
    const deno = getDenoRuntime();
    if (!deno) return results;

    for (const recordType of options.recordTypes) {
      try {
        results.push(...await deno.resolveDns(hostname, recordType));
      } catch (error) {
        // `Deno.resolveDns` checks net permission against the nameserver, not
        // the queried host, so under a narrowed --allow-net every external
        // resolution fails with NotCapable whatever the destination. Swallowing
        // that alongside genuine lookup failures made a permission problem
        // surface as "unable to resolve host" and sent investigations toward
        // the network instead of the flags (veryfront-issue-inbox#744). The
        // caller stays fail-closed either way; only the diagnosis changes.
        if (isPermissionError(error)) {
          // The runtime's message names the nameserver it checked — an
          // internal infrastructure detail that must not ride the cause chain
          // into logs (AGENTS.md, secret and internal-detail safety). Retain
          // only the error's classification, never the raw message.
          throw new DnsPermissionError(
            `net access to the DNS resolver is not permitted while resolving "${hostname}"; ` +
              `this usually means --allow-net is narrowed (Deno checks permission against the nameserver, not the queried host)`,
            {
              cause: new Error(
                `${error.name} raised by the DNS resolver (resolver address redacted)`,
              ),
            },
          );
        }
        // A host may legitimately have only one address family.
      }
    }
    return results;
  }

  if (isNode || isBun) {
    const dns = await import("node:dns/promises");
    for (const recordType of options.recordTypes) {
      try {
        const addresses = recordType === "A"
          ? await dns.resolve4(hostname)
          : await dns.resolve6(hostname);
        results.push(...addresses);
      } catch {
        // A host may legitimately have only one address family.
      }
    }
  }

  return results;
}

let cachedResolver = createHostAddressResolver({ resolve: resolveHostAddressesUncached });

export async function resolveHostAddresses(
  hostname: string,
  options: ResolveHostAddressesOptions = {},
): Promise<string[]> {
  return await cachedResolver(hostname, options);
}

/** Drop cached resolutions so one test cannot observe another test's answers. */
export function __resetHostAddressCacheForTests(): void {
  cachedResolver = createHostAddressResolver({ resolve: resolveHostAddressesUncached });
}
