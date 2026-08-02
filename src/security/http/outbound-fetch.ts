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
  WorkerEgressBlockedError,
  type WorkerEgressFetch,
  type WorkerEgressPinnedFetch,
} from "#veryfront/security/sandbox/worker-egress-guard.ts";

export const HOST_INTERNAL_EGRESS_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS";

export class OutboundRequestBlockedError extends Error {
  override name = "OutboundRequestBlockedError";
}

export interface GuardedOutboundFetchOptions {
  /** Additional operator-owned URL policy, applied to every redirect hop. */
  authorizeUrl?: (url: URL) => void | Promise<void>;
}

interface HostOutboundTransport {
  fetch: WorkerEgressFetch;
  pinnedFetch?: WorkerEgressPinnedFetch;
}

// Capture the host transport before tenant code can replace globalThis.fetch.
const capturedHostFetch = globalThis.fetch.bind(globalThis);

function getTrustedHostTransport(): HostOutboundTransport {
  if (getHostEnv("DENO_TESTING") !== "1") {
    // Omitting pinnedFetch is deliberate: Node and Bun then use the native
    // address-pinned transport, while Deno uses its pinned SOCKS client.
    return { fetch: capturedHostFetch };
  }

  // Tests explicitly opt into their current deterministic fetch replacement.
  // The pinned seam receives only addresses that the egress guard validated,
  // and production never selects this transport.
  const fetchImpl = globalThis.fetch.bind(globalThis);
  return {
    fetch: fetchImpl,
    pinnedFetch: (url, _addresses, init) => fetchImpl(url, init),
  };
}

async function fetchWithHostTransport(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: GuardedOutboundFetchOptions,
  transport: HostOutboundTransport,
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
    options: {
      allowInternalEgress: isInternalEgressOverrideEnabled(
        getHostEnv(HOST_INTERNAL_EGRESS_OVERRIDE_ENV),
      ),
    },
  });
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
  try {
    return await fetchWithHostTransport(input, init, options, getTrustedHostTransport());
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

/**
 * Create a credential-safe provider transport bound to one configured origin.
 * Redirects are rejected rather than followed so provider-specific credential
 * headers (for example `x-api-key`) can never cross an origin boundary.
 */
export function createOriginBoundOutboundFetch(baseUrl: string): typeof fetch {
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("Provider base URL must use http: or https:");
  }
  if (base.username || base.password) {
    throw new TypeError("Provider base URL must not include credentials");
  }
  const transport = getTrustedHostTransport();

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const target = new URL(raw, base);
    // Keep a Request input intact so provider SDKs do not lose its method,
    // headers, body, signal, or other request-level semantics at this boundary.
    const guardedInput: RequestInfo | URL = input instanceof Request ? input : target;
    try {
      return await fetchWithHostTransport(
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
  };
}
