import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { localIntegrationConfigurationError } from "#veryfront/integrations/local-integration-errors.ts";

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

/**
 * Refuse local credential discovery and execution unless the host granted it.
 *
 * Every source that resolves credentials from the host environment calls this
 * before it lists or executes a tool, so a source cannot inherit the capability
 * by omitting its own call-site check. A proxy runtime is refused even when the
 * grant is set, because it never owns the credentials it would forward.
 */
export function assertLocalCredentialHostGrant(): void {
  if (getEnvironmentConfig().proxyMode || !isHostLocalIntegrationCredentialsEnabled()) {
    localIntegrationConfigurationError(
      "Local integration credentials are available only in local or self-hosted runtimes. " +
        `Set ${HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV}=1 in the host environment of a local ` +
        "or dedicated self-hosted runtime. A proxy runtime is refused even with the grant set.",
    );
  }
}
