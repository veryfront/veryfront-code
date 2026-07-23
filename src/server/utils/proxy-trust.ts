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
 *      (strict "1" match; "true", "yes", and whitespace-padded values do NOT count
 *      so misconfiguration fails closed); or
 *   2. The request carries a valid `x-veryfront-dispatch-jws` header that
 *      cryptographically verifies against the configured control-plane public
 *      key and whose `iat`/`exp` claims are within the allowed freshness
 *      window. Presence alone is NOT trusted because the proxy does not strip
 *      this header from untrusted inbound requests (it has to pass through to
 *      the channel-invoke handler unchanged), so a
 *      direct-access attacker could otherwise set any value and promote
 *      forwarded-header spoofing.
 *
 * @module server/utils/proxy-trust
 */

import { verifyDispatchJwsSignature } from "#veryfront/channels/control-plane.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const DISPATCH_JWS_HEADER = "x-veryfront-dispatch-jws";
const MAX_DISPATCH_SIGNATURE_AGE_SECONDS = 60;

export interface ProxyTrustOptions {
  /**
   * PEM-encoded Ed25519 public key used to verify `x-veryfront-dispatch-jws`.
   * When absent, the dispatch-JWS trust signal is disabled (fails closed) and
   * only the operator opt-in env var can unlock proxy trust.
   */
  publicKeyPem?: string;
}

export async function isProxyTrusted(
  req: Request,
  options: ProxyTrustOptions = {},
): Promise<boolean> {
  if (getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1") return true;

  const jws = req.headers.get(DISPATCH_JWS_HEADER);
  if (!jws) return false;

  const { publicKeyPem } = options;
  if (!publicKeyPem) return false;

  return verifyDispatchJwsSignature(jws, {
    publicKeyPem,
    maxAgeSeconds: MAX_DISPATCH_SIGNATURE_AGE_SECONDS,
  });
}
