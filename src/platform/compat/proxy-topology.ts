/**
 * Operator-controlled trust for upstream proxy topology.
 *
 * This capability authorizes routing-sensitive forwarded headers. It is
 * intentionally process-scoped and independent from request signatures.
 *
 * @module platform/compat/proxy-topology
 */

import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";

const TRUST_FORWARDED_HEADERS_ENV = "VERYFRONT_TRUST_FORWARDED_HEADERS";

/**
 * Whether the operator explicitly placed this process behind a private,
 * sanitising edge.
 *
 * The strict value deliberately fails closed for misspellings and
 * whitespace-padded configuration.
 */
export function isProxyTopologyTrusted(): boolean {
  return getHostEnv(TRUST_FORWARDED_HEADERS_ENV) === "1";
}
