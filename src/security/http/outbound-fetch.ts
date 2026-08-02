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
} from "#veryfront/security/sandbox/worker-egress-guard.ts";

export const HOST_INTERNAL_EGRESS_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS";

export class OutboundRequestBlockedError extends Error {
  override name = "OutboundRequestBlockedError";
}

export interface GuardedOutboundFetchOptions {
  /** Trusted transport replacement used by tests and host integrations. */
  fetchImpl?: typeof fetch;
  /** Additional operator-owned URL policy, applied to every redirect hop. */
  authorizeUrl?: (url: URL) => void | Promise<void>;
  /** @internal Deterministic DNS seam for focused security tests. */
  resolveHost?: ResolveWorkerHost;
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
      fetchImpl: options.fetchImpl,
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
        resolveHost: options.resolveHost,
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
