/**
 * Proxy trust boundary.
 *
 * Forwarded headers such as `x-forwarded-host` and `x-project-path` must only be
 * honoured when the request is known to come from a trusted upstream proxy.
 * Any other treatment lets an attacker reaching the runtime directly spoof the
 * origin host or point project discovery at arbitrary filesystem paths.
 *
 * Trust is an operator-owned deployment property, not a property of an
 * arbitrary application request. In particular, a channel-dispatch JWS is
 * intentionally not accepted here: that token is not bound to this request's
 * method, path, body, or routing identity and can therefore be replayed as an
 * unrelated proxy credential while it is fresh.
 *
 * @module server/utils/proxy-trust
 */

import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";

export interface ProxyTrustOptions {
  /**
   * Retained for call-site compatibility. Control-plane signing keys authorize
   * only the exact operation verified by the control-plane handler and never
   * promote a general HTTP request to proxy-trusted.
   */
  publicKeyPem?: string;
}

export async function isProxyTrusted(
  _req: Request,
  _options: ProxyTrustOptions = {},
): Promise<boolean> {
  return isProxyTopologyTrusted();
}
