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
 * Trust is established by either the strict
 * `VERYFRONT_TRUST_FORWARDED_HEADERS=1` operator setting, or a replacement
 * request created by the framework's same-process proxy from a
 * transport-authenticated source request. The latter is held in an internal
 * WeakSet rather than a header, so a direct client cannot replay it. Other env
 * values, including whitespace-padded values, fail closed.
 *
 * @module server/utils/proxy-trust
 */

import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import { isSameProcessProxyRequest } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

export async function isProxyTrusted(
  req: Request,
): Promise<boolean> {
  return isProxyTopologyTrusted() || isSameProcessProxyRequest(req);
}
