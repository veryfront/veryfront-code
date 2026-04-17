/**
 * Proxy trust boundary.
 *
 * Forwarded headers such as `x-forwarded-host` and `x-project-path` must only be
 * honoured when the request is known to come from a trusted upstream proxy.
 * Any other treatment lets an attacker reaching the runtime directly spoof the
 * origin host or point project discovery at arbitrary filesystem paths.
 *
 * A request is considered proxy-trusted when either:
 *   1. The operator has opted in via `VERYFRONT_TRUST_FORWARDED_HEADERS=1`
 *      (strict "1" match — "true", "yes", whitespace-padded values do NOT count
 *      so misconfiguration fails closed); or
 *   2. The request carries an `x-veryfront-dispatch-jws` header — a presence
 *      signal minted by the control plane and stripped by any sane edge. We
 *      only inspect presence here (not validity) because the signature is
 *      validated elsewhere and a bare-metal attacker can't usefully fake the
 *      header without also being able to fake the signature.
 *
 * @module server/utils/proxy-trust
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export function isProxyTrusted(req: Request): boolean {
  if (getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1") return true;
  return req.headers.has("x-veryfront-dispatch-jws");
}
