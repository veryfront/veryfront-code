/**
 * Host-owned outbound HTTP boundary.
 *
 * Tenant-controlled URLs must use this transport instead of calling the host
 * `fetch` directly. It reuses the DNS-pinned sandbox transport so validation
 * and connection establishment cannot be separated by a DNS-rebinding window.
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  guardedEgressFetch,
  isInternalEgressOverrideEnabled,
  type ResolveWorkerHost,
  WorkerEgressBlockedError,
  type WorkerEgressFetch,
  type WorkerEgressPinnedFetch,
  type WorkerEgressRedirect,
} from "#veryfront/security/sandbox/worker-egress-guard.ts";

export const HOST_INTERNAL_EGRESS_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS";
export const HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV =
  "VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS";

export class OutboundRequestBlockedError extends Error {
  override name = "OutboundRequestBlockedError";
}

export interface GuardedOutboundFetchOptions {
  /** Additional operator-owned URL policy, applied to every redirect hop. */
  authorizeUrl?: (url: URL) => void | Promise<void>;
  /** Observe each redirect after its guarded destination request succeeds. */
  onRedirect?: (redirect: WorkerEgressRedirect) => void | Promise<void>;
}

/** Host-owned transport primitives used after outbound policy validation. */
export interface OutboundFetchTransport {
  fetch: WorkerEgressFetch;
  pinnedFetch?: WorkerEgressPinnedFetch;
  /**
   * Address resolver the egress guard pins against, defaulting to real DNS.
   *
   * The guard resolves the destination host before it reaches `fetch` or
   * `pinnedFetch`, so a transport that never opens a socket still triggers a
   * live lookup unless it supplies this too. Production leaves it unset and
   * keeps `defaultResolveHost`.
   */
  resolveHost?: ResolveWorkerHost;
}

/** Explicit host transport boundary used by runtime composition and tests. */
export interface OutboundFetchBoundary {
  guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: GuardedOutboundFetchOptions,
  ): Promise<Response>;
  createOriginBoundFetch(baseUrl: string): typeof fetch;
}

// Capture the host transport before tenant code can replace globalThis.fetch.
const capturedHostFetch = globalThis.fetch.bind(globalThis);
let outboundFetchTransportForTests: Readonly<OutboundFetchTransport> | undefined;

function getTrustedHostTransport(): OutboundFetchTransport {
  if (outboundFetchTransportForTests !== undefined) {
    return outboundFetchTransportForTests;
  }

  // Omitting pinnedFetch is deliberate: Node and Bun then use the native
  // address-pinned transport, while Deno uses its pinned SOCKS client.
  return { fetch: capturedHostFetch };
}

async function fetchWithHostTransport(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: GuardedOutboundFetchOptions,
  transport: OutboundFetchTransport,
  allowInternalEgress: boolean,
): Promise<Response> {
  return await guardedEgressFetch(input, init, {
    fetchImpl: transport.fetch,
    pinnedFetch: transport.pinnedFetch,
    authorizeUrl: async (url) => {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new OutboundRequestBlockedError(
          `Outbound request blocked: unsupported URL scheme ${url.protocol}`,
        );
      }
      if (url.username.length > 0 || url.password.length > 0) {
        throw new OutboundRequestBlockedError(
          "Outbound request blocked: URL credentials are not allowed",
        );
      }
      await options.authorizeUrl?.(url);
    },
    onRedirect: options.onRedirect,
    options: {
      allowInternalEgress: allowInternalEgress ||
        isInternalEgressOverrideEnabled(getHostEnv(HOST_INTERNAL_EGRESS_OVERRIDE_ENV)),
      resolveHost: transport.resolveHost,
    },
  });
}

function parseAllowedInternalProviderOrigins(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) return new Set();

  const origins = new Set<string>();
  for (const entry of value.split(",")) {
    let url: URL;
    try {
      url = new URL(entry.trim());
    } catch {
      throw new TypeError(
        `${HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV} must contain comma-separated HTTP origins`,
      );
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new TypeError(
        `${HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV} entries must be HTTP origins without paths, credentials, query strings, or fragments`,
      );
    }
    origins.add(url.origin);
  }
  return origins;
}

function isHostAllowedInternalProviderOrigin(base: URL): boolean {
  return parseAllowedInternalProviderOrigins(
    getHostEnv(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV),
  ).has(base.origin);
}

function snapshotOutboundFetchTransport(
  transport: OutboundFetchTransport,
): Readonly<OutboundFetchTransport> {
  if (typeof transport.fetch !== "function") {
    throw new TypeError("Outbound transport fetch must be a function");
  }
  if (transport.pinnedFetch !== undefined && typeof transport.pinnedFetch !== "function") {
    throw new TypeError("Outbound pinned transport must be a function");
  }
  if (transport.resolveHost !== undefined && typeof transport.resolveHost !== "function") {
    throw new TypeError("Outbound transport host resolver must be a function");
  }
  return Object.freeze({
    fetch: transport.fetch,
    pinnedFetch: transport.pinnedFetch,
    resolveHost: transport.resolveHost,
  });
}

