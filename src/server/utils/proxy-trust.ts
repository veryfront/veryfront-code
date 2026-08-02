/**
 * Proxy trust boundary.
 *
 * Forwarded headers such as `x-forwarded-host` and `x-project-path` must only be
 * honoured when the request is known to come from a trusted upstream proxy.
 * Any other treatment lets an attacker reaching the runtime directly spoof the
 * origin host or point project discovery at arbitrary filesystem paths.
 *
 * Generic proxy trust is an operator-controlled deployment property, not a
 * request credential. A channel dispatch JWS binds the dispatch audience,
 * project, platform, and body; it does not bind arbitrary HTTP routing headers.
 * Treating one as generic proxy provenance would let a valid token be replayed
 * with attacker-selected `x-forwarded-host`, `x-project-path`, or environment
 * headers.
 *
 * Only the strict `VERYFRONT_TRUST_FORWARDED_HEADERS=1` operator setting can
 * enable this boundary. Other values, including whitespace-padded values, fail
 * closed.
 *
 * @module server/utils/proxy-trust
 */

import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";

export async function isProxyTrusted(
  _req: Request,
): Promise<boolean> {
  return isProxyTopologyTrusted();
}
