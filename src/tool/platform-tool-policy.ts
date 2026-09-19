import type { HostToolDefinition } from "./host-tools.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { hasTrustedHostToolProvenance } from "./host-tool-provenance.ts";
import { hasTrustedPlatformSource } from "./platform-source-provenance.ts";
import type { RemoteToolSource, Tool, ToolDefinition } from "./types.ts";

const RESERVED_PLATFORM_TOOL_PREFIX = "veryfront__";
const intrinsicReflectApply = Reflect.apply;
const intrinsicStringStartsWith = String.prototype.startsWith;

/** Whether a tool name claims the reserved `veryfront__` platform namespace, canonical or not. */
export function isReservedPlatformToolName(name: string): boolean {
  return intrinsicReflectApply(intrinsicStringStartsWith, name, [RESERVED_PLATFORM_TOOL_PREFIX]);
}

/** Platform names bypass connector restrictions only with host-owned provenance. */
export function isToolAllowedBySourcePolicy(
  name: string,
  policy: SourceIntegrationPolicyManifest,
  provenance?: Tool | ToolDefinition | RemoteToolSource | HostToolDefinition,
): boolean {
  if (isReservedPlatformToolName(name)) {
    return provenance !== undefined &&
      (hasTrustedHostToolProvenance(provenance) || hasTrustedPlatformSource(provenance));
  }
  return isIntegrationToolAllowedBySourcePolicy(name, policy);
}
