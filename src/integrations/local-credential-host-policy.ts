import { getHostEnv } from "#veryfront/platform/compat/process.ts";

/**
 * Operator-owned grant for resolving and using local integration credentials.
 *
 * The host environment accessor bypasses project environment overlays, so a
 * tenant cannot grant this capability. The exact value `1` keeps the opt-in
 * deliberate and makes absent or malformed configuration fail closed.
 */
export const HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV =
  "VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS";

export function isHostLocalIntegrationCredentialsEnabled(
  value: string | undefined = getHostEnv(HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV),
): boolean {
  return value === "1";
}
