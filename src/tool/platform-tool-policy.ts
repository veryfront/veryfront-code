import type { HostToolDefinition } from "./host-tools.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  parseIntegrationToolIdentity,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { hasTrustedHostToolProvenance } from "./host-tool-provenance.ts";
import { hasTrustedPlatformSource } from "./platform-source-provenance.ts";
import type { RemoteToolSource, Tool, ToolDefinition } from "./types.ts";

/** Platform names bypass connector restrictions only with host-owned provenance. */
export function isToolAllowedBySourcePolicy(
  name: string,
  policy: SourceIntegrationPolicyManifest,
  provenance?: Tool | ToolDefinition | RemoteToolSource | HostToolDefinition,
): boolean {
  return isIntegrationToolAllowedBySourcePolicy(name, policy) ||
    (parseIntegrationToolIdentity(name)?.integration === "veryfront" &&
      provenance !== undefined &&
      (hasTrustedHostToolProvenance(provenance) || hasTrustedPlatformSource(provenance)));
}
