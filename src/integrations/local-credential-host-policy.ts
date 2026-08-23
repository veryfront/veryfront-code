import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { localIntegrationConfigurationError } from "#veryfront/integrations/local-integration-errors.ts";
import type {
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool/types.ts";

const freeze = Object.freeze;

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
 * A proxy runtime is refused even when the grant is set, because it never owns
 * the credentials it would forward.
 */
export function assertLocalCredentialHostGrant(): void {
  if (getEnvironmentConfig().proxyMode || !isHostLocalIntegrationCredentialsEnabled()) {
    localIntegrationConfigurationError(
      "Local integration credentials require an explicit host grant. " +
        `Set ${HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV}=1 in the host environment of a local ` +
        "or dedicated self-hosted runtime. A proxy runtime is refused even with the grant set.",
    );
  }
}

/** @internal Apply the host grant to both operations of a local credential source. */
export function guardLocalCredentialSource(source: RemoteToolSource): RemoteToolSource {
  return freeze({
    id: source.id,
    async listTools(context?: ToolExecutionContext): Promise<ToolDefinition[]> {
      assertLocalCredentialHostGrant();
      return await source.listTools(context);
    },
    async executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      assertLocalCredentialHostGrant();
      return await source.executeTool(toolName, args, context);
    },
  });
}