async function fetchWithBoundaryErrors(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: GuardedOutboundFetchOptions,
  transport: OutboundFetchTransport,
  allowInternalEgress = false,
): Promise<Response> {
  try {
    return await fetchWithHostTransport(
      input,
      init,
      options,
      transport,
      allowInternalEgress,
    );
  } catch (error) {
    if (error instanceof WorkerEgressBlockedError) {
      throw new OutboundRequestBlockedError(
        error.message.replace(/^Worker\s+/u, "Outbound "),
        { cause: error },
      );
    }
    throw error;
  }
}

function createOriginBoundFetchWithTransport(
  baseUrl: string,
  transport: OutboundFetchTransport,
): typeof fetch {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("Provider base URL must use http: or https:");
  }
  if (base.username || base.password) {
    throw new TypeError("Provider base URL must not include credentials");
  }
  const allowInternalEgress = isHostAllowedInternalProviderOrigin(base);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const target = new URL(raw, base);
    // Keep a Request input intact so provider SDKs do not lose its method,
    // headers, body, signal, or other request-level semantics at this boundary.
    const guardedInput: RequestInfo | URL = input instanceof Request ? input : target;
    return await fetchWithBoundaryErrors(
      guardedInput,
      { ...init, redirect: "error" },
      {
        authorizeUrl(url) {
          if (url.origin !== base.origin) {
            throw new OutboundRequestBlockedError(
              "Provider request blocked: destination origin is not authorized",
            );
          }
        },
      },
      transport,
      allowInternalEgress,
    );
  };
}

/**
 * Create an outbound boundary from explicit host-owned transport primitives.
 *
 * @internal Runtime composition and deterministic tests use this seam. The
 * default exports below never source their production transport from it.
 */
export function createOutboundFetchBoundary(
  transport: OutboundFetchTransport,
): OutboundFetchBoundary {
  const captured = snapshotOutboundFetchTransport(transport);
  return Object.freeze({
    guardedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
      options: GuardedOutboundFetchOptions = {},
    ): Promise<Response> {
      return fetchWithBoundaryErrors(input, init, options, captured);
    },
    createOriginBoundFetch(baseUrl: string): typeof fetch {
      return createOriginBoundFetchWithTransport(baseUrl, captured);
    },
  });
}

/**
 * Point the host transport at `transport` until the returned function is called.
 *
 * For suites that install a stub in `beforeEach` and tear it down in
 * `afterEach`, where there is no single callback to scope. Prefer
 * `__runWithOutboundFetchTransportForTests` when there is one -- it cannot be
 * left installed by an early return.
 */
/**
 * Route outbound requests through the captured host `fetch` without address
 * pinning, for the duration of a test process.
 *
 * Deno's pinned path uses its SOCKS client, which holds a connection open past
 * the end of a test and trips the resource sanitiser. Tests that genuinely
 * reach the network want the plain transport; production never does. Installed
 * once from `src/testing/preload.ts`, where it is visible, rather than inferred
 * from an environment variable inside this module.
 *
 * This is not a stub: it is the real host `fetch`, captured before tenant code
 * could replace it, so it cannot silently honour an ambient
 * `globalThis.fetch` assignment the way the old `DENO_TESTING` branch did.
 */
export function __installUnpinnedHostTransportForTests(): () => void {
  return __installOutboundFetchTransportForTests({
    fetch: capturedHostFetch,
    pinnedFetch: (url, _addresses, init) => capturedHostFetch(url, init),
  });
}

export function __installOutboundFetchTransportForTests(
  transport: OutboundFetchTransport,
): () => void {
  const previous = outboundFetchTransportForTests;
  outboundFetchTransportForTests = snapshotOutboundFetchTransport(transport);
  return () => {
    outboundFetchTransportForTests = previous;
  };
}

export async function __runWithOutboundFetchTransportForTests<T>(
  transport: OutboundFetchTransport,
  fn: () => Promise<T>,
): Promise<T> {
  const restore = __installOutboundFetchTransportForTests(transport);
  try {
    return await fn();
  } finally {
    restore();
  }
}

/**
 * Fetch an HTTP resource through the host egress ceiling.
 *
 * Internal destinations are denied by default. Only the host process can
 * enable the explicit override; project environment overlays cannot change
 * `getHostEnv()`.
 */
export async function guardedOutboundFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: GuardedOutboundFetchOptions = {},
): Promise<Response> {
  return await fetchWithBoundaryErrors(input, init, options, getTrustedHostTransport());
}

/**
 * Create a credential-safe provider transport bound to one configured origin.
 * Redirects are rejected rather than followed so provider-specific credential
 * headers (for example `x-api-key`) can never cross an origin boundary.
 */
export function createOriginBoundOutboundFetch(baseUrl: string): typeof fetch {
  return createOriginBoundFetchWithTransport(baseUrl, getTrustedHostTransport());
}
