/**
 * Proxy environment utilities.
 */

const VALID_PROXY_ENVIRONMENTS = ["preview", "production"] as const;

export type ProxyEnvironment = (typeof VALID_PROXY_ENVIRONMENTS)[number];

/** Validate and parse proxy environment header */
export function parseProxyEnvironment(value: string | null): ProxyEnvironment | undefined {
  if (!value) return undefined;
  return VALID_PROXY_ENVIRONMENTS.includes(value as ProxyEnvironment)
    ? (value as ProxyEnvironment)
    : undefined;
}
