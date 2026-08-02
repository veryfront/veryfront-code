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
} from "#veryfront/security/sandbox/worker-egress-guard.ts";

export const HOST_INTERNAL_EGRESS_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS";

export class OutboundRequestBlockedError extends Error {
  override name = "OutboundRequestBlockedError";
}

export interface GuardedOutboundFetchOptions {
  /** Additional operator-owned URL policy, applied to every redirect hop. */
  authorizeUrl?: (url: URL) => void | Promise<void>;
}

// Capture the host transport before tenant code can replace globalThis.fetch.
// Focused tests run with DENO_TESTING=1 and deliberately replace the global in
// order to exercise the policy boundary without opening real sockets.
const capturedHostFetch = globalThis.fetch.bind(globalThis);

function getTrustedHostFetch(): typeof fetch {
  return getHostEnv("DENO_TESTING") === "1" ? globalThis.fetch.bind(globalThis) : capturedHostFetch;
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
    return await guardedEgressFetch(input, init, {
      fetchImpl: getTrustedHostFetch(),
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

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const target = new URL(raw, base);
    // Keep a Request input intact so provider SDKs do not lose its method,
    // headers, body, signal, or other request-level semantics at this boundary.
    const guardedInput: RequestInfo | URL = input instanceof Request ? input : target;
    return await guardedOutboundFetch(guardedInput, { ...init, redirect: "error" }, {
      authorizeUrl(url) {
        if (url.origin !== base.origin) {
          throw new OutboundRequestBlockedError(
            "Provider request blocked: destination origin is not authorized",
          );
        }
      },
    });
  };
}
